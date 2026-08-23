export class ReactionService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async toggleCommentReaction(commentId: number, ip: string, reactionType: string) {
    let reacted = true;
    try {
      await this.db.prepare('INSERT INTO comment_reactions (comment_id, ip_address, reaction_type) VALUES (?, ?, ?)').bind(commentId, ip, reactionType).run()
    } catch (e) {
      // SQLite UNIQUE constraint violation
      await this.db.prepare('DELETE FROM comment_reactions WHERE comment_id = ? AND ip_address = ? AND reaction_type = ?').bind(commentId, ip, reactionType).run()
      reacted = false;
    }

    // Get updated counts for this comment (user reactions only — admin reactions are rendered separately)
    const { results } = await this.db.prepare("SELECT reaction_type, COUNT(*) as count FROM comment_reactions WHERE comment_id = ? AND (author_role = 'user' OR author_role IS NULL) GROUP BY reaction_type").bind(commentId).all()
    const counts: Record<string, number> = {}
    for (const r of results) {
      counts[r.reaction_type as string] = r.count as number
    }

    return { success: true, reacted, counts }
  }

  async toggleAdminCommentReaction(commentId: number, ip: string, reactionType: string) {
    let reacted = true;
    try {
      await this.db.prepare('INSERT INTO comment_reactions (comment_id, ip_address, reaction_type, author_role) VALUES (?, ?, ?, ?)').bind(commentId, ip, reactionType, 'admin').run()
    } catch (e) {
      // SQLite UNIQUE constraint violation
      await this.db.prepare('DELETE FROM comment_reactions WHERE comment_id = ? AND ip_address = ? AND reaction_type = ? AND author_role = ?').bind(commentId, ip, reactionType, 'admin').run()
      reacted = false;
    }

    // Get updated counts for this comment
    const { results } = await this.db.prepare('SELECT reaction_type, author_role, COUNT(*) as count FROM comment_reactions WHERE comment_id = ? GROUP BY reaction_type, author_role').bind(commentId).all()
    const counts: Record<string, number> = {}
    const adminReactions: string[] = []

    for (const r of results) {
      if (r.author_role === 'admin') {
        adminReactions.push(r.reaction_type as string)
      } else {
        counts[r.reaction_type as string] = r.count as number
      }
    }

    return { success: true, reacted, counts, admin_reactions: adminReactions }
  }

  async togglePostReaction(url: string, ip: string, reactionType: string) {
    let reacted = true;
    try {
      await this.db.prepare('INSERT INTO post_reactions (page_url, ip_address, reaction_type) VALUES (?, ?, ?)').bind(url, ip, reactionType).run()
    } catch (e) {
      await this.db.prepare('DELETE FROM post_reactions WHERE page_url = ? AND ip_address = ? AND reaction_type = ?').bind(url, ip, reactionType).run()
      reacted = false;
    }

    // Get updated counts for this post
    const summary = await this.getPostReactionsSummary(url, ip)
    const counts: Record<string, number> = {}
    for (const key in summary) {
        counts[key] = summary[key].count
    }

    return { success: true, reacted, counts }
  }

  async getPostReactionsSummary(url: string, ip: string) {
    const { results } = await this.db.prepare('SELECT reaction_type, COUNT(*) as count FROM post_reactions WHERE page_url = ? GROUP BY reaction_type').bind(url).all()

    const userReacts = await this.db.prepare('SELECT reaction_type FROM post_reactions WHERE page_url = ? AND ip_address = ?').bind(url, ip).all()
    const userReacted = new Set(userReacts.results.map((r: any) => r.reaction_type))

    const summary: Record<string, {count: number, reacted: boolean}> = {}
    for (const r of results) {
      const reactionType = r.reaction_type as string
      summary[reactionType] = {
        count: r.count as number,
        reacted: userReacted.has(reactionType)
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

  async getLatestPostReactions(limit: number, offset: number = 0) {
    const countRow = await this.db.prepare('SELECT COUNT(*) as count FROM post_reactions').first<{ count: number }>()
    const total = countRow?.count ?? 0
    const { results } = await this.db.prepare('SELECT * FROM post_reactions ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all()
    return { reactions: results, total }
  }

  async deleteReaction(id: number) {
    await this.db.prepare('DELETE FROM post_reactions WHERE id = ?').bind(id).run()
    return { success: true }
  }

  // ── Batch reaction helpers ───────────────────────────────────────────────────

  /**
   * Build a parameterized IN clause: returns { clause: 'IN (?,?,?)', params: [id1, id2, ...] }
   * Returns null if the array is empty.
   */
  private buildInClause(ids: number[]): { clause: string; params: number[] } | null {
    if (ids.length === 0) return null
    return {
      clause: `IN (${ids.map(() => '?').join(',')})`,
      params: ids,
    }
  }

  /**
   * Fetch reaction counts for a batch of comment IDs, fully parameterized.
   * Returns:
   *  - reactionsMap: Map<commentId, Record<reactionType, { count, reacted }>>
   *  - adminReactionsMap: Map<commentId, string[]>
   *
   * Pass an IP address to include per-user reaction state; omit it for admin views.
   */
  async getCommentReactionsBatch(
    commentIds: number[],
    ip?: string,
  ): Promise<{
    reactionsMap: Map<number, Record<string, { count: number; reacted: boolean }>>
    adminReactionsMap: Map<number, string[]>
  }> {
    const reactionsMap = new Map<number, Record<string, { count: number; reacted: boolean }>>()
    const adminReactionsMap = new Map<number, string[]>()

    const inClause = this.buildInClause(commentIds)
    if (!inClause) return { reactionsMap, adminReactionsMap }

    // Aggregate all reactions (user + admin) grouped by comment_id, reaction_type, author_role
    const { results: rows } = await this.db
      .prepare(`SELECT comment_id, reaction_type, author_role, COUNT(*) as count
                FROM comment_reactions
                WHERE comment_id ${inClause.clause}
                GROUP BY comment_id, reaction_type, author_role`)
      .bind(...inClause.params)
      .all()

    // If an IP is provided, also fetch which reactions the current user has reacted with
    let userReactionsSet: Set<string> | null = null
    if (ip) {
      const { results: userReactions } = await this.db
        .prepare(`SELECT comment_id, reaction_type
                  FROM comment_reactions
                  WHERE comment_id ${inClause.clause}
                    AND ip_address = ?
                    AND author_role = 'user'`)
        .bind(...inClause.params, ip)
        .all()
      userReactionsSet = new Set(userReactions.map(v => `${v.comment_id}-${v.reaction_type}`))
    }

    for (const v of rows) {
      const cId = v.comment_id as number
      const rType = v.reaction_type as string
      if (v.author_role === 'admin') {
        if (!adminReactionsMap.has(cId)) adminReactionsMap.set(cId, [])
        adminReactionsMap.get(cId)!.push(rType)
      } else {
        if (!reactionsMap.has(cId)) reactionsMap.set(cId, {})
        reactionsMap.get(cId)![rType] = {
          count: v.count as number,
          reacted: userReactionsSet ? userReactionsSet.has(`${cId}-${rType}`) : false,
        }
      }
    }

    return { reactionsMap, adminReactionsMap }
  }

}
