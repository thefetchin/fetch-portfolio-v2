-- Messages customers send us on WhatsApp.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/011_whatsapp_inbound.sql
--
-- These arrive on the same webhook as delivery statuses, under a different key
-- in the payload. Storing them matters for two reasons beyond simply reading
-- them:
--
--  * An inbound message opens a 24-hour window in which we may reply with FREE
--    TEXT rather than an approved template. That window is the only time
--    ordinary conversation is possible, and knowing when it closes is the
--    difference between a reply that sends and one Meta rejects.
--
--  * If someone replies STOP, that is an opt-out and we are obliged to honour
--    it. It cannot be honoured if it was never recorded.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_inbound (
  message_id   TEXT PRIMARY KEY,          -- Meta's wamid; the natural dedupe key
  wa_number    TEXT NOT NULL,             -- who wrote to us, E.164 without '+'
  profile_name TEXT,                      -- their WhatsApp display name, if sent

  type         TEXT NOT NULL,             -- text, image, button, interactive, ...
  body         TEXT,                      -- the text, where there is any

  -- Kept whole. Meta adds message types regularly and a column per type would
  -- be perpetually behind; this way nothing is lost while we decide.
  raw_json     TEXT,

  -- Meta's own timestamp, and ours. Client clocks are never trusted elsewhere
  -- in this schema and Meta's is no different -- received_at is authoritative
  -- for the 24-hour window.
  sent_at      TEXT,
  received_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- Set when a human has dealt with it, so the inbox has an end state.
  handled_at   TEXT,
  handled_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_inbound_received ON whatsapp_inbound (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_number   ON whatsapp_inbound (wa_number, received_at DESC);
-- The unhandled queue, which is what the panel shows first.
CREATE INDEX IF NOT EXISTS idx_wa_inbound_open     ON whatsapp_inbound (handled_at, received_at DESC);
