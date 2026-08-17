import {
  BATCH_ALPHABET,
  CONTRA_LOCATIONS,
  INV_LIMITS,
  MOVEMENT_REASONS,
  PULL_REASONS,
  WAREHOUSE_ZONES,
  WRITEOFF_REASONS,
  podLocationId,
  transitLocationId,
  valuesOf,
} from '../shared/constants.js'
import { cleanText } from './validate.js'
import { istDateString, istNow, nextCounter, toMilli, toPaise } from './invoicing.js'

/**
 * Inventory: batch codes, the stock ledger, and FEFO.
 *
 * Quantities are integer thousandths (qty_milli) and money is integer paise,
 * matching invoicing.js. Nothing here uses floating point.
 *
 * The guarantees this module depends on live in migrations/004_inventory.sql,
 * not here: append-only movements, a trigger-maintained balance, a CHECK that
 * makes negative stock unrepresentable, and BEFORE INSERT triggers for the
 * expiry gates. This file's job is to build correct double entries and to
 * translate the database's refusals into the Worker's error envelope.
 */

const REASON_SET = valuesOf(MOVEMENT_REASONS)
const WRITEOFF_SET = valuesOf(WRITEOFF_REASONS)
const PULL_SET = valuesOf(PULL_REASONS)

/* ----------------------------------------------------------- batch codes -- */

/**
 * A batch code: 'B' + 4 chars of Crockford base32 + 1 check character.
 *
 * Six characters, because it gets read off a torn sticker by someone in a
 * hurry. Crockford's alphabet omits I, L, O and U so 1/I and 0/O confusion is
 * designed out, and the weighted mod-32 check character catches every
 * single-character error and every adjacent transposition. A mistyped code that
 * silently resolves to the WRONG batch is far worse than one that fails to
 * resolve, which is what the check character is for.
 *
 * Deliberately carries no product or expiry information. A code with meaning in
 * it invites people to read meaning out of one that has been reused, mis-stuck
 * or photocopied; the human-critical facts are printed next to it instead.
 */
export function batchCode(seq) {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('Batch sequence must be a positive integer')

  let n = seq
  let body = ''
  for (let i = 0; i < 4; i++) {
    body = BATCH_ALPHABET[n % 32] + body
    n = Math.floor(n / 32)
  }
  // 32^4 = 1,048,576 codes. At a few thousand batches a year that is centuries,
  // and batches.batch_code is UNIQUE as the backstop.
  if (n !== 0) throw new Error('Batch sequence exceeded the 4-character code space')

  let sum = 0
  for (let i = 0; i < body.length; i++) sum += BATCH_ALPHABET.indexOf(body[i]) * (i + 2)
  return `B${body}${BATCH_ALPHABET[sum % 32]}`
}

/**
 * Normalises a scanned or typed batch code and verifies its check character.
 * Returns the canonical code, or null if it cannot be a valid one.
 */
export function normaliseBatchCode(input) {
  if (typeof input !== 'string') return null

  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')     // Crockford: I and L both mean 1
    .replace(/O/g, '0')        // and O means 0
    .replace(/U/g, '')         // U is not in the alphabet at all

  if (!/^B[0-9A-Z]{5}$/.test(cleaned)) return null

  const body = cleaned.slice(1, 5)
  const check = cleaned[5]
  if ([...body, check].some((c) => BATCH_ALPHABET.indexOf(c) === -1)) return null

  let sum = 0
  for (let i = 0; i < body.length; i++) sum += BATCH_ALPHABET.indexOf(body[i]) * (i + 2)
  return BATCH_ALPHABET[sum % 32] === check ? cleaned : null
}

/** Allocates the next batch code. A label, not a document, so no FY prefix. */
export async function allocateBatchCode(env, fy) {
  const seq = await nextCounter(env, 'BATCH', fy)
  return { seq, code: batchCode(seq) }
}

/* --------------------------------------------------------- error mapping -- */

/**
 * Translates a D1 constraint failure into our error envelope.
 *
 * Matching on message text is unpleasant, and it is the price of putting the
 * invariants in the engine instead of in whichever handlers remembered them.
 * Centralised here so there is exactly ONE place to fix if D1 ever changes its
 * wording -- do not scatter these strings through handlers.
 *
 * Returns { error, message, status } or null when the error is not a
 * constraint failure we recognise (in which case let it propagate to the
 * router's 500).
 */
export function classifyD1Error(err) {
  const m = String(err?.message || err || '')

  // The RAISE(ABORT, '<code>: <human sentence>') triggers.
  if (m.includes('expired_batch')) {
    return {
      status: 422,
      error: 'expired_batch',
      message: 'That batch has expired. Write it off or return it to the supplier — it cannot go to a machine.',
    }
  }
  if (m.includes('short_shelf_life')) {
    return {
      status: 422,
      error: 'short_shelf_life',
      message: 'That batch is too close to its expiry date to send out. An override is needed.',
    }
  }
  if (m.includes('batch_not_active')) {
    return {
      status: 422,
      error: 'batch_not_active',
      message: 'That batch is quarantined and cannot be picked.',
    }
  }
  if (m.includes('not_pickable')) {
    return {
      status: 422,
      error: 'not_pickable',
      message: 'Stock cannot be picked out of that area. Move it to main storage first.',
    }
  }
  if (m.includes('append-only')) {
    return {
      status: 409,
      error: 'ledger_append_only',
      message: 'Stock history cannot be edited. Post a correcting entry instead.',
    }
  }

  // The balance floor: the losing side of a concurrent pick.
  if (m.includes('qty_milli >= floor_milli')) {
    return {
      status: 409,
      error: 'insufficient_stock',
      message: 'There is not enough of that batch left. Someone else may have moved it — reload and pick again.',
    }
  }

  if (m.includes('UNIQUE constraint failed: purchase_bills.grn_number')
      || m.includes('idx_pb_supplier_billno')) {
    return {
      status: 409,
      error: 'duplicate_bill',
      message: 'That supplier bill number has already been booked.',
    }
  }
  if (m.includes('UNIQUE constraint failed: batches.batch_code')) {
    return {
      status: 409,
      error: 'duplicate_batch',
      message: 'That batch code already exists. Try again.',
    }
  }
  if (m.includes('FOREIGN KEY constraint failed')) {
    return {
      status: 422,
      error: 'unknown_reference',
      message: 'Something referenced here does not exist — check the product, batch, Pod or location.',
    }
  }

  return null
}

/* ---------------------------------------------------------------- ledger -- */

/**
 * Builds the two statements of one double entry.
 *
 * Every event is two signed rows sharing a ref_id: out of `from`, into `to`.
 * A one-sided event (a purchase, a sale, a stocktake correction) uses a contra
 * location as its counterparty, so there are no single-sided events at all --
 * which is what makes "every batch sums to zero across all locations" a
 * whole-system integrity check rather than a per-transfer one.
 *
 * @param {object} env
 * @param {object} m
 * @param {string} m.refId       shared by both legs
 * @param {string} m.refType     purchase_bill | putaway | refill_run | ...
 * @param {string} [m.refRowId]  the row this refers to
 * @param {string} m.from        location stock leaves
 * @param {string} m.to          location stock arrives
 * @param {string} m.batchId
 * @param {string} m.productId
 * @param {number} m.qtyMilli    POSITIVE; direction comes from from/to
 * @param {string} m.reason
 * @param {number} [m.unitCostPaise]
 * @param {string} [m.overrideId] quotes a shelf-life override
 * @param {string} [m.occurredAt] client-claimed, never authoritative
 * @param {number} [m.clockSkewMs]
 * @param {string} m.actor
 * @param {string} [m.notes]
 * @param {string} [m.dedupeKey] UNIQUE; makes a replay a no-op
 */
export function movementPair(env, m) {
  if (!REASON_SET.has(m.reason)) throw new Error(`Unknown movement reason: ${m.reason}`)
  if (!Number.isInteger(m.qtyMilli) || m.qtyMilli <= 0) {
    throw new Error('movementPair needs a positive qtyMilli; direction comes from from/to')
  }

  const cost = Number.isInteger(m.unitCostPaise) ? m.unitCostPaise : 0
  const value = Math.round((m.qtyMilli * cost) / 1000)

  const sql = `INSERT INTO stock_movements (
       movement_id, ref_id, ref_type, ref_row_id, leg,
       location_id, batch_id, product_id, qty_milli, reason,
       unit_cost_paise, value_paise, override_id,
       occurred_at, clock_skew_ms, created_by, notes, dedupe_key
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`

  const leg = (suffix, locationId, signedQty, signedValue, dedupe) =>
    env.DB.prepare(sql).bind(
      `${m.refId}-${suffix}`, m.refId, m.refType, m.refRowId ?? null,
      signedQty > 0 ? 'debit' : 'credit',
      locationId, m.batchId, m.productId, signedQty, m.reason,
      cost, signedValue, m.overrideId ?? null,
      m.occurredAt ?? null, m.clockSkewMs ?? null, m.actor, m.notes ?? null,
      dedupe,
    )

  return [
    // Credit leg first: stock must leave before it arrives, so an over-draw
    // trips the balance floor rather than being masked by the incoming leg.
    leg('c', m.from, -m.qtyMilli, -value, m.dedupeKey ? `${m.dedupeKey}:c` : null),
    leg('d', m.to, m.qtyMilli, value, m.dedupeKey ? `${m.dedupeKey}:d` : null),
  ]
}

/** Convenience wrappers naming the contra location for one-sided events. */
export const fromSupplier = (env, m) => movementPair(env, { ...m, from: CONTRA_LOCATIONS.supplier })
export const toSupplier   = (env, m) => movementPair(env, { ...m, to: CONTRA_LOCATIONS.supplier })
export const toSold       = (env, m) => movementPair(env, { ...m, to: CONTRA_LOCATIONS.sold })
export const fromAdjust   = (env, m) => movementPair(env, { ...m, from: CONTRA_LOCATIONS.adjust })
export const toAdjust     = (env, m) => movementPair(env, { ...m, to: CONTRA_LOCATIONS.adjust })

/* ------------------------------------------------------------------ FEFO -- */

/**
 * Stock available to pick for a product, earliest expiry first.
 *
 * FEFO is the suggested order and the recorded expectation, not a hard block:
 * clearing a planogram or running a promotion are legitimate reasons to break
 * it, and a hard block would only teach people to work around the system.
 * Expiry is the rule; FEFO is the discipline.
 *
 * Only pickable locations are considered, so receiving, quarantine, staged and
 * expired stock never appears in a pick list.
 */
export async function fefoAvailable(env, productId, { locationId = null, includeBlocked = false } = {}) {
  const today = istDateString()
  const binds = [productId, today]
  let extra = ''
  if (locationId) {
    binds.push(locationId)
    extra = ` AND sb.location_id = ?${binds.length}`
  }

  const rows = await env.DB.prepare(
    `SELECT sb.location_id, sb.qty_milli, b.batch_id, b.batch_code, b.expiry_date,
            b.status, b.unit_cost_paise, b.mrp_paise,
            CAST(julianday(b.expiry_date) - julianday(?2) AS INTEGER) AS days_to_expiry,
            CASE WHEN b.expiry_date IS NOT NULL AND b.expiry_date <= ?2 THEN 1 ELSE 0 END AS expired,
            COALESCE(p.min_shelf_life_days, s.min_shelf_life_days) AS min_days
       FROM stock_balances sb
       JOIN batches   b ON b.batch_id = sb.batch_id
       JOIN products  p ON p.product_id = b.product_id
       JOIN locations l ON l.location_id = sb.location_id
       JOIN inventory_settings s ON s.id = 1
      WHERE b.product_id = ?1
        AND sb.qty_milli > 0
        AND l.pickable = 1${extra}
      ORDER BY b.expiry_date IS NULL, b.expiry_date ASC, b.batch_code ASC`
  ).bind(...binds).all()

  return (rows.results || [])
    .map((r) => ({
      batchId: r.batch_id,
      batchCode: r.batch_code,
      locationId: r.location_id,
      qtyMilli: r.qty_milli,
      expiryDate: r.expiry_date,
      daysToExpiry: r.expiry_date ? r.days_to_expiry : null,
      expired: r.expired === 1,
      shortDated: r.expiry_date != null && r.expired === 0 && r.days_to_expiry < r.min_days,
      quarantined: r.status !== 'active',
      unitCostPaise: r.unit_cost_paise,
      mrpPaise: r.mrp_paise,
    }))
    // Expired and quarantined stock cannot be picked at all, so it is hidden
    // from pick lists by default rather than offered and then refused.
    .filter((b) => includeBlocked || (!b.expired && !b.quarantined))
}

/**
 * The layers currently in a slot, front first.
 *
 * A coil dispenses from the front, so seq 1 is what the next customer gets and
 * its expiry -- not the earliest or the latest in the slot -- is the slot's
 * effective expiry. That is what Gate 3 tests and what FEFO-on-load protects.
 */
export async function slotLayers(env, podId, slotId) {
  const rows = await env.DB.prepare(
    `SELECT l.seq, l.batch_id, l.qty_milli, l.attribution, l.loaded_at,
            b.batch_code, b.expiry_date, p.product_id, p.name AS product_name
       FROM pod_slot_layers l
       JOIN batches  b ON b.batch_id = l.batch_id
       JOIN products p ON p.product_id = l.product_id
      WHERE l.pod_id = ?1 AND l.vlite_slot_id = ?2 AND l.qty_milli > 0
      ORDER BY l.seq ASC`
  ).bind(podId, slotId).all()

  return (rows.results || []).map((r) => ({
    seq: r.seq,
    batchId: r.batch_id,
    batchCode: r.batch_code,
    productId: r.product_id,
    productName: r.product_name,
    qtyMilli: r.qty_milli,
    expiryDate: r.expiry_date,
    attribution: r.attribution,
    loadedAt: r.loaded_at,
  }))
}

/**
 * Whether a batch may be stacked behind what is already in a slot.
 *
 * Loading a batch that expires EARLIER than the current front layer would trap
 * it behind stock that outlives it, so it expires unsold. Blocked at planning
 * time in the panel, where a manager can act on it; the refiller only ever sees
 * the resulting instruction ("take the old packs out of A3 first").
 *
 * Returns { ok: true } or { ok: false, reason, frontLayer }.
 */
export function fefoOnLoad(layers, candidateExpiry) {
  const front = layers.find((l) => l.qtyMilli > 0)
  if (!front || !front.expiryDate || !candidateExpiry) return { ok: true }

  if (candidateExpiry < front.expiryDate) {
    return {
      ok: false,
      reason:
        `This batch expires ${candidateExpiry}, before the ${front.batchCode} already at the front of the slot `
        + `(${front.expiryDate}). It would sit behind stock that outlives it and expire unsold. `
        + `Pull the front layer first.`,
      frontLayer: front,
    }
  }
  return { ok: true }
}

/* ------------------------------------------------------------ validation -- */

const bad = (errors, msg) => { errors.push(msg); return errors }

/** Where a pull's stock goes when it comes back. Never a refiller's decision. */
export function pullReturnZone(reason) {
  return PULL_REASONS.find((r) => r.value === reason)?.returnZone || 'WH-MLR/QUAR'
}

/** Where written-off stock is segregated, if anywhere. */
export function writeOffZone(reason) {
  return WRITEOFF_REASONS.find((r) => r.value === reason)?.zone || null
}

/**
 * Normalises a client-claimed timestamp.
 *
 * The bias is never to block a field action because a device clock is wrong --
 * that is not something anyone can fix on the spot -- so future skew is clamped
 * and recorded rather than rejected. Genuinely ancient actions ARE rejected,
 * because a week-old queued action needs a human to look at it.
 *
 * The server's recorded_at is what every sum and ordering uses; occurred_at is
 * only ever the operational timeline. Same rule as schema.sql: client clocks
 * are never trusted.
 */
export function normaliseOccurredAt(input, nowMs = Date.now()) {
  if (input == null || input === '') return { ok: true, occurredAt: null, skewMs: 0 }

  const t = Date.parse(input)
  if (!Number.isFinite(t)) {
    return {
      ok: false,
      error: 'validation',
      message: 'occurredAt must be an ISO 8601 timestamp with an offset, e.g. 2026-08-17T09:41:22+05:30.',
    }
  }

  const skewMs = t - nowMs
  const asSql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

  if (skewMs > 5 * 60 * 1000) {
    return { ok: true, occurredAt: asSql(nowMs), skewMs }   // clock ahead: clamp
  }
  if (-skewMs > 7 * 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      error: 'stale_action',
      message: 'This action is more than 7 days old and needs to be checked before it can be recorded.',
    }
  }
  return { ok: true, occurredAt: asSql(t), skewMs }
}

/**
 * Landed unit cost for a purchase bill line, in paise.
 *
 * Excludes GST when the bill is ITC-eligible: input credit is a receivable from
 * the government, not a cost of the goods, and capitalising it would overstate
 * closing stock and understate margin.
 *
 * Free goods dilute the paid goods -- "buy 10 get 1 free" is 11 units carrying
 * 10 units' cost, so the denominator is qty + free_qty. Getting that wrong
 * overstates COGS on the paid units and reports a phantom margin on the free
 * one.
 */
export function unitCost(line, { itcEligible = true } = {}) {
  const units = line.qty_milli + (line.free_qty_milli || 0)
  if (units <= 0) return { unitCostPaise: 0, unitCostInclGstPaise: 0 }

  const net = Math.max(0, line.taxable_paise - (line.discount_paise || 0) + (line.landed_extra_paise || 0))
  const tax = (line.cgst_paise || 0) + (line.sgst_paise || 0) + (line.igst_paise || 0)

  const exGst = Math.round((net * 1000) / units)
  const incGst = Math.round(((net + tax) * 1000) / units)

  return {
    unitCostPaise: itcEligible ? exGst : incGst,
    unitCostInclGstPaise: incGst,
  }
}

/**
 * Apportions bill-level charges (freight and the like) across lines, pro-rata
 * to taxable value, with the rounding residual on the largest line so the
 * apportionment sums back to the header exactly.
 */
export function apportionCharges(lines, chargesPaise) {
  if (!chargesPaise || lines.length === 0) return lines.map(() => 0)

  const total = lines.reduce((s, l) => s + l.taxable_paise, 0)
  if (total <= 0) {
    // No taxable base to weight by; split evenly and dump the residual on line 1.
    const each = Math.floor(chargesPaise / lines.length)
    const out = lines.map(() => each)
    out[0] += chargesPaise - each * lines.length
    return out
  }

  const out = lines.map((l) => Math.floor((l.taxable_paise * chargesPaise) / total))
  const residual = chargesPaise - out.reduce((s, v) => s + v, 0)
  let biggest = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].taxable_paise > lines[biggest].taxable_paise) biggest = i
  }
  out[biggest] += residual
  return out
}

export { REASON_SET, WRITEOFF_SET, PULL_SET }
