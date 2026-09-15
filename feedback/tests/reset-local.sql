-- Test-only reset of the LOCAL ledger.
--
-- stock_movements is append-only by design, so wiping it means lifting the
-- guards and putting them straight back. This exists solely so the invariant
-- suite can run from a known state; it must never be run against production.

DROP TRIGGER IF EXISTS trg_sm_no_update;
DROP TRIGGER IF EXISTS trg_sm_no_delete;

DELETE FROM stock_movements;
DELETE FROM stock_balances;
DELETE FROM pod_slot_layers;
DELETE FROM pod_slots;
DELETE FROM slot_events;
DELETE FROM pull_tasks;
DELETE FROM shelf_life_overrides;

-- Run planning, cleared in child-before-parent order.
--
-- These were missed originally, and the omission only shows up when the
-- outward suite has run first: its plan lines still reference the seed
-- batches, so seed-local.sql's INSERT OR REPLACE (a DELETE and an INSERT)
-- trips a foreign key, the seed aborts halfway, and the invariant suite then
-- runs against whatever the previous run left behind.
DELETE FROM refill_plan_lines;
DELETE FROM refill_run_stops;
DELETE FROM refill_runs;

CREATE TRIGGER trg_sm_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only: post a reversal instead');
END;

CREATE TRIGGER trg_sm_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only: post a reversal instead');
END;
