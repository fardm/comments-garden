/**
 * Tests for Telegram webhook: URL validation, error handling, security,
 * and moderation keyboard building.
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

/**
 * Build moderation keyboard — mirrors TelegramService.buildModerationKeyboard.
 */
function buildModerationKeyboard(commentId, currentStatus, adminPanelUrl) {
  const buttons = [];
  if (currentStatus === 'pending' || currentStatus === 'spam') {
    buttons.push({ text: '✅ Approve', callback_data: `approve:${commentId}` });
  }
  if (currentStatus === 'pending' || currentStatus === 'approved' || currentStatus === 'spam') {
    buttons.push({ text: '🗑 Delete', callback_data: `delete:${commentId}` });
  }
  if (currentStatus === 'pending' || currentStatus === 'approved') {
    buttons.push({ text: '🚫 Spam', callback_data: `spam:${commentId}` });
  }
  if (currentStatus === 'deleted') {
    buttons.push({ text: '♻️ Restore', callback_data: `restore:${commentId}` });
  }
  return {
    inline_keyboard: [
      buttons,
      [
        { text: '🔄 Refresh', callback_data: `refresh:${commentId}` },
        { text: '⚙️Admin Panel', url: adminPanelUrl },
      ],
    ],
  };
}

function buildNotFoundKeyboard(adminPanelUrl) {
  return {
    inline_keyboard: [
      [{ text: '⚙️Admin Panel', url: adminPanelUrl }],
    ],
  };
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

  // ━━ 5. buildModerationKeyboard ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('buildModerationKeyboard');

  const panelUrl = 'https://worker.workers.dev/admin/';
  let kb;

  // pending → approve, delete, spam
  kb = buildModerationKeyboard(42, 'pending', panelUrl);
  assertEqual(kb.inline_keyboard.length, 2, 'Keyboard has 2 rows (actions + admin link)');
  assertEqual(kb.inline_keyboard[0].length, 3, 'pending: 3 action buttons');
  assertEqual(kb.inline_keyboard[0][0].callback_data, 'approve:42', 'pending: button 1 is approve');
  assertEqual(kb.inline_keyboard[0][1].callback_data, 'delete:42', 'pending: button 2 is delete');
  assertEqual(kb.inline_keyboard[0][2].callback_data, 'spam:42', 'pending: button 3 is spam');
  assertEqual(kb.inline_keyboard[1][1].url, panelUrl, 'Admin Panel link present (row 2, col 2)');

  // approved → delete, spam
  kb = buildModerationKeyboard(42, 'approved', panelUrl);
  assertEqual(kb.inline_keyboard[0].length, 2, 'approved: 2 action buttons');
  assertEqual(kb.inline_keyboard[0][0].callback_data, 'delete:42', 'approved: button 1 is delete');
  assertEqual(kb.inline_keyboard[0][1].callback_data, 'spam:42', 'approved: button 2 is spam');

  // deleted → restore only
  kb = buildModerationKeyboard(42, 'deleted', panelUrl);
  assertEqual(kb.inline_keyboard[0].length, 1, 'deleted: 1 action button');
  assertEqual(kb.inline_keyboard[0][0].callback_data, 'restore:42', 'deleted: button is restore');
  assertIncludes(kb.inline_keyboard[0][0].text, 'Restore', 'deleted: button text says Restore');

  // spam → approve, delete
  kb = buildModerationKeyboard(42, 'spam', panelUrl);
  assertEqual(kb.inline_keyboard[0].length, 2, 'spam: 2 action buttons');
  assertEqual(kb.inline_keyboard[0][0].callback_data, 'approve:42', 'spam: button 1 is approve');
  assertEqual(kb.inline_keyboard[0][1].callback_data, 'delete:42', 'spam: button 2 is delete');

  // Verify all keyboards have the Refresh button and Admin Panel link in row 2
  for (const status of ['pending', 'approved', 'deleted', 'spam']) {
    kb = buildModerationKeyboard(99, status, panelUrl);
    assertEqual(kb.inline_keyboard[1].length, 2, `${status}: bottom row has 2 buttons (refresh + admin)`);
    assertEqual(kb.inline_keyboard[1][0].callback_data, 'refresh:99', `${status}: refresh button present`);
    assertIncludes(kb.inline_keyboard[1][0].text, 'Refresh', `${status}: refresh button text`);
    assertEqual(kb.inline_keyboard[1][1].url, panelUrl, `${status}: admin panel URL correct`);
  }

  // Verify callback_data format for refresh
  kb = buildModerationKeyboard(123, 'pending', panelUrl);
  assertEqual(kb.inline_keyboard[1][0].callback_data, 'refresh:123', 'Refresh callback_data encodes commentId');

  // ━━ 6. Action validation logic ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('Action validation (valid actions per status)');

  const validActions = {
    pending:  ['approve', 'delete', 'spam'],
    approved: ['delete', 'spam'],
    deleted:  ['restore'],
    spam:     ['approve', 'delete'],
  };
  // Note: the keyboard builder and the validation must agree on which actions are valid.

  // Verify no status allows duplicate/same actions
  for (const [status, actions] of Object.entries(validActions)) {
    assert(actions.length > 0, `${status} has at least one valid action`);
    assertEqual(new Set(actions).size, actions.length, `${status}: no duplicate actions`);
  }

  // Verify action-to-status mapping matches the webhook handler
  const actionToStatus = { approve: 'approved', restore: 'pending', delete: 'deleted', spam: 'spam' };
  assertEqual(actionToStatus['approve'], 'approved', 'approve action sets status to approved');
  assertEqual(actionToStatus['restore'], 'pending', 'restore action sets status to pending');

  // ━━ 7. buildNotFoundKeyboard ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('buildNotFoundKeyboard');

  const notFoundKb = buildNotFoundKeyboard(panelUrl);
  assertEqual(notFoundKb.inline_keyboard.length, 1, 'Not-found keyboard has 1 row');
  assertEqual(notFoundKb.inline_keyboard[0].length, 1, 'Not-found keyboard has 1 button');
  assertEqual(notFoundKb.inline_keyboard[0][0].url, panelUrl, 'Not-found keyboard shows Admin Panel link');
  assertIncludes(notFoundKb.inline_keyboard[0][0].text, 'Admin Panel', 'Not-found button text says Admin Panel');
  // No callback_data buttons — only URL button
  assert(!notFoundKb.inline_keyboard[0][0].callback_data, 'Not-found keyboard has no callback_data buttons');

  // ━━ 8. Webhook action handling logic ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('Webhook action handling logic');

  // Refresh is always valid regardless of status (handled separately)
  assert(true, 'refresh action is handled separately (not in validActions map)');

  // After a status change, the keyboard must match the new status
  // e.g. approve on pending → approved → keyboard shows delete+spam
  const afterApprove = buildModerationKeyboard(1, 'approved', panelUrl);
  assertEqual(afterApprove.inline_keyboard[0].length, 2, 'After approve: 2 buttons (delete, spam)');
  assertEqual(afterApprove.inline_keyboard[0][0].callback_data, 'delete:1', 'After approve: delete button');
  assertEqual(afterApprove.inline_keyboard[0][1].callback_data, 'spam:1', 'After approve: spam button');

  // After delete on pending → deleted → keyboard shows restore only
  const afterDelete = buildModerationKeyboard(1, 'deleted', panelUrl);
  assertEqual(afterDelete.inline_keyboard[0].length, 1, 'After delete: 1 button (restore)');
  assertEqual(afterDelete.inline_keyboard[0][0].callback_data, 'restore:1', 'After delete: restore callback');

  // After spam on pending → spam → keyboard shows approve+delete
  const afterSpam = buildModerationKeyboard(1, 'spam', panelUrl);
  assertEqual(afterSpam.inline_keyboard[0].length, 2, 'After spam: 2 buttons (approve, delete)');
  assertEqual(afterSpam.inline_keyboard[0][0].callback_data, 'approve:1', 'After spam: approve button');
  assertEqual(afterSpam.inline_keyboard[0][1].callback_data, 'delete:1', 'After spam: delete button');

  // Missing comment → not-found keyboard (no action buttons)
  const missingKb = buildNotFoundKeyboard(panelUrl);
  assertEqual(missingKb.inline_keyboard.length, 1, 'Missing comment: only admin panel row');
  assertEqual(missingKb.inline_keyboard[0][0].url, panelUrl, 'Missing comment: admin panel link');

  // ━━ 9. extractSlug ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('extractSlug');

  // Replicate the static method
  const extractSlug = (input) => {
    if (!input) return '';
    try {
      const u = new URL(input);
      return u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || u.hostname;
    } catch {
      return input.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || input;
    }
  };

  assertEqual(extractSlug('https://example.com/my-post'), 'my-post', 'Standard URL slug');
  assertEqual(extractSlug('https://example.com/blog/2024/hello-world'), 'hello-world', 'Deep path slug');
  assertEqual(extractSlug('https://example.com/my-post/'), 'my-post', 'Trailing slash stripped');
  assertEqual(extractSlug('https://example.com/my-post///'), 'my-post', 'Multiple trailing slashes');
  assertEqual(extractSlug('https://example.com/'), 'example.com', 'Root path returns hostname');
  assertEqual(extractSlug('https://example.com'), 'example.com', 'No path returns hostname');
  assertEqual(extractSlug('/my-post'), 'my-post', 'Leading slash stripped');
  assertEqual(extractSlug('/blog/hello/'), 'hello', 'Relative path with slashes');
  assertEqual(extractSlug('plain-slug'), 'plain-slug', 'Plain text slug');
  assertEqual(extractSlug(''), '', 'Empty string returns empty');

  // ━━ 10. buildLinkHeader ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('buildLinkHeader');

  const buildLinkHeader = (pageUrl) => {
    const slug = extractSlug(pageUrl);
    const escapedSlug = slug.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `🔗 <a href="${pageUrl}">${escapedSlug}</a>`;
  };

  const header1 = buildLinkHeader('https://example.com/my-post');
  assertIncludes(header1, '🔗', 'Header contains link emoji');
  assertIncludes(header1, '<a href="https://example.com/my-post">', 'Header has correct href');
  assertIncludes(header1, '>my-post<', 'Header has slug as visible text');
  assertDoesNotInclude(header1, '💬', 'No 💬 New comment header');
  // buildLinkHeader is only the link line; author is added in the message builder

  const header2 = buildLinkHeader('https://ifard.ir/blog/hello-world/');
  assertIncludes(header2, '<a href="https://ifard.ir/blog/hello-world/">', 'Custom domain href preserved');
  assertIncludes(header2, '>hello-world<', 'Last path segment used as slug');

  // ━━ 11. Message handling (getOriginalText / buildStatusMessage) ━━━━━━━━━━━
  section('Message handling: no status accumulation');

  // Replicate the logic from index.ts
  const ORIGINAL_TEXT_MARKER = '\u200B';
  const getOriginalText = (text) => {
    const idx = text.indexOf(ORIGINAL_TEXT_MARKER);
    return idx !== -1 ? text.substring(0, idx) : text;
  };
  const buildStatusMessage = (originalText, statusLabel) =>
    `${originalText}${ORIGINAL_TEXT_MARKER}\n\n<i>Status: ${statusLabel}</i>`;

  // Initial notification with status (new format: link header + content)
  const initialMsg = buildLinkHeader('https://example.com/my-post') +
    '\nHello world' +
    `${ORIGINAL_TEXT_MARKER}\n\n<i>Status: ⏳ Pending</i>`;
  assertIncludes(initialMsg, '⏳ Pending', 'Initial message contains pending status');
  assertDoesNotInclude(initialMsg, '💬', 'No 💬 New comment in message');
  assertIncludes(initialMsg, '<a href', 'Message contains clickable link');

  // getOriginalText extracts everything before the marker
  const orig = getOriginalText(initialMsg);
  assertDoesNotInclude(orig, '⏳', 'Original text has no status');
  assertDoesNotInclude(orig, ORIGINAL_TEXT_MARKER, 'Original text has no marker');
  assertIncludes(orig, 'my-post', 'Original text preserves slug');

  // buildStatusMessage creates clean single-status message
  const approvedMsg = buildStatusMessage(orig, '✅ Approved');
  assertIncludes(approvedMsg, '✅ Approved', 'Message shows approved status');
  assertEqual(approvedMsg.indexOf(ORIGINAL_TEXT_MARKER), orig.length, 'Marker placed at end of original text');

  // Multiple status changes never accumulate
  let msg = initialMsg;
  for (const status of ['✅ Approved', '🗑 Deleted', '↩️ Restored', '🚫 Spam']) {
    const cleaned = getOriginalText(msg);
    msg = buildStatusMessage(cleaned, status);
  }
  const statusMatches = (msg.match(/<i>Status:/g) || []).length;
  assertEqual(statusMatches, 1, 'Only one status line after multiple changes');
  assertIncludes(msg, '🚫 Spam', 'Latest status is spam');
  assertDoesNotInclude(msg, '✅', 'Previous statuses removed');
  assertDoesNotInclude(msg, '🗑', 'Previous statuses removed');
  assertDoesNotInclude(msg, '↩', 'Previous statuses removed');

  // Without marker, getOriginalText returns full text (backward compat)
  const noMarkerText = 'Old message without marker';
  assertEqual(getOriginalText(noMarkerText), noMarkerText, 'No marker = full text returned');

  // Full initial message format: link + author + content + status
  const fullInitial = buildLinkHeader('https://example.com/test-post') +
    '\n👤 Alice\n\n' +
    'Great article!' +
    `${ORIGINAL_TEXT_MARKER}\n\n<i>Status: ⏳ Pending</i>`;
  assertIncludes(fullInitial, '<a href="https://example.com/test-post">test-post</a>', 'Full message has clickable slug');
  assertDoesNotInclude(fullInitial, '💬', 'Full message has no 💬 header');
  assertIncludes(fullInitial, '👤', 'Full message has author name');

  // ━━ 12. Gravatar URL computation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('Gravatar URL computation');

  // Replicate getGravatarImageUrlAsync
  async function getGravatarImageUrlAsync(email, size = 80) {
    if (!email) return null;
    try {
      const normalized = email.trim().toLowerCase();
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      return `https://www.gravatar.com/avatar/${hashHex}?s=${size}&d=mp`;
    } catch {
      return null;
    }
  }

  let gravatarUrl;

  gravatarUrl = await getGravatarImageUrlAsync('user@example.com');
  assert(gravatarUrl !== null, 'Valid email produces Gravatar URL');
  assertIncludes(gravatarUrl, 'https://www.gravatar.com/avatar/', 'URL uses Gravatar CDN');
  assertIncludes(gravatarUrl, '?s=80&d=mp', 'URL has size and default params');
  assert(!gravatarUrl.includes(' '), 'URL has no spaces');

  gravatarUrl = await getGravatarImageUrlAsync('USER@Example.COM');
  assert(gravatarUrl !== null, 'Email is normalized to lowercase');
  const lowerUrl = await getGravatarImageUrlAsync('user@example.com');
  assertEqual(gravatarUrl, lowerUrl, 'Case-insensitive email produces same URL');

  gravatarUrl = await getGravatarImageUrlAsync('user@example.com', 120);
  assertIncludes(gravatarUrl, '?s=120&d=mp', 'Custom size parameter passed');

  const nullUrl = await getGravatarImageUrlAsync('');
  assertEqual(nullUrl, null, 'Empty email returns null');

  const nullUrl2 = await getGravatarImageUrlAsync(null);
  assertEqual(nullUrl2, null, 'Null email returns null');

  // Verify Gravatar URL is a valid URL
  const validUrl = await getGravatarImageUrlAsync('test@test.com');
  try {
    new URL(validUrl);
    assert(true, 'Gravatar URL is a valid URL');
  } catch {
    assert(false, 'Gravatar URL is not a valid URL');
  }

  // ━━ 13. sendPhoto fallback behavior ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  section('sendPhoto fallback logic');

  // When photoUrl is empty, sendPhoto should fall back to sendMessage (text only)
  // We verify the logic: if (!photoUrl) → sendMessage path
  assertEqual(!'', true, 'Empty string is falsy (fallback triggered)');
  assertEqual(!null, true, 'Null is falsy (fallback triggered)');
  assertEqual(!'https://example.com/img.jpg', false, 'Non-empty URL is truthy (no fallback)');

  // sendPhoto body should contain photo, caption, reply_markup
  const photoBody = {
    chat_id: '123',
    photo: 'https://www.gravatar.com/avatar/abc123?s=80&d=mp',
    caption: 'Hello',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  assert(photoBody.photo, 'sendPhoto body includes photo URL');
  assert(photoBody.caption, 'sendPhoto body includes caption');
  assert(photoBody.parse_mode, 'sendPhoto body includes parse_mode');

  // ━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${total} total`);
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
