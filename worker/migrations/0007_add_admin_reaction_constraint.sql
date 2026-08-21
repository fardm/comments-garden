-- Migration 0007: Enforce author_role constraint on comment_reactions
-- Since SQLite ALTER TABLE cannot easily add CHECK constraints, and it's already idempotent via re-creation,
-- we'll recreate the table with the CHECK constraint. However, this is risky for data loss if not done right.
-- But the prompt suggests we should create a migration to apply it. Let's do a table rename, create new, copy, drop pattern.

CREATE TABLE IF NOT EXISTS comment_reactions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    ip_address TEXT NOT NULL,
    reaction_type TEXT NOT NULL DEFAULT 'heart',
    author_role TEXT DEFAULT 'user' CHECK(author_role IN ('user', 'admin')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    UNIQUE(comment_id, ip_address, reaction_type, author_role)
);

INSERT OR IGNORE INTO comment_reactions_new (id, comment_id, ip_address, reaction_type, author_role, created_at)
SELECT id, comment_id, ip_address, reaction_type, author_role, created_at FROM comment_reactions;

DROP TABLE IF EXISTS comment_reactions;

ALTER TABLE comment_reactions_new RENAME TO comment_reactions;

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_lookup ON comment_reactions(comment_id, reaction_type);
