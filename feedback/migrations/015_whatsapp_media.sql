-- Header images for WhatsApp templates, hosted by us.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/015_whatsapp_media.sql
--
-- WhatsApp fetches the header file itself, from a public https URL, at the
-- moment the message is sent. So the image has to be hosted somewhere open --
-- which previously meant finding a file already on the marketing site and
-- pasting its address. This lets one be uploaded instead.
--
-- Stored in D1 rather than R2 because it is one small banner, and a bucket is
-- infrastructure to provision, bind and pay for in exchange for holding a
-- couple of hundred kilobytes. SQLite caps a value at just under 1MB, which is
-- the real size limit here and is checked on upload rather than discovered as
-- a failed write.
--
-- Each upload gets its own id and therefore its own URL. Meta caches media by
-- URL, so replacing the image at a fixed address would keep sending the old
-- one; a new id sidesteps that entirely.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_media (
  media_id     TEXT PRIMARY KEY,
  filename     TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  bytes        BLOB NOT NULL,
  size         INTEGER NOT NULL CHECK (size > 0),
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_media_uploaded ON whatsapp_media (uploaded_at DESC);
