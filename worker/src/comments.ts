import { SpamService } from './spam'

// Lightweight MD5 implementation for Gravatar hashing
function md5(str: string): string {
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3]

    a = ff(a, b, c, d, k[0], 7, -680876936)
    d = ff(d, a, b, c, k[1], 12, -389564586)
    c = ff(c, d, a, b, k[2], 17, 606105819)
    b = ff(b, c, d, a, k[3], 22, -1044525330)
    a = ff(a, b, c, d, k[4], 7, -176418897)
    d = ff(d, a, b, c, k[5], 12, 1200080426)
    c = ff(c, d, a, b, k[6], 17, -1473231341)
    b = ff(b, c, d, a, k[7], 22, -45705983)
    a = ff(a, b, c, d, k[8], 7, 1770035416)
    d = ff(d, a, b, c, k[9], 12, -1958414417)
    c = ff(c, d, a, b, k[10], 17, -42063)
    b = ff(b, c, d, a, k[11], 22, -1990404162)
    a = ff(a, b, c, d, k[12], 7, 1804603682)
    d = ff(d, a, b, c, k[13], 12, -40341101)
    c = ff(c, d, a, b, k[14], 17, -1502002290)
    b = ff(b, c, d, a, k[15], 22, 1236535329)

    a = gg(a, b, c, d, k[1], 5, -165796510)
    d = gg(d, a, b, c, k[6], 9, -1069501632)
    c = gg(c, d, a, b, k[11], 14, 643717713)
    b = gg(b, c, d, a, k[0], 20, -373897302)
    a = gg(a, b, c, d, k[5], 5, -701558691)
    d = gg(d, a, b, c, k[10], 9, 38016083)
    c = gg(c, d, a, b, k[15], 14, -660478335)
    b = gg(b, c, d, a, k[4], 20, -405537848)
    a = gg(a, b, c, d, k[9], 5, 568446438)
    d = gg(d, a, b, c, k[14], 9, -1019803690)
    c = gg(c, d, a, b, k[3], 14, -187363961)
    b = gg(b, c, d, a, k[8], 20, 1163531501)
    a = gg(a, b, c, d, k[13], 5, -1444681467)
    d = gg(d, a, b, c, k[2], 9, -51403784)
    c = gg(c, d, a, b, k[7], 14, 1735328473)
    b = gg(b, c, d, a, k[12], 20, -1926607734)

    a = hh(a, b, c, d, k[5], 4, -378558)
    d = hh(d, a, b, c, k[8], 11, -2022574463)
    c = hh(c, d, a, b, k[11], 16, 1839030562)
    b = hh(b, c, d, a, k[14], 23, -35309556)
    a = hh(a, b, c, d, k[1], 4, -1530992060)
    d = hh(d, a, b, c, k[4], 11, 1272893353)
    c = hh(c, d, a, b, k[7], 16, -155497632)
    b = hh(b, c, d, a, k[10], 23, -1094730640)
    a = hh(a, b, c, d, k[13], 4, 681279174)
    d = hh(d, a, b, c, k[0], 11, -358537222)
    c = hh(c, d, a, b, k[3], 16, -722521979)
    b = hh(b, c, d, a, k[6], 23, 76029189)
    a = hh(a, b, c, d, k[9], 4, -640364487)
    d = hh(d, a, b, c, k[12], 11, -421815835)
    c = hh(c, d, a, b, k[15], 16, 530742520)
    b = hh(b, c, d, a, k[2], 23, -995338651)

    a = ii(a, b, c, d, k[0], 6, -198630844)
    d = ii(d, a, b, c, k[7], 10, 1126891415)
    c = ii(c, d, a, b, k[14], 15, -1416354905)
    b = ii(b, c, d, a, k[5], 21, -57434055)
    a = ii(a, b, c, d, k[12], 6, 1700485571)
    d = ii(d, a, b, c, k[3], 10, -1894986606)
    c = ii(c, d, a, b, k[10], 15, -1051523)
    b = ii(b, c, d, a, k[1], 21, -2054922799)
    a = ii(a, b, c, d, k[8], 6, 1873313359)
    d = ii(d, a, b, c, k[15], 10, -30611744)
    c = ii(c, d, a, b, k[6], 15, -1560198380)
    b = ii(b, c, d, a, k[13], 21, 1309151649)
    a = ii(a, b, c, d, k[4], 6, -145523070)
    d = ii(d, a, b, c, k[11], 10, -1120210379)
    c = ii(c, d, a, b, k[2], 15, 718787259)
    b = ii(b, c, d, a, k[9], 21, -343485551)

    x[0] = add32(a, x[0])
    x[1] = add32(b, x[1])
    x[2] = add32(c, x[2])
    x[3] = add32(d, x[3])
  }

  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t))
    return add32((a << s) | (a >>> (32 - s)), b)
  }

  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | ((~b) & d), a, b, x, s, t)
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & (~d)), a, b, x, s, t)
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t)
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | (~d)), a, b, x, s, t)
  }

  function md51(s: string) {
    const n = s.length
    let state = [1732584193, -271733879, -1732584194, 271733878]
    let i: number
    for (i = 64; i <= n; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)))
    }
    s = s.substring(i - 64)
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (i = 0; i < s.length; i++) {
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3)
    }
    tail[i >> 2] |= 0x80 << ((i % 4) << 3)
    if (i > 55) {
      md5cycle(state, tail)
      for (i = 0; i < 16; i++) tail[i] = 0
    }
    tail[14] = n * 8
    md5cycle(state, tail)
    return state
  }

  function md5blk(s: string) {
    const md5blks: number[] = []
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24)
    }
    return md5blks
  }

  const hex_chr = '0123456789abcdef'.split('')

  function rhex(n: number) {
    let s = ''
    for (let j = 0; j < 4; j++) {
      s += hex_chr[(n >> (j * 8 + 4)) & 0x0f] + hex_chr[(n >> (j * 8)) & 0x0f]
    }
    return s
  }

  function hex(x: number[]) {
    return x.map(rhex).join('')
  }

  function add32(a: number, b: number) {
    return (a + b) & 0xFFFFFFFF
  }

  return hex(md51(str))
}

function getGravatarUrl(email: string, size = 80): string {
  const normalized = email.trim().toLowerCase()
  const hash = md5(normalized)
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`
}

function enrichCommentsWithAvatars(comments: any[]): void {
  for (const comment of comments) {
    if (comment.author_email) {
      comment.author_avatar = getGravatarUrl(comment.author_email as string)
    }
    // Don't expose email to public consumers
    delete comment.author_email
    // Recurse into replies
    if (comment.replies && Array.isArray(comment.replies)) {
      enrichCommentsWithAvatars(comment.replies)
    }
  }
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
    if (commentIds) {
      const { results: votes } = await this.db.prepare(`SELECT comment_id, reaction_type, COUNT(*) as count FROM votes WHERE comment_id IN (${commentIds}) GROUP BY comment_id, reaction_type`).all();

      const { results: userVotes } = await this.db.prepare(`SELECT comment_id, reaction_type FROM votes WHERE comment_id IN (${commentIds}) AND ip_address = ?`).bind(ip).all();
      const userVotesSet = new Set(userVotes.map(v => `${v.comment_id}-${v.reaction_type}`));

      for (const v of votes) {
        const cId = v.comment_id as number;
        if (!votesMap.has(cId)) votesMap.set(cId, {});
        const rType = v.reaction_type as string;
        votesMap.get(cId)![rType] = {
          count: v.count as number,
          voted: userVotesSet.has(`${cId}-${rType}`)
        };
      }
    }

    for (const comment of comments) {
      comment.votes_by_reaction_type = votesMap.get(comment.id as number) || {};
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
    enrichCommentsWithAvatars(topLevel)

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
    enrichCommentsWithAvatars(results as any[])
    return { comments: results }
  }
}
