-- Debit notes raised on suppliers for defective / short / wrong goods.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/003_debit_notes.sql
--
-- Accounting notes:
--  * All money is INTEGER PAISE. No floats anywhere in the chain.
--  * Quantities are INTEGER THOUSANDTHS (qty_milli) so 2.5 kg is 2500 and the
--    line maths stays exact.
--  * Tax is split CGST+SGST for intra-state and IGST for inter-state, decided
--    by comparing the supplier's GSTIN state code with ours. Stored, not
--    recomputed at read time, so a reissued document can never change.
--  * document_counters gives gapless per-financial-year numbering via a single
--    atomic upsert; note_number additionally carries a UNIQUE index.

PRAGMA foreign_keys = ON;

-- Gapless document numbering, one row per (series, financial year).
CREATE TABLE IF NOT EXISTS document_counters (
  series  TEXT NOT NULL,          -- 'DN'
  fy      TEXT NOT NULL,          -- '2026-27'
  last_no INTEGER NOT NULL,
  PRIMARY KEY (series, fy)
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id            TEXT PRIMARY KEY,
  note_number   TEXT NOT NULL UNIQUE,     -- FETCH/DN/2026-27/0001
  fy            TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  note_date     TEXT NOT NULL,            -- YYYY-MM-DD, IST
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,                     -- admin email

  -- supplier (the party being debited)
  supplier_name     TEXT NOT NULL,
  supplier_gstin    TEXT,
  supplier_address  TEXT,
  supplier_state    TEXT,

  -- what this relates to
  reason        TEXT NOT NULL CHECK (reason IN (
                  'damaged', 'expired', 'quality', 'wrong_item',
                  'short_supply', 'price_diff', 'other')),
  invoice_ref   TEXT,                     -- supplier's original invoice no.
  invoice_date  TEXT,
  notes         TEXT,

  -- computed totals, all integer paise
  is_interstate     INTEGER NOT NULL DEFAULT 0 CHECK (is_interstate IN (0, 1)),
  taxable_paise     INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  cgst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise        INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  round_off_paise   INTEGER NOT NULL DEFAULT 0,
  total_paise       INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),

  status        TEXT NOT NULL DEFAULT 'issued' CHECK (status IN (
                  'issued', 'settled', 'cancelled')),
  settled_at    TEXT,
  admin_notes   TEXT
);

CREATE TABLE IF NOT EXISTS debit_note_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id        TEXT NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  description    TEXT NOT NULL,
  hsn            TEXT,
  qty_milli      INTEGER NOT NULL CHECK (qty_milli > 0),
  uom            TEXT NOT NULL DEFAULT 'pcs',
  rate_paise     INTEGER NOT NULL CHECK (rate_paise >= 0),
  gst_bps        INTEGER NOT NULL DEFAULT 0 CHECK (gst_bps >= 0 AND gst_bps <= 5000),
  taxable_paise  INTEGER NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise     INTEGER NOT NULL DEFAULT 0,
  sgst_paise     INTEGER NOT NULL DEFAULT 0,
  igst_paise     INTEGER NOT NULL DEFAULT 0,
  total_paise    INTEGER NOT NULL CHECK (total_paise >= 0)
);

CREATE INDEX IF NOT EXISTS idx_dn_created   ON debit_notes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dn_status    ON debit_notes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dn_supplier  ON debit_notes (supplier_name);
CREATE INDEX IF NOT EXISTS idx_dnl_note     ON debit_note_lines (note_id, line_no);
