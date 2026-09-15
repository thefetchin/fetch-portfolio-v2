-- Fixture for the ledger invariant tests. Local DB only.
PRAGMA foreign_keys = ON;

DELETE FROM stock_balances;
DELETE FROM pod_slot_layers;
DELETE FROM pod_slots;

-- Upsert, never "INSERT OR REPLACE", on anything with children.
--
-- REPLACE is a DELETE followed by an INSERT. batches reference both of these
-- rows, so on the second run the DELETE trips a foreign key and the whole
-- seed aborts at this line -- leaving the suite to run against the previous
-- run's fixtures. It worked exactly once, on an empty database.
INSERT INTO suppliers (supplier_id, name, gstin, state_code, active)
VALUES ('sup_t1', 'Test Distributors', '29AAAAA0000A1Z5', '29', 1)
ON CONFLICT(supplier_id) DO UPDATE SET
  name = excluded.name, gstin = excluded.gstin,
  state_code = excluded.state_code, active = excluded.active;

INSERT INTO products
  (product_id, sku, name, category, uom, gst_bps, mrp_paise, shelf_life_days, active)
VALUES ('prd_t1', 'TEST-LAY-52', 'Test Lays 52g', 'chips', 'pcs', 1200, 2000, 120, 1)
ON CONFLICT(product_id) DO UPDATE SET
  sku = excluded.sku, name = excluded.name, category = excluded.category,
  uom = excluded.uom, gst_bps = excluded.gst_bps, mrp_paise = excluded.mrp_paise,
  shelf_life_days = excluded.shelf_life_days, active = excluded.active;

-- NOT "INSERT OR REPLACE": REPLACE deletes the row first, and
-- locations.pod_id is ON DELETE RESTRICT, so a Pod that already has a ledger
-- location cannot be deleted. That restriction is deliberate -- you must not be
-- able to delete a machine that has stock history -- so the seed works with it.
INSERT INTO pods (pod_id, label, location, city, active)
VALUES ('TESTPOD', 'Test Pod', 'Test site', 'Mangalore', 1)
ON CONFLICT(pod_id) DO NOTHING;

-- Expiry dates are RELATIVE to today, not written out.
--
-- They used to be absolute, and the suite duly started failing on its own
-- three weeks after it was written: the "short-dated" batch aged past its
-- expiry date and the trigger correctly reported expired_batch where the test
-- expected short_shelf_life. A fixture for a date-sensitive rule has to move
-- with the calendar. +330 minutes is the IST offset the triggers themselves
-- use, so the fixture and the rule agree about what day it is.

-- good: expires well beyond the 21-day minimum
INSERT INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_good', 'BGOOD1', 1, 'prd_t1', 'sup_t1', date('now','+330 minutes','+290 days'), 240000, 1420, 'active')
ON CONFLICT(batch_id) DO UPDATE SET
  batch_code = excluded.batch_code, batch_seq = excluded.batch_seq,
  product_id = excluded.product_id, supplier_id = excluded.supplier_id,
  expiry_date = excluded.expiry_date,
  qty_received_milli = excluded.qty_received_milli,
  unit_cost_paise = excluded.unit_cost_paise, status = excluded.status;

-- expired: Tier 1 must refuse this outright
INSERT INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_exp', 'BEXP01', 2, 'prd_t1', 'sup_t1', date('now','+330 minutes','-45 days'), 100000, 1420, 'active')
ON CONFLICT(batch_id) DO UPDATE SET
  batch_code = excluded.batch_code, batch_seq = excluded.batch_seq,
  product_id = excluded.product_id, supplier_id = excluded.supplier_id,
  expiry_date = excluded.expiry_date,
  qty_received_milli = excluded.qty_received_milli,
  unit_cost_paise = excluded.unit_cost_paise, status = excluded.status;

-- short-dated: 8 days left, under the 21-day minimum -> Tier 2
INSERT INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_short', 'BSHRT1', 3, 'prd_t1', 'sup_t1', date('now','+330 minutes','+8 days'), 50000, 1420, 'active')
ON CONFLICT(batch_id) DO UPDATE SET
  batch_code = excluded.batch_code, batch_seq = excluded.batch_seq,
  product_id = excluded.product_id, supplier_id = excluded.supplier_id,
  expiry_date = excluded.expiry_date,
  qty_received_milli = excluded.qty_received_milli,
  unit_cost_paise = excluded.unit_cost_paise, status = excluded.status;

-- quarantined: a recall must be unpickable
INSERT INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_quar', 'BQUAR1', 4, 'prd_t1', 'sup_t1', date('now','+330 minutes','+290 days'), 60000, 1420, 'quarantined')
ON CONFLICT(batch_id) DO UPDATE SET
  batch_code = excluded.batch_code, batch_seq = excluded.batch_seq,
  product_id = excluded.product_id, supplier_id = excluded.supplier_id,
  expiry_date = excluded.expiry_date,
  qty_received_milli = excluded.qty_received_milli,
  unit_cost_paise = excluded.unit_cost_paise, status = excluded.status;
