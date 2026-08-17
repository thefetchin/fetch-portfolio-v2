import { PRODUCT_CATEGORIES, INV_LIMITS, valuesOf } from '../shared/constants.js'
import { cleanText } from './validate.js'
import { VliteError, getProducts } from './vlite.js'

/**
 * Importing the product catalogue from VLite.
 *
 * VLite already holds the branch catalogue that the machines vend from, so
 * retyping it here would guarantee the two drift apart. This pulls it and lets a
 * manager choose what to bring across.
 *
 * What is imported is only ever identity and pricing metadata: name, HSN, MRP,
 * GST, and the barcode. Batch, expiry, quantity and cost remain ours -- VLite is
 * the machine controller, not a second copy of the inventory.
 */

const CATEGORY_SET = valuesOf(PRODUCT_CATEGORIES)

/**
 * Best-effort mapping from VLite's free-text category to one of ours.
 *
 * Ours are the same nine the feedback form uses, so "customers asked for more
 * protein bars" and "we stock these protein bars" line up without a mapping
 * table. VLite's are arbitrary strings, so this guesses and falls back to
 * 'other' -- a wrong guess is a dropdown away from being fixed, and marking
 * everything 'other' would make the guess useless.
 */
export function guessCategory(vliteCategory, subCategory, name) {
  const hay = `${vliteCategory || ''} ${subCategory || ''} ${name || ''}`.toLowerCase()
  const rules = [
    ['water',      /\b(water|mineral water|bisleri|kinley|aquafina)\b/],
    ['cold_drink', /\b(cold ?drink|soft ?drink|soda|cola|pepsi|sprite|juice|beverage|thums|fanta|mirinda|energy)\b/],
    ['coffee_tea', /\b(coffee|tea|chai|latte|cappuccino)\b/],
    ['chips',      /\b(chips|namkeen|wafer|crisps|lays|kurkure|bhujia|mixture|snack)\b/],
    ['chocolate',  /\b(chocolate|candy|choco|gum|mint|toffee|dairy milk|kitkat|munch|eclairs)\b/],
    ['protein',    /\b(protein|whey|bar|fitness|gym)\b/],
    ['healthy',    /\b(healthy|granola|oats|nuts|dry fruit|makhana|roasted|baked|millet)\b/],
    ['ready_meal', /\b(meal|noodles|pasta|upma|poha|sandwich|roll|biryani|cup)\b/],
  ]
  for (const [value, re] of rules) {
    if (re.test(hay) && CATEGORY_SET.has(value)) return value
  }
  return 'other'
}

/**
 * Lists the VLite catalogue alongside what we already have, so a manager can see
 * at a glance what is new, what is already linked, and what looks like the same
 * product arriving under a different id.
 */
export async function listVliteCatalogue(env, json) {
  let remote
  try {
    remote = await getProducts(env)
  } catch (err) {
    if (err instanceof VliteError) {
      return json({ error: err.code || 'vlite_unavailable', message: err.message }, err.status || 502)
    }
    throw err
  }

  const rows = await env.DB.prepare(
    `SELECT product_id, sku, name, barcode, vlite_product_id, hsn, gst_bps, mrp_paise, active
       FROM products`
  ).all()
  const mine = rows.results || []
  const byVlite = new Map(mine.filter((p) => p.vlite_product_id).map((p) => [p.vlite_product_id, p]))
  const byBarcode = new Map(mine.filter((p) => p.barcode).map((p) => [p.barcode, p]))

  const items = remote.map((r) => {
    const linked = byVlite.get(r.vliteProductId) || null
    // Not linked by id, but the barcode already exists here: almost certainly
    // the same physical product, entered by hand before this import existed.
    const sameBarcode = !linked && r.barcode ? byBarcode.get(r.barcode) || null : null

    return {
      ...r,
      status: linked ? 'linked' : sameBarcode ? 'matches_barcode' : 'new',
      localProductId: linked?.product_id || sameBarcode?.product_id || null,
      localName: linked?.name || sameBarcode?.name || null,
      suggestedCategory: guessCategory(r.category, r.subCategory, r.name),
      // Flagged rather than hidden: a product with no barcode cannot be scanned,
      // which is worth knowing before someone tries to at goods-in.
      missingBarcode: !r.barcode,
    }
  })

  return json({
    items,
    summary: {
      total: items.length,
      linked: items.filter((i) => i.status === 'linked').length,
      matchesBarcode: items.filter((i) => i.status === 'matches_barcode').length,
      new: items.filter((i) => i.status === 'new').length,
      missingBarcode: items.filter((i) => i.missingBarcode).length,
      missingGst: items.filter((i) => i.gstBps == null).length,
    },
  })
}

/**
 * Imports chosen VLite products.
 *
 * Three cases, and it matters that they are distinct:
 *   - link      an existing product of ours gains the VLite id and barcode
 *   - create    a new product of ours
 *   - skip      already linked, nothing to do
 *
 * Never destructive: an import fills blanks and sets the link, but does not
 * overwrite a name, MRP or GST rate a manager has already corrected by hand. If
 * VLite and we disagree, the local value is the one someone chose deliberately.
 */
export async function importVliteProducts(env, idem, actor, json, validationError, shortId) {
  const body = idem.body || {}
  const wanted = Array.isArray(body.vliteProductIds)
    ? body.vliteProductIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : []
  const overrides = body.categories && typeof body.categories === 'object' ? body.categories : {}

  if (!wanted.length) {
    await idem.abandon()
    return json(validationError(['Choose at least one product to import.']), 422)
  }
  if (wanted.length > 500) {
    await idem.abandon()
    return json(validationError(['Import at most 500 products at a time.']), 422)
  }

  let remote
  try {
    remote = await getProducts(env)
  } catch (err) {
    await idem.abandon()
    if (err instanceof VliteError) {
      return json({ error: err.code || 'vlite_unavailable', message: err.message }, err.status || 502)
    }
    throw err
  }

  const remoteById = new Map(remote.map((r) => [r.vliteProductId, r]))
  const missing = wanted.filter((id) => !remoteById.has(id))
  if (missing.length) {
    await idem.abandon()
    return json(validationError([
      `${missing.length} of those products are no longer in the VLite catalogue. Refresh and try again.`,
    ]), 422)
  }

  const rows = await env.DB.prepare(
    'SELECT product_id, sku, name, barcode, vlite_product_id FROM products'
  ).all()
  const mine = rows.results || []
  const byVlite = new Map(mine.filter((p) => p.vlite_product_id).map((p) => [p.vlite_product_id, p]))
  const byBarcode = new Map(mine.filter((p) => p.barcode).map((p) => [p.barcode, p]))
  const skus = new Set(mine.map((p) => p.sku))

  const statements = []
  const created = []
  const linked = []
  const skipped = []

  /** A stable, readable SKU from VLite's own display id, kept unique. */
  const skuFor = (r) => {
    const base = (cleanText(r.displayProductId, INV_LIMITS.sku)
      || cleanText(r.name, INV_LIMITS.sku)
      || `VL${r.vliteProductId}`)
      .toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    let sku = base || `VL${r.vliteProductId}`
    let n = 2
    while (skus.has(sku)) sku = `${base}-${n++}`.slice(0, 40)
    skus.add(sku)
    return sku
  }

  for (const id of wanted) {
    const r = remoteById.get(id)
    const existing = byVlite.get(id)

    if (existing) { skipped.push({ vliteProductId: id, name: r.name, reason: 'already linked' }); continue }

    const match = r.barcode ? byBarcode.get(r.barcode) : null
    const category = CATEGORY_SET.has(overrides[String(id)])
      ? overrides[String(id)]
      : guessCategory(r.category, r.subCategory, r.name)

    if (match) {
      // Link, and fill only what is blank locally. COALESCE keeps a hand-entered
      // value winning over VLite's.
      statements.push(env.DB.prepare(
        `UPDATE products
            SET vlite_product_id = ?2,
                barcode  = COALESCE(barcode, ?3),
                hsn      = COALESCE(hsn, ?4),
                mrp_paise = COALESCE(mrp_paise, ?5),
                gst_bps  = CASE WHEN gst_bps = 0 AND ?6 IS NOT NULL THEN ?6 ELSE gst_bps END,
                updated_at = datetime('now')
          WHERE product_id = ?1`
      ).bind(match.product_id, id, r.barcode, r.hsn, r.mrpPaise, r.gstBps))
      linked.push({ vliteProductId: id, productId: match.product_id, name: match.name })
      continue
    }

    const productId = shortId('prd')
    statements.push(env.DB.prepare(
      `INSERT INTO products
         (product_id, sku, name, category, hsn, uom, gst_bps, mrp_paise, barcode, vlite_product_id)
       VALUES (?1,?2,?3,?4,?5,'pcs',?6,?7,?8,?9)`
    ).bind(
      productId,
      skuFor(r),
      cleanText(r.name, INV_LIMITS.productName) || `VLite ${id}`,
      category,
      r.hsn && /^\d{4,8}$/.test(r.hsn) ? r.hsn : null,
      r.gstBps ?? 0,
      r.mrpPaise && r.mrpPaise > 0 ? r.mrpPaise : null,
      r.barcode,
      id,
    ))
    created.push({ vliteProductId: id, productId, name: r.name, category, barcode: r.barcode })
  }

  if (!statements.length) {
    return idem.finish({ ok: true, created: [], linked: [], skipped, message: 'Everything chosen was already linked.' })
  }

  try {
    await env.DB.batch(statements)
  } catch (err) {
    await idem.abandon()
    throw err
  }

  return idem.finish({
    ok: true,
    created,
    linked,
    skipped,
    // Shelf life cannot come from VLite -- it does not hold one -- and without it
    // goods-in cannot default an expiry date. Say so plainly rather than let it
    // be discovered later at the receiving bench.
    followUp: created.length
      ? 'Set a shelf life on each new product: it defaults the expiry date at goods-in and catches a mistyped year.'
      : null,
  })
}
