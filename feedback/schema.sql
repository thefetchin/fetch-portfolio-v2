-- Fetch feedback — D1 schema
--
-- Apply locally:   npx wrangler d1 execute fetch-feedback --local  --file=./schema.sql
-- Apply remotely:  npx wrangler d1 execute fetch-feedback --remote --file=./schema.sql
--
-- Data-quality notes:
--  * `pods` is a registry. submissions.pod_id is a FOREIGN KEY, so a
--    submission for an unknown or retired machine is rejected by the DB
--    itself even if application validation is somehow bypassed.
--  * Every enum column carries a CHECK constraint mirroring
--    shared/constants.js — the database is the last line of defence.
--  * created_at is always server-generated. Client clocks are never trusted.
--  * dedupe_hash has a UNIQUE index and embeds a 10-minute time bucket, so
--    accidental double-submits collapse into one row automatically.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- pods ----

CREATE TABLE IF NOT EXISTS pods (
  pod_id     TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  location   TEXT,
  city       TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------- submissions ----

CREATE TABLE IF NOT EXISTS submissions (
  id          TEXT PRIMARY KEY,
  pod_id      TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('complaint', 'feedback')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- request provenance (no raw IPs stored — hashed with a server secret)
  ip_hash     TEXT,
  country     TEXT,
  user_agent  TEXT,
  dedupe_hash TEXT,

  -- complaint fields ------------------------------------------------------
  issue_type       TEXT CHECK (issue_type IS NULL OR issue_type IN (
                     'no_dispense', 'wrong_item', 'damaged_item',
                     'double_charge', 'payment_failed', 'machine_fault', 'other')),
  occurred_when    TEXT CHECK (occurred_when IS NULL OR occurred_when IN (
                     'just_now', 'today', 'earlier')),
  amount_paise     INTEGER CHECK (amount_paise IS NULL OR
                     (amount_paise > 0 AND amount_paise <= 2000000)),
  payment_ref      TEXT,
  refund_requested INTEGER NOT NULL DEFAULT 0 CHECK (refund_requested IN (0, 1)),

  -- feedback fields -------------------------------------------------------
  rating            INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  wanted_categories TEXT,   -- JSON array of category values
  wanted_text       TEXT,
  price_feel        TEXT CHECK (price_feel IS NULL OR price_feel IN (
                      'expensive', 'fair', 'good')),
  usage_freq        TEXT CHECK (usage_freq IS NULL OR usage_freq IN (
                      'first_time', 'sometimes', 'weekly', 'daily')),
  notify_opt_in     INTEGER NOT NULL DEFAULT 0 CHECK (notify_opt_in IN (0, 1)),

  -- shared fields ---------------------------------------------------------
  product_category TEXT CHECK (product_category IS NULL OR product_category IN (
                     'chips', 'chocolate', 'cold_drink', 'water', 'coffee_tea',
                     'healthy', 'protein', 'ready_meal', 'other')),
  product_text     TEXT,
  comment          TEXT,
  contact_email    TEXT,
  contact_phone    TEXT,

  -- triage ----------------------------------------------------------------
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                'new', 'in_progress', 'resolved', 'spam')),
  admin_notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_dedupe
  ON submissions (dedupe_hash) WHERE dedupe_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_created  ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_pod      ON submissions (pod_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_kind     ON submissions (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status   ON submissions (status, created_at DESC);
-- supports the per-IP and per-Pod rate-limit lookups
CREATE INDEX IF NOT EXISTS idx_submissions_ip_time  ON submissions (ip_hash, created_at DESC);

-- ------------------------------------------------------------- seed -------
-- Replace these with your real machines. The pod_id here is what gets
-- embedded (and signed) in each QR code.

INSERT OR IGNORE INTO pods (pod_id, label, location, city) VALUES
  ('POD-MNG-001', 'Fetch Pod 001', 'Lucia Mansion, Kulshekara', 'Mangalore'),
  ('POD-MNG-002', 'Fetch Pod 002', 'Demo location',             'Mangalore');
