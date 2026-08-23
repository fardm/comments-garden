import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AuthService } from './auth'
import { CommentService, getGravatarHash } from './comments'
import { ReactionService } from './reactions'
import { AdminService } from './admin'
import { RateLimitService } from './ratelimit'
import { ImportExportService } from './importexport'
import { SettingsService } from './settings'
import { TelegramService } from './telegram'
import { getCachedResponse, cacheResponse, invalidatePageCache, invalidateRecentCache, fetchCachedGravatar } from './cache'

type Bindings = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TELEGRAM_BOT_TOKEN?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ── Helper: look up a comment's page_url for cache invalidation ──────────

async function getCommentPageUrl(db: D1Database, commentId: number): Promise<string | undefined> {
  const row = await db.prepare('SELECT page_url FROM comments WHERE id = ?').bind(commentId).first()
  return row?.page_url as string | undefined
}

// ── Helper: invalidate caches for a comment page ─────────────────────────

function invalidateCommentCaches(c: any, db: D1Database, pageUrl?: string): void {
  invalidateRecentCache(c)
  if (pageUrl) invalidatePageCache(c, pageUrl)
}

// ── CORS Middleware ───────────────────────────────────────────────────────────

app.use('*', async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS || '*'

  const corsMiddleware = cors({
    origin: allowedOrigins === '*' ? '*' : allowedOrigins.split(',').map(o => o.trim()),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
    credentials: true,
  })

  return corsMiddleware(c, next)
})

// ── Health Check ─────────────────────────────────────────────────────────────

app.get('/', (c) => c.text('Cloudflare Comments API is running.'))

// ── Helper: generate admin avatar URL ────────────────────────────────────────

async function getAdminAvatar(settings: SettingsService): Promise<string> {
  const config = await settings.getAllSettings()
  const adminEmail = (config.admin_email || '').trim().toLowerCase()
  if (!adminEmail) {
    return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' fill='%236c757d'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='40' font-family='sans-serif'>A</text></svg>"
  }
  const hashHex = await getGravatarHash(adminEmail)
  return `/api/gravatar/${hashHex}?s=32`
}

// ── Helper: parse enabled reactions from settings ────────────────────────────

async function getEnabledReactions(settings: SettingsService): Promise<string[]> {
  const ALL_REACTIONS = ['thumbsup','lightbulb','pray','ok','fire','heart','frown','rage','funny','neutral']
  const config = await settings.getAllSettings()
  if (config.enabled_reactions) {
    try {
      const parsed = JSON.parse(config.enabled_reactions)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {}
  }
  return ALL_REACTIONS
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── Widget Config ────────────────────────────────────────────────────────────

app.get('/api/config', async (c) => {
  const settings = new SettingsService(c.env.DB)
  const config = await settings.getAllSettings()
  const enabledReactions = await getEnabledReactions(settings)
  return c.json({
    require_moderation: config.require_moderation === 'true',
    allow_guest_comments: config.allow_guest_comments === 'true',
    max_comment_length: parseInt(config.max_comment_length || '5000'),
    language: config.app_language || 'en',
    enabled_reactions: enabledReactions
  })
})

// ── Comments ─────────────────────────────────────────────────────────────────

app.get('/api/comments', async (c) => {
  // Check cache first
  const cached = await getCachedResponse(c, c.req.raw)
  if (cached) return cached

  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const comments = new CommentService(db)
  const reactions = new ReactionService(db)
  const settings = new SettingsService(db)

  const url = c.req.query('url')
  if (!url) return c.json({ error: 'URL is required' }, 400)
  const limit = parseInt(c.req.query('limit') || '500')
  const offset = parseInt(c.req.query('offset') || '0')
  const result = await comments.getComments(url, limit, offset, ip)

  const postReactionsSummary = await reactions.getPostReactionsSummary(url, ip)
  const admin_avatar_url = await getAdminAvatar(settings)
  const response = c.json({ ...result, post_reactions: postReactionsSummary, admin_avatar_url })

  // Cache the successful response
  cacheResponse(c, c.req.raw, response)
  return response
})

app.get('/api/comments/recent', async (c) => {
  // Check cache first
  const cached = await getCachedResponse(c, c.req.raw)
  if (cached) return cached

  const comments = new CommentService(c.env.DB)
  const limit = parseInt(c.req.query('limit') || '8')
  const result = await comments.getRecentComments(limit)
  const response = c.json(result)

  // Cache the successful response
  cacheResponse(c, c.req.raw, response)
  return response
})

app.post('/api/comments', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const comments = new CommentService(db)
  const ratelimit = new RateLimitService(db)
  const settings = new SettingsService(db)

  const body = await c.req.json()
  if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
  const result = await comments.createComment(body, ip)

  // Fire-and-forget Telegram notification via waitUntil
  if (result.success) {
    const telegram = new TelegramService(db)
    const telegramSettings = await telegram.getSettings()
    const botToken = c.env.TELEGRAM_BOT_TOKEN as string | undefined
    console.log(`[Telegram] Comment posted. enabled=${telegramSettings.telegram_enabled}, hasToken=${!!botToken}, chatId=${telegramSettings.telegram_chat_id || '(empty)'}`)
    if (telegramSettings.telegram_enabled === 'true' && botToken && telegramSettings.telegram_chat_id) {
      const ctx = c.executionCtx as any
      if (ctx && typeof ctx.waitUntil === 'function') {
        console.log('[Telegram] Sending notification via waitUntil...')
        ctx.waitUntil((async () => {
          try {
            const ok = await telegram.sendCommentNotification(
              botToken,
              telegramSettings.telegram_chat_id,
              body.page_url || body.url || '',
              body.author_name || 'Anonymous',
              body.content || '',
            )
            console.log(`[Telegram] Notification result: ${ok}`)
          } catch (e) {
            console.error('[Telegram] Background notification failed:', e)
          }
        })())
      } else {
        console.error('[Telegram] executionCtx.waitUntil not available')
      }
    }
  }

  // Invalidate cache for this page and recent comments
  if (result.success) {
    const pageUrl = body.page_url || body.url
    invalidateCommentCaches(c, db, pageUrl)
  }

  return c.json(result)
})

// ── Reactions (Public) ───────────────────────────────────────────────────────

app.post('/api/reactions/post', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const reactions = new ReactionService(db)
  const ratelimit = new RateLimitService(db)
  const settings = new SettingsService(db)

  const body = await c.req.json()
  if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
  if (await ratelimit.isVoteRateLimited(ip)) return c.json({ error: "Too many votes. Please try again later." }, 429)

  const enabledReactions = await getEnabledReactions(settings)
  if (!enabledReactions.includes(body.reaction_type)) {
    return c.json({ error: 'Reaction type is not enabled' }, 400)
  }

  const pageUrl = body.page_url || body.url
  const result = await reactions.togglePostReaction(pageUrl, ip, body.reaction_type)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

app.post('/api/reactions/vote', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const reactions = new ReactionService(db)
  const ratelimit = new RateLimitService(db)
  const settings = new SettingsService(db)

  const body = await c.req.json()
  if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
  if (await ratelimit.isVoteRateLimited(ip)) return c.json({ error: "Too many votes. Please try again later." }, 429)

  const enabledReactions = await getEnabledReactions(settings)
  if (!enabledReactions.includes(body.reaction_type)) {
    return c.json({ error: 'Reaction type is not enabled' }, 400)
  }

  const result = await reactions.toggleVote(body.comment_id, ip, body.reaction_type)
  // Invalidate cache — look up the comment's page_url
  const pageUrl = await getCommentPageUrl(db, body.comment_id)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

app.get('/api/reactions/post/summary', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const reactions = new ReactionService(db)

  const url = c.req.query('url')
  if (!url) {
    const result = await reactions.getGlobalPostReactionsSummary()
    return c.json(result)
  }
  const result = await reactions.getPostReactionsSummary(url, ip)
  return c.json(result)
})

// ── Auth (Public) ────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const userAgent = c.req.header('User-Agent') || ''
  const auth = new AuthService(db)
  const ratelimit = new RateLimitService(db)

  const body = await c.req.json()
  if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
  const result = await auth.login(c, body.password, ip, userAgent)
  if (result.error) return c.json(result, 401)
  ratelimit.cleanupOldLogs().catch(() => {})
  return c.json({ success: true, message: 'Logged in successfully', csrf_token: 'dummy_csrf' })
})

app.post('/api/auth/logout', async (c) => {
  const auth = new AuthService(c.env.DB)
  await auth.logout(c)
  return c.json({ success: true })
})

app.get('/api/auth/csrf-token', async (c) => {
  return c.json({ token: 'dummy_csrf' })
})

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── Admin Auth Middleware ─────────────────────────────────────────────────────

async function isAdmin(ctx: any): Promise<boolean> {
  const auth = new AuthService(ctx.env.DB)
  return await auth.isAdmin(ctx)
}

const requireAdmin = async (c: any, next: any) => {
  if (!(await isAdmin(c))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
}

// Apply auth middleware to ALL admin routes at once
app.use('/api/admin/*', requireAdmin)

// ── Admin Comments ───────────────────────────────────────────────────────────

const adminComments = new Hono<{ Bindings: Bindings }>()

adminComments.get('/', async (c) => {
  const db = c.env.DB
  const comments = new CommentService(db)
  const settings = new SettingsService(db)
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'

  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')
  const status = c.req.query('status')
  const search = c.req.query('search')
  const dateFilter = c.req.query('date')
  const sortBy = c.req.query('sort') === 'asc' ? 'ASC' : 'DESC'

  let query = "SELECT * FROM comments"
  let countQuery = "SELECT COUNT(*) as count FROM comments"
  let conditions = []
  let params: any[] = []

  if (status && status !== 'all') {
    conditions.push("status = ?")
    params.push(status)
  }

  if (search) {
    conditions.push("(author_name LIKE ? OR content LIKE ? OR author_email LIKE ?)")
    const searchTerm = `%${search}%`
    params.push(searchTerm, searchTerm, searchTerm)
  }

  if (dateFilter && dateFilter !== 'all') {
    const dateMap: Record<string, string> = {
      'day': '-1 days',
      'week': '-7 days',
      'month': '-1 months',
      'year': '-1 years',
    }
    const interval = dateMap[dateFilter]
    if (interval) {
      conditions.push("created_at > datetime('now', ?)")
      params.push(interval)
    }
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ")
    countQuery += " WHERE " + conditions.join(" AND ")
  }

  query += ` ORDER BY created_at ${sortBy} LIMIT ? OFFSET ?`

  const countStmt = db.prepare(countQuery)
  const stmt = db.prepare(query)

  const countResult = await countStmt.bind(...params).first()
  const totalCount = countResult ? countResult.count : 0

  const result = await stmt.bind(...params, limit, offset).all()

  const commentIdsAll = result.results.map((c: any) => c.id as number)
  const { votesMap: votesMapAll, adminReactionsMap } = await new ReactionService(db).getCommentReactionsBatch(commentIdsAll)
  // Admin listing returns flat counts (not {count, voted} objects) — flatten
  const flatVotesMap = new Map<number, Record<string, any>>()
  for (const [cId, reactions] of votesMapAll) {
    const flat: Record<string, any> = {}
    for (const [rType, data] of Object.entries(reactions)) {
      flat[rType] = data.count
    }
    flatVotesMap.set(cId, flat)
  }

  for (const comment of result.results) {
    comment.votes_by_reaction_type = flatVotesMap.get(comment.id as number) || {}
    comment.admin_reactions = adminReactionsMap.get(comment.id as number) || []
  }

  const aggregatesResult = await db.prepare("SELECT status, COUNT(*) as count FROM comments GROUP BY status").all()
  const aggregates: Record<string, number> = { pending: 0, approved: 0, spam: 0, all: 0 }
  for (const row of aggregatesResult.results) {
    aggregates[row.status as string] = row.count as number
    aggregates.all += row.count as number
  }

  const admin_avatar_url = await getAdminAvatar(settings)
  return c.json({
    comments: result.results,
    pagination: { total: totalCount },
    aggregates,
    admin_avatar_url
  })
})

adminComments.get('/pending', async (c) => {
  const db = c.env.DB

  const result = await db.prepare("SELECT * FROM comments WHERE status = 'pending' ORDER BY created_at DESC").all()

  const commentIds = result.results.map((c: any) => c.id as number)
  const { votesMap } = await new ReactionService(db).getCommentReactionsBatch(commentIds)
  // Pending listing returns flat counts (not {count, voted} objects) — flatten
  for (const [cId, reactions] of votesMap) {
    const flat: Record<string, any> = {}
    for (const [rType, data] of Object.entries(reactions)) {
      flat[rType] = data.count
    }
    votesMap.set(cId, flat)
  }

  for (const comment of result.results) {
    comment.votes_by_reaction_type = votesMap.get(comment.id as number) || {}
  }

  return c.json({ comments: result.results, total: result.results.length })
})

adminComments.get('/counts', async (c) => {
  const db = c.env.DB

  const counts = await db.prepare("SELECT status, COUNT(*) as count FROM comments GROUP BY status").all()
  const result: Record<string, number> = { pending: 0, approved: 0, spam: 0, deleted: 0, all: 0 }
  for (const row of counts.results) {
    const s = row.status as string
    const c2 = row.count as number
    if (s in result) result[s] = c2
    result.all += c2
  }
  return c.json(result)
})

adminComments.put('/:id/moderate', async (c) => {
  const db = c.env.DB
  const comments = new CommentService(db)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const pageUrl = await getCommentPageUrl(db, id)
  const result = await comments.moderateComment(id, body.status)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

adminComments.put('/:id', async (c) => {
  const db = c.env.DB
  const comments = new CommentService(db)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const pageUrl = await getCommentPageUrl(db, id)
  const result = await comments.editComment(id, body.content)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

adminComments.delete('/:id', async (c) => {
  const db = c.env.DB
  const comments = new CommentService(db)
  const id = parseInt(c.req.param('id'))
  const pageUrl = await getCommentPageUrl(db, id)
  const result = await comments.deleteComment(id)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

adminComments.post('/:id/restore', async (c) => {
  const db = c.env.DB
  const comments = new CommentService(db)
  const id = parseInt(c.req.param('id'))
  const pageUrl = await getCommentPageUrl(db, id)
  const result = await comments.restoreComment(id)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

adminComments.delete('/:id/permanent', async (c) => {
  const db = c.env.DB
  const comments = new CommentService(db)
  const id = parseInt(c.req.param('id'))
  const pageUrl = await getCommentPageUrl(db, id)
  const result = await comments.permanentDeleteComment(id)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

adminComments.post('/', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const comments = new CommentService(db)

  const body = await c.req.json()
  const result = await comments.createAdminComment(body, ip)
  const pageUrl = body.page_url || body.url
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

app.route('/api/admin/comments', adminComments)

// ── Admin Reactions ──────────────────────────────────────────────────────────

const adminReactions = new Hono<{ Bindings: Bindings }>()

adminReactions.post('/vote', async (c) => {
  const db = c.env.DB
  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const reactions = new ReactionService(db)
  const settings = new SettingsService(db)

  const body = await c.req.json()

  const enabledReactions = await getEnabledReactions(settings)
  if (!enabledReactions.includes(body.reaction_type)) {
    return c.json({ error: 'Reaction type is not enabled' }, 400)
  }

  const result = await reactions.toggleAdminVote(body.comment_id, ip, body.reaction_type)
  const pageUrl = await getCommentPageUrl(db, body.comment_id)
  invalidateCommentCaches(c, db, pageUrl)
  return c.json(result)
})

adminReactions.get('/', async (c) => {
  const reactions = new ReactionService(c.env.DB)
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')
  const result = await reactions.getLatestPostReactions(limit, offset)
  return c.json(result)
})

adminReactions.delete('/by-url', async (c) => {
  const db = c.env.DB
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'URL is required' }, 400)
  const { meta } = await db.prepare('DELETE FROM post_reactions WHERE page_url = ?').bind(url).run()
  invalidateCommentCaches(c, db, url)
  return c.json({ success: true, deleted: meta.changes || 0 })
})

adminReactions.delete('/:id', async (c) => {
  const db = c.env.DB
  const reactions = new ReactionService(db)
  const id = parseInt(c.req.param('id'))
  // Look up page_url before deleting for cache invalidation
  const row = await db.prepare('SELECT page_url FROM post_reactions WHERE id = ?').bind(id).first()
  const result = await reactions.deleteReaction(id)
  if (row?.page_url) invalidateCommentCaches(c, db, row.page_url as string)
  return c.json(result)
})

app.route('/api/admin/reactions', adminReactions)

// ── Admin Auth ───────────────────────────────────────────────────────────────

const adminAuth = new Hono<{ Bindings: Bindings }>()

adminAuth.put('/password', async (c) => {
  const auth = new AuthService(c.env.DB)
  const body = await c.req.json()
  if (!body.password || typeof body.password !== 'string' || body.password.length < 4) {
    return c.json({ error: 'Password must be at least 4 characters' }, 400)
  }
  await auth.setPassword(body.password)
  return c.json({ success: true })
})

app.route('/api/admin/auth', adminAuth)

// ── Admin Settings ───────────────────────────────────────────────────────────

const adminSettings = new Hono<{ Bindings: Bindings }>()

adminSettings.get('/', async (c) => {
  const settings = new SettingsService(c.env.DB)
  const result = await settings.getAllSettings()
  return c.json({ settings: result })
})

adminSettings.post('/', async (c) => {
  const settings = new SettingsService(c.env.DB)
  const body = await c.req.json()
  const result = await settings.saveSettings(body)
  return c.json(result)
})

app.route('/api/admin/settings', adminSettings)

// ── Admin Config ─────────────────────────────────────────────────────────────

const adminConfig = new Hono<{ Bindings: Bindings }>()

adminConfig.get('/', async (c) => {
  const settings = new SettingsService(c.env.DB)
  const config = await settings.getAllSettings()
  const allowed_origins = c.env.ALLOWED_ORIGINS ? c.env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()) : ['*']
  return c.json({
    ...config,
    allowed_origins
  })
})

adminConfig.post('/', async (c) => {
  const settings = new SettingsService(c.env.DB)
  const body = await c.req.json()
  const result = await settings.saveSettings(body)
  return c.json(result)
})

app.route('/api/admin/config', adminConfig)

// ── Admin Analytics ──────────────────────────────────────────────────────────

const adminAnalytics = new Hono<{ Bindings: Bindings }>()

adminAnalytics.get('/', async (c) => {
  const admin = new AdminService(c.env.DB)
  const result = await admin.getAnalytics()
  return c.json(result)
})

app.route('/api/admin/analytics', adminAnalytics)

// ── Admin Database ───────────────────────────────────────────────────────────

const adminDb = new Hono<{ Bindings: Bindings }>()

adminDb.get('/stats', async (c) => {
  const admin = new AdminService(c.env.DB)
  const result = await admin.getDbStats()
  return c.json(result)
})

adminDb.post('/vacuum', async (c) => {
  const admin = new AdminService(c.env.DB)
  const result = await admin.vacuumDb()
  return c.json(result)
})

adminDb.post('/delete-data', async (c) => {
  const db = c.env.DB
  const body = await c.req.json()
  let result: Record<string, number> = {}

  if (body.delete_comments) {
    const { meta } = await db.prepare('DELETE FROM comments').run()
    result.comments = meta.changes || 0
  }
  if (body.delete_post_reactions) {
    const { meta } = await db.prepare('DELETE FROM post_reactions').run()
    result.post_reactions = meta.changes || 0
  }
  if (body.delete_comment_reactions) {
    const { meta } = await db.prepare('DELETE FROM comment_reactions').run()
    result.comment_reactions = meta.changes || 0
  }

  return c.json({ deleted: result })
})

adminDb.post('/delete-spam', async (c) => {
  const db = c.env.DB
  const { meta } = await db.prepare("DELETE FROM comments WHERE status = 'spam'").run()
  const deleted_count = meta.changes || 0
  return c.json({ success: true, deleted_count })
})

app.route('/api/admin/db', adminDb)

// ── Admin Telegram ───────────────────────────────────────────────────────────

const adminTelegram = new Hono<{ Bindings: Bindings }>()

adminTelegram.get('/status', async (c) => {
  const telegram = new TelegramService(c.env.DB)
  const tgSettings = await telegram.getSettings()
  return c.json({
    telegram_enabled: tgSettings.telegram_enabled === 'true',
    chat_id_set: tgSettings.telegram_chat_id !== '',
    bot_token_set: !!(c.env.TELEGRAM_BOT_TOKEN as string),
  })
})

adminTelegram.post('/toggle', async (c) => {
  const telegram = new TelegramService(c.env.DB)
  const body = await c.req.json().catch(() => ({}))
  const enabled = body.telegram_enabled === true || body.telegram_enabled === 'true' ? 'true' : 'false'
  await telegram.saveSettings({ telegram_enabled: enabled })
  return c.json({ success: true, telegram_enabled: enabled === 'true' })
})

app.route('/api/admin/telegram', adminTelegram)

// ── Admin Import/Export ──────────────────────────────────────────────────────

const adminImportExport = new Hono<{ Bindings: Bindings }>()

adminImportExport.post('/import', async (c) => {
  const importExport = new ImportExportService(c.env.DB)

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body: expected JSON' }, 400)
  }

  if (!body.content || typeof body.content !== 'string') {
    return c.json({ error: 'Missing or invalid content field' }, 400)
  }

  const preview = c.req.query('preview') === '1'

  if (preview) {
    const result = await importExport.previewImport(body.content)
    if (result.error) return c.json(result, 400)
    return c.json(result)
  } else {
    const result = await importExport.runImport(body.content)
    if (result.error) return c.json(result, 400)
    return c.json(result)
  }
})

adminImportExport.get('/export', async (c) => {
  const importExport = new ImportExportService(c.env.DB)
  return await importExport.exportFullJson()
})

app.route('/api/admin/import-export', adminImportExport)

// ═════════════════════════════════════════════════════════════════════════════
// STATIC / PROXY ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// Gravatar proxy: serves avatars from same-origin to satisfy admin CSP (img-src 'self')
app.get('/api/gravatar/:hash', async (c) => {
  const hash = c.req.param('hash')
  if (!hash || !/^[a-f0-9]{32,64}$/i.test(hash)) {
    return c.json({ error: 'Invalid hash' }, 400)
  }
  const size = c.req.query('s') || '80'
  const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`
  try {
    const resp = await fetchCachedGravatar(gravatarUrl)
    const body = await resp.arrayBuffer()
    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'image/png',
        'Cache-Control': 'public, max-age=86400',
      }
    })
  } catch {
    return c.json({ error: 'Failed to fetch avatar' }, 502)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY LAYER
// Maps legacy ?action= query parameter requests to the new route structure.
// Used by:
//   - Any external integrations, cached frontend bundles, or embeds
//     still using the old action-based API at /api?action=...
//   - /api.php (legacy WordPress/PHP integration path)
// ═════════════════════════════════════════════════════════════════════════════

// Helper: build a redirect URL from legacy ?action= query params
function legacyActionRedirect(c: any, newBase: string): Response {
  const url = new URL(c.req.url)
  url.searchParams.delete('action')
  const qs = url.search.toString()
  return c.redirect(newBase + qs, 302)
}

function handleLegacyAction(c: any): Response | null {
  const action = c.req.query('action')
  if (!action) return null

  // Public routes
  if (action === 'widget_config') return c.redirect('/api/config', 302)
  if (action === 'comments') return legacyActionRedirect(c, '/api/comments')
  if (action === 'recent') return legacyActionRedirect(c, '/api/comments/recent')
  if (action === 'post') return c.redirect('/api/comments', 302)
  if (action === 'post_reaction') return c.redirect('/api/reactions/post', 302)
  if (action === 'vote') return c.redirect('/api/reactions/vote', 302)
  if (action === 'post_reactions_summary') return legacyActionRedirect(c, '/api/reactions/post/summary')

  // Auth routes
  if (action === 'login') return c.redirect('/api/auth/login', 302)
  if (action === 'logout') return c.redirect('/api/auth/logout', 302)
  if (action === 'csrf_token') return c.redirect('/api/auth/csrf-token', 302)

  // Admin comment routes
  if (action === 'all') return legacyActionRedirect(c, '/api/admin/comments')
  if (action === 'pending') return legacyActionRedirect(c, '/api/admin/comments/pending')
  if (action === 'comment_counts') return legacyActionRedirect(c, '/api/admin/comments/counts')
  if (action === 'admin_post') return c.redirect('/api/admin/comments', 302)
  if (action === 'set_password') return c.redirect('/api/admin/auth/password', 302)

  // Admin reaction routes
  if (action === 'admin_vote') return c.redirect('/api/admin/reactions/vote', 302)
  if (action === 'post_reactions_latest') return legacyActionRedirect(c, '/api/admin/reactions')
  if (action === 'delete_single_reaction') {
    const id = new URL(c.req.url).searchParams.get('id')
    return c.redirect(`/api/admin/reactions/${id}`, 302)
  }

  // Admin config/settings routes
  if (action === 'get_config') return c.redirect('/api/admin/config', 302)
  if (action === 'save_config') return c.redirect('/api/admin/config', 302)
  if (action === 'get_settings') return c.redirect('/api/admin/settings', 302)
  if (action === 'save_settings') return c.redirect('/api/admin/settings', 302)

  // Admin analytics routes
  if (action === 'analytics') return c.redirect('/api/admin/analytics', 302)
  if (action === 'db_stats') return c.redirect('/api/admin/db/stats', 302)
  if (action === 'vacuum') return c.redirect('/api/admin/db/vacuum', 302)

  // Admin database routes
  if (action === 'db_delete_data') return c.redirect('/api/admin/db/delete-data', 302)
  if (action === 'delete_spam') return c.redirect('/api/admin/db/delete-spam', 302)

  // Admin Telegram routes
  if (action === 'telegram_status') return c.redirect('/api/admin/telegram/status', 302)
  if (action === 'telegram_toggle') return c.redirect('/api/admin/telegram/toggle', 302)

  // Admin import/export routes
  if (action === 'import_comments') return legacyActionRedirect(c, '/api/admin/import-export/import')
  if (action === 'export_comments_json') return c.redirect('/api/admin/import-export/export', 302)

  return c.json({ error: 'Unknown action' }, 404)
}

// Catch legacy /api?action=... requests (cached frontends, embeds, etc.)
app.all('/api', async (c) => {
  const redirect = handleLegacyAction(c)
  return redirect || c.json({ error: 'Not found' }, 404)
})

// Catch legacy /api.php?action=... requests (WordPress/PHP integrations)
app.all('/api.php', async (c) => {
  const redirect = handleLegacyAction(c)
  return redirect || c.json({ error: 'Not found' }, 404)
})

// ═════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═════════════════════════════════════════════════════════════════════════════

export default app
