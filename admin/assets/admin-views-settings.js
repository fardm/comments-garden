/**
 * admin-views-settings.js
 * All Settings views (General, Reactions, Database, Notifications, Import/Export)
 *
 * Registered on the global VIEWS object by admin-app.js.
 * Depends on globals: API_URL, apiFetch, escapeHtml, formatBytes (admin-common.js)
 */

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
        .themed-control { background-color:transparent; color:var(--body-text); border:1px solid var(--gray,#ddd); border-radius:4px; padding:.5rem .75rem; font-size:.95rem; width:100%; max-width:300px; }
        select.themed-control option { background-color:var(--on-background,#fff); color:var(--body-text,#333); }
        .toggle-switch { position:relative; display:inline-block; width:46px; height:26px; flex-shrink:0; }
        .toggle-switch input { opacity:0; width:0; height:0; }
        .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; border-radius:26px; transition:.3s; }
        .toggle-slider:before { position:absolute; content:""; height:20px; width:20px; left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s; }
        input:checked+.toggle-slider { background-color:#1ea274; }
        input:checked+.toggle-slider:before { transform:translateX(20px); }
        .settings-toast{position:fixed;bottom:1.5rem;z-index:9999;padding:.6rem 1.2rem;border-radius:6px;font-size:.88rem;font-weight:500;pointer-events:none;opacity:0;transform:translateY(8px);transition:opacity .3s ease,transform .3s ease;box-shadow:0 2px 8px rgba(0,0,0,.12);}
        .settings-toast.show{opacity:1;transform:translateY(0);}
        .settings-toast.success{background:var(--success);color:#fff;}
        .settings-toast.error{background:var(--red,#dc3545);color:#fff;}
        html[dir="rtl"] .settings-toast{right:auto;left:1.5rem;}html:not([dir="rtl"]) .settings-toast{right:1.5rem;left:auto;}
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">General Settings</h2>

            <div class="util-card" style="margin-bottom:1.5rem;">
                <div class="util-card-header"><span class="icon">💬</span><h2>Comments &amp; Moderation</h2></div>
                <div class="util-card-body">
                    <div class="setting-row">
                        <div class="setting-label"><strong>Require Moderation</strong><span>New comments must be approved before appearing</span></div>
                        <label class="toggle-switch"><input type="checkbox" id="setting-require-moderation"><span class="toggle-slider"></span></label>
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Comment Sort Order</strong><span>Default order for top-level comments on the site</span></div>
                        <select id="setting-comment-sort-order" class="themed-control">
                            <option value="asc">Oldest first (ASC)</option>
                            <option value="desc">Newest first (DESC)</option>
                        </select>
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Frontend Language</strong><span>Language for the comment widget interface on the website</span></div>
                        <select id="setting-language" class="themed-control">
                            <option value="en">English</option>
                            <option value="fa">فارسی (Persian)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="util-card" style="margin-bottom:1.5rem;">
                <div class="util-card-header"><span class="icon">🌐</span><h2>System &amp; Localization</h2></div>
                <div class="util-card-body">
                    <div class="setting-row">
                        <div class="setting-label"><strong>Timezone</strong><span>Timezone used for comment timestamps and date/time display</span></div>
                        <select id="setting-timezone" class="themed-control">
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
                        <div class="setting-label"><strong>Calendar System</strong><span>Calendar for the admin panel date display</span></div>
                        <select id="setting-calendar" class="themed-control">
                            <option value="gregorian">Gregorian</option>
                            <option value="persian">Solar Hijri (Jalali / شمسی)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="util-card" style="margin-bottom:1.5rem;">
                <div class="util-card-header"><span class="icon">👤</span><h2>Admin Profile</h2></div>
                <div class="util-card-body">
                    <div class="setting-row">
                        <div class="setting-label"><strong>Admin Name</strong><span>Used to pre-fill the reply form</span></div>
                        <input type="text" id="setting-admin-name" class="themed-control" placeholder="Your Name">
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Admin Email</strong><span>Used to pre-fill the reply form</span></div>
                        <input type="email" id="setting-admin-email" class="themed-control" placeholder="your@email.com">
                    </div>
                    <div class="setting-row">
                        <div class="setting-label"><strong>Admin Website</strong><span>Used to pre-fill the reply form (optional)</span></div>
                        <input type="url" id="setting-admin-url" class="themed-control" placeholder="https://yourwebsite.com">
                    </div>
                </div>
            </div>
        </div>
    `,
    init({ hoistToWindow }) {
        // All setting element IDs that trigger auto-save on change
        const autoSaveIds = [
            'setting-require-moderation', 'setting-comment-sort-order', 'setting-language',
            'setting-timezone', 'setting-calendar',
            'setting-admin-name', 'setting-admin-email', 'setting-admin-url'
        ];

        // ── Toast notification (single reused element) ────────────────────────
        let _toastEl = null;
        let _toastTimer = null;

        function showToast(message, type) {
            if (!_toastEl) {
                _toastEl = document.createElement('div');
                _toastEl.className = 'settings-toast';
                document.body.appendChild(_toastEl);
            }
            if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
            _toastEl.textContent = message;
            _toastEl.className = 'settings-toast ' + (type || 'success');
            // Force reflow so the transition restarts if the same class is applied
            void _toastEl.offsetHeight;
            _toastEl.classList.add('show');
            _toastTimer = setTimeout(() => {
                _toastEl.classList.remove('show');
                _toastTimer = null;
            }, type === 'error' ? 4000 : 2500);
        }

        async function loadSettings() {
            try {
                // Load settings (moderation, sort, admin profile)
                const { ok: sOk, data: sd } = await apiFetch(`${API_URL}/admin/settings`);
                if (sOk && sd?.settings) {
                    const s = sd.settings;
                    document.getElementById('setting-require-moderation').checked = (s.require_moderation === 'true');
                    document.getElementById('setting-comment-sort-order').value = s.comment_sort_order === 'desc' ? 'desc' : 'asc';
                    document.getElementById('setting-admin-name').value = s.admin_name || '';
                    document.getElementById('setting-admin-email').value = s.admin_email || '';
                    document.getElementById('setting-admin-url').value = s.admin_url || '';
                }
                // Load system config (timezone, calendar, origins, language)
                const { ok: cOk, data: cd } = await apiFetch(`${API_URL}/admin/config`);
                if (cOk) {
                    document.getElementById('setting-timezone').value = cd.timezone || 'UTC';
                    document.getElementById('setting-calendar').value = cd.app_calendar || 'gregorian';
                    document.getElementById('setting-language').value = cd.app_language || 'en';

                }
            } catch (e) {
                console.error('Settings load failed', e);
            }
        }

        autoSaveIds.forEach(id => {
            document.getElementById(id)?.addEventListener('change', saveSettings);
        });

        async function saveSettings() {
            try {
                // Read all values
                const requireModeration = document.getElementById('setting-require-moderation').checked ? 'true' : 'false';
                const commentSortOrder = document.getElementById('setting-comment-sort-order').value;
                const adminName = document.getElementById('setting-admin-name').value.trim();
                const adminEmail = document.getElementById('setting-admin-email').value.trim();
                const adminUrl = document.getElementById('setting-admin-url').value.trim();
                const timezone = document.getElementById('setting-timezone').value;
                const calendar = document.getElementById('setting-calendar').value;
                const language = document.getElementById('setting-language').value;


                // Save settings (requires get_settings to preserve existing keys)
                const { data: currentData } = await apiFetch(`${API_URL}/admin/settings`);
                const currentSettings = currentData?.settings || {};

                const settingsReq = apiFetch(`${API_URL}/admin/settings`, {
                    method: 'POST',
                    body: {
                        require_moderation: requireModeration,
                        comment_sort_order: commentSortOrder,
                        admin_name: adminName,
                        admin_email: adminEmail,
                        admin_url: adminUrl,
                        // Preserve existing settings not shown on this page
                        max_comment_length: currentSettings.max_comment_length || '5000',
                        allow_guest_comments: currentSettings.allow_guest_comments || 'true'
                    },
                });

                const configReq = apiFetch(`${API_URL}/admin/config`, {
                    method: 'POST',
                    body: { timezone, app_language: language, app_calendar: calendar },
                });

                const [settingsRes, configRes] = await Promise.all([settingsReq, configReq]);

                if (settingsRes.ok && configRes.ok) {
                    showToast('\u2713 Settings saved', 'success');
                } else {
                    showToast('\u26a0 Failed to save settings', 'error');
                }
            } catch (e) {
                showToast('\u26a0 Failed to save settings', 'error');
            }
        }

        hoistToWindow({ saveSettings });
        loadSettings();

        // Cleanup: remove toast element on view unmount
        return () => {
            if (_toastTimer) clearTimeout(_toastTimer);
            if (_toastEl) { _toastEl.remove(); _toastEl = null; }
        };
    }
};

VIEWS['settings-reactions'] = {
    title: 'Reactions',
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
        .toggle-switch { position:relative; display:inline-block; width:46px; height:26px; flex-shrink:0; }
        .toggle-switch input { opacity:0; width:0; height:0; }
        .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; border-radius:26px; transition:.3s; }
        .toggle-slider:before { position:absolute; content:""; height:20px; width:20px; left:3px; bottom:3px; background-color:white; border-radius:50%; transition:.3s; }
        input:checked+.toggle-slider { background-color:#1ea274; }
        input:checked+.toggle-slider:before { transform:translateX(20px); }
        .reaction-preview { font-size:1.3rem; margin-right:.5rem; }
        .toggle-switch.is-loading .toggle-slider { opacity:.5; pointer-events:none; }
        .reaction-error { font-size:.82rem; color:#dc3545; margin-top:.3rem; display:none; }
    `,
    html: () => `
        <div class="container">
            <h2 style="margin-bottom: 1.5rem;">Reactions</h2>
            <div class="util-card">
                <div class="util-card-header"><span class="icon">😀</span><h2>Configure Reactions</h2></div>
                <div class="util-card-body">
                    <p style="color:var(--body-text);opacity:.7;font-size:.9rem;margin-bottom:.75rem;">Enable or disable reactions that visitors can use. Changes take effect immediately.</p>
                    <div id="reactions-settings-list"><p style="color:var(--body-text);opacity:.6;">Loading…</p></div>
                </div>
            </div>
        </div>
    `,
    init({ hoistToWindow }) {
        const ALL_REACTIONS = [
            { type: 'thumbsup',  emoji: '👍', label: 'Thumbs Up' },
            { type: 'dislike', emoji: '👎', label: 'Thumbs Down' },
            { type: 'pray',      emoji: '🙏', label: 'Pray' },
            { type: 'ok',        emoji: '👌', label: 'OK' },
            { type: 'fire',      emoji: '🔥', label: 'Fire' },
            { type: 'heart',     emoji: '❤️', label: 'Heart' },
            { type: 'frown',     emoji: '☹️', label: 'Frown' },
            { type: 'rage',      emoji: '😡', label: 'Rage' },
            { type: 'funny',     emoji: '😄', label: 'Funny' },
            { type: 'neutral',   emoji: '😐', label: 'Neutral' },
        ];

        async function loadReactionsSettings() {
            const listEl = document.getElementById('reactions-settings-list');
            if (!listEl) return;
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/settings`);
                let enabled = ALL_REACTIONS.map(r => r.type);
                if (ok && data?.settings?.enabled_reactions) {
                    try {
                        const parsed = JSON.parse(data.settings.enabled_reactions);
                        if (Array.isArray(parsed) && parsed.length > 0) enabled = parsed;
                    } catch {}
                }
                renderList(enabled);
            } catch (e) {
                listEl.innerHTML = '<p style="color:#dc3545;">Failed to load reactions settings.</p>';
            }
        }

        function renderList(enabled) {
            const listEl = document.getElementById('reactions-settings-list');
            if (!listEl) return;
            listEl.innerHTML = ALL_REACTIONS.map(r => {
                const isOn = enabled.includes(r.type);
                return `
                    <div class="setting-row">
                        <div class="setting-label">
                            <span class="reaction-preview">${r.emoji}</span>
                            <strong style="display:inline;">${r.label}</strong>
                            <span style="margin-left:.5rem;font-size:.8rem;color:var(--body-text);opacity:.5;">${r.type}</span>
                        </div>
                        <label class="toggle-switch" id="toggle-wrap-${r.type}">
                            <input type="checkbox" id="toggle-${r.type}" ${isOn ? 'checked' : ''} onchange="toggleReaction('${r.type}')">
                            <span class="toggle-slider"></span>
                        </label>
                        <div class="reaction-error" id="error-${r.type}"></div>
                    </div>`;
            }).join('');
        }

        async function toggleReaction(type) {
            const cb = document.getElementById(`toggle-${type}`);
            const wrap = document.getElementById(`toggle-wrap-${type}`);
            const errEl = document.getElementById(`error-${type}`);
            if (!cb) return;

            const previousState = cb.checked;
            wrap?.classList.add('is-loading');
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

            // Build current enabled list from all checkboxes
            const currentEnabled = ALL_REACTIONS
                .filter(r => document.getElementById(`toggle-${r.type}`)?.checked)
                .map(r => r.type);

            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/settings`, {
                    method: 'POST',
                    body: { enabled_reactions: JSON.stringify(currentEnabled) },
                });
                if (!ok) throw new Error(data?.error || 'Save failed');
            } catch (e) {
                // Revert toggle
                cb.checked = !previousState;
                if (errEl) {
                    errEl.textContent = e.message || 'Failed to save';
                    errEl.style.display = 'block';
                }
                setTimeout(() => { if (errEl) errEl.style.display = 'none'; }, 4000);
            } finally {
                wrap?.classList.remove('is-loading');
            }
        }

        hoistToWindow({ toggleReaction });
        loadReactionsSettings();
    }
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
        .db-stat-item .num { font-size:1.4rem; font-weight:700; color:var(--primary); }
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
                const { ok, data: d } = await apiFetch(`${API_URL}/admin/db/stats`);
                if (!ok) { area.innerHTML = `<div class="message error">${d?.error}</div>`; return; }
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
            msgEl.innerHTML = '<div class="message info">Running VACUUM…</div>';
            try {
                const { ok, data: d } = await apiFetch(`${API_URL}/admin/db/vacuum`, { method: 'POST', body: {} });
                if (ok) { const saved=d?.saved_bytes>0?` Freed ${formatBytes(d.saved_bytes)}.`:' No space reclaimed (already optimal).'; msgEl.innerHTML=`<div class="message success">Database optimized.${saved} New size: ${formatBytes(d?.size_after)}.</div>`; loadDbStats(); }
                else { msgEl.innerHTML = `<div class="message error">${d?.error}</div>`; }
            } catch(e) { msgEl.innerHTML = '<div class="message error">Network error</div>'; }
        }

        async function deleteSpam() {
            const msgEl = document.getElementById('db-message');
            if(!confirm('Delete ALL comments marked as spam? This cannot be undone.')) return;
            msgEl.innerHTML = '<div class="message info">Purging spam…</div>';
            try {
                const { ok, data: d } = await apiFetch(`${API_URL}/admin/db/delete-spam`, { method: 'POST', body: {} });
                if (ok) { msgEl.innerHTML = `<div class="message success">Deleted ${d?.deleted_count} spam comment(s).</div>`; loadDbStats(); }
                else { msgEl.innerHTML = `<div class="message error">${d?.error}</div>`; }
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

            apiFetch(`${API_URL}/admin/db/stats`)
                .then(({ data }) => {
                    if (data?.tables) {
                        const c = document.getElementById('dd-count-comments'); if (c) c.textContent = `(${data.tables.comments ?? 0})`;
                        const pr = document.getElementById('dd-count-post-reactions'); if (pr) pr.textContent = `(${data.tables.post_reactions ?? 0})`;
                        const cr = document.getElementById('dd-count-comment-reactions'); if (cr) cr.textContent = `(${data.tables.comment_reactions ?? 0})`;
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
                delete_comments: document.getElementById('dd-comments').checked,
                delete_post_reactions: document.getElementById('dd-post-reactions').checked,
                delete_comment_reactions: document.getElementById('dd-comment-reactions').checked,
            };

            btn.disabled = true;
            msgEl.innerHTML = '<div class="message info">Deleting data...</div>';

            try {
                const { ok, data: d } = await apiFetch(`${API_URL}/admin/db/delete-data`, { method: 'POST', body: req });

                if (ok) {
                    const parts = [];
                    if (d?.deleted?.comments !== undefined) parts.push(`${d.deleted.comments} comment(s)`);
                    if (d?.deleted?.post_reactions !== undefined) parts.push(`${d.deleted.post_reactions} post reaction(s)`);
                    if (d?.deleted?.comment_reactions !== undefined) parts.push(`${d.deleted.comment_reactions} comment reaction(s)`);

                    const resStr = parts.length > 0 ? parts.join(', ') : 'no data';
                    msgEl.innerHTML = `<div class="message success">Successfully deleted ${resStr}. Vacuuming database...</div>`;

                    await apiFetch(`${API_URL}/admin/db/vacuum`, { method: 'POST', body: {} });

                    setTimeout(() => {
                        closeDeleteDataModal();
                        loadDbStats();
                        const pm = document.getElementById('db-message');
                        if (pm) { pm.innerHTML = `<div class="message success">Data deletion complete (${resStr}).</div>`; setTimeout(()=>pm.innerHTML='', 5000); }
                    }, 1500);
                } else {
                    msgEl.innerHTML = `<div class="message error">${d?.error || 'Deletion failed'}</div>`;
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
        .file-drop .file-selected { font-size:.88rem; color:var(--success); font-weight:600; margin-top:.4rem; }
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
                        <a href="/api/admin/import-export/export" class="btn btn-success btn-sm">Download JSON</a>
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
                    <div id="import-preview" style="display:none; color: var(--body-text);"></div>
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
            if(flabel) { flabel.style.display = 'block'; flabel.style.color = 'var(--success)'; flabel.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`; }

            const r = new FileReader();
            r.onload = (e) => { importFileContent = e.target.result; if(bprev) bprev.disabled = false; if(bimp) bimp.disabled = false; };
            r.readAsText(file);
        }

        async function previewImport() {
            if (!importFileContent) return;
            const msgEl = document.getElementById('import-message');
            const prevEl = document.getElementById('import-preview');
            if (msgEl) msgEl.innerHTML = '<div class="message info">Analyzing file…</div>';
            if (prevEl) prevEl.style.display = 'none';
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/import-export/import?preview=1`, {
                    method: 'POST',
                    body: { content: importFileContent },
                });
                if (ok) {
                    if (msgEl) msgEl.innerHTML = '';
                    if (prevEl) {
                        prevEl.style.display = 'block';
                        const formatName = (data?.format === 'json') ? 'Full Backup' : (data?.format === 'legacy_json') ? 'Legacy Comments' : 'Comments Export';
                        prevEl.innerHTML = `
                            <strong>Preview (${formatName})</strong>
                            <table>
                                <tbody>
                                    <tr><td>Comments</td><td>${data?.comments ?? 0}</td></tr>
                                    <tr><td>Comment reactions</td><td>${data?.comment_reactions ?? 0}</td></tr>
                                    <tr><td>Post reactions</td><td>${data?.post_reactions ?? 0}</td></tr>
                                </tbody>
                            </table>
                            <div style="margin-top:.75rem;font-size:.85rem;color:#666;">Note: Duplicate records will be automatically skipped during import.</div>
                        `;
                    }
                    importPreviewDone = true;
                } else { if (msgEl) msgEl.innerHTML = `<div class="message error">${data?.error}</div>`; }
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
            if(bimp) bimp.disabled = true;
            if(msgEl) msgEl.innerHTML = '';
            if(statusEl) statusEl.textContent = 'Importing... this may take a moment for large files.';
            try {
                const { ok, data } = await apiFetch(`${API_URL}/admin/import-export/import`, {
                    method: 'POST',
                    body: { content: importFileContent },
                });
                if(statusEl) statusEl.textContent = '';
                if(ok) {
                    const parts = [];
                    if((data?.imported_comments ?? 0) > 0) parts.push(`${data.imported_comments} comment${data.imported_comments !== 1 ? 's' : ''}`);
                    if((data?.imported_comment_reactions ?? 0) > 0) parts.push(`${data.imported_comment_reactions} comment reaction${data.imported_comment_reactions !== 1 ? 's' : ''}`);
                    if((data?.imported_post_reactions ?? 0) > 0) parts.push(`${data.imported_post_reactions} post reaction${data.imported_post_reactions !== 1 ? 's' : ''}`);
                    const skipped = (data?.skipped_comments ?? 0) + (data?.skipped_comment_reactions ?? 0) + (data?.skipped_post_reactions ?? 0);
                    const dupNote = skipped > 0 ? ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)` : '';
                    if(msgEl) msgEl.innerHTML = `<div class="message success">Imported ${parts.length ? parts.join(', ') : 'no new items'}${dupNote}.</div>`;
                    const iprev = document.getElementById('import-preview'); if(iprev) iprev.style.display = 'none';
                    importFileContent = null; importPreviewDone = false;
                    const bprev = document.getElementById('btn-preview'); if(bprev) bprev.disabled = true;
                    const flabel = document.getElementById('file-selected-label'); if(flabel) flabel.style.display = 'none';
                } else {
                    if(msgEl) msgEl.innerHTML = `<div class="message error">${data?.error}</div>`;
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

