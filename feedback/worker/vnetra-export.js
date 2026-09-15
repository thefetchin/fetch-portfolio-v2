import { VliteError, getProducts } from './vlite.js'
import { CODE_RE, normaliseCode } from './vnetra.js'
import { rowFor, toCsv } from '../shared/vnetraCsv.js'
import { buildImageScript } from '../shared/vnetraImageScript.js'

/**
 * Generating the vNetra bulk upload, and remembering what has already gone in.
 *
 * The whole point is that the next export leaves out what the last one added.
 * Two rules make that trustworthy:
 *
 *   1. An export is NOT marked added when it is generated. It sits pending
 *      until someone confirms the upload worked. Marking at generation time
 *      would mean a rejected CSV silently excluded those products from every
 *      future export and they would never be uploaded at all -- a failure that
 *      is both invisible and permanent.
 *
 *   2. Products in a PENDING export are still excluded from a new one, so
 *      pressing Generate twice does not hand you the same products in two
 *      files and, from vNetra's side, two duplicate uploads.
 */

export const IMAGE_BASE = 'https://elite.vendoliteindia.com/api/resource/images/'

/** Everything vNetra is known to have, plus everything already in flight. */
async function excludedCodes(env) {
  const [known, pending] = await Promise.all([
    env.DB.prepare('SELECT code, origin FROM vnetra_products').all(),
    env.DB.prepare(
      `SELECT l.code FROM vnetra_export_lines l
         JOIN vnetra_exports e ON e.export_id = l.export_id
        WHERE e.status = 'pending'`
    ).all(),
  ])
  const set = new Set()
  let captured = 0
  let uploaded = 0
  for (const r of known.results || []) {
    set.add(r.code)
    if (r.origin === 'capture') captured++
    else uploaded++
  }
  const inFlight = new Set((pending.results || []).map((r) => r.code))
  for (const c of inFlight) set.add(c)
  return { set, captured, uploaded, inFlight: inFlight.size }
}

/**
 * Builds the CSV and the image script for everything VLite has that vNetra
 * does not, and records the attempt as pending.
 */
export async function generateExport(env, idem, actor, json, validationError, shortId) {
  let products
  try {
    products = await getProducts(env)
  } catch (err) {
    await idem.abandon()
    if (err instanceof VliteError) {
      return json({ error: err.code || 'vlite_unavailable', message: err.message }, err.status || 502)
    }
    throw err
  }

  const { set: excluded, captured, uploaded, inFlight } = await excludedCodes(env)

  const rows = []
  const lines = []
  const imageMap = {}
  const flagged = []
  const noHsn = []
  const noImage = []
  const noCode = []
  let alreadyThere = 0

  for (const p of products) {
    const code = normaliseCode(p.displayProductId)
    if (!code || !CODE_RE.test(code)) {
      // Cannot be matched or excluded next time, so it must not go in a file
      // that will be uploaded -- it would come back in every future export.
      noCode.push({ name: p.name || null, vliteProductId: p.vliteProductId })
      continue
    }
    if (excluded.has(code)) { alreadyThere++; continue }

    const { row, flag, hsn } = rowFor({ ...p, displayProductId: code })
    rows.push(row)

    const hasImage = !!p.image
    if (hasImage) imageMap[code] = p.image
    else noImage.push({ code, name: p.name || null })

    lines.push({ code, name: p.name || null, hasImage: hasImage ? 1 : 0 })
    if (flag) flagged.push({ code, name: p.name || null, flag })
    if (!hsn) noHsn.push({ code, name: p.name || null })
  }

  if (!rows.length) {
    await idem.abandon()
    return json({
      ok: true,
      empty: true,
      message: inFlight
        ? `Nothing new. ${inFlight} products are in an export that has not been confirmed yet.`
        : 'Nothing new — vNetra already has every product VLite knows about.',
      summary: { vlite: products.length, alreadyThere, captured, uploaded, inFlight, noCode: noCode.length },
    })
  }

  const exportId = shortId('vnx')
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

  const statements = [
    env.DB.prepare(
      `INSERT INTO vnetra_exports (export_id, status, product_count, image_count, created_by)
       VALUES (?1, 'pending', ?2, ?3, ?4)`
    ).bind(exportId, rows.length, Object.keys(imageMap).length, actor || null),
  ]
  for (const l of lines) {
    statements.push(env.DB.prepare(
      `INSERT INTO vnetra_export_lines (export_id, code, name, has_image)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(exportId, l.code, l.name, l.hasImage))
  }

  try {
    const CHUNK = 50
    for (let i = 0; i < statements.length; i += CHUNK) {
      await env.DB.batch(statements.slice(i, i + CHUNK))
    }
  } catch (err) {
    await idem.abandon()
    throw err
  }

  return idem.finish({
    ok: true,
    exportId,
    generatedAt,
    csv: toCsv(rows),
    csvFilename: `vnetra-products-${exportId}.csv`,
    imageScript: Object.keys(imageMap).length
      ? buildImageScript({ map: imageMap, base: IMAGE_BASE, generatedAt })
      : null,
    imageFilename: `vnetra-image-sync-${exportId}.js`,
    summary: {
      vlite: products.length,
      generated: rows.length,
      withImages: Object.keys(imageMap).length,
      alreadyThere, captured, uploaded, inFlight,
      noCode: noCode.length,
    },
    flagged, noHsn, noImage, noCode,
  })
}

/**
 * Settles a pending export.
 *
 * confirmed -- the upload worked, so these products now count as being in
 *              vNetra and every future export leaves them out.
 * discarded -- it did not, so they go straight back into the next one.
 */
export async function settleExport(env, idem, actor, json, validationError, exportId) {
  const body = idem.body || {}
  const status = body.status === 'confirmed' || body.status === 'discarded' ? body.status : null
  if (!status) {
    await idem.abandon()
    return json(validationError(['Say whether the upload worked or not.']), 422)
  }

  const exp = await env.DB.prepare(
    'SELECT export_id, status, product_count FROM vnetra_exports WHERE export_id = ?1'
  ).bind(exportId).first()
  if (!exp) {
    await idem.abandon()
    return json({ error: 'not_found', message: 'No such export.' }, 404)
  }
  if (exp.status !== 'pending') {
    await idem.abandon()
    return json({
      error: 'wrong_state',
      message: `That export was already ${exp.status}.`,
    }, 409)
  }

  const lines = await env.DB.prepare(
    'SELECT code, name, has_image FROM vnetra_export_lines WHERE export_id = ?1'
  ).bind(exportId).all()

  const statements = [
    env.DB.prepare(
      `UPDATE vnetra_exports
          SET status = ?2, settled_at = datetime('now'), note = ?3
        WHERE export_id = ?1 AND status = 'pending'`
    ).bind(exportId, status, typeof body.note === 'string' ? body.note.slice(0, 300) : null),
  ]

  if (status === 'confirmed') {
    for (const l of lines.results || []) {
      // origin 'bulk_upload' is asserted knowledge -- someone said the upload
      // worked. A later capture overwrites it with what was actually seen,
      // which is why the capture upsert does not preserve this value.
      statements.push(env.DB.prepare(
        `INSERT INTO vnetra_products (code, name, has_image, origin)
         VALUES (?1, ?2, ?3, 'bulk_upload')
         ON CONFLICT(code) DO UPDATE SET
           name    = COALESCE(vnetra_products.name, excluded.name),
           seen_at = datetime('now')`
      ).bind(l.code, l.name, l.has_image))
    }
  }

  try {
    const CHUNK = 50
    for (let i = 0; i < statements.length; i += CHUNK) {
      await env.DB.batch(statements.slice(i, i + CHUNK))
    }
  } catch (err) {
    await idem.abandon()
    throw err
  }

  const n = `${exp.product_count} product${exp.product_count === 1 ? '' : 's'}`
  return idem.finish({
    ok: true,
    status,
    products: exp.product_count,
    message: status === 'confirmed'
      ? `${n} recorded as in vNetra. Future exports will leave them out.`
      : `Export discarded. Those ${n} go back into the next one.`,
  })
}

/** Past exports, newest first, and whether anything is waiting to be settled. */
export async function listExports(env, json) {
  const rows = await env.DB.prepare(
    `SELECT export_id, status, product_count, image_count, created_by,
            created_at, settled_at, note
       FROM vnetra_exports ORDER BY created_at DESC LIMIT 50`
  ).all()

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM vnetra_products)                              AS known,
       (SELECT COUNT(*) FROM vnetra_products WHERE origin = 'capture')     AS captured,
       (SELECT COUNT(*) FROM vnetra_products WHERE origin = 'bulk_upload') AS uploaded,
       (SELECT COUNT(*) FROM vnetra_exports WHERE status = 'pending')      AS pending`
  ).first()

  return json({ exports: rows.results || [], counts })
}
