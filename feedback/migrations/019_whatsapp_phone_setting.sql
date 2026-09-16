-- Which number we send from, as a setting rather than a secret.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/019_whatsapp_phone_setting.sql
--
-- The phone number ID is not a credential. It appears in every Graph API path,
-- it is printed in WhatsApp Manager, and it CHANGES whenever the business
-- changes number -- which is exactly when nobody wants to be rotating Worker
-- secrets and redeploying. The access token is the secret; this is an address.
--
-- Falls back to the WHATSAPP_PHONE_ID secret when unset, so nothing breaks
-- before anyone opens the settings page.

PRAGMA foreign_keys = ON;

ALTER TABLE whatsapp_settings ADD COLUMN phone_number_id TEXT;
