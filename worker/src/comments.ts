import { SpamService } from './spam'

export async function getGravatarUrl(email: string, size = 80): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  const hashArray = new Uint8Array(hashBuffer)
  const hashHex = Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `https://www.gravatar.com/avatar/${hashHex}?s=${size}&d=mp`
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

  // Generate all Gravatar URLs in parallel
  await Promise.all(
    allComments.map(async (comment) => {
      if (comment.author_email) {
        comment.author_avatar = await getGravatarUrl(comment.author_email as string)
      }
      // Don't expose email to public consumers
      delete comment.author_email
    })
  )
}

export class CommentService {
  private db: D1Database
  private spamService: SpamService

  constructor(db: D1Database) {
    this.db = db
    this.spamService = new SpamService(db)
  }

  async getComments(url: string, limit: number, offset: number, ip: string) {
    const { results: comments } = await this.db.prepare(`
      SELECT * FROM comments
      WHERE page_url = ? AND status = 'approved'
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `).bind(url, limit, offset).all()

    // Group into threads
    const topLevel: any[] = []
    const repliesMap = new Map<number, any[]>()

    // Fetch all reactions for these comments to map to counts
    const commentIds = comments.map(c => c.id).join(',');
    const votesMap = new Map<number, Record<string, any>>();
    const adminReactionsMap = new Map<number, string[]>();
    if (commentIds) {
      const { results: votes } = await this.db.prepare(`SELECT comment_id, reaction_type, author_role, COUNT(*) as count FROM comment_reactions WHERE comment_id IN (${commentIds}) GROUP BY comment_id, reaction_type, author_role`).all();

      const { results: userVotes } = await this.db.prepare(`SELECT comment_id, reaction_type FROM comment_reactions WHERE comment_id IN (${commentIds}) AND ip_address = ? AND author_role = 'user'`).bind(ip).all();
      const userVotesSet = new Set(userVotes.map(v => `${v.comment_id}-${v.reaction_type}`));

      for (const v of votes) {
        const cId = v.comment_id as number;
        const rType = v.reaction_type as string;
        if (v.author_role === 'admin') {
          if (!adminReactionsMap.has(cId)) adminReactionsMap.set(cId, []);
          adminReactionsMap.get(cId)!.push(rType);
        } else {
          if (!votesMap.has(cId)) votesMap.set(cId, {});
          votesMap.get(cId)![rType] = {
            count: v.count as number,
            voted: userVotesSet.has(`${cId}-${rType}`)
          };
        }
      }
    }

    for (const comment of comments) {
      comment.votes_by_reaction_type = votesMap.get(comment.id as number) || {};
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

    // Generate Gravatar URLs from email and strip email from public response
    await enrichCommentsWithAvatars(topLevel)

    return { comments: topLevel, total: count }
  }

  async createComment(data: any, ip: string, userAgent: string) {
    // Honeypot check
    if (data.website) {
      return { error: 'spam_detected' }
    }

    const isSpam = await this.spamService.checkSpam(data.content, data.author_name, data.author_email, data.author_url || '', ip, userAgent)
    const status = isSpam ? 'spam' : 'pending' // Should read from settings 'require_moderation'
    // Public comments always get 'user' role — admin role is only set via createAdminComment
    const authorRole = 'user'

    const result = await this.db.prepare(`
      INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, ip_address, user_agent, status, author_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.page_url,
      data.parent_id || null,
      data.author_name,
      data.author_email,
      data.author_url || null,
      data.content,
      ip,
      userAgent,
      status,
      authorRole
    ).run()

    if (result.success) {
      return {
        success: true,
        message: status === 'pending' ? 'Your comment is awaiting moderation.' : 'Comment posted successfully.',
        status
      }
    }
    return { error: 'Database error' }
  }

  async createAdminComment(data: any, ip: string, userAgent: string) {
    const result = await this.db.prepare(`
      INSERT INTO comments (page_url, parent_id, author_name, author_email, author_url, content, ip_address, user_agent, status, author_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.page_url,
      data.parent_id || null,
      data.author_name,
      data.author_email,
      data.author_url || null,
      data.content,
      ip,
      userAgent,
      'approved',
      'admin'
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

  async getRecentComments(limit: number) {
    const { results } = await this.db.prepare(`
      SELECT * FROM comments
      WHERE status = 'approved'
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all()

    for (const row of results) {
      const content = row.content as string;
      row.excerpt = content.length > 150 ? content.substring(0, 150) + '...' : content;
    }
    // Generate Gravatar URLs from email and strip email from public response
    await enrichCommentsWithAvatars(results as any[])
    return { comments: results }
  }
}
