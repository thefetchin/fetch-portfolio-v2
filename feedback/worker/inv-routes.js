import {
  CONTRA_LOCATIONS,
  INV_LIMITS,
  STOCK_ROLES,
  WAREHOUSE_ZONES,
} from '../shared/constants.js'
import { requireRole } from './auth.js'
import {
  DOC_NUMBER_SQL,
  counterBumpStatement,
  financialYear,
  istDateString,
} from './invoicing.js'
import {
  allocateBatchCode,
  classifyD1Error,
  fefoAvailable,
  movementPair,
  normaliseBatchCode,
  normaliseOccurredAt,
  unitCost,
  writeOffZone,
} from './inventory.js'
import {
  validateProduct,
  validatePurchaseBill,
  validatePutaway,
  validateSupplier,
  validateWriteOff,
} from './inv-validate.js'

/**
 * The /api/inv/* routes.
 *
 * A sibling of /api/admin/* rather than nested inside it, so that block can
 * keep one blanket admin-only gate: a route added there later is protected by
 * default, and no hole has to be cut in it for a non-admin role. Here, each
 * route declares who may call it.
 *
 * Same house style as worker/index.js: a flat if-chain, `{ ok: true, ... }` on
 * success, `{ error, message }` on failure, 422 with an `errors` array for
 * validation. This lives in its own file only because index.js is already long.
 */

const CLEAN_ID = /^[\w:-]{1,60}$/

const uuid = () => crypto.randomUUID()

/** A short opaque id with a prefix, for things that appear in a URL or a sheet. */
const shortId = (prefix) => {
  const b = crypto.getRandomValues(new Uint8Array(6))
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let s = ''
  for (const byte of b) s += A[byte % 32]
  return `${prefix}_${s}`
}

const validationError = (errors) => ({
  error: 'validation',
  message: errors[0],
  errors,
})

/**
 * Runs an env.DB.batch() and turns a constraint failure into our envelope.
 *
 * Every inventory write goes through here, so the mapping from "the database
 * refused this" to "the caller sees a 409 or 422 with a sentence they can act
 * on" happens in exactly one place.
 */
async function runBatch(env, statements) {
  try {
    await env.DB.batch(statements)
    return null
  } catch (err) {
    const mapped = classifyD1Error(err)
    if (mapped) return mapped
    throw err
  }
}

/* =========================================================== masters ====== */

async function listProducts(request, env, json) {
  const url = new URL(request.url)
  const activeOnly = url.searchParams.get('active') !== '0'

  const rows = await env.DB.prepare(
    `SELECT product_id, sku, name, category, hsn, uom, gst_bps, mrp_paise,
            shelf_life_days, min_shelf_life_days, barcode, vlite_product_id,
            active, updated_at
       FROM products
      ${activeOnly ? 'WHERE active = 1' : ''}
      ORDER BY name ASC`
  ).all()

  return json({
    products: (rows.results || []).map((p) => ({
      id: p.product_id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      hsn: p.hsn,
      uom: p.uom,
      gstBps: p.gst_bps,
      mrpPaise: p.mrp_paise,
      shelfLifeDays: p.shelf_life_days,
      minShelfLifeDays: p.min_shelf_life_days,
      barcode: p.barcode,
      vliteProductId: p.vlite_product_id,
      active: p.active === 1,
    })),
  })
}

async function createProduct(env, idem, actor, json) {
  const result = validateProduct(idem.body)
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }
  const v = result.value
  const id = shortId('prd')

  const failed = await runBatch(env, [
    env.DB.prepare(
      `INSERT INTO products
         (product_id, sku, name, category, hsn, uom, gst_bps, mrp_paise,
          shelf_life_days, min_shelf_life_days, barcode, vlite_product_id)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    ).bind(
      id, v.sku, v.name, v.category, v.hsn ?? null, v.uom, v.gst_bps,
      v.mrp_paise ?? null, v.shelf_life_days ?? null, v.min_shelf_life_days ?? null,
      v.barcode ?? null, v.vlite_product_id ?? null,
    ),
  ])
  if (failed) {
    await idem.abandon()
    const dup = String(failed.error) === 'unknown_reference' ? failed : failed
    return json({ error: dup.error, message: dup.message }, dup.status)
  }
  return idem.finish({ ok: true, id, sku: v.sku })
}

async function patchProduct(env, idem, productId, json) {
  const result = validateProduct(idem.body, { partial: true })
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }

  const map = {
    sku: 'sku', name: 'name', category: 'category', hsn: 'hsn', uom: 'uom',
    gst_bps: 'gst_bps', mrp_paise: 'mrp_paise', shelf_life_days: 'shelf_life_days',
    min_shelf_life_days: 'min_shelf_life_days', barcode: 'barcode',
    vlite_product_id: 'vlite_product_id', active: 'active',
  }
  const sets = []
  const binds = []
  for (const [key, col] of Object.entries(map)) {
    if (result.value[key] !== undefined) {
      binds.push(result.value[key])
      sets.push(`${col} = ?${binds.length}`)
    }
  }
  if (!sets.length) { await idem.abandon(); return json(validationError(['Nothing to change.']), 422) }

  binds.push(productId)
  const failed = await runBatch(env, [
    env.DB.prepare(
      `UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now')
        WHERE product_id = ?${binds.length}`
    ).bind(...binds),
  ])
  if (failed) { await idem.abandon(); return json({ error: failed.error, message: failed.message }, failed.status) }
  return idem.finish({ ok: true, id: productId })
}

async function listSuppliers(request, env, json) {
  const rows = await env.DB.prepare(
    `SELECT supplier_id, name, gstin, state_code, address, phone, email, active
       FROM suppliers ORDER BY name ASC`
  ).all()
  return json({
    suppliers: (rows.results || []).map((s) => ({
      id: s.supplier_id,
      name: s.name,
      gstin: s.gstin,
      stateCode: s.state_code,
      address: s.address,
      phone: s.phone,
      email: s.email,
      active: s.active === 1,
    })),
  })
}

async function createSupplier(env, idem, json) {
  const result = validateSupplier(idem.body)
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }
  const v = result.value
  const id = shortId('sup')

  const failed = await runBatch(env, [
    env.DB.prepare(
      `INSERT INTO suppliers (supplier_id, name, gstin, state_code, address, phone, email)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`
    ).bind(id, v.name, v.gstin ?? null, v.state_code ?? null,
           v.address ?? null, v.phone ?? null, v.email ?? null),
  ])
  if (failed) { await idem.abandon(); return json({ error: failed.error, message: failed.message }, failed.status) }
  return idem.finish({ ok: true, id, name: v.name })
}

/* ==================================================== purchase bills ====== */

/**
 * Books a supplier bill: allocates a GRN number, creates one batch per line,
 * and books purchase_in into receiving.
 *
 * All of it is one env.DB.batch(), so the counter, the header, the lines, the
 * batches and the ledger entries commit together or not at all. A half-booked
 * bill would leave stock that exists physically and partially in the books,
 * which is the worst of both.
 */
async function createPurchaseBill(env, idem, actor, json) {
  const body = idem.body || {}

  // Load the referenced products so expiry can be sanity-checked against each
  // product's shelf life -- one mistyped year would otherwise disable the
  // expiry gate for that batch for as long as it exists.
  const ids = [...new Set((Array.isArray(body.lines) ? body.lines : [])
    .map((l) => (typeof l.productId === 'string' ? l.productId : null))
    .filter(Boolean))]

  const products = new Map()
  if (ids.length) {
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(',')
    const rows = await env.DB.prepare(
      `SELECT product_id, name, hsn, uom, gst_bps, shelf_life_days
         FROM products WHERE product_id IN (${placeholders})`
    ).bind(...ids).all()
    for (const r of rows.results || []) products.set(r.product_id, r)
  }

  const result = validatePurchaseBill(body, products)
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }
  const v = result.value

  const supplier = await env.DB.prepare(
    'SELECT supplier_id, gstin FROM suppliers WHERE supplier_id = ?1 AND active = 1'
  ).bind(v.supplier_id).first()
  if (!supplier) {
    await idem.abandon()
    return json({ error: 'unknown_supplier', message: 'That supplier does not exist.' }, 404)
  }

  const fy = financialYear()
  const billId = shortId('bill')
  const statements = [counterBumpStatement(env, 'GRN', fy)]

  statements.push(env.DB.prepare(
    `INSERT INTO purchase_bills (
       bill_id, grn_number, fy, seq, supplier_id, supplier_bill_no, bill_date,
       received_date, created_by, is_interstate, taxable_paise, cgst_paise,
       sgst_paise, igst_paise, freight_paise, round_off_paise, total_paise,
       itc_eligible, notes
     )
     SELECT ?1, ${DOC_NUMBER_SQL}, ?2, c.last_no, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
       FROM document_counters c
      WHERE c.series = 'GRN' AND c.fy = ?2`
  ).bind(
    billId, fy, v.supplier_id, v.supplier_bill_no, v.bill_date, v.received_date, actor,
    v.is_interstate, v.taxable_paise, v.cgst_paise, v.sgst_paise, v.igst_paise,
    v.freight_paise, v.round_off_paise, v.total_paise, v.itc_eligible, v.notes,
  ))

  // Batch codes are allocated up front: they are labels, not documents, so a
  // gap costs nothing, and the alternative is deriving codes inside SQL.
  const batches = []
  for (const line of v.lines) {
    const { seq, code } = await allocateBatchCode(env, fy)
    const costs = unitCost(line, { itcEligible: v.itc_eligible === 1 })
    const batchId = shortId('btc')
    batches.push({ batchId, code, seq, line, costs })

    statements.push(env.DB.prepare(
      `INSERT INTO batches (
         batch_id, batch_code, batch_seq, product_id, supplier_id, bill_id,
         supplier_batch_no, mfg_date, expiry_date, qty_received_milli, mrp_paise,
         unit_cost_paise, unit_cost_incl_gst_paise, created_by
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`
    ).bind(
      batchId, code, seq, line.product_id, v.supplier_id, billId,
      line.supplier_batch_no, line.mfg_date, line.expiry_date,
      line.qty_milli + line.free_qty_milli, line.mrp_paise,
      costs.unitCostPaise, costs.unitCostInclGstPaise, actor,
    ))

    statements.push(env.DB.prepare(
      `INSERT INTO purchase_bill_lines (
         bill_id, line_no, product_id, batch_id, description, hsn, qty_milli,
         free_qty_milli, uom, rate_paise, discount_paise, gst_bps, taxable_paise,
         cgst_paise, sgst_paise, igst_paise, total_paise, landed_extra_paise,
         mfg_date, expiry_date, supplier_batch_no
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)`
    ).bind(
      billId, line.line_no, line.product_id, batchId, line.description, line.hsn,
      line.qty_milli, line.free_qty_milli, line.uom, line.rate_paise,
      line.discount_paise, line.gst_bps, line.taxable_paise, line.cgst_paise,
      line.sgst_paise, line.igst_paise, line.total_paise, line.landed_extra_paise,
      line.mfg_date, line.expiry_date, line.supplier_batch_no,
    ))

    // Received quantity includes free goods: they are physically present and
    // must be tracked, they simply carry a diluted cost.
    statements.push(...movementPair(env, {
      refId: `${billId}-l${line.line_no}`,
      refType: 'purchase_bill',
      refRowId: billId,
      from: CONTRA_LOCATIONS.supplier,
      to: 'WH-MLR/RECV',
      batchId,
      productId: line.product_id,
      qtyMilli: line.qty_milli + line.free_qty_milli,
      reason: 'purchase_in',
      unitCostPaise: costs.unitCostPaise,
      actor,
    }))
  }

  const failed = await runBatch(env, statements)
  if (failed) {
    await idem.abandon()
    return json({ error: failed.error, message: failed.message }, failed.status)
  }

  const saved = await env.DB.prepare(
    'SELECT grn_number FROM purchase_bills WHERE bill_id = ?1'
  ).bind(billId).first()

  return idem.finish({
    ok: true,
    id: billId,
    grnNumber: saved?.grn_number,
    totalPaise: v.total_paise,
    batches: batches.map((b) => ({
      id: b.batchId,
      code: b.code,
      productId: b.line.product_id,
      qtyMilli: b.line.qty_milli + b.line.free_qty_milli,
      expiryDate: b.line.expiry_date,
      unitCostPaise: b.costs.unitCostPaise,
    })),
  }, 200)
}

async function listPurchaseBills(request, env, json) {
  const url = new URL(request.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100)

  const rows = await env.DB.prepare(
    `SELECT pb.bill_id, pb.grn_number, pb.supplier_bill_no, pb.bill_date,
            pb.received_date, pb.total_paise, pb.status, pb.itc_eligible,
            s.name AS supplier_name,
            (SELECT COUNT(*) FROM purchase_bill_lines l WHERE l.bill_id = pb.bill_id) AS line_count
       FROM purchase_bills pb
       JOIN suppliers s ON s.supplier_id = pb.supplier_id
      ORDER BY pb.created_at DESC
      LIMIT ?1`
  ).bind(limit).all()

  return json({
    bills: (rows.results || []).map((b) => ({
      id: b.bill_id,
      grnNumber: b.grn_number,
      supplierName: b.supplier_name,
      supplierBillNo: b.supplier_bill_no,
      billDate: b.bill_date,
      receivedDate: b.received_date,
      totalPaise: b.total_paise,
      lineCount: b.line_count,
      itcEligible: b.itc_eligible === 1,
      status: b.status,
    })),
  })
}

async function getPurchaseBill(env, billId, json) {
  const bill = await env.DB.prepare(
    `SELECT pb.*, s.name AS supplier_name, s.gstin AS supplier_gstin
       FROM purchase_bills pb
       JOIN suppliers s ON s.supplier_id = pb.supplier_id
      WHERE pb.bill_id = ?1`
  ).bind(billId).first()
  if (!bill) return json({ error: 'not_found', message: 'No such bill.' }, 404)

  const lines = await env.DB.prepare(
    `SELECT l.*, p.name AS product_name, b.batch_code
       FROM purchase_bill_lines l
       JOIN products p ON p.product_id = l.product_id
       LEFT JOIN batches b ON b.batch_id = l.batch_id
      WHERE l.bill_id = ?1 ORDER BY l.line_no`
  ).bind(billId).all()

  return json({ bill, lines: lines.results || [] })
}

/* ========================================================== putaway ======= */

/**
 * Moves received stock out of receiving.
 *
 * Receiving is not pickable, so nothing can be sent to a machine until this
 * happens -- which is deliberate: it forces someone to take responsibility for
 * physical stock before it can be promised to anyone.
 */
async function putaway(env, idem, actor, json) {
  const result = validatePutaway(idem.body)
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }
  const v = result.value

  const ids = v.lines.map((l) => l.batch_id)
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',')
  const rows = await env.DB.prepare(
    `SELECT b.batch_id, b.product_id, b.unit_cost_paise,
            COALESCE(sb.qty_milli, 0) AS in_recv
       FROM batches b
       LEFT JOIN stock_balances sb
         ON sb.batch_id = b.batch_id AND sb.location_id = 'WH-MLR/RECV'
      WHERE b.batch_id IN (${placeholders})`
  ).bind(...ids).all()

  const known = new Map((rows.results || []).map((r) => [r.batch_id, r]))
  const errors = []
  for (const l of v.lines) {
    const b = known.get(l.batch_id)
    if (!b) { errors.push(`Batch ${l.batch_id} does not exist.`); continue }
    if (b.in_recv < l.qty_milli) {
      errors.push(`Only ${b.in_recv / 1000} of that batch is in receiving.`)
    }
  }
  if (errors.length) { await idem.abandon(); return json(validationError(errors), 422) }

  const refId = shortId('pa')
  const statements = v.lines.flatMap((l) => {
    const b = known.get(l.batch_id)
    return movementPair(env, {
      refId: `${refId}-${l.batch_id}`,
      refType: 'putaway',
      refRowId: refId,
      from: 'WH-MLR/RECV',
      to: v.to_zone,
      batchId: l.batch_id,
      productId: b.product_id,
      qtyMilli: l.qty_milli,
      reason: 'putaway',
      unitCostPaise: b.unit_cost_paise,
      actor,
      notes: v.notes,
    })
  })

  const failed = await runBatch(env, statements)
  if (failed) { await idem.abandon(); return json({ error: failed.error, message: failed.message }, failed.status) }
  return idem.finish({ ok: true, toZone: v.to_zone, lines: v.lines.length })
}

/* ============================================== stock, batches, reports === */

async function stockOnHand(request, env, json) {
  const url = new URL(request.url)
  const location = url.searchParams.get('location')
  const productId = url.searchParams.get('productId')

  const where = ['sb.qty_milli <> 0', 'l.allow_negative = 0']
  const binds = []
  if (location) { binds.push(location); where.push(`sb.location_id = ?${binds.length}`) }
  if (productId) { binds.push(productId); where.push(`b.product_id = ?${binds.length}`) }

  const today = istDateString()
  binds.push(today)
  const todayBind = binds.length

  const rows = await env.DB.prepare(
    `SELECT sb.location_id, l.label AS location_label, sb.qty_milli,
            b.batch_id, b.batch_code, b.expiry_date, b.status, b.unit_cost_paise,
            p.product_id, p.name AS product_name, p.category, p.uom,
            CAST(julianday(b.expiry_date) - julianday(?${todayBind}) AS INTEGER) AS days_to_expiry
       FROM stock_balances sb
       JOIN batches   b ON b.batch_id = sb.batch_id
       JOIN products  p ON p.product_id = b.product_id
       JOIN locations l ON l.location_id = sb.location_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.name ASC, b.expiry_date ASC`
  ).bind(...binds).all()

  const items = (rows.results || []).map((r) => ({
    locationId: r.location_id,
    locationLabel: r.location_label,
    batchId: r.batch_id,
    batchCode: r.batch_code,
    productId: r.product_id,
    productName: r.product_name,
    category: r.category,
    uom: r.uom,
    qtyMilli: r.qty_milli,
    expiryDate: r.expiry_date,
    daysToExpiry: r.expiry_date ? r.days_to_expiry : null,
    expired: r.expiry_date != null && r.expiry_date <= today,
    quarantined: r.status !== 'active',
    unitCostPaise: r.unit_cost_paise,
    valuePaise: Math.round((r.qty_milli * r.unit_cost_paise) / 1000),
  }))

  const byZone = {}
  for (const it of items) {
    byZone[it.locationId] ??= { locationId: it.locationId, label: it.locationLabel, qtyMilli: 0, valuePaise: 0 }
    byZone[it.locationId].qtyMilli += it.qtyMilli
    byZone[it.locationId].valuePaise += it.valuePaise
  }

  return json({
    asOf: today,
    items,
    zones: Object.values(byZone),
    totalValuePaise: items.reduce((s, i) => s + i.valuePaise, 0),
  })
}

/**
 * Resolves a scanned or typed code.
 *
 * Accepts one of our batch codes or a manufacturer barcode, and says which it
 * got, so a caller can react rather than guess.
 */
async function lookupCode(request, env, json) {
  const url = new URL(request.url)
  const raw = (url.searchParams.get('code') || '').trim()
  if (!raw) return json({ error: 'validation', message: 'Pass a code to look up.' }, 422)

  const today = istDateString()
  const canonical = normaliseBatchCode(raw)

  if (canonical) {
    const b = await env.DB.prepare(
      `SELECT b.batch_id, b.batch_code, b.expiry_date, b.status, b.mrp_paise,
              p.product_id, p.name AS product_name, p.uom,
              CAST(julianday(b.expiry_date) - julianday(?2) AS INTEGER) AS days_to_expiry
         FROM batches b JOIN products p ON p.product_id = b.product_id
        WHERE b.batch_code = ?1`
    ).bind(canonical, today).first()

    if (b) {
      const at = await env.DB.prepare(
        `SELECT sb.location_id, l.label, sb.qty_milli
           FROM stock_balances sb JOIN locations l ON l.location_id = sb.location_id
          WHERE sb.batch_id = ?1 AND sb.qty_milli <> 0 AND l.allow_negative = 0`
      ).bind(b.batch_id).all()

      return json({
        match: 'batch',
        batch: {
          id: b.batch_id,
          code: b.batch_code,
          productId: b.product_id,
          productName: b.product_name,
          uom: b.uom,
          mrpPaise: b.mrp_paise,
          expiryDate: b.expiry_date,
          daysToExpiry: b.expiry_date ? b.days_to_expiry : null,
          expired: b.expiry_date != null && b.expiry_date <= today,
          quarantined: b.status !== 'active',
          locations: (at.results || []).map((r) => ({
            locationId: r.location_id, label: r.label, qtyMilli: r.qty_milli,
          })),
        },
      })
    }
  }

  // Not one of ours: try a manufacturer barcode, and answer with that product's
  // batches in FEFO order so the caller can pick.
  const p = await env.DB.prepare(
    'SELECT product_id, name, uom, mrp_paise FROM products WHERE barcode = ?1'
  ).bind(raw).first()

  if (p) {
    const batches = await fefoAvailable(env, p.product_id, { includeBlocked: true })
    return json({
      match: 'product',
      product: { id: p.product_id, name: p.name, uom: p.uom, mrpPaise: p.mrp_paise },
      batches,
    })
  }

  return json({
    error: 'unknown_code',
    message: canonical
      ? 'That batch code is well-formed but unknown.'
      : 'That code is not one of ours and does not match a product barcode.',
  }, 404)
}

async function expiryReport(request, env, json) {
  const url = new URL(request.url)
  const withinDays = Math.min(Number(url.searchParams.get('withinDays')) || 30, 365)
  const today = istDateString()

  const rows = await env.DB.prepare(
    `SELECT sb.location_id, l.label AS location_label, sb.qty_milli,
            b.batch_id, b.batch_code, b.expiry_date, b.unit_cost_paise,
            p.name AS product_name, p.uom,
            CAST(julianday(b.expiry_date) - julianday(?1) AS INTEGER) AS days_to_expiry
       FROM stock_balances sb
       JOIN batches   b ON b.batch_id = sb.batch_id
       JOIN products  p ON p.product_id = b.product_id
       JOIN locations l ON l.location_id = sb.location_id
      WHERE sb.qty_milli > 0
        AND l.allow_negative = 0
        AND b.expiry_date IS NOT NULL
        AND julianday(b.expiry_date) - julianday(?1) <= ?2
      ORDER BY b.expiry_date ASC`
  ).bind(today, withinDays).all()

  const batches = (rows.results || []).map((r) => ({
    batchId: r.batch_id,
    batchCode: r.batch_code,
    productName: r.product_name,
    uom: r.uom,
    locationId: r.location_id,
    locationLabel: r.location_label,
    qtyMilli: r.qty_milli,
    expiryDate: r.expiry_date,
    daysToExpiry: r.days_to_expiry,
    expired: r.expiry_date <= today,
    valuePaise: Math.round((r.qty_milli * r.unit_cost_paise) / 1000),
  }))

  return json({
    asOf: today,
    withinDays,
    batches,
    summary: {
      expiredCount: batches.filter((b) => b.expired).length,
      expiredValuePaise: batches.filter((b) => b.expired).reduce((s, b) => s + b.valuePaise, 0),
      nearExpiryCount: batches.filter((b) => !b.expired).length,
      nearExpiryValuePaise: batches.filter((b) => !b.expired).reduce((s, b) => s + b.valuePaise, 0),
    },
  })
}

/* ========================================================= write-offs ===== */

async function createWriteOff(env, idem, actor, json) {
  const result = validateWriteOff(idem.body)
  if (!result.ok) { await idem.abandon(); return json(validationError(result.errors), 422) }
  const v = result.value

  const batch = await env.DB.prepare(
    `SELECT b.batch_id, b.product_id, b.unit_cost_paise,
            COALESCE(sb.qty_milli, 0) AS here
       FROM batches b
       LEFT JOIN stock_balances sb
         ON sb.batch_id = b.batch_id AND sb.location_id = ?2
      WHERE b.batch_id = ?1`
  ).bind(v.batch_id, v.location_id).first()

  if (!batch) { await idem.abandon(); return json({ error: 'not_found', message: 'No such batch.' }, 404) }
  if (batch.here < v.qty_milli) {
    await idem.abandon()
    return json({
      error: 'insufficient_stock',
      message: `Only ${batch.here / 1000} of that batch is at ${v.location_id}.`,
    }, 422)
  }

  const fy = financialYear()
  const woId = shortId('wo')
  const value = Math.round((v.qty_milli * batch.unit_cost_paise) / 1000)

  const statements = [
    counterBumpStatement(env, 'WO', fy),
    env.DB.prepare(
      `INSERT INTO write_offs (
         writeoff_id, wo_number, fy, seq, location_id, batch_id, product_id,
         qty_milli, reason, value_paise, supplier_claim, created_by, notes
       )
       SELECT ?1, ${DOC_NUMBER_SQL}, ?2, c.last_no, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
         FROM document_counters c WHERE c.series = 'WO' AND c.fy = ?2`
    ).bind(
      woId, fy, v.location_id, v.batch_id, batch.product_id, v.qty_milli,
      v.reason, value, v.supplier_claim, actor, v.notes,
    ),
    ...movementPair(env, {
      refId: woId,
      refType: 'write_off',
      refRowId: woId,
      from: v.location_id,
      to: 'SCRAP',
      batchId: v.batch_id,
      productId: batch.product_id,
      qtyMilli: v.qty_milli,
      reason: 'writeoff',
      unitCostPaise: batch.unit_cost_paise,
      actor,
      notes: v.notes,
    }),
  ]

  const failed = await runBatch(env, statements)
  if (failed) { await idem.abandon(); return json({ error: failed.error, message: failed.message }, failed.status) }

  const saved = await env.DB.prepare(
    'SELECT wo_number FROM write_offs WHERE writeoff_id = ?1'
  ).bind(woId).first()

  return idem.finish({
    ok: true,
    id: woId,
    woNumber: saved?.wo_number,
    valuePaise: value,
    supplierClaim: v.supplier_claim === 1,
  })
}

/* ============================================================= router ===== */

/**
 * Routes /api/inv/*. `auth` is already verified; each route states its roles.
 * `idem` is present for every non-GET (the caller sets it up).
 */
export async function routeInventory(request, env, auth, idem, json) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  const actor = auth.email

  /** Guard for anything that manages stock. Refillers are read-only. */
  const stockOnly = () => requireRole(auth, ...STOCK_ROLES)

  // ---- reference data ----------------------------------------------------
  if (path === '/api/inv/products' && method === 'GET')  return listProducts(request, env, json)
  if (path === '/api/inv/products' && method === 'POST') {
    const d = stockOnly(); if (d) { await idem.abandon(); return json(d, 403) }
    return createProduct(env, idem, actor, json)
  }
  const prodMatch = path.match(/^\/api\/inv\/products\/([\w:-]+)$/)
  if (prodMatch && method === 'PATCH') {
    const d = stockOnly(); if (d) { await idem.abandon(); return json(d, 403) }
    return patchProduct(env, idem, prodMatch[1], json)
  }

  if (path === '/api/inv/suppliers' && method === 'GET') {
    const d = stockOnly(); if (d) return json(d, 403)
    return listSuppliers(request, env, json)
  }
  if (path === '/api/inv/suppliers' && method === 'POST') {
    const d = stockOnly(); if (d) { await idem.abandon(); return json(d, 403) }
    return createSupplier(env, idem, json)
  }

  if (path === '/api/inv/zones' && method === 'GET') {
    return json({ zones: WAREHOUSE_ZONES })
  }

  // ---- inward ------------------------------------------------------------
  if (path === '/api/inv/purchase-bills' && method === 'GET') {
    const d = stockOnly(); if (d) return json(d, 403)
    return listPurchaseBills(request, env, json)
  }
  if (path === '/api/inv/purchase-bills' && method === 'POST') {
    const d = stockOnly(); if (d) { await idem.abandon(); return json(d, 403) }
    return createPurchaseBill(env, idem, actor, json)
  }
  const billMatch = path.match(/^\/api\/inv\/purchase-bills\/([\w:-]+)$/)
  if (billMatch && method === 'GET') {
    const d = stockOnly(); if (d) return json(d, 403)
    return getPurchaseBill(env, billMatch[1], json)
  }

  if (path === '/api/inv/putaway' && method === 'POST') {
    const d = stockOnly(); if (d) { await idem.abandon(); return json(d, 403) }
    return putaway(env, idem, actor, json)
  }

  // ---- stock and reports -------------------------------------------------
  if (path === '/api/inv/stock' && method === 'GET') {
    const d = stockOnly(); if (d) return json(d, 403)
    return stockOnHand(request, env, json)
  }
  if (path === '/api/inv/batches/lookup' && method === 'GET') {
    const d = stockOnly(); if (d) return json(d, 403)
    return lookupCode(request, env, json)
  }
  if (path === '/api/inv/reports/expiry' && method === 'GET') {
    const d = stockOnly(); if (d) return json(d, 403)
    return expiryReport(request, env, json)
  }

  if (path === '/api/inv/write-offs' && method === 'POST') {
    const d = stockOnly(); if (d) { await idem.abandon(); return json(d, 403) }
    return createWriteOff(env, idem, actor, json)
  }

  if (idem?.abandon) await idem.abandon()
  return json({ error: 'not_found' }, 404)
}
