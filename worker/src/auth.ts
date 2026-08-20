import { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

export const ADMIN_TOKEN_COOKIE = 'comment_admin_token'
export const SESSION_LIFETIME = 3600 * 24 * 30

export class AuthService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async getSetting(key: string): Promise<string | null> {
    const result = await this.db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{value: string}>()
    return result?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run()
  }

  async deleteSetting(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run()
  }

  async isAdmin(c: Context): Promise<boolean> {
    // 1. Check Cookie
    const token = getCookie(c, ADMIN_TOKEN_COOKIE)
    if (!token) return false

    // 2. Check session in DB
    const session = await this.db.prepare('SELECT id FROM sessions WHERE token = ? AND expires_at > datetime("now")').bind(token).first<{id: number}>()
    if (session) {
      await this.db.prepare('UPDATE sessions SET last_activity = datetime("now") WHERE id = ?').bind(session.id).run()
      return true
    }

    // 3. Fallback to legacy admin_token
    const storedToken = await this.getSetting('admin_token')
    if (storedToken && storedToken === token) {
      return true
    }

    // 4. Try auth header
    const authHeader = c.req.header('Authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
       const bearer = authHeader.substring(7)
       const bearerSession = await this.db.prepare('SELECT id FROM sessions WHERE token = ? AND expires_at > datetime("now")').bind(bearer).first<{id: number}>()
       if(bearerSession) {
          await this.db.prepare('UPDATE sessions SET last_activity = datetime("now") WHERE id = ?').bind(bearerSession.id).run()
          return true
       }
    }

    return false
  }

  async isLoginRateLimited(ip: string): Promise<boolean> {
    const result = await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM login_attempts
      WHERE ip_address = ? AND attempted_at > datetime('now', '-1 hour') AND success = 0
    `).bind(ip).first<{count: number}>()

    return (result?.count ?? 0) >= 5
  }

  async recordLoginAttempt(ip: string, success: boolean): Promise<void> {
    await this.db.prepare('INSERT INTO login_attempts (ip_address, success) VALUES (?, ?)').bind(ip, success ? 1 : 0).run()
  }

  async login(c: Context, password: string, ip: string, userAgent: string): Promise<any> {
    if (await this.isLoginRateLimited(ip)) {
      return { error: 'too_many_requests' }
    }

    const hash = await this.getSetting('admin_password_hash')
    if (!hash) {
      return { error: 'admin_password_not_set' }
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const inputHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const success = (inputHash === hash);

    if (!success) {
      await this.recordLoginAttempt(ip, false)
      return { error: 'invalid_password' }
    }

    await this.recordLoginAttempt(ip, true)

    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME * 1000).toISOString().slice(0, 19).replace('T', ' ')

    await this.db.prepare('INSERT INTO sessions (token, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?)').bind(token, expiresAt, ip, userAgent).run()
    await this.setSetting('admin_token', token)

    setCookie(c, ADMIN_TOKEN_COOKIE, token, {
      maxAge: SESSION_LIFETIME,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax'
    })

    return { token }
  }

  async logout(c: Context): Promise<void> {
    const token = getCookie(c, ADMIN_TOKEN_COOKIE)
    if (token) {
      await this.db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
      await this.deleteSetting('admin_token')
    }
    deleteCookie(c, ADMIN_TOKEN_COOKIE)
  }
}

export async function adminMiddleware(c: Context, next: Next) {
  const auth = new AuthService(c.env.DB)
  const isAuth = await auth.isAdmin(c)
  if (!isAuth) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
