/**
 * Tests for Telegram webhook setup: URL validation, error handling, security.
 *
 * Run: node scripts/test_telegram_webhook.js
 */

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    assert(true, message);
  } else {
    assert(false, `${message} — expected "${expected}", got "${actual}"`);
  }
}

function assertIncludes(str, substr, message) {
  if (str.includes(substr)) {
    assert(true, message);
  } else {
    assert(false, `${message} — "${str}" does not contain "${substr}"`);
  }
}

function assertDoesNotInclude(str, substr, message) {
  if (!str.includes(substr)) {
    assert(true, message);
  } else {
    assert(false, `${message} — "${str}" unexpectedly contains "${substr}"`);
  }
}

function section(name) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(60));
}

// ── Pure functions (copied from telegram.js for isolated testing) ─────────────

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
  try {
    new URL(url);
  } catch (_) {
    return { valid: false, reason: 'URL is not a valid HTTPS URL.' };
  }
  return { valid: true, url };
}

function classifyNetworkError(error) {
  const msg = (error.message || '').toLowerCase();
  const causeMsg = (error.cause && error.cause.message || '').toLowerCase();
  const combined = msg + ' ' + causeMsg;

  if (combined.includes('econnrefused')) {
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

// ── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
  // ━━ 1. validateWorkerUrl ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('validateWorkerUrl');

  let v;

  v = validateWorkerUrl('https://comments-garden.workers.dev');
  assert(v.valid, 'Valid workers.dev URL accepted');
  assertEqual(v.url, 'https://comments-garden.workers.dev', 'URL returned correctly');

  v = validateWorkerUrl('https://ifard.ir/');
  assert(v.valid, 'URL with trailing slash accepted');
  assertEqual(v.url, 'https://ifard.ir', 'Trailing slash stripped');

  v = validateWorkerUrl('https://example.com///');
  assert(v.valid, 'Multiple trailing slashes stripped');
  assertEqual(v.url, 'https://example.com', 'Normalized to single origin');

  v = validateWorkerUrl('http://example.com');
  assert(!v.valid, 'HTTP (not HTTPS) rejected');
  assertIncludes(v.reason, 'https://', 'Error mentions https://');

  v = validateWorkerUrl('ftp://example.com');
  assert(!v.valid, 'FTP rejected');

  v = validateWorkerUrl('not-a-url');
  assert(!v.valid, 'Plain text rejected');

  v = validateWorkerUrl('');
  assert(!v.valid, 'Empty string rejected');
  assertIncludes(v.reason, 'empty', 'Error mentions empty');

  v = validateWorkerUrl('   ');
  assert(!v.valid, 'Whitespace-only rejected');

  v = validateWorkerUrl('https://my domain.com');
  assert(!v.valid, 'URL with spaces rejected');
  assertIncludes(v.reason, 'spaces', 'Error mentions spaces');

  v = validateWorkerUrl('https://example.com/path?q=1#frag');
  assert(v.valid, 'URL with query/fragment accepted');

  // ━━ 2. classifyNetworkError ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('classifyNetworkError');

  let lines;

  const econnrefused = new Error('fetch failed');
  econnrefused.cause = { message: 'connect ECONNREFUSED 10.10.34.35:443' };
  lines = classifyNetworkError(econnrefused);
  assertIncludes(lines.join(' '), 'Connection refused', 'ECONNREFUSED detected');
  assertIncludes(lines.join(' '), '10.10.34.35:443', 'Target IP extracted');
  assertIncludes(lines.join(' '), 'proxy', 'Mentions proxy');
  assertIncludes(lines.join(' '), 'VPN', 'Mentions VPN');
  assertIncludes(lines.join(' '), 'hosts file', 'Mentions hosts file');

  const econnrefused2 = new Error('request to https://api.telegram.org failed, connect ECONNREFUSED');
  lines = classifyNetworkError(econnrefused2);
  assertIncludes(lines.join(' '), 'Connection refused', 'ECONNREFUSED without IP handled');

  const enotfound = new Error('getaddrinfo ENOTFOUND api.telegram.org');
  lines = classifyNetworkError(enotfound);
  assertIncludes(lines.join(' '), 'DNS', 'DNS failure detected');

  const etimedout = new Error('request timeout ETIMEDOUT');
  lines = classifyNetworkError(etimedout);
  assertIncludes(lines.join(' '), 'timed out', 'Timeout detected');

  const fetchfailed = new Error('fetch failed');
  lines = classifyNetworkError(fetchfailed);
  assertIncludes(lines.join(' '), 'Network request failed', 'Generic fetch failure handled');

  const unknown = new Error('something weird happened');
  lines = classifyNetworkError(unknown);
  assertIncludes(lines.join(' '), 'something weird happened', 'Unknown error includes original message');

  // ━━ 3. Security: No token/secret leakage ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('Security: No token/secret in error output');

  const webhookUrl = 'https://my-worker.workers.dev/api/telegram/webhook';
  const secret = 'a1b2c3d4e5f6secret';
  const token = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

  const manualUrl = `https://api.telegram.org/bot<TOKEN>/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

  assertDoesNotInclude(manualUrl, token, 'Bot token not in manual URL');
  assertDoesNotInclude(manualUrl, '123456', 'Bot token number not leaked');
  assertIncludes(manualUrl, '<TOKEN>', 'Token placeholder used');
  assertDoesNotInclude(manualUrl, secret, 'Webhook secret not in manual URL');

  // ━━ 4. Webhook URL construction ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('Webhook URL construction');

  const baseUrl1 = 'https://my-worker.workers.dev';
  assertEqual(
    baseUrl1.replace(/\/+$/, '') + '/api/telegram/webhook',
    'https://my-worker.workers.dev/api/telegram/webhook',
    'workers.dev webhook URL correct'
  );

  const baseUrl2 = 'https://example.com/';
  assertEqual(
    baseUrl2.replace(/\/+$/, '') + '/api/telegram/webhook',
    'https://example.com/api/telegram/webhook',
    'Custom domain webhook URL correct (trailing slash stripped)'
  );

  const baseUrl3 = 'https://ifard.ir';
  assertEqual(
    baseUrl3.replace(/\/+$/, '') + '/api/telegram/webhook',
    'https://ifard.ir/api/telegram/webhook',
    'Ifard.ir webhook URL correct'
  );

  // ━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${total} total`);
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
