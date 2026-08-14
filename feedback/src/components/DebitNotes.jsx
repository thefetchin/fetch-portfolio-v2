import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ISSUER,
  DEBIT_NOTE_REASONS,
  GST_RATES,
  UOM_OPTIONS,
  DN_LIMITS,
  GSTIN_RE,
} from '../../shared/constants.js'
import { printDebitNote } from './debitNotePrint.js'
import './DebitNotes.css'

/**
 * Raise debit notes on suppliers for defective, short or wrongly supplied
 * goods.
 *
 * Totals are previewed here for immediate feedback, but the Worker recomputes
 * every figure from the raw quantities and rates before saving. The server's
 * numbers are what get stored and printed — this preview is never trusted.
 */

const blankLine = () => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  hsn: '',
  qty: '',
  uom: 'pcs',
  rate: '',
  gstBps: 0,
})

const rupees = (paise) =>
  (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Mirrors worker/invoicing.js. Preview only — the server is authoritative. */
function previewTotals(lines, interstate) {
  let taxable = 0
  let cgst = 0
  let sgst = 0
  let igst = 0

  for (const l of lines) {
    const qtyMilli = Math.round((Number.parseFloat(l.qty) || 0) * 1000)
    const ratePaise = Math.round((Number.parseFloat(l.rate) || 0) * 100)
    if (qtyMilli <= 0 || ratePaise < 0) continue
    const t = Math.round((qtyMilli * ratePaise) / 1000)
    const tax = Math.round((t * (Number(l.gstBps) || 0)) / 10000)
    taxable += t
    if (interstate) igst += tax
    else {
      const c = Math.floor(tax / 2)
      cgst += c
      sgst += tax - c
    }
  }
  const gross = taxable + cgst + sgst + igst
  const total = Math.round(gross / 100) * 100
  return { taxable, cgst, sgst, igst, roundOff: total - gross, total }
}

export default function DebitNotes() {
  const [notes, setNotes] = useState(null)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [supplierName, setSupplierName] = useState('')
  const [supplierGstin, setSupplierGstin] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [reason, setReason] = useState('damaged')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [noteText, setNoteText] = useState('')
  const [lines, setLines] = useState([blankLine()])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/debit-notes')
      if (!res.ok) { setError('Could not load debit notes.'); return }
      const data = await res.json()
      setNotes(data.notes || [])
      setStats(data.stats || null)
    } catch {
      setError('Could not reach the server.')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const gstinClean = supplierGstin.trim().toUpperCase()
  const gstinValid = gstinClean === '' || GSTIN_RE.test(gstinClean)
  const interstate = gstinValid && gstinClean !== '' &&
    gstinClean.slice(0, 2) !== ISSUER.stateCode

  const totals = useMemo(() => previewTotals(lines, interstate), [lines, interstate])

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const reset = () => {
    setSupplierName(''); setSupplierGstin(''); setSupplierAddress('')
    setReason('damaged'); setInvoiceRef(''); setInvoiceDate(''); setNoteText('')
    setLines([blankLine()])
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null); setNotice(null); setBusy(true)
    try {
      const res = await fetch('/api/admin/debit-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          supplierName, supplierGstin: gstinClean, supplierAddress,
          reason, invoiceRef, invoiceDate, notes: noteText,
          lines: lines.map(({ description, hsn, qty, uom, rate, gstBps }) => ({
            description, hsn, qty, uom, rate, gstBps,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Could not raise the debit note.')
      } else {
        setNotice(`${data.noteNumber} raised.`)
        reset()
        setShowForm(false)
        await load()
        openPrint(data.id)
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  /** Fetches the stored note — server figures, not the preview — and prints. */
  const openPrint = async (id) => {
    try {
      const res = await fetch(`/api/admin/debit-notes/${id}`)
      if (!res.ok) { setError('Could not open that debit note.'); return }
      const { note, lines: noteLines } = await res.json()
      printDebitNote(note, noteLines)
    } catch {
      setError('Could not open that debit note.')
    }
  }

  const setStatus = async (id, status) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, status } : n)))
    await fetch(`/api/admin/debit-notes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    load()
  }

  return (
    <section className="dn">
      {stats && (
        <div className="dn-stats">
          <div className="dn-stat">
            <span>{stats.total ?? 0}</span><label>Notes raised</label>
          </div>
          <div className="dn-stat">
            <span>{stats.open_count ?? 0}</span><label>Open</label>
          </div>
          <div className="dn-stat dn-stat-warn">
            <span>₹{rupees(stats.open_paise ?? 0)}</span><label>Outstanding</label>
          </div>
          <div className="dn-stat">
            <span>₹{rupees(stats.settled_paise ?? 0)}</span><label>Settled</label>
          </div>
        </div>
      )}

      {error && <div className="dn-error" role="alert">{error}</div>}
      {notice && <div className="dn-notice" role="status">{notice}</div>}

      {!showForm && (
        <button type="button" className="dn-primary" onClick={() => setShowForm(true)}>
          + Raise a debit note
        </button>
      )}

      {showForm && (
        <form className="dn-form" onSubmit={submit}>
          <div className="dn-form-head">
            <h2>New debit note</h2>
            <button type="button" className="dn-x" onClick={() => setShowForm(false)}>×</button>
          </div>

          <fieldset className="dn-fieldset">
            <legend>Supplier</legend>
            <div className="dn-grid">
              <label className="dn-field">
                <span>Supplier name <em>required</em></span>
                <input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  maxLength={DN_LIMITS.supplierName}
                  placeholder="Acme Foods Pvt Ltd"
                  required
                />
              </label>
              <label className="dn-field">
                <span>Supplier GSTIN</span>
                <input
                  value={supplierGstin}
                  onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                  maxLength={15}
                  placeholder="29ABBCA9450H1ZH"
                  className={gstinValid ? '' : 'is-bad'}
                />
                {!gstinValid && <small className="dn-bad">Doesn't look like a valid GSTIN</small>}
                {gstinValid && gstinClean !== '' && (
                  <small className="dn-hint">
                    {interstate
                      ? `Inter-state supply → IGST (state ${gstinClean.slice(0, 2)})`
                      : `Intra-state supply → CGST + SGST (state ${gstinClean.slice(0, 2)})`}
                  </small>
                )}
              </label>
              <label className="dn-field dn-span2">
                <span>Supplier address</span>
                <input
                  value={supplierAddress}
                  onChange={(e) => setSupplierAddress(e.target.value)}
                  maxLength={DN_LIMITS.supplierAddress}
                  placeholder="Street, city, state, PIN"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="dn-fieldset">
            <legend>Reference</legend>
            <div className="dn-grid">
              <label className="dn-field">
                <span>Reason <em>required</em></span>
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {DEBIT_NOTE_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label className="dn-field">
                <span>Their invoice no.</span>
                <input
                  value={invoiceRef}
                  onChange={(e) => setInvoiceRef(e.target.value)}
                  maxLength={DN_LIMITS.invoiceRef}
                  placeholder="INV-2026-0912"
                />
              </label>
              <label className="dn-field">
                <span>Invoice date</span>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset className="dn-fieldset">
            <legend>Items being debited</legend>

            <div className="dn-lines">
              <div className="dn-line dn-line-head">
                <span>Description</span>
                <span>HSN</span>
                <span>Qty</span>
                <span>UOM</span>
                <span>Rate ₹</span>
                <span>GST</span>
                <span className="dn-num">Amount</span>
                <span />
              </div>

              {lines.map((l) => {
                const qtyMilli = Math.round((Number.parseFloat(l.qty) || 0) * 1000)
                const ratePaise = Math.round((Number.parseFloat(l.rate) || 0) * 100)
                const amount = Math.round((qtyMilli * ratePaise) / 1000)
                return (
                  <div className="dn-line" key={l.key}>
                    <input
                      value={l.description}
                      onChange={(e) => setLine(l.key, { description: e.target.value })}
                      maxLength={DN_LIMITS.description}
                      placeholder="Mango juice 250ml — leaking packs"
                    />
                    <input
                      value={l.hsn}
                      onChange={(e) => setLine(l.key, { hsn: e.target.value })}
                      maxLength={8}
                      placeholder="2202"
                      inputMode="numeric"
                    />
                    <input
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      inputMode="decimal"
                      placeholder="12"
                    />
                    <select value={l.uom} onChange={(e) => setLine(l.key, { uom: e.target.value })}>
                      {UOM_OPTIONS.map((u) => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                    <input
                      value={l.rate}
                      onChange={(e) => setLine(l.key, { rate: e.target.value })}
                      inputMode="decimal"
                      placeholder="25.50"
                    />
                    <select
                      value={l.gstBps}
                      onChange={(e) => setLine(l.key, { gstBps: Number(e.target.value) })}
                    >
                      {GST_RATES.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                    <span className="dn-num dn-amount">₹{rupees(amount)}</span>
                    <button
                      type="button"
                      className="dn-x dn-x-line"
                      onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                      aria-label="Remove line"
                      disabled={lines.length === 1}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              className="dn-add"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
              disabled={lines.length >= DN_LIMITS.maxLines}
            >
              + Add line
            </button>
          </fieldset>

          <label className="dn-field">
            <span>Notes on the document</span>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              maxLength={DN_LIMITS.notes}
              rows={2}
              placeholder="Batch B-2291 delivered 09 Aug; 12 packs leaking on arrival, photos shared on WhatsApp."
            />
          </label>

          <div className="dn-totals">
            <div><span>Taxable value</span><strong>₹{rupees(totals.taxable)}</strong></div>
            {interstate ? (
              <div><span>IGST</span><strong>₹{rupees(totals.igst)}</strong></div>
            ) : (
              <>
                <div><span>CGST</span><strong>₹{rupees(totals.cgst)}</strong></div>
                <div><span>SGST</span><strong>₹{rupees(totals.sgst)}</strong></div>
              </>
            )}
            {totals.roundOff !== 0 && (
              <div><span>Round off</span><strong>₹{rupees(totals.roundOff)}</strong></div>
            )}
            <div className="dn-grand"><span>Total debited</span><strong>₹{rupees(totals.total)}</strong></div>
          </div>

          <div className="dn-actions">
            <button type="button" className="dn-ghost" onClick={() => { reset(); setShowForm(false) }}>
              Cancel
            </button>
            <button type="submit" className="dn-primary" disabled={busy || !gstinValid}>
              {busy ? 'Raising…' : 'Raise & print debit note'}
            </button>
          </div>
        </form>
      )}

      <div className="dn-list-head">
        <h2>Debit notes</h2>
        <span>{notes ? `${notes.length} raised` : ''}</span>
      </div>

      {!notes && <p className="dn-empty">Loading…</p>}
      {notes?.length === 0 && <p className="dn-empty">No debit notes yet.</p>}

      {notes?.length > 0 && (
        <div className="dn-table-wrap">
          <table className="dn-table">
            <thead>
              <tr>
                <th>Number</th><th>Date</th><th>Supplier</th><th>Reason</th>
                <th className="dn-num">Total</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr key={n.id} className={n.status === 'cancelled' ? 'is-cancelled' : ''}>
                  <td className="dn-mono">{n.note_number}</td>
                  <td className="dn-nowrap">{n.note_date}</td>
                  <td>
                    {n.supplier_name}
                    {n.supplier_gstin && <div className="dn-sub">{n.supplier_gstin}</div>}
                  </td>
                  <td>
                    {DEBIT_NOTE_REASONS.find((r) => r.value === n.reason)?.label || n.reason}
                    {n.invoice_ref && <div className="dn-sub">vs {n.invoice_ref}</div>}
                  </td>
                  <td className="dn-num dn-mono">₹{rupees(n.total_paise)}</td>
                  <td>
                    <select
                      className={`dn-status dn-status-${n.status}`}
                      value={n.status}
                      onChange={(e) => setStatus(n.id, e.target.value)}
                    >
                      <option value="issued">issued</option>
                      <option value="settled">settled</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" className="dn-link" onClick={() => openPrint(n.id)}>
                      Print
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
