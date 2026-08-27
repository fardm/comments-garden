export interface TelegramSettings {
  telegram_enabled: string;
  telegram_chat_id: string;
}

export class TelegramService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Get telegram settings from D1. Missing keys default to disabled/empty.
   */
  async getSettings(): Promise<TelegramSettings> {
    const { results } = await this.db.prepare(
      `SELECT key, value FROM settings WHERE key IN ('telegram_enabled', 'telegram_chat_id')`
    ).all();
    const map: Record<string, string> = {};
    for (const r of results) map[r.key as string] = r.value as string;
    return {
      telegram_enabled: map.telegram_enabled || 'false',
      telegram_chat_id: map.telegram_chat_id || '',
    };
  }

  /**
   * Save telegram settings to D1.
   */
  async saveSettings(settings: Partial<TelegramSettings>): Promise<void> {
    const stmts = [];
    for (const [key, value] of Object.entries(settings)) {
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, String(value)));
    }
    if (stmts.length > 0) await this.db.batch(stmts);
  }

  /**
   * Check whether Telegram notifications are enabled AND configured.
   */
  async isEnabled(botToken: string | undefined): Promise<boolean> {
    if (!botToken) return false;
    const settings = await this.getSettings();
    return settings.telegram_enabled === 'true' && settings.telegram_chat_id !== '';
  }

  /**
   * Send a Telegram message to the configured chat.
   * Retries up to {@link TelegramService.MAX_RETRIES} times with exponential
   * back-off on transient failures (network errors, 5xx, 429 rate-limit).
   * Client errors (4xx except 429) fail immediately.
   * Never throws — errors are silently logged.
   */
  private static MAX_RETRIES = 3;
  private static BASE_DELAY_MS = 500;

  async sendMessage(
    botToken: string,
    chatId: string,
    text: string,
    replyMarkup?: object,
  ): Promise<boolean> {
    if (!botToken || !chatId) return false;

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    for (let attempt = 0; attempt <= TelegramService.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );

        if (response.ok) return true;

        // Don't retry client errors except 429 (rate-limited)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const errorBody = await response.text().catch(() => '');
          console.error(`[Telegram] API error ${response.status} (not retrying): ${errorBody}`);
          return false;
        }

        // 5xx or 429 — retryable
        const errorBody = await response.text().catch(() => '');
        console.warn(`[Telegram] Retryable error ${response.status} (attempt ${attempt + 1}/${TelegramService.MAX_RETRIES + 1}): ${errorBody}`);
      } catch (error) {
        // Network error — retryable
        console.warn(`[Telegram] Network error (attempt ${attempt + 1}/${TelegramService.MAX_RETRIES + 1}):`, error);
      }

      // Back-off before next attempt (skip delay on last iteration)
      if (attempt < TelegramService.MAX_RETRIES) {
        const delay = TelegramService.BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.error(`[Telegram] Failed after ${TelegramService.MAX_RETRIES + 1} attempts`);
    return false;
  }

  /**
   * Extract the last path segment (slug) from a URL or path string.
   */
  static extractSlug(input: string): string {
    if (!input) return '';
    try {
      const u = new URL(input);
      return u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || u.hostname;
    } catch {
      return input.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || input;
    }
  }

  /**
   * Build the clickable link header line for a comment notification.
   * Format: 🔗 <a href="url">slug</a>
   */
  static buildLinkHeader(pageUrl: string): string {
    const slug = TelegramService.extractSlug(pageUrl);
    const escapedSlug = slug.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `🔗 <a href="${pageUrl}">${escapedSlug}</a>`;
  }

  /**
   * Send a new comment notification with moderation action buttons.
   */
  async sendCommentNotificationWithActions(
    botToken: string,
    chatId: string,
    commentId: number,
    postTitle: string,
    authorName: string,
    content: string,
    adminPanelUrl: string,
  ): Promise<boolean> {
    const escapedContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const header = TelegramService.buildLinkHeader(postTitle);
    // \u200B = zero-width space marker used to separate original text from status
    const message =
      `${header}\n` +
      `${escapedContent}` +
      `\u200B\n\n<i>Status: ⏳ Pending</i>`;

    // New comments are always pending — use buildModerationKeyboard for consistency
    const reply_markup = TelegramService.buildModerationKeyboard(commentId, 'pending', adminPanelUrl);

    return this.sendMessage(botToken, chatId, message, reply_markup);
  }

  /**
   * Send a new comment notification (without action buttons).
   */
  async sendCommentNotification(
    botToken: string,
    chatId: string,
    postTitle: string,
    authorName: string,
    content: string,
  ): Promise<boolean> {
    const escapedContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const header = TelegramService.buildLinkHeader(postTitle);
    const message =
      `${header}\n` +
      `${escapedContent}`;
    return this.sendMessage(botToken, chatId, message);
  }

  /**
   * Edit a previously sent message (e.g. to show action result).
   */
  async editMessageText(
    botToken: string,
    chatId: string,
    messageId: number,
    text: string,
    replyMarkup?: object,
  ): Promise<boolean> {
    if (!botToken) return false;
    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      };
      if (replyMarkup) body.reply_markup = replyMarkup;
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/editMessageText`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      return response.ok;
    } catch (e) {
      console.error('[Telegram] editMessageText failed:', e);
      return false;
    }
  }

  /**
   * Build an inline keyboard with valid moderation actions for a comment's current status.
   *
   * Status transition map:
   *   pending  → approve, delete, spam
   *   approved → delete, spam
   *   deleted  → restore
   *   spam     → approve, delete
   */
  static buildModerationKeyboard(
    commentId: number,
    currentStatus: string,
    adminPanelUrl: string,
  ): object {
    const buttons: Array<{ text: string; callback_data: string }> = [];

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

  /**
   * Build a keyboard for when the comment no longer exists in the database.
   * Shows only the Admin Panel link — no action buttons.
   */
  static buildNotFoundKeyboard(adminPanelUrl: string): object {
    return {
      inline_keyboard: [
        [{ text: '⚙️Admin Panel', url: adminPanelUrl }],
      ],
    };
  }

  /**
   * Answer a callback query to dismiss the loading indicator.
   */
  async answerCallbackQuery(
    botToken: string,
    callbackQueryId: string,
    text?: string,
  ): Promise<boolean> {
    if (!botToken) return false;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQueryId,
            text: text || '',
          }),
        },
      );
      return response.ok;
    } catch (e) {
      console.error('[Telegram] answerCallbackQuery failed:', e);
      return false;
    }
  }

  /**
   * Send a test notification to verify the integration is working.
   */
  async sendTestNotification(
    botToken: string,
    chatId: string,
  ): Promise<boolean> {
    const message =
      '✅ <b>Telegram integration test</b>\n\n' +
      'Your Telegram notifications are working correctly!\n\n' +
      'You will receive notifications for new comments here.';

    return this.sendMessage(botToken, chatId, message);
  }

  /**
   * Validate a bot token format and make an API call to verify it works.
   */
  async validateBotToken(botToken: string): Promise<{ ok: boolean; error?: string }> {
    if (!botToken || !botToken.includes(':')) {
      return { ok: false, error: 'Invalid bot token format' };
    }
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getMe`,
      );
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[Telegram] Token validation failed ${response.status}: ${body}`);
        return { ok: false, error: 'Bot token is invalid' };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Failed to connect to Telegram API' };
    }
  }
}
