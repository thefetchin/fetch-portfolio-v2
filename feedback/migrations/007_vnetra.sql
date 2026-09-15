-- vNetra's product catalogue, mirrored so it can be compared with VLite's.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/007_vnetra.sql
--
-- Why a mirror rather than a live read: vNetra is a Firebase app belonging to
-- Vendekin, not to us. We hold a COPY of what it had at a known moment, stamped
-- with when we saw it, so a comparison can say "as of 14:05 today" instead of
-- implying a live agreement between two systems we do not jointly control.
--
-- Products are matched on CODE (AT1XXX#######), which both systems carry and
-- which is identical in each. That makes matching exact -- no fuzzy name
-- comparison, and therefore no chance of confidently pairing two different
-- products because their names were similar.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vnetra_products (
  code          TEXT PRIMARY KEY,      -- AT1CAD0021943, the join key
  name          TEXT,
  has_image     INTEGER NOT NULL DEFAULT 0 CHECK (has_image IN (0, 1)),

  -- vNetra's own document id, when the source can supply one. Reading the
  -- product list off the rendered page cannot, so this stays nullable rather
  -- than being faked.
  vnetra_doc_id TEXT,

  -- Whatever else the source sent, kept verbatim as JSON. Fields we do not
  -- model today are not lost, and nothing has to be re-fetched to add one.
  raw_json      TEXT,

  -- When this row was last confirmed present in vNetra. A snapshot is only
  -- meaningful with its timestamp.
  seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vnetra_products_seen ON vnetra_products (seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_vnetra_products_name ON vnetra_products (name);

-- One row per snapshot, so "when did we last compare, and against what" is
-- answerable, and a half-finished upload is distinguishable from a real
-- catalogue that shrank.
CREATE TABLE IF NOT EXISTS vnetra_snapshots (
  snapshot_id  TEXT PRIMARY KEY,
  source       TEXT NOT NULL CHECK (source IN ('browser_bridge', 'api')),
  product_count INTEGER NOT NULL CHECK (product_count >= 0),
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vnetra_snapshots_created
  ON vnetra_snapshots (created_at DESC);
