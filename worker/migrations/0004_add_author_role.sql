-- Migration 0004: Add author_role column to comments table
-- CHECK constraint omitted from ALTER TABLE (SQLite ignores it on existing rows)
ALTER TABLE comments ADD COLUMN author_role TEXT DEFAULT 'user';
