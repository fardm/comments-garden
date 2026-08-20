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
   * Never throws — errors are silently logged.
   */
  async sendMessage(
    botToken: string,
    chatId: string,
    text: string,
  ): Promise<boolean> {
    if (!botToken || !chatId) return false;

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`[Telegram] API error ${response.status}: ${errorBody}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Telegram] Failed to send message:', error);
      return false;
    }
  }

  /**
   * Send a new comment notification.
   */  async sendCommentNotification(
    botToken: string,
    chatId: string,
    postTitle: string,
    authorName: string,
    content: string,
  ): Promise<boolean> {
    const message =
      `🔗 ${postTitle}\n` +
      `👤 ${authorName}\n` +
      `\n` +
      `\n` +
      `💬 ${content}`;
    return this.sendMessage(botToken, chatId, message);
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
