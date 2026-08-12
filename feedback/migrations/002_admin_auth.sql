-- Admin authentication: email + password, replacing Cloudflare Access.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/002_admin_auth.sql
--
-- Security notes:
--  * password_hash stores ONLY a PBKDF2-SHA256 digest in the form
--      pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
--    Plaintext passwords are never written here. Rows are created by
--    scripts/create-admin.mjs, which hashes locally before the value ever
--    leaves the operator's machine.
--  * admin_sessions stores a SHA-256 hash of the session token, not the
--    token itself, so a database leak cannot be replayed as a live session.

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user
  ON admin_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions (expires_at);

-- Brute-force guard. One row per sign-in attempt; old rows can be pruned.
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash    TEXT NOT NULL,
  email      TEXT,
  success    INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time
  ON admin_login_attempts (ip_hash, created_at DESC);
