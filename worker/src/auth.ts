import { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

export const ADMIN_TOKEN_COOKIE = 'comment_admin_token'
export const SESSION_LIFETIME = 3600 * 24 * 30 // 30 days

// ── PBKDF2 Configuration ────────────────────────────────────────────────────
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_HASH = 'SHA-256'
const SALT_LENGTH = 16 // bytes
const HASH_LENGTH = 32 // bytes

// ── Rate Limiting Configuration ──────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_WINDOW_MINUTES = 15
const CLEANUP_THRESHOLD_HOURS = 72

// ── Helper: base64 encode/decode ─────────────────────────────────────────────
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── PBKDF2 Password Hashing ─────────────────────────────────────────────────

/**
 * Hash a password using PBKDF2-HMAC-SHA-256 with a random salt.
 * Returns a storable string: `iterations:base64(salt):base64(hash)`
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    HASH_LENGTH * 8
  )

  const hash = new Uint8Array(derivedBits)
  return `${PBKDF2_ITERATIONS}:${bytesToBase64(salt)}:${bytesToBase64(hash)}`
}

/**
 * Verify a password against a stored PBKDF2 hash string.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3) return false

  const iterations = parseInt(parts[0], 10)
  // Cloudflare Workers runtime caps PBKDF2 at 100 000 iterations
  if (isNaN(iterations) || iterations < 100_000 || iterations > 100_000) return false

  const salt = base64ToBytes(parts[1])
  const expectedHash = base64ToBytes(parts[2])

  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    expectedHash.length * 8
  )

  const derivedHash = new Uint8Array(derivedBits)

  // Constant-time comparison
  if (derivedHash.length !== expectedHash.length) return false
  let diff = 0
  for (let i = 0; i < derivedHash.length; i++) {
    diff |= derivedHash[i] ^ expectedHash[i]
  }
  return diff === 0
}

/**
 * Check if a stored hash is in the legacy plain SHA-256 hex format
 * (64 hex chars, no colon separators).
 */
function isLegacyHash(stored: string): boolean {
  return /^[0-9a-f]{64}$/.test(stored)
}

// ── Auth Service ─────────────────────────────────────────────────────────────

export class AuthService {
  private db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  // ── Settings helpers ────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    const result = await this.db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
    return result?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run()
  }

  // ── Password management ─────────────────────────────────────────────────

  /**
   * Set the admin password. Hashes it with PBKDF2 and stores the hash.
   */
  async setPassword(password: string): Promise<void> {
    const hash = await hashPassword(password)
    await this.setSetting('admin_password_hash', hash)
  }

  /**
   * Verify a password against the stored admin password hash.
   * If the stored hash is legacy SHA-256, it will not match (backward
   * compatibility is intentionally removed per requirements).
   */
  private async verifyAdminPassword(password: string): Promise<boolean> {
    const stored = await this.getSetting('admin_password_hash')
    if (!stored) return false

    // Reject legacy plain SHA-256 hashes — they must be replaced
    if (isLegacyHash(stored)) return false

    return verifyPassword(password, stored)
  }

  // ── Session management ──────────────────────────────────────────────────

  async isAdmin(c: Context): Promise<boolean> {
    // 1. Check cookie
    const token = getCookie(c, ADMIN_TOKEN_COOKIE)
    if (!token) {
      // 2. Check Authorization header
      const authHeader = c.req.header('Authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return this.validateSession(authHeader.substring(7))
      }
      return false
    }

    return this.validateSession(token)
  }

  private async validateSession(token: string): Promise<boolean> {
    const session = await this.db
      .prepare('SELECT id FROM sessions WHERE token = ? AND expires_at > datetime(\'now\')')
      .bind(token)
      .first<{ id: number }>()

    if (!session) return false

    // Update last activity
    await this.db
      .prepare('UPDATE sessions SET last_activity = datetime(\'now\') WHERE id = ?')
      .bind(session.id)
      .run()

    return true
  }

  private async createSession(token: string, ip: string, userAgent: string): Promise<void> {
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')

    await this.db
      .prepare('INSERT INTO sessions (token, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?)')
      .bind(token, expiresAt, ip, userAgent)
      .run()
  }

  private async deleteSession(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  }

  /**
   * Generate a cryptographically secure random session token.
   * 64 hex characters (256 bits of entropy).
   */
  private generateSessionToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return bytesToHex(bytes)
  }

  // ── Rate limiting ───────────────────────────────────────────────────────

  async isLoginRateLimited(ip: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM login_attempts
         WHERE ip_address = ? AND attempted_at > datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes') AND success = 0`
      )
      .bind(ip)
      .first<{ count: number }>()

    return (result?.count ?? 0) >= MAX_LOGIN_ATTEMPTS
  }

  async recordLoginAttempt(ip: string, success: boolean): Promise<void> {
    await this.db
      .prepare('INSERT INTO login_attempts (ip_address, success) VALUES (?, ?)')
      .bind(ip, success ? 1 : 0)
      .run()
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  /**
   * Remove expired sessions from the database.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const { meta } = await this.db
      .prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')')
      .run()
    return meta.changes || 0
  }

  /**
   * Remove old login attempts older than the threshold.
   */
  async cleanupOldLoginAttempts(): Promise<number> {
    const { meta } = await this.db
      .prepare(`DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-${CLEANUP_THRESHOLD_HOURS} hours')`)
      .run()
    return meta.changes || 0
  }

  // ── Login / Logout ──────────────────────────────────────────────────────

  async login(c: Context, password: string, ip: string, userAgent: string): Promise<any> {
    if (await this.isLoginRateLimited(ip)) {
      return { error: 'too_many_requests' }
    }

    const success = await this.verifyAdminPassword(password)

    if (!success) {
      await this.recordLoginAttempt(ip, false)
      return { error: 'invalid_password' }
    }

    await this.recordLoginAttempt(ip, true)

    // Run cleanup in the background (best-effort, non-blocking)
    this.cleanupExpiredSessions().catch(() => {})
    this.cleanupOldLoginAttempts().catch(() => {})

    const token = this.generateSessionToken()
    await this.createSession(token, ip, userAgent)

    setCookie(c, ADMIN_TOKEN_COOKIE, token, {
      maxAge: SESSION_LIFETIME,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    })

    return { token }
  }

  async logout(c: Context): Promise<void> {
    const token = getCookie(c, ADMIN_TOKEN_COOKIE)
    if (token) {
      await this.deleteSession(token)
    }
    deleteCookie(c, ADMIN_TOKEN_COOKIE, { path: '/' })
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
