-- Machine types, and questions that can be edited instead of deployed.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/020_machine_types.sql
--
-- The form asked the same five questions of everyone because they lived in
-- shared/constants.js. That is right for one kind of machine and wrong the
-- moment there are two: "what should we stock here?" means nothing at a coffee
-- machine, and "how was the strength?" means nothing at a snack Pod.
--
-- So questions move into the database, one ordered set per (machine type,
-- feedback|complaint). The existing snack questions are seeded here EXACTLY as
-- they were, so every Pod already in service asks precisely what it asked
-- yesterday -- this migration should be invisible to anyone scanning a QR.
--
-- What is deliberately NOT configurable, because it is behaviour rather than
-- wording: the rating scale, the payment block that appears for payment-type
-- issues, and the closing step with the comment and the WhatsApp opt-in. Those
-- carry logic -- refund eligibility, consent -- and a question editor that can
-- delete them is a question editor that can break a refund.

PRAGMA foreign_keys = ON;

-- Existing Pods are snack machines. Nothing to backfill.
ALTER TABLE pods ADD COLUMN machine_type TEXT NOT NULL DEFAULT 'snacks'
  CHECK (machine_type IN ('snacks', 'coffee'));

CREATE TABLE IF NOT EXISTS question_sets (
  set_id       TEXT PRIMARY KEY,
  machine_type TEXT NOT NULL CHECK (machine_type IN ('snacks', 'coffee')),
  kind         TEXT NOT NULL CHECK (kind IN ('feedback', 'complaint')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One set per machine type per kind. Two sets for the same pair would make
-- "which questions does this Pod ask?" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_sets_unique
  ON question_sets (machine_type, kind);

CREATE TABLE IF NOT EXISTS questions (
  question_id TEXT PRIMARY KEY,
  set_id      TEXT NOT NULL REFERENCES question_sets(set_id) ON DELETE CASCADE,

  -- Stable key. It is what an answer is filed under, so renaming one orphans
  -- every answer already given: the editor never changes it.
  qkey        TEXT NOT NULL,

  position    INTEGER NOT NULL DEFAULT 0,
  -- item_grid is one question holding a row per item (a coffee flavour, say),
  -- each rated on the same scale. It exists because the thing worth knowing is
  -- per-flavour and only appears once many answers are added up, and because
  -- someone who has tried three drinks can say so in one step. Rows they leave
  -- alone are absent from the answer.
  type        TEXT NOT NULL CHECK (type IN ('single', 'multi', 'text', 'item_grid')),

  kicker      TEXT,                -- the small line above the question
  title       TEXT NOT NULL,
  hint        TEXT,

  -- [{ value, label, payment? }]. `payment` on an issue option is what makes
  -- the amount-and-reference block appear.
  options     TEXT NOT NULL DEFAULT '[]',

  -- For item_grid: the scale every row is rated on, [{value,label}].
  -- Separate from `options`, which holds the items themselves, so flavours can
  -- be added without touching the scale and the other way round.
  scale       TEXT NOT NULL DEFAULT '[]',

  -- A free-text box under the choices, e.g. "Any particular brand or item?"
  extra_placeholder TEXT,

  optional    INTEGER NOT NULL DEFAULT 1 CHECK (optional IN (0, 1)),

  -- The legacy submissions column this answer also writes to, when there is
  -- one. It is why the Submissions tab, its filters and the CSV keep working
  -- after the questions became data. A question with no mapping lives only in
  -- submissions.answers, which is the normal case for anything new.
  maps_to     TEXT,

  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_key ON questions (set_id, qkey);
CREATE INDEX IF NOT EXISTS idx_questions_order ON questions (set_id, position);

-- Every answer, keyed by question. The mapped columns above stay populated too,
-- so nothing that reads them has to change.
ALTER TABLE submissions ADD COLUMN answers TEXT;
