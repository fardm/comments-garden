/**
 * admin-app.js
 * Single-page application shell for the admin panel.
 *
 * Responsibilities:
 *   - Auth orchestration (delegates to AdminAuth from admin-common.js)
 *   - Navigation rendering and active-link management
 *   - Hash-based routing: mount/unmount page views
 *   - View registry: each view defines { title, css, html(), init() }
 *   - Window-scope hoisting of onclick handlers per view
 *   - Shared helpers (renderPageUrl)
 *
 * Views are loaded from separate files and register on the global VIEWS object:
 *   - admin-views-comments.js       (VIEWS['comments'])
 *   - admin-views-analytics.js      (VIEWS['analytics'])
 *   - admin-views-post-reactions.js  (VIEWS['post-reactions'])
 *   - admin-views-settings.js        (VIEWS['settings-general'], ['settings-reactions'],
 *                                     ['settings-database'], ['settings-notifications'],
 *                                     ['settings-import-export'])
 */

'use strict';

// ── Navigation definition ─────────────────────────────────────────────────────

const NAV_ITEMS = [
    { key: 'comments',       label: 'Comments',       icon: 'message-square' },
    { key: 'post-reactions', label: 'Post Reactions', icon: 'smile' },
    { key: 'analytics',      label: 'Analytics',      icon: 'bar-chart-2' },
    { key: 'settings',       label: 'Settings',       icon: 'settings', isParent: true, children: [
        { key: 'settings-general',       label: 'General' },
        { key: 'settings-reactions',     label: 'Reactions' },
        { key: 'settings-database',      label: 'Database' },
        { key: 'settings-notifications', label: 'Notifications' },
        { key: 'settings-import-export', label: 'Import & Export' }
    ]}
];

// ── Router state ──────────────────────────────────────────────────────────────

let _currentViewKey = null;
let _currentStyleEl = null;       // <style> injected for the active view
let _currentCleanup = null;       // cleanup fn returned by the active view's init()
let _windowHandlers = [];         // { name } of properties hoisted to window

// ── Nav rendering ─────────────────────────────────────────────────────────────

function renderNav(activeKey) {
    const nav = document.getElementById('admin-nav');
    if (!nav) return;
    let isSettingsActive = false;
    if (activeKey && activeKey.startsWith('settings-')) {
        isSettingsActive = true;
    }

    nav.innerHTML = NAV_ITEMS.map(({ key, label, icon, isParent, children }) => {
        if (isParent) {
            const isOpen = isSettingsActive ? 'open' : '';
            const childrenHtml = children.map(child => {
                const cls = child.key === activeKey ? ' class="active"' : '';
                return `<a href="#${child.key}"${cls} title="${child.label}"><span class="nav-label">${child.label}</span></a>`;
            }).join('');
            return `<details class="nav-parent" ${isOpen}><summary title="${label}"><i data-lucide="${icon}"></i><span class="nav-label">${label}</span><i data-lucide="chevron-down" class="nav-chevron"></i></summary><div class="nav-children">${childrenHtml}</div></details>`;
        }
        const cls = key === activeKey ? ' class="active"' : '';
        return `<a href="#${key}"${cls} title="${label}"><i data-lucide="${icon}"></i><span class="nav-label">${label}</span></a>`;
    }).join('') +
        '<a href="#" class="logout-btn" onclick="AdminAuth.logout(); return false;" title="Logout"><i data-lucide="log-out"></i><span class="nav-label">Logout</span></a>';

    if (window.lucide) {
        lucide.createIcons();
    }
}

// ── View mounting / unmounting ────────────────────────────────────────────────

/**
 * Unmount the current view:
 *   - Remove its injected <style>
 *   - Call its cleanup function (if any)
 *   - Remove window-hoisted handlers
 */
function unmountCurrent() {
    if (_currentCleanup) {
        try { _currentCleanup(); } catch (_) {}
        _currentCleanup = null;
    }

    if (_currentStyleEl) {
        _currentStyleEl.remove();
        _currentStyleEl = null;
    }

    for (const name of _windowHandlers) {
        try { delete window[name]; } catch (_) { window[name] = undefined; }
    }
    _windowHandlers = [];

    // Clear the mount point
    const app = document.getElementById('app');
    if (app) app.innerHTML = '';
}

/**
 * Hoist a map of { fnName: fn } to window so inline onclick= handlers work.
 * Tracks names for cleanup on unmount.
 */
function hoistToWindow(handlers) {
    for (const [name, fn] of Object.entries(handlers)) {
        window[name] = fn;
        _windowHandlers.push(name);
    }
}

/**
 * Mount a view by key.
 */
async function mountView(key) {
    const view = VIEWS[key];
    if (!view) {
        console.warn(`[admin-app] Unknown view key: "${key}"`);
        return;
    }

    if (_currentViewKey === key) return;   // already mounted

    unmountCurrent();
    _currentViewKey = key;

   // Update document title
    document.title = view.title
        ? `Comment System Admin — ${view.title}`
        : 'Comment System Admin';

    const pageTitleEl = document.querySelector('.page-title');
    if (pageTitleEl && view.title) {
        pageTitleEl.textContent = view.title;
    }

    // Inject view-specific CSS into <head>
    if (view.css) {
        _currentStyleEl = document.createElement('style');
        _currentStyleEl.textContent = view.css;
        document.head.appendChild(_currentStyleEl);
    }

    // Inject view HTML into #app
    const app = document.getElementById('app');
    if (app) app.innerHTML = view.html();

    // Update nav active state
    renderNav(key);

    // Run the view's init — it may return a cleanup function
    if (view.init) {
        try {
            const cleanup = await view.init({ hoistToWindow });
            if (typeof cleanup === 'function') _currentCleanup = cleanup;
        } catch (err) {
            console.error(`[admin-app] View "${key}" init() threw:`, err);
        }
    }
}

// ── Hash routing ──────────────────────────────────────────────────────────────

function currentHash() {
    const h = window.location.hash.slice(1);       // strip leading '#'
    return VIEWS[h] ? h : 'comments';               // default to comments
}

function handleHashChange() {
    mountView(currentHash());
}

// ── Page URL helper ─────────────────────────────────────────────────────────
function renderPageUrl(pageUrl) {
    var origins = (window.AdminConfig && window.AdminConfig.allowedOrigins) || ['*'];
    var specificOrigin = origins.find(function(o) { return o !== '*'; });
    if (specificOrigin) {
        var fullUrl = specificOrigin.replace(/\/$/, '') + (pageUrl.startsWith('/') ? pageUrl : '/' + pageUrl);
        return '<a href="' + escapeHtml(fullUrl) + '" target="_blank" style="color:#4a90e2;text-decoration:none;">' + escapeHtml(pageUrl) + '</a>';
    }
    return '<span>' + escapeHtml(pageUrl) + '</span>';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(function boot() {
    // Auth probe uses the lightest admin-only endpoint
    AdminAuth.init({
        authProbeUrl: `${API_URL}/admin/comments/pending?limit=1`,
        onSuccess() {
            document.getElementById('login-section').style.display  = 'none';
            document.getElementById('admin-shell').style.display    = 'block';

            // Fetch configuration to get timezone and calendar settings globally
            apiFetch(`${API_URL}/admin/config`)
                .then(({ data }) => {
                    if (data && !data.error) {
                        window.AdminConfig = {
                            timezone: data.timezone || 'UTC',
                            calendar: data.app_calendar || 'gregorian',
                            allowedOrigins: data.allowed_origins || ['*']
                        };
                    }
                })
                .catch(e => console.error('Failed to load global config', e))
                .finally(() => {
                    // Initial route
                    mountView(currentHash());

                    // Listen for subsequent navigation
                    window.addEventListener('hashchange', handleHashChange);
                });
        },
    });
})();


// ═════════════════════════════════════════════════════════════════════════════
// VIEW REGISTRY
// Each entry: { title, css, html(), init({ hoistToWindow }) }
// html()  → returns the inner HTML string for #app (no <html>/<head>/<body>)
// init()  → runs after HTML is in the DOM; hoists onclick handlers to window;
//           optionally returns a cleanup() function called before unmounting
//
// Views are defined in separate files and register here on load:
//   admin-views-comments.js, admin-views-analytics.js,
//   admin-views-post-reactions.js, admin-views-settings.js
// ═════════════════════════════════════════════════════════════════════════════

const VIEWS = {};

// ── Sidebar toggle logic ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('admin-sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const mobileToggleBtn = document.getElementById('mobile-sidebar-toggle');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    if (mobileToggleBtn && sidebar) {
        mobileToggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('mobile-active');
        });
    }
});

// Update the existing mobile close logic
document.getElementById('admin-nav').addEventListener('click', function(e) {
    if (e.target.closest('a') && window.innerWidth <= 768) {
        document.getElementById('admin-sidebar').classList.remove('mobile-active');
    }
});
