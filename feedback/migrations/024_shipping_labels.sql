-- Shipping labels for parts going back to a manufacturer.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/024_shipping_labels.sql
--
-- Two tables and no third: the label itself is not stored. A label is a sheet
-- of paper produced from the addresses and whatever is in the box today --
-- keeping a copy of every one printed would be a filing cabinet nobody asked
-- for. What IS worth keeping is the parts that repeat: our own address, the
-- manufacturers we send to, and how the page should come out of the printer.

PRAGMA foreign_keys = ON;

-- One row, id = 1. Defaults a person edits in the panel, not a deploy.
CREATE TABLE IF NOT EXISTS shipping_settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),

  -- Who the parcel is from. Seeded from the company details the invoices
  -- already use, and editable, because the address goods leave from is not
  -- always the registered office.
  from_name       TEXT NOT NULL DEFAULT '',
  from_lines      TEXT NOT NULL DEFAULT '',   -- one line per newline
  from_gstin      TEXT NOT NULL DEFAULT '',
  from_phone      TEXT NOT NULL DEFAULT '',
  from_email      TEXT NOT NULL DEFAULT '',

  -- How the page comes out. Held here so the printer settings survive a
  -- refresh and the next person does not have to know them.
  page_size       TEXT NOT NULL DEFAULT 'A4',
  orientation     TEXT NOT NULL DEFAULT 'landscape'
                    CHECK (orientation IN ('portrait', 'landscape')),

  -- Every part of the label that can be left off, as a JSON object of
  -- booleans. JSON rather than a column each because these are presentation
  -- switches: adding one should not be a migration.
  show            TEXT NOT NULL DEFAULT '{}',

  -- Wording that is legally load-bearing enough to be worth editing rather
  -- than hardcoding -- what the shipment is and why it is worth what it says.
  declaration     TEXT NOT NULL DEFAULT '',
  footer_note     TEXT NOT NULL DEFAULT '',

  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      TEXT
);

-- The manufacturers, so an address is typed once and picked thereafter. A
-- wrong address on a box of spare parts is a parcel nobody sees again.
CREATE TABLE IF NOT EXISTS shipping_addresses (
  address_id   TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  attention    TEXT,                  -- a person or a department
  lines        TEXT NOT NULL DEFAULT '',
  gstin        TEXT,
  phone        TEXT,
  email        TEXT,
  notes        TEXT,                  -- gate timings, RMA desk, that sort of thing
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ship_addr_live
  ON shipping_addresses (archived, name);
