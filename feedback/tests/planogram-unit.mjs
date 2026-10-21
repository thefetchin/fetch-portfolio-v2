/**
 * Tests for the planogram.
 *
 *   node tests/planogram-unit.mjs
 *
 * Two things carry the weight here. Ranks: "second choice" on a printed sheet
 * has to mean the second row in the panel, so they are rebuilt rather than
 * trusted. And rows: a slot that falls out of the grouping is a slot that does
 * not appear on the sheet, and therefore does not get filled.
 */

import { normaliseChoices, normaliseSlot, imageUrl, MAX_CHOICES_PER_SLOT } from '../worker/planogram.js'
import { groupRows } from '../src/components/planogramPrint.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

const ids = (choices) => choices.map((c) => `${c.rank}:${c.productId}`)

/* --------------------------------------------------------------- ranks -- */
section('the order a refiller reads off the sheet')

eq('ranks are 1..n in the order given',
  ids(normaliseChoices([{ productId: 'a' }, { productId: 'b' }, { productId: 'c' }])),
  ['1:a', '2:b', '3:c'])

// The editor reorders by moving rows, so whatever rank it sends is a
// description of the old order, not the new one.
eq('ranks sent by the client are ignored, position wins',
  ids(normaliseChoices([{ rank: 9, productId: 'a' }, { rank: 1, productId: 'b' }])),
  ['1:a', '2:b'])

// A product that appears twice in one slot can never be reached the second
// time -- the first would have been taken.
eq('a repeated product is dropped',
  ids(normaliseChoices([{ productId: 'a' }, { productId: 'b' }, { productId: 'a' }])),
  ['1:a', '2:b'])

eq('blank entries are dropped, and do not leave a gap in the numbering',
  ids(normaliseChoices([{ productId: '' }, { productId: 'b' }, {}, { productId: 'c' }])),
  ['1:b', '2:c'])

eq('bare strings are accepted',
  ids(normaliseChoices(['a', 'b'])), ['1:a', '2:b'])

eq('a long list is cut to the maximum',
  normaliseChoices(Array.from({ length: 30 }, (_, i) => ({ productId: `p${i}` }))).length,
  MAX_CHOICES_PER_SLOT)

eq('nothing in, nothing out', normaliseChoices(null), [])

/* --------------------------------------------------------------- slots -- */
section('a slot needs a name and nothing else')

eq('a name is enough',
  normaliseSlot({ slotName: 'A1' }),
  { slotName: 'A1', rowNumber: null, columnNumber: null, capacity: null, note: null, choices: [] })

eq('no name, no slot', normaliseSlot({ rowNumber: 1 }), null)

// A row of 0 or 9999 is a typo, not a layout. Dropping the number keeps the
// slot -- it lands in "other slots" on the sheet rather than vanishing.
eq('an impossible row number is dropped, the slot is not',
  normaliseSlot({ slotName: 'A1', rowNumber: 0 }).rowNumber, null)
eq('a fractional row number is dropped',
  normaliseSlot({ slotName: 'A1', rowNumber: 1.5 }).rowNumber, null)
eq('a real row number is kept',
  normaliseSlot({ slotName: 'A1', rowNumber: 3, columnNumber: 2 }),
  { slotName: 'A1', rowNumber: 3, columnNumber: 2, capacity: null, note: null, choices: [] })

// Zero is a real capacity: a slot that is deliberately left empty. Which is
// why "not given" has to be distinguished from it before any conversion --
// Number(null) and Number('') are both 0, and a slot with no capacity typed
// was printing as "holds 0".
eq('a capacity of zero survives', normaliseSlot({ slotName: 'A1', capacity: 0 }).capacity, 0)
eq('no capacity is not a capacity of zero',
  normaliseSlot({ slotName: 'A1', capacity: null }).capacity, null)
eq('an empty box is not a capacity of zero either',
  normaliseSlot({ slotName: 'A1', capacity: '' }).capacity, null)
eq('a missing capacity key is null',
  normaliseSlot({ slotName: 'A1' }).capacity, null)
eq('a negative capacity does not', normaliseSlot({ slotName: 'A1', capacity: -2 }).capacity, null)
// Same trap one field over: an empty row box must not become row 0.
eq('an empty row box is not row zero',
  normaliseSlot({ slotName: 'A1', rowNumber: '' }).rowNumber, null)

/* ---------------------------------------------------------------- grid -- */
section('grouping slots into the rows of the machine')

const grid = groupRows([
  { slotName: 'B2', rowNumber: 2, columnNumber: 2 },
  { slotName: 'A2', rowNumber: 1, columnNumber: 2 },
  { slotName: 'A1', rowNumber: 1, columnNumber: 1 },
  { slotName: 'B1', rowNumber: 2, columnNumber: 1 },
])
eq('rows come out in order',
  grid.map((r) => r.rowNumber), [1, 2])
eq('columns come out in order within a row',
  grid.map((r) => r.cells.map((c) => c.slotName)), [['A1', 'A2'], ['B1', 'B2']])

// A slot with no row still has to be filled, so it is printed at the end
// rather than guessed at or dropped.
const loose = groupRows([
  { slotName: 'A1', rowNumber: 1, columnNumber: 1 },
  { slotName: 'X9' },
])
eq('a slot with no row is kept, in a row of its own',
  loose.map((r) => [r.rowNumber, r.cells.map((c) => c.slotName)]),
  [[1, ['A1']], [null, ['X9']]])

// "10" after "9", not after "1".
eq('slot names sort naturally',
  groupRows([{ slotName: 'A10' }, { slotName: 'A9' }, { slotName: 'A1' }])[0]
    .cells.map((c) => c.slotName),
  ['A1', 'A9', 'A10'])

eq('an empty machine is an empty grid', groupRows([]), [])

/* -------------------------------------------------------------- images -- */
section('product pictures from VLite')

eq('a bare path is made absolute',
  imageUrl('products/lays.png'),
  'https://elite.vendoliteindia.com/api/resource/images/products/lays.png')
eq('a leading slash does not double up',
  imageUrl('/products/lays.png'),
  'https://elite.vendoliteindia.com/api/resource/images/products/lays.png')
eq('an absolute URL is left alone',
  imageUrl('https://cdn.example.com/x.png'), 'https://cdn.example.com/x.png')
eq('no image is null, not an empty URL', imageUrl(''), null)
eq('whitespace is not an image', imageUrl('   '), null)
eq('null is not the string "null"', imageUrl(null), null)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
