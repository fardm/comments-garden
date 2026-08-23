/**
 * Lightweight cache layer using Cloudflare's Cache API (caches.default).
 * Used to cache public comment GET responses and invalidate on mutations.
 */

const CACHE_TTL_SECONDS = 45

// Cloudflare Workers expose `caches.default` but TypeScript typings may not include it.
const cfCache = (caches as any).default as Cache

/**
 * Try to serve a cached response for the given request.
 * Returns the cached Response if found, or null if not.
 */
export async function getCachedResponse(c: any, request: Request): Promise<Response | null> {
  try {
    const cached = await cfCache.match(request)
    return cached || null
  } catch {
    return null
  }
}

/**
 * Cache a successful JSON response for the given request.
 * Uses waitUntil so the response is sent immediately while caching happens in the background.
 */
export function cacheResponse(c: any, request: Request, response: Response): void {
  try {
    // Clone the response so we can read it and cache it
    const cloned = response.clone()
    const ctx = c.executionCtx as any
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          const headers = new Headers(cloned.headers)
          headers.set('Cache-Control', `public, s-maxage=${CACHE_TTL_SECONDS}`)
          const toCache = new Response(cloned.body, {
            status: cloned.status,
            statusText: cloned.statusText,
            headers,
          })
          await cfCache.put(request, toCache)
        })()
      )
    }
  } catch {
    // Caching is best-effort; never break the response
  }
}

/**
 * Invalidate all cached responses that match a given page URL.
 * Uses caches.default.keys() to iterate and delete matching entries.
 */
export function invalidatePageCache(c: any, pageUrl?: string): void {
  if (!pageUrl) return
  try {
    const ctx = c.executionCtx as any
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          const keys = await cfCache.keys()
          for (const req of keys) {
            if (req.url.includes(encodeURIComponent(pageUrl)) || req.url.includes(pageUrl)) {
              await cfCache.delete(req)
            }
          }
        })()
      )
    }
  } catch {
    // Best-effort
  }
}

/**
 * Invalidate all cached responses for the recent-comments endpoint.
 * Called when comments are created, moderated, or deleted.
 */
export function invalidateRecentCache(c: any): void {
  try {
    const ctx = c.executionCtx as any
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(
        (async () => {
          const keys = await cfCache.keys()
          for (const req of keys) {
            if (req.url.includes('/api/comments/recent')) {
              await cfCache.delete(req)
            }
          }
        })()
      )
    }
  } catch {
    // Best-effort
  }
}
