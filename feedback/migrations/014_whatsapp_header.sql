-- Media headers on the refill template.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/014_whatsapp_header.sql
--
-- Adding an image to an approved template adds a HEADER component, and every
-- send must then supply a parameter for it. Sending only the body afterwards
-- fails with:
--
--   (#132012) Parameter format does not match format in the created template
--
-- which names no component and reads like a problem with the body. The panel
-- now reads the template's real shape back from Meta so the mismatch is
-- visible before anyone presses send.

PRAGMA foreign_keys = ON;

-- NONE means the template has no header, which is the shape this started as.
ALTER TABLE whatsapp_settings ADD COLUMN header_format TEXT NOT NULL DEFAULT 'NONE'
  CHECK (header_format IN ('NONE', 'IMAGE', 'VIDEO', 'DOCUMENT'));

-- Publicly reachable https URL. Meta fetches it itself at send time, so it
-- cannot be behind our admin auth or on localhost.
ALTER TABLE whatsapp_settings ADD COLUMN header_media_url TEXT;
