-- Free-text replies we send back to customers from the dashboard.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/012_whatsapp_replies.sql
--
-- Separate from whatsapp_sends on purpose. That table records TEMPLATE sends we
-- start; this records conversational replies, which are a different thing
-- under WhatsApp's rules and are only permitted inside the 24-hour window a
-- customer opens by writing to us. Merging them into one table would mean a
-- nullable template column and a direction flag, and every query would have to
-- remember which kind of row it was looking at.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_replies (
  reply_id      TEXT PRIMARY KEY,
  wa_number     TEXT NOT NULL,
  body          TEXT NOT NULL,

  -- Meta's id for the message, and what became of it. Same delivery webhook
  -- fills the status in, keyed on wa_message_id.
  wa_message_id TEXT,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error         TEXT,

  delivery_status TEXT CHECK (delivery_status IS NULL
                    OR delivery_status IN ('sent', 'delivered', 'read', 'failed')),
  delivery_error  TEXT,

  sent_by       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_replies_number ON whatsapp_replies (wa_number, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_replies_wamid
  ON whatsapp_replies (wa_message_id) WHERE wa_message_id IS NOT NULL;
