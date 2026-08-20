import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AuthService } from './auth'
import { CommentService } from './comments'
import { ReactionService } from './reactions'
import { AdminService } from './admin'
import { RateLimitService } from "./ratelimit"
import { ImportExportService } from "./importexport"
import { SettingsService } from './settings'
import { TelegramService } from './telegram'

type Bindings = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  ADMIN_PASSWORD_HASH?: string
  TELEGRAM_BOT_TOKEN?: string
}

const app = new Hono<{ Bindings: Bindings }>()

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

app.get('/', (c) => c.text('Cloudflare Comments API is running.'))

// Allow /api as the new canonical endpoint, while keeping /api.php for backward compatibility
const handler = async (c: any) => {
  const method = c.req.method
  const action = c.req.query('action')

  const db = c.env.DB

  const auth = new AuthService(db)
  const comments = new CommentService(db)
  const reactions = new ReactionService(db)
  const admin = new AdminService(db)
  const settings = new SettingsService(db)
  const ratelimit = new RateLimitService(db)
  const importExport = new ImportExportService(db)

  const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1'
  const userAgent = c.req.header('User-Agent') || ''

  try {
    // ── Public Routes ─────────────────────────────────────────────

    if (method === 'GET' && action === 'widget_config') {
      const config = await settings.getAllSettings()
      return c.json({
        require_moderation: config.require_moderation === 'true',
        allow_guest_comments: config.allow_guest_comments === 'true',
        max_comment_length: parseInt(config.max_comment_length || '5000'),
        language: config.app_language || 'en'
      })
    }

    if (method === 'GET' && action === 'comments') {
      const url = c.req.query('url')
      if (!url) return c.json({ error: 'URL is required' }, 400)
      const limit = parseInt(c.req.query('limit') || '500')
      const offset = parseInt(c.req.query('offset') || '0')
      const result = await comments.getComments(url, limit, offset, ip)

      // Also fetch and attach post_reactions to the result
      const postReactionsSummary = await reactions.getPostReactionsSummary(url, ip)
      return c.json({ ...result, post_reactions: postReactionsSummary })
    }

    if (method === 'GET' && action === 'recent') {
      const limit = parseInt(c.req.query('limit') || '8')
      const result = await comments.getRecentComments(limit)
      return c.json(result)
    }

    if (method === 'POST' && action === 'post') {
      const body = await c.req.json()
      if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
      const result = await comments.createComment(body, ip, userAgent)

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

      return c.json(result)
    }

    if (method === 'POST' && action === 'post_reaction') {
      const body = await c.req.json()
      if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
      if (await ratelimit.isVoteRateLimited(ip)) return c.json({ error: "Too many votes. Please try again later." }, 429)

      const result = await reactions.togglePostReaction(body.page_url || body.url, ip, body.reaction_type)
      return c.json(result)
    }

    if (method === 'POST' && action === 'vote') {
      const body = await c.req.json()
      if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
      if (await ratelimit.isVoteRateLimited(ip)) return c.json({ error: "Too many votes. Please try again later." }, 429)

      const result = await reactions.toggleVote(body.comment_id, ip, body.reaction_type)
      return c.json(result)
    }

    if (method === 'GET' && action === 'post_reactions_summary') {
      const url = c.req.query('url')
      if (!url) {
        // Return global summary if no url is provided
        const result = await reactions.getGlobalPostReactionsSummary()
        return c.json(result)
      }
      const result = await reactions.getPostReactionsSummary(url, ip)
      return c.json(result)
    }


    // ── Auth Routes ─────────────────────────────────────────────

    if (method === 'POST' && action === 'login') {
      const body = await c.req.json()
      if (await ratelimit.isCommentRateLimited(ip)) return c.json({ error: "Too many comments. Please try again later." }, 429)
      const result = await auth.login(c, body.password, ip, userAgent)
      if (result.error) return c.json(result, 401)
      return c.json({ success: true, message: 'Logged in successfully', csrf_token: 'dummy_csrf' })
    }

    if (method === 'GET' && action === 'csrf_token') {
      return c.json({ token: 'dummy_csrf' })
    }

    if (method === 'POST' && action === 'logout') {
      await auth.logout(c)
      return c.json({ success: true })
    }

    // ── Admin Routes ─────────────────────────────────────────────

    // Check admin
    if (!(await auth.isAdmin(c))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (method === 'GET' && action === 'post_reactions_latest') {
      const limit = parseInt(c.req.query('limit') || '10')
      const result = await reactions.getLatestPostReactions(limit)
      return c.json(result)
    }

    if (method === 'POST' && action === 'admin_post') {
      const body = await c.req.json()
      const result = await comments.createAdminComment(body, ip, userAgent)
      // No Telegram notification for admin comments
      return c.json(result)
    }

    if (method === 'GET' && action === 'pending') {
      const result = await db.prepare("SELECT * FROM comments WHERE status = 'pending' ORDER BY created_at DESC").all()

      const commentIds = result.results.map((c: any) => c.id).join(',');
      const votesMap = new Map<number, Record<string, any>>();
      if (commentIds) {
        const { results: votes } = await db.prepare(`SELECT comment_id, reaction_type, COUNT(*) as count FROM votes WHERE comment_id IN (${commentIds}) GROUP BY comment_id, reaction_type`).all();
        for (const v of votes) {
          const cId = v.comment_id as number;
          if (!votesMap.has(cId)) votesMap.set(cId, {});
          const rType = v.reaction_type as string;
          votesMap.get(cId)![rType] = v.count as number;
        }
      }

      for (const comment of result.results) {
        comment.votes_by_reaction_type = votesMap.get(comment.id as number) || {};
      }

      return c.json({ comments: result.results, total: result.results.length })
    }

    if (method === 'GET' && action === 'all') {
      const limit = parseInt(c.req.query('limit') || '50')
      const offset = parseInt(c.req.query('offset') || '0')
      const status = c.req.query('status')
      const search = c.req.query('search')

      let query = "SELECT * FROM comments"
      let countQuery = "SELECT COUNT(*) as count FROM comments"
      let conditions = []
      let params = []

      if (status && status !== 'all') {
        conditions.push("status = ?")
        params.push(status)
      }

      if (search) {
        conditions.push("(author_name LIKE ? OR content LIKE ? OR author_email LIKE ?)")
        const searchTerm = `%${search}%`
        params.push(searchTerm, searchTerm, searchTerm)
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ")
        countQuery += " WHERE " + conditions.join(" AND ")
      }

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"

      const countStmt = db.prepare(countQuery)
      const stmt = db.prepare(query)

      const countResult = await countStmt.bind(...params).first()
      const totalCount = countResult ? countResult.count : 0

      const result = await stmt.bind(...params, limit, offset).all()

      const commentIdsAll = result.results.map((c: any) => c.id).join(',');
      const votesMapAll = new Map<number, Record<string, any>>();
      if (commentIdsAll) {
        const { results: votes } = await db.prepare(`SELECT comment_id, reaction_type, COUNT(*) as count FROM votes WHERE comment_id IN (${commentIdsAll}) GROUP BY comment_id, reaction_type`).all();
        for (const v of votes) {
          const cId = v.comment_id as number;
          if (!votesMapAll.has(cId)) votesMapAll.set(cId, {});
          const rType = v.reaction_type as string;
          votesMapAll.get(cId)![rType] = v.count as number;
        }
      }

      for (const comment of result.results) {
        comment.votes_by_reaction_type = votesMapAll.get(comment.id as number) || {};
      }

      // Calculate aggregates
      const aggregatesResult = await db.prepare("SELECT status, COUNT(*) as count FROM comments GROUP BY status").all()
      const aggregates: Record<string, number> = { pending: 0, approved: 0, spam: 0, all: 0 }
      for (const row of aggregatesResult.results) {
        aggregates[row.status as string] = row.count as number
        aggregates.all += row.count as number
      }

      return c.json({
        comments: result.results,
        pagination: { total: totalCount },
        aggregates
      })
    }

    if (method === 'PUT' && action === 'moderate') {
      const body = await c.req.json().catch(() => ({}))
      const id = parseInt(c.req.query('id') || '0') || body.id
      const result = await comments.moderateComment(id, body.status)
      return c.json(result)
    }

    if (method === 'PUT' && action === 'edit_content') {
      const body = await c.req.json().catch(() => ({}))
      const id = parseInt(c.req.query('id') || '0') || body.id
      const result = await comments.editComment(id, body.content)
      return c.json(result)
    }

    if (method === 'DELETE' && action === 'delete') {
      const body = await c.req.json().catch(() => ({}))
      const id = parseInt(c.req.query('id') || '0') || body.id
      const result = await comments.deleteComment(id)
      return c.json(result)
    }

    if (method === 'GET' && action === 'analytics') {
      const result = await admin.getAnalytics()
      return c.json(result)
    }

    if (method === 'GET' && action === 'db_stats') {
      const result = await admin.getDbStats()
      return c.json(result)
    }

    if (method === 'POST' && action === 'vacuum') {
      const result = await admin.vacuumDb()
      return c.json(result)
    }


    if (method === 'GET' && action === 'get_config') {
      const config = await settings.getAllSettings()
      let allowed_origins = c.env.ALLOWED_ORIGINS ? c.env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()) : ['*']
      if (config.allowed_origins) {
        try {
          allowed_origins = JSON.parse(config.allowed_origins)
        } catch {
          allowed_origins = config.allowed_origins.split(',').map((o: string) => o.trim())
        }
      }
      return c.json({
        ...config,
        allowed_origins
      })
    }


    if (method === 'GET' && action === 'get_settings') {
      const result = await settings.getAllSettings()
      return c.json({ settings: result })
    }

    if (method === 'POST' && action === 'save_settings') {
      const body = await c.req.json()
      const result = await settings.saveSettings(body)
      return c.json(result)
    }

    if (method === 'POST' && action === 'save_config') {
      const body = await c.req.json()
      // Save config as settings. The system currently uses `settings` to store both `settings` and `config`.
      const result = await settings.saveSettings(body)
      return c.json(result)
    }

    // ── Telegram Admin Toggle ────────────────────────────────────────

    if (method === 'GET' && action === 'telegram_status') {
      const telegram = new TelegramService(db)
      const tgSettings = await telegram.getSettings()
      return c.json({
        telegram_enabled: tgSettings.telegram_enabled === 'true',
        chat_id_set: tgSettings.telegram_chat_id !== '',
        bot_token_set: !!(c.env.TELEGRAM_BOT_TOKEN as string),
      })
    }

    if (method === 'POST' && action === 'telegram_toggle') {
      const telegram = new TelegramService(db)
      const body = await c.req.json().catch(() => ({}))
      const enabled = body.telegram_enabled === true || body.telegram_enabled === 'true' ? 'true' : 'false'
      await telegram.saveSettings({ telegram_enabled: enabled })
      return c.json({ success: true, telegram_enabled: enabled === 'true' })
    }

    if (method === 'POST' && action === 'import_comments') {
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
    }

    if (method === 'POST' && action === 'db_delete_data') {
      const body = await c.req.json()
      let result: Record<string, number> = {}

      if (body.delete_comments) {
        const { meta } = await db.prepare('DELETE FROM comments').run()
        result.comments = meta.changes || 0
      }
      if (body.delete_reactions) {
        const { meta: postMeta } = await db.prepare('DELETE FROM post_reactions').run()
        const { meta: voteMeta } = await db.prepare('DELETE FROM votes').run()
        result.reactions = (postMeta.changes || 0) + (voteMeta.changes || 0)
      }

      return c.json({ deleted: result })
    }

    if (method === 'GET' && action === 'export_comments_json') {
      const result = await importExport.exportFullJson()
      const dateStr = new Date().toISOString().slice(0, 10)
      return new Response(JSON.stringify(result, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="comments-backup-${dateStr}.json"`
        }
      })
    }

    if (method === 'DELETE' && action === 'delete_single_reaction') {
      const id = parseInt(c.req.query('id') || '0')
      const result = await reactions.deleteReaction(id)
      return c.json(result)
    }

    return c.json({ error: 'Unknown action or method' }, 404)

  } catch (e: any) {
    return c.json({ error: 'Internal Server Error', message: e.message }, 500)
  }
}

app.all('/api', handler)
app.all('/api.php', handler)

export default app
