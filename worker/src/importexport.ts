import { getGravatarHash } from './comments'

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

  // ── Export (Streaming) ───────────────────────────────────────────

  private static BATCH_SIZE = 500
  /** D1 batch() limit: max statements per batch call. */
  private static D1_BATCH_SIZE = 50

  /**
   * Paginate over a table using cursor-based pagination (WHERE id > lastId).
   * Yields batches of results without ever loading the full table into memory.
   */
  private async *paginateTable(
    table: string,
    batchSize: number = ImportExportService.BATCH_SIZE,
  ): AsyncGenerator<any[]> {
    let lastId = 0
    while (true) {
      const { results } = await this.db
        .prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id ASC LIMIT ?`)
        .bind(lastId, batchSize)
        .all()
      if (results.length === 0) break
      yield results
      lastId = results[results.length - 1].id as number
    }
  }

  /**
   * Write a JSON array to the writer by streaming table rows in batches.
   * Handles commas between records and opening/closing brackets.
   */
  private async streamJsonArray(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    encoder: TextEncoder,
    table: string,
  ): Promise<void> {
    let firstRecord = true
    for await (const batch of this.paginateTable(table)) {
      for (const row of batch) {
        if (!firstRecord) {
          writer.write(encoder.encode(','))
        }
        firstRecord = false
        writer.write(encoder.encode(JSON.stringify(row)))
      }
    }
  }

  /**
   * Build a streaming Response for the export.
   * Each dataset is paginated and streamed — no single dataset is fully loaded into memory.
   */
  async exportFullJson(): Promise<Response> {
    const dateStr = new Date().toISOString().slice(0, 10)
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    // Write JSON header and start streaming immediately
    ;(async () => {
      try {
        writer.write(encoder.encode('{\n'))
        writer.write(encoder.encode(`  "version": 1,\n`))
        writer.write(encoder.encode(`  "exported_at": "${new Date().toISOString()}",\n`))

        // Stream comments array
        writer.write(encoder.encode('  "comments": ['))
        await this.streamJsonArray(writer, encoder, 'comments')
        writer.write(encoder.encode('],\n'))

        // Stream post_reactions array
        writer.write(encoder.encode('  "post_reactions": ['))
        await this.streamJsonArray(writer, encoder, 'post_reactions')
        writer.write(encoder.encode('],\n'))

        // Stream comment_reactions array (no trailing comma)
        writer.write(encoder.encode('  "comment_reactions": ['))
        await this.streamJsonArray(writer, encoder, 'comment_reactions')
        writer.write(encoder.encode(']\n'))

        writer.write(encoder.encode('}\n'))
      } catch (err) {
        console.error('[Export] Streaming export failed:', err)
      } finally {
        writer.close()
      }
    })()

    return new Response(readable, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="comments-backup-${dateStr}.json"`,
      },
    })
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

  // ── Internal: Snapshot / Rollback Helpers ────────────────────────

  /**
   * Capture the current max ID for every mutable table so we can
   * roll back any rows inserted after this point.
   */
  private async getTableMaxIds(): Promise<{
    comments: number
    post_reactions: number
    comment_reactions: number
  }> {
    const [{ results: c }, { results: pr }, { results: cr }] = await Promise.all([
      this.db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM comments').all(),
      this.db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM post_reactions').all(),
      this.db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM comment_reactions').all(),
    ])
    return {
      comments: (c[0]?.max_id as number) ?? 0,
      post_reactions: (pr[0]?.max_id as number) ?? 0,
      comment_reactions: (cr[0]?.max_id as number) ?? 0,
    }
  }

  /**
   * Best-effort cleanup: delete every row whose ID exceeds the snapshot.
   * Because D1 has no cross-batch transactions this is the closest we
   * can get to a rollback.
   */
  private async rollbackFromSnapshot(
    snapshot: { comments: number; post_reactions: number; comment_reactions: number },
  ): Promise<void> {
    try {
      await this.db.batch([
        this.db.prepare('DELETE FROM comment_reactions WHERE id > ?').bind(snapshot.comment_reactions),
        this.db.prepare('DELETE FROM post_reactions WHERE id > ?').bind(snapshot.post_reactions),
        this.db.prepare('DELETE FROM comments WHERE id > ?').bind(snapshot.comments),
      ])
    } catch (rollbackErr) {
      console.error('[Import] CRITICAL: Rollback failed — import data may be partially committed:', rollbackErr)
    }
  }

  // ── Internal: Full Import ────────────────────────────────────────

  private async importFullPayload(data: ExportPayload): Promise<Record<string, any>> {
    // ── Phase 1: Read-only dedup lookups (safe, no mutations) ─────
    const [existingFingerprints, existingPR, existingCR] = await Promise.all([
      this.getExistingCommentFingerprints(),
      this.getExistingPostReactionKeys(),
      this.getExistingCommentReactionKeys(),
    ])

    // ── Phase 2: Filter out duplicate comments ─────────────────────
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

    // ── Phase 3: Snapshot table state for rollback ─────────────────
    const snapshot = await this.getTableMaxIds()

    // ── Phase 4: Execute mutations (rolled back on failure) ────────
    const idMap = new Map<number, number>()
    let imported_comments = 0
    let imported_post_reactions = 0
    let skipped_post_reactions = 0
    let imported_comment_reactions = 0
    let skipped_comment_reactions = 0

    try {
      // 4a: Insert new comments (parent_id deferred until IDs are known)
      const commentStmts: D1PreparedStatement[] = []
      const commentMeta: any[] = []
      for (const c of newComments) {
        const createdAt = c.created_at || new Date().toISOString()
        const updatedAt = c.updated_at || createdAt
        const authorHash = c.author_email ? await getGravatarHash(c.author_email) : null
        commentStmts.push(
          this.db.prepare(`
            INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, created_at, updated_at, status, ip_address, author_role, author_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            c.author_role || 'user',
            authorHash,
          ),
        )
        commentMeta.push(c)
      }

      for (let i = 0; i < commentStmts.length; i += ImportExportService.D1_BATCH_SIZE) {
        const batch = commentStmts.slice(i, i + ImportExportService.D1_BATCH_SIZE)
        const batchMeta = commentMeta.slice(i, i + ImportExportService.D1_BATCH_SIZE)
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

      // 4b: Collect ALL remaining mutations (parent updates + reactions)
      //     into a single array so they share batches and maximise atomicity.
      const remainingStmts: D1PreparedStatement[] = []
      let remainingPostReactionCount = 0
      let remainingCommentReactionCount = 0

      // Parent-ID updates
      for (let i = 0; i < newComments.length; i++) {
        const c = newComments[i]
        if (c.parent_id && idMap.has(c.parent_id)) {
          const newId = idMap.get(c.id)!
          const mappedParentId = idMap.get(c.parent_id)
          if (mappedParentId) {
            remainingStmts.push(
              this.db.prepare('UPDATE comments SET parent_id = ? WHERE id = ?')
                .bind(mappedParentId, newId),
            )
          }
        }
      }

      // Post reactions
      if (data.post_reactions) {
        for (const r of data.post_reactions) {
          const key = `${r.page_url}|${r.ip_address}|${r.reaction_type}`
          if (existingPR.has(key)) {
            skipped_post_reactions++
            continue
          }
          remainingStmts.push(
            this.db.prepare(`
              INSERT INTO post_reactions (page_url, ip_address, reaction_type, created_at)
              VALUES (?, ?, ?, ?)
            `).bind(
              r.page_url,
              r.ip_address,
              r.reaction_type || 'heart',
              r.created_at || new Date().toISOString(),
            ),
          )
          remainingPostReactionCount++
        }
      }

      // Comment reactions
      if (data.comment_reactions) {
        for (const r of data.comment_reactions) {
          const mappedCommentId = idMap.get(r.comment_id)
          if (!mappedCommentId) {
            skipped_comment_reactions++
            continue
          }
          const key = `${mappedCommentId}|${r.ip_address}|${r.reaction_type}|${r.author_role || 'user'}`
          if (existingCR.has(key)) {
            skipped_comment_reactions++
            continue
          }
          remainingStmts.push(
            this.db.prepare(`
              INSERT INTO comment_reactions (comment_id, ip_address, reaction_type, author_role, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).bind(
              mappedCommentId,
              r.ip_address,
              r.reaction_type || 'heart',
              r.author_role || 'user',
              r.created_at || new Date().toISOString(),
            ),
          )
          remainingCommentReactionCount++
        }
      }

      // 4c: Execute remaining statements in batches
      for (let i = 0; i < remainingStmts.length; i += ImportExportService.D1_BATCH_SIZE) {
        const batch = remainingStmts.slice(i, i + ImportExportService.D1_BATCH_SIZE)
        await this.db.batch(batch)
      }

      imported_post_reactions = remainingPostReactionCount
      imported_comment_reactions = remainingCommentReactionCount
    } catch (err) {
      console.error('[Import] Batch failed, rolling back:', err)
      await this.rollbackFromSnapshot(snapshot)
      return {
        error: 'Import failed and was rolled back: ' + (err as Error).message,
      }
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

    // Filter out invalid and duplicate comments before any DB mutations
    const validComments: any[] = []
    for (const comment of comments) {
      if (!comment.page_url || !comment.author_name || !comment.content) {
        skipped_duplicates++
        continue
      }
      const fp = this.commentFingerprint(comment.page_url, comment.author_name, comment.content)
      if (existingFingerprints.has(fp)) {
        skipped_duplicates++
        continue
      }
      existingFingerprints.set(fp, -1) // mark as seen to deduplicate within the batch
      validComments.push(comment)
    }

    // Snapshot for rollback
    const snapshot = await this.getTableMaxIds()

    try {
      const stmts: D1PreparedStatement[] = []
      const meta: any[] = []

      for (const comment of validComments) {
        const authorHash = comment.author_email ? await getGravatarHash(comment.author_email) : null
        stmts.push(
          this.db.prepare(`
            INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, created_at, updated_at, status, ip_address, author_role, author_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            comment.page_url,
            comment.parent_id || null,
            comment.author_name,
            comment.author_email || null,
            comment.author_url || null,
            comment.content,
            comment.created_at || new Date().toISOString(),
            comment.updated_at || comment.created_at || new Date().toISOString(),
            comment.status || 'approved',
            comment.ip_address || null,
            comment.author_role || 'user',
            authorHash,
          ),
        )
        meta.push(comment)
      }

      for (let i = 0; i < stmts.length; i += ImportExportService.D1_BATCH_SIZE) {
        const batch = stmts.slice(i, i + ImportExportService.D1_BATCH_SIZE)
        const batchMeta = meta.slice(i, i + ImportExportService.D1_BATCH_SIZE)
        await this.db.batch(batch)
        for (const c of batchMeta) {
          imported++
          if (c.page_url) uniquePages.add(c.page_url)
        }
      }
    } catch (err) {
      console.error('[Import] Legacy batch failed, rolling back:', err)
      await this.rollbackFromSnapshot(snapshot)
      return { error: 'Import failed and was rolled back: ' + (err as Error).message }
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
      'SELECT comment_id, ip_address, reaction_type, author_role FROM comment_reactions'
    ).all()
    const set = new Set<string>()
    for (const r of results) {
      set.add(`${r.comment_id}|${r.ip_address}|${r.reaction_type}|${r.author_role || 'user'}`)
    }
    return set
  }
}
