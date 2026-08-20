/**
 * Admin inline comment content editor (requires API_URL and AdminAuth from admin-common.js).
 */

function startCommentEdit(commentId) {
    const viewEl = document.getElementById(`comment-content-${commentId}`);
    if (!viewEl || document.getElementById(`comment-edit-wrap-${commentId}`)) {
        return;
    }

    const content = viewEl.textContent;
    viewEl.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.id = `comment-edit-wrap-${commentId}`;
    wrap.className = 'comment-edit-wrap';

    const textarea = document.createElement('textarea');
    textarea.id = `comment-edit-${commentId}`;
    textarea.className = 'comment-edit-textarea';
    textarea.rows = 6;
    textarea.value = content;

    const actions = document.createElement('div');
    actions.className = 'comment-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = () => saveCommentEdit(commentId);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => cancelCommentEdit(commentId);

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    wrap.appendChild(textarea);
    wrap.appendChild(actions);
    viewEl.insertAdjacentElement('afterend', wrap);
    textarea.focus();
}

function cancelCommentEdit(commentId) {
    const viewEl = document.getElementById(`comment-content-${commentId}`);
    const wrap = document.getElementById(`comment-edit-wrap-${commentId}`);
    if (viewEl) {
        viewEl.style.display = '';
    }
    if (wrap) {
        wrap.remove();
    }
}

async function saveCommentEdit(commentId) {
    const textarea = document.getElementById(`comment-edit-${commentId}`);
    const viewEl = document.getElementById(`comment-content-${commentId}`);
    if (!textarea || !viewEl) {
        return;
    }

    const content = textarea.value.trim();
    if (!content) {
        alert('Comment content cannot be empty');
        return;
    }

    const wrap = document.getElementById(`comment-edit-wrap-${commentId}`);
    const saveBtn = wrap?.querySelector('.btn-primary');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
    }

    try {
        await AdminAuth.ensureCsrfToken();
        const response = await fetch(`${API_URL}?action=edit_content&id=${commentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
            credentials: 'include',
            body: JSON.stringify({ content, csrf_token: AdminAuth.getCsrfToken() }),
        });

        const result = await response.json();
        if (response.ok) {
            viewEl.textContent = result.content ?? content;
            cancelCommentEdit(commentId);
        } else {
            alert(result.error || 'Failed to save comment');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        }
    } catch (error) {
        alert('Network error while saving comment');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    }
}
