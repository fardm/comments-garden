/**
 * Standalone Comment System - Client Widget
 * Embeddable comment system for static sites
 */

const COMMENTS_DEFAULT_LANGUAGE = 'en';

function getCommentsAssetBaseUrl(apiUrl) {
    const url = new URL(apiUrl, window.location.href);
    const path = url.pathname.replace(/\/(api|api\.php)$/, '');
    return url.origin + path;
}

function loadCommentsScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadCommentsTranslations(apiUrl, language) {
    const lang = /^[a-z]{2}$/i.test(language) ? language.toLowerCase() : COMMENTS_DEFAULT_LANGUAGE;
    const baseUrl = getCommentsAssetBaseUrl(apiUrl);
    try {
        await loadCommentsScript(`${baseUrl}/lang/${lang}.js`);
    } catch (e) {
        if (lang !== COMMENTS_DEFAULT_LANGUAGE) {
            await loadCommentsScript(`${baseUrl}/lang/${COMMENTS_DEFAULT_LANGUAGE}.js`);
        }
    }
}

async function resolveCommentsLanguage(apiUrl, container) {
    if (container.dataset.language) {
        return container.dataset.language;
    }
    if (window.COMMENTS_CONFIG?.language) {
        return window.COMMENTS_CONFIG.language;
    }
    try {
        const response = await fetch(`${apiUrl}?action=widget_config`);
        if (response.ok) {
            const data = await response.json();
            if (data.language) {
                return data.language;
            }
        }
    } catch (e) {
        // Fall back to English when config cannot be loaded.
    }
    return COMMENTS_DEFAULT_LANGUAGE;
}

class CommentSystem {
    constructor(options) {
        this.apiUrl = options.apiUrl || '/api';
        this.pageUrl = options.pageUrl || window.location.pathname;
        this.containerId = options.containerId || 'comments-container';
        this.closed = options.closed || false;
        this.language = options.language || COMMENTS_DEFAULT_LANGUAGE;
        this.container = document.getElementById(this.containerId);
        this._outsideClickHandlerBound = false;
        this._setupOutsideClickHandler();

        if (!this.container) {
            console.error('Comment container not found');
            return;
        }

        this.init();
    }

    t(key, params = {}) {
        const parts = key.split('.');
        let value = window.COMMENTS_I18N;
        for (const part of parts) {
            value = value?.[part];
        }
        if (typeof value !== 'string') {
            return key;
        }
        return Object.entries(params).reduce(
            (text, [name, paramValue]) => text.replace(`{${name}}`, paramValue),
            value
        );
    }

    _setupOutsideClickHandler() {
        if (this._outsideClickHandlerBound) return;
        this._outsideClickHandlerBound = true;

        document.addEventListener('click', (e) => {
            if (!this.container) return;
            const openWrap = this.container.querySelector('.reaction-picker-wrap.open');
            if (!openWrap) return;
            if (e.target && openWrap.contains(e.target)) return;
            this.closeAllReactionPickers();
        });
    }

    closeAllReactionPickers() {
        if (!this.container) return;
        this.container.querySelectorAll('.reaction-picker-wrap.open').forEach(el => {
            el.classList.remove('open');
        });
    }

    getReactionDefinitions() {
        return [
            { type: 'thumbsup',  emoji: '👍', label: this.t('reactions.thumbsup') },
            { type: 'lightbulb', emoji: '👎', label: this.t('reactions.lightbulb') },
            { type: 'pray',      emoji: '🙏', label: this.t('reactions.pray') },
            { type: 'ok',        emoji: '👌', label: this.t('reactions.ok') },
            { type: 'fire',      emoji: '🔥', label: this.t('reactions.fire') },
            { type: 'heart',     emoji: '❤️', label: this.t('reactions.heart') },
            { type: 'frown',     emoji: '☹️', label: this.t('reactions.frown') },
            { type: 'rage',      emoji: '😡', label: this.t('reactions.rage') },
            { type: 'funny',     emoji: '😄', label: this.t('reactions.funny') },
            { type: 'neutral',   emoji: '😐', label: this.t('reactions.neutral') },
        ];
    }

    getCommentReactionCounts(comment) {
        // New backend returns `votes_by_reaction_type`, old one exposes only 4 fields.
        if (comment && comment.votes_by_reaction_type && typeof comment.votes_by_reaction_type === 'object') {
            return comment.votes_by_reaction_type;
        }
        return {
            heart: comment.votes_heart || 0,
            thumbsup: comment.votes_thumbsup || 0,
            lightbulb: comment.votes_lightbulb || 0,
            funny: comment.votes_funny || 0,
        };
    }

    getPostReactions() {
        try {
            return JSON.parse(localStorage.getItem('post_reactions') || '{}');
        } catch (e) {
            return {};
        }
    }

    setPostReactions(data) {
        try {
            localStorage.setItem('post_reactions', JSON.stringify(data));
        } catch (e) {}
    }

    hasPostReacted(reactionType) {
        const data = this.getPostReactions();
        return (data[this.pageUrl] || []).includes(reactionType);
    }

    async handlePostReaction(reactionType) {
        // Optimistic-close picker UX (real update is still async).
        this.closeAllReactionPickers();

        const toggleEls = document.querySelectorAll(`.reaction-picker-emoji[data-reaction-target="post"][data-reaction="${reactionType}"], .btn-reaction.btn-post-reaction[data-reaction="${reactionType}"]`);
        toggleEls.forEach(el => el.disabled = true);
        try {
            const response = await fetch(`${this.apiUrl}?action=post_reaction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page_url: this.pageUrl, reaction_type: reactionType })
            });
            const result = await response.json();
            if (response.ok) {
                const data = this.getPostReactions();
                const key = this.pageUrl;
                if (!data[key]) data[key] = [];
                if (result.voted) {
                    if (!data[key].includes(reactionType)) data[key].push(reactionType);
                } else {
                    data[key] = data[key].filter(r => r !== reactionType);
                    if (data[key].length === 0) delete data[key];
                }
                this.setPostReactions(data);

                // Re-map the returned counts to the object structure
                const updatedCounts = {};
                for (const [rtype, count] of Object.entries(result.counts || {})) {
                    updatedCounts[rtype] = {
                        count: count,
                        voted: (rtype === reactionType) ? result.voted : this.hasPostReacted(rtype)
                    };
                }

                this.updatePostReactionBadges(updatedCounts);
            }
        } catch (e) {
            // Silently fail
        } finally {
            setTimeout(() => {
                toggleEls.forEach(el => el.disabled = false);
            }, 500);
        }
    }

    renderPostReactionsSection(counts = {}) {
        const reactions = this.getReactionDefinitions();
        const usedReactions = reactions.filter(r => {
            const count = typeof counts[r.type] === 'object' ? counts[r.type].count : (counts[r.type] || 0);
            return count > 0;
        });
        const totalCount = Object.values(counts).reduce((sum, item) => {
            const c = typeof item === 'object' ? item.count : item;
            return sum + (parseInt(c) || 0);
        }, 0);
        const badgesHtml = usedReactions.map(r => {
            const count = typeof counts[r.type] === 'object' ? counts[r.type].count : (counts[r.type] || 0);
            const serverVoted = typeof counts[r.type] === 'object' && counts[r.type].voted;
            const voted = serverVoted || this.hasPostReacted(r.type);
            return `<button class="btn-reaction btn-post-reaction btn-reaction-${r.type}${voted ? ' voted' : ''}"
                                    data-reaction-target="post"
                                    data-reaction="${r.type}"
                                    onclick="commentsWidget.handlePostReaction('${r.type}')"
                                    title="${r.label}">
                                <span class="reaction-emoji">${r.emoji}</span><span class="reaction-count">${count > 0 ? count : ''}</span>
                            </button>`;
        }).join('');

        return `
            <h4 class="post-reactions-label">${this.t('postReactions', { count: totalCount })}</h4>
            <div class="post-reactions-section">
                <div class="reaction-picker-wrap" id="cs-post-reaction-picker-wrap">
                    <button type="button"
                            class="btn-reaction-add"
                            data-reaction-target="post"
                            onclick="commentsWidget.togglePostReactionPicker()"
                            aria-label="${this.escapeHtml(this.t('addReaction'))}"
                            title="${this.escapeHtml(this.t('addReaction'))}">
                        <svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" height="18" aria-hidden="true" data-component="Octicon" viewBox="0 0 16 16" version="1.1" width="18" data-view-component="true" class="octicon octicon-smiley social-button-emoji">    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.25 2.25.592.416a97.71 97.71 0 0 0-.592-.416Z" fill="#9198A1"></path></svg>
                    </button>
                    <div class="cs-reaction-picker" role="menu" aria-hidden="true">
                        ${this.getReactionDefinitions().map(r => {
                            return `<button type="button"
                                            class="reaction-picker-emoji"
                                            data-reaction-target="post"
                                            data-reaction="${r.type}"
                                            onclick="commentsWidget.handlePostReaction('${r.type}')"
                                            title="${r.label}">
                                        <span class="reaction-picker-emoji-visual">${r.emoji}</span>
                                    </button>`;
                        }).join('')}
                    </div>
                </div>
                <div class="post-reactions-badges${usedReactions.length === 0 ? ' no-badges' : ''}" id="post-reaction-badges">
                    ${badgesHtml}
                </div>
            </div>
        `;
    }

    getVotedComments() {
        try {
            const data = JSON.parse(localStorage.getItem('comment_votes') || '{}');
            // Fallback: if old format (array), convert to empty object
            if (Array.isArray(data)) return {};
            return data;
        } catch (e) {
            return {};
        }
    }

    setVotedComments(data) {
        try {
            localStorage.setItem('comment_votes', JSON.stringify(data));
        } catch (e) {}
    }

    hasVoted(commentId, reactionType) {
        const data = this.getVotedComments();
        return (data[commentId] || []).includes(reactionType);
    }

    async handleVote(commentId, reactionType) {
        this.closeAllReactionPickers();

        const toggleEls = document.querySelectorAll(`.btn-reaction[data-comment-id="${commentId}"][data-reaction="${reactionType}"], .reaction-picker-emoji[data-comment-id="${commentId}"][data-reaction="${reactionType}"]`);
        if ([...toggleEls].some(el => el.disabled)) return;
        toggleEls.forEach(el => el.disabled = true);
        try {
            const response = await fetch(`${this.apiUrl}?action=vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment_id: commentId, reaction_type: reactionType })
            });
            const result = await response.json();
            if (response.ok) {
                // Update localStorage
                const data = this.getVotedComments();
                const key = String(commentId);
                if (!data[key]) data[key] = [];
                if (result.voted) {
                    if (!data[key].includes(reactionType)) data[key].push(reactionType);
                } else {
                    data[key] = data[key].filter(r => r !== reactionType);
                    if (data[key].length === 0) delete data[key];
                }
                this.setVotedComments(data);

                // Update the memory object directly to allow real-time updates
                const commentEl = document.querySelector(`.comment[data-id="${commentId}"]`);
                if (commentEl) {
                    let commentData = null;
                    // Find comment in memory tree
                    const findComment = (list) => {
                        for (let c of list) {
                            if (c.id === commentId) return c;
                            if (c.replies && c.replies.length) {
                                let found = findComment(c.replies);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    // Instead of full tree search, we rely on the backend count provided in result.counts
                }

                // Update badges based on returned counts (insert/remove as needed).
                this.updateCommentReactionBadges(commentId, result.counts || {});
            }
        } catch (e) {
            // Silently fail — voting is non-critical
        } finally {
            setTimeout(() => {
                toggleEls.forEach(el => el.disabled = false);
            }, 500);
        }
    }

    updateCommentReactionBadges(commentId, counts) {
        const container = document.getElementById(`comment-reaction-badges-${commentId}`);
        if (!container) return;

        const used = this.getReactionDefinitions().filter(r => {
            const count = typeof counts[r.type] === 'object' ? counts[r.type].count : (counts[r.type] || 0);
            return count > 0;
        });
        if (used.length === 0) {
            container.innerHTML = '';
            const wrap = document.getElementById(`cs-reaction-picker-wrap-${commentId}`);
            if (wrap) wrap.classList.add('no-badges');
            return;
        }

        const wrap = document.getElementById(`cs-reaction-picker-wrap-${commentId}`);
        if (wrap) wrap.classList.remove('no-badges');
        container.innerHTML = used.map(r => {
            const count = typeof counts[r.type] === 'object' ? counts[r.type].count : (counts[r.type] || 0);
            const serverVoted = typeof counts[r.type] === 'object' && counts[r.type].voted;
            const voted = serverVoted || this.hasVoted(commentId, r.type);
            return `<button class="btn-reaction btn-reaction-${r.type}${voted ? ' voted' : ''}"
                            data-reaction-target="comment"
                            data-comment-id="${commentId}"
                            data-reaction="${r.type}"
                            onclick="commentsWidget.handleVote(${commentId}, '${r.type}')"
                            title="${r.label}">
                        <span class="reaction-emoji">${r.emoji}</span><span class="reaction-count">${count > 0 ? count : ''}</span>
                    </button>`;
        }).join('');
    }

    updatePostReactionBadges(counts) {
        const container = document.getElementById('post-reaction-badges');
        if (!container) return;

        const used = this.getReactionDefinitions().filter(r => {
            const count = typeof counts[r.type] === 'object' ? counts[r.type].count : (counts[r.type] || 0);
            return count > 0;
        });
        if (used.length === 0) {
            container.innerHTML = '';
            container.classList.add('no-badges');
            return;
        }

        container.classList.remove('no-badges');
        container.innerHTML = used.map(r => {
            const count = typeof counts[r.type] === 'object' ? counts[r.type].count : (counts[r.type] || 0);
            const serverVoted = typeof counts[r.type] === 'object' && counts[r.type].voted;
            const voted = serverVoted || this.hasPostReacted(r.type);
            return `<button class="btn-reaction btn-post-reaction btn-reaction-${r.type}${voted ? ' voted' : ''}"
                            data-reaction-target="post"
                            data-reaction="${r.type}"
                            onclick="commentsWidget.handlePostReaction('${r.type}')"
                            title="${r.label}">
                        <span class="reaction-emoji">${r.emoji}</span><span class="reaction-count">${count > 0 ? count : ''}</span>
                    </button>`;
        }).join('');
    }

    toggleReactionPicker(commentId) {
        const wrap = document.getElementById(`cs-reaction-picker-wrap-${commentId}`);
        if (!wrap) return;

        const isOpen = wrap.classList.contains('open');
        this.closeAllReactionPickers();
        if (!isOpen) wrap.classList.add('open');
    }

    togglePostReactionPicker() {
        const wrap = document.getElementById('cs-post-reaction-picker-wrap');
        if (!wrap) return;
        const isOpen = wrap.classList.contains('open');
        this.closeAllReactionPickers();
        if (!isOpen) wrap.classList.add('open');
    }

    async init() {
        this.render();
        await this.loadComments();
    }

    // رندر
    render() {
        const formHtml = this.closed
            ? `<p class="comments-closed">${this.escapeHtml(this.t('commentsClosed'))}</p>`
            : `<div id="comment-form-container">${this.renderCommentForm()}</div>`;

        this.container.innerHTML = `
            <div class="comments-system">
                <div class="post-comment">
                    <div id="post-reactions-container">
                        ${this.renderPostReactionsSection()}
                    </div>
                    <h3 class="comments-title"></h3>
                    <p class="befor-form-comment">${this.escapeHtml(this.t('beforeForm'))}</p>
                    ${formHtml}
                </div>
                <div id="comments-list" class="comments-list">
                    <p class="loading">${this.escapeHtml(this.t('loadingComments'))}</p>
                </div>
            </div>
        `;

        if (!this.closed) {
            this.attachFormHandler();
        }
    }

    renderCommentForm(parentId = null, parentAuthor = null) {
        const replyText = parentAuthor
            ? this.t('replyTo', { author: this.escapeHtml(parentAuthor) })
            : '';
        const formId = parentId ? `reply-form-${parentId}` : 'main-comment-form';

        // Get saved user info from localStorage
        const savedInfo = this.getSavedUserInfo();

        return `
            <form class="comment-form" id="${formId}" data-parent-id="${parentId || ''}">
                <h4>${replyText}</h4>
                <div class="form-group">
                    <input type="text" name="author_name" placeholder="${this.escapeHtml(this.t('form.name'))}" required class="form-input" value="${this.escapeHtml(savedInfo.name)}">
                </div>
                <div class="form-group">
                    <input type="email" name="author_email" placeholder="${this.escapeHtml(this.t('form.email'))}" required class="form-input" value="${this.escapeHtml(savedInfo.email)}">
                </div>
                <div class="form-group">
                    <input type="url" name="author_url" placeholder="${this.escapeHtml(this.t('form.website'))}" class="form-input" value="${this.escapeHtml(savedInfo.url)}">
                </div>
                <div class="form-group" aria-hidden="true" style="position: absolute; opacity: 0; top: 0; left: 0; height: 0; width: 0; z-index: -1; overflow: hidden; pointer-events: none;">
                    <input type="text" name="website" placeholder="${this.escapeHtml(this.t('form.website'))}" class="form-input" tabindex="-1" autocomplete="off">
                </div>
                <div class="form-group">
                    <div class="textarea-wrapper">
                        <textarea name="content" placeholder="${this.escapeHtml(this.t('form.content'))}" required class="form-textarea" rows="4"></textarea>
                        <div class="help-icon">${this.escapeHtml(this.t('form.helpIcon'))}</div>
                        <div class="tooltip">
                            <p><strong>${this.escapeHtml(this.t('form.helpTitle'))}</strong></p>
                            <p>${this.escapeHtml(this.t('form.helpBold'))}</p>
                            <p>${this.escapeHtml(this.t('form.helpItalic'))}</p>
                            <p>${this.escapeHtml(this.t('form.helpQuote'))}</p>
                            <p>${this.escapeHtml(this.t('form.helpLink'))}</p>
                            <p>${this.escapeHtml(this.t('form.helpImage'))}</p>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" name="remember_me" value="1" ${savedInfo.remember ? 'checked' : ''}>
                        <span>${this.escapeHtml(this.t('form.remember'))}</span>
                    </label>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-submit">${this.escapeHtml(this.t('form.submit'))}</button>
                    ${parentId ? `<button type="button" class="btn-cancel" onclick="this.closest('.comment-reply-form').remove()">${this.escapeHtml(this.t('form.cancel'))}</button>` : ''}
                </div>
                <div class="form-message"></div>
            </form>
        `;
    }

    attachFormHandler(form = null) {
        const forms = form ? [form] : document.querySelectorAll('.comment-form');
        forms.forEach(f => {
            f.addEventListener('submit', (e) => this.handleSubmit(e));
        });
    }

    async handleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const messageEl = form.querySelector('.form-message');
        const submitBtn = form.querySelector('.btn-submit');

        submitBtn.disabled = true;
        messageEl.textContent = this.t('form.submitting');
        messageEl.className = 'form-message info';

        const authorName = formData.get('author_name');
        const authorEmail = formData.get('author_email');
        const authorUrl = formData.get('author_url');
        const rememberMe = formData.get('remember_me') ? true : false;

        const data = {
            page_url: this.pageUrl,
            parent_id: form.dataset.parentId || null,
            author_name: authorName,
            author_email: authorEmail,
            author_url: authorUrl,
            content: formData.get('content'),
            author_role: 'user',
        };

        try {
            const response = await fetch(`${this.apiUrl}?action=post`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok) {
                // Save user info if remember me is checked
                this.saveUserInfo(authorName, authorEmail, authorUrl, rememberMe);

                const messageKey = result.message_key || result.status || 'approved';
                messageEl.textContent = this.t(`postMessages.${messageKey}`, {}) || result.message;
                messageEl.className = 'form-message success';
                form.reset();

                // Restore saved info after reset if remember me was checked
                if (rememberMe) {
                    form.querySelector('input[name="author_name"]').value = authorName;
                    form.querySelector('input[name="author_email"]').value = authorEmail;
                    form.querySelector('input[name="author_url"]').value = authorUrl;
                    form.querySelector('input[name="remember_me"]').checked = true;
                }

                // Reload comments
                setTimeout(() => {
                    this.loadComments();
                    messageEl.textContent = '';
                }, 2000);
            } else {
                messageEl.textContent = result.error || this.t('form.submitFailed');
                messageEl.className = 'form-message error';
            }
        } catch (error) {
            messageEl.textContent = this.t('form.networkError');
            messageEl.className = 'form-message error';
        } finally {
            submitBtn.disabled = false;
        }
    }

    async loadComments() {
        try {
            const response = await fetch(`${this.apiUrl}?action=comments&url=${encodeURIComponent(this.pageUrl)}`);
            const data = await response.json();

            if (response.ok) {
                this.displayComments(data.comments);
                const prContainer = document.getElementById('post-reactions-container');
                if (prContainer && data.post_reactions) {
                    prContainer.innerHTML = this.renderPostReactionsSection(data.post_reactions);
                }
            } else {
                document.getElementById('comments-list').innerHTML =
                    `<p class="error">${this.escapeHtml(this.t('failedLoadComments'))}</p>`;
            }
        } catch (error) {
            document.getElementById('comments-list').innerHTML =
                `<p class="error">${this.escapeHtml(this.t('failedLoadComments'))}</p>`;
        }
    }

    displayComments(comments) {
        const listEl = document.getElementById('comments-list');

        if (comments.length === 0) {
            listEl.innerHTML = this.closed
                ? `<p class="no-comments">${this.escapeHtml(this.t('noCommentsClosed'))}</p>`
                : `<p class="no-comments">${this.escapeHtml(this.t('noComments'))}</p>`;
            return;
        }

        listEl.innerHTML = comments.map(comment => this.renderComment(comment)).join('');
    }

    formatCommentDate(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            if (this.language === 'fa') {
                return new Intl.DateTimeFormat('fa-IR', {
                    calendar: 'persian',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Tehran'
                }).format(date);
            }
            return new Intl.DateTimeFormat(this.language, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        } catch (e) {
            return dateString;
        }
    }

    renderComment(comment, depth = 0) {
        const formattedDate = this.formatCommentDate(comment.created_at);

        const authorLink = comment.author_url
            ? `<a href="${this.escapeHtml(comment.author_url)}" target="_blank" rel="nofollow noopener">${this.escapeHtml(comment.author_name)}</a>`
            : this.escapeHtml(comment.author_name);

        const avatarHtml = comment.author_avatar
            ? `<img src="${this.escapeHtml(comment.author_avatar)}" alt="${this.escapeHtml(comment.author_name)}" class="comment-avatar" loading="lazy">`
            : '';

        const isPending = comment.status === 'pending';
        const pendingBadge = isPending
            ? `<span class="badge-pending">${this.escapeHtml(this.t('pendingBadge'))}</span>`
            : '';

        const reactionCounts = this.getCommentReactionCounts(comment);
        const reactions = this.getReactionDefinitions();
        const usedReactions = reactions.filter(r => {
            const count = typeof reactionCounts[r.type] === 'object' ? reactionCounts[r.type].count : (reactionCounts[r.type] || 0);
            return count > 0;
        });
        const hasAnyReactions = usedReactions.length > 0;
        const reactionsHtml = usedReactions.map(r => {
            const count = typeof reactionCounts[r.type] === 'object' ? reactionCounts[r.type].count : (reactionCounts[r.type] || 0);
            const serverVoted = typeof reactionCounts[r.type] === 'object' && reactionCounts[r.type].voted;
            const voted = serverVoted || this.hasVoted(comment.id, r.type);
            return `<button class="btn-reaction btn-reaction-${r.type}${voted ? ' voted' : ''}"
                            data-reaction-target="comment"
                            data-comment-id="${comment.id}" data-reaction="${r.type}"
                            onclick="commentsWidget.handleVote(${comment.id}, '${r.type}')"
                            title="${r.label}">
                        <span class="reaction-emoji">${r.emoji}</span><span class="reaction-count">${count > 0 ? count : ''}</span>
                    </button>`;
        }).join('');

        const upvoteBtn = isPending ? '' : `
            <div class="reaction-picker-wrap${hasAnyReactions ? '' : ' no-badges'}" id="cs-reaction-picker-wrap-${comment.id}">
                <button type="button"
                        class="btn-reaction-add"
                        data-reaction-target="comment"
                        onclick="commentsWidget.toggleReactionPicker(${comment.id})"
                        aria-label="${this.escapeHtml(this.t('addReaction'))}"
                        title="${this.escapeHtml(this.t('addReaction'))}">
                    <svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" height="18" aria-hidden="true" data-component="Octicon" viewBox="0 0 16 16" version="1.1" width="18" data-view-component="true" class="octicon octicon-smiley social-button-emoji">    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.25 2.25.592.416a97.71 97.71 0 0 0-.592-.416Z" fill="#9198A1"></path></svg>
                </button>
                <div class="cs-reaction-picker" role="menu" aria-hidden="true">
                    ${reactions.map(r => {
                        return `<button type="button"
                                        class="reaction-picker-emoji"
                                        data-reaction-target="comment"
                                        data-comment-id="${comment.id}"
                                        data-reaction="${r.type}"
                                        onclick="commentsWidget.handleVote(${comment.id}, '${r.type}')"
                                        title="${r.label}">
                                    <span class="reaction-picker-emoji-visual">${r.emoji}</span>
                                </button>`;
                    }).join('')}
                </div>
                <div class="comment-reaction-badges" id="comment-reaction-badges-${comment.id}">
                    ${reactionsHtml}
                </div>
            </div>
        `;

        const isAdmin = comment.author_role === 'admin';
        let html = `
            <div class="comment ${isPending ? 'comment-pending' : ''} ${isAdmin ? 'admin-comment' : ''}" id="comment-${comment.id}" style="margin-inline-start: ${depth * 30}px">
                <div class="comment-meta">
                    ${avatarHtml}
                    <div class="comment-author-info">
                        <span class="comment-author">${authorLink}</span>
                        <a href="#comment-${comment.id}" class="comment-date">${formattedDate}</a>
                        ${pendingBadge}
                    </div>
                </div>
                <div class="comment-content">
                    ${this.renderMarkdown(comment.content)}
                </div>
                <div class="comment-actions">
                    ${upvoteBtn}
                    ${this.closed ? '' : `<button class="btn-reply" onclick="commentsWidget.showReplyForm(${comment.id}, '${this.escapeHtml(comment.author_name).replace(/'/g, "\\'")}')">${this.escapeHtml(this.t('reply'))}</button>`}
                </div>
                <div id="reply-form-container-${comment.id}"></div>
            </div>
        `;

        if (comment.replies && comment.replies.length > 0) {
            html += comment.replies.map(reply => this.renderComment(reply, depth + 1)).join('');
        }

        return html;
    }

    showReplyForm(parentId, parentAuthor) {
        // Remove any existing reply forms
        document.querySelectorAll('.comment-reply-form').forEach(el => el.remove());

        const container = document.getElementById(`reply-form-container-${parentId}`);
        const formContainer = document.createElement('div');
        formContainer.className = 'comment-reply-form';
        formContainer.innerHTML = this.renderCommentForm(parentId, parentAuthor);
        container.appendChild(formContainer);

        this.attachFormHandler(formContainer.querySelector('form'));
        formContainer.querySelector('textarea').focus();
    }

    renderMarkdown(text) {
        const esc = (s) => String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const safeUrl = (url) => /^https?:\/\//i.test(url.trim()) ? url.trim() : '#';

        // Token-based inline processor. Only 'text' tokens are eligible for further
        // pattern matching; 'html' tokens pass through as-is. This prevents double-
        // processing and keeps user content safely escaped.
        function applyPattern(tokens, regex, replacer) {
            return tokens.flatMap(token => {
                if (token.type !== 'text') return [token];
                const parts = [];
                let last = 0;
                regex.lastIndex = 0;
                let m;
                while ((m = regex.exec(token.value)) !== null) {
                    if (m.index > last) parts.push({ type: 'text', value: token.value.slice(last, m.index) });
                    parts.push({ type: 'html', value: replacer(m) });
                    last = m.index + m[0].length;
                }
                if (last < token.value.length) parts.push({ type: 'text', value: token.value.slice(last) });
                return parts.length ? parts : [token];
            });
        }

        function renderInline(str) {
            let tokens = [{ type: 'text', value: str }];
            // inline code first — protects contents from other patterns
            tokens = applyPattern(tokens, /`([^`]+)`/g,
                m => `<code>${esc(m[1])}</code>`);
            // images before links (![...] would also match [...])
            tokens = applyPattern(tokens, /!\[([^\]]*)\]\(([^)]+)\)/g,
                m => `<img src="${esc(safeUrl(m[2]))}" alt="${esc(m[1])}" loading="lazy">`);
            // markdown links (before bare-URL pass, so link URLs aren't double-linked)
            tokens = applyPattern(tokens, /\[([^\]]+)\]\(([^)]+)\)/g,
                m => `<a href="${esc(safeUrl(m[2]))}" rel="nofollow noopener" target="_blank">${esc(m[1])}</a>`);
            // bare URLs — negative lookbehind strips trailing punctuation
            tokens = applyPattern(tokens, /https?:\/\/[^\s<>"')\]]+(?<![.,;:!?])/g,
                m => `<a href="${esc(m[0])}" rel="nofollow noopener" target="_blank">${esc(m[0])}</a>`);
            // bold
            tokens = applyPattern(tokens, /\*\*([^*\n]+)\*\*/g,
                m => `<strong>${esc(m[1])}</strong>`);
            // italic (* and _)
            tokens = applyPattern(tokens, /\*([^*\n]+)\*/g,
                m => `<em>${esc(m[1])}</em>`);
            tokens = applyPattern(tokens, /_([^_\n]+)_/g,
                m => `<em>${esc(m[1])}</em>`);
            return tokens.map(t => t.type === 'html' ? t.value : esc(t.value)).join('');
        }

        return text.split('\n').map(line => {
            if (/^>\s?/.test(line)) {
                return `<blockquote>${renderInline(line.replace(/^>\s?/, ''))}</blockquote>`;
            }
            return renderInline(line);
        }).join('<br>');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getSavedUserInfo() {
        try {
            const saved = localStorage.getItem('comment_user_info');
            if (saved) {
                const info = JSON.parse(saved);
                return {
                    name: info.name || '',
                    email: info.email || '',
                    url: info.url || '',
                    remember: true
                };
            }
        } catch (e) {
            console.error('Error loading saved user info:', e);
        }
        return { name: '', email: '', url: '', remember: false };
    }

    saveUserInfo(name, email, url, remember) {
        try {
            if (remember) {
                localStorage.setItem('comment_user_info', JSON.stringify({
                    name: name,
                    email: email,
                    url: url
                }));
            } else {
                localStorage.removeItem('comment_user_info');
            }
        } catch (e) {
            console.error('Error saving user info:', e);
        }
    }
}

// Initialize when DOM is ready
let commentsWidget;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initComments);
} else {
    initComments();
}

async function initComments() {
    const container = document.getElementById('comments-container');
    if (!container) {
        return;
    }

    const apiUrl = container.dataset.apiUrl || window.COMMENTS_CONFIG?.apiUrl || '/api';
    const language = await resolveCommentsLanguage(apiUrl, container);
    await loadCommentsTranslations(apiUrl, language);

    const config = {
        apiUrl,
        pageUrl: container.dataset.pageUrl || window.COMMENTS_CONFIG?.pageUrl || window.location.pathname,
        containerId: 'comments-container',
        closed: container.dataset.closed === 'true' || window.COMMENTS_CONFIG?.closed || false,
        language,
    };
    commentsWidget = new CommentSystem(config);
}
