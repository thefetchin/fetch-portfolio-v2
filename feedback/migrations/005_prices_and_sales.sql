-- Supplier price lists, and sales pulled from VLite so margin can be computed.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --local  --file=./migrations/005_prices_and_sales.sql
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/005_prices_and_sales.sql
--
-- Additive. Apply once: the ALTERs have no IF NOT EXISTS, so a second run stops
-- at the first one (loud, not dangerous).
--
-- ===========================================================================
-- How margin is computed, and why
-- ===========================================================================
--
-- Both sides are NET OF GST:
--
--   revenue  = the transaction line's taxableAmount, not what the customer paid.
--              The GST collected is payable to the government, so counting it as
--              revenue would overstate every margin by the tax rate.
--   cost     = batches.unit_cost_paise, which already excludes GST because input
--              tax credit is a receivable rather than a cost of the goods.
--
-- Mixing the two conventions is the classic way to report a margin that looks
-- fine and is wrong by 12-28%, so both are stored explicitly rather than
-- derived at read time from whatever field was handy.
--
-- cost_source records WHICH cost was available, because they are not equally
-- trustworthy and a report that hides the difference is worse than one that
-- admits it:
--
--   batch         the exact batch that was in the slot. Only possible once slot
--                 layers are populated; this is the one to aim for.
--   latest_batch  the most recent batch of that product. Good enough while a
--                 product's cost is stable, wrong after a price rise.
--   supplier_price the agreed list price. A quote, not a paid cost.
--   unknown       no cost at all. margin_paise stays NULL rather than being
--                 reported as equal to revenue.

PRAGMA foreign_keys = ON;

-- ==========================================================================
-- Supplier price lists
-- ==========================================================================
-- What a supplier says they will charge, as opposed to what a bill actually
-- charged. Two uses: defaulting the rate at goods-in so it does not have to be
-- retyped, and giving a fallback cost for margin on stock that arrived before
-- batch-level tracking existed.
--
-- Dated rather than overwritten, so a price rise does not silently restate the
-- margin on everything sold last month.

CREATE TABLE IF NOT EXISTS supplier_prices (
  price_id       TEXT PRIMARY KEY,
  supplier_id    TEXT NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  -- Excluding GST, to match batches.unit_cost_paise and the margin convention.
  price_paise    INTEGER NOT NULL CHECK (price_paise >= 0),
  gst_bps        INTEGER NOT NULL DEFAULT 0 CHECK (gst_bps >= 0 AND gst_bps <= 5000),
  -- Case/carton size the price is quoted for, in thousandths. A price quoted
  -- per case has to be divisible by something to become a unit cost.
  pack_milli     INTEGER NOT NULL DEFAULT 1000 CHECK (pack_milli > 0),
  moq_milli      INTEGER CHECK (moq_milli IS NULL OR moq_milli > 0),
  effective_from TEXT NOT NULL,                -- YYYY-MM-DD
  effective_to   TEXT,                         -- NULL = still current
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     TEXT,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One price per supplier, product and start date. A correction replaces that
-- row; a change of price is a new row with a later effective_from.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_unique
  ON supplier_prices (supplier_id, product_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_sp_product
  ON supplier_prices (product_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_sp_current
  ON supplier_prices (product_id, effective_to) WHERE effective_to IS NULL;

-- ==========================================================================
-- Sales, and their margin
-- ==========================================================================

ALTER TABLE vlite_sales ADD COLUMN taxable_paise INTEGER;
ALTER TABLE vlite_sales ADD COLUMN gst_paise INTEGER;
ALTER TABLE vlite_sales ADD COLUMN cost_paise INTEGER;
ALTER TABLE vlite_sales ADD COLUMN cost_source TEXT
  CHECK (cost_source IS NULL OR cost_source IN (
    'batch', 'latest_batch', 'supplier_price', 'unknown'));
-- Stored rather than computed on read, so a later cost correction cannot
-- retrospectively restate a month that has already been reported.
ALTER TABLE vlite_sales ADD COLUMN margin_paise INTEGER;
ALTER TABLE vlite_sales ADD COLUMN product_name TEXT;
ALTER TABLE vlite_sales ADD COLUMN status TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_product ON vlite_sales (product_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_pod     ON vlite_sales (pod_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_soldat  ON vlite_sales (sold_at DESC);

-- Which windows have already been pulled, so an import can be resumed and does
-- not re-walk transactions it has already seen. The dedupe index on
-- vlite_sales.dedupe_key is what actually makes a re-pull harmless; this is
-- only so the UI can show progress and pick up where it left off.
CREATE TABLE IF NOT EXISTS vlite_sales_imports (
  import_id     TEXT PRIMARY KEY,
  from_date     TEXT NOT NULL,
  to_date       TEXT NOT NULL,
  last_trx_time TEXT,
  transactions  INTEGER NOT NULL DEFAULT 0,
  lines_imported INTEGER NOT NULL DEFAULT 0,
  lines_skipped INTEGER NOT NULL DEFAULT 0,
  complete      INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  last_error    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_imports ON vlite_sales_imports (created_at DESC);
