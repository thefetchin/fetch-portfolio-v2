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

/**
 * Which number we send from.
 *
 * The setting wins over the WHATSAPP_PHONE_ID secret, so changing number is a
 * field in the panel rather than a secret rotation and a redeploy. The token
 * is the credential; this is an address.
 */
function phoneId(env, override) {
  return override || env.WHATSAPP_PHONE_ID || null
}

const NOT_CONFIGURED = 'WhatsApp is not connected. Set WHATSAPP_TOKEN as a Worker secret, '
  + 'and the phone number ID in Message settings.'

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
export async function sendTemplate(env, { to, template, language, components, phoneNumberId }) {
  const from = phoneId(env, phoneNumberId)
  if (!env.WHATSAPP_TOKEN || !from) {
    throw new WhatsappError(NOT_CONFIGURED, { code: 'whatsapp_not_configured', status: 503 })
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
      `${base}/${GRAPH_VERSION}/${from}/messages`,
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

/**
 * The components a send must carry, in the order Meta expects.
 *
 * A template with an image gains a HEADER component, and every send then has
 * to supply a parameter for it. Omitting it fails with
 * "(#132012) Parameter format does not match format in the created template",
 * which names no component and reads as though the body were wrong.
 */
export function buildComponents(settings, pod) {
  const components = []

  if (settings.headerFormat && settings.headerFormat !== 'NONE' && settings.headerMediaUrl) {
    const kind = settings.headerFormat.toLowerCase()   // image | video | document
    components.push({
      type: 'header',
      parameters: [{ type: kind, [kind]: { link: settings.headerMediaUrl } }],
    })
  }

  const params = fillVariables(settings.variables, pod)
  if (params.length) components.push({ type: 'body', parameters: params })

  return components
}

/* ------------------------------------------------------------- settings -- */

export async function getSettings(env) {
  const row = await env.DB.prepare(
    `SELECT enabled, template_name, language_code, variables, body_preview,
            header_format, header_media_url, phone_number_id, updated_at, updated_by
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
    headerFormat: row?.header_format || 'NONE',
    headerMediaUrl: row?.header_media_url || '',
    // The setting wins; the secret is the fallback for anything set up before
    // this field existed.
    phoneNumberId: row?.phone_number_id || env.WHATSAPP_PHONE_ID || '',
    phoneNumberIdSource: row?.phone_number_id ? 'settings' : (env.WHATSAPP_PHONE_ID ? 'secret' : 'unset'),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
    configured: !!(env.WHATSAPP_TOKEN && (row?.phone_number_id || env.WHATSAPP_PHONE_ID)),
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

  const headerFormat = ['NONE', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(body.headerFormat)
    ? body.headerFormat : 'NONE'
  const headerMediaUrl = cleanText(body.headerMediaUrl, 600) || null

  // Digits only: it is an id, and a pasted "+91 82770 34104" here would fail
  // every send with a 404 from Meta that names nothing useful.
  const phoneNumberId = cleanText(body.phoneNumberId, 40)
  if (phoneNumberId && !/^\d{5,25}$/.test(phoneNumberId)) {
    return json({
      error: 'validation',
      message: 'The phone number ID is the long number from WhatsApp Manager, digits only — '
        + 'not the phone number itself.',
    }, 422)
  }

  // Meta fetches this URL itself when the message is sent, so it has to be
  // publicly reachable https -- not behind our admin auth, not localhost.
  if (headerFormat !== 'NONE') {
    if (!headerMediaUrl) {
      return json({
        error: 'validation',
        message: 'A media header needs a public https URL for the file.',
      }, 422)
    }
    if (!/^https:\/\//i.test(headerMediaUrl)) {
      return json({
        error: 'validation',
        message: 'The header file must be an https URL that WhatsApp can fetch.',
      }, 422)
    }
  }

  await env.DB.prepare(
    `UPDATE whatsapp_settings
        SET enabled = ?1, template_name = ?2, language_code = ?3,
            variables = ?4, body_preview = ?5,
            header_format = ?7, header_media_url = ?8, phone_number_id = ?9,
            updated_at = datetime('now'), updated_by = ?6
      WHERE id = 1`
  ).bind(enabled, templateName, languageCode, JSON.stringify(variables), bodyPreview,
         actor || null, headerFormat, headerFormat === 'NONE' ? null : headerMediaUrl,
         phoneNumberId || null).run()

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
      message: NOT_CONFIGURED,
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
  const components = buildComponents(settings, pod)

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
        phoneNumberId: settings.phoneNumberId,
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
  const settings = await getSettings(env)
  const from = phoneId(env, settings.phoneNumberId)
  if (!env.WHATSAPP_TOKEN || !from) {
    return json({ configured: false, message: NOT_CONFIGURED })
  }

  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  // `status` is the field that says whether registration actually completed --
  // CONNECTED means the number can send AND receive. platform_type only says
  // which platform it is assigned to, which is not the same thing and was
  // read as though it were.
  const fields = [
    'display_phone_number', 'verified_name', 'quality_rating', 'platform_type',
    'code_verification_status', 'name_status', 'throughput', 'status',
    'is_official_business_account', 'messaging_limit_tier',
  ].join(',')

  let res
  try {
    res = await fetch(`${base}/${GRAPH_VERSION}/${from}?fields=${fields}`, {
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
    phoneNumberId: from,
    phoneNumberIdSource: settings.phoneNumberIdSource,
    phoneNumber: data.display_phone_number || null,
    verifiedName: data.verified_name || null,
    // CONNECTED is the only value that means the number can send and receive.
    status: data.status || null,
    codeVerification: data.code_verification_status || null,
    messagingLimitTier: data.messaging_limit_tier || null,
    officialBusinessAccount: data.is_official_business_account ?? null,
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

      // A reply typed in the dashboard gets a wamid too, and its status
      // arrives on this same webhook. Both tables are updated because the id
      // could belong to either and only one will match.
      await env.DB.prepare(
        `UPDATE whatsapp_replies
            SET delivery_status = CASE
                  WHEN delivery_status = 'read' THEN 'read'
                  WHEN delivery_status = 'delivered' AND ?2 = 'sent' THEN 'delivered'
                  ELSE ?2 END,
                delivery_error = COALESCE(?3, delivery_error)
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

      // Pull any attachment down now. The media URL expires within minutes, so
      // there is no doing this later when somebody opens the conversation.
      const att = m[m.type]
      if (INBOUND_MEDIA_TYPES.includes(m.type) && att?.id) {
        const got = await fetchInboundMedia(env, att.id)
        if (got.ok) {
          await env.DB.prepare(
            `INSERT INTO whatsapp_inbound_media (media_id, message_id, content_type, bytes, size)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(media_id) DO NOTHING`
          ).bind(att.id, m.id, got.contentType, got.bytes, got.bytes.byteLength).run()

          await env.DB.prepare(
            `UPDATE whatsapp_inbound SET media_id = ?2, media_type = ?3, media_size = ?4
              WHERE message_id = ?1`
          ).bind(m.id, att.id, got.contentType, got.bytes.byteLength).run()
        } else {
          // The message still belongs in the inbox. Saying why the picture is
          // missing beats one that silently never appears.
          await env.DB.prepare(
            'UPDATE whatsapp_inbound SET media_error = ?2 WHERE message_id = ?1'
          ).bind(m.id, String(got.reason).slice(0, 200)).run()
        }
      }

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

/* ------------------------------------------------------------ the chats -- */

/** How long after a customer's message we may reply with ordinary text. */
export const REPLY_WINDOW_HOURS = 24

/**
 * Sends a free-text message.
 *
 * Only legal inside the 24-hour window. Outside it Meta rejects with 131047
 * and the only way to reach someone is an approved template -- which is a
 * different thing entirely, and why this is a separate function from
 * sendTemplate rather than a flag on it.
 */
/**
 * Sends a picture, with an optional caption.
 *
 * WhatsApp fetches the file from a public URL, exactly as it does a template
 * header -- which is why this takes a link rather than bytes, and why the image
 * has to be one we have already published.
 */
export async function sendImage(env, { to, link, caption, phoneNumberId }) {
  const from = phoneId(env, phoneNumberId)
  if (!env.WHATSAPP_TOKEN || !from) {
    throw new WhatsappError(NOT_CONFIGURED, { code: 'whatsapp_not_configured', status: 503 })
  }
  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'

  let res
  try {
    res = await fetch(`${base}/${GRAPH_VERSION}/${from}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: { link, ...(caption ? { caption } : {}) },
      }),
    })
  } catch (err) {
    throw new WhatsappError(`Could not reach WhatsApp: ${err.message}`, { status: 502 })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data?.error || {}
    const expired = res.status === 401 || e.code === 190
    throw new WhatsappError(e.message || `WhatsApp refused the image (HTTP ${res.status}).`, {
      code: expired ? 'whatsapp_token_expired' : 'whatsapp_rejected',
      status: expired ? 503 : 502,
    })
  }
  return { ok: true, messageId: data?.messages?.[0]?.id || null }
}

export async function sendText(env, { to, body, phoneNumberId }) {
  const from = phoneId(env, phoneNumberId)
  if (!env.WHATSAPP_TOKEN || !from) {
    throw new WhatsappError(NOT_CONFIGURED, { code: 'whatsapp_not_configured', status: 503 })
  }

  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  let res
  try {
    res = await fetch(`${base}/${GRAPH_VERSION}/${from}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
    })
  } catch (err) {
    throw new WhatsappError(`Could not reach WhatsApp: ${err.message}`, { status: 502 })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data?.error || {}
    const expired = res.status === 401 || e.code === 190
    throw new WhatsappError(e.message || `WhatsApp refused the message (HTTP ${res.status}).`, {
      code: expired ? 'whatsapp_token_expired' : 'whatsapp_rejected',
      status: expired ? 503 : 502,
    })
  }
  return { ok: true, messageId: data?.messages?.[0]?.id || null }
}

/** Hours since this person last wrote to us, or null if they never have. */
async function hoursSinceLastInbound(env, waNumber) {
  const row = await env.DB.prepare(
    `SELECT (julianday('now') - julianday(MAX(received_at))) * 24 AS hours
       FROM whatsapp_inbound WHERE wa_number = ?1`
  ).bind(waNumber).first()
  return row?.hours == null ? null : Number(row.hours)
}

/** One row per person who has written to us, newest conversation first. */
export async function handleChatList(env, json) {
  const rows = await env.DB.prepare(
    `SELECT i.wa_number,
            MAX(i.profile_name)                                   AS profile_name,
            MAX(i.received_at)                                    AS last_inbound_at,
            COUNT(*)                                              AS inbound_count,
            SUM(CASE WHEN i.handled_at IS NULL THEN 1 ELSE 0 END) AS open_count,
            (julianday('now') - julianday(MAX(i.received_at))) * 24 AS hours_since,
            (SELECT body FROM whatsapp_inbound x
              WHERE x.wa_number = i.wa_number
              ORDER BY x.received_at DESC LIMIT 1)                AS last_body
       FROM whatsapp_inbound i
      GROUP BY i.wa_number
      ORDER BY MAX(i.received_at) DESC
      LIMIT 200`
  ).all()

  const chats = (rows.results || []).map((r) => ({
    ...r,
    windowOpen: r.hours_since != null && r.hours_since < REPLY_WINDOW_HOURS,
    hoursLeft: r.hours_since == null ? null
      : Math.max(0, Math.round((REPLY_WINDOW_HOURS - r.hours_since) * 10) / 10),
  }))
  return json({ chats })
}

/**
 * One conversation, both directions.
 *
 * Template sends are included as well as replies. They are part of what this
 * person has received from us, and a thread that hid them would have someone
 * puzzling over a reply to a message they could not see.
 */
export async function handleChatThread(env, json, waNumber) {
  const rows = await env.DB.prepare(
    `SELECT 'in'  AS direction, message_id AS id, body, received_at AS at,
            NULL AS status, NULL AS error, NULL AS delivery_status, type AS kind,
            profile_name AS who, media_id, media_type, media_error
       FROM whatsapp_inbound WHERE wa_number = ?1
     UNION ALL
     SELECT 'out' AS direction, reply_id AS id, body, created_at AS at,
            status, error, delivery_status, 'text' AS kind, sent_by AS who,
            media_url AS media_id, NULL AS media_type, NULL AS media_error
       FROM whatsapp_replies WHERE wa_number = ?1
     UNION ALL
     SELECT 'out' AS direction, send_id AS id,
            'Template: ' || template AS body, created_at AS at,
            status, error, delivery_status, 'template' AS kind, NULL AS who,
            NULL AS media_id, NULL AS media_type, NULL AS media_error
       FROM whatsapp_sends WHERE wa_number = ?1
     ORDER BY at ASC
     LIMIT 300`
  ).bind(waNumber).all()

  const hours = await hoursSinceLastInbound(env, waNumber)
  return json({
    waNumber,
    messages: rows.results || [],
    windowOpen: hours != null && hours < REPLY_WINDOW_HOURS,
    hoursLeft: hours == null ? null
      : Math.max(0, Math.round((REPLY_WINDOW_HOURS - hours) * 10) / 10),
  })
}

/** Sends a reply, refusing when the window has closed. */
export async function handleChatReply(request, env, json, actor, waNumber) {
  let body
  try { body = await request.json() } catch { body = {} }

  const text = cleanText(body.body, 1000)
  // A picture may travel with a caption or on its own, so the requirement is
  // "one of the two", not "text".
  const mediaUrl = cleanText(body.mediaUrl, 600)
  if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) {
    return json({ error: 'validation', message: 'The picture needs an https address.' }, 422)
  }
  if (!text && !mediaUrl) {
    return json({ error: 'validation', message: 'Write something, or attach a picture.' }, 422)
  }

  const hours = await hoursSinceLastInbound(env, waNumber)
  if (hours == null) {
    return json({
      error: 'no_window',
      message: 'This person has never messaged us, so only an approved template can reach them.',
    }, 409)
  }
  // Checked here as well as by Meta, so the answer explains itself rather than
  // arriving as error 131047 from someone else's API.
  if (hours >= REPLY_WINDOW_HOURS) {
    return json({
      error: 'window_closed',
      message: `They last wrote ${Math.round(hours)} hours ago. After ${REPLY_WINDOW_HOURS} `
        + 'hours only an approved template can be sent, not a typed reply.',
    }, 409)
  }

  const replyId = crypto.randomUUID()
  try {
    const settings = await getSettings(env)
    const r = mediaUrl
      ? await sendImage(env, {
          to: waNumber, link: mediaUrl, caption: text || '',
          phoneNumberId: settings.phoneNumberId,
        })
      : await sendText(env, {
          to: waNumber, body: text, phoneNumberId: settings.phoneNumberId,
        })
    await env.DB.prepare(
      `INSERT INTO whatsapp_replies
         (reply_id, wa_number, body, media_url, wa_message_id, status, sent_by)
       VALUES (?1, ?2, ?3, ?4, ?5, 'sent', ?6)`
    ).bind(replyId, waNumber, text || '', mediaUrl, r.messageId, actor || null).run()
    return json({ ok: true, replyId, messageId: r.messageId })
  } catch (err) {
    // A failed reply is still written down. Otherwise the thread shows nothing
    // and it looks as though nobody ever tried.
    await env.DB.prepare(
      `INSERT INTO whatsapp_replies
         (reply_id, wa_number, body, media_url, status, error, sent_by)
       VALUES (?1, ?2, ?3, ?4, 'failed', ?5, ?6)`
    ).bind(replyId, waNumber, text || '', mediaUrl,
           String(err.message || err).slice(0, 300), actor || null).run()
    return json({
      error: err.code || 'whatsapp_failed',
      message: err.message || 'Could not send that reply.',
    }, err.status || 502)
  }
}

/* ------------------------------------------------- the WABA <-> app link -- */

/**
 * Subscribing the WhatsApp Business Account to our app.
 *
 * This is a DIFFERENT thing from subscribing to webhook fields in the app
 * dashboard, and the distinction costs people days. The dashboard controls
 * which fields the app cares about; this controls whether a particular
 * WhatsApp Business Account routes its events to the app at all. Embedded
 * Signup does it silently, so a manual setup can have a perfectly correct
 * callback URL, a verified token, `messages` ticked -- and receive nothing,
 * with no error anywhere to explain it.
 *
 * Without it there is no inbound path, which is also why the number can look
 * unreachable to customers.
 */
function wabaId(env) {
  return env.WHATSAPP_WABA_ID || null
}

async function graph(env, path, method = 'GET') {
  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  const res = await fetch(`${base}/${GRAPH_VERSION}/${path}`, {
    method,
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/** Which apps this WhatsApp account currently routes events to. */
export async function handleWabaStatus(env, json) {
  const id = wabaId(env)
  if (!id) {
    return json({
      configured: false,
      message: 'WHATSAPP_WABA_ID is not set, so the account cannot be checked.',
    })
  }
  if (!env.WHATSAPP_TOKEN) {
    return json({ configured: false, message: 'WHATSAPP_TOKEN is not set.' })
  }

  const r = await graph(env, `${id}/subscribed_apps`)
  if (!r.ok) {
    const e = r.data?.error || {}
    return json({
      configured: true,
      ok: false,
      // The token needs whatsapp_business_management for this, and saying so
      // beats a bare permissions error.
      needsPermission: e.code === 200 || e.code === 190 || r.status === 403,
      message: e.message || `Could not read the account (HTTP ${r.status}).`,
    })
  }

  const apps = (r.data?.data || []).map((a) => ({
    id: a?.whatsapp_business_api_data?.id || null,
    name: a?.whatsapp_business_api_data?.name || null,
    link: a?.whatsapp_business_api_data?.link || null,
  }))
  return json({ configured: true, ok: true, wabaId: id, subscribedApps: apps, count: apps.length })
}

/** Binds this WhatsApp account to the app so its events reach our webhook. */
export async function handleWabaSubscribe(env, json) {
  const id = wabaId(env)
  if (!id) return json({ error: 'not_configured', message: 'WHATSAPP_WABA_ID is not set.' }, 503)
  if (!env.WHATSAPP_TOKEN) {
    return json({ error: 'not_configured', message: 'WHATSAPP_TOKEN is not set.' }, 503)
  }

  const r = await graph(env, `${id}/subscribed_apps`, 'POST')
  if (!r.ok) {
    const e = r.data?.error || {}
    return json({
      error: 'subscribe_failed',
      message: e.message || `WhatsApp refused the subscription (HTTP ${r.status}).`,
      hint: (e.code === 200 || r.status === 403)
        ? 'The access token needs the whatsapp_business_management permission for this.'
        : null,
    }, r.status === 403 ? 403 : 502)
  }

  return json({
    ok: true,
    message: 'This WhatsApp account now routes its messages and statuses to us. '
      + 'Send a message to the business number to confirm.',
  })
}

/* -------------------------------------------------------- canned replies -- */

/**
 * Pre-typed replies.
 *
 * Ordinary free text, not templates, so they are only sendable inside the
 * 24-hour window -- which is precisely when someone is typing the same refund
 * explanation for the fifth time.
 *
 * They are INSERTED into the composer rather than sent directly. The person
 * still reads it and presses Send, so the wording can be adjusted to the actual
 * question instead of firing a canned paragraph at someone who asked something
 * slightly different.
 */
export async function handleCannedList(env, json) {
  const rows = await env.DB.prepare(
    `SELECT canned_id, title, body, sort_order, created_at, created_by
       FROM whatsapp_canned_replies
      ORDER BY sort_order, created_at`
  ).all()
  return json({ canned: rows.results || [] })
}

export async function handleCannedCreate(request, env, json, actor) {
  let body
  try { body = await request.json() } catch { body = {} }

  const title = cleanText(body.title, 60)
  // Newlines are meaningful here -- a refund explanation is a paragraph or
  // two -- so cleanText, which collapses whitespace, would ruin it.
  const text = typeof body.body === 'string'
    ? body.body.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, 1000)
    : ''

  if (!title) return json({ error: 'validation', message: 'Give it a name.' }, 422)
  if (!text) return json({ error: 'validation', message: 'Write the message.' }, 422)

  // Same id style as the rest of this module.
  const id = `cn_${crypto.randomUUID().slice(0, 8)}`
  const order = Number.isInteger(body.sortOrder) ? body.sortOrder : 100

  await env.DB.prepare(
    `INSERT INTO whatsapp_canned_replies (canned_id, title, body, sort_order, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(id, title, text, order, actor || null).run()

  return json({ ok: true, cannedId: id })
}

export async function handleCannedDelete(env, json, cannedId) {
  const res = await env.DB.prepare(
    'DELETE FROM whatsapp_canned_replies WHERE canned_id = ?1'
  ).bind(cannedId).run()
  if (!res.meta?.changes) return json({ error: 'not_found', message: 'No such reply.' }, 404)
  return json({ ok: true })
}

/* ------------------------------------------------- what the template wants -- */

/**
 * Reads the configured template back from Meta.
 *
 * Without this the panel lets you declare variables blind and only finds out
 * at send time, as a 132012 that names nothing. Now the shape it actually
 * expects -- header format, how many body variables, buttons -- can be shown
 * next to what we are configured to send.
 */
export async function handleTemplateInspect(env, json) {
  const id = env.WHATSAPP_WABA_ID
  if (!id || !env.WHATSAPP_TOKEN) {
    return json({ configured: false, message: 'WHATSAPP_WABA_ID or WHATSAPP_TOKEN is not set.' })
  }

  const settings = await getSettings(env)
  if (!settings.templateName) {
    return json({ configured: false, message: 'No template is configured yet.' })
  }

  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  const url = `${base}/${GRAPH_VERSION}/${id}/message_templates`
    + `?name=${encodeURIComponent(settings.templateName)}&limit=10`

  let res
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` } })
  } catch (err) {
    return json({ configured: true, ok: false, message: `Could not reach WhatsApp: ${err.message}` })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return json({
      configured: true, ok: false,
      message: data?.error?.message || `WhatsApp refused the request (HTTP ${res.status}).`,
    })
  }

  // Meta returns every language variant under one name; ours is the one whose
  // language matches what we send.
  const all = data?.data || []
  const tpl = all.find((t) => t.language === settings.languageCode) || all[0] || null
  if (!tpl) {
    return json({
      configured: true, ok: true, found: false,
      message: `No template named "${settings.templateName}" in this account.`,
    })
  }

  const comps = tpl.components || []
  const header = comps.find((c) => c.type === 'HEADER') || null
  const bodyComp = comps.find((c) => c.type === 'BODY') || null
  const buttons = comps.find((c) => c.type === 'BUTTONS') || null

  // Body placeholders are {{1}}, {{2}}... so the highest number is how many
  // parameters a send must carry.
  const nums = [...String(bodyComp?.text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((m) => Number(m[1]))
  const bodyVariables = nums.length ? Math.max(...nums) : 0

  const wants = {
    headerFormat: header ? (header.format || 'TEXT') : 'NONE',
    bodyVariables,
    buttons: (buttons?.buttons || []).map((b) => b.type),
  }

  const has = {
    headerFormat: settings.headerFormat || 'NONE',
    bodyVariables: settings.variables.length,
  }

  const problems = []
  if (wants.headerFormat !== has.headerFormat) {
    problems.push(
      wants.headerFormat === 'NONE'
        ? 'The template has no header, but a header is configured here.'
        : `The template has an ${wants.headerFormat} header. Set it here and give it a public https URL.`
    )
  }
  if (wants.bodyVariables !== has.bodyVariables) {
    problems.push(
      `The template uses ${wants.bodyVariables} body variable(s); `
      + `${has.bodyVariables} are configured here.`
    )
  }

  return json({
    configured: true, ok: true, found: true,
    name: tpl.name,
    language: tpl.language,
    category: tpl.category,
    status: tpl.status,
    bodyText: bodyComp?.text || null,
    wants,
    has,
    problems,
    matches: problems.length === 0,
  })
}

/* ----------------------------------------------------------- header media -- */

/** SQLite caps a value just under 1MB and the row carries more than the bytes,
 *  so this leaves room. WhatsApp itself allows 5MB, but that is not the
 *  binding limit here and pretending otherwise would fail at the write. */
export const MAX_MEDIA_BYTES = 800 * 1024

const MEDIA_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

/**
 * Stores a header image and returns the public URL to put in the settings.
 *
 * The id is part of the URL on purpose. Meta caches media by URL, so replacing
 * the picture at a fixed address would keep delivering the old one; a fresh id
 * means a fresh URL and no stale cache to reason about.
 */
export async function handleMediaUpload(request, env, json, actor) {
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim()
  if (!MEDIA_TYPES[contentType]) {
    return json({
      error: 'validation',
      message: 'The header image has to be a PNG or a JPEG.',
    }, 415)
  }

  const buf = await request.arrayBuffer()
  if (!buf.byteLength) {
    return json({ error: 'validation', message: 'That file was empty.' }, 422)
  }
  if (buf.byteLength > MAX_MEDIA_BYTES) {
    return json({
      error: 'too_large',
      message: `That image is ${Math.round(buf.byteLength / 1024)}KB. The limit here is `
        + `${Math.round(MAX_MEDIA_BYTES / 1024)}KB — export it smaller, or at a lower resolution.`,
    }, 413)
  }

  const ext = MEDIA_TYPES[contentType]
  const mediaId = `wam_${crypto.randomUUID().slice(0, 12)}`
  const filename = cleanText(request.headers.get('x-filename'), 120)

  await env.DB.prepare(
    `INSERT INTO whatsapp_media (media_id, filename, content_type, bytes, size, uploaded_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(mediaId, filename, contentType, buf, buf.byteLength, actor || null).run()

  // Served from the PUBLIC host: Meta fetches it with no session of ours, so
  // it cannot sit behind the dashboard's auth.
  const host = env.FORM_HOSTNAME || new URL(request.url).host
  const url = `https://${host}/media/whatsapp/${mediaId}.${ext}`

  return json({ ok: true, mediaId, url, size: buf.byteLength, contentType })
}

/** Serves a stored header image. Public and unauthenticated by necessity. */
export async function handleMediaGet(env, mediaId) {
  const row = await env.DB.prepare(
    'SELECT content_type, bytes FROM whatsapp_media WHERE media_id = ?1'
  ).bind(mediaId).first()

  if (!row) return new Response('not found', { status: 404 })

  // D1 hands a BLOB back as a plain array of byte values, not a buffer.
  // Passing that straight to Response yields a 200 with an EMPTY body -- right
  // status, right content type, no picture, and Meta would simply fail to
  // fetch the header with nothing to explain why.
  const bytes = row.bytes instanceof ArrayBuffer
    ? new Uint8Array(row.bytes)
    : new Uint8Array(Array.isArray(row.bytes) ? row.bytes : [])

  return new Response(bytes, {
    headers: {
      'content-type': row.content_type,
      // The id is unique per upload, so the bytes at this URL never change and
      // can be cached hard -- by Meta and by anything else.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}

/** Previously uploaded images, so one can be picked again without re-uploading. */
export async function handleMediaList(env, json) {
  const rows = await env.DB.prepare(
    `SELECT media_id, filename, content_type, size, uploaded_at, uploaded_by
       FROM whatsapp_media ORDER BY uploaded_at DESC LIMIT 20`
  ).all()
  const host = env.FORM_HOSTNAME || 'feedback.thefetch.in'
  return json({
    media: (rows.results || []).map((m) => ({
      ...m,
      url: `https://${host}/media/whatsapp/${m.media_id}.${m.content_type === 'image/png' ? 'png' : 'jpg'}`,
    })),
    maxBytes: MAX_MEDIA_BYTES,
  })
}

/* ------------------------------------------------------- inbound pictures -- */

/** Same SQLite ceiling as the header images. WhatsApp re-compresses photos
 *  before delivering them, so most land well under this -- but not all, and
 *  the ones that do not are recorded rather than silently dropped. */
export const MAX_INBOUND_MEDIA_BYTES = 800 * 1024

const INBOUND_MEDIA_TYPES = ['image', 'sticker', 'document', 'audio', 'video']

/**
 * Pulls an attachment down from Meta.
 *
 * Two steps, and both need the token: the media id resolves to a URL, and that
 * URL expires within minutes. So this runs while the webhook is handling the
 * message. There is no fetching it later when somebody opens the conversation.
 *
 * Returns { ok, bytes, contentType } or { ok: false, reason } -- a reason
 * rather than a throw, because a picture we could not keep must still leave the
 * message itself in the inbox.
 */
export async function fetchInboundMedia(env, mediaId) {
  if (!env.WHATSAPP_TOKEN) return { ok: false, reason: 'WhatsApp is not configured.' }
  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  const auth = { authorization: `Bearer ${env.WHATSAPP_TOKEN}` }

  let meta
  try {
    const r = await fetch(`${base}/${GRAPH_VERSION}/${mediaId}`, { headers: auth })
    meta = await r.json()
    if (!r.ok) return { ok: false, reason: meta?.error?.message || `lookup failed (${r.status})` }
  } catch (err) {
    return { ok: false, reason: `lookup failed: ${err.message}` }
  }

  const size = Number(meta?.file_size || 0)
  if (size && size > MAX_INBOUND_MEDIA_BYTES) {
    return {
      ok: false,
      reason: `${Math.round(size / 1024)}KB, over the ${Math.round(MAX_INBOUND_MEDIA_BYTES / 1024)}KB we can store`,
    }
  }
  if (!meta?.url) return { ok: false, reason: 'no download url' }

  try {
    // The download URL needs the token too -- it is not a public link.
    const r = await fetch(meta.url, { headers: auth })
    if (!r.ok) return { ok: false, reason: `download failed (${r.status})` }
    const buf = await r.arrayBuffer()
    // file_size can be absent, so the real length is checked as well.
    if (buf.byteLength > MAX_INBOUND_MEDIA_BYTES) {
      return {
        ok: false,
        reason: `${Math.round(buf.byteLength / 1024)}KB, over the `
          + `${Math.round(MAX_INBOUND_MEDIA_BYTES / 1024)}KB we can store`,
      }
    }
    return { ok: true, bytes: buf, contentType: meta.mime_type || 'application/octet-stream' }
  } catch (err) {
    return { ok: false, reason: `download failed: ${err.message}` }
  }
}

/** Serves one customer attachment. ADMIN ONLY -- these are photographs someone
 *  sent to a business, not something we publish. */
export async function handleInboundMediaGet(env, mediaId) {
  const row = await env.DB.prepare(
    'SELECT content_type, bytes FROM whatsapp_inbound_media WHERE media_id = ?1'
  ).bind(mediaId).first()
  if (!row) return new Response('not found', { status: 404 })

  // D1 returns a BLOB as a plain array of byte values, not a buffer.
  const bytes = row.bytes instanceof ArrayBuffer
    ? new Uint8Array(row.bytes)
    : new Uint8Array(Array.isArray(row.bytes) ? row.bytes : [])

  return new Response(bytes, {
    headers: {
      'content-type': row.content_type,
      // Private: it is a customer's photograph behind a session.
      'cache-control': 'private, max-age=3600',
    },
  })
}

/* ----------------------------------------------------------- registering -- */

/**
 * Registers the configured number with the Cloud API.
 *
 * A number added in WhatsApp Manager is verified but not yet registered:
 * status PENDING, platform_type NOT_APPLICABLE. Until this call it cannot send
 * or receive, and messages to it look to a customer as though the number is not
 * on WhatsApp at all.
 *
 * The PIN is the number's two-step verification PIN, chosen by whoever runs the
 * account. It is used for this one request and NEVER stored -- not in D1, not
 * in a log, not in the response. It will be needed again if the number is ever
 * re-registered or moved, so it is theirs to keep, not ours.
 */
export async function handleRegisterNumber(request, env, json) {
  let body
  try { body = await request.json() } catch { body = {} }

  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  if (!/^\d{6}$/.test(pin)) {
    return json({
      error: 'validation',
      message: 'The PIN is exactly six digits. Choose one and keep it — it is needed '
        + 'again if this number is ever re-registered.',
    }, 422)
  }

  const settings = await getSettings(env)
  const from = phoneId(env, settings.phoneNumberId)
  if (!env.WHATSAPP_TOKEN || !from) {
    return json({ error: 'not_configured', message: NOT_CONFIGURED }, 503)
  }

  const base = env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
  let res
  try {
    res = await fetch(`${base}/${GRAPH_VERSION}/${from}/register`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    })
  } catch (err) {
    return json({ error: 'whatsapp_failed', message: `Could not reach WhatsApp: ${err.message}` }, 502)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data?.error || {}
    // 133005 is the wrong PIN on a number that already has one; worth naming,
    // because the fix is "use the PIN you set before", not "try again".
    const wrongPin = e.code === 133005
    return json({
      error: wrongPin ? 'wrong_pin' : 'register_failed',
      message: wrongPin
        ? 'That is not this number\u2019s existing two-step PIN. Use the one set when it was '
          + 'last registered, or reset it in WhatsApp Manager.'
        : (e.message || `WhatsApp refused the registration (HTTP ${res.status}).`),
    }, res.status === 400 ? 409 : 502)
  }

  return json({
    ok: true,
    message: 'Registered. The number can now send and receive — re-check the connection.',
  })
}
