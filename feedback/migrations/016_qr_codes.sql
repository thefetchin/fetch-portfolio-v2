-- A general-purpose QR generator, with scan counts for the ones we track.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/016_qr_codes.sql
--
-- Distinct from the Pod QRs in `pods`. Those are signed, tied to a machine, and
-- point at the feedback form; these are for posters, flyers, table tents and
-- anything else, and encode whatever they are given.
--
-- TRACKING IS OPT-IN AND ONLY MEANS ANYTHING FOR LINKS. A tracked QR encodes a
-- short URL of ours that counts the scan and then redirects, so the printed
-- code is bound to us forever -- which is the point: the destination can change
-- after the poster is printed. An untracked QR encodes the target directly,
-- scans nothing, and keeps working if this service ever goes away. That
-- trade-off is real, so it is a choice rather than a default.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS qr_codes (
  code        TEXT PRIMARY KEY,           -- the short code in /q/<code>
  label       TEXT NOT NULL,              -- what it is for, in our words

  kind        TEXT NOT NULL CHECK (kind IN ('link', 'text', 'wifi')),

  -- What the QR resolves to. For a tracked link this is where we redirect;
  -- for everything else it is encoded directly.
  content     TEXT NOT NULL,

  tracked     INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1)),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT,

  -- Only a link can be tracked: there is nothing to redirect to otherwise, and
  -- a "tracked" text QR would quietly count nothing.
  CHECK (tracked = 0 OR kind = 'link')
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_created ON qr_codes (created_at DESC);

-- One row per scan.
--
-- No raw IP, same as submissions: hashed with the server secret, which gives
-- unique-scanner counts without keeping a record of who stood in front of a
-- poster.
CREATE TABLE IF NOT EXISTS qr_scans (
  scan_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL REFERENCES qr_codes(code) ON DELETE CASCADE,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash    TEXT,
  country    TEXT,
  user_agent TEXT,
  referer    TEXT
);

CREATE INDEX IF NOT EXISTS idx_qr_scans_code ON qr_scans (code, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_scans_when ON qr_scans (scanned_at DESC);
