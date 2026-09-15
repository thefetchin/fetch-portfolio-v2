/**
 * Tests for the vNetra bulk-upload spreadsheet.
 *
 *   node tests/vnetra-sheet-unit.mjs
 *
 * This file sets prices and tax rates on a live vending catalogue, so the tax
 * split is the part that matters. The cases below are the ones the Python
 * exporter was built against using real VLite data -- keeping them here means
 * the port cannot quietly disagree with the original.
 */

import {
  impliedTotal, splitTotal, pctOf, priceOf, hsnCell, rowFor, COLUMNS, SHEET_NAME,
} from '../shared/vnetraSheet.js'
import { buildXlsx, colName, crc32 } from '../shared/xlsx.js'

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

// Numbers, not formatted strings: the template's own price cells are numeric.
eq('whole rupees are a number',  priceOf(3500), 35)
eq('paise survive',              priceOf(1250), 12.5)
eq('zero is a price',            priceOf(0), 0)

// Number(null) and Number('') are both 0, so without a guard a product with no
// MRP is priced at zero -- and zero on a vending machine means free.
eq('missing is blank, never 0',  priceOf(null), '')
eq('undefined is blank too',     priceOf(undefined), '')
eq('an empty string is blank',   priceOf(''), '')
eq('a product with no MRP carries no price rather than a free one',
  rowFor({ displayProductId: 'AT1AAA0000001', name: 'No price' }).row['Selling Price'], '')

// HSN codes carry meaningful leading zeros -- 0901 is coffee. Numeric is the
// template's shape, but 0901 as a number is 901, a different code entirely.
eq('an ordinary HSN is numeric',            hsnCell('1905'), 1905)
eq('a leading zero keeps it text',          hsnCell('0901'), '0901')
eq('blank stays blank',                     hsnCell(''), '')
eq('something non-numeric stays as typed',  hsnCell('19-05'), '19-05')

/* ----------------------------------------------------------------- rows --- */
section('a product becomes a row')

const { row, flag, hsn } = rowFor({
  displayProductId: 'at1new0000001', name: 'New Thing 40g', brand: 'Brandy',
  category: 'Snacks', mrpPaise: 3500, taxablePaise: 2966, hsn: '1905',
})
eq('the code is upper-cased', row['Product Code'], 'AT1NEW0000001')
eq('price is the MRP, the figure the tax was derived against', row['Selling Price'], 35)
eq('name doubles as the description', row['Product Description'], 'New Thing 40g')
eq('HSN comes across as a number', [row['HSN Code'], hsn], [1905, '1905'])
eq('nothing to flag here', flag, null)

// Stock in vNetra comes from loading a machine. Inventing an opening quantity
// would put phantom stock on the books for every product in the file.
eq('stock quantity is zero, deliberately', row['Stock Qty'], 0)

/* ----------------------------------------------------------------- xlsx -- */
section('the file itself')

eq('column letters', [colName(1), colName(12), colName(26), colName(27)],
  ['A', 'L', 'Z', 'AA'])

// A known CRC-32, so a broken table shows up here rather than as a file Excel
// silently refuses to open.
eq('crc32 of "123456789"', crc32(new TextEncoder().encode('123456789')), 0xcbf43926)

const bytes = buildXlsx({
  sheetName: SHEET_NAME,
  columns: COLUMNS,
  rows: [
    rowFor({ displayProductId: 'AT1AAA0000001', name: 'Plain', mrpPaise: 1000,
             taxablePaise: 893, hsn: '1905' }).row,
    rowFor({ displayProductId: 'AT1BBB0000002', name: 'Lay\'s "Magic", Masala & <co>',
             mrpPaise: 2000, taxablePaise: 1905, hsn: '0901' }).row,
  ],
})

eq('it is a zip', [bytes[0], bytes[1], bytes[2], bytes[3]], [0x50, 0x4b, 0x03, 0x04])

const text = new TextDecoder().decode(bytes)
eq('[Content_Types].xml is the first entry, as the format requires',
  text.indexOf('[Content_Types].xml') < text.indexOf('xl/workbook.xml'), true)
eq('the sheet is named for the template', text.includes('name="Products"'), true)

// XML, not CSV: a quote or comma in a name is harmless, but a bare & or < is
// not -- it makes the part unparseable and Excel reports the file as corrupt.
eq('ampersands and angle brackets are escaped',
  text.includes('&amp;') && text.includes('&lt;co&gt;'), true)
eq('a raw ampersand never reaches the xml',
  /&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(text.slice(text.indexOf('sheetData'))), false)

// Numbers are numeric cells; text is an inline string. The importer cares.
eq('the price is a numeric cell', /<c r="E2"><v>10<\/v><\/c>/.test(text), true)
eq('the product code is text', text.includes('<c r="A2" t="inlineStr">'), true)


console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
