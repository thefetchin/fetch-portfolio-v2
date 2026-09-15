-- Bulk uploads to vNetra: what we generated, and what actually landed.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/008_vnetra_exports.sql
--
-- The point of this file is that the NEXT export leaves out what the last one
-- added. Two ways a product comes to be known as "vNetra has it":
--
--   capture      we read it off vNetra's own product list  (observed)
--   bulk_upload  we generated it and someone confirmed the upload worked
--                                                          (asserted)
--
-- Both live in vnetra_products so there is one exclusion list, and origin says
-- which kind of knowledge it is -- observed beats asserted if they ever
-- disagree, because one of them was actually seen.
--
-- An export is NOT marked added when it is generated. It sits pending until
-- someone confirms the upload worked. Marking at generation time would mean a
-- rejected CSV silently excluded those products from every future export, and
-- they would never be uploaded at all -- the failure would be invisible and
-- permanent, which is the worst shape a bug can have.

PRAGMA foreign_keys = ON;

-- Where a row's knowledge came from. Existing rows were all captures.
ALTER TABLE vnetra_products ADD COLUMN origin TEXT NOT NULL DEFAULT 'capture'
  CHECK (origin IN ('capture', 'bulk_upload'));

CREATE TABLE IF NOT EXISTS vnetra_exports (
  export_id     TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'discarded')),
  product_count INTEGER NOT NULL CHECK (product_count >= 0),
  image_count   INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at    TEXT,
  note          TEXT,

  -- A settled export must say when. Enforced here rather than in a handler so
  -- a hand-run UPDATE cannot leave a confirmed export with no date on it.
  CHECK ((status = 'pending') = (settled_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_vnetra_exports_status
  ON vnetra_exports (status, created_at DESC);

-- The products that were in one generated file.
CREATE TABLE IF NOT EXISTS vnetra_export_lines (
  export_id TEXT NOT NULL REFERENCES vnetra_exports(export_id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  name      TEXT,
  has_image INTEGER NOT NULL DEFAULT 0 CHECK (has_image IN (0, 1)),
  PRIMARY KEY (export_id, code)
);

CREATE INDEX IF NOT EXISTS idx_vnetra_export_lines_code
  ON vnetra_export_lines (code);
