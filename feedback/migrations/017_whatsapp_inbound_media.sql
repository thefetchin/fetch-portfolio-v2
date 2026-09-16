-- Pictures customers send us.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/017_whatsapp_inbound_media.sql
--
-- Meta does not send the image. It sends an id, and a URL fetched from that id
-- expires within minutes and needs our access token. So the bytes have to be
-- pulled down at the moment the webhook fires or they are gone -- there is no
-- fetching it later when somebody opens the conversation.
--
-- Kept in a SEPARATE table from whatsapp_media, which holds template header
-- images. Those are published deliberately and served to the whole internet
-- because Meta fetches them. These are photographs a customer sent to a
-- business, often of a machine in a place they are standing, and are served
-- only to a signed-in admin. Same shape, opposite access rule, so sharing one
-- table would be one careless join away from publishing them.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_inbound_media (
  media_id     TEXT PRIMARY KEY,          -- Meta's media id, so a retry cannot duplicate
  message_id   TEXT REFERENCES whatsapp_inbound(message_id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  bytes        BLOB NOT NULL,
  size         INTEGER NOT NULL CHECK (size > 0),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_inmedia_msg ON whatsapp_inbound_media (message_id);

-- What we know about the attachment, kept on the message itself so a thread
-- can be drawn without joining, and so a failure has somewhere to be recorded.
ALTER TABLE whatsapp_inbound ADD COLUMN media_id TEXT;
ALTER TABLE whatsapp_inbound ADD COLUMN media_type TEXT;
ALTER TABLE whatsapp_inbound ADD COLUMN media_size INTEGER;

-- Why an attachment is not viewable, when it is not. Too large for a D1 row,
-- or the download failed. Saying so beats a picture that silently never
-- appears, which reads as a bug in the panel.
ALTER TABLE whatsapp_inbound ADD COLUMN media_error TEXT;
