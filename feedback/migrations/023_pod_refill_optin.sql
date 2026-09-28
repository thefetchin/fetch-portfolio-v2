-- Whether a machine offers refill notifications on its own form.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/023_pod_refill_optin.sql
--
-- Per Pod rather than global, because whether it is worth asking depends on
-- the machine: one that is refilled on a fixed round has nothing useful to
-- announce, and asking anyway collects consent for a message nobody will ever
-- send. A consent record that goes unused is not free -- it is a promise.
--
-- Existing Pods default to 1, which is what they already do today. Turning it
-- off hides the box on the form; it does NOT unsubscribe anyone who already
-- ticked it, because their consent was real and is theirs to withdraw. The
-- WhatsApp section is where those come off the list.

PRAGMA foreign_keys = ON;

ALTER TABLE pods ADD COLUMN refill_optin INTEGER NOT NULL DEFAULT 1
  CHECK (refill_optin IN (0, 1));
