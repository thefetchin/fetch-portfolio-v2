/**
 * Tests for questions that live in the database.
 *
 *   node tests/questions-unit.mjs
 *
 * The form is now told what to ask. That makes the server's whitelisting the
 * only thing standing between a crafted payload and a row of nonsense, so most
 * of what follows is about what validateAnswers REFUSES.
 */

import { validateAnswers, isPaymentIssue, MAPPABLE } from '../worker/questions.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const single = (key, opts, extra = {}) => ({
  key, type: 'single', title: key, optional: true, options: opts, ...extra,
})
const multi = (key, opts, extra = {}) => ({
  key, type: 'multi', title: key, optional: true, options: opts, ...extra,
})

const STRENGTH = single('strength', [
  { value: 'weak', label: 'Too weak' }, { value: 'right', label: 'Just right' },
])
const WANTED = multi('wanted', [
  { value: 'tea', label: 'Tea' }, { value: 'oat', label: 'Oat milk' },
], { extraPlaceholder: 'Anything else?', mapsTo: 'wanted_categories' })

/* ------------------------------------------------------- whitelisting --- */
section('answers are checked against the question that was asked')

eq('a valid choice is kept',
  validateAnswers([STRENGTH], { strength: 'weak' }).answers, { strength: 'weak' })

// The client is told what to ask by us, but it is still a client.
eq('an option that is not on the question is dropped',
  validateAnswers([STRENGTH], { strength: 'sabotage' }).answers, {})
eq('an answer to a question that was never asked is ignored',
  validateAnswers([STRENGTH], { something_else: 'x' }).answers, {})
eq('an array sent to a single-choice question is dropped',
  validateAnswers([STRENGTH], { strength: ['weak'] }).answers, {})

eq('multi keeps only the options offered, de-duplicated',
  validateAnswers([WANTED], { wanted: ['tea', 'tea', 'oat', 'nope'] }).answers.wanted,
  ['tea', 'oat'])
eq('an empty multi is null rather than an empty array',
  validateAnswers([WANTED], { wanted: [] }).answers, {})

/* ------------------------------------------------------------ required -- */
section('required questions')

const REQ = single('issue', [{ value: 'a', label: 'A' }], { optional: false, title: 'What went wrong?' })
eq('missing a required answer is an error naming the question',
  validateAnswers([REQ], {}).errors, ['What went wrong? — please answer this.'])
eq('a bad value on a required question is also an error, not a silent drop',
  validateAnswers([REQ], { issue: 'nope' }).errors.length, 1)
eq('answering it clears the error',
  validateAnswers([REQ], { issue: 'a' }).errors, [])

/* ------------------------------------------------- the legacy columns --- */
section('keeping the old columns fed')

/* The Submissions tab, its filters and the CSV all read named columns. A
   question can declare which one it also writes to, so none of that had to
   change when the questions became data. */
const r = validateAnswers([WANTED], { wanted: ['tea'], wanted__extra: 'Earl Grey' })
eq('a mapped multi writes JSON to its column', r.mapped.wanted_categories, '["tea"]')
eq('its companion box feeds wanted_text', r.mapped.wanted_text, 'Earl Grey')
eq('and both are in the answers too', r.answers, { wanted: ['tea'], wanted__extra: 'Earl Grey' })

eq('an unmapped question writes no column',
  validateAnswers([STRENGTH], { strength: 'weak' }).mapped, {})

// A question cannot name a column that does not exist, or one it has no
// business writing.
eq('only known columns are mappable',
  MAPPABLE.every((c) => /^[a-z_]+$/.test(c)), true)
eq('contact and consent columns are NOT mappable',
  MAPPABLE.some((c) => /contact|whatsapp|notify|status/.test(c)), false)

/* --------------------------------------------------------- the payment -- */
section('when to ask what they paid')

const ISSUE = single('issue', [
  { value: 'no_dispense', label: 'Nothing came out', payment: true },
  { value: 'machine_fault', label: 'Machine broken' },
], { mapsTo: 'issue_type', optional: false })

eq('a payment-flagged option asks for the amount',
  isPaymentIssue([ISSUE], { issue: 'no_dispense' }), true)
eq('an ordinary fault does not',
  isPaymentIssue([ISSUE], { issue: 'machine_fault' }), false)
eq('no answer does not',
  isPaymentIssue([ISSUE], {}), false)
// The flag has to come from the issue question, not any question that happens
// to carry a payment option.
eq('a payment flag on a non-issue question is ignored',
  isPaymentIssue([single('other', [{ value: 'x', label: 'X', payment: true }])], { other: 'x' }),
  false)

/* ------------------------------------------------- the premix question -- */
section('a row per drink, each rated on the same scale')

// The drinks and the scale are separate lists, so a flavour can be added
// without touching the scale. Each side is whitelisted against its own list.
const PREMIX = {
  key: 'premix', type: 'item_grid', title: 'premix', optional: true,
  options: [
    { value: 'coffee', label: 'Coffee' },
    { value: 'masala_tea', label: 'Masala tea' },
  ],
  scale: [
    { value: 'weak', label: 'Too weak' },
    { value: 'right', label: 'Just right' },
    { value: 'strong', label: 'Too sweet' },
  ],
}

eq('several drinks are rated in one answer',
  validateAnswers([PREMIX], { premix: { coffee: 'right', masala_tea: 'weak' } }).answers,
  { premix: { coffee: 'right', masala_tea: 'weak' } })

// "Didn't try" is a row the form clears rather than a value it sends: it and
// "not answered" are the same thing to anyone counting, and a stored value
// meaning "no data" is one every query would have to filter out.
eq('drinks they did not rate are simply absent',
  validateAnswers([PREMIX], { premix: { coffee: 'right' } }).answers,
  { premix: { coffee: 'right' } })
eq('an empty grid is no answer at all',
  validateAnswers([PREMIX], { premix: {} }).answers, {})

eq('a drink that is not on the list is dropped, the rest kept',
  validateAnswers([PREMIX], { premix: { espresso: 'right', coffee: 'weak' } }).answers,
  { premix: { coffee: 'weak' } })
eq('a level that is not on the scale is dropped',
  validateAnswers([PREMIX], { premix: { coffee: 'perfect' } }).answers, {})
// The two lists are not interchangeable, which is exactly what a crafted
// payload would try.
eq('the lists are not swappable',
  validateAnswers([PREMIX], { premix: { right: 'coffee' } }).answers, {})

eq('a string instead of an object is dropped',
  validateAnswers([PREMIX], { premix: 'coffee' }).answers, {})
eq('an array is not a grid',
  validateAnswers([PREMIX], { premix: ['coffee'] }).answers, {})
eq('required and unanswered is an error',
  validateAnswers([{ ...PREMIX, optional: false }], {}).errors.length, 1)
eq('required is satisfied by one rated drink',
  validateAnswers([{ ...PREMIX, optional: false }], { premix: { coffee: 'weak' } }).errors, [])

// It has a shape, so it is stored as JSON rather than dropped into a column
// as "[object Object]".
eq('a mapped grid is stored as JSON',
  validateAnswers([{ ...PREMIX, mapsTo: 'product_category' }],
    { premix: { coffee: 'weak' } }).mapped,
  { product_category: '{"coffee":"weak"}' })

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
