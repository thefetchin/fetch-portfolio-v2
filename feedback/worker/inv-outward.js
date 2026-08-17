import { INV_LIMITS, podLocationId, transitLocationId } from '../shared/constants.js'
import { cleanText } from './validate.js'
import {
  DOC_NUMBER_SQL,
  counterBumpStatement,
  financialYear,
  istDateString,
  toMilli,
} from './invoicing.js'
import { fefoOnLoad, movementPair, slotLayers } from './inventory.js'

/**
 * Outward: planning a run, picking it, and dispatching it.
 *
 * The batch -> slot decision is made HERE, in the warehouse, by someone who can
 * see the batch. That decision is the record: nothing downstream re-derives it
 * and nobody in the field scans anything. It is why the plan lines carry a bag
 * number -- one batch per bag, and the run sheet tells the refiller which bag
 * feeds which slot.
 *
 * Stock moves in two hops, MAIN -> STAGE on picking and STAGE -> TRANSIT on
 * dispatch, so a picked-but-not-dispatched run is visible on a shelf and can be
 * checked against the list before the crate leaves the building.
 */

const shortId = (prefix) => {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const b = crypto.getRandomValues(new Uint8Array(6))
  let s = ''
  for (const byte of b) s += A[byte % 32]
  return `${prefix}_${s}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/* ------------------------------------------------------------ validation -- */

export function validateRunPlan(payload) {
  const errors = []
  const p = payload || {}

  const runDate = typeof p.runDate === 'string' && DATE_RE.test(p.runDate) ? p.runDate : istDateString()

  const rawLines = Array.isArray(p.lines) ? p.lines : []
  if (!rawLines.length) errors.push('Add at least one line to the plan.')
  if (rawLines.length > INV_LIMITS.maxPlanLines) {
    errors.push(`A run can have at most ${INV_LIMITS.maxPlanLines} lines.`)
  }

  const lines = []
  rawLines.slice(0, INV_LIMITS.maxPlanLines).forEach((l, i) => {
    const n = i + 1
    const podId = cleanText(l.podId, 40)
    const slotName = cleanText(l.slotName, INV_LIMITS.slotName)
    const batchId = cleanText(l.batchId, 40)
    const qty = toMilli(l.qty)

    if (!podId) { errors.push(`Line ${n}: which Pod?`); return }
    if (!slotName) { errors.push(`Line ${n}: which slot?`); return }
    if (!batchId) { errors.push(`Line ${n}: which batch?`); return }
    if (qty === null) { errors.push(`Line ${n}: enter a quantity greater than zero.`); return }

    const slotId = Number(l.vliteSlotId)
    lines.push({
      pod_id: podId,
      slot_name: slotName,
      vlite_slot_id: Number.isInteger(slotId) && slotId > 0 ? slotId : null,
      batch_id: batchId,
      planned_milli: qty,
    })
  })

  // One batch per bag, and the same (pod, slot, batch) cannot appear twice --
  // the UNIQUE index would reject it anyway, but a clear message beats a 409.
  const seen = new Set()
  for (const l of lines) {
    const key = `${l.pod_id}|${l.slot_name}|${l.batch_id}`
    if (seen.has(key)) errors.push(`${l.slot_name}: that batch is listed twice for the same slot.`)
    seen.add(key)
  }

  const assigned = Number(p.assignedUserId)

  return errors.length ? { ok: false, errors } : {
    ok: true,
    value: {
      run_date: runDate,
      assigned_user_id: Number.isInteger(assigned) && assigned > 0 ? assigned : null,
      notes: cleanText(p.notes, INV_LIMITS.notes),
      lines,
    },
  }
}

/* -------------------------------------------------------------- planning -- */

/**
 * Creates a planned run.
 *
 * Two checks the database cannot make for us, so they happen here:
 *
 *  - FEFO-on-load. A batch that expires before whatever is already at the front
 *    of the target slot would be trapped behind stock that outlives it and would
 *    expire unsold. Refused at planning time, where a manager can act on it,
 *    with the fix named. The refiller only ever sees the resulting instruction.
 *
 *  - Availability in MAIN. This is advisory only: the balance floor in the
 *    database is what actually guarantees stock cannot go negative when two
 *    managers plan the same batch at once. Checking here just produces a better
 *    message than a 409 for the common, uncontended case.
 */
export async function createRun(env, idem, actor, json, validationError) {
  const result = validateRunPlan(idem.body)
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }
  const v = result.value

  const podIds = [...new Set(v.lines.map((l) => l.pod_id))]
  const batchIds = [...new Set(v.lines.map((l) => l.batch_id))]

  const pods = await env.DB.prepare(
    `SELECT pod_id, label, location, vlite_machine_id FROM pods
      WHERE pod_id IN (${podIds.map((_, i) => `?${i + 1}`).join(',')})`
  ).bind(...podIds).all()
  const podMap = new Map((pods.results || []).map((r) => [r.pod_id, r]))

  const today = istDateString()
  const batches = await env.DB.prepare(
    `SELECT b.batch_id, b.batch_code, b.product_id, b.expiry_date, b.status,
            b.unit_cost_paise, p.name AS product_name, p.uom,
            COALESCE(sb.qty_milli, 0) AS in_main
       FROM batches b
       JOIN products p ON p.product_id = b.product_id
       LEFT JOIN stock_balances sb
         ON sb.batch_id = b.batch_id AND sb.location_id = 'WH-MLR/MAIN'
      WHERE b.batch_id IN (${batchIds.map((_, i) => `?${i + 1}`).join(',')})`
  ).bind(...batchIds).all()
  const batchMap = new Map((batches.results || []).map((r) => [r.batch_id, r]))

  const errors = []
  const needed = new Map()
  for (const l of v.lines) {
    if (!podMap.has(l.pod_id)) { errors.push(`Pod ${l.pod_id} does not exist.`); continue }
    const b = batchMap.get(l.batch_id)
    if (!b) { errors.push(`Batch ${l.batch_id} does not exist.`); continue }

    if (b.expiry_date && b.expiry_date <= today) {
      errors.push(`${b.batch_code} (${b.product_name}) has expired and cannot be sent out.`)
      continue
    }
    if (b.status !== 'active') {
      errors.push(`${b.batch_code} is quarantined and cannot be sent out.`)
      continue
    }

    needed.set(l.batch_id, (needed.get(l.batch_id) || 0) + l.planned_milli)
  }

  for (const [batchId, qty] of needed) {
    const b = batchMap.get(batchId)
    if (b && b.in_main < qty) {
      errors.push(
        `${b.batch_code}: only ${b.in_main / 1000} ${b.uom} in main storage, ${qty / 1000} planned.`
      )
    }
  }

  // FEFO-on-load, per target slot.
  for (const l of v.lines) {
    const b = batchMap.get(l.batch_id)
    const pod = podMap.get(l.pod_id)
    if (!b || !pod || !l.vlite_slot_id) continue
    const layers = await slotLayers(env, l.pod_id, l.vlite_slot_id)
    const check = fefoOnLoad(layers, b.expiry_date)
    if (!check.ok) errors.push(`${l.slot_name}: ${check.reason}`)
  }

  if (errors.length) { await idem.abandon(); return json(validationError(errors), 422) }

  const fy = financialYear()
  const runId = shortId('run')
  const transitId = transitLocationId(runId)

  // Bag numbers: one per (pod, batch), because one batch per bag is what lets a
  // refiller load the right thing without reading a code.
  const bagNo = new Map()
  let nextBag = 0
  for (const l of v.lines) {
    const key = `${l.pod_id}|${l.batch_id}`
    if (!bagNo.has(key)) bagNo.set(key, ++nextBag)
  }

  const statements = [
    counterBumpStatement(env, 'RUN', fy),

    // Each run gets its own transit location, so "what is in this crate right
    // now" is a balance rather than a guess, and a run that is never reconciled
    // shows up as stock sitting somewhere it should not.
    env.DB.prepare(
      `INSERT OR IGNORE INTO locations (location_id, kind, label, pickable, allow_negative)
       VALUES (?1, 'transit', ?2, 0, 0)`
    ).bind(transitId, `In transit — ${runId}`),

    env.DB.prepare(
      `INSERT INTO refill_runs
         (run_id, run_number, fy, seq, run_date, transit_location_id,
          assigned_user_id, created_by, notes)
       SELECT ?1, ${DOC_NUMBER_SQL}, ?2, c.last_no, ?3, ?4, ?5, ?6, ?7
         FROM document_counters c WHERE c.series = 'RUN' AND c.fy = ?2`
    ).bind(runId, fy, v.run_date, transitId, v.assigned_user_id, actor, v.notes),

    ...podIds.map((podId, i) => env.DB.prepare(
      'INSERT INTO refill_run_stops (run_id, pod_id, seq) VALUES (?1, ?2, ?3)'
    ).bind(runId, podId, i + 1)),

    ...v.lines.map((l) => env.DB.prepare(
      `INSERT INTO refill_plan_lines
         (run_id, pod_id, slot_name, vlite_slot_id, batch_id, product_id, bag_no, planned_milli)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
    ).bind(
      runId, l.pod_id, l.slot_name, l.vlite_slot_id, l.batch_id,
      batchMap.get(l.batch_id).product_id,
      bagNo.get(`${l.pod_id}|${l.batch_id}`),
      l.planned_milli,
    )),
  ]

  return { runId, transitId, statements, lines: v.lines, bagNo, batchMap, podMap }
}

/* ------------------------------------------------------- pick + dispatch -- */

/**
 * Aggregates plan lines to one movement per batch.
 *
 * Two slots fed from the same bag is one physical movement out of storage, and
 * the ledger tracks batch x location -- it has no opinion about slots. Slot
 * arrangement is tracked separately, and deliberately not as ledger movements.
 */
export function aggregateByBatch(lines) {
  const out = new Map()
  for (const l of lines) {
    out.set(l.batch_id, (out.get(l.batch_id) || 0) + l.planned_milli)
  }
  return out
}

/**
 * MAIN -> STAGE. The expiry gate fires here: this is the first movement with a
 * reason the trigger blocks, so expired or short-dated stock cannot even be
 * picked, let alone leave.
 */
export async function pickStatements(env, run, actor) {
  const lines = await env.DB.prepare(
    `SELECT l.batch_id, l.product_id, l.planned_milli, b.unit_cost_paise
       FROM refill_plan_lines l
       JOIN batches b ON b.batch_id = l.batch_id
      WHERE l.run_id = ?1`
  ).bind(run.run_id).all()

  const rows = lines.results || []
  const byBatch = new Map()
  for (const r of rows) {
    const cur = byBatch.get(r.batch_id) || { qty: 0, productId: r.product_id, cost: r.unit_cost_paise }
    cur.qty += r.planned_milli
    byBatch.set(r.batch_id, cur)
  }

  const statements = []
  for (const [batchId, { qty, productId, cost }] of byBatch) {
    statements.push(...movementPair(env, {
      refId: `${run.run_id}-pick-${batchId}`,
      refType: 'refill_run',
      refRowId: run.run_id,
      from: 'WH-MLR/MAIN',
      to: 'WH-MLR/STAGE',
      batchId,
      productId,
      qtyMilli: qty,
      reason: 'pick',
      unitCostPaise: cost,
      actor,
    }))
  }

  statements.push(env.DB.prepare(
    `UPDATE refill_runs SET status = 'picked', picked_at = datetime('now')
      WHERE run_id = ?1 AND status = 'planned'`
  ).bind(run.run_id))

  return { statements, batchCount: byBatch.size }
}

/** STAGE -> TRANSIT:<runId>. The crate leaves the building. */
export async function dispatchStatements(env, run, actor) {
  const lines = await env.DB.prepare(
    `SELECT l.batch_id, l.product_id, l.planned_milli, b.unit_cost_paise
       FROM refill_plan_lines l
       JOIN batches b ON b.batch_id = l.batch_id
      WHERE l.run_id = ?1`
  ).bind(run.run_id).all()

  const byBatch = new Map()
  for (const r of lines.results || []) {
    const cur = byBatch.get(r.batch_id) || { qty: 0, productId: r.product_id, cost: r.unit_cost_paise }
    cur.qty += r.planned_milli
    byBatch.set(r.batch_id, cur)
  }

  const statements = []
  for (const [batchId, { qty, productId, cost }] of byBatch) {
    statements.push(...movementPair(env, {
      refId: `${run.run_id}-disp-${batchId}`,
      refType: 'refill_run',
      refRowId: run.run_id,
      from: 'WH-MLR/STAGE',
      to: run.transit_location_id,
      batchId,
      productId,
      qtyMilli: qty,
      reason: 'dispatch',
      unitCostPaise: cost,
      actor,
    }))
  }

  statements.push(env.DB.prepare(
    `UPDATE refill_runs SET status = 'dispatched', dispatched_at = datetime('now')
      WHERE run_id = ?1 AND status = 'picked'`
  ).bind(run.run_id))

  return { statements, batchCount: byBatch.size }
}

/**
 * Returns everything still in a run's transit location to the warehouse.
 *
 * Used to cancel a run. Stock goes back to MAIN because it never reached a
 * machine -- nothing about it changed except that it made a round trip.
 */
export async function cancelStatements(env, run, actor, reason) {
  const held = await env.DB.prepare(
    `SELECT sb.batch_id, sb.qty_milli, b.product_id, b.unit_cost_paise
       FROM stock_balances sb
       JOIN batches b ON b.batch_id = sb.batch_id
      WHERE sb.location_id = ?1 AND sb.qty_milli > 0`
  ).bind(run.transit_location_id).all()

  const statements = []
  for (const r of held.results || []) {
    statements.push(...movementPair(env, {
      refId: `${run.run_id}-cancel-${r.batch_id}`,
      refType: 'refill_run',
      refRowId: run.run_id,
      from: run.transit_location_id,
      to: 'WH-MLR/MAIN',
      batchId: r.batch_id,
      productId: r.product_id,
      qtyMilli: r.qty_milli,
      reason: 'transit_return',
      unitCostPaise: r.unit_cost_paise,
      actor,
      notes: reason,
    }))
  }

  // Anything already picked but not dispatched is still on the staging shelf.
  const staged = await env.DB.prepare(
    `SELECT sb.batch_id, sb.qty_milli, b.product_id, b.unit_cost_paise
       FROM stock_balances sb
       JOIN batches b ON b.batch_id = sb.batch_id
       JOIN refill_plan_lines l ON l.batch_id = sb.batch_id AND l.run_id = ?1
      WHERE sb.location_id = 'WH-MLR/STAGE' AND sb.qty_milli > 0
      GROUP BY sb.batch_id`
  ).bind(run.run_id).all()

  for (const r of staged.results || []) {
    statements.push(...movementPair(env, {
      refId: `${run.run_id}-unstage-${r.batch_id}`,
      refType: 'refill_run',
      refRowId: run.run_id,
      from: 'WH-MLR/STAGE',
      to: 'WH-MLR/MAIN',
      batchId: r.batch_id,
      productId: r.product_id,
      qtyMilli: r.qty_milli,
      reason: 'transit_return',
      unitCostPaise: r.unit_cost_paise,
      actor,
      notes: reason,
    }))
  }

  statements.push(env.DB.prepare(
    `UPDATE refill_runs SET status = 'cancelled', notes =
       COALESCE(notes || ' | ', '') || ?2
      WHERE run_id = ?1 AND status IN ('planned','picked','dispatched')`
  ).bind(run.run_id, `Cancelled: ${reason || 'no reason given'}`))

  return { statements }
}

/* ------------------------------------------------------------- run sheet -- */

/**
 * Everything the run sheet and the alert feed need, in plain terms.
 *
 * Pull tasks come first: pulling before loading is what keeps FEFO-on-load
 * satisfiable, and it is the order the printed sheet uses.
 */
export async function runDetail(env, runId) {
  const run = await env.DB.prepare(
    `SELECT r.*, u.email AS assigned_email, u.display_name AS assigned_name
       FROM refill_runs r
       LEFT JOIN admin_users u ON u.id = r.assigned_user_id
      WHERE r.run_id = ?1`
  ).bind(runId).first()
  if (!run) return null

  const stops = await env.DB.prepare(
    `SELECT s.pod_id, s.seq, s.state, s.skip_reason, p.label, p.location, p.vlite_machine_id
       FROM refill_run_stops s
       JOIN pods p ON p.pod_id = s.pod_id
      WHERE s.run_id = ?1 ORDER BY s.seq`
  ).bind(runId).all()

  const lines = await env.DB.prepare(
    `SELECT l.pod_id, l.slot_name, l.vlite_slot_id, l.bag_no, l.planned_milli, l.loaded_milli,
            b.batch_code, b.expiry_date, p.name AS product_name, p.uom
       FROM refill_plan_lines l
       JOIN batches  b ON b.batch_id = l.batch_id
       JOIN products p ON p.product_id = l.product_id
      WHERE l.run_id = ?1
      ORDER BY l.pod_id, l.bag_no, l.slot_name`
  ).bind(runId).all()

  const pulls = await env.DB.prepare(
    `SELECT t.pull_id, t.pod_id, t.slot_name, t.qty_milli, t.reason, t.status,
            b.batch_code, b.expiry_date, p.name AS product_name, p.uom
       FROM pull_tasks t
       JOIN batches  b ON b.batch_id = t.batch_id
       JOIN products p ON p.product_id = t.product_id
      WHERE t.run_id = ?1 AND t.status IN ('open','assigned')
      ORDER BY t.pod_id, t.slot_name`
  ).bind(runId).all()

  const transit = await env.DB.prepare(
    `SELECT sb.qty_milli, b.batch_code, p.name AS product_name, p.uom
       FROM stock_balances sb
       JOIN batches  b ON b.batch_id = sb.batch_id
       JOIN products p ON p.product_id = b.product_id
      WHERE sb.location_id = ?1 AND sb.qty_milli <> 0`
  ).bind(run.transit_location_id).all()

  return {
    run: {
      id: run.run_id,
      runNumber: run.run_number,
      runDate: run.run_date,
      status: run.status,
      assignedTo: run.assigned_email
        ? { userId: run.assigned_user_id, email: run.assigned_email, name: run.assigned_name }
        : null,
      transitLocationId: run.transit_location_id,
      createdBy: run.created_by,
      pickedAt: run.picked_at,
      dispatchedAt: run.dispatched_at,
      reconciledAt: run.reconciled_at,
      notes: run.notes,
    },
    stops: (stops.results || []).map((s) => ({
      podId: s.pod_id,
      seq: s.seq,
      state: s.state,
      skipReason: s.skip_reason,
      label: s.label,
      location: s.location,
      vliteMachineId: s.vlite_machine_id,
    })),
    pulls: (pulls.results || []).map((t) => ({
      pullId: t.pull_id,
      podId: t.pod_id,
      slotName: t.slot_name,
      batchCode: t.batch_code,
      productName: t.product_name,
      qtyMilli: t.qty_milli,
      uom: t.uom,
      expiryDate: t.expiry_date,
      reason: t.reason,
      status: t.status,
    })),
    load: (lines.results || []).map((l) => ({
      podId: l.pod_id,
      slotName: l.slot_name,
      vliteSlotId: l.vlite_slot_id,
      bagNo: l.bag_no,
      batchCode: l.batch_code,
      productName: l.product_name,
      uom: l.uom,
      expiryDate: l.expiry_date,
      plannedMilli: l.planned_milli,
      loadedMilli: l.loaded_milli,
    })),
    inTransit: (transit.results || []).map((t) => ({
      batchCode: t.batch_code,
      productName: t.product_name,
      uom: t.uom,
      qtyMilli: t.qty_milli,
    })),
  }
}
