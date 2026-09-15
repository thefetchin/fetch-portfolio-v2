/**
 * Tests for the vNetra bulk-upload CSV.
 *
 *   node tests/vnetra-csv-unit.mjs
 *
 * This file sets prices and tax rates on a live vending catalogue, so the tax
 * split is the part that matters. The cases below are the ones the Python
 * exporter was built against using real VLite data -- keeping them here means
 * the port cannot quietly disagree with the original.
 */

import {
  impliedTotal, splitTotal, pctOf, rupees, rowFor, toCsv, CSV_COLUMNS,
} from '../shared/vnetraCsv.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const split = (mrp, taxable) => {
  const { cgst, sgst, cess, igst } = splitTotal(impliedTotal(mrp, taxable))
  return [cgst, sgst, cess, igst]
}

/* ------------------------------------------------------------- the rates -- */
section('GST split, from real catalogue values')

eq('5%  -> 2.5 + 2.5', split(2000, 1905), [2.5, 2.5, 0, 0])
eq('12% -> 6 + 6',     split(3000, 2679), [6, 6, 0, 0])
eq('18% -> 9 + 9',     split(3500, 2966), [9, 9, 0, 0])
eq('zero rated',       split(2000, 2000), [0, 0, 0, 0])

// Aerated and energy drinks sit at 40%, which is 28% GST plus 12% cess. Cess
// is not part of a GST rate, so it gets its own column rather than inflating
// CGST and SGST to 20 each -- which is exactly the invalid split vNetra
// currently shows for 7 Up.
eq('40% is 28% GST + 12% cess, not 20 + 20', split(4000, 2857), [14, 14, 12, 0])

// A paisa of rounding must not invent a rate.
eq('4.99% snaps to 5%', split(3500, 3334), [2.5, 2.5, 0, 0])

/* 10% is not a slab. In the live data it is 5 typed into both boxes, so it is
   reproduced as 5 + 5 and flagged rather than silently "corrected". */
const ten = splitTotal(impliedTotal(3500, 3182))
eq('10% is reproduced as 5 + 5', [ten.cgst, ten.sgst], [5, 5])
eq('and it is flagged for a human', /not a GST slab/.test(ten.flag), true)

const nonsense = splitTotal(impliedTotal(7000, 3571))
// 96.02 halved. Verified to the paisa against the Python exporter this was
// ported from, which is the only check that the port did not drift.
eq('an unrecognisable rate is still written', [nonsense.cgst, nonsense.sgst], [48.01, 48.01])
eq('and flagged', /not a recognisable rate/.test(nonsense.flag), true)

const none = splitTotal(impliedTotal(null, null))
eq('no prices -> nulls and a flag',
  [none.cgst, /no MRP or taxable price/.test(none.flag)], [null, true])

eq('the amount fields are the fallback', Math.round(pctOf(375, 3125)), 12)
eq('a zero taxable value is not divided by', pctOf(100, 0), null)

/* --------------------------------------------------------------- money --- */
section('prices')

eq('whole rupees keep two decimals', rupees(3500), '35.00')
eq('paise survive',                  rupees(1250), '12.50')
eq('zero is a price, not blank',     rupees(0), '0.00')
eq('missing is blank, never 0.00',   rupees(null), '')
eq('undefined is blank too',         rupees(undefined), '')
eq('an empty string is blank',       rupees(''), '')
eq('a zero MRP product carries no price rather than a free one',
  rowFor({ displayProductId: 'AT1AAA0000001', name: 'No price' }).row['Selling Price'], '')

/* ----------------------------------------------------------------- rows --- */
section('a product becomes a row')

const { row, flag, hsn } = rowFor({
  displayProductId: 'at1new0000001', name: 'New Thing 40g', brand: 'Brandy',
  category: 'Snacks', mrpPaise: 3500, taxablePaise: 2966, hsn: '1905',
})
eq('the code is upper-cased', row['Product Code'], 'AT1NEW0000001')
eq('price is the MRP, the figure the tax was derived against', row['Selling Price'], '35.00')
eq('name doubles as the description', row['Product Description'], 'New Thing 40g')
eq('HSN comes across', [row['HSN Code'], hsn], ['1905', '1905'])
eq('nothing to flag here', flag, null)

// Stock in vNetra comes from loading a machine. Inventing an opening quantity
// would put phantom stock on the books for every product in the file.
eq('stock quantity is zero, deliberately', row['Stock Qty'], 0)

/* ------------------------------------------------------------------ csv --- */
section('the file itself')

const csv = toCsv([
  rowFor({ displayProductId: 'AT1AAA0000001', name: 'Plain', mrpPaise: 1000, taxablePaise: 893 }).row,
  rowFor({ displayProductId: 'AT1BBB0000002', name: 'Lay\'s "Magic", Masala', mrpPaise: 2000, taxablePaise: 1905 }).row,
])
const lines = csv.trim().split('\r\n')

eq('header first, in template order', lines[0],
  CSV_COLUMNS.map((c) => `"${c}"`).join(','))
eq('one line per product', lines.length, 3)

// A product name with a comma in it would shift every later column by one if
// the field were not quoted -- so the prices would land in the wrong columns.
eq('a comma in a name does not shift the columns',
  lines[2].split('","').length, CSV_COLUMNS.length)
// Only the double quote is doubled; the apostrophe is an ordinary character.
eq('an embedded quote is doubled', lines[2].includes('Lay\'s ""Magic"", Masala'), true)
eq('CRLF line endings', csv.includes('\r\n'), true)
eq('and a trailing newline, or importers drop the last row', csv.endsWith('\r\n'), true)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
