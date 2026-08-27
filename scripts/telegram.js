const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const WRANGLER_TOML = path.join(__dirname, '../worker/wrangler.toml');
const DEV_VARS = path.join(__dirname, '../worker/.dev.vars');
const CWD = path.join(__dirname, '../worker');

// ── Readline ──────────────────────────────────────────────────────────────────
// One persistent readline instance for the lifetime of the process.
// Closing and re-creating between questions on Windows breaks stdin.
let rl = null;

function ensureRl() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function prompt(question) {
  return new Promise(resolve => {
    // Ensure stdin is in flowing mode before readline reads from it.
    // On Windows, execSync with shell:true can pause stdin as a side-effect,
    // causing the next readline.question() to silently hang or error.
    process.stdin.resume();
    ensureRl().question(question, answer => resolve(answer.trim()));
  });
}

function cleanup() {
  if (rl) { rl.close(); rl = null; }
}

// Ensure cleanup on any exit path
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// ── Wrangler helpers ──────────────────────────────────────────────────────────

function run(command) {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: CWD,
      shell: true,
    });
  } catch (error) {
    return null;
  }
}

function getDbName() {
  const toml = fs.readFileSync(WRANGLER_TOML, 'utf-8');
  const match = toml.match(/database_name\s*=\s*"([^"]+)"/);
  return match ? match[1] : 'comment-garden-db';
}

function getWorkerName() {
  const toml = fs.readFileSync(WRANGLER_TOML, 'utf-8');
  const match = toml.match(/^name\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

/**
 * Try to detect the deployed Worker URL automatically.
 * Returns the URL string or null if detection fails.
 */
function detectWorkerUrl() {
  const toml = fs.readFileSync(WRANGLER_TOML, 'utf-8');
  const workerName = getWorkerName();

  // 1. Check wrangler.toml for custom routes
  const routeMatch = toml.match(/^routes\s*=\s*\[([\s\S]*?)\]/m);
  if (routeMatch) {
    const routeUrls = routeMatch[1].match(/"(https?:\/\/[^"\\]+)"/g);
    if (routeUrls && routeUrls.length > 0) {
      const url = routeUrls[0].replace(/"/g, '').replace(/\/+$/, '');
      return url;
    }
  }

  // 2. Check ALLOWED_ORIGINS — if a specific domain is configured,
  //   the worker is likely served from that domain
  const originsMatch = toml.match(/ALLOWED_ORIGINS\s*=\s*"([^"]+)"/);
  if (originsMatch && originsMatch[1] !== '*') {
    const origin = originsMatch[1].replace(/\/+$/, '');
    return origin;
  }

  // 3. Construct default workers.dev URL from the worker name
  if (workerName) {
    return `https://${workerName}.workers.dev`;
  }

  return null;
}

function getSetting(dbName, key) {
  const result = run(`npx wrangler d1 execute "${dbName}" --remote --command="SELECT value FROM settings WHERE key='${key}'" --json`);
  if (result) {
    try {
      const data = JSON.parse(result);
      const first = Array.isArray(data) ? data[0] : data;
      if (first && first.results && first.results.length > 0 && first.results[0].value !== undefined) {
        return String(first.results[0].value);
      }
    } catch (e) {}
  }
  return null;
}

function updateSetting(dbName, key, value) {
  return run(`npx wrangler d1 execute "${dbName}" --remote --command="INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${value}')"`);
}

function updateDevVars(token) {
  let content = '';
  if (fs.existsSync(DEV_VARS)) content = fs.readFileSync(DEV_VARS, 'utf-8');
  if (content.includes('TELEGRAM_BOT_TOKEN=')) {
    content = content.replace(/TELEGRAM_BOT_TOKEN=.*/, `TELEGRAM_BOT_TOKEN="${token}"`);
  } else {
    content = content.trimEnd() + `\nTELEGRAM_BOT_TOKEN="${token}"\n`;
  }
  fs.writeFileSync(DEV_VARS, content);
}

/**
 * Push bot token via wrangler secret put.
 * Uses execSync with input (creates its own stdin pipe) — never touches
 * the parent readline's stdin.
 */
function pushSecret(token) {
  try {
    execSync('npx wrangler secret put TELEGRAM_BOT_TOKEN', {
      input: token,
      cwd: CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function setupWebhook(token, dbName) {
  // Generate and store a webhook secret for security
  const secret = crypto.randomBytes(16).toString('hex');
  updateSetting(dbName, 'telegram_webhook_secret', secret);
  console.log('✅ Webhook secret generated and saved.');

  // Auto-detect or prompt for the worker URL
  console.log();
  let workerUrl = detectWorkerUrl();

  if (workerUrl) {
    console.log(`✓ Detected Worker URL: ${workerUrl}`);
    const confirm = await prompt('Use this URL? (Y/n): ');
    if (confirm && confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes' && confirm !== '') {
      workerUrl = null; // User rejected — fall through to manual prompt
    }
  }

  if (!workerUrl) {
    console.log('The webhook needs a public URL that Telegram can reach.');
    console.log('This is your worker deployment URL.');
    console.log('  Examples: https://comments-garden.your-subdomain.workers.dev');
    console.log('            https://yourdomain.com\n');
    workerUrl = await prompt('Enter your worker URL: ');
    if (!workerUrl) {
      console.log('⚠️  No URL provided. Skipping webhook registration.');
      console.log('   You can register it later by re-running setup.\n');
      return;
    }
  }

  // Validate URL format
  workerUrl = workerUrl.replace(/\/+$/, '');
  if (!workerUrl.startsWith('https://')) {
    console.error('❌ Invalid URL: must start with https://');
    console.log('   Skipping webhook registration.\n');
    return;
  }

  const webhookUrl = workerUrl + '/api/telegram/webhook';
  console.log(`\nRegistering webhook: ${webhookUrl}`);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['callback_query'],
      }),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      console.error(`\n❌ Webhook registration failed: unexpected response (HTTP ${response.status})`);
      console.error(`   Response: ${text.substring(0, 200)}`);
      return;
    }
    if (body.ok) {
      console.log(`✅ Webhook registered successfully: ${webhookUrl}`);
    } else {
      console.error(`\n❌ Webhook registration failed: ${body.description || 'Unknown error'}`);
      if (body.description && body.description.includes('host not found')) {
        console.error('   The URL does not resolve. Make sure the worker is deployed at this URL.');
      } else if (body.description && body.description.includes('timeout')) {
        console.error('   Telegram could not reach the URL. Check that the worker is running and accessible.');
      } else if (body.description && body.description.includes('wrong webhook')) {
        console.error('   The webhook URL format is incorrect.');
      }
    }
  } catch (e) {
    console.error(`\n❌ Webhook registration failed: ${e.message}`);
    if (e.cause) console.error(`   Cause: ${e.cause.message || e.cause}`);
    console.error('\n   Possible causes:');
    console.error('   - The worker is not deployed at the specified URL');
    console.error('   - Network connectivity issues');
    console.error('   - DNS resolution failed for the URL');
    console.error(`\n   You can set the webhook manually via:`);
    console.error(`   https://api.telegram.org/bot<TOKEN>/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${secret}`);
  }
}

async function setupTelegram() {
  console.log('🔔  Telegram Notification Setup\n');

  const token = await prompt('Enter your Telegram Bot Token: ');
  if (!token || !token.includes(':')) {
    console.error('❌ Invalid bot token format.');
    return;
  }

  const dbName = getDbName();

  if (pushSecret(token)) {
    console.log('✅ Bot token set as Worker secret.');
  } else {
    console.log('⚠️  Could not set remote secret. Set it later with: cd worker && npx wrangler secret put TELEGRAM_BOT_TOKEN');
  }
  updateDevVars(token);

  const chatId = await prompt('Enter your Telegram Chat ID (numeric): ');
  if (!chatId) {
    console.error('❌ Chat ID is required.');
    return;
  }

  updateSetting(dbName, 'telegram_chat_id', chatId);
  console.log('✅ Chat ID saved.');

  // Verify: read it back from production D1
  const saved = getSetting(dbName, 'telegram_chat_id');
  if (saved === chatId) {
    console.log(`✅ Verified: telegram_chat_id = ${saved}`);
  } else {
    console.error(`❌ Verification failed! Expected "${chatId}" but got "${saved}".`);
  }

  // Register the webhook for action buttons
  await setupWebhook(token, dbName);

  const test = await prompt('Send a test notification? (y/n): ');
  if (test.toLowerCase() === 'y' || test.toLowerCase() === 'yes') {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ <b>Telegram integration test</b>\n\nNotifications are working!',
          parse_mode: 'HTML',
        }),
      });
      console.log(response.ok ? '✅ Test notification sent!' : `❌ Failed: ${await response.text()}`);
    } catch (e) {
      console.error('❌ Failed:', e.message);
    }
  }

  const enable = await prompt('Enable notifications? (y/n): ');
  const enabled = enable.toLowerCase() === 'y' || enable.toLowerCase() === 'yes';
  updateSetting(dbName, 'telegram_enabled', enabled ? 'true' : 'false');
  console.log(enabled ? '✅ Telegram notifications enabled.' : 'ℹ️  Telegram notifications disabled.');
  console.log();
}

async function changeToken() {
  console.log('🔑 Change Telegram Bot Token\n');
  const token = await prompt('Enter new Bot Token: ');
  if (!token || !token.includes(':')) {
    console.error('❌ Invalid bot token format.');
    return;
  }

  if (pushSecret(token)) {
    console.log('✅ Bot token updated for production.');
  } else {
    console.log('⚠️  Could not update remote secret. Set it manually with: cd worker && npx wrangler secret put TELEGRAM_BOT_TOKEN');
  }
  updateDevVars(token);
  console.log('✅ Local .dev.vars updated.');

  // Re-register webhook with the new token
  const dbName = getDbName();
  await setupWebhook(token, dbName);
  console.log();
}

async function changeChatId() {
  console.log('💬 Change Telegram Chat ID\n');
  const chatId = await prompt('Enter new Chat ID (numeric): ');
  if (!chatId) {
    console.error('❌ Chat ID is required.');
    return;
  }

  const dbName = getDbName();
  updateSetting(dbName, 'telegram_chat_id', chatId);
  console.log('✅ Chat ID updated.');

  // Verify: read it back from production D1
  const saved = getSetting(dbName, 'telegram_chat_id');
  if (saved === chatId) {
    console.log(`✅ Verified: telegram_chat_id = ${saved}`);
  } else {
    console.error(`❌ Verification failed! Expected "${chatId}" but got "${saved}".`);
  }
  console.log();
}

async function enableNotifications() {
  const dbName = getDbName();
  updateSetting(dbName, 'telegram_enabled', 'true');
  console.log('✅ Telegram notifications enabled.\n');
}

async function disableNotifications() {
  const dbName = getDbName();
  updateSetting(dbName, 'telegram_enabled', 'false');
  console.log('✅ Telegram notifications disabled.\n');
}

async function sendTest() {
  console.log('📨 Sending test notification...\n');

  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token && fs.existsSync(DEV_VARS)) {
    const content = fs.readFileSync(DEV_VARS, 'utf-8');
    const match = content.match(/TELEGRAM_BOT_TOKEN="?([^"\n]+)"?/);
    if (match) token = match[1];
  }

  if (!token) {
    console.log('❌ No bot token found. Run option 1 first.\n');
    return;
  }

  const dbName = getDbName();
  const chatId = getSetting(dbName, 'telegram_chat_id');
  if (!chatId) {
    console.log('❌ No Chat ID configured. Run option 1 first.\n');
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ <b>Telegram integration test</b>\n\nYour Telegram notifications are working correctly!\n\nYou will receive notifications for new comments here.',
        parse_mode: 'HTML',

      }),
    });
    if (response.ok) {
      console.log('✅ Test notification sent!\n');
    } else {
      const err = await response.text();
      console.error('❌ Failed to send test notification.');
      console.error('   Response:', err, '\n');
    }
  } catch (e) {
    console.error('❌ Failed:', e.message, '\n');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Non-interactive CLI flags
  if (args.includes('--enable')) { await enableNotifications(); return; }
  if (args.includes('--disable')) { await disableNotifications(); return; }
  if (args.includes('--test')) { await sendTest(); return; }
  if (args.includes('--setup')) { await setupTelegram(); return; }
  if (args.includes('--token')) { await changeToken(); return; }
  if (args.includes('--chat-id')) { await changeChatId(); return; }

  // Interactive menu — select one operation, run it, then exit
  console.log('🔔  Telegram Notification Configuration\n');
  console.log('  1. Setup / Reconfigure');
  console.log('  2. Change Bot Token');
  console.log('  3. Change Chat ID');
  console.log('  4. Enable notifications');
  console.log('  5. Disable notifications');
  console.log('  6. Send test notification\n');

  const actions = {
    '1': setupTelegram,
    '2': changeToken,
    '3': changeChatId,
    '4': enableNotifications,
    '5': disableNotifications,
    '6': sendTest,
  };

  const choice = await prompt('Enter option (1-6): ');

  if (actions[choice]) {
    console.log('');
    await actions[choice]();
  } else {
    console.error('❌ Invalid option.');
  }

  cleanup();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
