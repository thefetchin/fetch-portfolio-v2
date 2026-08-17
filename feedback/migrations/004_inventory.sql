-- Batch-tracked inventory: warehouse zones -> in transit -> Pod.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --local  --file=./migrations/004_inventory.sql
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/004_inventory.sql
--
-- This file is additive: it creates tables and adds columns. It does not drop,
-- rewrite or delete anything, so it is safe to apply to production with live
-- data in it.
--
-- APPLY IT ONCE. Every CREATE here is IF NOT EXISTS, but SQLite has no
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so a second run stops at the
-- first ALTER with "duplicate column name" and the statements after it never
-- execute. That is loud rather than dangerous -- nothing is corrupted -- but if
-- you need to re-apply a later section, run that section on its own.
--
-- Note also that IF NOT EXISTS means an EDITED trigger will not replace the one
-- already in the database. Drop it explicitly first.
--
-- ===========================================================================
-- Invariants this file enforces in the DATABASE, not the application
-- ===========================================================================
--
--  1. stock_movements is APPEND-ONLY. UPDATE and DELETE both abort. A
--     correction is a new compensating pair of rows, never an edit.
--
--  2. stock_balances is written ONLY by trg_sm_apply. No handler may touch it.
--     Because a trigger body runs inside the same transaction as the statement
--     that fired it, and env.DB.batch() is one transaction, the invariant
--     `balance = SUM(movements)` holds BY CONSTRUCTION rather than by every
--     future handler remembering to keep it so.
--
--     >>> Do not write a handler that INSERTs or UPDATEs stock_balances. <<<
--     The table exists so that a CHECK can make a negative balance
--     unrepresentable -- that is its whole justification, NOT read
--     performance. SUM() over the ledger would be free at this scale.
--
--  3. No real location can go negative. CHECK (qty_milli >= floor_milli),
--     where floor_milli is 0 for real locations and hugely negative for the
--     contra locations that form the other leg of a one-sided event. This is
--     the entire answer to "D1 has no interactive transactions": a losing
--     concurrent writer breaches the CHECK, which aborts the statement, which
--     rolls back the whole batch. Nothing is written and no compensation is
--     needed.
--
--  4. Expired stock CANNOT move toward a customer. A BEFORE INSERT trigger,
--     so the dashboard, the API, the Cron job and a hand-run
--     `wrangler d1 execute` all inherit it. Deliberately NOT blocked:
--     writeoff, purchase_return, transit_return -- expired stock must keep a
--     lawful exit or it is trapped in the warehouse forever.
--
--  5. Stock cannot be picked out of a non-pickable zone (receiving,
--     quarantine, staged, expired).
--
--  6. Every event is a balanced double entry: two legs, one ref_id, one batch,
--     summing to zero. So every batch sums to zero across ALL locations,
--     which is a whole-system integrity check rather than a per-transfer one.
--
-- Units: money is INTEGER PAISE, quantities are INTEGER THOUSANDTHS
-- (qty_milli), so 2.5 kg is 2500. No floating point anywhere.
--
-- Dates: timestamps are UTC (SQLite datetime('now')). BUSINESS DATES ARE IST
-- and use date('now', '+330 minutes'). The two are never compared.
--
-- Why that matters, precisely: IST is UTC+5:30, so between 00:00 and 05:30 IST
-- the UTC date is still yesterday. Comparing an expiry against date('now')
-- would then read `'2026-08-18' <= '2026-08-17'` as false for a batch that
-- expired at midnight IST -- leaving it dispatchable for five and a half hours
-- after it went out of date. Verified against SQLite:
--   date('2026-08-17 20:30:00')                  -> 2026-08-17  (UTC)
--   date('2026-08-17 20:30:00','+330 minutes')   -> 2026-08-18  (IST, correct)

PRAGMA foreign_keys = ON;

-- ==========================================================================
-- Auth: roles and session kinds
-- ==========================================================================
-- role defaults to 'admin' because every account that exists today belongs to
-- a human who runs the dashboard. No backfill is needed. Refillers and
-- inventory managers are created explicitly with scripts/create-admin.mjs.

-- ADD COLUMN does accept and enforce a CHECK (verified on SQLite 3.45), so the
-- role enum is guarded by the database and not only by the application.
ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'inventory_manager', 'refiller'));
ALTER TABLE admin_users ADD COLUMN display_name TEXT;

-- kind records how a session may be presented. verifySession requires the
-- stored kind to match, so a token lifted off a device cannot be replayed as
-- a dashboard cookie, and an intercepted cookie cannot become a long-lived
-- device credential.
ALTER TABLE admin_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web'
  CHECK (kind IN ('web', 'token'));
ALTER TABLE admin_sessions ADD COLUMN session_id TEXT;
ALTER TABLE admin_sessions ADD COLUMN device_label TEXT;
ALTER TABLE admin_sessions ADD COLUMN last_seen_at TEXT;

-- Give already-existing sessions a revocation handle.
UPDATE admin_sessions SET session_id = lower(hex(randomblob(8))) WHERE session_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_sessions_sid
  ON admin_sessions (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users (role);

-- ==========================================================================
-- Settings
-- ==========================================================================

CREATE TABLE IF NOT EXISTS inventory_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  min_shelf_life_days INTEGER NOT NULL DEFAULT 21 CHECK (min_shelf_life_days >= 0),
  near_expiry_days    INTEGER NOT NULL DEFAULT 30 CHECK (near_expiry_days >= 0),
  override_ttl_minutes INTEGER NOT NULL DEFAULT 30 CHECK (override_ttl_minutes > 0),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by          TEXT
);
INSERT OR IGNORE INTO inventory_settings (id) VALUES (1);

-- ==========================================================================
-- Masters
-- ==========================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  gstin       TEXT,
  state_code  TEXT,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_gstin
  ON suppliers (gstin) WHERE gstin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);

-- category mirrors PRODUCT_CATEGORIES in shared/constants.js, which the
-- feedback form already uses -- so "customers asked for more protein bars"
-- and "we stock these protein bars" line up without a mapping table.
CREATE TABLE IF NOT EXISTS products (
  product_id      TEXT PRIMARY KEY,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'chips', 'chocolate', 'cold_drink', 'water', 'coffee_tea',
                    'healthy', 'protein', 'ready_meal', 'other')),
  hsn             TEXT,
  uom             TEXT NOT NULL DEFAULT 'pcs' CHECK (uom IN (
                    'pcs','box','case','pack','kg','g','l','ml')),
  gst_bps         INTEGER NOT NULL DEFAULT 0
                    CHECK (gst_bps IN (0, 500, 1200, 1800, 2800)),
  mrp_paise       INTEGER CHECK (mrp_paise IS NULL OR mrp_paise > 0),
  shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days > 0),
  -- NULL falls back to inventory_settings.min_shelf_life_days.
  min_shelf_life_days INTEGER CHECK (min_shelf_life_days IS NULL OR min_shelf_life_days >= 0),
  barcode         TEXT,
  vlite_product_id INTEGER,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category, active);
CREATE INDEX IF NOT EXISTS idx_products_vlite
  ON products (vlite_product_id) WHERE vlite_product_id IS NOT NULL;

-- ==========================================================================
-- Locations
-- ==========================================================================
-- parent_location_id nests zones under the warehouse. Stock always sits in a
-- LEAF location; warehouse-on-hand is the sum over its children. Numbered
-- bins can be added later as children of MAIN with no migration.

CREATE TABLE IF NOT EXISTS locations (
  location_id        TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN (
                       'warehouse','zone','transit','pod','scrap',
                       'supplier','sold','adjust')),
  label              TEXT NOT NULL,
  parent_location_id TEXT REFERENCES locations(location_id) ON DELETE RESTRICT,
  pod_id             TEXT REFERENCES pods(pod_id) ON DELETE RESTRICT,
  -- Only pickable locations can supply a run.
  pickable           INTEGER NOT NULL DEFAULT 0 CHECK (pickable IN (0, 1)),
  -- Contra locations are the credit side of a one-sided event and MUST be
  -- allowed to go negative; real locations must not.
  allow_negative     INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0, 1)),
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'pod') = (pod_id IS NOT NULL)),
  CHECK (allow_negative = (CASE WHEN kind IN ('supplier','sold','adjust') THEN 1 ELSE 0 END))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_pod
  ON locations (pod_id) WHERE pod_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_kind   ON locations (kind, active);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations (parent_location_id);

INSERT OR IGNORE INTO locations
  (location_id, kind, label, parent_location_id, pickable, allow_negative) VALUES
  ('WH-MLR',         'warehouse', 'Mangalore warehouse',        NULL,     0, 0),
  ('WH-MLR/RECV',    'zone',      'Receiving',                  'WH-MLR', 0, 0),
  ('WH-MLR/MAIN',    'zone',      'Main storage',               'WH-MLR', 1, 0),
  ('WH-MLR/STAGE',   'zone',      'Staged for dispatch',        'WH-MLR', 0, 0),
  ('WH-MLR/QUAR',    'zone',      'Quarantine',                 'WH-MLR', 0, 0),
  ('WH-MLR/EXPIRED', 'zone',      'Expired, awaiting write-off','WH-MLR', 0, 0),
  ('SCRAP',          'scrap',     'Scrap / destroyed',          NULL,     0, 0),
  ('X-SUPP',         'supplier',  'Suppliers (contra)',         NULL,     0, 1),
  ('X-SOLD',         'sold',      'Sold to customers (contra)', NULL,     0, 1),
  ('X-ADJ',          'adjust',    'Stock adjustments (contra)', NULL,     0, 1);

-- Registering a Pod gives it a ledger location automatically, so no handler
-- can forget and nothing can post to a Pod that has no location.
CREATE TRIGGER IF NOT EXISTS trg_pods_mirror_location
AFTER INSERT ON pods
BEGIN
  INSERT OR IGNORE INTO locations
    (location_id, kind, label, pod_id, pickable, allow_negative)
  VALUES ('POD:' || NEW.pod_id, 'pod', NEW.label, NEW.pod_id, 0, 0);
END;

-- Pods registered before this migration need their location backfilled.
INSERT OR IGNORE INTO locations
  (location_id, kind, label, pod_id, pickable, allow_negative)
SELECT 'POD:' || p.pod_id, 'pod', p.label, p.pod_id, 0, 0 FROM pods p;

-- Link a Pod to its machine in the VLite cloud.
ALTER TABLE pods ADD COLUMN vlite_machine_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pods_vlite
  ON pods (vlite_machine_id) WHERE vlite_machine_id IS NOT NULL;

-- ==========================================================================
-- Purchase bills (inward) and batches
-- ==========================================================================
-- A bill line creates exactly one batch. This is the ONLY way stock enters
-- the warehouse, which is what makes the ledger reconcilable against the GST
-- filing.

CREATE TABLE IF NOT EXISTS purchase_bills (
  bill_id           TEXT PRIMARY KEY,
  grn_number        TEXT NOT NULL UNIQUE,      -- FETCH/GRN/2026-27/0001
  fy                TEXT NOT NULL,
  seq               INTEGER NOT NULL,
  supplier_id       TEXT NOT NULL REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
  supplier_bill_no  TEXT NOT NULL,
  bill_date         TEXT NOT NULL,             -- YYYY-MM-DD
  received_date     TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by        TEXT,

  is_interstate     INTEGER NOT NULL DEFAULT 0 CHECK (is_interstate IN (0, 1)),
  taxable_paise     INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  cgst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  freight_paise     INTEGER NOT NULL DEFAULT 0 CHECK (freight_paise >= 0),
  round_off_paise   INTEGER NOT NULL DEFAULT 0,
  total_paise       INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),

  -- 0 for a composition-scheme or unregistered supplier, or a blocked item:
  -- then GST is a cost of the goods rather than a receivable, and the
  -- inclusive unit cost is used for valuation.
  itc_eligible      INTEGER NOT NULL DEFAULT 1 CHECK (itc_eligible IN (0, 1)),
  status            TEXT NOT NULL DEFAULT 'posted'
                      CHECK (status IN ('posted', 'cancelled')),
  notes             TEXT
);
-- The most valuable constraint here for day-to-day sanity: one supplier bill
-- cannot be booked twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_supplier_billno
  ON purchase_bills (supplier_id, supplier_bill_no);
CREATE INDEX IF NOT EXISTS idx_pb_date   ON purchase_bills (bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_pb_status ON purchase_bills (status, created_at DESC);

CREATE TABLE IF NOT EXISTS batches (
  batch_id          TEXT PRIMARY KEY,
  batch_code        TEXT NOT NULL UNIQUE,      -- B2K7Q4, with a check char
  batch_seq         INTEGER NOT NULL,
  product_id        TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  supplier_id       TEXT REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
  bill_id           TEXT REFERENCES purchase_bills(bill_id) ON DELETE RESTRICT,
  supplier_batch_no TEXT,                      -- as printed on the pack
  mfg_date          TEXT,                      -- YYYY-MM-DD
  expiry_date       TEXT,                      -- YYYY-MM-DD, IST
  qty_received_milli INTEGER NOT NULL CHECK (qty_received_milli > 0),
  mrp_paise         INTEGER CHECK (mrp_paise IS NULL OR mrp_paise > 0),

  -- Valuation, specific identification. unit_cost_paise excludes GST
  -- (input credit is a receivable, not a cost); the incl variant is used when
  -- the bill is not ITC-eligible. Free goods dilute both: the denominator is
  -- qty + free_qty, so "buy 10 get 1 free" is 11 units at 10 units' cost.
  unit_cost_paise          INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  unit_cost_incl_gst_paise INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_incl_gst_paise >= 0),

  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'quarantined', 'closed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT,
  CHECK (expiry_date IS NULL OR mfg_date IS NULL OR expiry_date > mfg_date)
);
-- The FEFO index: pick order is product then expiry ascending.
CREATE INDEX IF NOT EXISTS idx_batches_product_expiry ON batches (product_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_expiry
  ON batches (expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_batches_bill ON batches (bill_id);

CREATE TABLE IF NOT EXISTS purchase_bill_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id        TEXT NOT NULL REFERENCES purchase_bills(bill_id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  product_id     TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  batch_id       TEXT REFERENCES batches(batch_id) ON DELETE RESTRICT,
  description    TEXT NOT NULL,
  hsn            TEXT,
  qty_milli      INTEGER NOT NULL CHECK (qty_milli > 0),
  free_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (free_qty_milli >= 0),
  uom            TEXT NOT NULL DEFAULT 'pcs',
  rate_paise     INTEGER NOT NULL CHECK (rate_paise >= 0),
  discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  gst_bps        INTEGER NOT NULL DEFAULT 0 CHECK (gst_bps >= 0 AND gst_bps <= 5000),
  taxable_paise  INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise     INTEGER NOT NULL DEFAULT 0,
  sgst_paise     INTEGER NOT NULL DEFAULT 0,
  igst_paise     INTEGER NOT NULL DEFAULT 0,
  total_paise    INTEGER NOT NULL CHECK (total_paise >= 0),
  -- Freight apportioned pro-rata to taxable value, residual on the largest
  -- line so the apportionment sums exactly to the header.
  landed_extra_paise INTEGER NOT NULL DEFAULT 0 CHECK (landed_extra_paise >= 0),
  mfg_date       TEXT,
  expiry_date    TEXT,
  supplier_batch_no TEXT,
  UNIQUE (bill_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_pbl_bill ON purchase_bill_lines (bill_id, line_no);

-- ==========================================================================
-- Shelf-life overrides
-- ==========================================================================
-- Tier 2 of the expiry gate is overridable, but only against a row that
-- records who and why. The 30-minute TTL stops an override becoming a
-- standing exemption everybody forgets about.

CREATE TABLE IF NOT EXISTS shelf_life_overrides (
  override_id   TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  days_at_grant INTEGER NOT NULL,
  min_at_grant  INTEGER NOT NULL,
  -- Length floor kills "ok" and "yes". Small, mean, effective.
  reason        TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  granted_by    TEXT NOT NULL,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_slo_batch   ON shelf_life_overrides (batch_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_slo_granted ON shelf_life_overrides (granted_at DESC);

-- ==========================================================================
-- The stock ledger
-- ==========================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
  movement_id  TEXT PRIMARY KEY,
  ref_id       TEXT NOT NULL,            -- shared by the two legs
  ref_type     TEXT NOT NULL CHECK (ref_type IN (
                 'purchase_bill','putaway','refill_run','stock_count',
                 'write_off','pull','transfer','reversal','opening','sale')),
  ref_row_id   TEXT,
  leg          TEXT NOT NULL CHECK (leg IN ('debit', 'credit')),

  location_id  TEXT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  batch_id     TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  product_id   TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,

  -- Signed: positive into this location, negative out of it.
  qty_milli    INTEGER NOT NULL CHECK (qty_milli <> 0),

  reason       TEXT NOT NULL CHECK (reason IN (
                 'purchase_in','purchase_return','putaway','pick','dispatch',
                 'refill','transit_return','pod_pull','consumed','count_short',
                 'count_over','writeoff','transfer','opening','reversal')),

  -- Frozen at movement time. A later cost correction must not retrospectively
  -- restate a period that has already been reported.
  unit_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  value_paise     INTEGER NOT NULL DEFAULT 0,

  override_id  TEXT REFERENCES shelf_life_overrides(override_id) ON DELETE RESTRICT,

  -- occurred_at is claimed (nullable, operational timeline only).
  -- recorded_at is the server's and is authoritative for every sum and every
  -- ordering. Client clocks are never trusted -- same rule as schema.sql.
  occurred_at  TEXT,
  recorded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  clock_skew_ms INTEGER,
  created_by   TEXT NOT NULL,
  notes        TEXT,
  dedupe_key   TEXT,

  CHECK (leg = (CASE WHEN qty_milli > 0 THEN 'debit' ELSE 'credit' END))
);

CREATE INDEX IF NOT EXISTS idx_sm_ref       ON stock_movements (ref_id);
CREATE INDEX IF NOT EXISTS idx_sm_loc_batch ON stock_movements (location_id, batch_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_sm_batch     ON stock_movements (batch_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_sm_recorded  ON stock_movements (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_reason    ON stock_movements (reason, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_refrow    ON stock_movements (ref_type, ref_row_id);
-- Booking the same sale twice is the failure mode a nightly re-pull invites.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sm_dedupe
  ON stock_movements (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Materialised balance. See invariant 2 above: this exists so the CHECK can
-- exist. It is NOT a read optimisation and NO handler may write it.
CREATE TABLE IF NOT EXISTS stock_balances (
  location_id TEXT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  batch_id    TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  qty_milli   INTEGER NOT NULL DEFAULT 0,
  floor_milli INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (location_id, batch_id),
  CHECK (qty_milli >= floor_milli)
);
CREATE INDEX IF NOT EXISTS idx_sb_batch ON stock_balances (batch_id);
CREATE INDEX IF NOT EXISTS idx_sb_nonzero
  ON stock_balances (location_id, qty_milli) WHERE qty_milli <> 0;

-- --- invariant 1: append-only ---------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_sm_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only: post a reversal instead');
END;

CREATE TRIGGER IF NOT EXISTS trg_sm_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only: post a reversal instead');
END;

-- --- invariant 4: expired stock cannot move toward a customer -------------
-- Mirrors EXPIRY_BLOCKED_REASONS in shared/constants.js.

CREATE TRIGGER IF NOT EXISTS trg_sm_block_expired
BEFORE INSERT ON stock_movements
WHEN NEW.qty_milli < 0 AND NEW.reason IN ('pick', 'dispatch', 'refill', 'transfer')
BEGIN
  SELECT RAISE(ABORT, 'expired_batch: expired stock cannot be picked, dispatched or loaded')
   WHERE EXISTS (
     SELECT 1 FROM batches b
      WHERE b.batch_id = NEW.batch_id
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date <= date('now', '+330 minutes')   -- today, IST
   );
END;

-- Tier 2: minimum shelf life, overridable against a live override row.
-- NEW.override_id being NULL never matches, which is the behaviour we want.
--
-- The `expiry_date > today` clause is load-bearing, not redundant. SQLite fires
-- BEFORE INSERT triggers in an UNSPECIFIED order, and an expired batch is also
-- short-dated, so without it this trigger can win the race and report
-- 'short_shelf_life' for stock that is actually expired. That matters because
-- Tier 2 is overridable and Tier 1 is not: a manager would be invited to grant
-- an override that can never let the movement through. Keeping the two
-- conditions mutually exclusive means each case reports its own code whichever
-- trigger fires first.
CREATE TRIGGER IF NOT EXISTS trg_sm_min_shelf_life
BEFORE INSERT ON stock_movements
WHEN NEW.qty_milli < 0 AND NEW.reason IN ('pick', 'dispatch', 'refill')
BEGIN
  SELECT RAISE(ABORT, 'short_shelf_life: below the minimum shelf life for dispatch')
   WHERE EXISTS (
     SELECT 1
       FROM batches b
       JOIN products p ON p.product_id = b.product_id
       JOIN inventory_settings s ON s.id = 1
      WHERE b.batch_id = NEW.batch_id
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date > date('now', '+330 minutes')     -- not yet expired
        AND julianday(b.expiry_date) - julianday(date('now', '+330 minutes'))
            < COALESCE(p.min_shelf_life_days, s.min_shelf_life_days)
   )
   AND NOT EXISTS (
     SELECT 1 FROM shelf_life_overrides o
      WHERE o.override_id = NEW.override_id
        AND o.batch_id    = NEW.batch_id
        AND o.revoked_at  IS NULL
        AND o.expires_at  > datetime('now')
   );
END;

-- A quarantined batch cannot be picked. This is what a recall needs.
CREATE TRIGGER IF NOT EXISTS trg_sm_block_quarantine
BEFORE INSERT ON stock_movements
WHEN NEW.qty_milli < 0 AND NEW.reason IN ('pick', 'dispatch', 'refill')
BEGIN
  SELECT RAISE(ABORT, 'batch_not_active: this batch is quarantined or closed')
   WHERE EXISTS (
     SELECT 1 FROM batches b
      WHERE b.batch_id = NEW.batch_id AND b.status <> 'active'
   );
END;

-- --- invariant 5: only pickable zones can supply a run --------------------

CREATE TRIGGER IF NOT EXISTS trg_sm_block_unpickable
BEFORE INSERT ON stock_movements
WHEN NEW.qty_milli < 0 AND NEW.reason = 'pick'
BEGIN
  SELECT RAISE(ABORT, 'not_pickable: stock cannot be picked out of this location')
   WHERE EXISTS (
     SELECT 1 FROM locations l
      WHERE l.location_id = NEW.location_id AND l.pickable = 0
   );
END;

-- --- invariant 2 + 3: the balance is DERIVED ------------------------------
-- The only writer of stock_balances. floor_milli comes from the location, so
-- real locations are floored at zero and contras are effectively unbounded.

CREATE TRIGGER IF NOT EXISTS trg_sm_apply
AFTER INSERT ON stock_movements
BEGIN
  INSERT INTO stock_balances (location_id, batch_id, qty_milli, floor_milli)
  SELECT NEW.location_id, NEW.batch_id, 0,
         CASE WHEN l.allow_negative = 1 THEN -1000000000000 ELSE 0 END
    FROM locations l
   WHERE l.location_id = NEW.location_id
      ON CONFLICT (location_id, batch_id) DO NOTHING;

  UPDATE stock_balances
     SET qty_milli  = qty_milli + NEW.qty_milli,
         updated_at = datetime('now')
   WHERE location_id = NEW.location_id
     AND batch_id    = NEW.batch_id;
END;

-- ==========================================================================
-- Refill plans and runs (outward)
-- ==========================================================================
-- refill_plan_lines carry the batch -> slot decision, made in the warehouse
-- at picking time by someone who can see the batch. That decision IS the
-- record: nothing downstream re-derives it, and no refiller scans anything.

CREATE TABLE IF NOT EXISTS refill_runs (
  run_id        TEXT PRIMARY KEY,
  run_number    TEXT NOT NULL UNIQUE,       -- FETCH/RUN/2026-27/0001
  fy            TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  run_date      TEXT NOT NULL,              -- YYYY-MM-DD, IST
  transit_location_id TEXT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  assigned_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                  'planned','picked','dispatched','reconciled','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT NOT NULL,
  picked_at     TEXT,
  dispatched_at TEXT,
  reconciled_at TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON refill_runs (status, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_runs_date   ON refill_runs (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_runs_user   ON refill_runs (assigned_user_id, run_date DESC);

CREATE TABLE IF NOT EXISTS refill_run_stops (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES refill_runs(run_id) ON DELETE CASCADE,
  pod_id   TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE RESTRICT,
  seq      INTEGER NOT NULL,
  state    TEXT NOT NULL DEFAULT 'pending'
             CHECK (state IN ('pending','reconciled','skipped')),
  skip_reason TEXT,
  reconciled_at TEXT,
  UNIQUE (run_id, pod_id)
);
CREATE INDEX IF NOT EXISTS idx_stops_run ON refill_run_stops (run_id, seq);

CREATE TABLE IF NOT EXISTS refill_plan_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES refill_runs(run_id) ON DELETE CASCADE,
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE RESTRICT,
  slot_name     TEXT NOT NULL,
  vlite_slot_id INTEGER,
  batch_id      TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  product_id    TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  -- The bag number printed on the run sheet. One batch per bag: that rule is
  -- what lets a refiller load the right batch without reading a code.
  bag_no        INTEGER NOT NULL,
  planned_milli INTEGER NOT NULL CHECK (planned_milli > 0),
  loaded_milli  INTEGER CHECK (loaded_milli IS NULL OR loaded_milli >= 0),
  UNIQUE (run_id, pod_id, slot_name, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_run ON refill_plan_lines (run_id, pod_id, bag_no);

-- ==========================================================================
-- Pod slots and layers
-- ==========================================================================
-- A coil dispenses from the FRONT, so topping up stacks a new batch behind
-- the old one. seq ascending is dispense order. The FRONT layer's expiry is
-- what a customer actually gets, and is what Gate 3 tests.
--
-- This table, not VLite, is what says which batch is in a slot.

CREATE TABLE IF NOT EXISTS pod_slots (
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE CASCADE,
  vlite_slot_id INTEGER NOT NULL,
  slot_name     TEXT NOT NULL,
  row_number    INTEGER,
  column_number INTEGER,
  vlite_product_id INTEGER,
  product_id    TEXT REFERENCES products(product_id) ON DELETE SET NULL,
  stock_limit   INTEGER,
  enable        INTEGER NOT NULL DEFAULT 1 CHECK (enable IN (0, 1)),
  disabled_reason TEXT,
  -- Set when we have decided a slot's state but not yet pushed it to VLite.
  push_pending  INTEGER NOT NULL DEFAULT 0 CHECK (push_pending IN (0, 1)),
  synced_at     TEXT,
  PRIMARY KEY (pod_id, vlite_slot_id)
);
CREATE INDEX IF NOT EXISTS idx_slots_pod     ON pod_slots (pod_id, slot_name);
CREATE INDEX IF NOT EXISTS idx_slots_pending  ON pod_slots (push_pending) WHERE push_pending = 1;

CREATE TABLE IF NOT EXISTS pod_slot_layers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE CASCADE,
  vlite_slot_id INTEGER NOT NULL,
  seq           INTEGER NOT NULL,             -- 1 = front = sells first
  batch_id      TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  product_id    TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli >= 0),
  -- 'planned' = we know the batch from the pick; 'fefo_inferred' = the map was
  -- rebuilt from the machine and the batch was inferred. Reports must show
  -- the difference, and a recall must treat inferred as "possibly here".
  attribution   TEXT NOT NULL DEFAULT 'planned'
                  CHECK (attribution IN ('planned', 'fefo_inferred')),
  loaded_at     TEXT NOT NULL DEFAULT (datetime('now')),
  loaded_by     TEXT,
  UNIQUE (pod_id, vlite_slot_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_layers_slot  ON pod_slot_layers (pod_id, vlite_slot_id, seq);
CREATE INDEX IF NOT EXISTS idx_layers_batch ON pod_slot_layers (batch_id);

-- Arrangement changes inside a Pod. Deliberately NOT ledger movements: both
-- slots are inside the same POD-<id> location, so relocating stock changes no
-- balance. Modelling it as a transfer would create two cancelling movements,
-- cluttering the ledger with non-events and breaking the two-legs-per-ref_id
-- invariant.
CREATE TABLE IF NOT EXISTS slot_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE CASCADE,
  vlite_slot_id INTEGER,
  to_slot_id    INTEGER,
  event         TEXT NOT NULL CHECK (event IN (
                  'load','pull','relocate','remap','disable','enable')),
  batch_id      TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  qty_milli     INTEGER,
  reason        TEXT,
  actor         TEXT NOT NULL,
  vlite_pushed  INTEGER NOT NULL DEFAULT 0 CHECK (vlite_pushed IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slot_events_pod ON slot_events (pod_id, created_at DESC);

-- ==========================================================================
-- Pull tasks — the only thing refillers receive from us
-- ==========================================================================
-- return_zone is the point: the refiller brings back one bag and the reason
-- decides where it goes, so expired stock can never re-enter pickable storage
-- and nobody in the field has to know the policy.

CREATE TABLE IF NOT EXISTS pull_tasks (
  pull_id       TEXT PRIMARY KEY,
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE RESTRICT,
  vlite_slot_id INTEGER,
  slot_name     TEXT,
  batch_id      TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  product_id    TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  reason        TEXT NOT NULL CHECK (reason IN (
                  'expired','near_expiry','recall','damaged',
                  'planogram_change','slow_moving')),
  return_zone   TEXT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','assigned','done','cancelled')),
  run_id        TEXT REFERENCES refill_runs(run_id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT NOT NULL,
  done_at       TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_pulls_pod    ON pull_tasks (pod_id, status);
CREATE INDEX IF NOT EXISTS idx_pulls_status ON pull_tasks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulls_run    ON pull_tasks (run_id);

-- ==========================================================================
-- Counts and write-offs
-- ==========================================================================

CREATE TABLE IF NOT EXISTS stock_counts (
  count_id    TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('audit', 'readback')),
  run_id      TEXT REFERENCES refill_runs(run_id) ON DELETE SET NULL,
  counted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  counted_by  TEXT NOT NULL,
  flagged     INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1)),
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_counts_location ON stock_counts (location_id, counted_at DESC);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id       TEXT NOT NULL REFERENCES stock_counts(count_id) ON DELETE CASCADE,
  batch_id       TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  product_id     TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  expected_milli INTEGER NOT NULL,
  counted_milli  INTEGER NOT NULL CHECK (counted_milli >= 0),
  variance_milli INTEGER NOT NULL,
  attribution    TEXT NOT NULL DEFAULT 'planned'
                   CHECK (attribution IN ('planned', 'fefo_inferred'))
);
CREATE INDEX IF NOT EXISTS idx_scl_count ON stock_count_lines (count_id);

CREATE TABLE IF NOT EXISTS write_offs (
  writeoff_id   TEXT PRIMARY KEY,
  wo_number     TEXT NOT NULL UNIQUE,       -- FETCH/WO/2026-27/0001
  fy            TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  location_id   TEXT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  batch_id      TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE RESTRICT,
  product_id    TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  reason        TEXT NOT NULL CHECK (reason IN (
                  'expired','damaged','theft','recall','sample','other')),
  value_paise   INTEGER NOT NULL DEFAULT 0 CHECK (value_paise >= 0),
  -- Set when a manager flags this as a supplier's fault. An admin turns it
  -- into a debit note; managers cannot issue GST-facing documents.
  supplier_claim INTEGER NOT NULL DEFAULT 0 CHECK (supplier_claim IN (0, 1)),
  debit_note_id TEXT REFERENCES debit_notes(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT NOT NULL,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_wo_created ON write_offs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_batch   ON write_offs (batch_id);
CREATE INDEX IF NOT EXISTS idx_wo_claim
  ON write_offs (supplier_claim, debit_note_id) WHERE supplier_claim = 1;

-- Point existing debit notes at a supplier master without disturbing their
-- denormalised snapshot: an issued document must never change because master
-- data did.
ALTER TABLE debit_notes ADD COLUMN supplier_id TEXT REFERENCES suppliers(supplier_id);

-- ==========================================================================
-- Machine readback: sales and drift
-- ==========================================================================
-- We resolve a sale to a batch from OUR front layer, never from VLite's
-- stockId or expiresAt. One expiry date, one owner.

CREATE TABLE IF NOT EXISTS vlite_sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key     TEXT NOT NULL UNIQUE,      -- vlite:<trxId>:<cartLineId>
  vlite_machine_id INTEGER NOT NULL,
  pod_id         TEXT REFERENCES pods(pod_id) ON DELETE SET NULL,
  trx_id         TEXT NOT NULL,
  slot_name      TEXT,
  vlite_product_id INTEGER,
  product_id     TEXT REFERENCES products(product_id) ON DELETE SET NULL,
  batch_id       TEXT REFERENCES batches(batch_id) ON DELETE SET NULL,
  qty_milli      INTEGER NOT NULL,
  amount_paise   INTEGER NOT NULL DEFAULT 0,
  sold_at        TEXT NOT NULL,
  booked         INTEGER NOT NULL DEFAULT 0 CHECK (booked IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_machine ON vlite_sales (vlite_machine_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_booked  ON vlite_sales (booked) WHERE booked = 0;

-- Watermark per machine so a nightly pull knows where to resume.
CREATE TABLE IF NOT EXISTS vlite_sync_state (
  vlite_machine_id INTEGER PRIMARY KEY,
  last_txn_at      TEXT,
  last_slot_sync_at TEXT,
  last_error       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slot_drift (
  drift_id      TEXT PRIMARY KEY,
  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE CASCADE,
  vlite_slot_id INTEGER NOT NULL,
  slot_name     TEXT,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'qty_low','qty_high','product_changed','relocated','missing')),
  expected_milli INTEGER,
  actual_milli   INTEGER,
  expected_product_id TEXT REFERENCES products(product_id) ON DELETE SET NULL,
  actual_vlite_product_id INTEGER,
  suggestion    TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved','ignored')),
  detected_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT,
  resolved_by   TEXT,
  resolution    TEXT
);
CREATE INDEX IF NOT EXISTS idx_drift_status ON slot_drift (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_drift_pod    ON slot_drift (pod_id, status);

-- ==========================================================================
-- Idempotency
-- ==========================================================================
-- Every write here is an append-only stock movement, so a duplicate is not a
-- cosmetic annoyance -- it is phantom stock.
--
--  * key_hash is sha256(user_id + ':' + key): scoped per user, and the raw
--    key is never stored.
--  * request_hash catches a client reusing one key for a different body,
--    which is a client bug worth surfacing rather than papering over.
--  * The response is stored verbatim so a replay is byte-identical to the
--    original, including the IDs the caller needs.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash      TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'in_flight'
                  CHECK (state IN ('in_flight', 'done')),
  status        INTEGER,
  response_json TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_keys (created_at);
