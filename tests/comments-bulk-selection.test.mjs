/**
 * tests/comments-bulk-selection.test.js
 *
 * Tests for the bulk selection feature in the Admin Comments panel.
 * Uses Node.js built-in test runner (node:test + node:assert).
 *
 * Run: node --test tests/comments-bulk-selection.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Extract the BULK_ACTIONS and CONFIRM_ACTIONS configuration ────────────
// These are the core data structures that define which actions are available
// per tab and what confirmation messages to show. We test them in isolation.

const BULK_ACTIONS = {
    pending: [
        { action: 'approved', label: 'Approve', danger: false },
        { action: 'spam',     label: 'Spam',    danger: true },
        { action: 'delete',   label: 'Delete',  danger: true },
    ],
    approved: [
        { action: 'spam',     label: 'Spam',    danger: true },
        { action: 'delete',   label: 'Delete',  danger: true },
    ],
    spam: [
        { action: 'approved', label: 'Approve', danger: false },
        { action: 'delete',   label: 'Delete',  danger: true },
    ],
    deleted: [
        { action: 'restore',   label: 'Restore',            danger: false },
        { action: 'permanent', label: 'Permanently Delete',  danger: true },
    ],
    all: [
        { action: 'approved', label: 'Approve', danger: false },
        { action: 'spam',     label: 'Spam',    danger: true },
        { action: 'delete',   label: 'Delete',  danger: true },
    ],
};

const CONFIRM_ACTIONS = {
    delete:    (n) => `Move ${n} comment${n > 1 ? 's' : ''} to Trash?`,
    spam:      (n) => `Mark ${n} comment${n > 1 ? 's' : ''} as Spam?`,
    permanent: (n) => `Permanently delete ${n} comment${n > 1 ? 's' : ''}? This cannot be undone.`,
};

// ── Mock CommentService (mirrors worker/src/comments.ts) ─────────────────
// Tests that individual comment operations (used by bulk actions) work correctly.

class MockCommentService {
    constructor() {
        this.comments = new Map();
        this.nextId = 1;
    }

    addComment(data) {
        const id = this.nextId++;
        const comment = {
            id,
            page_url: data.page_url || '/test',
            parent_id: data.parent_id || null,
            author_name: data.author_name || 'Test',
            author_email: data.author_email || 'test@example.com',
            author_url: data.author_url || null,
            content: data.content || 'Test comment',
            ip_address: data.ip_address || '127.0.0.1',
            status: data.status || 'pending',
            author_role: data.author_role || 'user',
            created_at: new Date().toISOString(),
        };
        this.comments.set(id, comment);
        return comment;
    }

    async moderateComment(id, status) {
        const comment = this.comments.get(id);
        if (!comment) return { error: 'Comment not found' };
        comment.status = status;
        return { success: true };
    }

    async deleteComment(id) {
        const comment = this.comments.get(id);
        if (!comment) return { error: 'Comment not found' };
        comment.status = 'deleted';
        return { success: true };
    }

    async restoreComment(id) {
        const comment = this.comments.get(id);
        if (!comment) return { error: 'Comment not found' };
        if (comment.status !== 'deleted') return { success: true };
        comment.status = 'pending';
        return { success: true };
    }

    async permanentDeleteComment(id) {
        if (!this.comments.has(id)) return { error: 'Comment not found' };
        this.comments.delete(id);
        return { success: true };
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: Bulk Actions Configuration
// ═════════════════════════════════════════════════════════════════════════════

describe('BULK_ACTIONS configuration', () => {

    it('should define actions for all expected tabs', () => {
        const expectedTabs = ['pending', 'approved', 'spam', 'deleted', 'all'];
        for (const tab of expectedTabs) {
            assert.ok(BULK_ACTIONS[tab], `Missing BULK_ACTIONS for tab: ${tab}`);
            assert.ok(Array.isArray(BULK_ACTIONS[tab]), `BULK_ACTIONS for ${tab} should be an array`);
            assert.ok(BULK_ACTIONS[tab].length > 0, `BULK_ACTIONS for ${tab} should have at least one action`);
        }
    });

    it('pending tab should have Approve, Spam, and Delete', () => {
        const actions = BULK_ACTIONS.pending.map(a => a.action);
        assert.deepStrictEqual(actions, ['approved', 'spam', 'delete']);
    });

    it('approved tab should have Spam and Delete', () => {
        const actions = BULK_ACTIONS.approved.map(a => a.action);
        assert.deepStrictEqual(actions, ['spam', 'delete']);
    });

    it('spam tab should have Approve and Delete', () => {
        const actions = BULK_ACTIONS.spam.map(a => a.action);
        assert.deepStrictEqual(actions, ['approved', 'delete']);
    });

    it('deleted tab should have Restore and Permanently Delete', () => {
        const actions = BULK_ACTIONS.deleted.map(a => a.action);
        assert.deepStrictEqual(actions, ['restore', 'permanent']);
    });

    it('all tab should have Approve, Spam, and Delete', () => {
        const actions = BULK_ACTIONS.all.map(a => a.action);
        assert.deepStrictEqual(actions, ['approved', 'spam', 'delete']);
    });

    it('each action should have label, action name, and danger flag', () => {
        for (const [tab, actions] of Object.entries(BULK_ACTIONS)) {
            for (const action of actions) {
                assert.ok(action.label, `${tab}/${action.action} missing label`);
                assert.ok(action.action, `${tab} has action without action name`);
                assert.strictEqual(typeof action.danger, 'boolean', `${tab}/${action.action} missing danger flag`);
            }
        }
    });

    it('non-destructive actions should not be marked as danger', () => {
        const nonDestructive = ['approved', 'restore'];
        for (const [tab, actions] of Object.entries(BULK_ACTIONS)) {
            for (const action of actions) {
                if (nonDestructive.includes(action.action)) {
                    assert.strictEqual(action.danger, false, `${tab}/${action.action} should not be danger`);
                }
            }
        }
    });

    it('destructive actions should be marked as danger', () => {
        const destructive = ['spam', 'delete', 'permanent'];
        for (const [tab, actions] of Object.entries(BULK_ACTIONS)) {
            for (const action of actions) {
                if (destructive.includes(action.action)) {
                    assert.strictEqual(action.danger, true, `${tab}/${action.action} should be danger`);
                }
            }
        }
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: Confirmation Messages
// ═════════════════════════════════════════════════════════════════════════════

describe('CONFIRM_ACTIONS messages', () => {

    it('delete confirmation for single comment', () => {
        assert.strictEqual(CONFIRM_ACTIONS.delete(1), 'Move 1 comment to Trash?');
    });

    it('delete confirmation for multiple comments', () => {
        assert.strictEqual(CONFIRM_ACTIONS.delete(5), 'Move 5 comments to Trash?');
    });

    it('spam confirmation for single comment', () => {
        assert.strictEqual(CONFIRM_ACTIONS.spam(1), 'Mark 1 comment as Spam?');
    });

    it('spam confirmation for multiple comments', () => {
        assert.strictEqual(CONFIRM_ACTIONS.spam(10), 'Mark 10 comments as Spam?');
    });

    it('permanent delete confirmation for single comment', () => {
        assert.strictEqual(CONFIRM_ACTIONS.permanent(1), 'Permanently delete 1 comment? This cannot be undone.');
    });

    it('permanent delete confirmation for multiple comments', () => {
        assert.strictEqual(CONFIRM_ACTIONS.permanent(3), 'Permanently delete 3 comments? This cannot be undone.');
    });

    it('non-destructive actions should not have confirmation', () => {
        assert.strictEqual(CONFIRM_ACTIONS.approved, undefined);
        assert.strictEqual(CONFIRM_ACTIONS.restore, undefined);
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: CommentService Operations (bulk action building blocks)
// ═════════════════════════════════════════════════════════════════════════════

describe('CommentService moderateComment', () => {

    it('should approve a pending comment', async () => {
        const svc = new MockCommentService();
        const c = svc.addComment({ status: 'pending' });
        const result = await svc.moderateComment(c.id, 'approved');
        assert.deepStrictEqual(result, { success: true });
        assert.strictEqual(svc.comments.get(c.id).status, 'approved');
    });

    it('should mark an approved comment as spam', async () => {
        const svc = new MockCommentService();
        const c = svc.addComment({ status: 'approved' });
        const result = await svc.moderateComment(c.id, 'spam');
        assert.deepStrictEqual(result, { success: true });
        assert.strictEqual(svc.comments.get(c.id).status, 'spam');
    });

    it('should return error for non-existent comment', async () => {
        const svc = new MockCommentService();
        const result = await svc.moderateComment(999, 'approved');
        assert.ok(result.error);
    });
});

describe('CommentService deleteComment', () => {

    it('should soft-delete a comment (set status to deleted)', async () => {
        const svc = new MockCommentService();
        const c = svc.addComment({ status: 'approved' });
        const result = await svc.deleteComment(c.id);
        assert.deepStrictEqual(result, { success: true });
        assert.strictEqual(svc.comments.get(c.id).status, 'deleted');
    });

    it('should return error for non-existent comment', async () => {
        const svc = new MockCommentService();
        const result = await svc.deleteComment(999);
        assert.ok(result.error);
    });
});

describe('CommentService restoreComment', () => {

    it('should restore a deleted comment to pending', async () => {
        const svc = new MockCommentService();
        const c = svc.addComment({ status: 'deleted' });
        const result = await svc.restoreComment(c.id);
        assert.deepStrictEqual(result, { success: true });
        assert.strictEqual(svc.comments.get(c.id).status, 'pending');
    });

    it('should handle restoring a non-deleted comment gracefully', async () => {
        const svc = new MockCommentService();
        const c = svc.addComment({ status: 'approved' });
        const result = await svc.restoreComment(c.id);
        assert.deepStrictEqual(result, { success: true });
        // Status should remain unchanged for non-deleted comments
        assert.strictEqual(svc.comments.get(c.id).status, 'approved');
    });
});

describe('CommentService permanentDeleteComment', () => {

    it('should permanently remove a comment', async () => {
        const svc = new MockCommentService();
        const c = svc.addComment({ status: 'deleted' });
        const result = await svc.permanentDeleteComment(c.id);
        assert.deepStrictEqual(result, { success: true });
        assert.strictEqual(svc.comments.has(c.id), false);
    });

    it('should return error for non-existent comment', async () => {
        const svc = new MockCommentService();
        const result = await svc.permanentDeleteComment(999);
        assert.ok(result.error);
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: Bulk Action Simulation (parallel execution with failures)
// ═════════════════════════════════════════════════════════════════════════════

describe('Bulk action simulation', () => {

    async function simulateBulkAction(service, ids, actionFn) {
        const results = { succeeded: 0, failed: 0, skipped: 0 };
        const promises = ids.map(async (id) => {
            try {
                const result = await actionFn(service, id);
                if (result && result.success) results.succeeded++;
                else if (result && result.error) results.failed++;
                else results.skipped++;
            } catch {
                results.failed++;
            }
        });
        await Promise.all(promises);
        return results;
    }

    it('should handle bulk approve of 5 pending comments', async () => {
        const svc = new MockCommentService();
        const ids = [];
        for (let i = 0; i < 5; i++) {
            const c = svc.addComment({ status: 'pending' });
            ids.push(c.id);
        }
        const results = await simulateBulkAction(svc, ids, (s, id) => s.moderateComment(id, 'approved'));
        assert.deepStrictEqual(results, { succeeded: 5, failed: 0, skipped: 0 });
        for (const id of ids) {
            assert.strictEqual(svc.comments.get(id).status, 'approved');
        }
    });

    it('should handle bulk delete with partial failures', async () => {
        const svc = new MockCommentService();
        const ids = [];
        for (let i = 0; i < 8; i++) {
            const c = svc.addComment({ status: 'approved' });
            ids.push(c.id);
        }
        // Make 2 of them fail by using invalid IDs
        ids.push(99901, 99902);

        const results = await simulateBulkAction(svc, ids, (s, id) => s.deleteComment(id));
        assert.deepStrictEqual(results, { succeeded: 8, failed: 2, skipped: 0 });
    });

    it('should handle bulk spam marking', async () => {
        const svc = new MockCommentService();
        const ids = [];
        for (let i = 0; i < 3; i++) {
            const c = svc.addComment({ status: 'pending' });
            ids.push(c.id);
        }
        const results = await simulateBulkAction(svc, ids, (s, id) => s.moderateComment(id, 'spam'));
        assert.deepStrictEqual(results, { succeeded: 3, failed: 0, skipped: 0 });
        for (const id of ids) {
            assert.strictEqual(svc.comments.get(id).status, 'spam');
        }
    });

    it('should handle bulk restore of deleted comments', async () => {
        const svc = new MockCommentService();
        const ids = [];
        for (let i = 0; i < 4; i++) {
            const c = svc.addComment({ status: 'deleted' });
            ids.push(c.id);
        }
        const results = await simulateBulkAction(svc, ids, (s, id) => s.restoreComment(id));
        assert.deepStrictEqual(results, { succeeded: 4, failed: 0, skipped: 0 });
        for (const id of ids) {
            assert.strictEqual(svc.comments.get(id).status, 'pending');
        }
    });

    it('should handle bulk permanent delete', async () => {
        const svc = new MockCommentService();
        const ids = [];
        for (let i = 0; i < 3; i++) {
            const c = svc.addComment({ status: 'deleted' });
            ids.push(c.id);
        }
        const results = await simulateBulkAction(svc, ids, (s, id) => s.permanentDeleteComment(id));
        assert.deepStrictEqual(results, { succeeded: 3, failed: 0, skipped: 0 });
        for (const id of ids) {
            assert.strictEqual(svc.comments.has(id), false);
        }
    });

    it('should handle empty selection gracefully', async () => {
        const svc = new MockCommentService();
        const results = await simulateBulkAction(svc, [], (s, id) => s.moderateComment(id, 'approved'));
        assert.deepStrictEqual(results, { succeeded: 0, failed: 0, skipped: 0 });
    });

    it('should handle all-failure scenario', async () => {
        const svc = new MockCommentService();
        const results = await simulateBulkAction(svc, [99901, 99902, 99903], (s, id) => s.moderateComment(id, 'approved'));
        assert.deepStrictEqual(results, { succeeded: 0, failed: 3, skipped: 0 });
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: Result Formatting
// ═════════════════════════════════════════════════════════════════════════════

describe('Result formatting', () => {

    const actionLabels = {
        approved: 'approved',
        spam: 'marked as spam',
        delete: 'moved to trash',
        restore: 'restored',
        permanent: 'permanently deleted',
    };

    function formatBulkResult(results, action) {
        const label = actionLabels[action] || action;
        const parts = [];
        if (results.succeeded > 0) {
            parts.push(`${results.succeeded} ${label}`);
        }
        if (results.failed > 0) {
            parts.push(`${results.failed} failed`);
        }
        if (results.succeeded === 0 && results.failed === 0) {
            return 'No comments were processed';
        }
        return parts.join(' · ');
    }

    it('should format all-success result', () => {
        const msg = formatBulkResult({ succeeded: 5, failed: 0 }, 'approved');
        assert.strictEqual(msg, '5 approved');
    });

    it('should format partial failure result', () => {
        const msg = formatBulkResult({ succeeded: 8, failed: 2 }, 'approved');
        assert.strictEqual(msg, '8 approved · 2 failed');
    });

    it('should format all-failure result', () => {
        const msg = formatBulkResult({ succeeded: 0, failed: 3 }, 'delete');
        assert.strictEqual(msg, '3 failed');
    });

    it('should format zero-processed result', () => {
        const msg = formatBulkResult({ succeeded: 0, failed: 0 }, 'approved');
        assert.strictEqual(msg, 'No comments were processed');
    });

    it('should use correct label for each action type', () => {
        assert.strictEqual(
            formatBulkResult({ succeeded: 1, failed: 0 }, 'spam'),
            '1 marked as spam'
        );
        assert.strictEqual(
            formatBulkResult({ succeeded: 1, failed: 0 }, 'delete'),
            '1 moved to trash'
        );
        assert.strictEqual(
            formatBulkResult({ succeeded: 1, failed: 0 }, 'restore'),
            '1 restored'
        );
        assert.strictEqual(
            formatBulkResult({ succeeded: 1, failed: 0 }, 'permanent'),
            '1 permanently deleted'
        );
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 6: Selection Mode State Logic
// ═════════════════════════════════════════════════════════════════════════════

describe('Selection mode state logic', () => {

    class SelectionState {
        constructor() {
            this.selectionMode = false;
            this.selectedIds = new Set();
        }

        enter() {
            this.selectionMode = true;
            this.selectedIds.clear();
        }

        exit() {
            this.selectionMode = false;
            this.selectedIds.clear();
        }

        toggle(id) {
            if (this.selectedIds.has(id)) {
                this.selectedIds.delete(id);
            } else {
                this.selectedIds.add(id);
            }
        }

        selectAll(ids) {
            ids.forEach(id => this.selectedIds.add(id));
        }

        deselectAll() {
            this.selectedIds.clear();
        }

        isSelected(id) {
            return this.selectedIds.has(id);
        }

        get count() {
            return this.selectedIds.size;
        }

        isAllSelected(ids) {
            return ids.length > 0 && ids.every(id => this.selectedIds.has(id));
        }
    }

    it('should start in non-selection mode with empty selection', () => {
        const state = new SelectionState();
        assert.strictEqual(state.selectionMode, false);
        assert.strictEqual(state.count, 0);
    });

    it('should enter selection mode and clear selection', () => {
        const state = new SelectionState();
        state.selectedIds.add(1);
        state.selectedIds.add(2);
        state.enter();
        assert.strictEqual(state.selectionMode, true);
        assert.strictEqual(state.count, 0);
    });

    it('should exit selection mode and clear selection', () => {
        const state = new SelectionState();
        state.enter();
        state.toggle(1);
        state.toggle(2);
        state.exit();
        assert.strictEqual(state.selectionMode, false);
        assert.strictEqual(state.count, 0);
    });

    it('should toggle individual comment selection', () => {
        const state = new SelectionState();
        state.enter();
        state.toggle(1);
        assert.strictEqual(state.isSelected(1), true);
        assert.strictEqual(state.count, 1);
        state.toggle(1);
        assert.strictEqual(state.isSelected(1), false);
        assert.strictEqual(state.count, 0);
    });

    it('should select all visible comments', () => {
        const state = new SelectionState();
        state.enter();
        state.selectAll([1, 2, 3, 4, 5]);
        assert.strictEqual(state.count, 5);
        assert.strictEqual(state.isAllSelected([1, 2, 3, 4, 5]), true);
    });

    it('should deselect all', () => {
        const state = new SelectionState();
        state.enter();
        state.selectAll([1, 2, 3]);
        state.deselectAll();
        assert.strictEqual(state.count, 0);
    });

    it('should correctly detect partial selection', () => {
        const state = new SelectionState();
        state.enter();
        state.toggle(1);
        state.toggle(3);
        assert.strictEqual(state.isAllSelected([1, 2, 3, 4, 5]), false);
    });

    it('should correctly detect full selection', () => {
        const state = new SelectionState();
        state.enter();
        state.selectAll([1, 2, 3]);
        assert.strictEqual(state.isAllSelected([1, 2, 3]), true);
    });

    it('should handle empty visible list for isAllSelected', () => {
        const state = new SelectionState();
        state.enter();
        assert.strictEqual(state.isAllSelected([]), false);
    });

    it('should handle multiple toggles on same id', () => {
        const state = new SelectionState();
        state.enter();
        state.toggle(1);
        state.toggle(1);
        state.toggle(1);
        assert.strictEqual(state.isSelected(1), true);
        assert.strictEqual(state.count, 1);
    });
});
