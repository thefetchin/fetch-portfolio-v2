-- Fixture for the ledger invariant tests. Local DB only.
PRAGMA foreign_keys = ON;

DELETE FROM stock_balances;
DELETE FROM pod_slot_layers;
DELETE FROM pod_slots;

INSERT OR REPLACE INTO suppliers (supplier_id, name, gstin, state_code, active)
VALUES ('sup_t1', 'Test Distributors', '29AAAAA0000A1Z5', '29', 1);

INSERT OR REPLACE INTO products
  (product_id, sku, name, category, uom, gst_bps, mrp_paise, shelf_life_days, active)
VALUES ('prd_t1', 'TEST-LAY-52', 'Test Lays 52g', 'chips', 'pcs', 1200, 2000, 120, 1);

-- NOT "INSERT OR REPLACE": REPLACE deletes the row first, and
-- locations.pod_id is ON DELETE RESTRICT, so a Pod that already has a ledger
-- location cannot be deleted. That restriction is deliberate -- you must not be
-- able to delete a machine that has stock history -- so the seed works with it.
INSERT INTO pods (pod_id, label, location, city, active)
VALUES ('TESTPOD', 'Test Pod', 'Test site', 'Mangalore', 1)
ON CONFLICT(pod_id) DO NOTHING;

-- good: expires well beyond the 21-day minimum
INSERT OR REPLACE INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_good', 'BGOOD1', 1, 'prd_t1', 'sup_t1', '2027-06-30', 240000, 1420, 'active');

-- expired: Tier 1 must refuse this outright
INSERT OR REPLACE INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_exp', 'BEXP01', 2, 'prd_t1', 'sup_t1', '2026-08-01', 100000, 1420, 'active');

-- short-dated: 8 days left, under the 21-day minimum -> Tier 2
INSERT OR REPLACE INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_short', 'BSHRT1', 3, 'prd_t1', 'sup_t1', '2026-08-25', 50000, 1420, 'active');

-- quarantined: a recall must be unpickable
INSERT OR REPLACE INTO batches
  (batch_id, batch_code, batch_seq, product_id, supplier_id, expiry_date,
   qty_received_milli, unit_cost_paise, status)
VALUES ('btc_quar', 'BQUAR1', 4, 'prd_t1', 'sup_t1', '2027-06-30', 60000, 1420, 'quarantined');
