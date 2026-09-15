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

export default function Whatsapp() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
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
