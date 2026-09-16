-- Pre-typed replies: refund guidance, opening hours, "we're on it" and so on.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/013_whatsapp_canned.sql
--
-- These are ordinary free text, NOT templates. They can only be sent inside
-- the 24-hour window a customer opens by writing to us -- which is exactly when
-- somebody is typing the same refund explanation for the fifth time. Outside
-- that window nothing here is sendable and an approved template is the only
-- route, so the composer hides them rather than offering a shortcut that
-- cannot work.
--
-- Stored rather than hardcoded so the wording can be fixed by whoever is
-- answering, at the moment they notice it is wrong.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_canned_replies (
  canned_id  TEXT PRIMARY KEY,

  -- What it is called in the picker, e.g. "Refund guidelines".
  title      TEXT NOT NULL CHECK (length(trim(title)) > 0),

  -- What gets put in the composer. Inserted for editing, never sent straight
  -- out: the person still reads it and presses Send, so a canned reply can be
  -- adjusted to the actual question.
  body       TEXT NOT NULL CHECK (length(trim(body)) > 0),

  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_canned_order
  ON whatsapp_canned_replies (sort_order, created_at);

-- A starting set. Deliberately plain: these are read by customers who are
-- usually annoyed, and cheerfulness reads badly when someone is out of pocket.
INSERT INTO whatsapp_canned_replies (canned_id, title, body, sort_order) VALUES
  ('cn_refund', 'Refund guidelines',
   'Sorry about that. If the machine took payment but did not dispense, we refund in full.' || char(10) || char(10) ||
   'Refunds reach the original payment method within 7 working days. Send us the Pod number and roughly what time it happened and we will get it moving.',
   10),
  ('cn_notdispensed', 'Item not dispensed',
   'Sorry about that. Please tell us the Pod number and which item it was, and we will sort it out.' || char(10) || char(10) ||
   'If you were charged, we will refund you in full.',
   20),
  ('cn_restock', 'When we refill',
   'Thanks for letting us know. We restock this Pod regularly and we have passed this on to the team for the next visit.',
   30),
  ('cn_thanks', 'Thanks',
   'Thank you for telling us. It genuinely helps us keep the Pods stocked properly.',
   40)
ON CONFLICT(canned_id) DO NOTHING;
