export interface ExportPayload {
  version: 1
  exported_at: string
  comments: any[]
  post_reactions: any[]
  comment_reactions: any[]
}

export class ImportExportService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  // ── Export ───────────────────────────────────────────────────────

  async exportFullJson(): Promise<ExportPayload> {
    const [comments, postReactions, commentReactions] = await Promise.all([
      this.db.prepare('SELECT * FROM comments ORDER BY id ASC').all(),
      this.db.prepare('SELECT * FROM post_reactions ORDER BY id ASC').all(),
      this.db.prepare('SELECT * FROM votes ORDER BY id ASC').all(),
    ])

    return {
      version: 1,
      exported_at: new Date().toISOString(),
      comments: comments.results,
      post_reactions: postReactions.results,
      comment_reactions: commentReactions.results,
    }
  }

  // ── Preview ──────────────────────────────────────────────────────

  async previewImport(content: string): Promise<Record<string, any>> {
    const parsed = this.parseContent(content)
    if (parsed.error) return { error: parsed.error }

    const data = parsed.data!

    // Detect legacy format: plain JSON array of comments
    if (data._legacy) {
      return {
        format: 'legacy_json',
        comments: data.comments!.length,
        post_reactions: 0,
        comment_reactions: 0,
      }
    }

    return {
      format: 'json',
      version: data.version,
      comments: data.comments?.length ?? 0,
      post_reactions: data.post_reactions?.length ?? 0,
      comment_reactions: data.comment_reactions?.length ?? 0,
    }
  }

  // ── Import ───────────────────────────────────────────────────────

  async runImport(content: string): Promise<Record<string, any>> {
    const parsed = this.parseContent(content)
    if (parsed.error) return { error: parsed.error }

    const data = parsed.data!

    // Legacy format: plain JSON array of comments → convert to full payload
    if (data._legacy) {
      return this.importLegacyComments(data.comments!)
    }

    // Validate the entire payload before touching the DB
    const validation = this.validatePayload(data)
    if (validation) return { error: validation }

    return this.importFullPayload(data)
  }

  // ── Internal: Parsing ────────────────────────────────────────────

  private parseContent(content: string): { data?: ExportPayload & { _legacy?: boolean; comments?: any[] }; error?: string } {
    try {
      const raw = JSON.parse(content)

      // Full structured payload
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.version === 1) {
        return { data: raw as ExportPayload }
      }

      // Legacy: plain JSON array of comments
      if (Array.isArray(raw)) {
        return { data: { _legacy: true, comments: raw } as any }
      }

      return { error: 'Invalid format. Expected a JSON backup file (version 1) or a JSON array of comments.' }
    } catch (e: any) {
      return { error: 'Failed to parse JSON: ' + e.message }
    }
  }

  // ── Internal: Validation ─────────────────────────────────────────

  private validatePayload(data: ExportPayload): string | null {
    if (typeof data.version !== 'number' || data.version < 1) {
      return 'Invalid payload version.'
    }

    if (!Array.isArray(data.comments)) {
      return 'Payload is missing the "comments" array.'
    }

    for (let i = 0; i < data.comments.length; i++) {
      const c = data.comments[i]
      if (!c.page_url || typeof c.page_url !== 'string') return `Comment #${i} is missing a valid page_url.`
      if (!c.author_name || typeof c.author_name !== 'string') return `Comment #${i} is missing a valid author_name.`
      if (!c.content || typeof c.content !== 'string') return `Comment #${i} is missing content.`
    }

    const validArrays = ['post_reactions', 'comment_reactions'] as const
    for (const key of validArrays) {
      if (data[key] !== undefined && !Array.isArray(data[key])) {
        return `Field "${key}" must be an array if provided.`
      }
    }

    // Validate comment_reactions reference valid comment IDs (by export ID)
    if (data.comment_reactions) {
      for (let i = 0; i < data.comment_reactions.length; i++) {
        const r = data.comment_reactions[i]
        if (!r.comment_id) return `Comment reaction #${i} is missing comment_id.`
        if (!r.ip_address) return `Comment reaction #${i} is missing ip_address.`
        if (!r.reaction_type) return `Comment reaction #${i} is missing reaction_type.`
      }
    }

    return null // valid
  }

  // ── Internal: Full Import ────────────────────────────────────────

  private async importFullPayload(data: ExportPayload): Promise<Record<string, any>> {
    // Step 1: Check which comments already exist (by page_url + author_name + content fingerprint)
    const existingFingerprints = await this.getExistingCommentFingerprints()
    const newComments: any[] = []
    let skipped_comments = 0

    for (const c of data.comments) {
      const fp = this.commentFingerprint(c.page_url, c.author_name, c.content)
      if (existingFingerprints.has(fp)) {
        skipped_comments++
        continue
      }
      newComments.push(c)
    }

    // Step 2: Insert new comments in a batch, building an ID map (export_id → new_db_id)
    const idMap = new Map<number, number>()
    let imported_comments = 0

    // First pass: insert all comments without parent_id (to get IDs)
    const commentStmts: D1PreparedStatement[] = []
    const commentMeta: any[] = [] // track export IDs in parallel
    for (const c of newComments) {
      const createdAt = c.created_at || new Date().toISOString()
      const updatedAt = c.updated_at || createdAt

      commentStmts.push(
        this.db.prepare(`
          INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, created_at, updated_at, status, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          c.page_url,
          null, // defer parent linking
          c.author_name,
          c.author_email || null,
          c.author_url || null,
          c.content,
          createdAt,
          updatedAt,
          c.status || 'approved',
          c.ip_address || null,
          c.user_agent || null,
        )
      )
      commentMeta.push(c)
    }

    // Execute inserts in batches of 50 (D1 batch limit)
    for (let i = 0; i < commentStmts.length; i += 50) {
      const batch = commentStmts.slice(i, i + 50)
      const batchMeta = commentMeta.slice(i, i + 50)
      const results = await this.db.batch(batch)
      for (let j = 0; j < results.length; j++) {
        const meta = (results[j] as any).meta
        const newId = meta.last_row_id as number
        const exportId = batchMeta[j].id
        if (exportId) idMap.set(exportId, newId)
        imported_comments++
      }
    }

    // Also map existing comments (they keep their original IDs)
    for (const c of data.comments) {
      const fp = this.commentFingerprint(c.page_url, c.author_name, c.content)
      if (existingFingerprints.has(fp)) {
        idMap.set(c.id, existingFingerprints.get(fp)!)
      }
    }

    // Step 3: Link parent_ids using the ID map
    const parentStmts: D1PreparedStatement[] = []
    for (let i = 0; i < newComments.length; i++) {
      const c = newComments[i]
      if (c.parent_id && idMap.has(c.parent_id)) {
        const newId = idMap.get(newComments[i].id)!
        const mappedParentId = idMap.get(c.parent_id)
        if (mappedParentId) {
          parentStmts.push(
            this.db.prepare('UPDATE comments SET parent_id = ? WHERE id = ?')
              .bind(mappedParentId, newId)
          )
        }
      }
    }
    if (parentStmts.length > 0) {
      await this.db.batch(parentStmts)
    }

    // Step 4: Import post reactions (deduplicate by page_url + ip_address + reaction_type)
    let imported_post_reactions = 0
    let skipped_post_reactions = 0
    const postReactionStmts: D1PreparedStatement[] = []

    if (data.post_reactions) {
      const existingPR = await this.getExistingPostReactionKeys()
      for (const r of data.post_reactions) {
        const key = `${r.page_url}|${r.ip_address}|${r.reaction_type}`
        if (existingPR.has(key)) {
          skipped_post_reactions++
          continue
        }
        postReactionStmts.push(
          this.db.prepare(`
            INSERT INTO post_reactions (page_url, ip_address, reaction_type, created_at)
            VALUES (?, ?, ?, ?)
          `).bind(
            r.page_url,
            r.ip_address,
            r.reaction_type || 'heart',
            r.created_at || new Date().toISOString(),
          )
        )
      }
    }

    for (let i = 0; i < postReactionStmts.length; i += 50) {
      const batch = postReactionStmts.slice(i, i + 50)
      await this.db.batch(batch)
      imported_post_reactions += batch.length
    }

    // Step 5: Import comment reactions (deduplicate by comment_id + ip_address + reaction_type)
    let imported_comment_reactions = 0
    let skipped_comment_reactions = 0
    const commentReactionStmts: D1PreparedStatement[] = []

    if (data.comment_reactions) {
      const existingCR = await this.getExistingCommentReactionKeys()
      for (const r of data.comment_reactions) {
        const mappedCommentId = idMap.get(r.comment_id)
        if (!mappedCommentId) {
          skipped_comment_reactions++
          continue
        }
        const key = `${mappedCommentId}|${r.ip_address}|${r.reaction_type}`
        if (existingCR.has(key)) {
          skipped_comment_reactions++
          continue
        }
        commentReactionStmts.push(
          this.db.prepare(`
            INSERT INTO votes (comment_id, ip_address, reaction_type, created_at)
            VALUES (?, ?, ?, ?)
          `).bind(
            mappedCommentId,
            r.ip_address,
            r.reaction_type || 'heart',
            r.created_at || new Date().toISOString(),
          )
        )
      }
    }

    for (let i = 0; i < commentReactionStmts.length; i += 50) {
      const batch = commentReactionStmts.slice(i, i + 50)
      await this.db.batch(batch)
      imported_comment_reactions += batch.length
    }

    return {
      imported_comments,
      skipped_comments,
      imported_post_reactions,
      skipped_post_reactions,
      imported_comment_reactions,
      skipped_comment_reactions,
    }
  }

  // ── Internal: Legacy Import ──────────────────────────────────────

  private async importLegacyComments(comments: any[]): Promise<Record<string, any>> {
    const existingFingerprints = await this.getExistingCommentFingerprints()
    let imported = 0
    let skipped_duplicates = 0
    const uniquePages = new Set()

    for (const comment of comments) {
      const fp = this.commentFingerprint(comment.page_url, comment.author_name, comment.content)
      if (existingFingerprints.has(fp)) {
        skipped_duplicates++
        continue
      }

      try {
        const parentId = comment.parent_id || null
        const authorUrl = comment.author_url || null
        const status = comment.status || 'approved'
        const ip = comment.ip_address || null
        const userAgent = comment.user_agent || null
        const createdAt = comment.created_at || new Date().toISOString()
        const updatedAt = comment.updated_at || createdAt

        if (!comment.page_url || !comment.author_name || !comment.content) {
          skipped_duplicates++
          continue
        }

        await this.db.prepare(`
          INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, created_at, updated_at, status, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          comment.page_url,
          parentId,
          comment.author_name,
          comment.author_email || null,
          authorUrl,
          comment.content,
          createdAt,
          updatedAt,
          status,
          ip,
          userAgent,
        ).run()

        imported++
        if (comment.page_url) uniquePages.add(comment.page_url)
      } catch {
        skipped_duplicates++
      }
    }

    return {
      imported_comments: imported,
      skipped_comments: skipped_duplicates,
      unique_pages: uniquePages.size,
    }
  }

  // ── Internal: Dedup Helpers ──────────────────────────────────────

  private commentFingerprint(pageUrl: string, authorName: string, content: string): string {
    return `${pageUrl}|${authorName}|${content}`
  }

  private async getExistingCommentFingerprints(): Promise<Map<string, number>> {
    const { results } = await this.db.prepare(
      'SELECT id, page_url, author_name, content FROM comments'
    ).all()
    const map = new Map<string, number>()
    for (const r of results) {
      map.set(this.commentFingerprint(r.page_url as string, r.author_name as string, r.content as string), r.id as number)
    }
    return map
  }

  private async getExistingPostReactionKeys(): Promise<Set<string>> {
    const { results } = await this.db.prepare(
      'SELECT page_url, ip_address, reaction_type FROM post_reactions'
    ).all()
    const set = new Set<string>()
    for (const r of results) {
      set.add(`${r.page_url}|${r.ip_address}|${r.reaction_type}`)
    }
    return set
  }

  private async getExistingCommentReactionKeys(): Promise<Set<string>> {
    const { results } = await this.db.prepare(
      'SELECT comment_id, ip_address, reaction_type FROM votes'
    ).all()
    const set = new Set<string>()
    for (const r of results) {
      set.add(`${r.comment_id}|${r.ip_address}|${r.reaction_type}`)
    }
    return set
  }
}
