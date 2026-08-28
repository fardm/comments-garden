import { SpamService } from './spam'
import { ReactionService } from './reactions'

export async function getGravatarHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function gravatarUrlFromHash(hashHex: string, size = 80): string {
  return `/api/gravatar/${hashHex}?s=${size}`
}

export async function getGravatarUrl(email: string, size = 80): Promise<string> {
  const hashHex = await getGravatarHash(email)
  return gravatarUrlFromHash(hashHex, size)
}

async function enrichCommentsWithAvatars(comments: any[]): Promise<void> {
  // Collect all comments (including nested replies) for parallel processing
  const allComments: any[] = []
  function collect(list: any[]): void {
    for (const comment of list) {
      allComments.push(comment)
      if (comment.replies && Array.isArray(comment.replies)) {
        collect(comment.replies)
      }
    }
  }
  collect(comments)

  // Batch-compute hashes for any legacy comments missing author_hash
  const missingHashComments = allComments.filter(c => !c.author_hash && c.author_email)
  if (missingHashComments.length > 0) {
    await Promise.all(
      missingHashComments.map(async (comment) => {
        comment.author_hash = await getGravatarHash(comment.author_email as string)
      })
    )
  }

  // Generate all Gravatar URLs from stored hashes (no per-request crypto)
  for (const comment of allComments) {
    if (comment.author_hash) {
      comment.author_avatar = gravatarUrlFromHash(comment.author_hash as string)
    }
    // Don't expose email to public consumers
    delete comment.author_email
  }
}

export class CommentService {
  private db: D1Database
  private spamService: SpamService

  constructor(db: D1Database) {
    this.db = db
    this.spamService = new SpamService(db)
  }

  async getComments(url: string, limit: number, offset: number, ip: string, sortOrder: string = 'asc') {
    const order = sortOrder === 'desc' ? 'DESC' : 'ASC'
    const { results: comments } = await this.db.prepare(`\r\n      SELECT * FROM comments\r\n      WHERE page_url = ? AND status = 'approved'\r\n      ORDER BY created_at ${order}\r\n      LIMIT ? OFFSET ?\r\n    `).bind(url, limit, offset).all()

    // Group into threads
    const topLevel: any[] = []
    const repliesMap = new Map<number, any[]>()

    // Fetch all reactions for these comments to map to counts
    const commentIds = comments.map(c => c.id as number);
    const { reactionsMap, adminReactionsMap } = await new ReactionService(this.db).getCommentReactionsBatch(commentIds, ip);

    for (const comment of comments) {
      comment.reactions_by_type = reactionsMap.get(comment.id as number) || {};
      comment.admin_reactions = adminReactionsMap.get(comment.id as number) || [];
      const parentId = comment.parent_id as number | null;
      if (parentId) {
        if (!repliesMap.has(parentId)) {
          repliesMap.set(parentId, [])
        }
        repliesMap.get(parentId)!.push(comment)
      } else {
        topLevel.push(comment)
      }
    }

    // Assign replies
    for (const comment of topLevel) {
      comment.replies = repliesMap.get(comment.id as number) || []
    }

    const { count } = await this.db.prepare(`SELECT COUNT(*) as count FROM comments WHERE page_url = ? AND status = 'approved'`).bind(url).first<{count: number}>() || { count: 0 }

    // Generate Gravatar URLs from stored hashes and strip email from public response
    await enrichCommentsWithAvatars(topLevel)

    return { comments: topLevel, total: count }
  }

  async createComment(data: any, ip: string) {
    // Honeypot check
    if (data.website) {
      return { error: 'spam_detected' }
    }

    const isSpam = await this.spamService.checkSpam(data.content, data.author_name, data.author_email, data.author_url || '', ip)
    const status = isSpam ? 'spam' : 'pending' // Should read from settings 'require_moderation'
    // Public comments always get 'user' role — admin role is only set via createAdminComment
    const authorRole = 'user'
    const authorHash = await getGravatarHash(data.author_email)

    const result = await this.db.prepare(`\r\n      INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, ip_address, status, author_role, author_hash)\r\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\r\n    `).bind(
      data.page_url,
      data.parent_id || null,
      data.author_name,
      data.author_email,
      data.author_url || null,
      data.content,
      ip,
      status,
      authorRole,
      authorHash
    ).run()

    if (result.success) {
      return {
        success: true,
        message: status === 'pending' ? 'Your comment is awaiting moderation.' : 'Comment posted successfully.',
        status,
        comment_id: result.meta?.last_row_id as number | undefined,
      }
    }
    return { error: 'Database error' }
  }

  async createAdminComment(data: any, ip: string) {
    const authorHash = await getGravatarHash(data.author_email)

    const result = await this.db.prepare(`\r\n      INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, ip_address, status, author_role, author_hash)\r\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\r\n    `).bind(
      data.page_url,
      data.parent_id || null,
      data.author_name,
      data.author_email,
      data.author_url || null,
      data.content,
      ip,
      'approved',
      'admin',
      authorHash
    ).run()

    if (result.success) {
      return {
        success: true,
        message: 'Reply posted successfully.',
        status: 'approved'
      }
    }
    return { error: 'Database error' }
  }

  async moderateComment(id: number, status: string) {
    await this.db.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run()
    return { success: true }
  }

  async editComment(id: number, content: string) {
    await this.db.prepare('UPDATE comments SET content = ?, updated_at = datetime("now") WHERE id = ?').bind(content, id).run()
    return { success: true }
  }

  async deleteComment(id: number) {
    // Soft delete: set status to 'deleted' instead of removing from DB
    await this.db.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").bind(id).run()
    return { success: true }
  }

  async restoreComment(id: number) {
    // Restore a soft-deleted comment back to 'pending' for re-review
    await this.db.prepare("UPDATE comments SET status = 'pending' WHERE id = ? AND status = 'deleted'").bind(id).run()
    return { success: true }
  }

  async permanentDeleteComment(id: number) {
    // Permanently remove a comment from the database
    await this.db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run()
    return { success: true }
  }

  async getRecentComments(limit: number, showAdminComments: boolean = false) {
    let query = `SELECT * FROM comments WHERE status = 'approved'`
    if (!showAdminComments) {
      query += ` AND author_role = 'user'`
    }
    query += ` ORDER BY created_at DESC LIMIT ?`
    const { results } = await this.db.prepare(query).bind(limit).all()

    for (const row of results) {
      const content = row.content as string;
      row.excerpt = content.length > 150 ? content.substring(0, 150) + '...' : content;
    }
    // Generate Gravatar URLs from stored hashes and strip email from public response
    await enrichCommentsWithAvatars(results as any[])
    return { comments: results }
  }
}
