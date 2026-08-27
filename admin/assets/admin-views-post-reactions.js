/**
 * admin-views-post-reactions.js
 * Post Reactions view (summary stats, latest reactions table)
 *
 * Registered on the global VIEWS object by admin-app.js.
 * Depends on globals: API_URL, apiFetch, escapeHtml, formatDate, renderPageUrl, formatBytes (admin-common.js / admin-app.js)
 */

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
        const EMOJI_BY_TYPE = { thumbsup:'👍', dislike:'👎', pray:'🙏', ok:'👌', fire:'🔥', heart:'❤️', frown:'☹️', rage:'😡', funny:'😄', neutral:'😐' };
        const REACTION_TYPES = ['thumbsup','dislike','pray','ok','fire','heart','frown','rage','funny','neutral'];
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
                const { ok, data } = await apiFetch(`${API_URL}/reactions/post/summary?_=${Date.now()}`, { noStore: true });
                if (ok) { updateStats(data); }
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
            const msgEl = document.getElementById('reactions-message');
            try {
                await AdminAuth.ensureCsrfToken();
                const { ok, data } = await apiFetch(`${API_URL}/admin/reactions/delete-by-url?url=${encodeURIComponent(pageUrl)}&csrf_token=${encodeURIComponent(AdminAuth.getCsrfToken())}`, { method: 'DELETE' });
                if (ok) { msgEl.innerHTML = '<div class="message success">Reactions cleared.</div>'; setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 3000); loadReactions(); }
                else { msgEl.innerHTML = `<div class="message error">${data?.error || 'Failed to clear'}</div>`; }
            } catch (e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        async function clearReaction(reactionId, pageUrl, reactionType) {
            if (!confirm(`Delete this ${reactionType} reaction?`)) return;
            const msgEl = document.getElementById('latest-message');
            try {
                await AdminAuth.ensureCsrfToken();
                const { ok, data } = await apiFetch(`${API_URL}/admin/reactions/${encodeURIComponent(reactionId)}?csrf_token=${encodeURIComponent(AdminAuth.getCsrfToken())}`, { method: 'DELETE' });
                if (ok) { msgEl.innerHTML = '<div class="message success">Reaction deleted.</div>'; setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 3000); loadLatestReactions(); loadReactions(); }
                else { msgEl.innerHTML = `<div class="message error">${data?.error || 'Failed to delete'}</div>`; }
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
                const { ok, data } = await apiFetch(`${API_URL}/admin/reactions?limit=${LATEST_PAGE_SIZE}&offset=${latestOffset}&_=${Date.now()}`, { noStore: true });
                if (ok) {
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


