-- Migration: Switch to PBKDF2-HMAC-SHA-256 password hashing
-- The old SHA-256 hash is incompatible and must be replaced.
-- Admin will need to set a new password after this migration.

-- Clear the legacy plain SHA-256 hash (incompatible with PBKDF2 format)
UPDATE settings SET value = '' WHERE key = 'admin_password_hash';

-- Remove the legacy admin_token setting (sessions are now server-side only)
DELETE FROM settings WHERE key = 'admin_token';

-- Clean up any stale sessions
DELETE FROM sessions WHERE expires_at < datetime('now');

-- Clean up old login attempts
DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-72 hours');
