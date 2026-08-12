import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ISSUE_TYPES,
  PRODUCT_CATEGORIES,
  PRICE_FEEL,
  USAGE_FREQ,
  OCCURRED_WHEN,
  SUBMISSION_STATUSES,
} from '../../shared/constants.js'
import './Admin.css'

const labelMap = (options) =>
  Object.fromEntries(options.map((o) => [o.value, o.label]))

const ISSUE_LABELS    = labelMap(ISSUE_TYPES)
const CATEGORY_LABELS = labelMap(PRODUCT_CATEGORIES)
const PRICE_LABELS    = labelMap(PRICE_FEEL)
const USAGE_LABELS    = labelMap(USAGE_FREQ)
const WHEN_LABELS     = labelMap(OCCURRED_WHEN)

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

const rupees = (paise) =>
  paise == null ? null : `₹${(paise / 100).toLocaleString('en-IN')}`

function Row({ row, onStatus }) {
  const [open, setOpen] = useState(false)
  const wanted = row.wanted_categories ? JSON.parse(row.wanted_categories) : []

  return (
    <>
      <tr
        className={`admin-row ${row.status === 'new' ? 'is-new' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <td>
          <span className={`pill pill-${row.kind}`}>
            {row.kind === 'complaint' ? 'Problem' : 'Feedback'}
          </span>
        </td>
        <td className="cell-summary">
          {row.kind === 'complaint' ? (
            <>
              <strong>{ISSUE_LABELS[row.issue_type] || '—'}</strong>
              {row.refund_requested === 1 && <span className="tag tag-refund">refund</span>}
            </>
          ) : (
            <>
              <strong>{'★'.repeat(row.rating || 0)}</strong>
              {wanted.length > 0 && (
                <span className="muted">
                  {' '}wants {wanted.map((w) => CATEGORY_LABELS[w] || w).join(', ')}
                </span>
              )}
            </>
          )}
          {row.comment && <div className="cell-comment">{row.comment}</div>}
        </td>
        <td className="cell-pod">{row.pod_label || row.pod_id}</td>
        <td className="cell-date">{fmtDate(row.created_at)}</td>
        <td>
          <select
            className={`status status-${row.status}`}
            value={row.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onStatus(row.id, e.target.value)}
          >
            {SUBMISSION_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </td>
      </tr>

      {open && (
        <tr className="detail-row">
          <td colSpan={5}>
            <dl className="detail">
              <div><dt>Pod</dt><dd>{row.pod_id}{row.pod_location ? ` · ${row.pod_location}` : ''}</dd></div>
              {row.occurred_when && <div><dt>When</dt><dd>{WHEN_LABELS[row.occurred_when]}</dd></div>}
              {row.product_category && <div><dt>Product</dt><dd>{CATEGORY_LABELS[row.product_category]}</dd></div>}
              {row.product_text && <div><dt>Item</dt><dd>{row.product_text}</dd></div>}
              {row.amount_paise != null && <div><dt>Amount</dt><dd>{rupees(row.amount_paise)}</dd></div>}
              {row.payment_ref && <div><dt>Payment ref</dt><dd><code>{row.payment_ref}</code></dd></div>}
              {row.wanted_text && <div><dt>Asked for</dt><dd>{row.wanted_text}</dd></div>}
              {row.price_feel && <div><dt>Pricing</dt><dd>{PRICE_LABELS[row.price_feel]}</dd></div>}
              {row.usage_freq && <div><dt>Uses Pod</dt><dd>{USAGE_LABELS[row.usage_freq]}</dd></div>}
              {row.contact_email && <div><dt>Email</dt><dd><a href={`mailto:${row.contact_email}`}>{row.contact_email}</a></dd></div>}
              {row.contact_phone && <div><dt>Phone</dt><dd><a href={`tel:${row.contact_phone}`}>{row.contact_phone}</a></dd></div>}
              {row.notify_opt_in === 1 && <div><dt>Opt-in</dt><dd>Wants restock notification</dd></div>}
              <div><dt>Country</dt><dd>{row.country || '—'}</dd></div>
              <div><dt>ID</dt><dd><code>{row.id}</code></dd></div>
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

export default function Admin() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams()
    if (kind) params.set('kind', kind)
    if (status) params.set('status', status)

    try {
      const res = await fetch(`/api/admin/submissions?${params}`)
      if (res.status === 401) {
        setError('Not authorised. Sign in through Cloudflare Access to view this page.')
        return
      }
      if (!res.ok) {
        setError('Could not load submissions.')
        return
      }
      setData(await res.json())
    } catch {
      setError('Could not reach the server.')
    }
  }, [kind, status])

  useEffect(() => { load() }, [load])

  const updateStatus = async (id, next) => {
    // optimistic
    setData((d) => ({
      ...d,
      submissions: d.submissions.map((s) => (s.id === id ? { ...s, status: next } : s)),
    }))
    await fetch(`/api/admin/submissions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
  }

  const exportCsv = () => {
    if (!data?.submissions?.length) return
    const cols = Object.keys(data.submissions[0])
    const escape = (v) =>
      v == null ? '' : `"${String(v).replace(/"/g, '""')}"`
    const csv = [
      cols.join(','),
      ...data.submissions.map((r) => cols.map((c) => escape(r[c])).join(',')),
    ].join('\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `fetch-feedback-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stats = data?.stats
  const rows = useMemo(() => data?.submissions || [], [data])

  return (
    <main className="admin">
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">Fetch</span>
          <h1>Feedback &amp; complaints</h1>
        </div>
        <div className="admin-actions">
          <button type="button" className="abtn" onClick={load}>Refresh</button>
          <button type="button" className="abtn" onClick={exportCsv}>Export CSV</button>
        </div>
      </header>

      {error && <div className="admin-error">{error}</div>}

      {stats && (
        <div className="stats">
          <div className="stat"><span>{stats.total ?? 0}</span><label>Total</label></div>
          <div className="stat"><span>{stats.unread ?? 0}</span><label>New</label></div>
          <div className="stat"><span>{stats.complaints ?? 0}</span><label>Problems</label></div>
          <div className="stat"><span>{stats.feedback ?? 0}</span><label>Feedback</label></div>
          <div className="stat stat-warn"><span>{stats.refunds_open ?? 0}</span><label>Refunds open</label></div>
          <div className="stat"><span>{stats.avg_rating ?? '—'}</span><label>Avg rating</label></div>
        </div>
      )}

      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          <option value="complaint">Problems</option>
          <option value="feedback">Feedback</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Summary</th>
              <th>Pod</th>
              <th>When</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.id} row={row} onStatus={updateStatus} />
            ))}
            {!rows.length && !error && (
              <tr><td colSpan={5} className="empty">
                {data ? 'Nothing here yet.' : 'Loading…'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="admin-foot">
        Tap any row for full details. Data stays in Cloudflare D1 — nothing is
        emailed anywhere.
      </p>
    </main>
  )
}
