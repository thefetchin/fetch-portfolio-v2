import { cleanText } from './validate.js'

/**
 * A general-purpose QR generator, with scan counts for the ones we track.
 *
 * Separate from the Pod QRs: those are signed, tied to a machine and point at
 * the feedback form. These are for posters, flyers and table tents, and encode
 * whatever they are given.
 *
 * The QR image itself is drawn in the browser, as the Pods tab already does.
 * Rendering it server-side would mean a QR library in the Worker bundle to
 * produce something the client can make itself.
 */

/**
 * Crockford-style base32 without I, L, O and U.
 *
 * These end up printed and occasionally read aloud or retyped, so the
 * characters that get confused with 1 and 0 are designed out -- the same
 * reasoning as the batch codes in the inventory module.
 */
function shortCode() {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const b = crypto.getRandomValues(new Uint8Array(7))
  let s = ''
  for (const byte of b) s += A[byte % 32]
  return s
}

const KINDS = ['link', 'text', 'wifi']

/**
 * What a QR actually encodes.
 *
 * A tracked link encodes our short URL so the scan can be counted and the
 * destination changed after printing. Everything else is encoded directly,
 * which means it keeps working even if this service does not.
 */
export function encodedValue(row, formHost) {
  if (row.kind === 'link' && row.tracked) {
    return `https://${formHost}/q/${row.code}`
  }
  return row.content
}

/** WIFI:T:WPA;S:<ssid>;P:<password>;H:<true|false>;; -- the scheme phones read. */
export function wifiPayload({ ssid, password, security = 'WPA', hidden = false }) {
  // Semicolons, colons and backslashes are separators in this format, so they
  // have to be escaped or the payload silently truncates at the first one -- a
  // password containing a semicolon would otherwise produce a QR that joins the
  // wrong network, or no network.
  const esc = (v) => String(v ?? '').replace(/([\\;,:"])/g, '\\$1')
  const parts = [
    `T:${security === 'nopass' ? 'nopass' : security}`,
    `S:${esc(ssid)}`,
    security === 'nopass' ? '' : `P:${esc(password)}`,
    hidden ? 'H:true' : '',
  ].filter(Boolean)
  return `WIFI:${parts.join(';')};;`
}

/* ------------------------------------------------------------- handlers -- */

export async function handleQrList(env, json) {
  const rows = await env.DB.prepare(
    `SELECT q.code, q.label, q.kind, q.content, q.tracked, q.active,
            q.created_at, q.created_by,
            (SELECT COUNT(*) FROM qr_scans s WHERE s.code = q.code)            AS scans,
            (SELECT COUNT(DISTINCT s.ip_hash) FROM qr_scans s WHERE s.code = q.code) AS people,
            (SELECT MAX(s.scanned_at) FROM qr_scans s WHERE s.code = q.code)   AS last_scan_at
       FROM qr_codes q
      ORDER BY q.created_at DESC
      LIMIT 200`
  ).all()

  const host = env.FORM_HOSTNAME || 'feedback.thefetch.in'
  return json({
    codes: (rows.results || []).map((r) => ({
      ...r,
      tracked: !!r.tracked,
      active: !!r.active,
      value: encodedValue({ ...r, tracked: !!r.tracked }, host),
      shortUrl: r.tracked ? `https://${host}/q/${r.code}` : null,
    })),
  })
}

export async function handleQrCreate(request, env, json, actor) {
  let body
  try { body = await request.json() } catch { body = {} }

  const label = cleanText(body.label, 80)
  if (!label) return json({ error: 'validation', message: 'Give it a name so you know what it is for.' }, 422)

  const kind = KINDS.includes(body.kind) ? body.kind : 'link'
  let content = ''
  let tracked = 0

  if (kind === 'link') {
    const url = cleanText(body.content, 900)
    if (!url) return json({ error: 'validation', message: 'Add the web address it should open.' }, 422)
    if (!/^https?:\/\//i.test(url)) {
      return json({
        error: 'validation',
        message: 'The address needs to start with http:// or https://.',
      }, 422)
    }
    content = url
    tracked = body.tracked ? 1 : 0
  } else if (kind === 'text') {
    // Not cleanText: line breaks are meaningful in a block of text somebody
    // wants on a poster, and cleanText collapses them.
    content = typeof body.content === 'string'
      ? body.content.replace(/\r\n/g, '\n').trim().slice(0, 900) : ''
    if (!content) return json({ error: 'validation', message: 'Add the text to encode.' }, 422)
  } else {
    const ssid = cleanText(body.ssid, 64)
    if (!ssid) return json({ error: 'validation', message: 'Add the network name.' }, 422)
    content = wifiPayload({
      ssid,
      password: typeof body.password === 'string' ? body.password.slice(0, 96) : '',
      security: body.security === 'nopass' ? 'nopass' : body.security === 'WEP' ? 'WEP' : 'WPA',
      hidden: !!body.hidden,
    })
  }

  // Retry on the vanishingly unlikely collision rather than returning an error
  // for something the caller cannot act on.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shortCode()
    try {
      await env.DB.prepare(
        `INSERT INTO qr_codes (code, label, kind, content, tracked, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).bind(code, label, kind, content, tracked, actor || null).run()

      const host = env.FORM_HOSTNAME || new URL(request.url).host
      return json({
        ok: true,
        code,
        value: encodedValue({ code, kind, content, tracked }, host),
        shortUrl: tracked ? `https://${host}/q/${code}` : null,
      })
    } catch (err) {
      if (!String(err?.message || '').includes('UNIQUE')) throw err
    }
  }
  return json({ error: 'server_error', message: 'Could not allocate a code. Try again.' }, 500)
}

/** Rename, repoint or retire. The CODE never changes -- it is printed. */
export async function handleQrUpdate(request, env, json, code) {
  let body
  try { body = await request.json() } catch { body = {} }

  const row = await env.DB.prepare(
    'SELECT code, kind, tracked FROM qr_codes WHERE code = ?1'
  ).bind(code).first()
  if (!row) return json({ error: 'not_found', message: 'No such code.' }, 404)

  const sets = []
  const binds = [code]

  if (typeof body.label === 'string') {
    const label = cleanText(body.label, 80)
    if (!label) return json({ error: 'validation', message: 'A name is needed.' }, 422)
    binds.push(label); sets.push(`label = ?${binds.length}`)
  }

  // Repointing is the whole reason to track a link: the poster is already on a
  // wall. Only meaningful for a tracked link, since anything else is encoded
  // in the print itself and cannot be changed by us.
  if (typeof body.content === 'string' && row.kind === 'link' && row.tracked) {
    const url = cleanText(body.content, 900)
    if (!url || !/^https?:\/\//i.test(url)) {
      return json({ error: 'validation', message: 'The address needs to start with http:// or https://.' }, 422)
    }
    binds.push(url); sets.push(`content = ?${binds.length}`)
  }

  if (typeof body.active === 'boolean') {
    binds.push(body.active ? 1 : 0); sets.push(`active = ?${binds.length}`)
  }

  if (!sets.length) return json({ error: 'validation', message: 'Nothing to change.' }, 422)

  await env.DB.prepare(`UPDATE qr_codes SET ${sets.join(', ')} WHERE code = ?1`).bind(...binds).run()
  return json({ ok: true })
}

/** Scans over time, for one code. */
export async function handleQrScans(env, json, code) {
  const rows = await env.DB.prepare(
    `SELECT date(scanned_at) AS day, COUNT(*) AS scans,
            COUNT(DISTINCT ip_hash) AS people
       FROM qr_scans WHERE code = ?1
      GROUP BY date(scanned_at)
      ORDER BY day DESC LIMIT 60`
  ).bind(code).all()

  const recent = await env.DB.prepare(
    `SELECT scanned_at, country FROM qr_scans WHERE code = ?1
      ORDER BY scanned_at DESC LIMIT 20`
  ).bind(code).all()

  return json({ daily: rows.results || [], recent: recent.results || [] })
}

/**
 * The public redirect. Counts the scan, then sends them on.
 *
 * The redirect happens whatever the counting does: somebody standing at a
 * poster must not be left staring at an error because a write failed, so the
 * scan is recorded after the response is on its way.
 */
export async function handleQrRedirect(request, env, ctx, code, sha256Hex) {
  const row = await env.DB.prepare(
    'SELECT code, content, active FROM qr_codes WHERE code = ?1 AND tracked = 1'
  ).bind(code).first()

  if (!row) {
    return new Response('This code is not in use.', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  if (!row.active) {
    return new Response('This code is no longer in use.', {
      status: 410, headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') || ''
  const record = (async () => {
    const ipHash = ip ? await sha256Hex(`${env.QR_SECRET || 'dev'}:${ip}`) : null
    await env.DB.prepare(
      `INSERT INTO qr_scans (code, ip_hash, country, user_agent, referer)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(
      code, ipHash,
      request.headers.get('CF-IPCountry') || null,
      (request.headers.get('User-Agent') || '').slice(0, 200),
      (request.headers.get('Referer') || '').slice(0, 200)
    ).run()
  })()

  if (ctx?.waitUntil) ctx.waitUntil(record.catch(() => {}))
  else await record.catch(() => {})

  return Response.redirect(row.content, 302)
}
