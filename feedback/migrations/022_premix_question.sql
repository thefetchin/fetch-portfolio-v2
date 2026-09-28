-- The premix question: every drink, and how each one was mixed.
--
-- Apply:
--   npx wrangler d1 execute fetch-feedback --remote --file=./migrations/022_premix_question.sql
--
-- A row per drink, each rated on the same scale, because the useful figure is
-- per flavour and appears once many answers are added together. Twenty people
-- saying Masala tea is watery is a dosing setting to change; one person saying
-- it is a Tuesday. Rows they leave alone are drinks they have not had -- the
-- form offers "Didn't try" as the way to say so and move on.
--
-- The scale is deliberately one axis. Premix carries the coffee, the sugar and
-- the creamer in a single powder, so dosing moves strength and sweetness
-- together: under-dose and it reads watery, over-dose and it reads syrupy.
-- Two separate questions would imply they can be tuned apart. They cannot.
--
-- Flavours are ordinary options, so the list is edited in the Questions tab
-- like any other -- this seed is a starting point, not the menu.

PRAGMA foreign_keys = ON;

INSERT INTO questions
  (question_id, set_id, qkey, position, type, kicker, title, hint,
   options, scale, extra_placeholder, optional, maps_to)
VALUES (
  'coffee_feedback_premix', 'coffee_feedback', 'premix', 15, 'item_grid',
  'The mix', 'How is each one?',
  'Rate the ones you have tried — leave the rest as they are.',
  '[{"value": "coffee", "label": "Coffee"}, {"value": "cappuccino", "label": "Cappuccino"}, {"value": "masala_tea", "label": "Masala tea"}, {"value": "ginger_tea", "label": "Ginger tea"}, {"value": "cardamom_tea", "label": "Cardamom tea"}, {"value": "lemon_tea", "label": "Lemon tea"}, {"value": "green_tea", "label": "Green tea"}, {"value": "hot_chocolate", "label": "Hot chocolate"}, {"value": "soup", "label": "Soup"}]', '[{"value": "weak", "label": "Too weak"}, {"value": "right", "label": "Just right"}, {"value": "strong", "label": "Too sweet"}]',
  NULL, 1, NULL
) ON CONFLICT(question_id) DO NOTHING;

-- The old generic "How was the strength?" is hidden, not deleted: the premix
-- question asks the same thing and says which drink it was about, so keeping
-- both means asking twice and learning less. Un-hide it from the Questions tab
-- if that turns out to be the wrong call -- it is one toggle, and nothing is
-- lost in the meantime.
UPDATE questions SET active = 0 WHERE question_id = 'coffee_feedback_strength';
