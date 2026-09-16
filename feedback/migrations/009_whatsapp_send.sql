-- Sending the refill message, and the record of every one sent.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/009_whatsapp_send.sql
--
-- WHY THE MESSAGE TEXT IS NOT STORED HERE AS SOMETHING WE SEND
--
-- WhatsApp does not let a business send arbitrary text. A message the business
-- starts -- which is all of these, since nobody has written to us -- must be an
-- APPROVED TEMPLATE, registered with Meta and reviewed by them. What is
-- configurable on our side is therefore which template to use and what to put
-- in its variables, not the sentence itself.
--
-- body_preview holds a copy of the approved wording purely so the panel can
-- show what is about to go out. It is never sent and changing it changes
-- nothing at Meta's end -- which is exactly why it is named preview.

PRAGMA foreign_keys = ON;

-- One row, id = 1. A settings table rather than Worker vars because this is
-- edited by a person in the panel, not by a deploy.
CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),

  enabled        INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  template_name  TEXT NOT NULL DEFAULT '',
  language_code  TEXT NOT NULL DEFAULT 'en_US',

  -- Meta's template variables are positional: {{1}}, {{2}}, {{3}}. This holds
  -- a JSON array naming which of our fields fills each position, e.g.
  -- ["pod_label","pod_location"], so the panel can show the mapping and the
  -- sender can fill them without a hardcoded order.
  variables      TEXT NOT NULL DEFAULT '[]',

  body_preview   TEXT NOT NULL DEFAULT '',

  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by     TEXT
);

INSERT INTO whatsapp_settings (id) VALUES (1) ON CONFLICT(id) DO NOTHING;

-- Every send attempt, successful or not.
--
-- This exists so that "did we already tell them?" is answerable. Without it a
-- second click on a slow connection messages everyone twice, and the people
-- being messaged are customers, not rows.
CREATE TABLE IF NOT EXISTS whatsapp_sends (
  send_id      TEXT PRIMARY KEY,
  batch_id     TEXT NOT NULL,
  pod_id       TEXT NOT NULL REFERENCES pods(pod_id) ON DELETE RESTRICT,
  wa_number    TEXT NOT NULL,
  optin_id     TEXT,

  template     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  wa_message_id TEXT,
  error        TEXT,

  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_sends_pod   ON whatsapp_sends (pod_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_sends_batch ON whatsapp_sends (batch_id);
CREATE INDEX IF NOT EXISTS idx_wa_sends_num   ON whatsapp_sends (wa_number, created_at DESC);
