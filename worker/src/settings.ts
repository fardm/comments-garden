export class SettingsService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async getAllSettings() {
    const { results } = await this.db.prepare('SELECT key, value FROM settings').all()
    const config: Record<string, string> = {}
    for (const r of results) {
      config[r.key as string] = r.value as string
    }
    return config
  }

  async saveSettings(settings: Record<string, any>) {
    // Cloudflare D1 batching
    // These settings must only be written through AuthService methods
    const protectedKeys = new Set(['admin_password_hash', 'admin_token'])

    const stmts = []
    for (const [key, value] of Object.entries(settings)) {
      if (protectedKeys.has(key)) continue
      const val = typeof value === 'object' ? JSON.stringify(value) : String(value)
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, val))
    }

    if (stmts.length > 0) {
       await this.db.batch(stmts)
    }

    return { success: true }
  }
}
