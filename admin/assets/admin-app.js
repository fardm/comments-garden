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
 *
 * Views are defined at the bottom of this file, one per page.
 * Each view's init() contains the page logic copied verbatim from the
 * original HTML files — no behavior changes.
 */

'use strict';

// ── Navigation definition ─────────────────────────────────────────────────────

const NAV_ITEMS = [
    { key: 'comments',       label: 'Comments',       icon: 'message-square' },
    { key: 'post-reactions', label: 'Post Reactions', icon: 'smile' },
    { key: 'analytics',      label: 'Analytics',      icon: 'bar-chart-2' },
    { key: 'settings',       label: 'Settings',       icon: 'settings', isParent: true, children: [
        { key: 'settings-general',       label: 'General' },
        { key: 'settings-configuration', label: 'Configuration' },
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
        authProbeUrl: `${API_URL}?action=pending&limit=1`,
        onSuccess() {
            document.getElementById('login-section').style.display  = 'none';
            document.getElementById('admin-shell').style.display    = 'block';

            // Fetch configuration to get timezone and calendar settings globally
            fetch(`${API_URL}?action=get_config`, { credentials: 'include' })
                .then(r => r.json())
                .then(data => {
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
// CSS and JS are copied verbatim from the original HTML pages.
// ═════════════════════════════════════════════════════════════════════════════

const VIEWS = {};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS (Tabbed: Pending / Approved / Spam / Deleted / All)
// ─────────────────────────────────────────────────────────────────────────────
VIEWS['comments'] = {
    title: 'Comments',
    css: `
        .comments-panel{background:var(--on-background);border-radius:8px;padding:1.5rem 1.75rem;}
        .comments-tabs{display:flex;gap:0;border-bottom:2px solid var(--gray,#e0e0e0);overflow-x:auto;overflow-y:hidden;}
        .comments-tab{padding:.6rem 1.1rem;font-size:.85rem;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--body-text);transition:all .2s;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;display:flex;align-items:center;gap:.35rem;}
        .comments-tab:hover{opacity:.85;}
        .comments-tab.active{opacity:1;color:var(--primary);border-bottom-color:var(--primary);}
        .comments-tab .tab-count{background:var(--gray,#e0e0e0);color:var(--body-text);font-size:.72rem;padding:.1rem .45rem;border-radius:10px;font-weight:700;min-width:1.3rem;text-align:center;}
        .comments-tab.active .tab-count{background:var(--primary);color:white;}
        .comments-controls{display:flex;gap:.5rem;align-items:center;margin:1.25rem 0;}
        .comments-search-wrap{flex:1 1 0;min-width:180px;position:relative;display:flex;align-items:center;}
        .comments-search-wrap .search-icon{position:absolute;left:.65rem;color:var(--body-text);opacity:.45;pointer-events:none;}
        .comments-search-wrap input[type="text"]{width:100%;padding:.5rem .7rem .5rem 2rem;border:1px solid var(--gray,#ddd);border-radius:4px;font-size:.88rem;background:var(--on-background);color:var(--body-text);}
        .comments-controls select{padding:.5rem .65rem;border:1px solid var(--gray,#ddd);border-radius:4px;font-size:.88rem;background:var(--on-background);color:var(--body-text);cursor:pointer;max-width:150px;min-width:0;flex-shrink:1;}
        .comments-list{display:flex;flex-direction:column;gap:1rem;padding-top:.5rem;}
        .pagination-bar{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-top:1.25rem;flex-wrap:wrap;}
        .pagination-bar button{padding:.4rem .8rem;border:1px solid var(--gray,#ddd);border-radius:4px;background:var(--on-background);color:var(--body-text);font-size:.85rem;cursor:pointer;transition:all .15s;}
        .pagination-bar button:hover:not(:disabled){border-color:var(--primary);color:var(--primary);}
        .pagination-bar button:disabled{opacity:.4;cursor:not-allowed;}
        .pagination-bar button.pg-active{background:var(--primary);color:white;border-color:var(--primary);}
        .pagination-bar .pg-info{font-size:.82rem;color:var(--body-text);opacity:.7;margin-left:.5rem;}
        @media(max-width:768px){.comments-controls{flex-wrap:wrap;} .comments-search-wrap{min-width:100%;}}
    `,
    html: () => `
        <div class="container">
            <div class="comments-panel">
                <div class="comments-tabs" id="comment-tabs">
                    <button class="comments-tab active" data-tab="pending" onclick="switchTab('pending')">
                        <i data-lucide="clock" style="width:14px;height:14px;"></i> Pending <span class="tab-count" id="tab-count-pending">0</span>
                    </button>
                    <button class="comments-tab" data-tab="approved" onclick="switchTab('approved')">
                        <i data-lucide="check-circle" style="width:14px;height:14px;"></i> Approved
                    </button>
                    <button class="comments-tab" data-tab="spam" onclick="switchTab('spam')">
                        <i data-lucide="shield-alert" style="width:14px;height:14px;"></i> Spam
                    </button>
                    <button class="comments-tab" data-tab="deleted" onclick="switchTab('deleted')">
                        <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Trash
                    </button>
                    <button class="comments-tab" data-tab="all" onclick="switchTab('all')">
                        <i data-lucide="layers" style="width:14px;height:14px;"></i> All
                    </button>
                </div>
                <div class="comments-controls">
                    <div class="comments-search-wrap">
                        <i data-lucide="search" class="search-icon" style="width:15px;height:15px;"></i>
                        <input type="text" id="c-search" placeholder="Search by name, email, or content…" onkeydown="if(event.key==='Enter')reloadComments()">
                    </div>
                    <select id="c-date" onchange="reloadComments()">
                        <option value="all">All Time</option>
                        <option value="day">Last Day</option>
                        <option value="week">Last Week</option>
                        <option value="month">Last Month</option>
                        <option value="year">Last Year</option>
                    </select>
                    <select id="c-sort" onchange="reloadComments()">
                        <option value="desc">Newest</option>
                        <option value="asc">Oldest</option>
                    </select>
                </div>
                <div class="comments-list" id="comments-list"><p class="no-comments">Loading…</p></div>
                <div class="pagination-bar" id="comments-pagination"></div>
            </div>
        </div>`,

    init({ hoistToWindow }) {
        let activeTab = 'pending';
        let currentPage = 1;
        const perPage = 20;
        let totalCount = 0;
        let counts = { pending: 0, approved: 0, spam: 0, deleted: 0, all: 0 };

        const reactionDefs = [
            { type: 'thumbsup', emoji: '👍' }, { type: 'lightbulb', emoji: '👎' },
            { type: 'pray', emoji: '🙏' }, { type: 'ok', emoji: '👌' },
            { type: 'fire', emoji: '🔥' }, { type: 'heart', emoji: '❤️' },
            { type: 'frown', emoji: '☹️' }, { type: 'rage', emoji: '😡' },
            { type: 'funny', emoji: '😄' }, { type: 'neutral', emoji: '😐' },
        ];

        // Reply state
        let replyingToId = null;
        let replyingToPageUrl = null;
        let adminProfileCache = null;

        async function loadCounts() {
            try {
                const r = await fetch(`${API_URL}?action=comment_counts&_=${Date.now()}`, { credentials: 'include', cache: 'no-store' });
                if (r.ok) {
                    counts = await r.json();
                    updateTabCounts();
                }
            } catch (e) { console.error('Failed to load counts', e); }
        }

        function updateTabCounts() {
            const el = document.getElementById('tab-count-pending');
            if (el) el.textContent = counts.pending || 0;
        }

        function switchTab(tab) {
            activeTab = tab;
            currentPage = 1;
            document.querySelectorAll('.comments-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tab);
            });
            reloadComments();
        }

        async function reloadComments() {
            currentPage = 1;
            await loadComments();
        }

        async function loadComments() {
            const container = document.getElementById('comments-list');
            if (!container) return;
            container.innerHTML = '<p class="no-comments">Loading…</p>';

            const search = document.getElementById('c-search')?.value?.trim() || '';
            const dateFilter = document.getElementById('c-date')?.value || 'all';
            const sort = document.getElementById('c-sort')?.value || 'desc';

            const qs = new URLSearchParams({
                action: 'all',
                limit: perPage,
                offset: (currentPage - 1) * perPage,
                sort: sort,
            });
            if (activeTab !== 'all') qs.set('status', activeTab);
            if (search) qs.set('search', search);
            if (dateFilter !== 'all') qs.set('date', dateFilter);

            try {
                const r = await fetch(`${API_URL}?${qs}`, { credentials: 'include', cache: 'no-store' });
                const data = await r.json();
                if (r.ok) {
                    totalCount = data.pagination.total;
                    displayComments(data.comments);
                    renderPagination();
                } else {
                    container.innerHTML = `<div class="message error">Error: ${data.error || 'Failed to load'}</div>`;
                }
            } catch (e) {
                container.innerHTML = `<div class="message error">Network error: ${e.message}</div>`;
            }
        }

        function displayComments(comments) {
            const container = document.getElementById('comments-list');
            if (!container) return;
            if (!comments.length) {
                container.innerHTML = '<p class="no-comments">No comments found</p>';
                document.getElementById('comments-pagination').innerHTML = '';
                return;
            }
            container.innerHTML = comments.map(comment => {
                const votes = comment.votes_by_reaction_type || {};
                const reactionSummary = reactionDefs
                    .filter(x => (votes[x.type] || 0) > 0)
                    .map(x => `${x.emoji} ${votes[x.type]}`).join('&nbsp;&nbsp;');
                const isDeleted = comment.status === 'deleted';
                return `
                <div class="comment-item" id="comment-${comment.id}" style="opacity:${isDeleted ? '.55' : '1'};">
                    <div class="comment-meta">
                        <span class="comment-author">${escapeHtml(comment.author_name)}</span>
                        <span>${escapeHtml(comment.author_email || '')}</span>
                        ${comment.author_url ? `<a href="${escapeHtml(comment.author_url)}" target="_blank">Website</a>` : ''}
                        <span>${formatDate(comment.created_at)}</span>
                        <span class="badge badge-${comment.status}">${comment.status}</span>
                    </div>
                    <div class="body-text"><strong>Page:</strong> ${renderPageUrl(comment.page_url)}</div>
                    <div class="body-text"><strong>IP:</strong> ${escapeHtml(comment.ip_address || 'N/A')}</div>
                    ${comment.parent_id ? `<div class="body-text"><strong>Reply to:</strong> Comment #${comment.parent_id}</div>` : ''}
                    <div class="comment-content" dir="auto" id="comment-content-${comment.id}">${escapeHtml(comment.content)}</div>
                    ${reactionSummary ? `<div class="body-text"><strong>Reactions:</strong> ${reactionSummary}</div>` : ''}
                    <div class="comment-actions">
                        <button class="btn btn-secondary btn-sm" onclick="startCommentEdit(${comment.id})">Edit</button>
                        <button class="btn btn-primary btn-sm" onclick="showReplyForm(${comment.id}, '${escapeHtml(comment.page_url)}')">Reply</button>
                        ${!isDeleted && comment.status !== 'approved' ? `<button class="btn btn-success btn-sm" onclick="moderateComment(${comment.id}, 'approved')">Approve</button>` : ''}
                        ${!isDeleted && comment.status !== 'spam' ? `<button class="btn btn-warning btn-sm" onclick="moderateComment(${comment.id}, 'spam')">Mark as Spam</button>` : ''}
                        ${isDeleted ? `<button class="btn btn-success btn-sm" onclick="restoreComment(${comment.id})"><i data-lucide="undo-2" style="width:13px;height:13px;"></i> Restore</button>` : ''}
                        ${isDeleted ? `<button class="btn btn-danger btn-sm" onclick="permanentDelete(${comment.id})"><i data-lucide="trash-2" style="width:13px;height:13px;"></i> Delete Permanently</button>` : ''}
                        ${!isDeleted ? `<button class="btn btn-danger btn-sm" onclick="deleteComment(${comment.id})"><i data-lucide="trash-2" style="width:13px;height:13px;"></i> Delete</button>` : ''}
                    </div>
                    <div id="reply-form-${comment.id}" style="display:none;margin-top:1rem;padding:1rem;background:var(--on-background);border:1px solid var(--gray);border-radius:4px;">
                        <div style="margin-bottom:.5rem;color:var(--body-text);"><strong>Reply to comment #${comment.id}</strong></div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
                            <div>
                                <label style="font-size:.85rem;color:var(--body-text);opacity:.8;">Name</label>
                                <input type="text" id="reply-name-${comment.id}" class="themed-control" style="width:100%;padding:.5rem;" placeholder="Your name">
                            </div>
                            <div>
                                <label style="font-size:.85rem;color:var(--body-text);opacity:.8;">Email</label>
                                <input type="email" id="reply-email-${comment.id}" class="themed-control" style="width:100%;padding:.5rem;" placeholder="your@email.com">
                            </div>
                        </div>
                        <div style="margin-bottom:.5rem;">
                            <label style="font-size:.85rem;color:var(--body-text);opacity:.8;">Website (optional)</label>
                            <input type="url" id="reply-url-${comment.id}" class="themed-control" style="width:100%;padding:.5rem;" placeholder="https://yourwebsite.com">
                        </div>
                        <textarea id="reply-content-${comment.id}" class="themed-control" rows="3" style="width:100%;resize:vertical;padding:.5rem;" placeholder="Write your reply..."></textarea>
                        <div style="margin-top:.5rem;display:flex;gap:.5rem;">
                            <button class="btn btn-success btn-sm" onclick="submitReply(${comment.id})">Submit Reply</button>
                            <button class="btn btn-secondary btn-sm" onclick="hideReplyForm(${comment.id})">Cancel</button>
                            <span id="reply-status-${comment.id}" style="font-size:.85rem;color:var(--body-text,#888);opacity:.8;"></span>
                        </div>
                    </div>
                </div>`;
            }).join('');
            if (window.lucide) lucide.createIcons();
        }

        function renderPagination() {
            const el = document.getElementById('comments-pagination');
            if (!el) return;
            const totalPages = Math.ceil(totalCount / perPage);
            if (totalPages <= 1) { el.innerHTML = ''; return; }
            let html = `<button onclick="commentsChangePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&#8249; Prev</button>`;
            const maxVis = 5;
            let start = Math.max(1, currentPage - Math.floor(maxVis / 2));
            let end = Math.min(totalPages, start + maxVis - 1);
            if (end - start < maxVis - 1) start = Math.max(1, end - maxVis + 1);
            if (start > 1) {
                html += `<button onclick="commentsChangePage(1)">1</button>`;
                if (start > 2) html += `<span class="pg-info">…</span>`;
            }
            for (let i = start; i <= end; i++) {
                html += `<button onclick="commentsChangePage(${i})" ${i === currentPage ? 'class="pg-active"' : ''}>${i}</button>`;
            }
            if (end < totalPages) {
                if (end < totalPages - 1) html += `<span class="pg-info">…</span>`;
                html += `<button onclick="commentsChangePage(${totalPages})">${totalPages}</button>`;
            }
            html += `<button onclick="commentsChangePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next &#8250;</button>`;
            const s = (currentPage - 1) * perPage + 1;
            const e = Math.min(currentPage * perPage, totalCount);
            html += `<span class="pg-info">Showing ${s}–${e} of ${totalCount.toLocaleString()}</span>`;
            el.innerHTML = html;
        }

        function commentsChangePage(page) {
            const totalPages = Math.ceil(totalCount / perPage);
            if (page < 1 || page > totalPages) return;
            currentPage = page;
            loadComments();
            document.querySelector('.comments-tabs')?.scrollIntoView({ behavior: 'smooth' });
        }

        async function moderateComment(id, status) {
            const commentEl = document.getElementById(`comment-${id}`);
            if (!commentEl) return;
            const originalHTML = commentEl.innerHTML;
            try {
                await AdminAuth.ensureCsrfToken();
                commentEl.style.opacity = '0.5';
                commentEl.innerHTML = '<p style="text-align:center;padding:2rem;">Processing…</p>';
                const r = await fetch(`${API_URL}?action=moderate&id=${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
                    credentials: 'include',
                    body: JSON.stringify({ status, csrf_token: AdminAuth.getCsrfToken() }),
                });
                const result = await r.json();
                if (r.ok) {
                    commentEl.innerHTML = `<p style="text-align:center;padding:2rem;color:green;">✓ ${status === 'approved' ? 'Approved' : 'Marked as spam'}!</p>`;
                    setTimeout(() => { loadComments(); loadCounts(); }, 500);
                } else {
                    commentEl.style.opacity = '1';
                    commentEl.innerHTML = originalHTML + `<p class="error" style="margin-top:1rem;">Failed: ${result.error || 'Unknown error'}</p>`;
                }
            } catch (e) {
                commentEl.style.opacity = '1';
                commentEl.innerHTML = originalHTML + '<p class="error" style="margin-top:1rem;">Network error</p>';
            }
        }

        async function deleteComment(id) {
            if (!confirm('Move this comment to Trash?')) return;
            try {
                await AdminAuth.ensureCsrfToken();
                const r = await fetch(`${API_URL}?action=delete&id=${id}`, {
                    method: 'DELETE', credentials: 'include',
                });
                if (r.ok) { loadComments(); loadCounts(); }
                else { alert(`Failed: ${(await r.json()).error || 'Unknown error'}`); }
            } catch (e) { alert('Network error while deleting comment'); }
        }

        async function restoreComment(id) {
            try {
                await AdminAuth.ensureCsrfToken();
                const r = await fetch(`${API_URL}?action=restore`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ id, csrf_token: AdminAuth.getCsrfToken() }),
                });
                if (r.ok) { loadComments(); loadCounts(); }
                else { alert(`Failed: ${(await r.json()).error || 'Unknown error'}`); }
            } catch (e) { alert('Network error while restoring comment'); }
        }

        async function permanentDelete(id) {
            if (!confirm('Permanently delete this comment? This cannot be undone.')) return;
            try {
                await AdminAuth.ensureCsrfToken();
                const r = await fetch(`${API_URL}?action=permanent_delete&id=${id}`, {
                    method: 'DELETE', credentials: 'include',
                });
                if (r.ok) { loadComments(); loadCounts(); }
                else { alert(`Failed: ${(await r.json()).error || 'Unknown error'}`); }
            } catch (e) { alert('Network error while deleting comment'); }
        }

        async function showReplyForm(commentId, pageUrl) {
            replyingToId = commentId;
            replyingToPageUrl = pageUrl;
            document.querySelectorAll('[id^="reply-form-"]').forEach(el => {
                if (el.id !== `reply-form-${commentId}`) el.style.display = 'none';
            });
            document.getElementById(`reply-form-${commentId}`).style.display = 'block';
            document.getElementById(`reply-content-${commentId}`).focus();

            if (!adminProfileCache) {
                try {
                    const response = await fetch(`${API_URL}?action=get_settings`, { credentials: 'include' });
                    if (response.ok) {
                        const data = await response.json();
                        adminProfileCache = data.settings || {};
                    }
                } catch (e) { adminProfileCache = {}; }
            }
            if (adminProfileCache) {
                if (adminProfileCache.admin_name) document.getElementById(`reply-name-${commentId}`).value = adminProfileCache.admin_name;
                if (adminProfileCache.admin_email) document.getElementById(`reply-email-${commentId}`).value = adminProfileCache.admin_email;
                if (adminProfileCache.admin_url) document.getElementById(`reply-url-${commentId}`).value = adminProfileCache.admin_url;
            }
        }

        function hideReplyForm(commentId) {
            document.getElementById(`reply-form-${commentId}`).style.display = 'none';
            ['content','name','email','url'].forEach(f => {
                const el = document.getElementById(`reply-${f}-${commentId}`);
                if (el) el.value = '';
            });
            const st = document.getElementById(`reply-status-${commentId}`);
            if (st) st.textContent = '';
            replyingToId = null;
            replyingToPageUrl = null;
        }

        async function submitReply(commentId) {
            const name = document.getElementById(`reply-name-${commentId}`).value.trim();
            const email = document.getElementById(`reply-email-${commentId}`).value.trim();
            const url = document.getElementById(`reply-url-${commentId}`).value.trim();
            const content = document.getElementById(`reply-content-${commentId}`).value.trim();
            const statusEl = document.getElementById(`reply-status-${commentId}`);

            if (!name) { statusEl.textContent = 'Please enter your name'; statusEl.style.color = 'red'; return; }
            if (!email) { statusEl.textContent = 'Please enter your email'; statusEl.style.color = 'red'; return; }
            if (!content) { statusEl.textContent = 'Please enter a reply'; statusEl.style.color = 'red'; return; }
            if (!replyingToPageUrl) { statusEl.textContent = 'Error: missing page URL'; statusEl.style.color = 'red'; return; }

            try {
                await AdminAuth.ensureCsrfToken();
                statusEl.textContent = 'Submitting…';
                statusEl.style.color = 'var(--body-text,#888)';
                const response = await fetch(`${API_URL}?action=admin_post`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        page_url: replyingToPageUrl, parent_id: commentId,
                        author_name: name, author_email: email, author_url: url || null,
                        content, author_role: 'admin', csrf_token: AdminAuth.getCsrfToken()
                    })
                });
                const result = await response.json();
                if (response.ok) {
                    statusEl.textContent = '✓ Reply posted successfully!';
                    statusEl.style.color = 'green';
                    setTimeout(() => { hideReplyForm(commentId); loadComments(); }, 1000);
                } else {
                    statusEl.textContent = 'Failed: ' + (result.error || 'Unknown error');
                    statusEl.style.color = 'red';
                }
            } catch (e) {
                statusEl.textContent = 'Network error';
                statusEl.style.color = 'red';
            }
        }

        hoistToWindow({
            switchTab, reloadComments, commentsChangePage,
            moderateComment, deleteComment, restoreComment, permanentDelete,
            startCommentEdit, showReplyForm, hideReplyForm, submitReply
        });
        loadCounts();
        loadComments();
    },
};


// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
VIEWS['analytics'] = {
    title: 'Analytics',
    css: `
        .dashboard { display:flex; flex-direction:column; gap:1.5rem; margin-bottom:2rem; }
        .chart-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); padding:1.25rem 1.5rem; }
        .chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:.5rem; }
        .chart-title { font-size:.92rem; font-weight:600; color:#555; }
        .chart-subtitle { font-size:.75rem; font-weight:400; color:#aaa; margin-left:.4rem; }
        .toggle-group { display:flex; gap:.2rem; }
        .toggle-group button { padding:.22rem .7rem; border:1px solid #ddd; background:white; border-radius:3px; font-size:.78rem; cursor:pointer; color:#666; transition:all .15s; }
        .toggle-group button.active { background:#4a90e2; border-color:#4a90e2; color:white; }
        .toggle-group button:hover:not(.active) { border-color:#4a90e2; color:#4a90e2; }
        .chart-legend { display:flex; gap:1rem; flex-wrap:wrap; margin-top:.6rem; font-size:.8rem; }
        .legend-item { display:flex; align-items:center; gap:.3rem; color:#666; }
        .legend-swatch { width:10px; height:10px; border-radius:2px; flex-shrink:0; }
        .chart-empty { padding:2rem; text-align:center; color:#ccc; font-size:.9rem; }
        .chart-loading { padding:2rem; text-align:center; color:#bbb; font-size:.9rem; }
        #chart-tooltip { position:fixed; background:rgba(25,25,25,.92); color:#fff; padding:.45rem .7rem; border-radius:5px; font-size:.8rem; pointer-events:none; z-index:9999; display:none; line-height:1.7; max-width:220px; box-shadow:0 2px 8px rgba(0,0,0,.3); }
        @media (max-width:768px)  { .nav a { min-width:80px; font-size:.85rem; } }`,

    html: () => `
        <div id="chart-tooltip"></div>
        <div class="container">
            <div class="stats">
                <div class="stat-card"><div class="stat-number" id="stat-total">—</div><div class="stat-label">Total Comments</div></div>
                <div class="stat-card"><div class="stat-number green" id="stat-approved">—</div><div class="stat-label">Approved</div></div>
                <div class="stat-card"><div class="stat-number yellow" id="stat-pending">—</div><div class="stat-label">Pending</div></div>
                <div class="stat-card"><div class="stat-number red" id="stat-spam">—</div><div class="stat-label">Spam</div></div>
            </div>
            <div class="dashboard" id="dashboard">
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title">Comment Volume Over Time</span>
                        <div class="toggle-group">
                            <button id="toggle-daily" class="active" onclick="setGranularity('daily')">Daily</button>
                            <button id="toggle-weekly" onclick="setGranularity('weekly')">Weekly</button>
                            <button id="toggle-monthly" onclick="setGranularity('monthly')">Monthly</button>
                        </div>
                    </div>
                    <div id="timeline-chart"><div class="chart-loading">Loading…</div></div>
                    <div class="chart-legend">
                        <span class="legend-item"><span class="legend-swatch" style="background:#28a745"></span>Approved</span>
                        <span class="legend-item"><span class="legend-swatch" style="background:#ffc107"></span>Pending</span>
                        <span class="legend-item"><span class="legend-swatch" style="background:#dc3545"></span>Spam</span>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-header"><span class="chart-title">Top Posts by Comment Volume</span></div>
                    <div id="top-posts-chart"><div class="chart-loading">Loading…</div></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header"><span class="chart-title">Audience Reaction Balance</span></div>
                    <div id="reaction-balance-chart"><div class="chart-loading">Loading…</div></div>
                </div>
            </div>
        </div>`,

    async init({ hoistToWindow }) {
        let analyticsData      = null;
        let currentGranularity = 'daily';

        const [analyticsResp, reactionsResp] = await Promise.all([
            fetch(`${API_URL}?action=analytics&_=${Date.now()}`, { credentials: 'include', cache: 'no-store' }),
            fetch(`${API_URL}?action=post_reactions_summary&_=${Date.now()}`, { credentials: 'include', cache: 'no-store' })
        ]);
        if (analyticsResp.ok) { try { loadAnalytics(await analyticsResp.json()); } catch (e) { console.error('loadAnalytics failed:', e); } }
        if (reactionsResp.ok) { try { renderReactionBalance(await reactionsResp.json()); } catch (e) { console.error('renderReactionBalance failed:', e); } }

        function loadAnalytics(data) {
            analyticsData = data;
            const st    = data.status_totals;
            const total = (st.approved || 0) + (st.pending || 0) + (st.spam || 0) + (st.deleted || 0);
            document.getElementById('stat-total').textContent      = fmt(total);
            document.getElementById('stat-approved').textContent   = fmt(st.approved || 0);
            document.getElementById('stat-pending').textContent    = fmt(st.pending  || 0);
            document.getElementById('stat-spam').textContent       = fmt(st.spam     || 0);
            try { renderTimeline(); } catch (e) { console.error('renderTimeline failed:', e); }
            try { renderTopPosts(data.top_posts || []); } catch (e) { console.error('renderTopPosts failed:', e); }
        }

        function setGranularity(g) {
            currentGranularity = g;
            ['daily','weekly','monthly'].forEach(k =>
                document.getElementById('toggle-' + k)?.classList.toggle('active', k === g));
            renderTimeline();
        }

        function renderTimeline() {
            if (!analyticsData) return;
            const buckets = analyticsData.timeline[currentGranularity] || [];
            const el = document.getElementById('timeline-chart');
            if (!el) return;
            if (!buckets.length) { el.innerHTML = '<div class="chart-empty">No data for this period</div>'; return; }
            const W=900,H=210,PL=42,PR=12,PT=14,PB=34,cW=W-PL-PR,cH=H-PT-PB,n=buckets.length;
            const maxRaw=Math.max(...buckets.map(b=>b.total),1);
            const ticks=niceTicks(maxRaw,4),maxVal=ticks[ticks.length-1];
            let yLines='';
            for(const t of ticks){const y=(PT+cH-(t/maxVal)*cH).toFixed(1);yLines+=`<line x1="${PL}" x2="${W-PR}" y1="${y}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/><text x="${PL-5}" y="${+y+4}" text-anchor="end" font-size="10" fill="#c0c0c0">${t>=1000?(t/1000).toFixed(t%1000===0?0:1)+'k':t}</text>`;}
            const slotW=cW/n,barW=Math.max(1.5,Math.min(slotW*.8,48)),barOff=(slotW-barW)/2;
            const labelEvery=Math.max(1,Math.round(n/9));
            let bars='',xLabels='';
            buckets.forEach((b,i)=>{
                const bx=(PL+i*slotW+barOff).toFixed(2);let y=PT+cH;
                const seg=(count,color)=>{const bh=count>0?Math.max(1.2,(count/maxVal)*cH):0;if(bh<.5)return'';y-=bh;return`<rect x="${bx}" y="${y.toFixed(2)}" width="${(+barW).toFixed(2)}" height="${bh.toFixed(2)}" fill="${color}"/>`;};
                const other=Math.max(0,b.total-b.approved-b.pending-b.spam);
                bars+=`<g>${seg(other,'#adb5bd')}${seg(b.spam,'#dc3545')}${seg(b.pending,'#ffc107')}${seg(b.approved,'#28a745')}</g>`;
                bars+=`<rect class="tt-bar" x="${(PL+i*slotW).toFixed(2)}" y="${PT}" width="${slotW.toFixed(2)}" height="${cH}" fill="rgba(0,0,0,0)" pointer-events="all" data-i="${i}"/>`;
                if(i%labelEvery===0||i===n-1){xLabels+=`<text x="${(PL+i*slotW+slotW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="9.5" fill="#c0c0c0">${fmtPeriod(b.period,currentGranularity)}</text>`;}
            });
            const axes=`<line x1="${PL}" x2="${PL}" y1="${PT}" y2="${PT+cH}" stroke="#e8e8e8"/><line x1="${PL}" x2="${W-PR}" y1="${PT+cH}" y2="${PT+cH}" stroke="#e8e8e8"/>`;
            el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;overflow:visible">${yLines}${axes}${bars}${xLabels}</svg>`;
            const ttEl=document.getElementById('chart-tooltip');
            el.querySelectorAll('.tt-bar').forEach(r=>{
                r.addEventListener('mouseenter',e=>{const b=buckets[+r.dataset.i];const pct=b.total>0?Math.round(b.spam/b.total*100):0;showTip(ttEl,e,`<strong>${b.period}</strong><br>Total: <strong>${b.total}</strong><br>✅ ${b.approved}&ensp;⏳ ${b.pending}&ensp;🚫 ${b.spam} (${pct}%)`);});
                r.addEventListener('mousemove',e=>moveTip(ttEl,e));r.addEventListener('mouseleave',()=>hideTip(ttEl));
            });
        }        function renderTopPosts(posts) {
            const el=document.getElementById('top-posts-chart');if(!el)return;
            if(!posts.length){el.innerHTML='<div class="chart-empty">No posts yet</div>';return;}
            const W=700,ROW=24,URL_X=0,URL_W=210,BAR_GAP=10,COUNT_GAP=6,BAR_W=W-URL_W-BAR_GAP-COUNT_GAP-36,H=posts.length*ROW;
            const maxVal=Math.max(...posts.map(p=>p.total),1);let rows='';
            posts.forEach((p,i)=>{
                const y=i*ROW;
                const tw=(p.total/maxVal)*BAR_W;
                const aw=p.total>0?(p.approved/p.total)*tw:0;
                const pw=p.total>0?(p.pending/p.total)*tw:0;
                const sw=p.total>0?(p.spam/p.total)*tw:0;
                const ow=Math.max(0,tw-aw-pw-sw);
                const barH=10,by=y+(ROW-barH)/2;
                let bx=URL_W+BAR_GAP;
                const addSeg=(w,color)=>{if(w<.5)return;rows+=`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="1"/>`;bx+=w;};
                addSeg(aw,'#28a745');addSeg(pw,'#ffc107');addSeg(sw,'#dc3545');addSeg(ow,'#adb5bd');
                rows+=`<text x="${URL_X}" y="${(y+ROW/2+3.5).toFixed(1)}" font-size="9.5" fill="#555">${escapeHtml(truncUrl(p.page_url,32))}</text>`;
                rows+=`<text x="${URL_W+BAR_GAP+tw+COUNT_GAP}" y="${(y+ROW/2+3.5).toFixed(1)}" font-size="9" fill="#999">${p.total}</text>`;
                if(i<posts.length-1)rows+=`<line x1="0" x2="${W}" y1="${y+ROW}" y2="${y+ROW}" stroke="#f0f0f0" stroke-width="0.5"/>`;
                rows+=`<rect x="0" y="${y}" width="${W}" height="${ROW}" fill="rgba(0,0,0,0)" pointer-events="all" class="post-ov" data-i="${i}"/>`;
            });
            el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">${rows}</svg>`;
            const ttEl=document.getElementById('chart-tooltip');
            el.querySelectorAll('.post-ov').forEach(r=>{r.addEventListener('mouseenter',e=>{const p=posts[+r.dataset.i];const pct=p.total>0?Math.round(p.spam/p.total*100):0;showTip(ttEl,e,`<strong>${escapeHtml(p.page_url)}</strong><br>Total: <strong>${p.total}</strong><br>✅ ${p.approved}&ensp;⏳ ${p.pending}&ensp;🚫 ${p.spam} (${pct}%)`);});r.addEventListener('mousemove',e=>moveTip(ttEl,e));r.addEventListener('mouseleave',()=>hideTip(ttEl));});
        }

        function renderReactionBalance(data) {
            const el = document.getElementById('reaction-balance-chart');
            if (!el) return;
            const pages = data.pages || [];
            if (!data.total || data.total === 0) {
                el.innerHTML = '<div class="chart-empty">No reactions yet</div>';
                return;
            }
            // Aggregate totals across all pages
            const totals = {};
            pages.forEach(page => {
                const reactions = page.reactions || {};
                for (const [type, count] of Object.entries(reactions)) {
                    totals[type] = (totals[type] || 0) + (parseInt(count) || 0);
                }
            });
            const POSITIVE_TYPES = ['heart', 'thumbsup', 'pray', 'ok', 'fire', 'funny'];
            const NEUTRAL_TYPES  = ['neutral'];
            const NEGATIVE_TYPES = ['lightbulb', 'frown', 'rage'];
            const pos = POSITIVE_TYPES.reduce((s, t) => s + (totals[t] || 0), 0);
            const neu = NEUTRAL_TYPES.reduce((s, t) => s + (totals[t] || 0), 0);
            const neg = NEGATIVE_TYPES.reduce((s, t) => s + (totals[t] || 0), 0);
            const total = pos + neu + neg;
            if (total === 0) {
                el.innerHTML = '<div class="chart-empty">No reactions yet</div>';
                return;
            }
            const posPct = pos / total * 100;
            const negPct = neg / total * 100;
            const neuPct = neu / total * 100;

            // --- SVG: one continuous stacked bar ---
            const W = 660, H = 72, barH = 22, barY = 30, pad = 8;
            const barW = W - pad * 2;
            // Segment widths (proportional, always adjacent → one connected bar)
            const negW = total > 0 ? (neg / total) * barW : 0;
            const neuW = total > 0 ? (neu / total) * barW : 0;
            const posW = total > 0 ? (pos / total) * barW : 0;
            // Build the bar: negative | neutral | positive, always drawn in order
            // Use rx on the first and last visible segment for rounded ends
            let bar = '';
            let x = pad;
            const segments = [
                { w: negW, color: '#dc3545' },
                { w: neuW, color: '#6c757d' },
                { w: posW, color: '#28a745' },
            ].filter(s => s.w > 0);
            segments.forEach((s, i) => {
                const isFirst = i === 0;
                const isLast = i === segments.length - 1;
                // Round the outer corners of end segments, flat joins in the middle
                const r = (isFirst || isLast) ? 4 : 0;
                bar += `<rect x="${x.toFixed(1)}" y="${barY}" width="${s.w.toFixed(1)}" height="${barH}" fill="${s.color}" rx="${r}"/>`;
                x += s.w;
            });

            // --- Labels anchored to container edges (independent of bar widths) ---
            const labelY = barY - 10;
            const labels = `
                <text x="${pad}" y="${labelY}" text-anchor="start" font-size="9.5" fill="#dc3545" font-weight="600">Negative ${negPct.toFixed(1)}%</text>
                <text x="${W / 2}" y="${labelY}" text-anchor="middle" font-size="9.5" fill="#6c757d" font-weight="600">Neutral ${neuPct.toFixed(1)}%</text>
                <text x="${W - pad}" y="${labelY}" text-anchor="end" font-size="9.5" fill="#28a745" font-weight="600">Positive ${posPct.toFixed(1)}%</text>
            `;

            el.innerHTML = `
                <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;overflow:visible">${labels}${bar}</svg>
                <div style="display:flex;justify-content:space-between;padding:0 2px;margin-top:0.15rem; flex-direction: column;">
                    <span style="font-size:0.78rem;color:#dc3545;">😡Negative: ${fmt(neg)}</span>
                    <span style="font-size:0.78rem;color:#6c757d;">😐Neutral: ${fmt(neu)}</span>
                    <span style="font-size:0.78rem;color:#28a745;">☺️Positive: ${fmt(pos)}</span>
                    <span style="font-size:0.78rem;color:#999;">📊Total: ${fmt(total)}</span>
                </div>
            `;
        }

        function showTip(ttEl,e,html){if(!ttEl)return;ttEl.innerHTML=html;ttEl.style.display='block';moveTip(ttEl,e);}
        function moveTip(ttEl,e){if(!ttEl)return;const margin=14;let x=e.clientX+margin,y=e.clientY-margin;const tw=ttEl.offsetWidth,th=ttEl.offsetHeight;if(x+tw>window.innerWidth-8)x=e.clientX-tw-margin;if(y+th>window.innerHeight-8)y=e.clientY-th-margin;if(y<4)y=4;ttEl.style.left=x+'px';ttEl.style.top=y+'px';}
        function hideTip(ttEl){if(ttEl)ttEl.style.display='none';}
        function niceTicks(maxVal,count){if(!maxVal)return[0,1];const rough=maxVal/count,mag=Math.pow(10,Math.floor(Math.log10(rough)));const nice=[1,2,2.5,5,10].map(f=>f*mag).find(f=>f>=rough)||mag*10;const ticks=[];for(let v=0;v<=maxVal*1.05;v+=nice){ticks.push(Math.round(v));if(ticks.length>8)break;}if(!ticks.includes(0))ticks.unshift(0);return ticks;}
        function fmtPeriod(period,gran){const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];if(gran==='daily'){const[y,m,d]=period.split('-');return M[+m-1]+' '+ +d;}if(gran==='weekly')return period.replace(/^\d{4}-W0?/,'W');if(gran==='monthly'){const[y,m]=period.split('-');return M[+m-1]+' \''+y.slice(2);}return period;}
        function truncUrl(url,max){const s=url.replace(/^https?:\/\//,'');return s.length>max?'…'+s.slice(-(max-1)):s;}
        function fmt(n){return Number(n).toLocaleString();}

        hoistToWindow({ setGranularity });
    },
};


// ─────────────────────────────────────────────────────────────────────────────
// POST REACTIONS
// ─────────────────────────────────────────────────────────────────────────────
VIEWS['post-reactions'] = {
    title: 'Post Reactions',
    css: `
        .table-responsive { width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }
        table { width:100%; border-collapse:collapse; }
        #reactions-table table { min-width:800px; }
        th,td { color:var(--body-text); text-align:left; padding:.75rem 1rem; border-bottom:1px solid var(--gray,#e0e0e0); }
        th { font-weight:600; font-size:.9rem; background:var(--light); white-space:nowrap; }
        tr:last-child td { border-bottom:none; }
        tr:hover td { background:var(--light); }
        .page-url a { color:var(--primary); text-decoration:none; word-break:break-all; }
        .page-url a:hover { text-decoration:underline; }
        .reaction-cell { text-align:center; white-space:nowrap; }
        .total-cell { font-weight:600; color:var(--primary); text-align:center; }
        .latest-reactions-table { font-size:.95rem; min-width:650px; }
        .reaction-emoji-cell { font-size:1.2rem; }
        .ip-cell { color:var(--body-text); font-size:.85rem; font-family:monospace; word-break:break-all; }
        .reaction-filters { display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:1.25rem; }
        .reaction-filter-btn { display:inline-flex; align-items:center; gap:.35rem; padding:.45rem .85rem; border:2px solid var(--gray,#dee2e6); border-radius:20px; background:var(--on-background); color:var(--body-text); font-size:.88rem; font-weight:600; cursor:pointer; transition:all .2s; white-space:nowrap; }
        .reaction-filter-btn:hover { border-color:var(--primary); color:var(--primary); }
        .reaction-filter-btn.active { border-color:var(--primary); background:var(--primary); color:#fff; }
        .reaction-filter-btn .filter-count { font-size:.75rem; font-weight:700; opacity:.8; }
        .reaction-filter-btn.active .filter-count { opacity:1; }
        .delete-reaction-btn { background:none; border:none; cursor:pointer; padding:.3rem; border-radius:4px; color:var(--gray,#999); transition:color .2s; display:inline-flex; align-items:center; }
        .delete-reaction-btn:hover { color:#e74c3c; }
        .delete-reaction-btn svg { width:16px; height:16px; }
        @media (max-width:768px) { table { font-size:.85rem; } th,td { padding:.5rem; } }`,

    html: () => `
        <div class="container">
            <div class="section-card">
                <div class="reaction-filters" id="reaction-filters"></div>
                <div id="latest-message"></div>
                <div id="latest-reactions-container" class="table-responsive"><p class="no-data">Loading...</p></div>
                <div id="latest-reactions-pagination" class="pagination-bar"></div>
            </div>
        </div>`,

    init({ hoistToWindow }) {
        const EMOJI_BY_TYPE = { thumbsup:'👍', lightbulb:'👎', pray:'🙏', ok:'👌', fire:'🔥', heart:'❤️', frown:'☹️', rage:'😡', funny:'😄', neutral:'😐' };
        const REACTION_TYPES = ['thumbsup','lightbulb','pray','ok','fire','heart','frown','rage','funny','neutral'];
        const LATEST_PAGE_SIZE = 20;
        let latestOffset = 0;
        let latestTotal = 0;
        let activeFilter = 'all';
        const totals = Object.fromEntries(REACTION_TYPES.map(t => [t, 0]));

        function buildFilterButtons() {
            const el = document.getElementById('reaction-filters');
            if (!el) return;
            const totalAll = Object.values(totals).reduce((s, v) => s + v, 0);
            let html = '<button class="reaction-filter-btn active" data-filter="all" onclick="setReactionFilter(\'all\')">All <span class="filter-count" id="filter-count-all">' + totalAll + '</span></button>';
            REACTION_TYPES.forEach(t => {
                html += '<button class="reaction-filter-btn" data-filter="' + t + '" onclick="setReactionFilter(\'' + t + '\')">' + EMOJI_BY_TYPE[t] + ' <span class="filter-count" id="filter-count-' + t + '">' + (totals[t] || 0) + '</span></button>';
            });
            el.innerHTML = html;
        }

        function updateFilterButtonStates() {
            const btns = document.querySelectorAll('#reaction-filters .reaction-filter-btn');
            btns.forEach(btn => {
                const filter = btn.getAttribute('data-filter');
                btn.classList.toggle('active', filter === activeFilter);
            });
        }

        function setReactionFilter(type) {
            activeFilter = type;
            latestOffset = 0;
            updateFilterButtonStates();
            loadLatestReactions();
        }

        async function loadReactions() {
            try {
                const r = await fetch(`${API_URL}?action=post_reactions_summary&_=${Date.now()}`, { credentials: 'include', cache: 'no-store' });
                const data = await r.json();
                if (r.ok) { updateStats(data); }
            } catch (e) { console.error('Failed to load reactions summary', e); }
        }

        function updateStats(data) {
            const pages = data.pages || [];
            REACTION_TYPES.forEach(t => { totals[t] = 0; });
            pages.forEach(page => {
                const reactions = page.reactions || {};
                REACTION_TYPES.forEach(t => { totals[t] += (parseInt(reactions[t]) || parseInt(page[t]) || 0); });
            });
            buildFilterButtons();
            updateFilterButtonStates();
        }

        async function clearReactions(pageUrl) {
            if (!confirm(`Clear all post reactions for:\n${pageUrl}`)) return;
            await AdminAuth.ensureCsrfToken();
            const msgEl = document.getElementById('reactions-message');
            try {
                const r = await fetch(`${API_URL}?action=delete_post_reactions&url=${encodeURIComponent(pageUrl)}&csrf_token=${encodeURIComponent(AdminAuth.getCsrfToken())}`, { method: 'DELETE', credentials: 'include' });
                const result = await r.json();
                if (r.ok) { msgEl.innerHTML = '<div class="message success">Reactions cleared.</div>'; setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 3000); loadReactions(); }
                else { msgEl.innerHTML = `<div class="message error">${result.error || 'Failed to clear'}</div>`; }
            } catch (e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        async function clearReaction(reactionId, pageUrl, reactionType) {
            if (!confirm(`Delete this ${reactionType} reaction?`)) return;
            await AdminAuth.ensureCsrfToken();
            const msgEl = document.getElementById('latest-message');
            try {
                const r = await fetch(`${API_URL}?action=delete_single_reaction&id=${encodeURIComponent(reactionId)}&csrf_token=${encodeURIComponent(AdminAuth.getCsrfToken())}`, { method: 'DELETE', credentials: 'include' });
                const result = await r.json();
                if (r.ok) { msgEl.innerHTML = '<div class="message success">Reaction deleted.</div>'; setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 3000); loadLatestReactions(); loadReactions(); }
                else { msgEl.innerHTML = `<div class="message error">${result.error || 'Failed to delete'}</div>`; }
            } catch (e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        function goToLatestPage(newOffset) {
            latestOffset = Math.max(0, newOffset);
            loadLatestReactions();
        }

        async function loadLatestReactions() {
            const container = document.getElementById('latest-reactions-container');
            if (!container) return;
            try {
                const r = await fetch(`${API_URL}?action=post_reactions_latest&limit=${LATEST_PAGE_SIZE}&offset=${latestOffset}&_=${Date.now()}`, { credentials: 'include', cache: 'no-store' });
                const data = await r.json();
                if (r.ok) {
                    latestTotal = data.total || 0;
                    let reactions = data.reactions || [];
                    if (activeFilter !== 'all') {
                        reactions = reactions.filter(react => react.reaction_type === activeFilter);
                    }
                    displayLatestReactions(reactions);
                }
                else { container.innerHTML = `<div class="message error">${data.error || 'Failed to load'}</div>`; }
            } catch (e) { container.innerHTML = `<div class="message error">Network error: ${e.message}</div>`; }
        }

        function displayLatestReactions(reactions) {
            const container = document.getElementById('latest-reactions-container');
            const pagBar = document.getElementById('latest-reactions-pagination');
            if (!container) return;
            if (!reactions.length) {
                container.innerHTML = '<p class="no-data">No reactions yet.</p>';
                if (pagBar) pagBar.innerHTML = '';
                return;
            }
            const thead = '<tr><th>Page</th><th>Reaction</th><th>IP Address</th><th>Date</th><th class="actions-cell">Actions</th></tr>';
            const rows = reactions.map(r => {
                const emoji = EMOJI_BY_TYPE[r.reaction_type] || r.reaction_type;
                const date = formatDate(r.created_at || r.date);
                const ip = escapeHtml(r.ip_address || 'N/A');
                const reactionId = r.id || r.reaction_id;
                const pageUrlEsc = (r.page_url || '').replace(/'/g, "\\'");
                return `<tr><td class="page-url">${renderPageUrl(r.page_url || '')}</td><td class="reaction-emoji-cell">${emoji}</td><td class="ip-cell">${ip}</td><td class="date-cell">${date}</td><td class="actions-cell"><button class="delete-reaction-btn" onclick="clearReaction('${reactionId}','${pageUrlEsc}','${r.reaction_type}')"><i data-lucide="trash-2"></i></button></td></tr>`;
            }).join('');
            container.innerHTML = `<table class="latest-reactions-table"><thead>${thead}</thead><tbody>${rows}</tbody></table>`;

            if (pagBar) {
                const totalPages = Math.max(1, Math.ceil(latestTotal / LATEST_PAGE_SIZE));
                const currentPage = Math.floor(latestOffset / LATEST_PAGE_SIZE) + 1;
                const hasPrev = latestOffset > 0;
                const hasNext = latestOffset + LATEST_PAGE_SIZE < latestTotal;
                pagBar.innerHTML = `
                    <button class="btn btn-secondary btn-sm" ${hasPrev ? '' : 'disabled'} onclick="goToLatestPage(${latestOffset - LATEST_PAGE_SIZE})">← Previous</button>
                    <span class="pg-info">Page ${currentPage} of ${totalPages}</span>
                    <button class="btn btn-secondary btn-sm" ${hasNext ? '' : 'disabled'} onclick="goToLatestPage(${latestOffset + LATEST_PAGE_SIZE})">Next →</button>
                `;
            }
            if(window.lucide) {
                lucide.createIcons();
            }
        }

        hoistToWindow({ clearReactions, clearReaction, loadLatestReactions, goToLatestPage, setReactionFilter });
        loadReactions();
        loadLatestReactions();
    },
};


// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

VIEWS['settings-general'] = {
    title: 'General Settings',
    css: `
        .util-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); overflow:hidden; }
        .util-card-header { padding:1rem 1.5rem; border-bottom:1px solid var(--gray,#e9ecef); display:flex; align-items:center; gap:.6rem; }
        .util-card-header h2 { font-size:1.1rem; color:var(--body-text,#333); }
        .util-card-header .icon { font-size:1.2rem; }
        .util-card-body { padding:1.5rem; }
        .setting-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; padding:.75rem 0; border-bottom:1px solid var(--gray,#f0f0f0); }
        .setting-row:last-of-type { border-bottom:none; }
        .setting-label { flex:1 1 200px; }
        .setting-label strong { color:var(--body-text); display:block; font-size:.95rem; }
        .setting-label span { font-size:.82rem; color:var(--body-text); opacity:.8; }
        .themed-control { background-color:transparent; color:var(--body-text); border:1px solid var(--gray,#ddd); border-radius:4px; padding:.5rem .75rem; font-size:.95rem; }
        select.themed-control option { background-color:var(--on-background,#fff); color:var(--body-text,#333); }
        .toggle-switch { position:relative; display:inline-block; width:46px; height:26px; flex-shrink:0; }
        .toggle-switch input { opacity:0; width:0; height:0; }
        .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; border-radius:26px; transition:.3s; }
        .toggle-slider:before { position:absolute; content:""; height:20px; width:20px; left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s; }
        input:checked+.toggle-slider { background-color:#4a90e2; }
        input:checked+.toggle-slider:before { transform:translateX(20px); }
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">General Settings</h2>
            <div class="util-card">
                <div class="util-card-header"><span class="icon">⚙️</span><h2>General</h2></div>
                <div class="util-card-body">
                    <div id="settings-message"></div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Require Moderation</strong><span>New comments must be approved before appearing</span></div>
                        <label class="toggle-switch"><input type="checkbox" id="setting-require-moderation"><span class="toggle-slider"></span></label>
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Comment Sort Order</strong><span>Default order for top-level comments on the site</span></div>
                        <select id="setting-comment-sort-order" class="themed-control" style="min-width:180px;">
                            <option value="asc">Oldest first (ASC)</option>
                            <option value="desc">Newest first (DESC)</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `,
    init({ hoistToWindow }) {
        async function loadSettings() {
            try {
                const r = await fetch(`${API_URL}?action=get_settings`, { credentials: 'include' });
                const d = await r.json();
                if (!r.ok) return;
                const s = d.settings;
                document.getElementById('setting-require-moderation').checked  = (s.require_moderation  === 'true');
                document.getElementById('setting-comment-sort-order').value     = s.comment_sort_order === 'desc' ? 'desc' : 'asc';
            } catch (e) { console.error('Settings load failed', e); }
        }

        ['setting-require-moderation','setting-comment-sort-order'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', saveSettings);
        });

        async function saveSettings() {
            const msgEl = document.getElementById('settings-message');
            await AdminAuth.ensureCsrfToken();
            try {
                // Fetch current settings first to preserve others
                const g = await fetch(`${API_URL}?action=get_settings`, { credentials: 'include' });
                const current = (await g.json()).settings || {};

                const payload = {
                    csrf_token:           AdminAuth.getCsrfToken(),
                    require_moderation:   document.getElementById('setting-require-moderation').checked   ? 'true' : 'false',
                    comment_sort_order:   document.getElementById('setting-comment-sort-order').value,
                };

                const r = await fetch(`${API_URL}?action=save_settings`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', body: JSON.stringify(payload),
                });
                const d = await r.json();
                if (r.ok) {
                    msgEl.innerHTML = '<div class="message success">Settings saved.</div>';
                    setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 2500);
                } else { msgEl.innerHTML = `<div class="message error">${d.error}</div>`; }
            } catch (e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        hoistToWindow({ saveSettings });
        loadSettings();
    }
};

VIEWS['settings-configuration'] = {
    title: 'Configuration',
    css: `
        .util-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); overflow:hidden; }
        .util-card-header { padding:1rem 1.5rem; border-bottom:1px solid var(--gray,#e9ecef); display:flex; align-items:center; gap:.6rem; }
        .util-card-header h2 { font-size:1.1rem; color:var(--body-text,#333); }
        .util-card-header .icon { font-size:1.2rem; }
        .util-card-body { padding:1.5rem; }
        .setting-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; padding:.75rem 0; border-bottom:1px solid var(--gray,#f0f0f0); }
        .setting-row:last-of-type { border-bottom:none; }
        .setting-label { flex:1 1 200px; }
        .setting-label strong { color:var(--body-text); display:block; font-size:.95rem; }
        .setting-label span { font-size:.82rem; color:var(--body-text); opacity:.8; }
        .themed-control { background-color:transparent; color:var(--body-text); border:1px solid var(--gray,#ddd); border-radius:4px; padding:.5rem .75rem; font-size:.95rem; width:100%; max-width:300px; }
        select.themed-control option { background-color:var(--on-background,#fff); color:var(--body-text,#333); }
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">Configuration</h2>
            <div id="settings-message"></div>

            <div class="util-card" style="margin-bottom: 1.5rem;">
                <div class="util-card-header"><span class="icon">⚙️</span><h2>System Configuration</h2></div>
                <div class="util-card-body">
                    <div class="setting-row">
                        <div class="setting-label"><strong>Allowed Origins</strong><span>Comma-separated list of domains allowed to embed comments (CORS)</span></div>
                        <input type="text" id="config-allowed-origins" class="themed-control" placeholder="https://example.com">
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Timezone</strong><span>Choose the timezone for comment timestamps</span></div>
                        <select id="config-timezone" class="themed-control">
                            <option value="UTC">UTC</option>
                            <option value="America/New_York">America/New_York (Eastern Time)</option>
                            <option value="America/Chicago">America/Chicago (Central Time)</option>
                            <option value="America/Denver">America/Denver (Mountain Time)</option>
                            <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                            <option value="Europe/London">Europe/London (GMT)</option>
                            <option value="Europe/Paris">Europe/Paris (Central European)</option>
                            <option value="Europe/Berlin">Europe/Berlin (Central European)</option>
                            <option value="Asia/Tehran">Asia/Tehran (Iran)</option>
                            <option value="Asia/Dubai">Asia/Dubai (Gulf)</option>
                            <option value="Asia/Tokyo">Asia/Tokyo (Japan)</option>
                            <option value="Asia/Shanghai">Asia/Shanghai (China)</option>
                            <option value="Australia/Sydney">Australia/Sydney (Australian Eastern)</option>
                        </select>
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Frontend Language</strong><span>Language for the comment widget interface</span></div>
                        <select id="config-language" class="themed-control">
                            <option value="en">English</option>
                            <option value="fa">فارسی (Persian)</option>
                        </select>
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Calendar System</strong><span>Calendar preference for the admin panel</span></div>
                        <select id="config-calendar" class="themed-control">
                            <option value="gregorian">Gregorian</option>
                            <option value="persian">Solar Hijri (Jalali / شمسی)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="util-card" style="margin-bottom: 1.5rem;">
                <div class="util-card-header"><span class="icon">👤</span><h2>Admin Profile</h2></div>
                <div class="util-card-body">
                    <div class="setting-row">
                        <div class="setting-label"><strong>Admin Name</strong><span>Used to pre-fill the reply form</span></div>
                        <input type="text" id="config-admin-name" class="themed-control" placeholder="Your Name">
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Admin Email</strong><span>Used to pre-fill the reply form</span></div>
                        <input type="email" id="config-admin-email" class="themed-control" placeholder="your@email.com">
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Admin Website</strong><span>Used to pre-fill the reply form (optional)</span></div>
                        <input type="url" id="config-admin-url" class="themed-control" placeholder="https://yourwebsite.com">
                    </div>
                </div>
            </div>

            <button id="save-config-btn" class="btn btn-primary" onclick="saveConfig()">Save</button>
        </div>`,

    init({ hoistToWindow }) {
        async function loadConfig() {
            const msgEl = document.getElementById('settings-message');
            try {
                // Load system config
                const r = await fetch(`${API_URL}?action=get_config`, { credentials: 'include' });
                const d = await r.json();
                if (r.ok) {
                    document.getElementById('config-allowed-origins').value = Array.isArray(d.allowed_origins) ? d.allowed_origins.join(', ') : '';
                    document.getElementById('config-timezone').value = d.timezone || 'UTC';
                    document.getElementById('config-language').value = d.app_language || 'en';
                    document.getElementById('config-calendar').value = d.app_calendar || 'gregorian';
                } else {
                    if (msgEl) msgEl.innerHTML = `<div class="message error">${d.error || 'Failed to load configuration'}</div>`;
                }

                // Load admin profile settings
                const sr = await fetch(`${API_URL}?action=get_settings`, { credentials: 'include' });
                const sd = await sr.json();
                if (sr.ok && sd.settings) {
                    document.getElementById('config-admin-name').value = sd.settings.admin_name || '';
                    document.getElementById('config-admin-email').value = sd.settings.admin_email || '';
                    document.getElementById('config-admin-url').value = sd.settings.admin_url || '';
                }
            } catch (e) {
                if (msgEl) msgEl.innerHTML = '<div class="message error">Network error loading configuration</div>';
            }
        }

        async function saveConfig() {
            const msgEl = document.getElementById('settings-message');

            // System Config
            const allowedOrigins = document.getElementById('config-allowed-origins').value.split(',').map(s => s.trim()).filter(s => s);
            const timezone = document.getElementById('config-timezone').value;
            const language = document.getElementById('config-language').value;
            const calendar = document.getElementById('config-calendar').value;

            // Admin Profile
            const adminName = document.getElementById('config-admin-name').value.trim();
            const adminEmail = document.getElementById('config-admin-email').value.trim();
            const adminUrl = document.getElementById('config-admin-url').value.trim();

            if (!allowedOrigins.length) {
                if (msgEl) msgEl.innerHTML = '<div class="message error">At least one allowed origin is required</div>';
                return;
            }

            try {
                await AdminAuth.ensureCsrfToken();

                // Fetch current settings to preserve them
                const sr = await fetch(`${API_URL}?action=get_settings`, { credentials: 'include' });
                const currentSettings = (await sr.json()).settings || {};

                // Save Settings (Admin Profile)
                const settingsPayload = {
                    csrf_token: AdminAuth.getCsrfToken(),
                    require_moderation: currentSettings.require_moderation || 'false',
                    comment_sort_order: currentSettings.comment_sort_order || 'desc',
                    admin_name: adminName,
                    admin_email: adminEmail,
                    admin_url: adminUrl
                };

                const sReq = await fetch(`${API_URL}?action=save_settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(settingsPayload)
                });

                // Save Config (System)
                const r = await fetch(`${API_URL}?action=save_config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        csrf_token: AdminAuth.getCsrfToken(),
                        allowed_origins: allowedOrigins,
                        timezone: timezone,
                        app_language: language,
                        app_calendar: calendar
                    })
                });

                const d = await r.json();

                if (r.ok && sReq.ok) {
                    var saveBtn = document.getElementById('save-config-btn');
                    if (saveBtn) {
                        saveBtn.textContent = 'Saved \u2713';
                        setTimeout(function() { saveBtn.textContent = 'Save'; }, 1500);
                    }
                } else {
                    if (msgEl) msgEl.innerHTML = `<div class="message error">${d.error || 'Failed to save configuration'}</div>`;
                }
            } catch (e) {
                if (msgEl) msgEl.innerHTML = '<div class="message error">Network error saving configuration</div>';
            }
        }

        hoistToWindow({ saveConfig });
        loadConfig();
    },
};

VIEWS['settings-database'] = {
    title: 'Database Settings',
    css: `
        .util-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); overflow:hidden; }
        .util-card-header { padding:1rem 1.5rem; border-bottom:1px solid var(--gray,#e9ecef); display:flex; align-items:center; gap:.6rem; }
        .util-card-header h2 { font-size:1.1rem; color:var(--body-text,#333); }
        .util-card-header .icon { font-size:1.2rem; }
        .util-card-body { padding:1.5rem; }
        .db-stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.75rem; margin-bottom:1.25rem; }
        .db-stat-item { background:var(--light); border:solid 1px var(--gray); border-radius:6px; padding:.75rem 1rem; text-align:center; }
        .db-stat-item .num { font-size:1.4rem; font-weight:700; color:#4a90e2; }
        .db-stat-item .lbl { font-size:.78rem; color:#888; text-transform:uppercase; letter-spacing:.03em; }
        .db-actions { display:flex; gap:.75rem; flex-wrap:wrap; }
        .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:1rem; z-index:9999; }
        .modal { width:100%; max-width:560px; background:var(--on-background,#fff); color:var(--body-text,#333); border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.25); overflow:hidden; }
        .modal-header,.modal-footer { padding:.85rem 1rem; display:flex; align-items:center; justify-content:space-between; gap:.75rem; border-bottom:1px solid var(--gray,#eee); }
        .modal-footer { border-top:1px solid var(--gray,#eee); border-bottom:none; justify-content:flex-end; }
        .modal-body { padding:1rem; }
        .modal-close { border:none; background:transparent; font-size:1.35rem; line-height:1; cursor:pointer; color:var(--body-text,#666); opacity:.6; }
        .modal-close:hover { opacity:1; }
        .muted { opacity:.7; font-size:.9rem; }
        @media (max-width:768px) { .db-stats-grid { grid-template-columns:repeat(2,1fr); } }
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">Database Settings</h2>
            <div class="util-card">
                <div class="util-card-header"><span class="icon">🗄️</span><h2>Database</h2></div>
                <div class="util-card-body">
                    <div id="db-stats-area"><p>Loading database stats...</p></div>
                    <div id="db-message"></div>
                    <div class="db-actions">
                        <button class="btn btn-primary btn-sm" onclick="vacuumDb()">Optimize (VACUUM)</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteSpam()" id="btn-delete-spam">Purge All Spam</button>
                        <button class="btn btn-danger btn-sm" onclick="openDeleteDataModal()">Delete Data</button>
                    </div>
                </div>
            </div>

            <div id="delete-data-modal" class="modal-overlay" style="display:none;">
                <div class="modal">
                    <div class="modal-header"><strong>Delete data from database</strong><button class="modal-close" onclick="closeDeleteDataModal()" aria-label="Close">×</button></div>
                    <div class="modal-body">
                        <div class="message warning" style="margin:0 0 .75rem 0;"><strong>Warning:</strong> This permanently deletes selected data records. The schema stays intact, but the data cannot be recovered unless you restore from an export/backup.</div>
                        <label class="checkbox-row" style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0;"><input type="checkbox" id="dd-select-all" onchange="toggleDeleteDataSelectAll()"><span><strong>Select All</strong></span></label>
                        <div style="margin-top:.5rem;">
                            <label class="checkbox-row" style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0;"><input type="checkbox" id="dd-comments" onchange="syncDeleteDataSelectAll()"><span>Comments <span class="muted" id="dd-count-comments">(…)</span></span></label>
                            <label class="checkbox-row" style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0;"><input type="checkbox" id="dd-post-reactions" onchange="syncDeleteDataSelectAll()"><span>Post Reactions <span class="muted" id="dd-count-post-reactions">(…)</span></span></label>
                            <label class="checkbox-row" style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0;"><input type="checkbox" id="dd-comment-reactions" onchange="syncDeleteDataSelectAll()"><span>Comment Reactions <span class="muted" id="dd-count-comment-reactions">(…)</span></span></label>
                        </div>
                        <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--gray,#dee2e6);">
                            <label style="display:flex;align-items:flex-start;gap:.5rem;"><input type="checkbox" id="dd-confirm"><span>I understand this action is permanent and want to delete the selected data.</span></label>
                            <div id="dd-message" style="margin-top:.5rem;"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary btn-sm" onclick="closeDeleteDataModal()">Cancel</button>
                        <button class="btn btn-danger btn-sm" id="dd-delete-btn" onclick="runDeleteData()" disabled>Delete selected</button>
                    </div>
                </div>
            </div>
        </div>
    `,
    init({ hoistToWindow }) {
        async function loadDbStats() {
            const area = document.getElementById('db-stats-area');
            if (!area) return;
            try {
                const r = await fetch(`${API_URL}?action=db_stats`, { credentials: 'include' });
                const d = await r.json();
                if (!r.ok) { area.innerHTML = `<div class="message error">${d.error}</div>`; return; }
                const t = d.tables, cs = d.comment_statuses || {};
                area.innerHTML = `<div class="db-stats-grid">
                    <div class="db-stat-item"><div class="num">${t.comments ?? 0}</div><div class="lbl">Comments</div></div>
                    <div class="db-stat-item"><div class="num">${t.post_reactions ?? 0}</div><div class="lbl">Post Reactions</div></div>
                    <div class="db-stat-item"><div class="num">${t.comment_reactions ?? 0}</div><div class="lbl">Comment Reactions</div></div>
                    <div class="db-stat-item"><div class="num">${d.db_size_bytes > 0 ? formatBytes(d.db_size_bytes) : '—'}</div><div class="lbl">DB Size</div></div>
                </div>`;
                const spamCount = cs.spam ?? 0;
                const btn = document.getElementById('btn-delete-spam');
                if (btn) { btn.textContent = spamCount > 0 ? `Purge ${spamCount} Spam` : 'Purge All Spam'; btn.disabled = spamCount === 0; }
            } catch (e) { area.innerHTML = '<div class="message error">Failed to load stats</div>'; }
        }

        async function vacuumDb() {
            const msgEl = document.getElementById('db-message');
            await AdminAuth.ensureCsrfToken();
            msgEl.innerHTML = '<div class="message info">Running VACUUM…</div>';
            try {
                const r = await fetch(`${API_URL}?action=vacuum`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({csrf_token:AdminAuth.getCsrfToken()}) });
                const d = await r.json();
                if (r.ok) { const saved=d.saved_bytes>0?` Freed ${formatBytes(d.saved_bytes)}.`:' No space reclaimed (already optimal).'; msgEl.innerHTML=`<div class="message success">Database optimized.${saved} New size: ${formatBytes(d.size_after)}.</div>`; loadDbStats(); }
                else { msgEl.innerHTML = `<div class="message error">${d.error}</div>`; }
            } catch(e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        async function deleteSpam() {
            const msgEl = document.getElementById('db-message');
            if(!confirm('Delete ALL comments marked as spam? This cannot be undone.')) return;
            await AdminAuth.ensureCsrfToken();
            msgEl.innerHTML = '<div class="message info">Purging spam…</div>';
            try {
                const r = await fetch(`${API_URL}?action=delete_spam`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({csrf_token:AdminAuth.getCsrfToken()}) });
                const d = await r.json();
                if (r.ok) { msgEl.innerHTML = `<div class="message success">Deleted ${d.deleted_count} spam comment(s).</div>`; loadDbStats(); }
                else { msgEl.innerHTML = `<div class="message error">${d.error}</div>`; }
            } catch(e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        function openDeleteDataModal() {
            const m = document.getElementById('delete-data-modal');
            if (!m) return;
            m.style.display = 'flex';
            document.getElementById('dd-select-all').checked = false;
            ['comments','post-reactions','comment-reactions','confirm'].forEach(k => { const el = document.getElementById('dd-'+k); if (el) el.checked = false; });
            document.getElementById('dd-message').innerHTML = '';
            document.getElementById('dd-delete-btn').disabled = true;
            syncDeleteDataSelectAll();

            fetch(`${API_URL}?action=db_stats`, { credentials: 'include' })
                .then(r => r.json())
                .then(d => {
                    if (d.tables) {
                        const c = document.getElementById('dd-count-comments'); if (c) c.textContent = `(${d.tables.comments ?? 0})`;
                        const pr = document.getElementById('dd-count-post-reactions'); if (pr) pr.textContent = `(${d.tables.post_reactions ?? 0})`;
                        const cr = document.getElementById('dd-count-comment-reactions'); if (cr) cr.textContent = `(${d.tables.comment_reactions ?? 0})`;
                    }
                }).catch(()=>{});
        }

        function closeDeleteDataModal() {
            const m = document.getElementById('delete-data-modal');
            if (m) m.style.display = 'none';
        }

        function toggleDeleteDataSelectAll() {
            const allChecked = document.getElementById('dd-select-all').checked;
            ['comments','post-reactions','comment-reactions'].forEach(k => {
                const el = document.getElementById('dd-'+k);
                if (el) el.checked = allChecked;
            });
            updateDeleteDataBtn();
        }

        function syncDeleteDataSelectAll() {
            const all = document.getElementById('dd-select-all');
            const c = document.getElementById('dd-comments').checked;
            const pr = document.getElementById('dd-post-reactions').checked;
            const cr = document.getElementById('dd-comment-reactions').checked;
            if (all) all.checked = (c && pr && cr);
            updateDeleteDataBtn();
        }

        function updateDeleteDataBtn() {
            const btn = document.getElementById('dd-delete-btn');
            const conf = document.getElementById('dd-confirm');
            if (!btn || !conf) return;
            const items = ['comments','post-reactions','comment-reactions'];
            const anyChecked = items.some(k => document.getElementById('dd-'+k)?.checked);
            btn.disabled = !(anyChecked && conf.checked);
            if (conf) {
                conf.onchange = () => {
                    const anyCheckedNow = items.some(k => document.getElementById('dd-'+k)?.checked);
                    btn.disabled = !(anyCheckedNow && conf.checked);
                };
            }
        }

        async function runDeleteData() {
            const msgEl = document.getElementById('dd-message');
            const btn = document.getElementById('dd-delete-btn');
            if (!msgEl || !btn) return;

            const req = {
                csrf_token: AdminAuth.getCsrfToken(),
                delete_comments: document.getElementById('dd-comments').checked,
                delete_post_reactions: document.getElementById('dd-post-reactions').checked,
                delete_comment_reactions: document.getElementById('dd-comment-reactions').checked,
            };

            btn.disabled = true;
            msgEl.innerHTML = '<div class="message info">Deleting data...</div>';

            try {
                await AdminAuth.ensureCsrfToken();
                req.csrf_token = AdminAuth.getCsrfToken();
                const r = await fetch(`${API_URL}?action=db_delete_data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(req) });
                const d = await r.json();

                if (r.ok) {
                    const parts = [];
                    if (d.deleted?.comments !== undefined) parts.push(`${d.deleted.comments} comment(s)`);
                    if (d.deleted?.post_reactions !== undefined) parts.push(`${d.deleted.post_reactions} post reaction(s)`);
                    if (d.deleted?.comment_reactions !== undefined) parts.push(`${d.deleted.comment_reactions} comment reaction(s)`);

                    const resStr = parts.length > 0 ? parts.join(', ') : 'no data';
                    msgEl.innerHTML = `<div class="message success">Successfully deleted ${resStr}. Vacuuming database...</div>`;

                    await fetch(`${API_URL}?action=vacuum`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({csrf_token:AdminAuth.getCsrfToken()}) });

                    setTimeout(() => {
                        closeDeleteDataModal();
                        loadDbStats();
                        const pm = document.getElementById('db-message');
                        if (pm) { pm.innerHTML = `<div class="message success">Data deletion complete (${resStr}).</div>`; setTimeout(()=>pm.innerHTML='', 5000); }
                    }, 1500);
                } else {
                    msgEl.innerHTML = `<div class="message error">${d.error || 'Deletion failed'}</div>`;
                    btn.disabled = false;
                }
            } catch (e) {
                msgEl.innerHTML = '<div class="message error">Network error</div>';
                btn.disabled = false;
            }
        }

        hoistToWindow({
            vacuumDb, deleteSpam,
            openDeleteDataModal, closeDeleteDataModal, toggleDeleteDataSelectAll, syncDeleteDataSelectAll, runDeleteData
        });

        loadDbStats();
        // Setup confirm checkbox listener
        const confCheckbox = document.getElementById('dd-confirm');
        if (confCheckbox) {
            confCheckbox.addEventListener('change', updateDeleteDataBtn);
        }
    }
};

VIEWS['settings-notifications'] = {
    title: 'Notification Settings',
    css: `
        .util-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); overflow:hidden; }
        .util-card-header { padding:1rem 1.5rem; border-bottom:1px solid var(--gray,#e9ecef); display:flex; align-items:center; gap:.6rem; }
        .util-card-header h2 { font-size:1.1rem; color:var(--body-text,#333); }
        .util-card-header .icon { font-size:1.2rem; }
        .util-card-body { padding:1.5rem; }
        .util-card-body p { color:var(--body-text,#666); opacity:.8; font-size:.9rem; margin-bottom:1rem; }
        .setting-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; padding:.75rem 0; border-bottom:1px solid var(--gray,#f0f0f0); }
        .setting-row:last-of-type { border-bottom:none; }
        .setting-label { flex:1 1 200px; }
        .setting-label strong { color:var(--body-text); display:block; font-size:.95rem; }
        .setting-label span { font-size:.82rem; color:var(--body-text); opacity:.8; }
        .themed-control { background-color:transparent; color:var(--body-text); border:1px solid var(--gray,#ddd); border-radius:4px; padding:.5rem .75rem; font-size:.95rem; }
        .toggle-switch { position:relative; display:inline-block; width:46px; height:26px; flex-shrink:0; }
        .toggle-switch input { opacity:0; width:0; height:0; }
        .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; border-radius:26px; transition:.3s; }
        .toggle-slider:before { position:absolute; content:""; height:20px; width:20px; left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s; }
        input:checked+.toggle-slider { background-color:#4a90e2; }
        input:checked+.toggle-slider:before { transform:translateX(20px); }
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">Notification</h2>
            <div class="util-card">
                <div class="util-card-header"><span class="icon">🔔</span><h2>Telegram Notifications</h2></div>
                <div class="util-card-body">
                    <p>Get notified in Telegram when new comments are submitted. Configure the bot token and chat ID using <code style="background:var(--gray,#f0f0f0);padding:.15rem .4rem;border-radius:3px;font-size:.88rem;">npm run telegram</code>.</p>
                    <div id="telegram-message"></div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Telegram Notifications</strong><span>Send new comment alerts to Telegram</span></div>
                        <label class="toggle-switch"><input type="checkbox" id="setting-telegram-enabled"><span class="toggle-slider"></span></label>
                    </div>
                </div>
            </div>
        </div>
    `,
    init({ hoistToWindow }) {
        async function loadTelegramStatus() {
            try {
                const r = await fetch(`${API_URL}?action=telegram_status`, { credentials: 'include' });
                if (r.ok) {
                    const d = await r.json();
                    const cb = document.getElementById('setting-telegram-enabled');
                    if (cb) cb.checked = d.telegram_enabled;
                }
            } catch (e) { console.error('Telegram status load failed', e); }
        }

        async function toggleTelegram() {
            const cb = document.getElementById('setting-telegram-enabled');
            const msgEl = document.getElementById('telegram-message');
            if (!cb) return;
            const enabled = cb.checked;
            try {
                await AdminAuth.ensureCsrfToken();
                const r = await fetch(`${API_URL}?action=telegram_toggle`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ telegram_enabled: enabled, csrf_token: AdminAuth.getCsrfToken() }),
                });
                const d = await r.json();
                if (r.ok) {
                    cb.checked = d.telegram_enabled;
                    if (msgEl) {
                        msgEl.innerHTML = `<div class="message success">Telegram notifications ${d.telegram_enabled ? 'enabled' : 'disabled'}.</div>`;
                        setTimeout(() => { msgEl.innerHTML = ''; }, 2500);
                    }
                } else {
                    if (msgEl) msgEl.innerHTML = `<div class="message error">${d.error || 'Failed to update'}</div>`;
                }
            } catch (e) {
                if (msgEl) msgEl.innerHTML = '<div class="message error">Network error</div>';
            }
        }

        document.getElementById('setting-telegram-enabled')?.addEventListener('change', toggleTelegram);

        hoistToWindow({ toggleTelegram });
        loadTelegramStatus();
    }
};

VIEWS['settings-import-export'] = {
    title: 'Import & Export Settings',
    css: `
        .util-card { background:var(--on-background); border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); overflow:hidden; }
        .util-card-header { padding:1rem 1.5rem; border-bottom:1px solid var(--gray,#e9ecef); display:flex; align-items:center; gap:.6rem; }
        .util-card-header h2 { font-size:1.1rem; color:var(--body-text,#333); }
        .util-card-header .icon { font-size:1.2rem; }
        .util-card-body { padding:1.5rem; }
        .util-card-body p { color:var(--body-text,#666); opacity:.8; font-size:.9rem; margin-bottom:1rem; }
        .file-drop { border:2px dashed var(--gray,#d0d7de); border-radius:6px; padding:1.5rem; text-align:center; cursor:pointer; transition:border-color .2s,background .2s; margin-bottom:1rem; position:relative; }
        .file-drop:hover,.file-drop.drag-over { border-color:#4a90e2; background:#f0f7ff; }
        .file-drop input[type="file"] { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; }
        .file-drop .drop-icon { font-size:2rem; margin-bottom:.5rem; }
        .file-drop .drop-label { font-size:.9rem; color:var(--body-text); }
        .file-drop .file-selected { font-size:.88rem; color:#28a745; font-weight:600; margin-top:.4rem; }
        .preview-box { background:var(--on-background); border:1px solid var(--gray,#dee2e6); border-radius:6px; padding:1rem; margin:.75rem 0; font-size:.88rem; }
        .preview-box table { width:100%; border-collapse:collapse; }
        .preview-box td { padding:.3rem .5rem; }
        .preview-box td:first-child { color:var(--body-text); width:55%; }
        .preview-box td:last-child { font-weight:600; }
        .import-actions { display:flex; gap:.75rem; align-items:center; margin-top:.75rem; }
        .export-row { display:flex; align-items:center; justify-content:space-between; padding:.75rem 0; border-bottom:1px solid var(--gray,#f0f0f0); }
        .export-row:last-child { border-bottom:none; }
        .export-row .export-info strong { display:block; color:var(--body-text); font-size:.95rem; }
        .export-row .export-info span { font-size:.82rem; color:var(--body-text); opacity:.8; }
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">Import & Export</h2>
            <div class="util-card">
                <div class="util-card-header"><span class="icon">📤</span><h2>Export Comments</h2></div>
                <div class="util-card-body">
                    <div class="export-row">
                        <div class="export-info"><strong>Full Backup JSON</strong><span>Complete backup: comments, post reactions, comment reactions, IP addresses, and metadata</span></div>
                        <a href="/api?action=export_comments_json" class="btn btn-success btn-sm">Download JSON</a>
                    </div>
                    <div style="margin-top:1rem;"><div id="export-message"></div></div>
                </div>
            </div>

            <div class="util-card" style="margin-top: 1.5rem;">
                <div class="util-card-header"><span class="icon">📥</span><h2>Import Comments</h2></div>
                <div class="util-card-body">
                    <p>Import from a full backup JSON or a legacy JSON array of comments. Full backups restore comments, post reactions, comment reactions, and metadata. Duplicate records are skipped automatically.</p>
                    <div class="file-drop" id="file-drop" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                        <input type="file" id="import-file" accept=".json" onchange="handleFileSelect(event)">
                        <div class="drop-icon">📂</div>
                        <div class="drop-label">Drop JSON backup file here or click to browse</div>
                        <div class="file-selected" id="file-selected-label" style="display:none;"></div>
                    </div>
                    <div id="import-preview" style="display:none;"></div>
                    <div id="import-message"></div>
                    <div class="import-actions">
                        <button class="btn btn-secondary btn-sm" id="btn-preview" onclick="previewImport()" disabled>Preview</button>
                        <button class="btn btn-success btn-sm" id="btn-import" onclick="runImport()" disabled>Import</button>
                        <span id="import-status" style="font-size:.85rem;color:var(--body-text,#888);opacity:.8;"></span>
                    </div>
                </div>
            </div>
        </div>
    `,
    init({ hoistToWindow }) {
        let importFileContent = null;
        let importPreviewDone = false;

        function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('file-drop')?.classList.add('drag-over'); }
        function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('file-drop')?.classList.remove('drag-over'); }
        function handleDrop(e) {
            e.preventDefault(); e.stopPropagation();
            const fd = document.getElementById('file-drop'); if (fd) fd.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const f = e.dataTransfer.files[0];
                document.getElementById('import-file').files = e.dataTransfer.files;
                processFile(f);
            }
        }
        function handleFileSelect(e) { if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]); }
        function processFile(file) {
            importFileContent = null; importPreviewDone = false;
            const bprev = document.getElementById('btn-preview'), bimp = document.getElementById('btn-import');
            if(bprev) bprev.disabled = true; if(bimp) bimp.disabled = true;
            document.getElementById('import-preview').style.display = 'none';
            document.getElementById('import-message').innerHTML = '';

            const flabel = document.getElementById('file-selected-label');
            if (!file.name.endsWith('.json')) {
                if(flabel) { flabel.style.display = 'block'; flabel.style.color = '#dc3545'; flabel.textContent = 'Unsupported file type. Please select a .json backup file.'; }
                return;
            }
            if(flabel) { flabel.style.display = 'block'; flabel.style.color = '#28a745'; flabel.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`; }

            const r = new FileReader();
            r.onload = (e) => { importFileContent = e.target.result; if(bprev) bprev.disabled = false; if(bimp) bimp.disabled = false; };
            r.readAsText(file);
        }

        async function previewImport() {
            if (!importFileContent) return;
            const msgEl = document.getElementById('import-message');
            const prevEl = document.getElementById('import-preview');
            await AdminAuth.ensureCsrfToken();
            if (msgEl) msgEl.innerHTML = '<div class="message info">Analyzing file…</div>';
            if (prevEl) prevEl.style.display = 'none';
            try {
                const r = await fetch(`${API_URL}?action=import_comments&preview=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ csrf_token: AdminAuth.getCsrfToken(), content: importFileContent }) });
                const d = await r.json();
                if (r.ok) {
                    if (msgEl) msgEl.innerHTML = '';
                    if (prevEl) {
                        prevEl.style.display = 'block';
                        const formatName = (d.format === 'json') ? 'Full Backup' : (d.format === 'legacy_json') ? 'Legacy Comments' : 'Comments Export';
                        prevEl.innerHTML = `
                            <strong>Preview (${formatName})</strong>
                            <table>
                                <tbody>
                                    <tr><td>Comments</td><td>${d.comments ?? 0}</td></tr>
                                    <tr><td>Comment reactions</td><td>${d.comment_reactions ?? 0}</td></tr>
                                    <tr><td>Post reactions</td><td>${d.post_reactions ?? 0}</td></tr>
                                </tbody>
                            </table>
                            <div style="margin-top:.75rem;font-size:.85rem;color:#666;">Note: Duplicate records will be automatically skipped during import.</div>
                        `;
                    }
                    importPreviewDone = true;
                } else { if (msgEl) msgEl.innerHTML = `<div class="message error">${d.error}</div>`; }
            } catch (e) { if (msgEl) msgEl.innerHTML = '<div class="message error">Network error analyzing file</div>'; }
        }

        async function runImport() {
            if (!importFileContent) return;
            if (!importPreviewDone) {
                if (!confirm('You are importing without previewing. Proceed?')) return;
            }
            const msgEl = document.getElementById('import-message');
            const statusEl = document.getElementById('import-status');
            const bimp = document.getElementById('btn-import');
            await AdminAuth.ensureCsrfToken();
            if(bimp) bimp.disabled = true;
            if(msgEl) msgEl.innerHTML = '';
            if(statusEl) statusEl.textContent = 'Importing... this may take a moment for large files.';
            try {
                const r = await fetch(`${API_URL}?action=import_comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ csrf_token: AdminAuth.getCsrfToken(), content: importFileContent }) });
                const d = await r.json();
                if(statusEl) statusEl.textContent = '';
                if(r.ok) {
                    const parts = [];
                    if((d.imported_comments ?? 0) > 0) parts.push(`${d.imported_comments} comment${d.imported_comments !== 1 ? 's' : ''}`);
                    if((d.imported_comment_reactions ?? 0) > 0) parts.push(`${d.imported_comment_reactions} comment reaction${d.imported_comment_reactions !== 1 ? 's' : ''}`);
                    if((d.imported_post_reactions ?? 0) > 0) parts.push(`${d.imported_post_reactions} post reaction${d.imported_post_reactions !== 1 ? 's' : ''}`);
                    const skipped = (d.skipped_comments ?? 0) + (d.skipped_comment_reactions ?? 0) + (d.skipped_post_reactions ?? 0);
                    const dupNote = skipped > 0 ? ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)` : '';
                    if(msgEl) msgEl.innerHTML = `<div class="message success">Imported ${parts.length ? parts.join(', ') : 'no new items'}${dupNote}.</div>`;
                    const iprev = document.getElementById('import-preview'); if(iprev) iprev.style.display = 'none';
                    importFileContent = null; importPreviewDone = false;
                    const bprev = document.getElementById('btn-preview'); if(bprev) bprev.disabled = true;
                    const flabel = document.getElementById('file-selected-label'); if(flabel) flabel.style.display = 'none';
                } else {
                    if(msgEl) msgEl.innerHTML = `<div class="message error">${d.error}</div>`;
                    if(bimp) bimp.disabled = false;
                }
            } catch(e) {
                if(msgEl) msgEl.innerHTML = '<div class="message error">Network error</div>';
                if(statusEl) statusEl.textContent = '';
                if(bimp) bimp.disabled = false;
            }
        }

        hoistToWindow({ handleDragOver, handleDragLeave, handleDrop, handleFileSelect, previewImport, runImport });
    }
};

// Sidebar toggle logic
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
