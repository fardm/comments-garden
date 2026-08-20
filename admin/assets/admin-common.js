/**
 * admin-common.js
 * Shared utilities for all admin panel pages.
 *
 * Provides:
 *   - API_URL          constant
 *   - AdminAuth        object  (CSRF, login, logout, checkAuth)
 *   - escapeHtml()     function
 *   - formatBytes()    function
 *   - formatDate()     function  (used by post-reactions, posts)
 *
 * Usage on each page:
 *
 *   // 1. Load this file before the page script:
 *   //    <script src="assets/admin-common.js"></script>
 *
 *   // 2. Call AdminAuth.init() once the DOM is ready:
 *   AdminAuth.init({
 *     // URL used to verify an existing session on page load.
 *     // Should be a lightweight admin-only endpoint for this page.
 *     authProbeUrl: `${API_URL}?action=pending&limit=1`,
 *
 *     // Called after successful auth (either existing session or fresh login).
 *     onSuccess: () => loadDashboard(),
 *   });
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const API_URL = window.COMMENTS_CONFIG?.apiUrl || '/api';

// ── AdminAuth ─────────────────────────────────────────────────────────────────

const AdminAuth = (() => {
    let _csrfToken = null;

    // ── CSRF ──────────────────────────────────────────────────────────────────

    function _readCsrfFromCookie() {
        const prefix = 'csrf_token=';
        for (const raw of decodeURIComponent(document.cookie).split(';')) {
            const c = raw.trim();
            if (c.startsWith(prefix)) return c.slice(prefix.length);
        }
        return null;
    }

    async function ensureCsrfToken() {
        if (!_csrfToken) _csrfToken = _readCsrfFromCookie();
        if (!_csrfToken) {
            try {
                const r = await fetch(`${API_URL}?action=csrf_token`, { credentials: 'include' });
                _csrfToken = (await r.json()).token ?? null;
            } catch (e) {
                console.error('[AdminAuth] CSRF fetch failed', e);
            }
        }
        return _csrfToken;
    }

    // Called after login to store the token returned by the login response.
    function setCsrfToken(token) {
        if (token) _csrfToken = token;
    }

    // Returns the current CSRF token (or null if not yet obtained).
    function getCsrfToken() {
        return _csrfToken;
    }

    // ── Show / hide sections ──────────────────────────────────────────────────

    function _showAdmin() {
        const loginEl = document.getElementById('login-section');
        const adminEl = document.getElementById('admin-section');
        if (loginEl) loginEl.style.display = 'none';
        if (adminEl) adminEl.style.display = 'block';
    }

    // ── Login form ────────────────────────────────────────────────────────────

    function _bindLoginForm(onSuccess) {
        const form = document.getElementById('login-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msgEl  = document.getElementById('login-message');
            const pwdEl  = document.getElementById('password');
            const password = pwdEl ? pwdEl.value : '';

            try {
                const r = await fetch(`${API_URL}?action=login`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ password }),
                });
                const result = await r.json();

                if (r.ok) {
                    setCsrfToken(result.csrf_token || _readCsrfFromCookie());
                    _showAdmin();
                    onSuccess();
                } else {
                    if (msgEl) {
                        msgEl.innerHTML = `<div class="message error">${escapeHtml(result.error ?? 'Login failed')}</div>`;
                    }
                }
            } catch (err) {
                if (msgEl) {
                    msgEl.innerHTML = '<div class="message error">Network error</div>';
                }
            }
        });
    }

    // ── checkAuth ─────────────────────────────────────────────────────────────

    /**
     * init({ authProbeUrl, onSuccess })
     *
     * Probes authProbeUrl to detect an existing session.
     * If authenticated → ensureCsrfToken, showAdmin, onSuccess().
     * Always binds the login form so the user can log in if not authenticated.
     */
    async function init({ authProbeUrl, onSuccess }) {
        // Always bind the login form first so it works regardless of auth state.
        _bindLoginForm(onSuccess);

        try {
            const r = await fetch(authProbeUrl, { credentials: 'include' });
            if (r.ok) {
                await ensureCsrfToken();
                _showAdmin();
                onSuccess();
            }
        } catch (_) {
            // Not authenticated — the login form is already bound above.
        }
    }

    // ── logout ────────────────────────────────────────────────────────────────

    async function logout() {
        try {
            await fetch(`${API_URL}?action=logout`, { method: 'POST', credentials: 'include' });
        } catch (_) {}
        location.reload();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    return { init, logout, ensureCsrfToken, setCsrfToken, getCsrfToken };
})();

// ── Standalone helpers ────────────────────────────────────────────────────────

/**
 * Safely escape a value for insertion into HTML.
 */
function escapeHtml(value) {
    const d = document.createElement('div');
    d.textContent = String(value ?? '');
    return d.innerHTML;
}

/**
 * Format a byte count as a human-readable string.
 */
function formatBytes(bytes) {
    if (bytes < 1024)             return bytes + ' B';
    if (bytes < 1024 * 1024)     return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Format an ISO / SQLite datetime string as a locale-aware display string.
 * Returns 'N/A' for null, undefined, or unparseable input.
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        // Adjust for UTC string mapping from PHP if it lacks a Z
        const isUTC = !dateString.includes('T') || !dateString.endsWith('Z');
        const d = new Date(isUTC ? dateString.replace(' ', 'T') + 'Z' : dateString);
        if (isNaN(d)) return 'N/A';

        let tz = 'UTC';
        let cal = 'gregory';
        if (window.AdminConfig) {
            if (window.AdminConfig.timezone) tz = window.AdminConfig.timezone;
            if (window.AdminConfig.calendar === 'persian') cal = 'persian';
        }

        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
            timeZone: tz,
            calendar: cal
        }).format(d);
    } catch (_) {
        return 'N/A';
    }
}
