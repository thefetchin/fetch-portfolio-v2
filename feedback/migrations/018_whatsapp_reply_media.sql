-- Pictures we send back.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/018_whatsapp_reply_media.sql
--
-- WhatsApp fetches an outbound image from a public URL, exactly as it does the
-- template header, so a reply's picture is one we have already published
-- through /media/whatsapp. That is why this is a URL and not a blob: the bytes
-- already live in whatsapp_media, and copying them would give two places to
-- keep in step.

PRAGMA foreign_keys = ON;

ALTER TABLE whatsapp_replies ADD COLUMN media_url TEXT;

-- body stays NOT NULL. A picture sent without a caption stores an empty body
-- and is told apart by media_url being set -- rebuilding the table to relax
-- one column would be a lot of risk for a nicety, and the pair reads
-- unambiguously as it is.
