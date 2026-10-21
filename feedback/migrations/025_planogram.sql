-- Planograms: what each slot in a machine is meant to hold.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/025_planogram.sql
--
-- pod_slots already records what a machine HAS -- it is synced from VLite and
-- reflects reality. This records what it SHOULD have, which is a different
-- thing and must not overwrite the first: a refiller comparing the two is the
-- entire point.
--
-- Each slot carries an ordered list of products rather than one. A refiller
-- standing at a machine with no Lay's cannot phone anyone, so the sheet tells
-- them what to put there instead, in the order we would choose.

PRAGMA foreign_keys = ON;

-- Product artwork, as VLite stores it. A full URL, so nothing downstream has
-- to know where VLite keeps its images.
ALTER TABLE products ADD COLUMN image_url TEXT;

-- One row per slot in the plan. Rows and columns come from the machine, but
-- are stored rather than read live: a planogram is printed and taken to a
-- machine, and it must not change under someone because VLite was edited an
-- hour ago.
CREATE TABLE IF NOT EXISTS planogram_slots (
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE CASCADE,
  slot_name     TEXT NOT NULL,
  row_number    INTEGER,
  column_number INTEGER,
  -- How many units fit. Printed on the sheet so a refiller knows when a slot
  -- is full without counting the last one in.
  capacity      INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  note          TEXT,
  PRIMARY KEY (pod_id, slot_name)
);
CREATE INDEX IF NOT EXISTS idx_plano_slots_grid
  ON planogram_slots (pod_id, row_number, column_number);

-- The ordered choices for a slot. rank 1 is what we want there; 2 is what to
-- use when 1 is not on the van; and so on.
CREATE TABLE IF NOT EXISTS planogram_choices (
  pod_id      TEXT NOT NULL,
  slot_name   TEXT NOT NULL,
  rank        INTEGER NOT NULL CHECK (rank >= 1),
  product_id  TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  PRIMARY KEY (pod_id, slot_name, rank),
  FOREIGN KEY (pod_id, slot_name)
    REFERENCES planogram_slots (pod_id, slot_name) ON DELETE CASCADE,
  -- The same product twice in one slot is a mistake every time: the second
  -- entry can never be reached, because the first would have been taken.
  UNIQUE (pod_id, slot_name, product_id)
);
CREATE INDEX IF NOT EXISTS idx_plano_choices_slot
  ON planogram_choices (pod_id, slot_name, rank);
CREATE INDEX IF NOT EXISTS idx_plano_choices_product
  ON planogram_choices (product_id);
