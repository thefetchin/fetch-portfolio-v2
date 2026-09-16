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
       MAX(CASE WHEN status = 'sent' THEN created_at END)   AS last_sent_at
     FROM whatsapp_sends`
  ).first()

  return json({ sends: rows.results || [], stats })
}
