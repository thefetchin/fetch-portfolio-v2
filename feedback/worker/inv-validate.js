import {
  GSTIN_RE,
  GST_RATES,
  INV_LIMITS,
  PRODUCT_CATEGORIES,
  UOM_OPTIONS,
  WAREHOUSE_ZONES,
  WRITEOFF_REASONS,
  valuesOf,
} from '../shared/constants.js'
import { cleanText } from './validate.js'
import { computeLine, computeTotals, isInterstate, istDateString, toMilli, toPaise } from './invoicing.js'
import { apportionCharges } from './inventory.js'

/**
 * Validation for inventory payloads.
 *
 * Same contract as validateDebitNote in invoicing.js: return either
 * { ok: true, value } with DB-column-shaped snake_case, or
 * { ok: false, errors: [human sentences] } which the router turns into a 422.
 *
 * Enum values are checked against shared/constants.js, which every CHECK
 * constraint in migrations/004_inventory.sql mirrors -- so a payload the
 * application accepts cannot be one the database refuses, and vice versa.
 */

const CATEGORY_SET = valuesOf(PRODUCT_CATEGORIES)
const UOM_SET = valuesOf(UOM_OPTIONS)
const GST_SET = new Set(GST_RATES.map((r) => r.value))
const ZONE_SET = new Set(WAREHOUSE_ZONES.map((z) => z.value))
const WRITEOFF_SET = valuesOf(WRITEOFF_REASONS)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v))

/** Days between two YYYY-MM-DD dates, b - a. */
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/* --------------------------------------------------------------- product -- */

export function validateProduct(payload, { partial = false } = {}) {
  const errors = []
  const p = payload || {}
  const v = {}

  const has = (k) => p[k] !== undefined

  if (!partial || has('sku')) {
    v.sku = cleanText(p.sku, INV_LIMITS.sku)?.toUpperCase() || null
    if (!v.sku) errors.push('A SKU is required.')
  }
  if (!partial || has('name')) {
    v.name = cleanText(p.name, INV_LIMITS.productName)
    if (!v.name) errors.push('A product name is required.')
  }
  if (!partial || has('category')) {
    v.category = typeof p.category === 'string' && CATEGORY_SET.has(p.category) ? p.category : null
    if (!v.category) errors.push('Pick a valid product category.')
  }
  if (!partial || has('uom')) {
    v.uom = typeof p.uom === 'string' && UOM_SET.has(p.uom) ? p.uom : 'pcs'
  }
  if (!partial || has('gstBps')) {
    const g = Number(p.gstBps)
    v.gst_bps = GST_SET.has(g) ? g : 0
  }
  if (has('hsn')) {
    const hsn = cleanText(p.hsn, INV_LIMITS.hsn ?? 8)
    if (hsn && !/^\d{4,8}$/.test(hsn)) errors.push('HSN must be 4 to 8 digits.')
    v.hsn = hsn && /^\d{4,8}$/.test(hsn) ? hsn : null
  }
  if (has('mrp')) {
    v.mrp_paise = p.mrp === '' || p.mrp == null ? null : toPaise(p.mrp)
    if (v.mrp_paise !== null && v.mrp_paise <= 0) errors.push('MRP must be more than zero.')
  }
  if (has('shelfLifeDays')) {
    const n = Number(p.shelfLifeDays)
    v.shelf_life_days = Number.isInteger(n) && n > 0 ? n : null
  }
  if (has('minShelfLifeDays')) {
    const n = Number(p.minShelfLifeDays)
    v.min_shelf_life_days = Number.isInteger(n) && n >= 0 ? n : null
  }
  if (has('barcode')) v.barcode = cleanText(p.barcode, 40)
  if (has('vliteProductId')) {
    const n = Number(p.vliteProductId)
    v.vlite_product_id = Number.isInteger(n) && n > 0 ? n : null
  }
  if (has('active')) v.active = p.active ? 1 : 0

  return errors.length ? { ok: false, errors } : { ok: true, value: v }
}

/* -------------------------------------------------------------- supplier -- */

export function validateSupplier(payload, { partial = false } = {}) {
  const errors = []
  const p = payload || {}
  const v = {}
  const has = (k) => p[k] !== undefined

  if (!partial || has('name')) {
    v.name = cleanText(p.name, INV_LIMITS.supplierName)
    if (!v.name) errors.push('A supplier name is required.')
  }
  if (!partial || has('gstin')) {
    const g = cleanText(p.gstin, 15)?.toUpperCase() || null
    if (g && !GSTIN_RE.test(g)) errors.push('That GSTIN is not valid. It should be 15 characters.')
    v.gstin = g && GSTIN_RE.test(g) ? g : null
    v.state_code = v.gstin ? v.gstin.slice(0, 2) : null
  }
  if (has('address')) v.address = cleanText(p.address, INV_LIMITS.supplierAddress)
  if (has('phone'))   v.phone = cleanText(p.phone, 20)
  if (has('email'))   v.email = cleanText(p.email, 160)?.toLowerCase() || null
  if (has('active'))  v.active = p.active ? 1 : 0

  return errors.length ? { ok: false, errors } : { ok: true, value: v }
}

/* --------------------------------------------------------- purchase bill -- */

/**
 * A purchase bill and its lines. Each line becomes exactly one batch, which is
 * the only way stock enters the warehouse.
 *
 * Tax uses computeLine/computeTotals from invoicing.js unchanged, so a purchase
 * bill and a debit note can never disagree about GST arithmetic.
 *
 * `products` is a Map of product_id -> { shelf_life_days, gst_bps, hsn, name }
 * used for expiry sanity checks; pass what the handler has already loaded.
 */
export function validatePurchaseBill(payload, products = new Map()) {
  const errors = []
  const p = payload || {}
  const today = istDateString()

  const supplierId = cleanText(p.supplierId, 40)
  if (!supplierId) errors.push('Choose a supplier.')

  const billNo = cleanText(p.supplierBillNo, INV_LIMITS.billNumber)
  if (!billNo) errors.push("Enter the supplier's bill number.")

  const billDate = isDate(p.billDate) ? p.billDate : null
  if (!billDate) errors.push('Enter the bill date as YYYY-MM-DD.')
  else if (billDate > today) errors.push('The bill date cannot be in the future.')

  const receivedDate = isDate(p.receivedDate) ? p.receivedDate : today
  if (billDate && receivedDate < billDate) {
    errors.push('Goods cannot be received before the bill date.')
  }

  const gstin = cleanText(p.supplierGstin, 15)?.toUpperCase() || null
  if (gstin && !GSTIN_RE.test(gstin)) errors.push('That GSTIN is not valid.')
  const interstate = typeof p.isInterstate === 'boolean'
    ? p.isInterstate
    : isInterstate(gstin && GSTIN_RE.test(gstin) ? gstin : null)

  const rawLines = Array.isArray(p.lines) ? p.lines : []
  if (rawLines.length === 0) errors.push('Add at least one line.')
  if (rawLines.length > INV_LIMITS.maxBillLines) {
    errors.push(`A bill can have at most ${INV_LIMITS.maxBillLines} lines.`)
  }

  const lines = []
  rawLines.slice(0, INV_LIMITS.maxBillLines).forEach((l, i) => {
    const n = i + 1
    const productId = cleanText(l.productId, 40)
    const product = productId ? products.get(productId) : null
    if (!productId) { errors.push(`Line ${n}: choose a product.`); return }
    if (products.size && !product) { errors.push(`Line ${n}: that product does not exist.`); return }

    const qty = toMilli(l.qty)
    if (qty === null) { errors.push(`Line ${n}: enter a quantity greater than zero.`); return }
    if (qty > INV_LIMITS.maxQtyMilli) { errors.push(`Line ${n}: that quantity looks wrong.`); return }

    const freeQty = l.freeQty === '' || l.freeQty == null ? 0 : (toMilli(l.freeQty) ?? 0)

    const rate = toPaise(l.rate)
    if (rate === null) { errors.push(`Line ${n}: enter a rate.`); return }

    const discount = l.discount === '' || l.discount == null ? 0 : (toPaise(l.discount) ?? 0)

    const gstBps = GST_SET.has(Number(l.gstBps)) ? Number(l.gstBps) : (product?.gst_bps ?? 0)
    const uom = typeof l.uom === 'string' && UOM_SET.has(l.uom) ? l.uom : (product?.uom ?? 'pcs')

    // Expiry is the keystone of every downstream guarantee, so it is checked
    // hard here: one mistyped year would silently disable the expiry gate for
    // this batch for as long as it exists.
    const expiry = isDate(l.expiryDate) ? l.expiryDate : null
    if (!expiry) {
      errors.push(`Line ${n}: an expiry date is required — no expiry, no batch.`)
    }
    const mfg = isDate(l.mfgDate) ? l.mfgDate : null
    if (mfg && expiry && expiry <= mfg) {
      errors.push(`Line ${n}: the expiry date must be after the manufacture date.`)
    }
    if (expiry && billDate && expiry < billDate) {
      errors.push(`Line ${n}: that batch had already expired on the bill date — check the date.`)
    }
    const shelf = product?.shelf_life_days
    if (expiry && shelf && daysBetween(today, expiry) > Math.ceil(shelf * 1.5)) {
      errors.push(
        `Line ${n}: that expiry is further out than this product's shelf life allows `
        + `(${shelf} days). Check the year.`
      )
    }

    const description = cleanText(l.description, INV_LIMITS.description ?? 160)
      || product?.name || 'Item'
    const hsn = cleanText(l.hsn, 8) || product?.hsn || null

    const computed = computeLine(
      { qty_milli: qty, rate_paise: rate, gst_bps: gstBps },
      interstate,
    )
    if (computed.total_paise > INV_LIMITS.maxLineValuePaise) {
      errors.push(`Line ${n}: that line total looks too large — check the quantity and rate.`)
    }

    lines.push({
      line_no: n,
      product_id: productId,
      description,
      hsn,
      qty_milli: qty,
      free_qty_milli: freeQty,
      uom,
      rate_paise: rate,
      discount_paise: discount,
      gst_bps: gstBps,
      taxable_paise: computed.taxable_paise,
      cgst_paise: computed.cgst_paise,
      sgst_paise: computed.sgst_paise,
      igst_paise: computed.igst_paise,
      total_paise: computed.total_paise,
      landed_extra_paise: 0,
      mfg_date: mfg,
      expiry_date: expiry,
      supplier_batch_no: cleanText(l.supplierBatchNo, INV_LIMITS.supplierBatchNo),
      mrp_paise: l.mrp === '' || l.mrp == null ? null : toPaise(l.mrp),
    })
  })

  if (errors.length) return { ok: false, errors }

  const freight = p.freight === '' || p.freight == null ? 0 : (toPaise(p.freight) ?? 0)
  const shares = apportionCharges(lines, freight)
  lines.forEach((l, i) => { l.landed_extra_paise = shares[i] })

  const totals = computeTotals(lines)

  return {
    ok: true,
    value: {
      supplier_id: supplierId,
      supplier_bill_no: billNo,
      bill_date: billDate,
      received_date: receivedDate,
      is_interstate: interstate ? 1 : 0,
      itc_eligible: p.itcEligible === false ? 0 : 1,
      freight_paise: freight,
      notes: cleanText(p.notes, INV_LIMITS.notes),
      lines,
      taxable_paise: totals.taxable_paise,
      cgst_paise: totals.cgst_paise,
      sgst_paise: totals.sgst_paise,
      igst_paise: totals.igst_paise,
      // computeTotals rounds the goods value; freight is added on top and the
      // whole thing re-rounded so the document total is a whole rupee.
      round_off_paise: totals.round_off_paise,
      total_paise: totals.total_paise + freight,
    },
  }
}

/* --------------------------------------------------------------- putaway -- */

export function validatePutaway(payload) {
  const errors = []
  const p = payload || {}

  const toZone = typeof p.toZone === 'string' && ZONE_SET.has(p.toZone) ? p.toZone : null
  if (!toZone) errors.push('Choose where the stock is going.')
  if (toZone === 'WH-MLR/RECV') errors.push('Stock is already in receiving — pick somewhere else.')
  if (toZone === 'WH-MLR/STAGE') errors.push('Staging is filled by picking a run, not by putaway.')

  const rawLines = Array.isArray(p.lines) ? p.lines : []
  if (rawLines.length === 0) errors.push('Nothing to put away.')

  const lines = []
  rawLines.forEach((l, i) => {
    const n = i + 1
    const batchId = cleanText(l.batchId, 40)
    const qty = toMilli(l.qty)
    if (!batchId) { errors.push(`Line ${n}: which batch?`); return }
    if (qty === null) { errors.push(`Line ${n}: enter a quantity greater than zero.`); return }
    lines.push({ batch_id: batchId, qty_milli: qty })
  })

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { to_zone: toZone, lines, notes: cleanText(p.notes, INV_LIMITS.notes) } }
}

/* ------------------------------------------------------------- write-off -- */

export function validateWriteOff(payload) {
  const errors = []
  const p = payload || {}

  const batchId = cleanText(p.batchId, 40)
  if (!batchId) errors.push('Which batch?')

  const locationId = cleanText(p.locationId, 60)
  if (!locationId) errors.push('Where is the stock being written off from?')

  const qty = toMilli(p.qty)
  if (qty === null) errors.push('Enter a quantity greater than zero.')

  const reason = typeof p.reason === 'string' && WRITEOFF_SET.has(p.reason) ? p.reason : null
  if (!reason) errors.push('Pick a reason.')

  const notes = cleanText(p.notes, INV_LIMITS.notes)
  if (reason === 'other' && !notes) {
    errors.push('"Other" needs a note explaining what happened.')
  }

  return errors.length ? { ok: false, errors } : {
    ok: true,
    value: {
      batch_id: batchId,
      location_id: locationId,
      qty_milli: qty,
      reason,
      supplier_claim: p.supplierClaim ? 1 : 0,
      notes,
    },
  }
}

export { isDate, daysBetween }
