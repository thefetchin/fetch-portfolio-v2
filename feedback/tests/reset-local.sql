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
