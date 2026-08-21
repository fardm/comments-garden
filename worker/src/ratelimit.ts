export class RateLimitService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async isCommentRateLimited(ip: string): Promise<boolean> {
    const result = await this.db.prepare(`
      SELECT COUNT(*) as count FROM comments
      WHERE ip_address = ? AND created_at > datetime('now', '-5 minutes')
    `).bind(ip).first<{count: number}>()
    return (result?.count ?? 0) >= 3
  }

  async isVoteRateLimited(ip: string): Promise<boolean> {
    const result = await this.db.prepare(`
      SELECT COUNT(*) as count FROM reaction_rate_log
      WHERE ip_address = ? AND created_at > datetime('now', '-1 minute')
    `).bind(ip).first<{count: number}>()

    if ((result?.count ?? 0) >= 10) {
       return true
    }

    await this.db.prepare('INSERT INTO reaction_rate_log (ip_address) VALUES (?)').bind(ip).run()
    return false
  }

  async cleanupOldLogs(): Promise<void> {
    await this.db.prepare(`DELETE FROM reaction_rate_log WHERE created_at < datetime('now', '-72 hours')`).run()
  }
}
