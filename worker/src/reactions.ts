export class ReactionService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async toggleVote(commentId: number, ip: string, reactionType: string) {
    let voted = true;
    try {
      await this.db.prepare('INSERT INTO votes (comment_id, ip_address, reaction_type) VALUES (?, ?, ?)').bind(commentId, ip, reactionType).run()
    } catch (e) {
      // SQLite UNIQUE constraint violation
      await this.db.prepare('DELETE FROM votes WHERE comment_id = ? AND ip_address = ? AND reaction_type = ?').bind(commentId, ip, reactionType).run()
      voted = false;
    }

    // Get updated counts for this comment
    const { results } = await this.db.prepare('SELECT reaction_type, COUNT(*) as count FROM votes WHERE comment_id = ? GROUP BY reaction_type').bind(commentId).all()
    const counts: Record<string, number> = {}
    for (const r of results) {
      counts[r.reaction_type as string] = r.count as number
    }

    return { success: true, voted, counts }
  }

  async togglePostReaction(url: string, ip: string, reactionType: string) {
    let voted = true;
    try {
      await this.db.prepare('INSERT INTO post_reactions (page_url, ip_address, reaction_type) VALUES (?, ?, ?)').bind(url, ip, reactionType).run()
    } catch (e) {
      await this.db.prepare('DELETE FROM post_reactions WHERE page_url = ? AND ip_address = ? AND reaction_type = ?').bind(url, ip, reactionType).run()
      voted = false;
    }

    // Get updated counts for this post
    const summary = await this.getPostReactionsSummary(url, ip)
    const counts: Record<string, number> = {}
    for (const key in summary) {
        counts[key] = summary[key].count
    }

    return { success: true, voted, counts }
  }

  async getPostReactionsSummary(url: string, ip: string) {
    const { results } = await this.db.prepare('SELECT reaction_type, COUNT(*) as count FROM post_reactions WHERE page_url = ? GROUP BY reaction_type').bind(url).all()

    const userReacts = await this.db.prepare('SELECT reaction_type FROM post_reactions WHERE page_url = ? AND ip_address = ?').bind(url, ip).all()
    const userVoted = new Set(userReacts.results.map((r: any) => r.reaction_type))

    const summary: Record<string, {count: number, voted: boolean}> = {}
    for (const r of results) {
      const reactionType = r.reaction_type as string
      summary[reactionType] = {
        count: r.count as number,
        voted: userVoted.has(reactionType)
      }
    }

    return summary
  }

  async getGlobalPostReactionsSummary() {
    // Group by page_url, then reaction_type
    const { results } = await this.db.prepare('SELECT page_url, reaction_type, COUNT(*) as count FROM post_reactions GROUP BY page_url, reaction_type').all()

    // Admin dashboard expects { pages: [{ page_url, reactions: { type: count } }], total: N }
    const pagesMap: Record<string, Record<string, number>> = {}
    let total = 0
    for (const r of results) {
      const url = r.page_url as string
      const type = r.reaction_type as string
      const count = r.count as number
      if (!pagesMap[url]) pagesMap[url] = {}
      pagesMap[url][type] = count
      total += count
    }

    const pages = Object.entries(pagesMap).map(([page_url, reactions]) => ({
      page_url,
      reactions
    }))

    return { pages, total }
  }

  async getLatestPostReactions(limit: number) {
    const { results } = await this.db.prepare('SELECT * FROM post_reactions ORDER BY created_at DESC LIMIT ?').bind(limit).all()
    return { reactions: results, total: results.length }
  }

  async deleteReaction(id: number) {
    await this.db.prepare('DELETE FROM post_reactions WHERE id = ?').bind(id).run()
    return { success: true }
  }

}
