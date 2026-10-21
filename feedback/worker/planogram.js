import { cleanText } from './validate.js'
import { VliteError, getSlots, getProducts } from './vlite.js'
import { IMAGE_BASE } from './vnetra-export.js'

/**
 * Planograms: what each slot in a machine is meant to hold.
 *
 * `pod_slots` says what a machine HAS, synced from VLite. This says what it
 * SHOULD have. They are deliberately separate tables: a refiller comparing the
 * printed plan against the machine in front of them is the whole point, and a
 * plan that rewrote itself from reality could never disagree with it.
 *
 * Every slot holds an ordered list of products rather than one. Someone
 * standing at a machine with no Lay's left on the van cannot phone anybody, so
 * the sheet names the next choice, and the one after that.
 */

/** Ten is already more than anyone will read off a printed sheet. */
export const MAX_CHOICES_PER_SLOT = 10
export const MAX_SLOTS = 200

/** A full URL for a VLite image path, or null. Paths may already be absolute. */
export function imageUrl(path) {
  const p = typeof path === 'string' ? path.trim() : ''
  if (!p) return null
  if (/^https?:\/\//i.test(p)) return p
  return IMAGE_BASE + p.replace(/^\/+/, '')
}

/**
 * Puts the choices of one slot in order and strips what cannot be ranked.
 *
 * Ranks are rewritten 1..n rather than trusted: the editor reorders by moving
 * rows around, and a gap or a duplicate rank coming back from it would make
 * "second choice" mean nothing on the printed sheet.
 */
export function normaliseChoices(raw) {
  const seen = new Set()
  const out = []
  for (const c of Array.isArray(raw) ? raw : []) {
    const productId = cleanText(typeof c === 'string' ? c : c?.productId, 60)
    if (!productId || seen.has(productId)) continue
    seen.add(productId)
    out.push({ rank: out.length + 1, productId })
    if (out.length >= MAX_CHOICES_PER_SLOT) break
  }
  return out
}

/** A slot's name is what is printed on the machine; the rest is optional. */
export function normaliseSlot(raw) {
  const slotName = cleanText(raw?.slotName, 20)
  if (!slotName) return null
  const int = (v, min, max) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }
  return {
    slotName,
    rowNumber: int(raw?.rowNumber, 1, 50),
    columnNumber: int(raw?.columnNumber, 1, 50),
    capacity: int(raw?.capacity, 0, 999),
    note: cleanText(raw?.note, 80),
    choices: normaliseChoices(raw?.choices),
  }
}

/* ----------------------------------------------------------------- read -- */

export async function handlePlanogramGet(env, json, podId) {
  const pod = await env.DB.prepare(
    'SELECT pod_id, label, location, city, vlite_machine_id FROM pods WHERE pod_id = ?1'
  ).bind(podId).first()
  if (!pod) return json({ error: 'not_found', message: 'We could not find that machine.' }, 404)

  const [slots, choices, live] = await Promise.all([
    env.DB.prepare(
      `SELECT slot_name, row_number, column_number, capacity, note
         FROM planogram_slots WHERE pod_id = ?1
        ORDER BY row_number, column_number, slot_name`
    ).bind(podId).all(),
    env.DB.prepare(
      `SELECT c.slot_name, c.rank, c.product_id,
              p.name, p.sku, p.mrp_paise, p.image_url, p.category, p.active
         FROM planogram_choices c
         JOIN products p ON p.product_id = c.product_id
        WHERE c.pod_id = ?1
        ORDER BY c.slot_name, c.rank`
    ).bind(podId).all(),
    // What the machine is actually set to right now, so the editor can show
    // where the plan and the machine disagree without a round trip to VLite.
    env.DB.prepare(
      `SELECT s.slot_name, s.product_id, s.stock_limit, s.enable, p.name
         FROM pod_slots s
         LEFT JOIN products p ON p.product_id = s.product_id
        WHERE s.pod_id = ?1`
    ).bind(podId).all(),
  ])

  const bySlot = new Map()
  for (const c of choices.results || []) {
    if (!bySlot.has(c.slot_name)) bySlot.set(c.slot_name, [])
    bySlot.get(c.slot_name).push({
      rank: c.rank,
      productId: c.product_id,
      name: c.name,
      sku: c.sku,
      mrpPaise: c.mrp_paise,
      imageUrl: c.image_url,
      category: c.category,
      active: c.active === 1,
    })
  }

  const actual = new Map(
    (live.results || []).map((s) => [s.slot_name, {
      productId: s.product_id,
      productName: s.name,
      stockLimit: s.stock_limit,
      enabled: s.enable === 1,
    }])
  )

  return json({
    pod: {
      podId: pod.pod_id,
      label: pod.label,
      location: pod.location,
      city: pod.city,
      vliteMachineId: pod.vlite_machine_id,
    },
    slots: (slots.results || []).map((s) => ({
      slotName: s.slot_name,
      rowNumber: s.row_number,
      columnNumber: s.column_number,
      capacity: s.capacity,
      note: s.note,
      choices: bySlot.get(s.slot_name) || [],
      actual: actual.get(s.slot_name) || null,
    })),
  })
}

/* ---------------------------------------------------------------- write -- */

/**
 * Replaces the whole plan for one machine in a single batch.
 *
 * Whole-plan rather than per-slot because the editor holds the whole grid: a
 * partial save would leave a machine half planned if a request dropped, and
 * "which slots did it get to" is not a question anyone should have to answer
 * while standing in a warehouse.
 */
export async function handlePlanogramSave(env, idem, json, podId, validationError) {
  const body = idem.body || {}

  const pod = await env.DB.prepare('SELECT pod_id FROM pods WHERE pod_id = ?1').bind(podId).first()
  if (!pod) {
    await idem.abandon()
    return json({ error: 'not_found', message: 'We could not find that machine.' }, 404)
  }

  const slots = []
  for (const raw of Array.isArray(body.slots) ? body.slots : []) {
    const slot = normaliseSlot(raw)
    if (slot) slots.push(slot)
  }
  if (slots.length > MAX_SLOTS) {
    await idem.abandon()
    return json(validationError([`A machine can hold at most ${MAX_SLOTS} slots.`]), 422)
  }

  const names = new Set()
  for (const s of slots) {
    if (names.has(s.slotName)) {
      await idem.abandon()
      return json(validationError([`Slot "${s.slotName}" appears twice.`]), 422)
    }
    names.add(s.slotName)
  }

  // Every product has to exist before anything is written: a REFERENCES
  // failure mid-batch would roll back and report nothing a person can act on.
  const wanted = [...new Set(slots.flatMap((s) => s.choices.map((c) => c.productId)))]
  if (wanted.length) {
    const placeholders = wanted.map((_, i) => `?${i + 1}`).join(',')
    const found = await env.DB.prepare(
      `SELECT product_id FROM products WHERE product_id IN (${placeholders})`
    ).bind(...wanted).all()
    const have = new Set((found.results || []).map((r) => r.product_id))
    const missing = wanted.filter((id) => !have.has(id))
    if (missing.length) {
      await idem.abandon()
      return json(validationError([
        `${missing.length} product(s) in this plan no longer exist. Reload and try again.`,
      ]), 422)
    }
  }

  const statements = [
    // Choices go first: they reference the slots, and SQLite checks foreign
    // keys per statement inside a batch.
    env.DB.prepare('DELETE FROM planogram_choices WHERE pod_id = ?1').bind(podId),
    env.DB.prepare('DELETE FROM planogram_slots WHERE pod_id = ?1').bind(podId),
  ]

  for (const s of slots) {
    statements.push(env.DB.prepare(
      `INSERT INTO planogram_slots
         (pod_id, slot_name, row_number, column_number, capacity, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(podId, s.slotName, s.rowNumber, s.columnNumber, s.capacity, s.note))
  }
  for (const s of slots) {
    for (const c of s.choices) {
      statements.push(env.DB.prepare(
        `INSERT INTO planogram_choices (pod_id, slot_name, rank, product_id)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(podId, s.slotName, c.rank, c.productId))
    }
  }

  await env.DB.batch(statements)

  const slotCount = slots.length
  const choiceCount = slots.reduce((n, s) => n + s.choices.length, 0)
  return json({ ok: true, slots: slotCount, choices: choiceCount })
}

/**
 * Seeds the grid from the machine itself.
 *
 * Fills in slots and capacities, and sets a first choice where the machine
 * already holds a product we know. It never clears a choice somebody made:
 * the plan is the considered version, and a sync is reference material.
 */
export async function handlePlanogramPull(env, idem, json, podId) {
  const pod = await env.DB.prepare(
    'SELECT pod_id, vlite_machine_id FROM pods WHERE pod_id = ?1'
  ).bind(podId).first()
  if (!pod) {
    await idem.abandon()
    return json({ error: 'not_found', message: 'We could not find that machine.' }, 404)
  }
  if (!pod.vlite_machine_id) {
    await idem.abandon()
    return json({
      error: 'no_vlite_machine',
      message: 'This machine is not linked to a VLite machine, so there is no layout to pull.',
    }, 422)
  }

  let remote
  try {
    remote = await getSlots(env, pod.vlite_machine_id)
  } catch (err) {
    await idem.abandon()
    if (err instanceof VliteError) {
      return json({ error: err.code || 'vlite_unavailable', message: err.message }, err.status || 502)
    }
    throw err
  }

  const products = await env.DB.prepare(
    'SELECT product_id, vlite_product_id FROM products WHERE vlite_product_id IS NOT NULL'
  ).all()
  const byVlite = new Map((products.results || []).map((p) => [p.vlite_product_id, p.product_id]))

  const existing = await env.DB.prepare(
    'SELECT slot_name FROM planogram_choices WHERE pod_id = ?1 GROUP BY slot_name'
  ).bind(podId).all()
  const planned = new Set((existing.results || []).map((r) => r.slot_name))

  const statements = []
  let added = 0
  let seeded = 0

  for (const s of remote.slice(0, MAX_SLOTS)) {
    const slotName = cleanText(s.slotName, 20)
    if (!slotName) continue
    statements.push(env.DB.prepare(
      `INSERT INTO planogram_slots
         (pod_id, slot_name, row_number, column_number, capacity)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (pod_id, slot_name) DO UPDATE SET
         row_number    = excluded.row_number,
         column_number = excluded.column_number,
         -- A capacity typed here beats one pulled in, since VLite's stock
         -- limit is sometimes left at a default nobody adjusted.
         capacity      = COALESCE(planogram_slots.capacity, excluded.capacity)`
    ).bind(podId, slotName, s.rowNumber ?? null, s.columnNumber ?? null, s.stockLimit ?? null))
    added++

    const productId = s.vliteProductId ? byVlite.get(s.vliteProductId) : null
    if (productId && !planned.has(slotName)) {
      statements.push(env.DB.prepare(
        `INSERT INTO planogram_choices (pod_id, slot_name, rank, product_id)
         VALUES (?1, ?2, 1, ?3)
         ON CONFLICT (pod_id, slot_name, rank) DO NOTHING`
      ).bind(podId, slotName, productId))
      seeded++
    }
  }

  if (statements.length) await env.DB.batch(statements)
  return json({ ok: true, slots: added, seeded })
}

/**
 * Refreshes product artwork from the VLite catalogue.
 *
 * Images are what make a planogram usable by someone who does not read the
 * brand names in English, so this is worth a button of its own rather than
 * being buried in the product import.
 */
export async function handleProductImagesSync(env, idem, json) {
  let remote
  try {
    remote = await getProducts(env, { activeOnly: false })
  } catch (err) {
    await idem.abandon()
    if (err instanceof VliteError) {
      return json({ error: err.code || 'vlite_unavailable', message: err.message }, err.status || 502)
    }
    throw err
  }

  const mine = await env.DB.prepare(
    'SELECT product_id, vlite_product_id FROM products WHERE vlite_product_id IS NOT NULL'
  ).all()
  const byVlite = new Map((mine.results || []).map((p) => [p.vlite_product_id, p.product_id]))

  const statements = []
  let updated = 0
  let withoutImage = 0

  for (const r of remote) {
    const productId = byVlite.get(r.vliteProductId)
    if (!productId) continue
    const url = imageUrl(r.image)
    if (!url) { withoutImage++; continue }
    statements.push(env.DB.prepare(
      'UPDATE products SET image_url = ?2, updated_at = datetime(\'now\') WHERE product_id = ?1'
    ).bind(productId, url))
    updated++
  }

  // D1 batches are one round trip but not unlimited; a catalogue of a few
  // hundred products goes in chunks rather than in one statement list.
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50))
  }

  return json({
    ok: true,
    updated,
    withoutImage,
    linked: byVlite.size,
    message: `${updated} product image(s) refreshed from VLite.`
      + (withoutImage ? ` ${withoutImage} linked product(s) have no image there.` : ''),
  })
}
