/**
 * Tests for the VLite <-> vNetra catalogue comparison.
 *
 *   node tests/vnetra-unit.mjs
 *
 * The thing that must not go wrong: pairing two DIFFERENT products. A false
 * match means a push lands on the wrong product in a live vending catalogue,
 * and nobody finds out until a customer is charged for the wrong thing. So the
 * match is exact-on-code and the tests below mostly prove what it REFUSES to
 * do.
 */

import {
  normaliseCode, sameName, normaliseVnetraProducts, compareCatalogues, CODE_RE,
} from '../worker/vnetra.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

/* ------------------------------------------------------------ the code --- */
section('the product code is the whole match')

eq('trims and upper-cases', normaliseCode('  at1cad0021943 '), 'AT1CAD0021943')
eq('strips inner whitespace', normaliseCode('AT1CAD 0021943'), 'AT1CAD0021943')
eq('empty is null', normaliseCode('   '), null)
eq('not a string is null', normaliseCode(42), null)

eq('a real code matches the format', CODE_RE.test('AT1CAD0021943'), true)
eq('too few digits is refused',      CODE_RE.test('AT1CAD002194'), false)
eq('a different prefix is refused',  CODE_RE.test('XX1CAD0021943'), false)

// Leading zeros and punctuation are NOT normalised away: doing so would let
// two genuinely different codes collide, which is the one failure that matters.
eq('a code differing only in a zero stays different',
  normaliseCode('AT1CAD0021943') === normaliseCode('AT1CAD0021940'), false)

/* ------------------------------------------------------------- naming ---- */
section('names flag, they never match')

eq('cosmetic punctuation is the same name',
  sameName("Lay's Magic Masala 52g", 'Lays Magic Masala 52g'), true)
eq('case and spacing are the same name',
  sameName('CADBURY  DAIRY MILK', 'Cadbury Dairy Milk'), true)
eq('a different weight is a DIFFERENT name',
  sameName('Lays Magic Masala 52g', 'Lays Magic Masala 26g'), false)
eq('a missing name is unknown, not different',
  sameName('Lays', null), null)

/* -------------------------------------------------------- the snapshot --- */
section('reading a captured vNetra list')

const snap = normaliseVnetraProducts([
  { code: 'AT1CAD0021943', name: 'Cadbury Dairy Milk', hasImage: true },
  { code: 'at1lay0020875', name: 'Lays Magic Masala' },
  { name: 'No code at all' },
  { code: 'NONSENSE', name: 'Bad format' },
  { code: 'AT1CAD0021943', name: 'Duplicate row' },
  'not an object',
])
eq('good rows survive, upper-cased', snap.rows.map((r) => r.code),
  ['AT1CAD0021943', 'AT1LAY0020875'])
eq('hasImage is captured', snap.rows[0].hasImage, 1)

// Rejections are REPORTED. A snapshot that silently lost rows would read as
// "vNetra is missing these products" and send someone pushing duplicates.
eq('every unusable row is reported', snap.rejected.map((r) => r.reason),
  ['no_code', 'bad_code_format', 'duplicate_in_snapshot', 'not_an_object'])

/* ------------------------------------------------------- the comparison -- */
section('comparing the two catalogues')

const vlite = [
  { vliteProductId: 1, displayProductId: 'AT1CAD0021943', name: 'Cadbury Dairy Milk', mrpPaise: 2000, image: 'x.png' },
  { vliteProductId: 2, displayProductId: 'AT1LAY0020875', name: 'Lays Magic Masala 52g' },
  { vliteProductId: 3, displayProductId: 'AT1DOR0020871', name: 'Doritos Nacho' },
  { vliteProductId: 4, displayProductId: null, name: 'Something with no code' },
]
const vnetra = [
  { code: 'AT1CAD0021943', name: 'Cadbury Dairy Milk', has_image: 1 },
  { code: 'AT1LAY0020875', name: 'Lays Magic Masala 26g' },   // same code, different name
  { code: 'AT1PEP0099999', name: 'Only in vNetra' },
]

const r = compareCatalogues(vlite, vnetra)

eq('counted correctly', r.summary, {
  vlite: 4, vnetra: 3, matched: 1, nameMismatch: 1,
  missingInVnetra: 1, missingInVlite: 1, noCode: 1,
})
eq('the one to push is the one genuinely absent',
  r.missingInVnetra.map((x) => x.code), ['AT1DOR0020871'])
eq('a product only vNetra has is reported, not pushed',
  r.missingInVlite.map((x) => x.code), ['AT1PEP0099999'])
eq('same code + different name is a mismatch for a human, still matched by code',
  r.nameMismatch.map((x) => [x.code, x.vliteName, x.vnetraName]),
  [['AT1LAY0020875', 'Lays Magic Masala 52g', 'Lays Magic Masala 26g']])

// A codeless product must never be reported as "missing from vNetra": that
// reads as "push it", and pushing something we cannot match is how duplicates
// get created.
eq('a codeless VLite product is quarantined, not queued for push',
  [r.noCode.length, r.missingInVnetra.some((x) => x.name === 'Something with no code')],
  [1, false])

eq('a push candidate carries what a push would need',
  Object.keys(r.missingInVnetra[0]).sort(),
  ['barcode', 'code', 'gstBps', 'hasImage', 'hsn', 'mrpPaise', 'name', 'vliteProductId'])

/* Empty on either side must not be read as "everything is missing". */
const noneHere = compareCatalogues([], vnetra)
eq('an empty VLite list reports nothing to push', noneHere.summary.missingInVnetra, 0)
eq('and reports what vNetra holds', noneHere.summary.missingInVlite, 3)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
