/**
 * Tests for margin arithmetic and cost resolution.
 *
 *   node tests/sales-unit.mjs
 *
 * The thing being pinned down is the accounting convention. Both sides of a
 * margin have to be net of GST -- revenue from the line's taxable amount, cost
 * excluding GST because input credit is a receivable. Mixing them produces a
 * margin that looks plausible and is wrong by the tax rate, which is exactly the
 * kind of error nobody notices until a quarter has been reported on it.
 */

import { netRevenue, resolveCost, validateSupplierPrice } from '../worker/inv-sales.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const truthy = (n, v) => eq(n, !!v, true)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

/* -------------------------------------------------------------- revenue --- */
section('net revenue')

// Rs 20 vend of a 12% item: Rs 17.86 taxable + Rs 2.14 GST.
eq('taxableAmount is used when VLite gives it',
  netRevenue({ taxableAmount: 1786, gst: 214, amountPaise: 2000 }),
  { taxablePaise: 1786, gstPaise: 214 })

eq('without it, tax is backed out of the gross',
  netRevenue({ amountPaise: 2000, gst: 214 }),
  { taxablePaise: 1786, gstPaise: 214 })

eq('cgst + sgst are summed when there is no single gst field',
  netRevenue({ amountPaise: 2000, cgst: 107, sgstOrUtgst: 107 }),
  { taxablePaise: 1786, gstPaise: 214 })

eq('a zero-rated line is all revenue',
  netRevenue({ taxableAmount: 2000, gst: 0 }), { taxablePaise: 2000, gstPaise: 0 })

truthy('revenue is never negative even on odd data',
  netRevenue({ amountPaise: 100, gst: 500 }).taxablePaise === 0)

// The mistake this convention exists to prevent.
const gross = 2000
const net = netRevenue({ taxableAmount: 1786, gst: 214 }).taxablePaise
const cost = 1420
truthy('using gross revenue would overstate margin',
  (gross - cost) > (net - cost))
eq('the overstatement is exactly the GST', (gross - cost) - (net - cost), 214)

/* ----------------------------------------------------------- cost chain --- */
section('cost resolution')

const qty = 3000   // 3 units

eq('the exact batch wins',
  resolveCost({ qtyMilli: qty, batch: { unit_cost_paise: 1420 }, latestBatch: { unit_cost_paise: 9999 } }),
  { costPaise: 4260, source: 'batch' })

eq('falls back to the latest batch',
  resolveCost({ qtyMilli: qty, latestBatch: { unit_cost_paise: 1420 } }),
  { costPaise: 4260, source: 'latest_batch' })

eq('then to a supplier price',
  resolveCost({ qtyMilli: qty, supplierPrice: { price_paise: 1420, pack_milli: 1000 } }),
  { costPaise: 4260, source: 'supplier_price' })

// A case price has to be divided down before it can be a unit cost.
eq('a case price is divided to a unit cost',
  resolveCost({ qtyMilli: 1000, supplierPrice: { price_paise: 34_080, pack_milli: 24_000 } }),
  { costPaise: 1420, source: 'supplier_price' })

eq('with nothing available the cost is unknown, NOT zero',
  resolveCost({ qtyMilli: qty }), { costPaise: null, source: 'unknown' })

truthy('an unknown cost must not be reported as full profit',
  resolveCost({ qtyMilli: qty }).costPaise === null)

eq('a zero-cost batch is still a known cost',
  resolveCost({ qtyMilli: qty, batch: { unit_cost_paise: 0 } }),
  { costPaise: 0, source: 'batch' })

/* ------------------------------------------------------ supplier prices --- */
section('supplier price validation')

const ok = validateSupplierPrice({
  supplierId: 'sup_1', productId: 'prd_1', price: '14.20', gstBps: 1200,
  packSize: '1', effectiveFrom: '2026-08-01',
})
truthy('a good price validates', ok.ok)
eq('rupees become paise', ok.value.price_paise, 1420)
eq('pack size becomes thousandths', ok.value.pack_milli, 1000)

const caseP = validateSupplierPrice({
  supplierId: 'sup_1', productId: 'prd_1', price: '340.80', packSize: '24', effectiveFrom: '2026-08-01',
})
eq('a case price is captured with its pack size', [caseP.value.price_paise, caseP.value.pack_milli], [34_080, 24_000])

eq('a missing supplier is refused',
  validateSupplierPrice({ productId: 'p', price: '1' }).errors[0], 'Choose a supplier.')
eq('a missing price is refused',
  validateSupplierPrice({ supplierId: 's', productId: 'p' }).errors[0], 'Enter a price, excluding GST.')
truthy('an end date before the start is refused',
  !validateSupplierPrice({
    supplierId: 's', productId: 'p', price: '1',
    effectiveFrom: '2026-08-10', effectiveTo: '2026-08-01',
  }).ok)
eq('a GST rate outside the real set falls back to zero rather than being stored',
  validateSupplierPrice({ supplierId: 's', productId: 'p', price: '1', gstBps: 777 }).value.gst_bps, 0)
truthy('a zero pack size is refused rather than dividing by zero',
  !validateSupplierPrice({ supplierId: 's', productId: 'p', price: '1', packSize: '0' }).ok)

/* -------------------------------------------------- end-to-end arithmetic - */
section('a whole line, end to end')

// 3 units at Rs 20 each of a 12% item, bought at Rs 14.20 a unit.
const line = { taxableAmount: 5358, gst: 642, amountPaise: 6000 }
const rev = netRevenue(line)
const c = resolveCost({ qtyMilli: 3000, batch: { unit_cost_paise: 1420 } })
const margin = rev.taxablePaise - c.costPaise
eq('net revenue', rev.taxablePaise, 5358)
eq('cost', c.costPaise, 4260)
eq('margin in paise', margin, 1098)
eq('margin rate, to a tenth of a point',
  `${(Math.round((margin / rev.taxablePaise) * 10_000) / 100).toFixed(1)}%`, '20.5%')

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
