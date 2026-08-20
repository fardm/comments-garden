export class SpamService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async checkSpam(content: string, authorName: string, authorEmail: string, authorUrl: string, ip: string, userAgent: string): Promise<boolean> {
    // 1. Basic honey pot check
    // If the frontend sent something hidden, it should be blocked, but here we just check DB rules

    // 2. Check if IP is blacklisted (placeholder, simple implementation)
    // 3. Keyword check
    const spamKeywords = ['viagra', 'casino', 'lottery']
    const textToCheck = `${content} ${authorName} ${authorEmail} ${authorUrl}`.toLowerCase()

    for (const keyword of spamKeywords) {
      if (textToCheck.includes(keyword)) {
        return true
      }
    }

    return false
  }
}
