/**
 * tests/recent-comments-filter.test.mjs
 *
 * Tests for the Recent Comments filtering feature:
 * - By default, admin comments (author_role="admin") are excluded
 * - When show_admin_comments_in_recent=true, both user and admin comments are included
 * - The setting defaults to false when not set
 * - The filtering is done at the query level, not in the frontend
 *
 * Run: node --test tests/recent-comments-filter.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock D1 Database ──────────────────────────────────────────────────────
// Simulates Cloudflare D1's query interface for testing.

class MockD1Database {
    constructor() {
        this.comments = [];
        this.settings = new Map();
    }

    prepare(sql) {
        const db = this;
        return {
            bind(...params) {
                return {
                    async first() {
                        // Handle settings queries
                        if (sql.includes('FROM settings')) {
                            const key = params[0];
                            const val = db.settings.get(key);
                            return val !== undefined ? { value: val } : undefined;
                        }
                        return null;
                    },
                    async all() {
                        let results = [...db.comments];

                        // Parse WHERE conditions from SQL
                        if (sql.includes("status = 'approved'")) {
                            results = results.filter(c => c.status === 'approved');
                        }
                        if (sql.includes("author_role = 'user'")) {
                            results = results.filter(c => c.author_role === 'user');
                        }
                        if (sql.includes('ORDER BY created_at DESC')) {
                            results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                        }

                        // Handle LIMIT
                        const limitParam = params.find(p => typeof p === 'number' && p <= 100);
                        if (limitParam) {
                            results = results.slice(0, limitParam);
                        }

                        return { results };
                    },
                };
            },
        };
    }

    addComment(data) {
        this.comments.push({
            id: this.comments.length + 1,
            page_url: data.page_url || '/test',
            author_name: data.author_name || 'Test',
            author_email: data.author_email || 'test@example.com',
            content: data.content || 'Test comment',
            status: data.status || 'approved',
            author_role: data.author_role || 'user',
            author_hash: data.author_hash || 'abc123',
            created_at: data.created_at || new Date().toISOString(),
        });
    }

    setSetting(key, value) {
        this.settings.set(key, value);
    }
}

// ── Mock CommentService (mirrors worker/src/comments.ts) ──────────────────

class MockCommentService {
    constructor(db) {
        this.db = db;
    }

    async getRecentComments(limit, showAdminComments = false) {
        let query = `SELECT * FROM comments WHERE status = 'approved'`;
        if (!showAdminComments) {
            query += ` AND author_role = 'user'`;
        }
        query += ` ORDER BY created_at DESC LIMIT ?`;

        const { results } = await this.db.prepare(query).bind(limit).all();

        for (const row of results) {
            const content = row.content;
            row.excerpt = content.length > 150 ? content.substring(0, 150) + '...' : content;
        }

        // Skip enrichCommentsWithAvatars in tests (no crypto mock needed)
        return { comments: results };
    }
}

// ── Mock SettingsService ──────────────────────────────────────────────────

class MockSettingsService {
    constructor(db) {
        this.db = db;
    }

    async getSetting(key) {
        const row = await this.db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
        return row?.value;
    }

    async getAllSettings() {
        const config = {};
        for (const [key, value] of this.db.settings) {
            config[key] = value;
        }
        return config;
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: getRecentComments filtering
// ═════════════════════════════════════════════════════════════════════════════

describe('getRecentComments - default behavior (showAdminComments=false)', () => {
    let db, svc;

    beforeEach(() => {
        db = new MockD1Database();
        // Add 5 user comments and 3 admin comments
        for (let i = 1; i <= 5; i++) {
            db.addComment({ author_name: `User ${i}`, author_role: 'user', created_at: `2026-01-0${i}T00:00:00Z` });
        }
        for (let i = 1; i <= 3; i++) {
            db.addComment({ author_name: `Admin ${i}`, author_role: 'admin', created_at: `2026-01-0${i}T12:00:00Z` });
        }
        svc = new MockCommentService(db);
    });

    it('should exclude admin comments by default', async () => {
        const result = await svc.getRecentComments(10);
        assert.strictEqual(result.comments.length, 5, 'Should only return user comments');
        result.comments.forEach(c => {
            assert.strictEqual(c.author_role, 'user', `Comment by ${c.author_name} should be user role`);
        });
    });

    it('should respect limit parameter', async () => {
        const result = await svc.getRecentComments(3);
        assert.strictEqual(result.comments.length, 3);
    });

    it('should only return approved comments', async () => {
        db.addComment({ author_name: 'Pending User', author_role: 'user', status: 'pending' });
        db.addComment({ author_name: 'Spam User', author_role: 'user', status: 'spam' });
        const result = await svc.getRecentComments(10);
        result.comments.forEach(c => {
            assert.strictEqual(c.status, 'approved');
        });
    });

    it('should order by created_at DESC', async () => {
        db.comments = []; // Clear and re-add with known dates
        db.addComment({ author_name: 'Old', author_role: 'user', created_at: '2026-01-01T00:00:00Z' });
        db.addComment({ author_name: 'New', author_role: 'user', created_at: '2026-06-01T00:00:00Z' });
        db.addComment({ author_name: 'Mid', author_role: 'user', created_at: '2026-03-01T00:00:00Z' });

        const result = await svc.getRecentComments(10);
        assert.strictEqual(result.comments[0].author_name, 'New');
        assert.strictEqual(result.comments[1].author_name, 'Mid');
        assert.strictEqual(result.comments[2].author_name, 'Old');
    });

    it('should return excerpt for each comment', async () => {
        const result = await svc.getRecentComments(10);
        result.comments.forEach(c => {
            assert.ok(c.excerpt !== undefined, 'Comment should have excerpt');
            assert.ok(c.excerpt.length > 0, 'Excerpt should not be empty');
        });
    });
});

describe('getRecentComments - showAdminComments=true', () => {
    let db, svc;

    beforeEach(() => {
        db = new MockD1Database();
        for (let i = 1; i <= 3; i++) {
            db.addComment({ author_name: `User ${i}`, author_role: 'user', created_at: `2026-01-0${i}T00:00:00Z` });
        }
        for (let i = 1; i <= 2; i++) {
            db.addComment({ author_name: `Admin ${i}`, author_role: 'admin', created_at: `2026-01-0${i}T12:00:00Z` });
        }
        svc = new MockCommentService(db);
    });

    it('should include admin comments when showAdminComments=true', async () => {
        const result = await svc.getRecentComments(10, true);
        assert.strictEqual(result.comments.length, 5, 'Should return all approved comments');
        const roles = result.comments.map(c => c.author_role);
        assert.ok(roles.includes('admin'), 'Should include admin comments');
        assert.ok(roles.includes('user'), 'Should include user comments');
    });

    it('should still respect limit when including admin comments', async () => {
        const result = await svc.getRecentComments(2, true);
        assert.strictEqual(result.comments.length, 2);
    });

    it('should still only return approved comments', async () => {
        db.addComment({ author_name: 'Spam Admin', author_role: 'admin', status: 'spam' });
        const result = await svc.getRecentComments(10, true);
        result.comments.forEach(c => {
            assert.strictEqual(c.status, 'approved');
        });
    });
});

describe('getRecentComments - edge cases', () => {
    it('should return empty array when no comments exist', async () => {
        const db = new MockD1Database();
        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10);
        assert.deepStrictEqual(result.comments, []);
    });

    it('should handle very large limit gracefully', async () => {
        const db = new MockD1Database();
        db.addComment({ author_role: 'user' });
        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(1000);
        assert.strictEqual(result.comments.length, 1, 'Should return all available comments');
    });

    it('should handle only admin comments with default setting', async () => {
        const db = new MockD1Database();
        db.addComment({ author_name: 'Admin Only', author_role: 'admin' });
        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10);
        assert.deepStrictEqual(result.comments, [], 'Should return empty when only admin comments exist');
    });

    it('should handle only admin comments with showAdmin=true', async () => {
        const db = new MockD1Database();
        db.addComment({ author_name: 'Admin Only', author_role: 'admin' });
        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, true);
        assert.strictEqual(result.comments.length, 1);
        assert.strictEqual(result.comments[0].author_role, 'admin');
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: Settings Service integration
// ═════════════════════════════════════════════════════════════════════════════

describe('Settings: show_admin_comments_in_recent', () => {
    it('should default to undefined (falsy) when not set', async () => {
        const db = new MockD1Database();
        const settings = new MockSettingsService(db);
        const val = await settings.getSetting('show_admin_comments_in_recent');
        assert.strictEqual(val, undefined);
    });

    it('should return "false" when explicitly set to false', async () => {
        const db = new MockD1Database();
        db.setSetting('show_admin_comments_in_recent', 'false');
        const settings = new MockSettingsService(db);
        const val = await settings.getSetting('show_admin_comments_in_recent');
        assert.strictEqual(val, 'false');
    });

    it('should return "true" when explicitly set to true', async () => {
        const db = new MockD1Database();
        db.setSetting('show_admin_comments_in_recent', 'true');
        const settings = new MockSettingsService(db);
        const val = await settings.getSetting('show_admin_comments_in_recent');
        assert.strictEqual(val, 'true');
    });

    it('undefined setting should be treated as false (admin excluded)', async () => {
        const db = new MockD1Database();
        db.addComment({ author_name: 'Admin', author_role: 'admin' });
        db.addComment({ author_name: 'User', author_role: 'user' });
        const settings = new MockSettingsService(db);
        const showAdmin = (await settings.getSetting('show_admin_comments_in_recent')) === 'true';
        assert.strictEqual(showAdmin, false, 'undefined setting should evaluate to false');

        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, showAdmin);
        assert.strictEqual(result.comments.length, 1);
        assert.strictEqual(result.comments[0].author_role, 'user');
    });

    it('"false" setting should be treated as false (admin excluded)', async () => {
        const db = new MockD1Database();
        db.addComment({ author_name: 'Admin', author_role: 'admin' });
        db.addComment({ author_name: 'User', author_role: 'user' });
        db.setSetting('show_admin_comments_in_recent', 'false');
        const settings = new MockSettingsService(db);
        const showAdmin = (await settings.getSetting('show_admin_comments_in_recent')) === 'true';
        assert.strictEqual(showAdmin, false);

        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, showAdmin);
        assert.strictEqual(result.comments.length, 1);
        assert.strictEqual(result.comments[0].author_role, 'user');
    });

    it('"true" setting should be treated as true (admin included)', async () => {
        const db = new MockD1Database();
        db.addComment({ author_name: 'Admin', author_role: 'admin' });
        db.addComment({ author_name: 'User', author_role: 'user' });
        db.setSetting('show_admin_comments_in_recent', 'true');
        const settings = new MockSettingsService(db);
        const showAdmin = (await settings.getSetting('show_admin_comments_in_recent')) === 'true';
        assert.strictEqual(showAdmin, true);

        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, showAdmin);
        assert.strictEqual(result.comments.length, 2);
    });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: End-to-end integration (setting + query)
// ═════════════════════════════════════════════════════════════════════════════

describe('End-to-end: setting drives query behavior', () => {
    function setupDb() {
        const db = new MockD1Database();
        db.addComment({ author_name: 'User A', author_role: 'user', created_at: '2026-06-01T00:00:00Z' });
        db.addComment({ author_name: 'User B', author_role: 'user', created_at: '2026-05-01T00:00:00Z' });
        db.addComment({ author_name: 'Admin A', author_role: 'admin', created_at: '2026-04-01T00:00:00Z' });
        db.addComment({ author_name: 'User C', author_role: 'user', status: 'pending', created_at: '2026-03-01T00:00:00Z' });
        return db;
    }

    it('setting=false → only user comments', async () => {
        const db = setupDb();
        db.setSetting('show_admin_comments_in_recent', 'false');
        const settings = new MockSettingsService(db);
        const showAdmin = (await settings.getSetting('show_admin_comments_in_recent')) === 'true';

        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, showAdmin);

        assert.strictEqual(result.comments.length, 2, 'Should have 2 approved user comments');
        result.comments.forEach(c => {
            assert.strictEqual(c.author_role, 'user');
            assert.strictEqual(c.status, 'approved');
        });
    });

    it('setting=true → all approved comments', async () => {
        const db = setupDb();
        db.setSetting('show_admin_comments_in_recent', 'true');
        const settings = new MockSettingsService(db);
        const showAdmin = (await settings.getSetting('show_admin_comments_in_recent')) === 'true';

        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, showAdmin);

        assert.strictEqual(result.comments.length, 3, 'Should have 3 approved comments (2 user + 1 admin)');
        const names = result.comments.map(c => c.author_name);
        assert.ok(names.includes('Admin A'), 'Should include Admin A');
    });

    it('no setting set → defaults to excluding admin', async () => {
        const db = setupDb();
        // Don't set the setting at all
        const settings = new MockSettingsService(db);
        const showAdmin = (await settings.getSetting('show_admin_comments_in_recent')) === 'true';

        const svc = new MockCommentService(db);
        const result = await svc.getRecentComments(10, showAdmin);

        assert.strictEqual(result.comments.length, 2, 'Should default to user-only');
        result.comments.forEach(c => {
            assert.strictEqual(c.author_role, 'user');
        });
    });
});
