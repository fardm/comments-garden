/**
 * admin-views-comments.js
 * Comments view (Pending / Approved / Spam / Deleted / All)
 *
 * Registered on the global VIEWS object by admin-app.js.
 * Depends on globals: API_URL, apiFetch, escapeHtml, formatDate, renderPageUrl (admin-common.js / admin-app.js)
 */


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

        .admin-comment-card{background:var(--on-background);border:1px solid var(--lightgray);border-radius:8px;padding:1.25rem 1.5rem;transition:box-shadow .2s;}
        .admin-comment-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06);}
        .admin-comment-card.is-admin{border-left:3px solid var(--primary);}

        .acc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.65rem;}
        .acc-header-left{display:flex;align-items:center;gap:.75rem;min-width:0;flex:1;}
        .acc-gravatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;object-fit:cover;}
        .acc-user-info{min-width:0;}
        .acc-author{font-weight:600;font-size:.95rem;display:block;line-height:1.3;}
        .acc-email{font-size:.8rem;color:var(--body-text);opacity:.55;display:block;line-height:1.3;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;}
        .acc-header-right{display:flex;align-items:center;gap:.5rem;flex-shrink:0;}

        .acc-status-badge{display:inline-block;padding:.2rem .6rem;border-radius:4px;font-size:.75rem;font-weight:600;text-transform:capitalize;white-space:nowrap;}
        .acc-status-badge.badge-pending{background:#ffc107;color:#333;}
        .acc-status-badge.badge-approved{background:var(--success);color:#fff;}
        .acc-status-badge.badge-spam{background:#dc3545;color:#fff;}
        .acc-status-badge.badge-deleted{background:#6c757d;color:#fff;}

        .acc-menu-wrap{position:relative;}
        .acc-menu-btn{background:transparent;border:none;color:var(--body-text);cursor:pointer;padding:.35rem;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background .15s;opacity:.55;}
        .acc-menu-btn:hover{background:var(--lightgray);opacity:1;}
        .acc-menu-btn svg{width:18px;height:18px;}
        .acc-dropdown{position:absolute;right:0;top:calc(100% + 4px);background:var(--on-background);border:1px solid var(--lightgray);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:180px;z-index:100;padding:.35rem 0;opacity:0;transform:translateY(-4px) scale(.98);pointer-events:none;transition:opacity .12s,transform .12s;}
        .acc-menu-wrap.open .acc-dropdown{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}
        .acc-dropdown-item{display:flex;align-items:center;gap:.6rem;width:100%;padding:.5rem .85rem;border:none;background:transparent;color:var(--body-text);font-size:.88rem;cursor:pointer;text-align:left;transition:background .12s;font-family:inherit;}
        .acc-dropdown-item:hover{background:var(--lightgray);}
        .acc-dropdown-item svg{width:15px;height:15px;flex-shrink:0;opacity:.65;}
        .acc-dropdown-item.danger{color:var(--red);}
        .acc-dropdown-item.danger svg{opacity:.8;}
        .acc-dropdown-sep{height:1px;background:var(--lightgray);margin:.3rem 0;}

        .acc-meta-row{display:flex;flex-wrap:wrap;gap:.65rem 1.25rem;margin-bottom:.75rem;font-size:.8rem;color:var(--body-text);opacity:.8; border-bottom: 1px solid var(--lightgray); padding-bottom: 10px;}
        .acc-meta-item{display:flex;align-items:center;gap:.3rem;white-space:nowrap;}
        .acc-meta-item svg{width:13px;height:13px;flex-shrink:0;opacity:.7;}
        .acc-meta-item a{color:var(--primary) !important;opacity:1 !important;text-decoration:none !important;}
        .acc-meta-item a:hover{text-decoration:underline !important;}
        .acc-tree-indent{margin-left:1.5rem;border-left:2px solid var(--lightgray);padding-left:1rem;}

        .acc-content{margin-bottom:.75rem;line-height:1.65;color:var(--body-text);font-size:.93rem;unicode-bidi:plaintext;word-break:break-word;}

        .acc-reactions{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.75rem;}
        .acc-reaction-pill{display:inline-flex;align-items:center;gap:.25rem;padding:.25rem .6rem;border:1px solid var(--lightgray);border-radius:999px;font-size:.85rem;background:var(--on-background);color:var(--body-text);transition:border-color .15s,background .15s;}
        .acc-reaction-pill:hover{border-color:var(--gray);}
        .acc-reaction-pill .rp-emoji{font-style:normal;line-height:1;}
        .acc-reaction-pill .rp-count{font-size:.8rem;min-width:1ch;}

        .acc-actions-row{display:flex;align-items:center;gap:.5rem;padding-top:.5rem;}
        .acc-reply-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .75rem;border:1px solid var(--lightgray);border-radius:6px;background:transparent;color:var(--body-text);font-size:.85rem;cursor:pointer;transition:all .15s;font-family:inherit;opacity:.7;}
        .acc-reply-btn:hover{background:var(--lightgray);opacity:1;border-color:var(--gray);}
        .acc-reply-btn svg{width:14px;height:14px;}

        .acc-view-select{padding:.4rem .6rem;border:1px solid var(--gray,#ddd);border-radius:4px;font-size:.85rem;background:var(--on-background);color:var(--body-text);cursor:pointer;}

        @media(max-width:768px){
            .admin-comment-card{padding:1rem;}
            .acc-email{max-width:180px;}
            .acc-meta-row{gap:.4rem .75rem;}
            .acc-header{flex-wrap:wrap;}
            .acc-tree-indent{margin-left:1rem;padding-left:.75rem;}
        }
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
                    <select id="c-view" class="acc-view-select" onchange="switchView(this.value)">
                        <option value="tree">Tree</option>
                        <option value="timeline">Timeline</option>
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
            { type: 'thumbsup', emoji: '👍' }, { type: 'dislike', emoji: '👎' },
            { type: 'pray', emoji: '🙏' }, { type: 'ok', emoji: '👌' },
            { type: 'fire', emoji: '🔥' }, { type: 'heart', emoji: '❤️' },
            { type: 'frown', emoji: '☹️' }, { type: 'rage', emoji: '😡' },
            { type: 'funny', emoji: '😄' }, { type: 'neutral', emoji: '😐' },
        ];

        // View mode state
        let viewMode = 'tree';
        let lastLoadedComments = [];
        let adminAvatarUrl = '';

        // Reply state
        let replyingToId = null;
        let replyingToPageUrl = null;
        let adminProfileCache = null;

        // Gravatar URL via same-origin proxy (CSP-safe)
        async function getGravatarUrl(email, size) {
            if (!email) return null;
            size = size || 80;
            try {
                const normalized = email.trim().toLowerCase();
                const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
                const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                return `/api/gravatar/${hashHex}?s=${size}`;
            } catch (e) { return null; }
        }

        function switchView(mode) {
            viewMode = mode;
            displayComments(lastLoadedComments);
        }

        // Build a hierarchical tree from a flat list of comments
        function buildCommentTree(comments) {
            const map = {};
            const roots = [];
            comments.forEach(c => { map[c.id] = { ...c, _children: [] }; });
            comments.forEach(c => {
                if (c.parent_id && map[c.parent_id]) {
                    map[c.parent_id]._children.push(map[c.id]);
                } else {
                    roots.push(map[c.id]);
                }
            });
            return roots;
        }


        const _inflightReactions = new Set();

        async function adminToggleCommentReaction(commentId, reactionType) {
            // Prevent duplicate in-flight requests for the same comment
            const key = `${commentId}:${reactionType}`;
            if (_inflightReactions.has(key)) return;
            _inflightReactions.add(key);

            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/reactions/toggle`, {
                    method: 'POST',
                    body: { comment_id: commentId, reaction_type: reactionType },
                });
                if (!ok) {
                    console.error('Reaction toggle failed:', data?.error || 'Unknown error');
                    return;
                }

                // Close picker
                const wrap = document.getElementById(`acc-reaction-picker-wrap-${commentId}`);
                if (wrap) wrap.classList.remove('open');

                // Build updated pills HTML from server response
                const counts = data.counts || {};
                const adminReactions = data.admin_reactions || [];
                const gravatarHtml = `<img src="${adminAvatarUrl}" alt="Admin" style="border-radius: 50%; width: 16px; height: 16px; margin-right: 4px;">`;
                const adminPills = reactionDefs
                    .filter(x => adminReactions.includes(x.type))
                    .map(x => `<span class="acc-reaction-pill acc-admin-reaction-pill" style="cursor: pointer;" onclick="adminToggleCommentReaction(${commentId}, '${x.type}')" title="Click to remove">${gravatarHtml}<span class="rp-emoji">${x.emoji}</span></span>`)
                    .join('');
                const userPills = reactionDefs
                    .filter(x => (counts[x.type] || 0) > 0)
                    .map(x => `<span class="acc-reaction-pill"><span class="rp-emoji">${x.emoji}</span><span class="rp-count">${counts[x.type]}</span></span>`)
                    .join('');
                const pills = userPills + adminPills;

                // Find or create the reactions container
                const commentCard = document.getElementById(`comment-${commentId}`);
                if (!commentCard) return;
                let reactionsEl = commentCard.querySelector('.acc-reactions');
                if (pills) {
                    if (reactionsEl) {
                        reactionsEl.innerHTML = pills;
                    } else {
                        // No existing reactions div — create one after the content div
                        const contentEl = commentCard.querySelector('.acc-content');
                        if (contentEl) {
                            reactionsEl = document.createElement('div');
                            reactionsEl.className = 'acc-reactions';
                            reactionsEl.innerHTML = pills;
                            contentEl.insertAdjacentElement('afterend', reactionsEl);
                        }
                    }
                } else if (reactionsEl) {
                    reactionsEl.remove();
                }
            } catch (e) {
                console.error('Admin reaction failed:', e);
            } finally {
                _inflightReactions.delete(key);
            }
        }

        function toggleAdminReactionPicker(commentId) {
            const wrap = document.getElementById(`acc-reaction-picker-wrap-${commentId}`);
            if (!wrap) return;
            const isOpen = wrap.classList.contains('open');
            document.querySelectorAll('.acc-reaction-picker-wrap.open').forEach(el => el.classList.remove('open'));
            if (!isOpen) wrap.classList.add('open');
        }

        async function loadCounts() {
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments/counts?_=${Date.now()}`, { noStore: true });
                if (ok) {
                    counts = data;
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

        async function loadComments(preserveScroll) {
            const container = document.getElementById('comments-list');
            if (!container) return;
            const savedScroll = preserveScroll ? window.scrollY : null;
            container.innerHTML = '<p class="no-comments">Loading…</p>';

            const search = document.getElementById('c-search')?.value?.trim() || '';
            const dateFilter = document.getElementById('c-date')?.value || 'all';
            const sort = document.getElementById('c-sort')?.value || 'desc';

            const qs = new URLSearchParams({
                limit: perPage,
                offset: (currentPage - 1) * perPage,
                sort: sort,
            });
            if (activeTab !== 'all') qs.set('status', activeTab);
            if (search) qs.set('search', search);
            if (dateFilter !== 'all') qs.set('date', dateFilter);

            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments?${qs}`, { noStore: true });
                if (ok) {
                    totalCount = data.pagination.total;
                    lastLoadedComments = data.comments || [];
                    adminAvatarUrl = data.admin_avatar_url || '';
                    displayComments(lastLoadedComments);
                    renderPagination();
                } else {
                    container.innerHTML = `<div class="message error">Error: ${data.error || 'Failed to load'}</div>`;
                }
            } catch (e) {
                container.innerHTML = `<div class="message error">Network error: ${e.message}</div>`;
            }
            if (savedScroll !== null) {
                requestAnimationFrame(() => window.scrollTo(0, savedScroll));
            }
        }

        // Toggle three-dot dropdown
        function toggleCommentMenu(id) {
            const wrap = document.getElementById(`acc-menu-${id}`);
            if (!wrap) return;
            const isOpen = wrap.classList.contains('open');
            // Close all other open menus first
            document.querySelectorAll('.acc-menu-wrap.open').forEach(el => el.classList.remove('open'));
            if (!isOpen) wrap.classList.add('open');
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
                const reactions = comment.reactions_by_type || {};
                const isDeleted = comment.status === 'deleted';
                const isSpam = comment.status === 'spam';
                const isApproved = comment.status === 'approved';
                const name = comment.author_name || 'A';
                const escapedPageUrl = escapeHtml(comment.page_url || '').replace(/'/g, "\\'");

                const adminReactions = comment.admin_reactions || [];
                const gravatarHtml = `<img src="${adminAvatarUrl}" alt="Admin" style="border-radius: 50%; width: 16px; height: 16px; margin-right: 4px;">`;

                const adminReactionPills = reactionDefs
                    .filter(x => adminReactions.includes(x.type))
                    .map(x => `<span class="acc-reaction-pill acc-admin-reaction-pill" style="cursor: pointer;" onclick="adminToggleCommentReaction(${comment.id}, '${x.type}')" title="Click to remove">${gravatarHtml}<span class="rp-emoji">${x.emoji}</span></span>`)
                    .join('');

                const userReactionPills = reactionDefs
                    .filter(x => (reactions[x.type] || 0) > 0)
                    .map(x => `<span class="acc-reaction-pill"><span class="rp-emoji">${x.emoji}</span><span class="rp-count">${reactions[x.type]}</span></span>`)
                    .join('');

                const reactionPills = userReactionPills + adminReactionPills;
                const isPendingTab = activeTab === 'pending';

                // Build dropdown menu items (non-pending tabs only)
                const menuItems = [];
                if (!isPendingTab) {
                menuItems.push(`<button class="acc-dropdown-item" onclick="startCommentEdit(${comment.id})"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>`);
                if (!isDeleted && !isApproved) {
                    menuItems.push(`<button class="acc-dropdown-item" onclick="moderateComment(${comment.id}, 'approved')"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Approve</button>`);
                }
                if (!isDeleted && !isSpam) {
                    menuItems.push(`<button class="acc-dropdown-item" onclick="moderateComment(${comment.id}, 'spam')"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Mark as Spam</button>`);
                }
                if (isDeleted) {
                    menuItems.push(`<button class="acc-dropdown-item" onclick="restoreComment(${comment.id})"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>Restore</button>`);
                    menuItems.push(`<div class="acc-dropdown-sep"></div>`);
                    menuItems.push(`<button class="acc-dropdown-item danger" onclick="permanentDelete(${comment.id})"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete Permanently</button>`);
                }
                if (!isDeleted) {
                    menuItems.push(`<div class="acc-dropdown-sep"></div>`);
                    menuItems.push(`<button class="acc-dropdown-item danger" onclick="deleteComment(${comment.id})"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>`);
                }
                } // end if (!isPendingTab)

                const isAdminComment = comment.author_role === 'admin';

                return `
                <div class="admin-comment-card${isDeleted ? ' is-deleted' : ''}${isAdminComment ? ' is-admin' : ''}" id="comment-${comment.id}">
                    <div class="acc-header">
                        <div class="acc-header-left">
                            <img class="acc-gravatar av-gravatar" src="" data-email="${escapeHtml(comment.author_email || '')}" alt="${escapeHtml(name)}" width="38" height="38">
                            <div class="acc-user-info">
                                ${comment.author_url
                                    ? `<a class="acc-author" href="${escapeHtml(comment.author_url)}" target="_blank" rel="nofollow noopener">${escapeHtml(name)}</a>`
                                    : `<span class="acc-author">${escapeHtml(name)}</span>`}
                                <span class="acc-email">${escapeHtml(comment.author_email || '')}</span>
                            </div>
                        </div>
                        <div class="acc-header-right">
                            <span class="acc-status-badge badge-${comment.status}">${comment.status}</span>
                            ${!isPendingTab ? `<div class="acc-menu-wrap" id="acc-menu-${comment.id}">
                                <button class="acc-menu-btn" onclick="toggleCommentMenu(${comment.id})" aria-label="Actions">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                </button>
                                <div class="acc-dropdown">${menuItems.join('')}</div>
                            </div>` : ''}
                        </div>
                    </div>
                    <div class="acc-meta-row">
                        <span class="acc-meta-item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            ${renderPageUrl(comment.page_url)}
                        </span>
                        <span class="acc-meta-item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            ${(() => { var origins = (window.AdminConfig && window.AdminConfig.allowedOrigins) || ['*']; var specificOrigin = origins.find(function(o) { return o !== '*'; }); var dateText = formatDate(comment.created_at); if (specificOrigin && comment.page_url) { var baseUrl = specificOrigin.replace(/\/$/, '') + (comment.page_url.startsWith('/') ? comment.page_url : '/' + comment.page_url); var linkUrl = baseUrl + '#comment-' + comment.id; return '<a href="' + escapeHtml(linkUrl) + '" target="_blank" style="color:#4a90e2;text-decoration:none;">' + dateText + '</a>'; } return dateText; })()}
                        </span>
                        <span class="acc-meta-item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            ${escapeHtml(comment.ip_address || 'N/A')}
                        </span>

                    </div>
                    <div class="acc-content" dir="auto" id="comment-content-${comment.id}">${escapeHtml(comment.content)}</div>
                    ${reactionPills ? `<div class="acc-reactions">${reactionPills}</div>` : ''}
                    <div class="acc-actions-row">
                        ${isPendingTab ? `<button class="acc-pending-btn" onclick="startCommentEdit(${comment.id})"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button><button class="acc-pending-btn acc-pending-btn--approve" onclick="moderateComment(${comment.id}, 'approved')"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Approve</button><button class="acc-pending-btn" onclick="moderateComment(${comment.id}, 'spam')"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Spam</button><button class="acc-pending-btn acc-pending-btn--danger" onclick="deleteComment(${comment.id})"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>` : `<div class="acc-reaction-picker-wrap" id="acc-reaction-picker-wrap-${comment.id}" style="position: relative;">
                            <button type="button" class="btn-reaction-add" onclick="toggleAdminReactionPicker(${comment.id})" title="Add Reaction">
                                <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 0 16 16" width="14" class="octicon octicon-smiley social-button-emoji"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.25 2.25.592.416a97.71 97.71 0 0 0-.592-.416Z" fill="#9198A1"></path></svg>
                            </button>
                            <div class="cs-reaction-picker" style="position: absolute; bottom: 100%; left: 0; display: none; background: var(--on-background); border: 1px solid var(--gray); border-radius: 6px; padding: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 100; flex-wrap: wrap; width: max-content; max-width: 200px; gap: 0.25rem;">
                                ${reactionDefs.map(r => `<button type="button" class="reaction-picker-emoji" style="border: none; background: transparent; cursor: pointer; font-size: 1.2rem; padding: 0.25rem; border-radius: 4px;" onclick="adminToggleCommentReaction(${comment.id}, '${r.type}')" title="${r.emoji}">${r.emoji}</button>`).join('')}
                            </div>
                        </div>
                        <button class="acc-reply-btn" onclick="showReplyForm(${comment.id}, '${escapedPageUrl}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                            Reply
                        </button>`}
                    </div>
                    ${!isPendingTab ? `<div id="reply-form-${comment.id}" style="display:none;margin-top:1rem;padding:1rem;background:var(--on-background);border:1px solid var(--gray);border-radius:4px;">
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
                    </div>` : ''}
                </div>`;
            }).join('');

            // Tree view: wrap children in indent divs
            if (viewMode === 'tree') {
                const tree = buildCommentTree(comments);
                function flattenTree(nodes, depth) {
                    let html = '';
                    for (const node of nodes) {
                        const card = document.getElementById(`comment-${node.id}`);
                        if (!card) continue;
                        if (depth > 0) card.classList.add('acc-tree-indent');
                        html += card.outerHTML;
                        if (node._children && node._children.length) {
                            html += flattenTree(node._children, depth + 1);
                        }
                    }
                    return html;
                }
                container.innerHTML = flattenTree(tree, 0);
            }

            // Load Gravatar images
            document.querySelectorAll('.av-gravatar[data-email]').forEach(img => {
                const email = img.dataset.email;
                if (!email) return;
                getGravatarUrl(email, 80).then(url => { if (url) img.src = url; });
            });

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
            loadComments(false);
            document.querySelector('.comments-tabs')?.scrollIntoView({ behavior: 'smooth' });
        }

        async function moderateComment(id, status) {
            const commentEl = document.getElementById(`comment-${id}`);
            if (!commentEl) return;
            const originalHTML = commentEl.innerHTML;
            try {
                commentEl.style.opacity = '0.5';
                commentEl.innerHTML = '<p style="text-align:center;padding:2rem;">Processing…</p>';
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments/${id}/moderate`, {
                    method: 'PUT',
                    body: { status },
                });
                if (ok) {
                    commentEl.innerHTML = `<p style="text-align:center;padding:2rem;color:green;">✓ ${status === 'approved' ? 'Approved' : 'Marked as spam'}!</p>`;
                    setTimeout(() => { loadComments(true); loadCounts(); }, 500);
                } else {
                    commentEl.style.opacity = '1';
                    commentEl.innerHTML = originalHTML + `<p class="error" style="margin-top:1rem;">Failed: ${data?.error || 'Unknown error'}</p>`;
                }
            } catch (e) {
                commentEl.style.opacity = '1';
                commentEl.innerHTML = originalHTML + '<p class="error" style="margin-top:1rem;">Network error</p>';
            }
        }

        async function deleteComment(id) {
            if (!confirm('Move this comment to Trash?')) return;
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments/${id}`, { method: 'DELETE' });
                if (ok) { loadComments(true); loadCounts(); }
                else { alert(`Failed: ${data?.error || 'Unknown error'}`); }
            } catch (e) { alert('Network error while deleting comment'); }
        }

        async function restoreComment(id) {
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments/${id}/restore`, {
                    method: 'POST',
                    body: { id },
                });
                if (ok) { loadComments(true); loadCounts(); }
                else { alert(`Failed: ${data?.error || 'Unknown error'}`); }
            } catch (e) { alert('Network error while restoring comment'); }
        }

        async function permanentDelete(id) {
            if (!confirm('Permanently delete this comment? This cannot be undone.')) return;
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments/${id}/permanent`, { method: 'DELETE' });
                if (ok) { loadComments(true); loadCounts(); }
                else { alert(`Failed: ${data?.error || 'Unknown error'}`); }
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
                    const { ok, data } = await apiFetch(`${API_URL}/admin/settings`);
                    if (ok) {
                        adminProfileCache = data?.settings || {};
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
                statusEl.textContent = 'Submitting…';
                statusEl.style.color = 'var(--body-text,#888)';
                const { ok, data } = await apiFetch(`${API_URL}/admin/comments`, {
                    method: 'POST',
                    body: {
                        page_url: replyingToPageUrl, parent_id: commentId,
                        author_name: name, author_email: email, author_url: url || null,
                        content, author_role: 'admin',
                    },
                });
                if (ok) {
                    statusEl.textContent = '✓ Reply posted successfully!';
                    statusEl.style.color = 'green';
                    setTimeout(() => { hideReplyForm(commentId); loadComments(true); }, 1000);
                } else {
                    statusEl.textContent = 'Failed: ' + (data?.error || 'Unknown error');
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
            startCommentEdit, showReplyForm, hideReplyForm, submitReply,
            toggleCommentMenu, switchView,
            toggleAdminReactionPicker, adminToggleCommentReaction
        });

        // Close dropdown menus on outside click
        function handleOutsideClick(e) {
            if (!e.target.closest('.acc-menu-wrap')) {
                document.querySelectorAll('.acc-menu-wrap.open').forEach(el => el.classList.remove('open'));
            }
        }
        document.addEventListener('click', handleOutsideClick);

        loadCounts();
        loadComments();

        // Cleanup: remove outside-click handler on view unmount
        return () => document.removeEventListener('click', handleOutsideClick);
    },
};


