/**
 * Unit tests for the pure logic in worker/inventory.js.
 *
 *   node tests/inventory-unit.mjs
 *
 * No database and no network: everything here is arithmetic and string
 * handling, which is exactly the part that must be right to the last paisa.
 */

import {
  apportionCharges,
  batchCode,
  classifyD1Error,
  fefoOnLoad,
  normaliseBatchCode,
  normaliseOccurredAt,
  pullReturnZone,
  unitCost,
  writeOffZone,
} from '../worker/inventory.js'

let pass = 0
let fail = 0

const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`) }
}
const truthy = (name, got) => eq(name, !!got, true)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`)

/* ------------------------------------------------------------ batch codes -- */
section('batch codes')

eq('seq 1 -> B00015',    batchCode(1),    'B00015')
eq('seq 2 -> B0002A',    batchCode(2),    'B0002A')
eq('seq 4321 -> B0471D', batchCode(4321), 'B0471D')
truthy('every code is 6 chars', [1, 2, 31, 32, 1000, 1048575].every((n) => batchCode(n).length === 6))
truthy('every code starts with B', [1, 999, 50_000].every((n) => batchCode(n)[0] === 'B'))
truthy('codes are unique across 5000 sequences',
  new Set(Array.from({ length: 5000 }, (_, i) => batchCode(i + 1))).size === 5000)

truthy('the ambiguous letters never appear',
  Array.from({ length: 3000 }, (_, i) => batchCode(i + 1)).every((c) => !/[ILOU]/.test(c.slice(1))))

// round trip
truthy('a generated code validates', [1, 77, 4321, 99999].every((n) => normaliseBatchCode(batchCode(n)) === batchCode(n)))

// the check character earns its keep
const good = batchCode(4321)
eq('lowercase input is accepted', normaliseBatchCode(good.toLowerCase()), good)
eq('spaces and hyphens are stripped', normaliseBatchCode(` ${good.slice(0,3)}-${good.slice(3)} `), good)
eq('O is read as 0', normaliseBatchCode(batchCode(32).replace(/0/g, 'O')), batchCode(32))
eq('garbage is rejected', normaliseBatchCode('HELLO!'), null)
eq('wrong length is rejected', normaliseBatchCode('B123'), null)
eq('not a string is rejected', normaliseBatchCode(12345), null)

// every single-character substitution must fail the check
let caughtSub = 0
let totalSub = 0
for (const seq of [7, 512, 65_000]) {
  const code = batchCode(seq)
  for (let i = 1; i < 6; i++) {
    for (const ch of BATCH_ALPHABET_LOCAL()) {
      if (ch === code[i]) continue
      totalSub++
      const mutated = code.slice(0, i) + ch + code.slice(i + 1)
      if (normaliseBatchCode(mutated) !== code) caughtSub++
    }
  }
}
eq(`all ${totalSub} single-character typos are caught`, caughtSub, totalSub)

// adjacent transpositions
let caughtTr = 0
let totalTr = 0
for (const seq of [7, 512, 65_000, 4321]) {
  const code = batchCode(seq)
  for (let i = 1; i < 5; i++) {
    if (code[i] === code[i + 1]) continue
    totalTr++
    const sw = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2)
    if (normaliseBatchCode(sw) !== code) caughtTr++
  }
}
eq(`all ${totalTr} adjacent transpositions are caught`, caughtTr, totalTr)

function BATCH_ALPHABET_LOCAL() { return '0123456789ABCDEFGHJKMNPQRSTVWXYZ' }

/* -------------------------------------------------------------- costing --- */
section('landed cost')

// 240 units at Rs 14.20, 12% GST. Taxable 3,40,800 paise; tax 40,896.
const line = {
  qty_milli: 240_000, free_qty_milli: 0,
  taxable_paise: 340_800, discount_paise: 0, landed_extra_paise: 0,
  cgst_paise: 20_448, sgst_paise: 20_448, igst_paise: 0,
}
eq('ex-GST unit cost is the rate itself', unitCost(line).unitCostPaise, 1420)
eq('incl-GST unit cost adds the tax', unitCost(line).unitCostInclGstPaise, 1590)
eq('a non-ITC bill capitalises the tax',
  unitCost(line, { itcEligible: false }).unitCostPaise, 1590)

// buy 10 get 1 free: 11 units carry 10 units' cost
const freebie = {
  qty_milli: 10_000, free_qty_milli: 1_000,
  taxable_paise: 100_000, discount_paise: 0, landed_extra_paise: 0,
  cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
}
// Rs 1,000 taxable for 10 paid units is Rs 100 (10,000 paise) a unit at the
// headline rate; spread over the 11 units actually received it is Rs 90.91.
eq('free goods dilute the unit cost (11 units carry 10 units cost)',
  unitCost(freebie).unitCostPaise, 9091)
truthy('...which is below the headline rate of 10,000 paise',
  unitCost(freebie).unitCostPaise < 10_000)

eq('a discount reduces the unit cost',
  unitCost({ ...line, discount_paise: 34_080 }).unitCostPaise, 1278)
eq('freight increases it',
  unitCost({ ...line, landed_extra_paise: 24_000 }).unitCostPaise, 1520)
eq('zero units cannot divide by zero',
  unitCost({ ...line, qty_milli: 0, free_qty_milli: 0 }).unitCostPaise, 0)

/* --------------------------------------------------------- apportionment -- */
section('apportioning freight')

const three = [
  { taxable_paise: 100_000 },
  { taxable_paise: 50_000 },
  { taxable_paise: 25_000 },
]
const split = apportionCharges(three, 7_000)
eq('apportionment sums back to the charge exactly', split.reduce((a, b) => a + b, 0), 7_000)
truthy('the largest line carries the most', split[0] > split[1] && split[1] > split[2])

const odd = apportionCharges([{ taxable_paise: 1 }, { taxable_paise: 1 }, { taxable_paise: 1 }], 100)
eq('an indivisible charge still sums exactly', odd.reduce((a, b) => a + b, 0), 100)
eq('no charge means no apportionment', apportionCharges(three, 0), [0, 0, 0])
eq('a zero taxable base splits evenly and still sums',
  apportionCharges([{ taxable_paise: 0 }, { taxable_paise: 0 }], 7).reduce((a, b) => a + b, 0), 7)

/* ------------------------------------------------------------ FEFO on load - */
section('FEFO on load')

const layers = [
  { seq: 1, batchCode: 'BFRONT', expiryDate: '2026-09-12', qtyMilli: 3_000 },
  { seq: 2, batchCode: 'BBACK1', expiryDate: '2026-12-08', qtyMilli: 20_000 },
]
truthy('a longer-dated batch may go behind the front layer',
  fefoOnLoad(layers, '2026-10-01').ok)
eq('a shorter-dated batch is refused',
  fefoOnLoad(layers, '2026-08-20').ok, false)
truthy('the refusal names the front layer and says what to do',
  /BFRONT/.test(fefoOnLoad(layers, '2026-08-20').reason)
  && /[Pp]ull the front layer/.test(fefoOnLoad(layers, '2026-08-20').reason))
truthy('same expiry is allowed', fefoOnLoad(layers, '2026-09-12').ok)
truthy('an empty slot accepts anything', fefoOnLoad([], '2026-01-01').ok)
truthy('a front layer with no expiry does not block',
  fefoOnLoad([{ seq: 1, batchCode: 'BNOEXP', expiryDate: null, qtyMilli: 5 }], '2026-01-01').ok)

/* ------------------------------------------------------- return routing --- */
section('return routing')

eq('expired pulls are segregated', pullReturnZone('expired'), 'WH-MLR/EXPIRED')
eq('recalled pulls go to quarantine', pullReturnZone('recall'), 'WH-MLR/QUAR')
eq('damaged pulls go to quarantine', pullReturnZone('damaged'), 'WH-MLR/QUAR')
eq('a planogram change returns to main', pullReturnZone('planogram_change'), 'WH-MLR/MAIN')
eq('slow movers return to main', pullReturnZone('slow_moving'), 'WH-MLR/MAIN')
eq('an unknown reason fails safe to quarantine', pullReturnZone('nonsense'), 'WH-MLR/QUAR')
truthy('no pull reason routes expired stock back to pickable storage',
  pullReturnZone('expired') !== 'WH-MLR/MAIN')

eq('expired write-offs segregate', writeOffZone('expired'), 'WH-MLR/EXPIRED')
eq('theft has no zone', writeOffZone('theft'), null)

/* -------------------------------------------------------------- clocks ---- */
section('clock skew')

const now = Date.parse('2026-08-17T10:00:00Z')
eq('a missing timestamp is fine', normaliseOccurredAt(null, now).occurredAt, null)
eq('a sane timestamp is kept',
  normaliseOccurredAt('2026-08-17T09:41:22+05:30', now).occurredAt, '2026-08-17 04:11:22')
truthy('nonsense is rejected', !normaliseOccurredAt('yesterday afternoon', now).ok)

const ahead = normaliseOccurredAt('2026-08-17T12:00:00Z', now)
truthy('a clock an hour ahead is accepted, not refused', ahead.ok)
eq('...and clamped to server time', ahead.occurredAt, '2026-08-17 10:00:00')
truthy('...with the skew recorded for a report', ahead.skewMs > 0)

const small = normaliseOccurredAt('2026-08-17T10:02:00Z', now)
eq('a two-minute lead is within tolerance and kept as-is', small.occurredAt, '2026-08-17 10:02:00')

const ancient = normaliseOccurredAt('2026-08-01T10:00:00Z', now)
truthy('a fortnight-old action is refused', !ancient.ok)
eq('...as stale_action', ancient.error, 'stale_action')

const sixDays = normaliseOccurredAt('2026-08-11T10:00:00Z', now)
truthy('a six-day-old queued action is still accepted', sixDays.ok)

/* --------------------------------------------------------- error mapping -- */
section('D1 error mapping')

const cls = (msg) => classifyD1Error(new Error(msg))
eq('the balance floor becomes 409 insufficient_stock',
  [cls('CHECK constraint failed: qty_milli >= floor_milli').status,
   cls('CHECK constraint failed: qty_milli >= floor_milli').error],
  [409, 'insufficient_stock'])
eq('expired becomes 422 expired_batch',
  cls('SQLITE_CONSTRAINT: expired_batch: expired stock cannot be picked').error, 'expired_batch')
eq('short shelf life becomes 422', cls('short_shelf_life: below the minimum').status, 422)
eq('quarantine is reported as such', cls('batch_not_active: quarantined').error, 'batch_not_active')
eq('an unpickable zone is reported as such', cls('not_pickable: nope').error, 'not_pickable')
eq('editing history becomes 409',
  cls('stock_movements is append-only: post a reversal instead').error, 'ledger_append_only')
eq('a duplicate supplier bill becomes 409',
  cls('UNIQUE constraint failed: index idx_pb_supplier_billno').error, 'duplicate_bill')
eq('a bad reference becomes 422',
  cls('FOREIGN KEY constraint failed').error, 'unknown_reference')
eq('an unrecognised error is not swallowed', cls('disk exploded'), null)
truthy('every mapped error carries a human sentence',
  ['qty_milli >= floor_milli', 'expired_batch', 'short_shelf_life', 'batch_not_active',
   'not_pickable', 'append-only', 'FOREIGN KEY constraint failed']
    .every((m) => (cls(m).message || '').length > 20))

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
