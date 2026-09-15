-- WhatsApp refill notifications: the consent record and the number list.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/006_whatsapp_optin.sql
--
-- What this table is for: when a Pod is refilled, this is the list of people
-- who asked to be told. Nothing here sends a message -- that is a separate
-- decision and a separate integration. This is the consent ledger underneath
-- it, and it is deliberately built as a consent record rather than a contact
-- list, because under the DPDPA the number is worth nothing without proof of
-- how and when it was given.
--
-- Notes:
--  * wa_number is stored E.164 WITHOUT the '+': country code + subscriber
--    number, e.g. 919876543210. WhatsApp identifies a user by exactly this
--    form, so storing the bare 10 digits (as submissions.contact_phone does)
--    would mean every future sender had to re-guess the country. One
--    canonical form, decided at the door.
--  * One row per (number, Pod). Interest is per-Pod -- someone wants to know
--    about the machine in their lobby, not every machine in the fleet -- and
--    the UNIQUE index makes a second opt-in at the same Pod update the
--    existing consent instead of creating a duplicate to message twice.
--  * consent_text stores the exact words the person agreed to. If the wording
--    on the form changes later, old rows still say what was actually promised,
--    which is the only version that matters if it is ever questioned.
--  * status is the opt-out switch. Rows are NEVER deleted on unsubscribe:
--    a deleted row re-subscribes itself the next time that person fills in
--    the form, which is precisely what an opt-out must not do.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_optins (
  optin_id      TEXT PRIMARY KEY,

  -- E.164 digits, no '+', no spaces. 91XXXXXXXXXX for India.
  -- Two separate CHECKs rather than one compound: SQLite names a failed
  -- constraint by its first expression, so a combined rule would report a
  -- length problem for a '+' that was never a length problem.
  wa_number     TEXT NOT NULL
                  CHECK (length(wa_number) BETWEEN 10 AND 15)
                  CHECK (NOT wa_number GLOB '*[^0-9]*'),

  pod_id        TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE RESTRICT,

  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'unsubscribed', 'invalid')),

  -- Where the consent came from, so a number that appears without a form
  -- submission behind it is visible as such.
  source        TEXT NOT NULL DEFAULT 'feedback_form'
                  CHECK (source IN ('feedback_form', 'admin')),

  -- The exact sentence the person ticked, and the submission it came in on.
  consent_text  TEXT NOT NULL,
  submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,

  -- An optional name, only ever what they typed themselves.
  display_name  TEXT,

  consented_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reconfirmed_at  TEXT,          -- bumped when they opt in again at the same Pod
  unsubscribed_at TEXT,

  -- Send bookkeeping, filled in by whatever eventually does the sending.
  last_sent_at  TEXT,
  send_count    INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),

  -- An unsubscribed row must carry the date it happened, or the opt-out is
  -- not evidenced. Enforced here rather than in a handler so a hand-run
  -- UPDATE cannot skip it.
  CHECK ((status = 'unsubscribed') = (unsubscribed_at IS NOT NULL))
);

-- The rule that makes a second opt-in an update rather than a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_optins_number_pod
  ON whatsapp_optins (wa_number, pod_id);

-- The query the refill notification actually runs: who to message for this Pod.
CREATE INDEX IF NOT EXISTS idx_wa_optins_pod_status
  ON whatsapp_optins (pod_id, status);

CREATE INDEX IF NOT EXISTS idx_wa_optins_number  ON whatsapp_optins (wa_number);
CREATE INDEX IF NOT EXISTS idx_wa_optins_created ON whatsapp_optins (created_at DESC);
