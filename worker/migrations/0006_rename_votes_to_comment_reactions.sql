-- Migration 0006: Rename votes → comment_reactions, vote_log → reaction_rate_log
-- Idempotent: safe on fresh and existing databases

-- Rename votes → comment_reactions (skip if already renamed or table doesn't exist)
CREATE TABLE IF NOT EXISTS comment_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    ip_address TEXT NOT NULL,
    reaction_type TEXT NOT NULL DEFAULT 'heart',
    author_role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    UNIQUE(comment_id, ip_address, reaction_type, author_role)
);

INSERT OR IGNORE INTO comment_reactions (id, comment_id, ip_address, reaction_type, author_role, created_at)
SELECT id, comment_id, ip_address, reaction_type, COALESCE(author_role, 'user'), created_at FROM votes;

DROP TABLE IF EXISTS votes;

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_lookup ON comment_reactions(comment_id, reaction_type);

-- Rename vote_log → reaction_rate_log (skip if already renamed or table doesn't exist)
CREATE TABLE IF NOT EXISTS reaction_rate_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO reaction_rate_log (ip_address, created_at)
SELECT ip_address, created_at FROM vote_log;

DROP TABLE IF EXISTS vote_log;

CREATE INDEX IF NOT EXISTS idx_reaction_rate_log_ip ON reaction_rate_log(ip_address, created_at);
