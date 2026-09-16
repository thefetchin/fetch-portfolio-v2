import { validateSubmission, cleanText } from './validate.js'
import { verifySession, handleLogin, handleLogout, requireRole } from './auth.js'
import {
  validateDebitNote, financialYear, istDateString,
  counterBumpStatement, DOC_NUMBER_SQL,
} from './invoicing.js'
import { beginIdempotent, maybePrune } from './idempotency.js'
import { routeInventory } from './inv-routes.js'
import {
  handleSettingsGet, handleSettingsPut, handlePodNotify, handleSendLog,
  handleConnectionCheck, handleWebhookVerify, handleWebhook,
  handleInbox, handleInboxUpdate,
  handleChatList, handleChatThread, handleChatReply,
  handleWabaStatus, handleWabaSubscribe,
  handleCannedList, handleCannedCreate, handleCannedDelete,
  handleTemplateInspect,
} from './whatsapp-send.js'
import {
  SUBMISSION_STATUSES, DEBIT_NOTE_STATUSES, WHATSAPP_STATUSES, WA_CONSENT_TEXT,
} from '../shared/constants.js'

/* ------------------------------------------------------------------ utils */

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })

const bytesToB64url = (bytes) => {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return bytesToB64url(sig)
}

async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time-ish string compare so signature checks don't leak timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The QR signature. Truncated to 16 chars — 96 bits of a keyed MAC, which is
 * far beyond brute-forceable for this threat model and keeps the QR dense
 * enough to scan reliably from a sticker.
 */
export async function podSignature(secret, podId) {
  return (await hmac(secret, `pod:${podId}`)).slice(0, 16)
}

async function verifyPodToken(env, podId, token) {
  if (!env.QR_SECRET) return true // not configured → dev mode
  if (!token) return false
  return safeEqual(await podSignature(env.QR_SECRET, podId), token)
}

/* -------------------------------------------------------------- turnstile */

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true }
  if (!token) return { ok: false, reason: 'Bot check missing. Please retry.' }

  const body = new FormData()
  body.append('secret', env.TURNSTILE_SECRET)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body }
    )
    const data = await res.json()
    return data.success
      ? { ok: true }
      : { ok: false, reason: 'Bot check failed. Please refresh and try again.' }
  } catch {
    // Never block a genuine user because Turnstile is having a bad day.
    return { ok: true, degraded: true }
  }
}

/* ------------------------------------------------------------ rate limits */

const RATE_LIMITS = {
  perIpPerHour: 6,
  perPodPerHour: 40,
}

async function isRateLimited(env, ipHash, podId) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)

  const [byIp, byPod] = await Promise.all([
    env.DB.prepare(
      'SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ?1 AND created_at > ?2'
    ).bind(ipHash, since).first(),
    env.DB.prepare(
      'SELECT COUNT(*) AS n FROM submissions WHERE pod_id = ?1 AND created_at > ?2'
    ).bind(podId, since).first(),
  ])

  if ((byIp?.n ?? 0) >= RATE_LIMITS.perIpPerHour) {
    return 'You have sent us a few reports already. Please try again later.'
  }
  if ((byPod?.n ?? 0) >= RATE_LIMITS.perPodPerHour) {
    return 'This Pod has received a lot of reports right now. Please try again later.'
  }
  return null
}

/* ----------------------------------------------------------------- routes */

async function handlePodLookup(request, env, podId) {
  const token = new URL(request.url).searchParams.get('t')

  if (!(await verifyPodToken(env, podId, token))) {
    return json({ error: 'invalid_link', message: 'This QR link is not valid.' }, 403)
  }

  const pod = await env.DB.prepare(
    'SELECT pod_id, label, location, city, active FROM pods WHERE pod_id = ?1'
  ).bind(podId).first()

  if (!pod) {
    return json({ error: 'unknown_pod', message: 'We could not find that Pod.' }, 404)
  }
  if (!pod.active) {
    return json({ error: 'inactive_pod', message: 'This Pod is no longer in service.' }, 410)
  }

  return json({
    pod: {
      podId: pod.pod_id,
      label: pod.label,
      location: pod.location,
      city: pod.city,
    },
  })
}

async function handleSubmit(request, env) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'bad_json', message: 'Malformed request.' }, 400)
  }

  // Honeypot: a hidden field no human ever fills. Pretend success so bots
  // don't learn they were caught, but store nothing.
  if (payload.website) return json({ ok: true, id: crypto.randomUUID() })

  const podId = typeof payload.podId === 'string' ? payload.podId.trim() : ''
  if (!podId) return json({ error: 'no_pod', message: 'Missing Pod.' }, 400)

  if (!(await verifyPodToken(env, podId, payload.podToken))) {
    return json({ error: 'invalid_link', message: 'This QR link is not valid.' }, 403)
  }

  const pod = await env.DB.prepare(
    'SELECT pod_id, active FROM pods WHERE pod_id = ?1'
  ).bind(podId).first()
  if (!pod) return json({ error: 'unknown_pod', message: 'We could not find that Pod.' }, 404)
  if (!pod.active) return json({ error: 'inactive_pod', message: 'This Pod is retired.' }, 410)

  const ip = request.headers.get('CF-Connecting-IP') || ''
  const turnstile = await verifyTurnstile(env, payload.turnstileToken, ip)
  if (!turnstile.ok) return json({ error: 'bot_check', message: turnstile.reason }, 403)

  const result = validateSubmission(payload)
  if (!result.ok) {
    return json({ error: 'validation', message: result.errors[0], errors: result.errors }, 422)
  }
  const v = result.value

  // Hash the IP with a server secret — we get abuse controls without
  // retaining a raw IP against a person's complaint.
  const ipHash = ip ? await sha256Hex(`${env.QR_SECRET || 'dev'}:${ip}`) : null

  if (ipHash) {
    const limited = await isRateLimited(env, ipHash, podId)
    if (limited) return json({ error: 'rate_limited', message: limited }, 429)
  }

  // Dedupe: identical content, same Pod, same 10-minute bucket → one row.
  // The UNIQUE index on dedupe_hash enforces it even under a double-tap race.
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
  const dedupeHash = await sha256Hex(
    [
      podId, v.kind, bucket, ipHash || '',
      v.issue_type || '', v.rating || '', v.comment || '',
      v.wanted_text || '', v.payment_ref || '',
    ].join('|')
  )

  const id = crypto.randomUUID()
  const ua = (request.headers.get('User-Agent') || '').slice(0, 200)
  const country = request.headers.get('CF-IPCountry') || null

  // The submission and, when consent was given, the WhatsApp opt-in go in as
  // ONE batch. If the submission turns out to be a dedupe replay the whole
  // thing rolls back -- which is right: the first copy already recorded the
  // consent, and a second row would mean messaging the same person twice.
  const statements = []

  try {
    statements.push(env.DB.prepare(
      `INSERT INTO submissions (
         id, pod_id, kind, ip_hash, country, user_agent, dedupe_hash,
         issue_type, occurred_when, amount_paise, payment_ref, refund_requested,
         rating, wanted_categories, wanted_text, price_feel, usage_freq, notify_opt_in,
         product_category, product_text, comment, contact_email, contact_phone
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7,
         ?8, ?9, ?10, ?11, ?12,
         ?13, ?14, ?15, ?16, ?17, ?18,
         ?19, ?20, ?21, ?22, ?23
       )`
    ).bind(
      id, podId, v.kind, ipHash, country, ua, dedupeHash,
      v.issue_type, v.occurred_when, v.amount_paise, v.payment_ref, v.refund_requested,
      v.rating, v.wanted_categories, v.wanted_text, v.price_feel, v.usage_freq, v.notify_opt_in,
      v.product_category, v.product_text, v.comment, v.contact_email, v.contact_phone
    ))

    if (v.whatsapp_opt_in) {
      // Ticking the box again at the same Pod refreshes the existing consent
      // rather than adding a second row -- including lifting an earlier
      // unsubscribe, which is a fresh, explicit opt-in and nothing else.
      // consent_text is re-copied so the row always records the wording that
      // was actually on screen.
      statements.push(env.DB.prepare(
        `INSERT INTO whatsapp_optins (
           optin_id, wa_number, pod_id, status, source, consent_text, submission_id
         ) VALUES (?1, ?2, ?3, 'active', 'feedback_form', ?4, ?5)
         ON CONFLICT (wa_number, pod_id) DO UPDATE SET
           status          = 'active',
           unsubscribed_at = NULL,
           reconfirmed_at  = datetime('now'),
           consent_text    = excluded.consent_text,
           submission_id   = excluded.submission_id`
      ).bind(crypto.randomUUID(), v.whatsapp_number, podId, WA_CONSENT_TEXT, id))
    }

    await env.DB.batch(statements)
  } catch (err) {
    // UNIQUE violation on dedupe_hash = the same thing submitted twice.
    // That's a success from the user's point of view.
    if (String(err?.message || '').includes('UNIQUE')) {
      return json({ ok: true, id, duplicate: true })
    }
    throw err
  }

  return json({ ok: true, id })
}

async function handleAdminSubmissions(request, env) {
  const url = new URL(request.url)
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500)
  const kind = url.searchParams.get('kind')
  const status = url.searchParams.get('status')
  const podId = url.searchParams.get('pod')

  const where = []
  const binds = []
  if (kind === 'complaint' || kind === 'feedback') {
    binds.push(kind)
    where.push(`kind = ?${binds.length}`)
  }
  if (SUBMISSION_STATUSES.includes(status)) {
    binds.push(status)
    where.push(`status = ?${binds.length}`)
  }
  if (podId) {
    binds.push(podId)
    where.push(`pod_id = ?${binds.length}`)
  }
  binds.push(limit)

  const rows = await env.DB.prepare(
    `SELECT s.*, p.label AS pod_label, p.location AS pod_location
       FROM submissions s
       LEFT JOIN pods p ON p.pod_id = s.pod_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.created_at DESC
       LIMIT ?${binds.length}`
  ).bind(...binds).all()

  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*)                                                  AS total,
       SUM(CASE WHEN kind = 'complaint' THEN 1 ELSE 0 END)       AS complaints,
       SUM(CASE WHEN kind = 'feedback'  THEN 1 ELSE 0 END)       AS feedback,
       SUM(CASE WHEN status = 'new'     THEN 1 ELSE 0 END)       AS unread,
       SUM(CASE WHEN refund_requested = 1 AND status != 'resolved'
                THEN 1 ELSE 0 END)                               AS refunds_open,
       ROUND(AVG(rating), 2)                                     AS avg_rating
     FROM submissions`
  ).first()

  return json({ submissions: rows.results || [], stats })
}

/* ------------------------------------------ admin: WhatsApp opt-ins ----- */

/**
 * The list of people to message when a Pod is refilled.
 *
 * Returns the consent record, not just the number: when they agreed, to what
 * wording, and on which report. If a number is ever challenged, that is the
 * answer, and it has to be one query away or it will not be given.
 */
async function handleAdminWhatsappList(request, env) {
  const url = new URL(request.url)
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '500', 10) || 500, 2000)
  const podId = url.searchParams.get('pod')
  const status = url.searchParams.get('status')

  const where = []
  const binds = []
  if (podId) {
    binds.push(podId)
    where.push(`w.pod_id = ?${binds.length}`)
  }
  if (WHATSAPP_STATUSES.includes(status)) {
    binds.push(status)
    where.push(`w.status = ?${binds.length}`)
  }
  binds.push(limit)

  const rows = await env.DB.prepare(
    `SELECT w.optin_id, w.wa_number, w.pod_id, w.status, w.source, w.consent_text,
            w.display_name, w.submission_id, w.consented_at, w.reconfirmed_at,
            w.unsubscribed_at, w.last_sent_at, w.send_count,
            p.label AS pod_label, p.location AS pod_location, p.city AS pod_city
       FROM whatsapp_optins w
       LEFT JOIN pods p ON p.pod_id = w.pod_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY w.consented_at DESC
       LIMIT ?${binds.length}`
  ).bind(...binds).all()

  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*)                                                     AS total,
       SUM(CASE WHEN status = 'active'       THEN 1 ELSE 0 END)     AS active,
       SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END)     AS unsubscribed,
       COUNT(DISTINCT wa_number)                                    AS people,
       COUNT(DISTINCT CASE WHEN status = 'active' THEN pod_id END)  AS pods_covered
     FROM whatsapp_optins`
  ).first()

  return json({ optins: rows.results || [], stats })
}

/**
 * Opt-out, and the way back in.
 *
 * Unsubscribing never deletes the row. A deleted row would be silently
 * re-created by the next form submission from that number, which is the one
 * thing an opt-out must not do.
 */
async function handleAdminWhatsappUpdate(request, env, optinId) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json', message: 'Malformed request.' }, 400)
  }

  const status = WHATSAPP_STATUSES.includes(body.status) ? body.status : null
  if (!status) {
    return json({ error: 'validation', message: 'Unknown status.' }, 422)
  }

  const row = await env.DB.prepare(
    'SELECT status FROM whatsapp_optins WHERE optin_id = ?1'
  ).bind(optinId).first()
  if (!row) return json({ error: 'not_found', message: 'No such opt-in.' }, 404)

  // An opt-out can only be undone by the person themselves, by ticking the box
  // again on the form. Re-subscribing someone from the dashboard is the one
  // move that would turn a consent ledger into an ordinary marketing list, so
  // it is refused here and not merely hidden in the UI -- a button that is not
  // rendered is not a control.
  if (row.status === 'unsubscribed' && status !== 'unsubscribed') {
    return json({
      error: 'opted_out',
      message: 'This person opted out. Only they can opt back in, from the form.',
    }, 409)
  }

  const res = await env.DB.prepare(
    `UPDATE whatsapp_optins
        SET status = ?2,
            unsubscribed_at = CASE WHEN ?2 = 'unsubscribed'
                                   THEN COALESCE(unsubscribed_at, datetime('now'))
                                   ELSE NULL END
      WHERE optin_id = ?1`
  ).bind(optinId, status).run()

  if (!res.meta?.changes) {
    return json({ error: 'not_found', message: 'No such opt-in.' }, 404)
  }
  return json({ ok: true, status })
}

/* ------------------------------------------------- admin: pods + QR ----- */

const POD_ID_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/

/** The public URL encoded into a Pod's QR code. */
async function podUrl(env, podId) {
  const base = env.FORM_HOSTNAME ? `https://${env.FORM_HOSTNAME}` : ''
  const path = `/p/${encodeURIComponent(podId)}`
  if (!env.QR_SECRET) return `${base}${path}` // unsigned in local dev
  return `${base}${path}?t=${await podSignature(env.QR_SECRET, podId)}`
}

async function handleAdminPodsList(request, env) {
  const rows = await env.DB.prepare(
    `SELECT p.pod_id, p.label, p.location, p.city, p.active, p.created_at,
            (SELECT COUNT(*) FROM submissions s WHERE s.pod_id = p.pod_id) AS submission_count
       FROM pods p
      ORDER BY p.created_at DESC`
  ).all()

  const pods = await Promise.all(
    (rows.results || []).map(async (p) => ({
      podId: p.pod_id,
      label: p.label,
      location: p.location,
      city: p.city,
      active: p.active === 1,
      createdAt: p.created_at,
      submissionCount: p.submission_count,
      url: await podUrl(env, p.pod_id),
    }))
  )

  return json({ pods })
}

async function handleAdminPodCreate(request, env) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json', message: 'Malformed request.' }, 400)
  }

  // Pod IDs are uppercased so QR codes and DB rows can never disagree over
  // casing — the signature is computed over the exact string.
  const podId = typeof body.podId === 'string'
    ? body.podId.trim().toUpperCase().replace(/\s+/g, '-')
    : ''

  if (!POD_ID_RE.test(podId)) {
    return json({
      error: 'bad_pod_id',
      message: 'Use 3–40 characters: letters, numbers and dashes (e.g. POD-MNG-003).',
    }, 422)
  }

  const clean = (v, max) => {
    if (typeof v !== 'string') return null
    const s = v.replace(/\s+/g, ' ').trim().slice(0, max)
    return s.length ? s : null
  }

  const location = clean(body.location, 120)
  const city = clean(body.city, 60)
  const label = clean(body.label, 60) || `Fetch Pod ${podId.split('-').pop()}`

  if (!location) {
    return json({ error: 'missing_location', message: 'Location is required.' }, 422)
  }

  const existing = await env.DB.prepare('SELECT pod_id FROM pods WHERE pod_id = ?1')
    .bind(podId).first()

  await env.DB.prepare(
    `INSERT INTO pods (pod_id, label, location, city) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(pod_id) DO UPDATE SET
       label = excluded.label, location = excluded.location, city = excluded.city`
  ).bind(podId, label, location, city).run()

  return json({
    ok: true,
    updated: Boolean(existing),
    pod: { podId, label, location, city, active: true, url: await podUrl(env, podId) },
  })
}

/**
 * Edits a Pod's display details.
 *
 * The pod_id is deliberately NOT editable. It is baked into the printed QR
 * code and signed with QR_SECRET, so changing it would silently break every
 * sticker already stuck to a machine -- and the person changing a display name
 * would have no reason to expect that.
 *
 * These fields are not cosmetic: they are what the WhatsApp refill message
 * puts in front of a customer, so they get the same cleaning as anything else
 * that reaches a stranger.
 */
async function handleAdminPodEdit(request, env, podId) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json', message: 'Malformed request.' }, 400)
  }

  const existing = await env.DB.prepare(
    'SELECT pod_id FROM pods WHERE pod_id = ?1'
  ).bind(podId).first()
  if (!existing) return json({ error: 'not_found', message: 'We could not find that Pod.' }, 404)

  const label = cleanText(body.label, 60)
  if (!label) {
    return json({ error: 'validation', message: 'A Pod needs a display name.' }, 422)
  }
  const location = cleanText(body.location, 120)
  const city = cleanText(body.city, 60)

  await env.DB.prepare(
    'UPDATE pods SET label = ?2, location = ?3, city = ?4 WHERE pod_id = ?1'
  ).bind(podId, label, location, city).run()

  return json({ ok: true, pod: { podId, label, location, city } })
}

async function handleAdminPodToggle(request, env, podId) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const active = body.active ? 1 : 0
  await env.DB.prepare('UPDATE pods SET active = ?1 WHERE pod_id = ?2')
    .bind(active, podId).run()
  return json({ ok: true, active: active === 1 })
}

async function handleAdminUpdate(request, env, id) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const status = SUBMISSION_STATUSES.includes(body.status) ? body.status : null
  if (!status) return json({ error: 'bad_status' }, 422)

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null

  await env.DB.prepare(
    'UPDATE submissions SET status = ?1, admin_notes = COALESCE(?2, admin_notes) WHERE id = ?3'
  ).bind(status, notes, id).run()

  return json({ ok: true })
}


/* ------------------------------------------------ admin: debit notes ----- */

async function handleDebitNoteCreate(request, env, actorEmail) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'bad_json', message: 'Malformed request.' }, 400)
  }

  const result = validateDebitNote(payload)
  if (!result.ok) {
    return json({ error: 'validation', message: result.errors[0], errors: result.errors }, 422)
  }
  const v = result.value

  const fy = financialYear()
  const id = crypto.randomUUID()
  const noteDate = istDateString()

  const statements = [
    // The counter bump is part of the batch, so if anything below fails the
    // sequence number is rolled back with it rather than left burnt.
    counterBumpStatement(env, 'DN', fy),

    env.DB.prepare(
      `INSERT INTO debit_notes (
         id, note_number, fy, seq, note_date, created_by,
         supplier_name, supplier_gstin, supplier_address, supplier_state,
         reason, invoice_ref, invoice_date, notes,
         is_interstate, taxable_paise, cgst_paise, sgst_paise, igst_paise,
         round_off_paise, total_paise
       )
       SELECT ?1, ${DOC_NUMBER_SQL}, ?2, c.last_no, ?3, ?4,
              ?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19
         FROM document_counters c
        WHERE c.series = 'DN' AND c.fy = ?2`
    ).bind(
      id, fy, noteDate, actorEmail,
      v.supplier_name, v.supplier_gstin, v.supplier_address, v.supplier_state,
      v.reason, v.invoice_ref, v.invoice_date, v.notes,
      v.is_interstate, v.taxable_paise, v.cgst_paise, v.sgst_paise, v.igst_paise,
      v.round_off_paise, v.total_paise
    ),
    ...v.lines.map((l) =>
      env.DB.prepare(
        `INSERT INTO debit_note_lines (
           note_id, line_no, description, hsn, qty_milli, uom, rate_paise,
           gst_bps, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
      ).bind(
        id, l.line_no, l.description, l.hsn, l.qty_milli, l.uom, l.rate_paise,
        l.gst_bps, l.taxable_paise, l.cgst_paise, l.sgst_paise, l.igst_paise, l.total_paise
      )
    ),
  ]

  // One batch => counter, header and lines commit together; a note can never
  // exist without the lines that justify its total.
  await env.DB.batch(statements)

  // The number was computed inside the batch, so read back what was stored
  // rather than recomputing it here and risking the two disagreeing.
  const saved = await env.DB.prepare(
    'SELECT note_number FROM debit_notes WHERE id = ?1'
  ).bind(id).first()

  return json({ ok: true, id, noteNumber: saved?.note_number })
}

async function handleDebitNoteList(request, env) {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const where = []
  const binds = []
  if (status && DEBIT_NOTE_STATUSES.includes(status)) {
    binds.push(status)
    where.push(`status = ?${binds.length}`)
  }

  const rows = await env.DB.prepare(
    `SELECT * FROM debit_notes
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT 200`
  ).bind(...binds).all()

  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'issued'  THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN status = 'issued'  THEN total_paise ELSE 0 END) AS open_paise,
            SUM(CASE WHEN status = 'settled' THEN total_paise ELSE 0 END) AS settled_paise
       FROM debit_notes`
  ).first()

  return json({ notes: rows.results || [], stats })
}

async function handleDebitNoteGet(request, env, id) {
  const note = await env.DB.prepare('SELECT * FROM debit_notes WHERE id = ?1').bind(id).first()
  if (!note) return json({ error: 'not_found', message: 'Debit note not found.' }, 404)

  const lines = await env.DB.prepare(
    'SELECT * FROM debit_note_lines WHERE note_id = ?1 ORDER BY line_no'
  ).bind(id).all()

  return json({ note, lines: lines.results || [] })
}

async function handleDebitNoteStatus(request, env, id) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const status = DEBIT_NOTE_STATUSES.includes(body.status) ? body.status : null
  if (!status) return json({ error: 'bad_status' }, 422)

  await env.DB.prepare(
    `UPDATE debit_notes
        SET status = ?1,
            settled_at = CASE WHEN ?1 = 'settled' THEN datetime('now') ELSE settled_at END
      WHERE id = ?2`
  ).bind(status, id).run()

  return json({ ok: true, status })
}

/* ------------------------------------------------------------------ entry */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname, hostname } = url

    // Host split: the dashboard lives on its own subdomain so Cloudflare
    // Access can protect the entire hostname (HTML included), and the public
    // form host can never serve admin routes even if someone guesses a path.
    // When ADMIN_HOSTNAME is unset (local dev) both surfaces are available.
    const adminHost = env.ADMIN_HOSTNAME || ''
    const isAdminHost = adminHost ? hostname === adminHost : true
    const isFormHost = adminHost ? hostname !== adminHost : true

    try {
      // ---- the WhatsApp delivery webhook, on EITHER host
      //
      // Public by necessity: Meta calls it with no session of ours, and it
      // authenticates itself by HMAC signature against WHATSAPP_APP_SECRET --
      // which is why an unset secret refuses the callback rather than
      // trusting it.
      //
      // Answered before the host split on purpose. Whichever hostname is
      // pasted into Meta's dashboard should work; a 404 there shows up as
      // "statuses never arrive" with nothing pointing at the cause.
      if (pathname === '/api/whatsapp/webhook') {
        if (request.method === 'GET') return handleWebhookVerify(request, env)
        if (request.method === 'POST') return await handleWebhook(request, env, ctx)
        return json({ error: 'not_found' }, 404)
      }

      // ---- admin API — only on the admin host, behind email+password auth
      if (pathname.startsWith('/api/admin/')) {
        if (!isAdminHost) return json({ error: 'not_found' }, 404)

        // Unauthenticated endpoints: sign in / sign out.
        if (pathname === '/api/admin/login' && request.method === 'POST') {
          const { status, data, cookie } = await handleLogin(request, env)
          return json(data, status, cookie ? { 'set-cookie': cookie } : {})
        }
        if (pathname === '/api/admin/logout' && request.method === 'POST') {
          const { status, data, cookie } = await handleLogout(request, env)
          return json(data, status, cookie ? { 'set-cookie': cookie } : {})
        }

        const auth = await verifySession(request, env)
        if (!auth.ok) return json({ error: 'unauthorized', message: auth.reason }, 401)

        // Lets any signed-in client show who it is and what it may do. This is
        // the one route below the session gate that is open to every role.
        if (pathname === '/api/admin/me' && request.method === 'GET') {
          return json({ email: auth.email, role: auth.role, userId: auth.userId })
        }

        // Everything past this line is ADMIN ONLY.
        //
        // One gate rather than a check per handler, deliberately: it means a
        // route added here in future is admin-only by default, and forgetting
        // a check cannot expose customer complaints or GST documents to a
        // refiller's phone. Inventory lives under /api/inv/* precisely so that
        // non-admin roles never need a hole in this gate.
        const denied = requireRole(auth, 'admin')
        if (denied) return json(denied, 403)

        if (pathname === '/api/admin/submissions' && request.method === 'GET') {
          return await handleAdminSubmissions(request, env)
        }
        if (pathname === '/api/admin/pods' && request.method === 'GET') {
          return await handleAdminPodsList(request, env)
        }
        if (pathname === '/api/admin/pods' && request.method === 'POST') {
          return await handleAdminPodCreate(request, env)
        }
        if (pathname === '/api/admin/whatsapp' && request.method === 'GET') {
          return await handleAdminWhatsappList(request, env)
        }
        const waMatch = pathname.match(/^\/api\/admin\/whatsapp\/([\w-]+)$/)
        if (waMatch && request.method === 'PATCH') {
          return await handleAdminWhatsappUpdate(request, env, waMatch[1])
        }
        if (pathname === '/api/admin/debit-notes' && request.method === 'POST') {
          return await handleDebitNoteCreate(request, env, auth.email)
        }
        if (pathname === '/api/admin/debit-notes' && request.method === 'GET') {
          return await handleDebitNoteList(request, env)
        }
        const dnMatch = pathname.match(/^\/api\/admin\/debit-notes\/([\w-]+)$/)
        if (dnMatch && request.method === 'GET') {
          return await handleDebitNoteGet(request, env, dnMatch[1])
        }
        if (dnMatch && request.method === 'PATCH') {
          return await handleDebitNoteStatus(request, env, dnMatch[1])
        }

        if (pathname === '/api/admin/whatsapp/chats' && request.method === 'GET') {
          return await handleChatList(env, json)
        }
        const chatMatch = pathname.match(/^\/api\/admin\/whatsapp\/chats\/(\d{10,15})$/)
        if (chatMatch && request.method === 'GET') {
          return await handleChatThread(env, json, chatMatch[1])
        }
        if (chatMatch && request.method === 'POST') {
          return await handleChatReply(request, env, json, auth.email, chatMatch[1])
        }
        if (pathname === '/api/admin/whatsapp/inbox' && request.method === 'GET') {
          return await handleInbox(request, env, json)
        }
        const inboxMatch = pathname.match(/^\/api\/admin\/whatsapp\/inbox\/([\w.=-]+)$/)
        if (inboxMatch && request.method === 'PATCH') {
          return await handleInboxUpdate(request, env, json, auth.email, inboxMatch[1])
        }
        if (pathname === '/api/admin/whatsapp/canned' && request.method === 'GET') {
          return await handleCannedList(env, json)
        }
        if (pathname === '/api/admin/whatsapp/canned' && request.method === 'POST') {
          return await handleCannedCreate(request, env, json, auth.email)
        }
        const cannedMatch = pathname.match(/^\/api\/admin\/whatsapp\/canned\/([\w-]+)$/)
        if (cannedMatch && request.method === 'DELETE') {
          return await handleCannedDelete(env, json, cannedMatch[1])
        }
        if (pathname === '/api/admin/whatsapp/template' && request.method === 'GET') {
          return await handleTemplateInspect(env, json)
        }
        if (pathname === '/api/admin/whatsapp/waba' && request.method === 'GET') {
          return await handleWabaStatus(env, json)
        }
        if (pathname === '/api/admin/whatsapp/waba/subscribe' && request.method === 'POST') {
          return await handleWabaSubscribe(env, json)
        }
        if (pathname === '/api/admin/whatsapp/status' && request.method === 'GET') {
          return await handleConnectionCheck(env, json)
        }
        if (pathname === '/api/admin/whatsapp/sends' && request.method === 'GET') {
          return await handleSendLog(request, env, json)
        }
        if (pathname === '/api/admin/whatsapp/settings' && request.method === 'GET') {
          return await handleSettingsGet(env, json)
        }
        if (pathname === '/api/admin/whatsapp/settings' && request.method === 'PUT') {
          return await handleSettingsPut(request, env, json, auth.email)
        }

        const notifyMatch = pathname.match(/^\/api\/admin\/pods\/([A-Za-z0-9-]+)\/notify$/)
        if (notifyMatch && request.method === 'POST') {
          return await handlePodNotify(request, env, json, auth.email, notifyMatch[1].toUpperCase())
        }
        const podMatch = pathname.match(/^\/api\/admin\/pods\/([A-Za-z0-9-]+)$/)
        if (podMatch && request.method === 'PATCH') {
          // `active` alone is the retire/restore toggle; anything else is an
          // edit of the display details.
          const only = await request.clone().json().catch(() => ({}))
          const isToggleOnly = Object.keys(only).length === 1 && 'active' in only
          return isToggleOnly
            ? await handleAdminPodToggle(request, env, podMatch[1].toUpperCase())
            : await handleAdminPodEdit(request, env, podMatch[1].toUpperCase())
        }
        const updateMatch = pathname.match(/^\/api\/admin\/submissions\/([\w-]+)$/)
        if (updateMatch && request.method === 'PATCH') {
          return await handleAdminUpdate(request, env, updateMatch[1])
        }
        return json({ error: 'not_found' }, 404)
      }

      // ---- inventory API — same host as the dashboard, but a SIBLING of
      // /api/admin/* rather than nested inside it.
      //
      // The reason is fail-closed by construction. /api/admin/* carries one
      // blanket admin-only gate, so a route added there in future is protected
      // by default. Inventory has to be reachable by an inventory_manager and,
      // read-only, by a refiller's device, so nesting it would mean cutting a
      // hole in that gate -- and the next person to add an admin route below
      // the hole would be one forgotten check away from exposing customer
      // complaints to a phone in a car park. Here each route states its roles,
      // and a forgotten check exposes a stock read: the low-consequence
      // direction.
      //
      // No CORS headers, deliberately. Native mobile clients do not preflight,
      // and opening CORS on a cookie-authenticated surface would be a genuine
      // CSRF regression for the dashboard.
      if (pathname.startsWith('/api/inv/')) {
        if (!isAdminHost) return json({ error: 'not_found' }, 404)

        const auth = await verifySession(request, env)
        if (!auth.ok) return json({ error: 'unauthorized', message: auth.reason }, 401)

        let idem = null
        if (request.method !== 'GET') {
          const claim = await beginIdempotent(request, env, auth, json)
          if (claim.replay) return claim.replay
          if (claim.error) return json(claim.error, claim.status)
          idem = claim
          ctx.waitUntil(Promise.resolve(maybePrune(env)).catch(() => {}))
        }

        try {
          return await routeInventory(request, env, auth, idem, json)
        } catch (err) {
          // An unhandled fault must not leave the key claimed: the caller would
          // then be permanently unable to retry that action, and a client queue
          // would jam on it for the whole retention window.
          if (idem) await idem.abandon().catch(() => {})
          throw err
        }
      }

      // ---- public API — only on the form host
      if (pathname.startsWith('/api/') && !isFormHost) {
        return json({ error: 'not_found' }, 404)
      }

      if (pathname.startsWith('/api/pod/') && request.method === 'GET') {
        return await handlePodLookup(request, env, decodeURIComponent(pathname.slice('/api/pod/'.length)))
      }

      if (pathname === '/api/submit' && request.method === 'POST') {
        return await handleSubmit(request, env)
      }

      if (pathname === '/api/config' && request.method === 'GET') {
        // Lets the form know whether to render the Turnstile widget.
        return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null })
      }

      // ---- static assets + SPA fallback (handled by Workers Assets)
      return env.ASSETS.fetch(request)
    } catch (err) {
      console.error('Unhandled error:', err?.stack || err)
      return json({ error: 'server_error', message: 'Something went wrong on our side.' }, 500)
    }
  },
}
