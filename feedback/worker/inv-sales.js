import { INV_LIMITS } from '../shared/constants.js'
import { cleanText } from './validate.js'
import { istDateString } from './invoicing.js'
import { VliteError, getTransactionLines, getTransactions } from './vlite.js'

/**
 * Sales pulled from VLite, and the margin on them.
 *
 * Both sides of the margin are NET OF GST. Revenue is the line's taxableAmount
 * rather than what the customer paid, because the GST collected is payable to
 * the government; cost is the batch's unit cost, which already excludes GST
 * because input credit is a receivable. Mixing the two conventions is how you
 * report a margin that looks plausible and is wrong by the tax rate.
 *
 * ==========================================================================
 * Why this imports in chunks
 * ==========================================================================
 * VLite returns transaction HEADERS from getTransactions and the line items only
 * from getTransactionDetails, one call per transaction. The Workers free plan
 * allows 50 subrequests per request, so a naive "import everything" would die
 * partway through a busy week with no way to know how far it got.
 *
 * So one call imports a bounded number of transactions and reports what is
 * left. The caller loops. The dedupe key on every line makes re-running
 * harmless, which is what lets the loop be dumb.
 */

/** 1 login + 1 getTransactions + N details, kept well inside the 50-subrequest cap. */
const MAX_TX_PER_CALL = 30

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** VLite takes epoch milliseconds. A date alone means the whole IST day. */
const startOfDayMs = (d) => Date.parse(`${d}T00:00:00+05:30`)
const endOfDayMs = (d) => Date.parse(`${d}T23:59:59.999+05:30`)

/**
 * Resolves the cost of one sold line, and says where the figure came from.
 *
 * The chain degrades honestly rather than substituting zero: a NULL cost gives a
 * NULL margin, which a report can show as "unknown" instead of quietly claiming
 * the whole sale was profit.
 */
export function resolveCost({ qtyMilli, batch, latestBatch, supplierPrice }) {
  const per = (unit) => Math.round((qtyMilli * unit) / 1000)

  if (batch && Number.isInteger(batch.unit_cost_paise)) {
    return { costPaise: per(batch.unit_cost_paise), source: 'batch' }
  }
  if (latestBatch && Number.isInteger(latestBatch.unit_cost_paise)) {
    return { costPaise: per(latestBatch.unit_cost_paise), source: 'latest_batch' }
  }
  if (supplierPrice && Number.isInteger(supplierPrice.price_paise) && supplierPrice.pack_milli > 0) {
    // A price quoted per case has to be divided down to a unit cost.
    const unit = Math.round((supplierPrice.price_paise * 1000) / supplierPrice.pack_milli)
    return { costPaise: per(unit), source: 'supplier_price' }
  }
  return { costPaise: null, source: 'unknown' }
}

/** The taxable (net) revenue for a line, however VLite chose to express it. */
export function netRevenue(line) {
  const taxable = Number(line.taxableAmount ?? NaN)
  if (Number.isFinite(taxable) && taxable >= 0) return { taxablePaise: taxable, gstPaise: Number(line.gst ?? 0) || 0 }

  // No taxableAmount: back it out of the gross and the tax components.
  const gross = Number(line.amountPaise ?? line.amount ?? 0) || 0
  const gst = (Number(line.gst ?? 0) || 0)
    || (Number(line.cgst ?? 0) || 0) + (Number(line.sgstOrUtgst ?? 0) || 0)
  return { taxablePaise: Math.max(0, gross - gst), gstPaise: gst }
}

/**
 * Imports one chunk of sales.
 *
 * Returns a plain object; the route wraps it. `remaining` being greater than
 * zero means call again with the same window -- already-imported lines collapse
 * on their dedupe key, so the caller does not have to track a cursor.
 */
export async function importSalesChunk(env, { from, to, maxTransactions = MAX_TX_PER_CALL, actor }) {
  const errors = []
  if (!DATE_RE.test(from || '')) errors.push('Give a start date as YYYY-MM-DD.')
  if (!DATE_RE.test(to || '')) errors.push('Give an end date as YYYY-MM-DD.')
  if (!errors.length && to < from) errors.push('The end date cannot be before the start date.')
  if (!errors.length && (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) {
    errors.push('Import at most about three months at a time.')
  }
  if (errors.length) return { ok: false, errors }

  const cap = Math.max(1, Math.min(Number(maxTransactions) || MAX_TX_PER_CALL, MAX_TX_PER_CALL))

  let headers
  try {
    headers = await getTransactions(env, {
      startDate: startOfDayMs(from),
      endDate: endOfDayMs(to),
      page: 0,
      limit: 200,
    })
  } catch (err) {
    if (err instanceof VliteError) return { ok: false, vlite: err }
    throw err
  }

  if (!headers.length) {
    return { ok: true, transactions: 0, imported: 0, skipped: 0, remaining: 0, unknownProducts: [] }
  }

  // Which transactions have we already got lines for? Cheaper than fetching
  // details for all of them and letting the dedupe index do the work, and it is
  // what makes the chunked loop finish instead of re-walking the same window.
  const seen = await env.DB.prepare(
    `SELECT DISTINCT trx_id FROM vlite_sales
      WHERE sold_at >= ?1 AND sold_at <= ?2`
  ).bind(`${from} 00:00:00`, `${to} 23:59:59`).all()
  const done = new Set((seen.results || []).map((r) => String(r.trx_id)))

  const pending = headers.filter((h) => !done.has(String(h.trxId)))
  const batchOf = pending.slice(0, cap)

  // Lookup tables, fetched once rather than per line.
  const [prodRows, podRows] = await Promise.all([
    env.DB.prepare(
      'SELECT product_id, name, vlite_product_id FROM products WHERE vlite_product_id IS NOT NULL'
    ).all(),
    env.DB.prepare(
      'SELECT pod_id, vlite_machine_id FROM pods WHERE vlite_machine_id IS NOT NULL'
    ).all(),
  ])
  const productByVlite = new Map((prodRows.results || []).map((r) => [r.vlite_product_id, r]))
  const podByMachine = new Map((podRows.results || []).map((r) => [r.vlite_machine_id, r.pod_id]))

  const latestBatch = new Map()
  const supplierPrice = new Map()
  if (productByVlite.size) {
    const ids = [...productByVlite.values()].map((p) => p.product_id)
    const ph = ids.map((_, i) => `?${i + 1}`).join(',')

    // Most recent batch per product, for the latest_batch fallback.
    const lb = await env.DB.prepare(
      `SELECT product_id, unit_cost_paise FROM batches b
        WHERE product_id IN (${ph})
          AND created_at = (SELECT MAX(created_at) FROM batches x WHERE x.product_id = b.product_id)`
    ).bind(...ids).all()
    for (const r of lb.results || []) latestBatch.set(r.product_id, r)

    const sp = await env.DB.prepare(
      `SELECT product_id, price_paise, pack_milli FROM supplier_prices p
        WHERE product_id IN (${ph})
          AND effective_from = (
            SELECT MAX(effective_from) FROM supplier_prices y
             WHERE y.product_id = p.product_id AND y.effective_from <= date('now', '+330 minutes'))`
    ).bind(...ids).all()
    for (const r of sp.results || []) supplierPrice.set(r.product_id, r)
  }

  const statements = []
  let imported = 0
  const unknownProducts = new Map()

  for (const h of batchOf) {
    let lines
    try {
      lines = await getTransactionLines(env, h.trxId)
    } catch (err) {
      if (err instanceof VliteError) {
        // One bad transaction must not lose the whole chunk's work.
        errors.push(`Transaction ${h.trxId}: ${err.message}`)
        continue
      }
      throw err
    }

    for (const l of lines) {
      const product = productByVlite.get(l.vliteProductId) || null
      if (!product) {
        unknownProducts.set(l.vliteProductId, l.productName || `VLite ${l.vliteProductId}`)
      }

      const qtyMilli = Math.round((Number(l.qty) || 0) * 1000)
      if (qtyMilli <= 0) continue

      const { taxablePaise, gstPaise } = netRevenue(l)
      const { costPaise, source } = product
        ? resolveCost({
            qtyMilli,
            batch: null,                                   // exact batch needs slot layers
            latestBatch: latestBatch.get(product.product_id),
            supplierPrice: supplierPrice.get(product.product_id),
          })
        : { costPaise: null, source: 'unknown' }

      statements.push(env.DB.prepare(
        `INSERT INTO vlite_sales (
           dedupe_key, vlite_machine_id, pod_id, trx_id, slot_name,
           vlite_product_id, product_id, product_name, batch_id,
           qty_milli, amount_paise, taxable_paise, gst_paise,
           cost_paise, cost_source, margin_paise, status, sold_at, booked
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?10,?11,?12,?13,?14,?15,?16,?17,0)
         ON CONFLICT(dedupe_key) DO NOTHING`
      ).bind(
        `vlite:${l.trxId}:${l.cartLineId}`,
        h.vliteMachineId,
        podByMachine.get(h.vliteMachineId) || null,
        String(l.trxId),
        cleanText(l.slotName, 20),
        l.vliteProductId ?? null,
        product?.product_id || null,
        cleanText(l.productName, INV_LIMITS.productName),
        qtyMilli,
        Number(l.amountPaise) || 0,
        taxablePaise,
        gstPaise,
        costPaise,
        source,
        costPaise == null ? null : taxablePaise - costPaise,
        cleanText(l.status, 40),
        new Date(Number(h.transactionTime) || Date.now()).toISOString().replace('T', ' ').slice(0, 19),
      ))
      imported++
    }
  }

  if (statements.length) {
    // Chunked: D1 has a per-batch statement ceiling, and a busy day of a popular
    // Pod can produce more lines than one batch should carry.
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50))
    }
  }

  return {
    ok: true,
    transactions: batchOf.length,
    imported,
    remaining: Math.max(0, pending.length - batchOf.length),
    // Named so a manager can go and import them from the catalogue: a sale of a
    // product we do not know about has no cost and so no margin.
    unknownProducts: [...unknownProducts.entries()].map(([id, name]) => ({ vliteProductId: id, name })),
    errors: errors.length ? errors : undefined,
  }
}

/**
 * Sales with their margin, grouped for a report.
 *
 * Deliberately reports how much of the period has a trustworthy cost, because a
 * margin computed over half the lines is a number people will quote without
 * knowing that.
 */
export async function salesReport(env, { from, to, groupBy = 'product', podId = null }) {
  const binds = [`${from} 00:00:00`, `${to} 23:59:59`]
  let where = 'sold_at >= ?1 AND sold_at <= ?2'
  if (podId) { binds.push(podId); where += ` AND pod_id = ?${binds.length}` }

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS lines,
            COALESCE(SUM(qty_milli), 0) AS qty_milli,
            COALESCE(SUM(amount_paise), 0) AS gross_paise,
            COALESCE(SUM(taxable_paise), 0) AS net_paise,
            COALESCE(SUM(gst_paise), 0) AS gst_paise,
            COALESCE(SUM(cost_paise), 0) AS cost_paise,
            COALESCE(SUM(margin_paise), 0) AS margin_paise,
            SUM(CASE WHEN cost_paise IS NULL THEN 1 ELSE 0 END) AS lines_without_cost,
            SUM(CASE WHEN cost_source = 'batch' THEN 1 ELSE 0 END) AS lines_exact_cost
       FROM vlite_sales WHERE ${where}`
  ).bind(...binds).first()

  const groupSql = groupBy === 'pod'
    ? 'COALESCE(pod_id, \'unmapped\')'
    : 'COALESCE(product_name, \'unknown product\')'

  const rows = await env.DB.prepare(
    `SELECT ${groupSql} AS grp,
            COUNT(*) AS lines,
            SUM(qty_milli) AS qty_milli,
            SUM(taxable_paise) AS net_paise,
            SUM(cost_paise) AS cost_paise,
            SUM(margin_paise) AS margin_paise,
            SUM(CASE WHEN cost_paise IS NULL THEN 1 ELSE 0 END) AS lines_without_cost
       FROM vlite_sales WHERE ${where}
      GROUP BY grp
      ORDER BY net_paise DESC
      LIMIT 200`
  ).bind(...binds).all()

  const t = totals || {}
  const net = t.net_paise || 0
  return {
    from,
    to,
    totals: {
      lines: t.lines || 0,
      qtyMilli: t.qty_milli || 0,
      grossPaise: t.gross_paise || 0,
      netPaise: net,
      gstPaise: t.gst_paise || 0,
      costPaise: t.cost_paise || 0,
      marginPaise: t.margin_paise || 0,
      marginBps: net > 0 ? Math.round(((t.margin_paise || 0) / net) * 10_000) : null,
      linesWithoutCost: t.lines_without_cost || 0,
      linesExactCost: t.lines_exact_cost || 0,
    },
    groups: (rows.results || []).map((r) => ({
      name: r.grp,
      lines: r.lines,
      qtyMilli: r.qty_milli,
      netPaise: r.net_paise || 0,
      costPaise: r.cost_paise || 0,
      marginPaise: r.margin_paise || 0,
      marginBps: r.net_paise > 0 ? Math.round(((r.margin_paise || 0) / r.net_paise) * 10_000) : null,
      linesWithoutCost: r.lines_without_cost || 0,
    })),
  }
}

/* ------------------------------------------------------- supplier prices -- */

export function validateSupplierPrice(payload) {
  const errors = []
  const p = payload || {}

  const supplierId = cleanText(p.supplierId, 40)
  const productId = cleanText(p.productId, 40)
  if (!supplierId) errors.push('Choose a supplier.')
  if (!productId) errors.push('Choose a product.')

  const price = p.price === '' || p.price == null
    ? null
    : Math.round((Number.parseFloat(String(p.price).replace(/,/g, '')) || 0) * 100)
  if (price == null || !Number.isFinite(price) || price < 0) {
    errors.push('Enter a price, excluding GST.')
  }

  const pack = p.packSize === '' || p.packSize == null
    ? 1000
    : Math.round((Number.parseFloat(p.packSize) || 0) * 1000)
  if (!(pack > 0)) errors.push('Pack size must be more than zero.')

  const from = DATE_RE.test(p.effectiveFrom || '') ? p.effectiveFrom : istDateString()
  const to = p.effectiveTo && DATE_RE.test(p.effectiveTo) ? p.effectiveTo : null
  if (to && to < from) errors.push('The end date cannot be before the start date.')

  const gst = Number(p.gstBps)

  return errors.length ? { ok: false, errors } : {
    ok: true,
    value: {
      supplier_id: supplierId,
      product_id: productId,
      price_paise: price,
      gst_bps: [0, 500, 1200, 1800, 2800].includes(gst) ? gst : 0,
      pack_milli: pack,
      effective_from: from,
      effective_to: to,
      notes: cleanText(p.notes, INV_LIMITS.notes),
    },
  }
}
