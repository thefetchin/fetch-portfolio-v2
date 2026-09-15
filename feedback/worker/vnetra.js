import { cleanText } from './validate.js'
import { VliteError, getProducts } from './vlite.js'

/**
 * Comparing the VLite catalogue against vNetra's.
 *
 * The two systems are both Vendekin's, both hold the same physical products,
 * and both carry the same product CODE -- AT1CAD0021943 and friends. That code
 * is the whole basis of the match: it is exact, so nothing here guesses.
 *
 * Deliberately NOT fuzzy-matching on name. Two crisp packets whose names differ
 * by a gram weight are different products with different barcodes, and a
 * matcher confident enough to pair them is confident enough to push a product
 * into the wrong slot in a live vending catalogue. Where the code is absent, the
 * answer is "unmatched, look at it", which is the honest one.
 *
 * WRITING to vNetra is not done here. See pushPlan(): this module works out
 * WHAT would have to be pushed, and the transport that does the pushing is a
 * separate decision -- vNetra is a third party's Firebase project, and writing
 * to it needs credentials and a document schema we do not hold.
 */

/** vNetra and VLite product codes: AT1 + 3 letters + 7 digits. */
export const CODE_RE = /^AT1[A-Z]{3}\d{7}$/

/**
 * Codes are compared case- and whitespace-insensitively, and nothing else is
 * normalised. Stripping punctuation or leading zeros here would make two
 * genuinely different codes collide, which is the one failure this design
 * exists to avoid.
 */
export function normaliseCode(input) {
  if (typeof input !== 'string') return null
  const code = input.trim().toUpperCase().replace(/\s+/g, '')
  return code.length ? code : null
}

/** Names differ cosmetically between the two systems far more often than they
 *  differ meaningfully, so this is only ever used to FLAG a difference for a
 *  human, never to decide a match. */
export function sameName(a, b) {
  const clean = (s) => (typeof s === 'string' ? s : '')
    .toLowerCase()
    // Apostrophes are DELETED, not turned into a space: "Lay's" and "Lays" are
    // the same product, and splitting the first into "lay s" would report a
    // difference on most of the crisp range.
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const x = clean(a)
  const y = clean(b)
  if (!x || !y) return null      // unknown, not "different"
  return x === y
}

/**
 * Accepts a product list captured from vNetra and normalises it.
 *
 * Returns { rows, rejected } -- rejected rows are reported rather than dropped
 * silently, because a snapshot that quietly lost a third of its rows would show
 * up as "vNetra is missing 70 products" and send someone pushing duplicates.
 */
export function normaliseVnetraProducts(input) {
  const list = Array.isArray(input) ? input : []
  const rows = []
  const rejected = []
  const seen = new Set()

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      rejected.push({ reason: 'not_an_object', item: null })
      continue
    }
    const code = normaliseCode(item.code ?? item.productCode ?? item.product_code)
    if (!code) {
      rejected.push({ reason: 'no_code', name: cleanText(item.name, 120) })
      continue
    }
    if (!CODE_RE.test(code)) {
      rejected.push({ reason: 'bad_code_format', code })
      continue
    }
    if (seen.has(code)) {
      // A duplicate in the SNAPSHOT is a capture bug (the same page read
      // twice), not a duplicate in vNetra. Worth reporting, not worth failing.
      rejected.push({ reason: 'duplicate_in_snapshot', code })
      continue
    }
    seen.add(code)

    rows.push({
      code,
      name: cleanText(item.name, 200),
      hasImage: item.hasImage === true || item.has_image === true ? 1 : 0,
      vnetraDocId: cleanText(item.docId ?? item.vnetraDocId ?? item.id, 120),
      raw: JSON.stringify(item).slice(0, 4000),
    })
  }

  return { rows, rejected }
}

/**
 * The comparison itself.
 *
 * Four buckets, and the names matter because each implies a different action:
 *   missingInVnetra  in VLite, not in vNetra   -> candidates to push
 *   missingInVlite   in vNetra, not in VLite   -> retired here, or added there
 *   matched          in both, nothing to do
 *   nameMismatch     in both, but named differently -> a human decides
 */
export function compareCatalogues(vliteProducts, vnetraRows) {
  const vnetraByCode = new Map()
  for (const r of vnetraRows || []) {
    const code = normaliseCode(r.code)
    if (code) vnetraByCode.set(code, r)
  }

  const missingInVnetra = []
  const matched = []
  const nameMismatch = []
  const noCode = []
  const seenVliteCodes = new Set()

  for (const p of vliteProducts || []) {
    const code = normaliseCode(p.displayProductId)
    if (!code || !CODE_RE.test(code)) {
      // A VLite product with no usable code cannot be matched or pushed
      // safely. Surfaced rather than silently treated as missing, which would
      // invite someone to push a duplicate of something already there.
      noCode.push({
        vliteProductId: p.vliteProductId,
        name: p.name,
        displayProductId: p.displayProductId ?? null,
      })
      continue
    }
    seenVliteCodes.add(code)

    const there = vnetraByCode.get(code)
    if (!there) {
      missingInVnetra.push({
        code,
        name: p.name,
        vliteProductId: p.vliteProductId,
        barcode: p.barcode ?? null,
        mrpPaise: p.mrpPaise ?? null,
        gstBps: p.gstBps ?? null,
        hsn: p.hsn ?? null,
        hasImage: !!p.image,
      })
      continue
    }

    const same = sameName(p.name, there.name)
    const entry = {
      code,
      vliteName: p.name,
      vnetraName: there.name ?? null,
      vliteProductId: p.vliteProductId,
      vnetraHasImage: !!there.has_image,
      vliteHasImage: !!p.image,
    }
    if (same === false) nameMismatch.push(entry)
    else matched.push(entry)
  }

  const missingInVlite = []
  for (const [code, r] of vnetraByCode) {
    if (!seenVliteCodes.has(code)) {
      missingInVlite.push({ code, name: r.name ?? null, hasImage: !!r.has_image })
    }
  }

  const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]))
  missingInVnetra.sort(by('name'))
  missingInVlite.sort(by('code'))
  nameMismatch.sort(by('code'))
  matched.sort(by('code'))

  return {
    summary: {
      vlite: (vliteProducts || []).length,
      vnetra: vnetraByCode.size,
      matched: matched.length,
      nameMismatch: nameMismatch.length,
      missingInVnetra: missingInVnetra.length,
      missingInVlite: missingInVlite.length,
      noCode: noCode.length,
    },
    missingInVnetra,
    missingInVlite,
    nameMismatch,
    matched,
    noCode,
  }
}

/* ------------------------------------------------------------- handlers -- */

/**
 * Stores a snapshot of vNetra's catalogue.
 *
 * Upsert, never replace-all: a snapshot that failed halfway would otherwise
 * delete products that are still perfectly present in vNetra, and the next
 * comparison would tell someone to push two hundred duplicates. Rows that
 * vanish from vNetra go stale instead, visible through seen_at.
 */
export async function ingestVnetraSnapshot(env, idem, actor, json, validationError, shortId) {
  const body = idem.body || {}
  const { rows, rejected } = normaliseVnetraProducts(body.products)

  if (!rows.length) {
    await idem.abandon()
    return json(validationError([
      'That snapshot had no usable products in it. Every row needs a product code.',
    ]), 422)
  }
  if (rows.length > 5000) {
    await idem.abandon()
    return json(validationError(['That is more products than vNetra can plausibly hold.']), 422)
  }

  const source = body.source === 'api' ? 'api' : 'browser_bridge'
  const snapshotId = shortId('vns')

  const statements = [
    env.DB.prepare(
      `INSERT INTO vnetra_snapshots (snapshot_id, source, product_count, created_by)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(snapshotId, source, rows.length, actor || null),
  ]

  for (const r of rows) {
    statements.push(env.DB.prepare(
      `INSERT INTO vnetra_products (code, name, has_image, vnetra_doc_id, raw_json)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(code) DO UPDATE SET
         name          = excluded.name,
         has_image     = excluded.has_image,
         vnetra_doc_id = COALESCE(excluded.vnetra_doc_id, vnetra_doc_id),
         raw_json      = excluded.raw_json,
         seen_at       = datetime('now')`
    ).bind(r.code, r.name, r.hasImage, r.vnetraDocId, r.raw))
  }

  try {
    // D1 caps a batch, so this goes in chunks. Each chunk is atomic; a failure
    // partway leaves earlier chunks stored, which is harmless for an upsert
    // whose whole job is "these products exist".
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
    snapshotId,
    stored: rows.length,
    rejected,
    message: rejected.length
      ? `Stored ${rows.length} products. ${rejected.length} `
        + `${rejected.length === 1 ? 'row had' : 'rows had'} no usable product code `
        + 'and were not stored.'
      : `Stored ${rows.length} products from vNetra.`,
  })
}

/** Runs the comparison: VLite live, vNetra from the last snapshot. */
export async function compareWithVnetra(env, json) {
  // The local check comes FIRST. With no vNetra snapshot there is nothing to
  // compare against whatever VLite returns, so calling VLite would be a
  // round trip spent to reach the same answer.
  const stored = await env.DB.prepare(
    'SELECT code, name, has_image, vnetra_doc_id, seen_at FROM vnetra_products'
  ).all()
  const rows = stored.results || []

  const snapshot = await env.DB.prepare(
    `SELECT snapshot_id, source, product_count, created_at, created_by
       FROM vnetra_snapshots ORDER BY created_at DESC LIMIT 1`
  ).first()

  if (!rows.length) {
    // Saying "vNetra is missing all 229 products" when the truth is "we have
    // never been given vNetra's list" would be a lie that costs somebody a
    // morning of pushing duplicates.
    return json({
      ready: false,
      message: 'No vNetra catalogue has been captured yet, so there is nothing to compare against.',
      summary: { vlite: null, vnetra: 0 },
    })
  }

  let vlite
  try {
    vlite = await getProducts(env)
  } catch (err) {
    if (err instanceof VliteError) {
      return json({ error: err.code || 'vlite_unavailable', message: err.message }, err.status || 502)
    }
    throw err
  }

  const result = compareCatalogues(vlite, rows)
  return json({
    ready: true,
    snapshot: snapshot
      ? {
          capturedAt: snapshot.created_at,
          source: snapshot.source,
          productCount: snapshot.product_count,
          capturedBy: snapshot.created_by,
        }
      : null,
    ...result,
  })
}
