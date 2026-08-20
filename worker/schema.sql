-- Comments System Database Schema
-- SQLite database for managing threaded comments

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_url TEXT NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    author_url TEXT DEFAULT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'spam', 'deleted')),
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_url ON comments(page_url);
CREATE INDEX IF NOT EXISTS idx_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_status ON comments(status);
CREATE INDEX IF NOT EXISTS idx_created_at ON comments(created_at);

-- Performance indexes for rate limiting (critical for high traffic)
CREATE INDEX IF NOT EXISTS idx_ip_address ON comments(ip_address);
CREATE INDEX IF NOT EXISTS idx_author_email ON comments(author_email);
CREATE INDEX IF NOT EXISTS idx_rate_limit_ip ON comments(ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_email ON comments(author_email, created_at);

-- Composite indexes for faster filtered queries
CREATE INDEX IF NOT EXISTS idx_page_url_status ON comments(page_url, status);
CREATE INDEX IF NOT EXISTS idx_author_email_status ON comments(author_email, status);

-- Settings table for admin configuration
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('admin_password_hash', ''),
    ('require_moderation', 'true'),
    ('allow_guest_comments', 'true'),
    ('max_comment_length', '5000'),
    ('telegram_enabled', 'false'),
    ('telegram_chat_id', '');

-- Login attempts tracking for brute force protection
CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    success INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);

-- Admin sessions table for proper authentication
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_session_expires ON sessions(expires_at);

-- Votes table for per-comment emoji reactions
CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    ip_address TEXT NOT NULL,
    reaction_type TEXT NOT NULL DEFAULT 'heart',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    UNIQUE(comment_id, ip_address, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_votes_comment ON votes(comment_id);

-- Vote log for rate limiting
CREATE TABLE IF NOT EXISTS vote_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vote_log_ip ON vote_log(ip_address, created_at);

-- Post reactions table for page-level emoji reactions (no comment required)
CREATE TABLE IF NOT EXISTS post_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_url TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    reaction_type TEXT NOT NULL DEFAULT 'heart',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_url, ip_address, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_page ON post_reactions(page_url);
