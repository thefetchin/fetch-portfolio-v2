/**
 * Tests for the VLite catalogue import.
 *
 *   node tests/catalogue-unit.mjs
 *
 * The two things worth pinning down before this runs against a live catalogue:
 * that a GST rate inferred from tax AMOUNTS lands on a real Indian rate, and
 * that customProductId is read as the barcode -- that field is what makes a
 * scanned EAN resolve to a product at goods-in.
 */

import { deriveGstBps, getProducts } from '../worker/vlite.js'
import { guessCategory } from '../worker/inv-catalogue.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const truthy = (n, v) => eq(n, !!v, true)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

/* ---------------------------------------------------------- GST inference -- */
section('GST inferred from tax amounts')

// VLite gives tax as paise amounts, not a rate. Rs 35 MRP, Rs 31.25 taxable,
// 187 + 188 paise tax = 12%.
eq('12% from a 187/188 paise split', deriveGstBps({ taxablePriceS: 3125, cgst: 187, sgst: 188 }), 1200)
eq('5% ',  deriveGstBps({ taxablePriceS: 10000, cgst: 250, sgst: 250 }), 500)
eq('18%',  deriveGstBps({ taxablePriceS: 10000, cgst: 900, sgst: 900 }), 1800)
eq('28%',  deriveGstBps({ taxablePriceS: 10000, cgst: 1400, sgst: 1400 }), 2800)
eq('0% when there is no tax', deriveGstBps({ taxablePriceS: 10000, cgst: 0, sgst: 0 }), 0)

// A paisa of rounding must not invent a rate the CHECK constraint would refuse.
eq('a rounding artefact snaps to 12%', deriveGstBps({ taxablePriceS: 3125, cgst: 188, sgst: 188 }), 1200)
eq('and off the other side too',       deriveGstBps({ taxablePriceS: 3125, cgst: 186, sgst: 187 }), 1200)
eq('UT GST is counted as well',        deriveGstBps({ taxablePriceUT: 10000, utgst: 1800 }), 1800)

// Nothing to derive from, or nowhere near a real rate: say so rather than
// assert a wrong 0%.
eq('no taxable price -> unknown', deriveGstBps({ cgst: 100, sgst: 100 }), null)
eq('nonsense ratio -> unknown',   deriveGstBps({ taxablePriceS: 100, cgst: 900, sgst: 900 }), null)
eq('missing product -> unknown',  deriveGstBps(null), null)

/* ------------------------------------------------------- category guessing -- */
section('category guessing')

eq('water',      guessCategory('Beverages', 'Packaged Water', 'Bisleri 1L'), 'water')
eq('cold drink', guessCategory('Beverages', 'Carbonated', 'Coca-Cola 300ml'), 'cold_drink')
eq('coffee',     guessCategory('Hot', 'Coffee', 'Sweet Karam Coffee 200g'), 'coffee_tea')
eq('chips',      guessCategory('Snacks', 'Namkeen', "Lay's Magic Masala 52g"), 'chips')
eq('chocolate',  guessCategory('Confectionery', 'Bars', 'Dairy Milk 25g'), 'chocolate')
eq('protein',    guessCategory('Nutrition', 'Bars', 'SuperYou Protein Bar'), 'protein')
eq('ready meal', guessCategory('Food', 'Instant', 'Cup Noodles Masala'), 'ready_meal')
eq('unknown falls back rather than guessing wildly',
  guessCategory('Misc', 'Sundry', 'Assorted thing'), 'other')
eq('empty input is safe', guessCategory(null, null, null), 'other')

/* ------------------------------------------------- reading the catalogue --- */
section('reading the catalogue')

const env = { VLITE_MOBILE: '9000000000', VLITE_PASSWORD: 'pw', VLITE_BASE_URL: 'https://vlite.test' }
const jsonRes = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })

const PRODUCT = {
  id: 84469,
  name: "Lay's Magic Masala 52g",
  displayProductId: 'PR0084469',
  customProductId: '8901491101837',   // <- the barcode
  hsnCode: '2005',
  mrp: 2000,
  taxablePriceS: 1786,
  cgst: 107,
  sgst: 107,
  cost: 1420,
  active: 1,
  'sub_category.name': 'Namkeen',
  'sub_category.category.name': 'Snacks',
  'sub_category.category.brand.name': "Lay's",
}

let pagesServed = 0
globalThis.fetch = async (url, init) => {
  const endpoint = String(url).split('/').pop()
  const body = init?.body ? JSON.parse(init.body) : {}
  if (endpoint === 'login') return jsonRes({ token: 'jwt' })
  if (endpoint === 'getProductList') {
    pagesServed++
    // Two full pages then a short one, so pagination is actually exercised.
    if (body.page === 0) return jsonRes({ data: Array.from({ length: 100 }, (_, i) => ({ ...PRODUCT, id: 1000 + i })) })
    if (body.page === 1) return jsonRes({ data: Array.from({ length: 100 }, (_, i) => ({ ...PRODUCT, id: 2000 + i })) })
    return jsonRes({ data: [PRODUCT] })
  }
  return jsonRes({ code: 'NOT_STUBBED' }, 404)
}

const all = await getProducts(env)
eq('pages to the end rather than taking the first page', all.length, 201)
eq('three pages were fetched', pagesServed, 3)

const p = all[all.length - 1]
eq('customProductId is surfaced as the barcode', p.barcode, '8901491101837')
eq('vlite id is kept for the link', p.vliteProductId, 84469)
eq('MRP stays in paise', p.mrpPaise, 2000)
eq('HSN comes across', p.hsn, '2005')
eq('GST is derived (107+107 on 1786 = 12%)', p.gstBps, 1200)
eq('brand and category come across for the guess', [p.brand, p.category], ["Lay's", 'Snacks'])
truthy('no expiry is read from VLite anywhere',
  !JSON.stringify(all[0]).toLowerCase().includes('expir'))

// A product with no barcode must still import -- it simply cannot be scanned,
// and that is worth flagging rather than dropping the row.
globalThis.fetch = async (url) => {
  const e = String(url).split('/').pop()
  if (e === 'login') return jsonRes({ token: 'jwt' })
  return jsonRes({ data: [{ ...PRODUCT, customProductId: '   ', id: 5 }] })
}
const noBar = await getProducts(env)
eq('a blank barcode becomes null, not an empty string', noBar[0].barcode, null)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
