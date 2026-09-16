-- Delivery status for messages we sent.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/010_whatsapp_delivery.sql
--
-- WHY THIS EXISTS
--
-- The Cloud API returns a message id the moment it ACCEPTS a message. That is
-- all it tells you. Whether the message then reached a handset, was rejected
-- downstream, or was silently dropped is reported only through a webhook --
-- and without one, a send that never arrived is indistinguishable from one
-- that did. Our log said "Sent to 1 person" for a message that was never
-- delivered, which is worse than saying nothing.
--
-- Meta's status values: sent -> delivered -> read, or failed at any point.

PRAGMA foreign_keys = ON;

-- What Meta last told us about this message. NULL means no webhook has been
-- heard from -- which is the honest state when none is configured, and is
-- deliberately distinct from 'sent'.
ALTER TABLE whatsapp_sends ADD COLUMN delivery_status TEXT
  CHECK (delivery_status IS NULL
         OR delivery_status IN ('sent', 'delivered', 'read', 'failed'));

ALTER TABLE whatsapp_sends ADD COLUMN delivered_at TEXT;
ALTER TABLE whatsapp_sends ADD COLUMN read_at TEXT;

-- Meta's own failure text, kept verbatim for the same reason the send error is.
ALTER TABLE whatsapp_sends ADD COLUMN delivery_error TEXT;
ALTER TABLE whatsapp_sends ADD COLUMN delivery_updated_at TEXT;

-- The webhook finds rows by the id Meta gave us, so that lookup must be fast
-- and the id must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_sends_wamid
  ON whatsapp_sends (wa_message_id) WHERE wa_message_id IS NOT NULL;
