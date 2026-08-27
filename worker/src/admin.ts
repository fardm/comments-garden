export class AdminService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async getAnalytics() {
    const totalComments = await this.db.prepare('SELECT COUNT(*) as count FROM comments').first<{count: number}>()
    const pendingComments = await this.db.prepare("SELECT COUNT(*) as count FROM comments WHERE status = 'pending'").first<{count: number}>()
    const spamComments = await this.db.prepare("SELECT COUNT(*) as count FROM comments WHERE status = 'spam'").first<{count: number}>()
    const approvedComments = await this.db.prepare("SELECT COUNT(*) as count FROM comments WHERE status = 'approved'").first<{count: number}>()

    // Build timeline buckets from daily status breakdown
    const { results: dailyRows } = await this.db.prepare(
      `SELECT date(created_at) as period, status, COUNT(*) as count
       FROM comments
       GROUP BY date(created_at), status
       ORDER BY period ASC`
    ).all<{ period: string; status: string; count: number }>()

    // Aggregate daily rows into { period, total, approved, pending, spam } buckets
    const dailyMap = new Map<string, { total: number; approved: number; pending: number; spam: number }>()
    for (const row of dailyRows) {
      if (!dailyMap.has(row.period)) {
        dailyMap.set(row.period, { total: 0, approved: 0, pending: 0, spam: 0 })
      }
      const bucket = dailyMap.get(row.period)!
      bucket.total += row.count
      if (row.status === 'approved') bucket.approved += row.count
      else if (row.status === 'pending') bucket.pending += row.count
      else if (row.status === 'spam') bucket.spam += row.count
    }
    const dailyBuckets = Array.from(dailyMap.entries()).map(([period, counts]) => ({ period, ...counts }))

    // Aggregate daily into weekly (ISO week: YYYY-Www)
    const weeklyMap = new Map<string, { total: number; approved: number; pending: number; spam: number }>()
    for (const b of dailyBuckets) {
      // Compute ISO week key from period date string (YYYY-MM-DD)
      const [y, m, d] = b.period.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      const jan1 = new Date(y, 0, 1)
      const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000) + 1
      const jan1Day = jan1.getDay() || 7 // Monday=1..Sunday=7
      const weekNum = Math.ceil((dayOfYear + jan1Day - 1) / 7)
      const weekKey = `${y}-W${String(weekNum).padStart(2, '0')}`
      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, { total: 0, approved: 0, pending: 0, spam: 0 })
      }
      const wk = weeklyMap.get(weekKey)!
      wk.total += b.total; wk.approved += b.approved; wk.pending += b.pending; wk.spam += b.spam
    }
    const weeklyBuckets = Array.from(weeklyMap.entries()).map(([period, counts]) => ({ period, ...counts }))

    // Aggregate daily into monthly (YYYY-MM)
    const monthlyMap = new Map<string, { total: number; approved: number; pending: number; spam: number }>()
    for (const b of dailyBuckets) {
      const monthKey = b.period.substring(0, 7) // YYYY-MM
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { total: 0, approved: 0, pending: 0, spam: 0 })
      }
      const mk = monthlyMap.get(monthKey)!
      mk.total += b.total; mk.approved += b.approved; mk.pending += b.pending; mk.spam += b.spam
    }
    const monthlyBuckets = Array.from(monthlyMap.entries()).map(([period, counts]) => ({ period, ...counts }))

    // Build top posts
    const { results: postRows } = await this.db.prepare(
      `SELECT page_url, status, COUNT(*) as count
       FROM comments
       GROUP BY page_url, status`
    ).all<{ page_url: string; status: string; count: number }>()

    const postsMap = new Map<string, { total: number; approved: number; pending: number; spam: number }>()
    for (const row of postRows) {
      if (!postsMap.has(row.page_url)) {
        postsMap.set(row.page_url, { total: 0, approved: 0, pending: 0, spam: 0 })
      }
      const p = postsMap.get(row.page_url)!
      p.total += row.count
      if (row.status === 'approved') p.approved += row.count
      else if (row.status === 'pending') p.pending += row.count
      else if (row.status === 'spam') p.spam += row.count
    }
    const topPosts = Array.from(postsMap.entries())
      .map(([page_url, counts]) => ({ page_url, ...counts }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    return {
      total_comments: totalComments?.count || 0,
      pending_comments: pendingComments?.count || 0,
      spam_comments: spamComments?.count || 0,
      status_totals: {
        pending: pendingComments?.count || 0,
        spam: spamComments?.count || 0,
        approved: approvedComments?.count || 0,
        deleted: 0
      },
      timeline: {
        daily: dailyBuckets,
        weekly: weeklyBuckets,
        monthly: monthlyBuckets
      },
      top_posts: topPosts
    }
  }

  async getDbStats() {
    const counts = await this.getAnalytics()

    // Get actual counts for each table
    const postReactionsCount = await this.db.prepare('SELECT COUNT(*) as count FROM post_reactions').first<{count: number}>()
    const commentReactionsCount = await this.db.prepare('SELECT COUNT(*) as count FROM comment_reactions').first<{count: number}>()

    return {
      counts,
      tables: {
        comments: counts.total_comments,
        post_reactions: postReactionsCount?.count || 0,
        comment_reactions: commentReactionsCount?.count || 0
      }
    }
  }
}
