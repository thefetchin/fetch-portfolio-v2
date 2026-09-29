import { cleanText } from './validate.js'
import { ISSUER } from '../shared/constants.js'

/**
 * Shipping labels for parts going back to a manufacturer.
 *
 * The label is not stored: it is a sheet of paper made from two addresses and
 * whatever is in the box today. What is stored is the part that repeats --
 * our address, the manufacturers, and how the page should print.
 */

export const PAGE_SIZES = [
  // Millimetres, portrait. The label renders at these dimensions exactly, so
  // the preview on screen is the sheet that comes out of the printer.
  { value: 'A4',     label: 'A4 (210 × 297 mm)',        w: 210,   h: 297 },
  { value: 'A5',     label: 'A5 (148 × 210 mm)',        w: 148,   h: 210 },
  { value: 'A6',     label: 'A6 (105 × 148 mm)',        w: 105,   h: 148 },
  { value: 'Letter', label: 'US Letter (216 × 279 mm)', w: 215.9, h: 279.4 },
  { value: 'label4x6', label: 'Thermal label (4 × 6 in)', w: 101.6, h: 152.4 },
]
export const PAGE_SIZE_VALUES = PAGE_SIZES.map((p) => p.value)

/** Every part of the label that can be left off. */
export const SHOW_KEYS = [
  'items', 'itemValue', 'totalValue', 'declaration', 'fromGstin', 'toGstin',
  'contact', 'refQr', 'shipmentBox', 'footer', 'cutMarks',
]

export const DEFAULT_SHOW = {
  items: true,
  itemValue: true,
  totalValue: true,
  declaration: true,
  fromGstin: true,
  toGstin: true,
  contact: true,
  refQr: true,
  shipmentBox: true,
  footer: true,
  cutMarks: false,
}

const DEFAULT_DECLARATION =
  'Spare parts returned to the manufacturer for repair or replacement. '
  + 'Not for sale. Value stated is for insurance and customs purposes only.'

const DEFAULT_FOOTER =
  'Handle with care · Keep dry · Do not stack'

function parseShow(raw) {
  let given = {}
  try {
    const o = JSON.parse(raw || '{}')
    if (o && typeof o === 'object' && !Array.isArray(o)) given = o
  } catch { /* fall through to defaults */ }
  // Whitelisted and filled in, so a key added to the code later has a value
  // on a row written before it existed.
  const show = { ...DEFAULT_SHOW }
  for (const k of SHOW_KEYS) if (typeof given[k] === 'boolean') show[k] = given[k]
  return show
}

/** Multi-line address text -> trimmed lines, capped so a label stays a label. */
export function cleanLines(raw, maxLines = 6, maxLen = 80) {
  return String(raw == null ? '' : raw)
    .split(/\r?\n/)
    .map((l) => cleanText(l, maxLen) || '')
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n')
}

/** The settings row, created from the company details the first time. */
export async function loadShippingSettings(env) {
  const row = await env.DB.prepare(
    'SELECT * FROM shipping_settings WHERE id = 1'
  ).first()

  if (!row) {
    return {
      from: {
        name: ISSUER.legalName,
        lines: ISSUER.address.join('\n'),
        gstin: ISSUER.gstin,
        phone: ISSUER.phone,
        email: ISSUER.email,
      },
      pageSize: 'A4',
      orientation: 'landscape',
      show: { ...DEFAULT_SHOW },
      declaration: DEFAULT_DECLARATION,
      footerNote: DEFAULT_FOOTER,
      saved: false,
    }
  }

  return {
    from: {
      name: row.from_name,
      lines: row.from_lines,
      gstin: row.from_gstin,
      phone: row.from_phone,
      email: row.from_email,
    },
    pageSize: PAGE_SIZE_VALUES.includes(row.page_size) ? row.page_size : 'A4',
    orientation: row.orientation,
    show: parseShow(row.show),
    declaration: row.declaration || DEFAULT_DECLARATION,
    footerNote: row.footer_note,
    saved: true,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export async function handleShippingGet(env, json) {
  const [settings, addresses] = await Promise.all([
    loadShippingSettings(env),
    env.DB.prepare(
      `SELECT address_id, name, attention, lines, gstin, phone, email, notes
         FROM shipping_addresses WHERE archived = 0 ORDER BY name`
    ).all(),
  ])

  return json({
    settings,
    addresses: (addresses.results || []).map((a) => ({
      addressId: a.address_id,
      name: a.name,
      attention: a.attention,
      lines: a.lines,
      gstin: a.gstin,
      phone: a.phone,
      email: a.email,
      notes: a.notes,
    })),
    pageSizes: PAGE_SIZES,
    showKeys: SHOW_KEYS,
  })
}

export async function handleShippingSettingsSave(request, env, json, auth) {
  let body
  try { body = await request.json() } catch { body = {} }

  const from = body.from && typeof body.from === 'object' ? body.from : {}
  const name = cleanText(from.name, 120)
  if (!name) {
    return json({ error: 'validation', message: 'The sender needs a name.' }, 422)
  }
  const lines = cleanLines(from.lines)
  if (!lines) {
    return json({ error: 'validation', message: 'The sender needs an address.' }, 422)
  }

  const pageSize = PAGE_SIZE_VALUES.includes(body.pageSize) ? body.pageSize : 'A4'
  const orientation = body.orientation === 'portrait' ? 'portrait' : 'landscape'

  const given = body.show && typeof body.show === 'object' ? body.show : {}
  const show = { ...DEFAULT_SHOW }
  for (const k of SHOW_KEYS) if (typeof given[k] === 'boolean') show[k] = given[k]

  await env.DB.prepare(
    `INSERT INTO shipping_settings (
       id, from_name, from_lines, from_gstin, from_phone, from_email,
       page_size, orientation, show, declaration, footer_note,
       updated_at, updated_by
     ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'), ?11)
     ON CONFLICT (id) DO UPDATE SET
       from_name   = excluded.from_name,
       from_lines  = excluded.from_lines,
       from_gstin  = excluded.from_gstin,
       from_phone  = excluded.from_phone,
       from_email  = excluded.from_email,
       page_size   = excluded.page_size,
       orientation = excluded.orientation,
       show        = excluded.show,
       declaration = excluded.declaration,
       footer_note = excluded.footer_note,
       updated_at  = datetime('now'),
       updated_by  = excluded.updated_by`
  ).bind(
    name, lines, cleanText(from.gstin, 15) || '', cleanText(from.phone, 30) || '',
    cleanText(from.email, 120) || '', pageSize, orientation, JSON.stringify(show),
    cleanText(body.declaration, 400) || '', cleanText(body.footerNote, 160) || '',
    auth?.email || null
  ).run()

  return json({ ok: true, settings: await loadShippingSettings(env) })
}

export async function handleShippingAddressSave(request, env, json, addressId) {
  let body
  try { body = await request.json() } catch { body = {} }

  const name = cleanText(body.name, 120)
  if (!name) {
    return json({ error: 'validation', message: 'The consignee needs a name.' }, 422)
  }
  const lines = cleanLines(body.lines)
  if (!lines) {
    return json({ error: 'validation', message: 'The consignee needs an address.' }, 422)
  }

  const fields = [
    name,
    cleanText(body.attention, 80) || null,
    lines,
    cleanText(body.gstin, 15) || null,
    cleanText(body.phone, 30) || null,
    cleanText(body.email, 120) || null,
    cleanText(body.notes, 200) || null,
  ]

  if (addressId) {
    const res = await env.DB.prepare(
      `UPDATE shipping_addresses
          SET name = ?2, attention = ?3, lines = ?4, gstin = ?5,
              phone = ?6, email = ?7, notes = ?8
        WHERE address_id = ?1`
    ).bind(addressId, ...fields).run()
    if (!res.meta?.changes) return json({ error: 'not_found', message: 'No such address.' }, 404)
    return json({ ok: true, addressId })
  }

  const id = `sa_${crypto.randomUUID().slice(0, 8)}`
  await env.DB.prepare(
    `INSERT INTO shipping_addresses
       (address_id, name, attention, lines, gstin, phone, email, notes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(id, ...fields).run()
  return json({ ok: true, addressId: id })
}

/**
 * Archives rather than deletes.
 *
 * An address is the only record of where a parcel went. Someone chasing a
 * repair three months from now needs to read it, and a row nobody can see is
 * cheaper to restore than one nobody kept.
 */
export async function handleShippingAddressDelete(env, json, addressId) {
  const res = await env.DB.prepare(
    'UPDATE shipping_addresses SET archived = 1 WHERE address_id = ?1'
  ).bind(addressId).run()
  if (!res.meta?.changes) return json({ error: 'not_found', message: 'No such address.' }, 404)
  return json({ ok: true, archived: true })
}
