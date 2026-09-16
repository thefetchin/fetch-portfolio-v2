import { cleanText } from './validate.js'

/**
 * Sending the refill message over the WhatsApp Cloud API.
 *
 * THE CONSTRAINT THAT SHAPES ALL OF THIS
 *
 * WhatsApp does not allow a business to send arbitrary text. A message the
 * business starts -- which is every message here, because none of these people
 * has written to us -- must be a TEMPLATE that Meta has reviewed and approved.
 * Free text is only allowed inside a 24-hour window that the customer opens by
 * messaging first.
 *
 * So "configurable message" means configurable template and variables. The
 * wording itself lives at Meta. Pretending otherwise would produce a panel
 * where you type a nice sentence, press send, and every message fails with
 * error 132000 -- which reads like a bug in our code and is not.
 */

const GRAPH_VERSION = 'v25.0'

/** Meta's free-tier and per-request limits are well above this; the real cap
 *  is the Workers free plan, which allows 50 subrequests per request. Leaving
 *  headroom for the D1 calls around them. */
export const MAX_SENDS_PER_CALL = 40

export class WhatsappError extends Error {
  constructor(message, { code = 'whatsapp_failed', status = 502 } = {}) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** The fields a template variable may be filled from. Anything else is
 *  refused, so a template cannot be pointed at a column it should not see. */
export const VARIABLE_FIELDS = ['pod_label', 'pod_location', 'pod_city']

export function fillVariables(names, pod) {
  const source = {
    pod_label: pod?.label || '',
    pod_location: pod?.location || '',
    pod_city: pod?.city || '',
  }
  return (Array.isArray(names) ? names : [])
    .filter((n) => VARIABLE_FIELDS.includes(n))
    // A WhatsApp template variable may not be empty or contain a newline --
    // Meta rejects the whole message. An em dash is a visible placeholder that
    // is obviously a gap rather than a silently missing word.
    .map((n) => {
      const v = String(source[n] ?? '').replace(/\s+/g, ' ').trim()
      return { type: 'text', text: v || '—' }
    })
}

/**
 * Sends one template message.
 *
 * Returns { ok, messageId } or throws WhatsappError with Meta's own message,
 * which is far more useful than anything we could invent -- it says whether
 * the template is unapproved, the number unreachable, or the token expired.
 */
export async function sendTemplate(env, { to, template, language, components }) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    throw new WhatsappError(
      'WhatsApp is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID as Worker secrets.',
      { code: 'whatsapp_not_configured', status: 503 }
    )
  }

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: language || 'en_US' },
      ...(components && components.length ? { components } : {}),
    },
  }

  let res
  try {
    // WHATSAPP_BASE_URL exists so the send path can be exercised against a
    // stub. Same seam as VLITE_BASE_URL. Unset in production, where it is
    // Meta's own host.
    const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
    res = await fetch(
      `${base}/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )
  } catch (err) {
    throw new WhatsappError(`Could not reach WhatsApp: ${err.message}`, { status: 502 })
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const e = data?.error || {}
    // Meta's token errors are 401/190. Surfaced as their own code because the
    // fix is "issue a new token", not "retry", and a generic 502 would have
    // someone retrying a dead credential all afternoon.
    const expired = res.status === 401 || e.code === 190
    throw new WhatsappError(
      e.message || `WhatsApp refused the message (HTTP ${res.status}).`,
      {
        code: expired ? 'whatsapp_token_expired' : 'whatsapp_rejected',
        status: expired ? 503 : 502,
      }
    )
  }

  return { ok: true, messageId: data?.messages?.[0]?.id || null }
}

/* ------------------------------------------------------------- settings -- */

export async function getSettings(env) {
  const row = await env.DB.prepare(
    `SELECT enabled, template_name, language_code, variables, body_preview,
            updated_at, updated_by
       FROM whatsapp_settings WHERE id = 1`
  ).first()
  let variables = []
  try { variables = JSON.parse(row?.variables || '[]') } catch { variables = [] }
  return {
    enabled: !!row?.enabled,
    templateName: row?.template_name || '',
    languageCode: row?.language_code || 'en_US',
    variables: Array.isArray(variables) ? variables.filter((v) => VARIABLE_FIELDS.includes(v)) : [],
    bodyPreview: row?.body_preview || '',
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
    configured: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID),
  }
}

export async function handleSettingsGet(env, json) {
  return json({ settings: await getSettings(env) })
}

export async function handleSettingsPut(request, env, json, actor) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json', message: 'Malformed request.' }, 400)
  }

  const templateName = cleanText(body.templateName, 120) || ''
  const languageCode = cleanText(body.languageCode, 12) || 'en_US'
  const bodyPreview = cleanText(body.bodyPreview, 1000) || ''
  const enabled = body.enabled ? 1 : 0

  const variables = Array.isArray(body.variables)
    ? body.variables.filter((v) => VARIABLE_FIELDS.includes(v)).slice(0, 10)
    : []

  // Turning sending ON without a template would give a button that fails on
  // every click, so the check is here rather than at send time.
  if (enabled && !templateName) {
    return json({
      error: 'validation',
      message: 'Add the approved template name before switching sending on.',
    }, 422)
  }
  if (templateName && !/^[a-z0-9_]+$/.test(templateName)) {
    return json({
      error: 'validation',
      message: 'A WhatsApp template name is lowercase letters, digits and underscores only.',
    }, 422)
  }

  await env.DB.prepare(
    `UPDATE whatsapp_settings
        SET enabled = ?1, template_name = ?2, language_code = ?3,
            variables = ?4, body_preview = ?5,
            updated_at = datetime('now'), updated_by = ?6
      WHERE id = 1`
  ).bind(enabled, templateName, languageCode, JSON.stringify(variables), bodyPreview, actor || null).run()

  return json({ ok: true, settings: await getSettings(env) })
}

/* --------------------------------------------------------------- sending -- */

/**
 * Messages everyone subscribed to one Pod.
 *
 * Sends are sequential, not parallel. Forty concurrent calls to Meta from one
 * Worker is a good way to be rate-limited into a batch that half-succeeded,
 * and the whole point of the log below is knowing exactly who got one.
 *
 * Every attempt is written down, including failures, because "who did we
 * message?" has to be answerable afterwards -- these are customers, and a
 * duplicate is a real annoyance rather than a duplicated row.
 */
export async function handlePodNotify(request, env, json, actor, podId) {
  const settings = await getSettings(env)

  if (!settings.configured) {
    return json({
      error: 'whatsapp_not_configured',
      message: 'WhatsApp is not connected. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID as Worker secrets.',
    }, 503)
  }
  if (!settings.enabled || !settings.templateName) {
    return json({
      error: 'whatsapp_disabled',
      message: 'Turn sending on and choose a template in the WhatsApp tab first.',
    }, 409)
  }

  const pod = await env.DB.prepare(
    'SELECT pod_id, label, location, city, active FROM pods WHERE pod_id = ?1'
  ).bind(podId).first()
  if (!pod) return json({ error: 'not_found', message: 'We could not find that Pod.' }, 404)

  const subs = await env.DB.prepare(
    `SELECT optin_id, wa_number FROM whatsapp_optins
      WHERE pod_id = ?1 AND status = 'active'
      ORDER BY consented_at`
  ).bind(podId).all()
  const people = subs.results || []

  if (!people.length) {
    return json({ ok: true, sent: 0, failed: 0, message: 'Nobody has subscribed to this Pod yet.' })
  }

  // A recent batch for the same Pod almost always means a double click or an
  // impatient retry, not a second genuine refill. Refusing is recoverable;
  // messaging every customer twice is not.
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM whatsapp_sends
      WHERE pod_id = ?1 AND status = 'sent' AND created_at > datetime('now', '-10 minutes')`
  ).bind(podId).first()
  if ((recent?.n ?? 0) > 0) {
    return json({
      error: 'too_soon',
      message: 'This Pod was messaged in the last 10 minutes. Wait, or check the send log.',
    }, 409)
  }

  const batchId = crypto.randomUUID()
  const components = settings.variables.length
    ? [{ type: 'body', parameters: fillVariables(settings.variables, pod) }]
    : []

  const queue = people.slice(0, MAX_SENDS_PER_CALL)
  const deferred = people.length - queue.length

  const rows = []
  let sent = 0
  let failed = 0
  let fatal = null

  for (const person of queue) {
    try {
      const r = await sendTemplate(env, {
        to: person.wa_number,
        template: settings.templateName,
        language: settings.languageCode,
        components,
      })
      sent++
      rows.push([crypto.randomUUID(), batchId, podId, person.wa_number, person.optin_id,
                 settings.templateName, 'sent', r.messageId, null])
    } catch (err) {
      failed++
      rows.push([crypto.randomUUID(), batchId, podId, person.wa_number, person.optin_id,
                 settings.templateName, 'failed', null, String(err.message || err).slice(0, 300)])
      // A dead token or an unapproved template fails for everyone, so carrying
      // on would just write the same error forty times and burn the quota.
      if (err instanceof WhatsappError
          && (err.code === 'whatsapp_token_expired' || err.code === 'whatsapp_not_configured')) {
        fatal = err
        break
      }
    }
  }

  if (rows.length) {
    const statements = rows.map((r) => env.DB.prepare(
      `INSERT INTO whatsapp_sends
         (send_id, batch_id, pod_id, wa_number, optin_id, template, status, wa_message_id, error)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
    ).bind(...r))
    // The log is written even when the batch died: it is the only record of
    // who was actually messaged before it stopped.
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50))
    }
  }

  if (fatal) {
    return json({
      error: fatal.code,
      message: `${fatal.message} ${sent} sent before it stopped.`,
      sent, failed, batchId,
    }, fatal.status)
  }

  return json({
    ok: true,
    batchId,
    sent,
    failed,
    deferred,
    message: [
      `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.`,
      failed ? `${failed} failed.` : '',
      deferred ? `${deferred} not attempted — press again to continue.` : '',
    ].filter(Boolean).join(' '),
  })
}

/**
 * The send history, newest first, optionally narrowed to one Pod or status.
 *
 * Failures carry Meta's own error text rather than anything we invent. That
 * wording is the entire diagnostic: "(#132001) Template name does not exist in
 * the translation" says the name is fine and the LANGUAGE is wrong, which no
 * generic "send failed" would ever have told anyone.
 */
export async function handleSendLog(request, env, json) {
  const url = new URL(request.url)
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500)
  const podId = url.searchParams.get('pod')
  const status = url.searchParams.get('status')

  const where = []
  const binds = []
  if (podId) {
    binds.push(podId)
    where.push(`s.pod_id = ?${binds.length}`)
  }
  if (['sent', 'failed', 'skipped'].includes(status)) {
    binds.push(status)
    where.push(`s.status = ?${binds.length}`)
  }
  binds.push(limit)

  const rows = await env.DB.prepare(
    `SELECT s.send_id, s.batch_id, s.pod_id, s.wa_number, s.status,
            s.wa_message_id, s.error, s.template, s.created_at,
            s.delivery_status, s.delivered_at, s.read_at, s.delivery_error,
            p.label AS pod_label
       FROM whatsapp_sends s
       LEFT JOIN pods p ON p.pod_id = s.pod_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.created_at DESC
      LIMIT ?${binds.length}`
  ).bind(...binds).all()

  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*)                                             AS total,
       SUM(CASE WHEN status = 'sent'   THEN 1 ELSE 0 END)   AS sent,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)   AS failed,
       COUNT(DISTINCT wa_number)                            AS people,
       COUNT(DISTINCT batch_id)                             AS batches,
       MAX(CASE WHEN status = 'sent' THEN created_at END)   AS last_sent_at,
       SUM(CASE WHEN delivery_status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END)              AS undelivered,
       -- Accepted by Meta but never heard about again. With no webhook this is
       -- everything, which is the honest answer rather than implying delivery.
       SUM(CASE WHEN status = 'sent' AND delivery_status IS NULL THEN 1 ELSE 0 END) AS unknown
     FROM whatsapp_sends`
  ).first()

  return json({ sends: rows.results || [], stats })
}

/* ------------------------------------------------------ connection check -- */

/**
 * Asks Meta what number we are actually sending from.
 *
 * Worth having because the commonest reason a message is accepted and never
 * arrives is that the sender is a TEST number, which can only reach a handful
 * of recipients added to an allow-list in the Meta dashboard. Nothing in the
 * send response hints at that; this does.
 */
export async function handleConnectionCheck(env, json) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return json({
      configured: false,
      message: 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID as Worker secrets.',
    })
  }

  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  const fields = 'display_phone_number,verified_name,quality_rating,platform_type,code_verification_status,name_status,throughput'

  let res
  try {
    res = await fetch(`${base}/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_ID}?fields=${fields}`, {
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    })
  } catch (err) {
    return json({ configured: true, ok: false, message: `Could not reach WhatsApp: ${err.message}` })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data?.error || {}
    return json({
      configured: true,
      ok: false,
      tokenExpired: res.status === 401 || e.code === 190,
      message: e.message || `WhatsApp refused the request (HTTP ${res.status}).`,
    })
  }

  return json({
    configured: true,
    ok: true,
    phoneNumber: data.display_phone_number || null,
    verifiedName: data.verified_name || null,
    qualityRating: data.quality_rating || null,
    // 'CLOUD_API' on a real number. Meta's own free test numbers report
    // differently and can only message an allow-list, which is the usual
    // reason an accepted message never arrives.
    platformType: data.platform_type || null,
    nameStatus: data.name_status || null,
    throughput: data.throughput?.level || null,
  })
}

/* --------------------------------------------------------------- webhook -- */

/** Meta signs every webhook body with the app secret. Without checking it,
 *  anyone who learns the URL can post fake delivery statuses. */
async function signatureValid(env, raw, header) {
  if (!env.WHATSAPP_APP_SECRET) return null      // not configured -> cannot verify
  if (!header || !header.startsWith('sha256=')) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.WHATSAPP_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const got = header.slice('sha256='.length)

  if (expected.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

/** Meta's one-time subscription handshake. */
export function handleWebhookVerify(request, env) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge || '', { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  return new Response('forbidden', { status: 403 })
}

/**
 * Delivery statuses from Meta.
 *
 * Always answers 200, even when it cannot use the payload. Meta retries and
 * eventually disables a webhook that returns errors, and a status we failed to
 * parse is not worth losing the subscription over -- so parsing problems are
 * swallowed here rather than surfaced as failures to Meta.
 */
export async function handleWebhook(request, env, ctx) {
  const raw = await request.text()

  const valid = await signatureValid(env, raw, request.headers.get('x-hub-signature-256'))
  if (valid === false) return new Response('bad signature', { status: 403 })
  // valid === null means WHATSAPP_APP_SECRET is unset. Accepting unsigned
  // callbacks would let anyone mark messages delivered, so it is refused --
  // loudly in the log, because the symptom otherwise is "statuses never
  // update" with nothing to explain it.
  if (valid === null) {
    console.warn('WhatsApp webhook rejected: WHATSAPP_APP_SECRET is not set')
    return new Response('not configured', { status: 503 })
  }

  let body
  try { body = JSON.parse(raw) } catch { return new Response('ok') }

  const statuses = []
  const inbound = []
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value || {}
      for (const st of v.statuses || []) statuses.push(st)
      // Messages FROM customers. Contacts carry the sender's profile name and
      // are keyed by wa_id, so they are matched up rather than assumed to be
      // in the same order.
      const names = new Map((v.contacts || []).map((c) => [c.wa_id, c?.profile?.name || null]))
      for (const m of v.messages || []) inbound.push({ m, name: names.get(m.from) || null })
    }
  }
  if (!statuses.length && !inbound.length) return new Response('ok')

  const work = (async () => {
    for (const st of statuses) {
      const id = st.id
      const status = ['sent', 'delivered', 'read', 'failed'].includes(st.status) ? st.status : null
      if (!id || !status) continue

      const err = Array.isArray(st.errors) && st.errors.length
        ? [st.errors[0].code ? `(#${st.errors[0].code})` : '',
           st.errors[0].title || st.errors[0].message || '',
           st.errors[0].error_data?.details || ''].filter(Boolean).join(' ').slice(0, 300)
        : null

      // Statuses can arrive out of order, so a 'sent' must never overwrite a
      // 'read' that already landed. The CASE keeps the furthest state reached.
      await env.DB.prepare(
        `UPDATE whatsapp_sends
            SET delivery_status = CASE
                  WHEN delivery_status = 'read' THEN 'read'
                  WHEN delivery_status = 'delivered' AND ?2 = 'sent' THEN 'delivered'
                  ELSE ?2 END,
                delivered_at = CASE WHEN ?2 = 'delivered' AND delivered_at IS NULL
                                    THEN datetime('now') ELSE delivered_at END,
                read_at      = CASE WHEN ?2 = 'read' AND read_at IS NULL
                                    THEN datetime('now') ELSE read_at END,
                delivery_error = COALESCE(?3, delivery_error),
                delivery_updated_at = datetime('now')
          WHERE wa_message_id = ?1`
      ).bind(id, status, err).run()
    }

    for (const { m, name } of inbound) {
      if (!m?.id || !m?.from) continue

      // The readable text, wherever this message type keeps it. Anything with
      // no text at all still gets a row -- an image or a location is a
      // customer trying to reach us, and dropping it loses the contact.
      const text = m.text?.body
        ?? m.button?.text
        ?? m.interactive?.button_reply?.title
        ?? m.interactive?.list_reply?.title
        ?? m[m.type]?.caption
        ?? null

      // Meta sends a unix timestamp in seconds.
      const sentAt = /^\d+$/.test(String(m.timestamp || ''))
        ? new Date(Number(m.timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : null

      // ON CONFLICT DO NOTHING because Meta retries: the same message can
      // arrive more than once and must not become two rows in the inbox.
      await env.DB.prepare(
        `INSERT INTO whatsapp_inbound
           (message_id, wa_number, profile_name, type, body, raw_json, sent_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(message_id) DO NOTHING`
      ).bind(
        m.id, m.from, name, m.type || 'unknown',
        text ? String(text).slice(0, 2000) : null,
        JSON.stringify(m).slice(0, 4000),
        sentAt
      ).run()

      // A reply of STOP is an opt-out, and honouring it is not optional. It is
      // applied here rather than left for someone to notice in the inbox --
      // the whole point of an opt-out is that it does not wait on a human.
      if (text && /^\s*(stop|unsubscribe)\b/i.test(String(text))) {
        await env.DB.prepare(
          `UPDATE whatsapp_optins
              SET status = 'unsubscribed', unsubscribed_at = datetime('now')
            WHERE wa_number = ?1 AND status = 'active'`
        ).bind(m.from).run()
      }
    }
  })()

  // Answer Meta immediately; finish the writes after. A slow webhook is a
  // webhook Meta starts retrying.
  if (ctx?.waitUntil) ctx.waitUntil(work.catch((e) => console.error('webhook write failed', e)))
  else await work

  return new Response('ok')
}

/* ----------------------------------------------------------- the inbox -- */

/**
 * Messages customers have sent us.
 *
 * `windowOpen` is the fact that actually governs what can be said back: a
 * reply within 24 hours of their last message may be free text, and after that
 * only an approved template will send.
 */
export async function handleInbox(request, env, json) {
  const url = new URL(request.url)
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500)
  const openOnly = url.searchParams.get('open') === '1'

  const rows = await env.DB.prepare(
    `SELECT i.message_id, i.wa_number, i.profile_name, i.type, i.body,
            i.sent_at, i.received_at, i.handled_at, i.handled_by,
            (julianday('now') - julianday(i.received_at)) * 24 AS hours_ago
       FROM whatsapp_inbound i
       ${openOnly ? 'WHERE i.handled_at IS NULL' : ''}
      ORDER BY i.received_at DESC
      LIMIT ?1`
  ).bind(limit).all()

  const items = (rows.results || []).map((r) => ({
    ...r,
    windowOpen: r.hours_ago != null && r.hours_ago < 24,
  }))

  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN handled_at IS NULL THEN 1 ELSE 0 END) AS open,
            COUNT(DISTINCT wa_number) AS people
       FROM whatsapp_inbound`
  ).first()

  return json({ inbound: items, stats })
}

/** Marks one inbound message dealt with. */
export async function handleInboxUpdate(request, env, json, actor, messageId) {
  let body
  try { body = await request.json() } catch { body = {} }
  const handled = body.handled !== false

  const res = await env.DB.prepare(
    `UPDATE whatsapp_inbound
        SET handled_at = CASE WHEN ?2 = 1 THEN COALESCE(handled_at, datetime('now')) ELSE NULL END,
            handled_by = CASE WHEN ?2 = 1 THEN ?3 ELSE NULL END
      WHERE message_id = ?1`
  ).bind(messageId, handled ? 1 : 0, actor || null).run()

  if (!res.meta?.changes) return json({ error: 'not_found', message: 'No such message.' }, 404)
  return json({ ok: true, handled })
}
