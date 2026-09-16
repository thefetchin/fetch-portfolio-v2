import { useCallback, useEffect, useMemo, useState } from 'react'
import { WHATSAPP_STATUSES } from '../../shared/constants.js'
import './Whatsapp.css'

/**
 * WhatsApp refill notifications — the list of who to message when a Pod is
 * filled, and the consent behind each number.
 *
 * Nothing here sends a message. This is the list and the evidence; sending is
 * a separate decision made with a separate tool, and keeping the two apart is
 * what stops "export the numbers" quietly becoming "message the numbers".
 */

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 919876543210 -> +91 98765 43210 */
const fmtNumber = (n) =>
  /^91\d{10}$/.test(n) ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : `+${n}`

const STATUS_LABELS = {
  active: 'Subscribed',
  unsubscribed: 'Opted out',
  invalid: 'Bad number',
}

const VARIABLE_FIELDS = [
  { value: 'pod_label', label: 'Pod display name' },
  { value: 'pod_location', label: 'Pod location' },
  { value: 'pod_city', label: 'Pod city' },
]

/**
 * A short, friendly body to register with Meta.
 *
 * One emoji, not one per item: a line of them reads as a promotion nobody
 * asked for, and these people asked. {{1}} is a POSITIONAL parameter -- Meta's
 * editor also offers named ones, and the sender here fills positions in order.
 */
const SUGGESTED_BODY =
  '\u{1F389} Good news \u2014 the Fetch Pod at {{1}} has just been restocked.\n\n'
  + 'Fresh snacks, chocolates and chilled drinks are waiting for you.\n\n'
  + 'Pop by whenever you fancy something.'

/**
 * Message settings.
 *
 * WhatsApp does not let a business send arbitrary text. Every message here is
 * one we start, so Meta requires an APPROVED TEMPLATE -- free text is only
 * allowed inside a 24-hour window a customer opens by writing to us first.
 *
 * So what is configurable here is which template and what goes in its
 * variables. The sentence itself lives at Meta. A box that let you type a
 * message and press send would fail on every attempt, and the error would look
 * like our bug.
 */
function Settings({ onError, onNotice }) {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/whatsapp/settings', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the settings.')
      setS(d.settings)
    } catch (e) { onError(e.message) }
  }, [onError])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/whatsapp/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not save.')
      setS(d.settings)
      onNotice('Message settings saved.')
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }

  if (!s) return null

  const toggleVar = (v) => setS({
    ...s,
    variables: s.variables.includes(v)
      ? s.variables.filter((x) => x !== v)
      : [...s.variables, v],
  })

  return (
    <details className="wa-settings" open={!s.templateName}>
      <summary>Message settings</summary>

      {!s.configured && (
        <div className="wa-error" role="alert">
          WhatsApp is not connected. Set <code>WHATSAPP_TOKEN</code> and{' '}
          <code>WHATSAPP_PHONE_ID</code> as Worker secrets, then reload.
        </div>
      )}

      <p className="wa-sub">
        WhatsApp only lets a business send a message it started if the wording
        has been approved by Meta in advance. So the sentence lives in a
        template registered at Meta, and what you choose here is which template
        to use and what to put in its blanks.
      </p>

      <label className="wa-field">
        <span>Template name</span>
        <input
          value={s.templateName}
          placeholder="fetch_pod_refilled"
          onChange={(e) => setS({ ...s, templateName: e.target.value })}
        />
        <em>Exactly as registered at Meta — lowercase, digits and underscores.</em>
      </label>

      <label className="wa-field">
        <span>Language</span>
        <input
          value={s.languageCode}
          placeholder="en_US"
          onChange={(e) => setS({ ...s, languageCode: e.target.value })}
        />
        <em>The language code on the approved template, e.g. en_US or en_GB.</em>
      </label>

      <fieldset className="wa-field">
        <legend>What fills the blanks</legend>
        <em>
          Tick in the order the template uses them: the first ticked fills
          &#123;&#123;1&#125;&#125;, the second &#123;&#123;2&#125;&#125;.
        </em>
        {VARIABLE_FIELDS.map((f) => (
          <label key={f.value} className="wa-check">
            <input
              type="checkbox"
              checked={s.variables.includes(f.value)}
              onChange={() => toggleVar(f.value)}
            />
            <span>
              {f.label}
              {s.variables.includes(f.value)
                && ` — fills {{${s.variables.indexOf(f.value) + 1}}}`}
            </span>
          </label>
        ))}
      </fieldset>

      <label className="wa-field">
        <span>Approved wording, for reference</span>
        <textarea
          rows={6} value={s.bodyPreview}
          placeholder={SUGGESTED_BODY}
          onChange={(e) => setS({ ...s, bodyPreview: e.target.value })}
        />
        <em>
          A copy of what you registered at Meta, shown here so the panel can
          display what is about to go out. Editing it changes nothing at Meta.
        </em>
      </label>

      <button
        type="button" className="abtn"
        onClick={() => setS({ ...s, bodyPreview: SUGGESTED_BODY, variables: ['pod_label'] })}
      >
        Use the suggested wording
      </button>

      <label className="wa-check wa-enable">
        <input
          type="checkbox" checked={s.enabled}
          onChange={(e) => setS({ ...s, enabled: e.target.checked })}
        />
        <span>Sending is on</span>
      </label>

      <div className="wa-actions">
        <button type="button" className="abtn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {s.updatedAt && (
        <p className="wa-fine">Last changed {s.updatedAt}{s.updatedBy ? ` by ${s.updatedBy}` : ''}.</p>
      )}
    </details>
  )
}

/**
 * What number we are actually sending from.
 *
 * The commonest reason a message is accepted and never arrives is that the
 * sender is one of Meta's TEST numbers, which can only reach a short
 * allow-list configured in their dashboard. Nothing in the send response hints
 * at it, so this asks Meta directly.
 */
function Connection({ onError }) {
  const [c, setC] = useState(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/whatsapp/status', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not check the connection.')
      setC(d)
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }, [onError])

  useEffect(() => { check() }, [check])

  if (!c) return null

  return (
    <div className={`wa-conn ${c.ok ? '' : 'is-bad'}`}>
      <div className="wa-conn-head">
        <strong>
          {!c.configured ? 'WhatsApp not connected'
            : c.ok ? `Sending from ${c.phoneNumber || 'an unknown number'}`
            : 'WhatsApp connection problem'}
        </strong>
        <button type="button" className="abtn" onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {!c.ok && <p className="wa-fine">{c.message}</p>}
      {c.tokenExpired && (
        <p className="wa-fine">
          The access token has expired. A short-lived token lasts 24 hours — use a
          System User token for something that runs unattended.
        </p>
      )}

      {c.ok && (
        <p className="wa-fine">
          {c.verifiedName ? `${c.verifiedName} · ` : ''}
          {c.qualityRating ? `quality ${c.qualityRating} · ` : ''}
          {c.throughput ? `throughput ${c.throughput}` : ''}
        </p>
      )}

      {c.ok && c.nameStatus && c.nameStatus !== 'APPROVED' && (
        <p className="wa-fine">
          Display name status is <strong>{c.nameStatus}</strong>, not APPROVED.
        </p>
      )}
    </div>
  )
}

/**
 * What actually happened to a message.
 *
 * "Accepted" is the honest word for a message Meta took but never reported on
 * again -- which is every message until a delivery webhook is connected.
 * Calling that "Sent" implies an arrival nobody has confirmed.
 */
function deliveryLabel(r) {
  if (r.status !== 'sent') return r.status === 'failed' ? 'Rejected' : 'Skipped'
  switch (r.delivery_status) {
    case 'read': return 'Read'
    case 'delivered': return 'Delivered'
    case 'failed': return 'Not delivered'
    case 'sent': return 'Sent to handset'
    default: return 'Accepted'
  }
}

function deliveryTone(r) {
  if (r.status !== 'sent') return 'invalid'
  if (r.delivery_status === 'failed') return 'invalid'
  if (r.delivery_status === 'delivered' || r.delivery_status === 'read') return 'active'
  return 'unsubscribed'   // accepted but unconfirmed: grey, not green
}

/**
 * The send log.
 *
 * Failures show Meta's own wording, not ours. That text is the whole
 * diagnostic: "(#132001) Template name does not exist in the translation"
 * says the template name is fine and the LANGUAGE is wrong, which is not
 * something a generic "send failed" would ever have revealed.
 */
function SendLog({ onError }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      const r = await fetch(`/api/admin/whatsapp/sends?${qs}`, { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the send log.')
      setData(d)
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }, [status, onError])

  useEffect(() => { load() }, [load])

  const sends = data?.sends || []
  const st = data?.stats

  return (
    <details className="wa-settings" open>
      <summary>Send log</summary>

      {st && (
        <div className="wa-stats">
          <div className="wa-stat"><span>{st.delivered ?? 0}</span><label>Delivered</label></div>
          <div className={`wa-stat ${st.unknown ? 'is-unknown' : ''}`}>
            <span>{st.unknown ?? 0}</span><label>Accepted, not confirmed</label>
          </div>
          <div className="wa-stat"><span>{(st.failed ?? 0) + (st.undelivered ?? 0)}</span><label>Failed</label></div>
          <div className="wa-stat"><span>{st.people ?? 0}</span><label>People</label></div>
        </div>
      )}

      <div className="wa-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Everything</option>
          <option value="sent">Delivered to Meta</option>
          <option value="failed">Failed</option>
        </select>
        <button type="button" className="abtn" onClick={load} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!sends.length && !busy && (
        <p className="wa-fine">
          Nothing sent yet. Use <strong>Notify</strong> on a Pod in Pods &amp; QR codes.
        </p>
      )}

      {!!sends.length && (
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr>
                <th>When</th><th>Pod</th><th>To</th><th>Status</th><th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((r) => (
                <tr key={r.send_id} className={r.status === 'sent' ? '' : 'is-off'}>
                  <td className="wa-nowrap">{fmtDate(r.created_at)}</td>
                  <td>
                    <div>{r.pod_label || r.pod_id}</div>
                    <div className="wa-fine">{r.template}</div>
                  </td>
                  <td className="wa-nowrap">{fmtNumber(r.wa_number)}</td>
                  <td>
                    {/*
                      Two different facts, deliberately not merged. The send
                      status is whether Meta ACCEPTED the message; the delivery
                      status is what happened to it afterwards, and only a
                      webhook can tell us that. Showing acceptance alone as
                      "Sent" is what made a message that never arrived look
                      like a success.
                    */}
                    <span className={`wa-badge wa-badge--${deliveryTone(r)}`}>
                      {deliveryLabel(r)}
                    </span>
                  </td>
                  <td>
                    {r.error || r.delivery_error
                      ? <span className="wa-err">{r.error || r.delivery_error}</span>
                      : <span className="wa-fine wa-msgid">{r.wa_message_id || '—'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="wa-fine">
        {st?.unknown
          ? <><strong>Accepted</strong> means WhatsApp took the message but has not
            told us what became of it. Connect the delivery webhook and these
            become Delivered, Read or Not delivered.</>
          : <>Delivery is reported by Meta&apos;s webhook. &ldquo;Read&rdquo; only
            appears if the recipient has read receipts on.</>}
      </p>
    </details>
  )
}

export default function Whatsapp() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [pod, setPod] = useState('')
  const [status, setStatus] = useState('active')

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (pod) qs.set('pod', pod)
      if (status) qs.set('status', status)
      const res = await fetch(`/api/admin/whatsapp?${qs}`, { credentials: 'include' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || 'Could not load the list.')
      setData(body)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [pod, status])

  useEffect(() => { load() }, [load])

  const rows = data?.optins || []
  const stats = data?.stats

  const pods = useMemo(() => {
    const seen = new Map()
    for (const r of rows) if (!seen.has(r.pod_id)) seen.set(r.pod_id, r.pod_label || r.pod_id)
    return [...seen.entries()]
  }, [rows])

  const setRowStatus = async (optinId, next) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/whatsapp/${optinId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || 'Could not update that row.')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  /**
   * CSV of the CURRENT filter, consent columns included.
   *
   * The consent date and wording travel with the number deliberately: a bare
   * column of phone numbers in a spreadsheet is the format in which consent
   * gets forgotten.
   */
  const exportCsv = () => {
    const head = [
      'whatsapp_number', 'pod_id', 'pod_label', 'pod_location', 'status',
      'consented_at', 'reconfirmed_at', 'unsubscribed_at', 'consent_text',
      'source', 'last_sent_at', 'send_count',
    ]
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head.join(',')]
    for (const r of rows) {
      lines.push([
        r.wa_number, r.pod_id, r.pod_label, r.pod_location, r.status,
        r.consented_at, r.reconfirmed_at, r.unsubscribed_at, r.consent_text,
        r.source, r.last_sent_at, r.send_count,
      ].map(esc).join(','))
    }
    const url = URL.createObjectURL(
      new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `whatsapp-optins-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="wa">
      <div className="wa-head">
        <div>
          <h2>WhatsApp refill notifications</h2>
          <p className="wa-sub">
            People who asked to be told when a Pod is refilled. Each row records
            the number, the Pod, and the exact wording they agreed to.
            Nothing here sends a message.
          </p>
        </div>
        <div className="wa-actions">
          <button type="button" className="abtn" onClick={load} disabled={busy}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="abtn" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </button>
        </div>
      </div>

      {error && <div className="wa-error" role="alert">{error}</div>}

      <Connection onError={setError} />
      <Settings onError={setError} onNotice={(m) => { setError(null); setNotice(m) }} />
      <SendLog onError={setError} />
      {notice && <div className="wa-notice" role="status">{notice}</div>}

      {stats && (
        <div className="wa-stats">
          <div className="wa-stat"><span>{stats.active ?? 0}</span><label>Subscribed</label></div>
          <div className="wa-stat"><span>{stats.people ?? 0}</span><label>People</label></div>
          <div className="wa-stat"><span>{stats.pods_covered ?? 0}</span><label>Pods covered</label></div>
          <div className="wa-stat"><span>{stats.unsubscribed ?? 0}</span><label>Opted out</label></div>
        </div>
      )}

      <div className="wa-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {WHATSAPP_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select value={pod} onChange={(e) => setPod(e.target.value)}>
          <option value="">All Pods</option>
          {pods.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      {!rows.length && !busy && (
        <div className="wa-empty">
          <p>No one has opted in yet.</p>
          <p className="wa-fine">
            The checkbox sits at the end of the feedback form on
            feedback.thefetch.in, on both the feedback and the problem-report
            paths.
          </p>
        </div>
      )}

      {!!rows.length && (
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr>
                <th>WhatsApp</th>
                <th>Pod</th>
                <th>Consented</th>
                <th>Status</th>
                <th>Sent</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.optin_id} className={r.status === 'active' ? '' : 'is-off'}>
                  <td>
                    <a href={`https://wa.me/${r.wa_number}`} target="_blank" rel="noreferrer">
                      {fmtNumber(r.wa_number)}
                    </a>
                    {r.display_name && <div className="wa-fine">{r.display_name}</div>}
                  </td>
                  <td>
                    <div>{r.pod_label || r.pod_id}</div>
                    {r.pod_location && <div className="wa-fine">{r.pod_location}</div>}
                  </td>
                  <td>
                    <div>{fmtDate(r.consented_at)}</div>
                    {r.reconfirmed_at && (
                      <div className="wa-fine">re-confirmed {fmtDate(r.reconfirmed_at)}</div>
                    )}
                    <div className="wa-fine wa-consent" title={r.consent_text}>
                      “{r.consent_text}”
                    </div>
                  </td>
                  <td>
                    <span className={`wa-badge wa-badge--${r.status}`}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                    {r.unsubscribed_at && (
                      <div className="wa-fine">{fmtDate(r.unsubscribed_at)}</div>
                    )}
                  </td>
                  <td>
                    {r.send_count || 0}
                    {r.last_sent_at && <div className="wa-fine">{fmtDate(r.last_sent_at)}</div>}
                  </td>
                  <td className="wa-row-actions">
                    {/*
                      Opting someone out is always available. Opting them back
                      IN is not: an opt-out may only be reversed by that person
                      ticking the box again on the form. A re-subscribe button
                      here is the single change that would turn this consent
                      ledger into an ordinary marketing list.

                      'invalid' is different -- it is our note that a number
                      failed to deliver, not their decision -- so clearing it
                      is allowed.
                    */}
                    {r.status === 'active' && (
                      <button
                        type="button" className="abtn abtn--quiet"
                        onClick={() => setRowStatus(r.optin_id, 'unsubscribed')}
                      >
                        Opt out
                      </button>
                    )}
                    {r.status === 'invalid' && (
                      <button
                        type="button" className="abtn abtn--quiet"
                        onClick={() => setRowStatus(r.optin_id, 'active')}
                      >
                        Number is fine
                      </button>
                    )}
                    {r.status === 'unsubscribed' && (
                      <span className="wa-fine">They must re-opt-in themselves</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
