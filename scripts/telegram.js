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

/**
 * Validate a URL string. Returns { valid: true, url } or { valid: false, reason }.
 */
function validateWorkerUrl(input) {
  const url = input.replace(/\/+$/, '');
  if (!url) {
    return { valid: false, reason: 'URL is empty.' };
  }
  if (!url.startsWith('https://')) {
    return { valid: false, reason: 'URL must start with https://.' };
  }
  if (url.includes(' ')) {
    return { valid: false, reason: 'URL must not contain spaces.' };
  }
  // Reject obviously malformed URLs (no domain, etc.)
  try {
    new URL(url);
  } catch (_) {
    return { valid: false, reason: 'URL is not a valid HTTPS URL.' };
  }
  return { valid: true, url };
}

/**
 * Classify a network error into a user-friendly explanation.
 */
function classifyNetworkError(error) {
  const msg = (error.message || '').toLowerCase();
  const causeMsg = (error.cause && error.cause.message || '').toLowerCase();
  const combined = msg + ' ' + causeMsg;

  if (combined.includes('econnrefused')) {
    // ECONNREFUSED usually means a local proxy/VPN/firewall is blocking
    // the connection to api.telegram.org. Extract the target IP if present.
    const ipMatch = combined.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
    const target = ipMatch ? `${ipMatch[1]}:${ipMatch[2]}` : 'the target host';
    return [
      `Connection refused by ${target}.`,
      'This is typically caused by:',
      '  - A local proxy, VPN, or firewall blocking outbound HTTPS connections',
      '  - Corporate network restrictions on api.telegram.org',
      '  - A misconfigured hosts file or DNS resolver routing traffic to a proxy',
      '',
      'Suggestions:',
      '  - Try running this command from a different network',
      '  - Check if you have a proxy configured (HTTP_PROXY / HTTPS_PROXY env vars)',
      '  - Verify DNS resolution: nslookup api.telegram.org',
      '  - Check your hosts file for any telegram-related entries',
    ];
  }
  if (combined.includes('enotfound') || combined.includes('getaddrinfo')) {
    return [
      'DNS resolution failed for api.telegram.org.',
      'Check your internet connection and DNS settings.',
    ];
  }
  if (combined.includes('etimedout') || combined.includes('timeout')) {
    return [
      'Connection to api.telegram.org timed out.',
      'The host may be unreachable from your network.',
    ];
  }
  if (combined.includes('fetch failed')) {
    return [
      'Network request failed. Possible causes:',
      '  - No internet connection',
      '  - Proxy or firewall blocking the request',
      '  - DNS resolution failure',
    ];
  }
  return [
    `Unexpected error: ${error.message}`,
  ];
}

async function setupWebhook(token, dbName) {
  // Generate and store a webhook secret for security
  const secret = crypto.randomBytes(16).toString('hex');
  updateSetting(dbName, 'telegram_webhook_secret', secret);
  console.log('✅ Webhook secret generated and saved.');

  console.log();
  console.log('Enter your Worker URL:');
  console.log('Example: https://comments-garden.<subdomain>.workers.dev');
  const workerUrl = await prompt('Worker URL: ');
  if (!workerUrl) {
    console.log('⚠️  No URL provided. Skipping webhook registration.');
    console.log('   You can register it later by re-running setup.\n');
    return;
  }

  const validation = validateWorkerUrl(workerUrl);
  if (!validation.valid) {
    console.error(`❌ Invalid URL: ${validation.reason}`);
    return;
  }
  const webhookUrl = validation.url + '/api/telegram/webhook';
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
      console.log(`✅ Webhook registered: ${webhookUrl}`);
    } else {
      console.error(`\n❌ Webhook registration failed: ${body.description || 'Unknown error'}`);
    }
  } catch (e) {
    console.error(`\n❌ Webhook registration failed: ${e.message}`);
    const lines = classifyNetworkError(e);
    for (const line of lines) {
      console.error(`   ${line}`);
    }
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

// Export testable functions when required as a module (not run directly)
if (require.main !== module) {
  module.exports = {
    validateWorkerUrl,
    classifyNetworkError,
    getDbName,
    WRANGLER_TOML,
  };
}
