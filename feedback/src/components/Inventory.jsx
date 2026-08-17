import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GST_RATES,
  PRODUCT_CATEGORIES,
  UOM_OPTIONS,
  WAREHOUSE_ZONES,
  WRITEOFF_REASONS,
} from '../../shared/constants.js'
import BarcodeInput from './BarcodeInput'
import { printBatchStickers } from './batchStickerPrint.js'
import { printRunSheet, printReturnBagLabel } from './runSheetPrint.js'
import './Inventory.css'

/**
 * Inventory: what we have, what came in, and what goes out.
 *
 * This is the inventory manager's surface. Refillers never see it -- they get a
 * printed run sheet and read-only alerts in the machine app they already use.
 *
 * Quantities are shown in whole units but sent as typed; the Worker converts to
 * integer thousandths. Money is always paise on the wire.
 */

const rupees = (paise) =>
  paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const units = (milli) => {
  if (milli == null) return '—'
  const n = milli / 1000
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Expiry urgency, used for the colour bands. */
const band = (days, expired) => {
  if (expired) return 'exp'
  if (days == null) return ''
  if (days <= 7) return 'd7'
  if (days <= 30) return 'd30'
  return ''
}

const today = () => new Date().toISOString().slice(0, 10)

/* --------------------------------------------------------------- plumbing -- */

/**
 * Every mutating call carries an Idempotency-Key. The Worker requires it, and
 * generating it per click rather than per attempt is the point: a double-tap or
 * a retry reuses the same key and cannot book the same stock twice.
 */
async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers['Idempotency-Key'] = key || crypto.randomUUID()

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong.')
    err.code = data.error
    err.errors = data.errors
    err.status = res.status
    throw err
  }
  return data
}

const SUBVIEWS = [
  { key: 'stock',   label: 'Stock' },
  { key: 'inward',  label: 'Receive' },
  { key: 'putaway', label: 'Put away' },
  { key: 'runs',    label: 'Runs' },
  { key: 'expiry',  label: 'Expiry' },
  { key: 'masters', label: 'Products & suppliers' },
  { key: 'catalogue', label: 'Import from VLite' },
]

export default function Inventory() {
  const [view, setView] = useState('stock')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [pods, setPods] = useState([])
  const [stock, setStock] = useState(null)

  const say = (msg) => { setNotice(msg); setError(null) }
  const oops = (e) => {
    setError(e?.errors?.length > 1 ? e.errors.join(' · ') : (e?.message || 'Something went wrong.'))
    setNotice(null)
  }

  const loadRefs = useCallback(async () => {
    try {
      const [p, s, pod] = await Promise.all([
        api('/api/inv/products'),
        api('/api/inv/suppliers'),
        api('/api/admin/pods'),
      ])
      setProducts(p.products || [])
      setSuppliers(s.suppliers || [])
      setPods((pod.pods || []).filter((x) => x.active))
    } catch (e) { oops(e) }
  }, [])

  const loadStock = useCallback(async () => {
    try { setStock(await api('/api/inv/stock')) } catch (e) { oops(e) }
  }, [])

  useEffect(() => { loadRefs(); loadStock() }, [loadRefs, loadStock])

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { oops(e) } finally { setBusy(false) }
  }

  const shared = {
    products, suppliers, pods, stock,
    loadRefs, loadStock, run, say, oops, busy, setView,
  }

  return (
    <section className="inv">
      <div className="inv-subtabs" role="tablist">
        {SUBVIEWS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={view === s.key}
            className={`inv-subtab ${view === s.key ? 'is-active' : ''}`}
            onClick={() => { setView(s.key); setError(null); setNotice(null) }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error &&  <div className="inv-error"  role="alert">{error}</div>}
      {notice && <div className="inv-notice" role="status">{notice}</div>}

      {view === 'stock'   && <StockView {...shared} />}
      {view === 'inward'  && <InwardView {...shared} />}
      {view === 'putaway' && <PutawayView {...shared} />}
      {view === 'runs'    && <RunsView {...shared} />}
      {view === 'expiry'  && <ExpiryView {...shared} />}
      {view === 'masters' && <MastersView {...shared} />}
      {view === 'catalogue' && <CatalogueView {...shared} />}
    </section>
  )
}

/* ============================================================== stock ===== */

function StockView({ stock, loadStock, run, say, busy }) {
  const [woFor, setWoFor] = useState(null)

  if (!stock) return <p className="inv-empty">Loading stock…</p>

  const zoneLabel = (id) =>
    WAREHOUSE_ZONES.find((z) => z.value === id)?.label
    || stock.zones.find((z) => z.locationId === id)?.label
    || id

  return (
    <>
      <div className="inv-stats">
        {stock.zones.map((z) => (
          <div className="inv-stat" key={z.locationId}>
            <span>{units(z.qtyMilli)}</span>
            <label>{zoneLabel(z.locationId)}</label>
            <em>{rupees(z.valuePaise)}</em>
          </div>
        ))}
        <div className="inv-stat inv-stat-total">
          <span>{rupees(stock.totalValuePaise)}</span>
          <label>Stock at cost</label>
        </div>
      </div>

      <div className="inv-list-head">
        <h3>Stock on hand</h3>
        <button type="button" className="inv-ghost" onClick={loadStock}>Refresh</button>
      </div>

      {!stock.items.length && <p className="inv-empty">No stock yet. Receive a supplier bill to get started.</p>}

      {!!stock.items.length && (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Product</th><th>Batch</th><th>Where</th>
                <th className="inv-num">Qty</th><th>Expiry</th>
                <th className="inv-num">Value</th><th></th>
              </tr>
            </thead>
            <tbody>
              {stock.items.map((i) => (
                <tr key={`${i.batchId}-${i.locationId}`} className={i.expired ? 'is-expired' : ''}>
                  <td>{i.productName}{i.quarantined && <span className="inv-tag">quarantined</span>}</td>
                  <td className="inv-mono">{i.batchCode}</td>
                  <td className="inv-nowrap">{zoneLabel(i.locationId)}</td>
                  <td className="inv-num">{units(i.qtyMilli)} {i.uom}</td>
                  <td className={`inv-nowrap inv-${band(i.daysToExpiry, i.expired)}`}>
                    {fmtDate(i.expiryDate)}
                    {i.daysToExpiry != null && (
                      <small>{i.expired ? 'expired' : `${i.daysToExpiry}d`}</small>
                    )}
                  </td>
                  <td className="inv-num">{rupees(i.valuePaise)}</td>
                  <td>
                    <button type="button" className="inv-link" onClick={() => setWoFor(i)}>Write off</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {woFor && (
        <WriteOffForm
          item={woFor}
          onClose={() => setWoFor(null)}
          onDone={async (msg) => { setWoFor(null); say(msg); await loadStock() }}
          run={run}
          busy={busy}
        />
      )}
    </>
  )
}

function WriteOffForm({ item, onClose, onDone, run, busy }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(item.expired ? 'expired' : 'damaged')
  const [notes, setNotes] = useState('')
  const [claim, setClaim] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const r = await api('/api/inv/write-offs', {
        method: 'POST',
        body: {
          batchId: item.batchId, locationId: item.locationId,
          qty, reason, notes, supplierClaim: claim,
        },
      })
      await onDone(`${r.woNumber} — ${units(item.qtyMilli && qty * 1000)} written off, ${rupees(r.valuePaise)}.`)
    })
  }

  return (
    <form className="inv-form inv-form-inline" onSubmit={submit}>
      <div className="inv-form-head">
        <h3>Write off {item.batchCode} — {item.productName}</h3>
        <button type="button" className="inv-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="inv-grid">
        <label className="inv-field">
          <span>How many <em>of {units(item.qtyMilli)} {item.uom}</em></span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" required />
        </label>
        <label className="inv-field">
          <span>Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {WRITEOFF_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="inv-field inv-span2">
          <span>Notes {reason === 'other' && <em>required</em>}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="inv-check inv-span2">
          <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} />
          <span>The supplier is at fault — flag this for a debit note</span>
        </label>
      </div>
      <div className="inv-actions">
        <button type="button" className="inv-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="inv-primary" disabled={busy}>
          {busy ? 'Writing off…' : 'Write off'}
        </button>
      </div>
    </form>
  )
}

/* ============================================================= inward ===== */

const blankBillLine = () => ({
  key: Math.random().toString(36).slice(2),
  productId: '', qty: '', freeQty: '', rate: '', gstBps: 1200,
  expiryDate: '', mfgDate: '', supplierBatchNo: '', mrp: '',
})

function InwardView({ products, suppliers, loadRefs, loadStock, run, say, busy, setView }) {
  const [supplierId, setSupplierId] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(today())
  const [freight, setFreight] = useState('')
  const [itc, setItc] = useState(true)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([blankBillLine()])
  const [bills, setBills] = useState(null)
  const [lastBatches, setLastBatches] = useState(null)

  const loadBills = useCallback(async () => {
    try { setBills((await api('/api/inv/purchase-bills')).bills || []) } catch { /* surfaced elsewhere */ }
  }, [])
  useEffect(() => { loadBills() }, [loadBills])

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const productOf = (id) => products.find((p) => p.id === id)

  /**
   * When a product is chosen, default the expiry from its shelf life. Typing a
   * date by hand is the single highest-risk keystroke in the whole system, so
   * the common case should need no typing at all.
   */
  const chooseProduct = (key, productId) => {
    const p = productOf(productId)
    const patch = { productId }
    if (p?.gstBps != null) patch.gstBps = p.gstBps
    if (p?.mrpPaise != null) patch.mrp = String(p.mrpPaise / 100)
    if (p?.shelfLifeDays) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() + p.shelfLifeDays)
      patch.expiryDate = d.toISOString().slice(0, 10)
    }
    setLine(key, patch)
  }

  const preview = useMemo(() => {
    let taxable = 0
    let tax = 0
    for (const l of lines) {
      const q = Math.round((Number.parseFloat(l.qty) || 0) * 1000)
      const r = Math.round((Number.parseFloat(l.rate) || 0) * 100)
      if (q <= 0 || r < 0) continue
      const t = Math.round((q * r) / 1000)
      taxable += t
      tax += Math.round((t * (Number(l.gstBps) || 0)) / 10000)
    }
    const fr = Math.round((Number.parseFloat(freight) || 0) * 100)
    const gross = taxable + tax
    return { taxable, tax, freight: fr, total: Math.round(gross / 100) * 100 + fr }
  }, [lines, freight])

  const reset = () => {
    setBillNo(''); setFreight(''); setNotes(''); setLines([blankBillLine()])
  }

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const r = await api('/api/inv/purchase-bills', {
        method: 'POST',
        body: {
          supplierId, supplierBillNo: billNo, billDate, freight, itcEligible: itc, notes,
          lines: lines.map((l) => ({
            productId: l.productId, qty: l.qty, freeQty: l.freeQty, rate: l.rate,
            gstBps: l.gstBps, expiryDate: l.expiryDate, mfgDate: l.mfgDate,
            supplierBatchNo: l.supplierBatchNo, mrp: l.mrp,
          })),
        },
      })
      setLastBatches(r.batches.map((b) => ({
        ...b,
        productName: productOf(b.productId)?.name || 'Item',
        uom: productOf(b.productId)?.uom || 'pcs',
      })))
      say(`${r.grnNumber} booked — ${rupees(r.totalPaise)}. ${r.batches.length} batch${r.batches.length === 1 ? '' : 'es'} created in Receiving.`)
      reset()
      await Promise.all([loadBills(), loadStock()])
    })
  }

  return (
    <>
      {lastBatches && (
        <div className="inv-callout">
          <div>
            <strong>Print the stickers now</strong>
            <p>
              One per container, not per unit. Stick them on before the cartons are
              opened — after that the batch is only identifiable by the sticker.
            </p>
          </div>
          <div className="inv-callout-actions">
            <button type="button" className="inv-primary"
              onClick={() => printBatchStickers(lastBatches.map((b) => ({
                batchCode: b.code, productName: b.productName, expiryDate: b.expiryDate,
                mrpPaise: b.mrpPaise ?? null, qtyMilli: b.qtyMilli, uom: b.uom, copies: 1,
              })), { layout: 'a4' })}>
              A4 sheet
            </button>
            <button type="button" className="inv-ghost"
              onClick={() => printBatchStickers(lastBatches.map((b) => ({
                batchCode: b.code, productName: b.productName, expiryDate: b.expiryDate,
                mrpPaise: b.mrpPaise ?? null, qtyMilli: b.qtyMilli, uom: b.uom, copies: 1,
              })), { layout: 'thermal' })}>
              Thermal roll
            </button>
            <button type="button" className="inv-ghost" onClick={() => setView('putaway')}>
              Put away →
            </button>
            <button type="button" className="inv-x" onClick={() => setLastBatches(null)} aria-label="Dismiss">×</button>
          </div>
        </div>
      )}

      <form className="inv-form" onSubmit={submit}>
        <div className="inv-form-head"><h3>Receive a supplier bill</h3></div>

        <fieldset className="inv-fieldset">
          <legend>The bill</legend>
          <div className="inv-grid">
            <label className="inv-field">
              <span>Supplier <em>required</em></span>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Choose…</option>
                {suppliers.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="inv-field">
              <span>Their bill number <em>required</em></span>
              <input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="MNG/2526/1188" required />
            </label>
            <label className="inv-field">
              <span>Bill date</span>
              <input type="date" value={billDate} max={today()} onChange={(e) => setBillDate(e.target.value)} required />
            </label>
            <label className="inv-field">
              <span>Freight &amp; other charges ₹</span>
              <input value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" placeholder="0" />
            </label>
            <label className="inv-check inv-span2">
              <input type="checkbox" checked={itc} onChange={(e) => setItc(e.target.checked)} />
              <span>
                Input tax credit available
                <em>Untick for a composition-scheme or unregistered supplier — the GST then becomes part of the stock cost.</em>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="inv-fieldset">
          <legend>What arrived</legend>

          <BarcodeInput
            label="Scan a pack to add a line"
            hint="Scan the manufacturer's barcode and the product is filled in for you. A USB scanner works straight into this box."
            onProduct={(product) => {
              // Fill the first blank line rather than always appending, so a
              // scan straight after opening the form does the obvious thing.
              setLines((ls) => {
                const blank = ls.find((l) => !l.productId)
                const target = blank || blankBillLine()
                const p = products.find((x) => x.id === product.id)
                const patch = { productId: product.id }
                if (p?.gstBps != null) patch.gstBps = p.gstBps
                if (p?.mrpPaise != null) patch.mrp = String(p.mrpPaise / 100)
                if (p?.shelfLifeDays) {
                  const d = new Date()
                  d.setUTCDate(d.getUTCDate() + p.shelfLifeDays)
                  patch.expiryDate = d.toISOString().slice(0, 10)
                }
                const filled = { ...target, ...patch }
                return blank ? ls.map((l) => (l.key === blank.key ? filled : l)) : [...ls, filled]
              })
            }}
          />

          <div className="inv-lines">
            <div className="inv-line inv-line-head">
              <span>Product</span><span>Qty</span><span>Free</span><span>Rate ₹</span>
              <span>GST</span><span>Expiry</span><span>Their batch</span><span></span>
            </div>
            {lines.map((l) => (
              <div className="inv-line" key={l.key}>
                <select value={l.productId} onChange={(e) => chooseProduct(l.key, e.target.value)} required>
                  <option value="">Choose a product…</option>
                  {products.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input className="inv-numin" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} inputMode="decimal" placeholder="240" required />
                <input className="inv-numin" value={l.freeQty} onChange={(e) => setLine(l.key, { freeQty: e.target.value })} inputMode="decimal" placeholder="0" />
                <input className="inv-numin" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} inputMode="decimal" placeholder="14.20" required />
                <select value={l.gstBps} onChange={(e) => setLine(l.key, { gstBps: Number(e.target.value) })}>
                  {GST_RATES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
                <input type="date" value={l.expiryDate} onChange={(e) => setLine(l.key, { expiryDate: e.target.value })} required />
                <input value={l.supplierBatchNo} onChange={(e) => setLine(l.key, { supplierBatchNo: e.target.value })} placeholder="L2291" />
                <button type="button" className="inv-x" disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line">×</button>
              </div>
            ))}
          </div>
          <button type="button" className="inv-add" onClick={() => setLines((ls) => [...ls, blankBillLine()])}>
            + Add line
          </button>
          <p className="inv-hint">
            Every line needs an expiry date — no expiry, no batch. It defaults from the
            product’s shelf life, so check it against the pack rather than typing it.
          </p>
        </fieldset>

        <label className="inv-field inv-span2">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="inv-totals">
          <div><span>Taxable</span><strong>{rupees(preview.taxable)}</strong></div>
          <div><span>GST</span><strong>{rupees(preview.tax)}</strong></div>
          {!!preview.freight && <div><span>Freight</span><strong>{rupees(preview.freight)}</strong></div>}
          <div className="inv-grand"><span>Total</span><strong>{rupees(preview.total)}</strong></div>
        </div>

        <div className="inv-actions">
          <button type="submit" className="inv-primary" disabled={busy || !supplierId}>
            {busy ? 'Booking…' : 'Book the bill'}
          </button>
        </div>
      </form>

      <div className="inv-list-head"><h3>Recent bills</h3></div>
      {!bills && <p className="inv-empty">Loading…</p>}
      {bills?.length === 0 && <p className="inv-empty">No bills booked yet.</p>}
      {!!bills?.length && (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>GRN</th><th>Supplier</th><th>Their bill</th><th>Date</th><th className="inv-num">Lines</th><th className="inv-num">Total</th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="inv-mono">{b.grnNumber}</td>
                  <td>{b.supplierName}</td>
                  <td>{b.supplierBillNo}</td>
                  <td className="inv-nowrap">{fmtDate(b.billDate)}</td>
                  <td className="inv-num">{b.lineCount}</td>
                  <td className="inv-num">{rupees(b.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ============================================================ putaway ===== */

function PutawayView({ stock, loadStock, run, say, busy }) {
  const [zone, setZone] = useState('WH-MLR/MAIN')
  const [picked, setPicked] = useState({})

  const inRecv = (stock?.items || []).filter((i) => i.locationId === 'WH-MLR/RECV')

  const toggle = (i, on) =>
    setPicked((p) => {
      const next = { ...p }
      if (on) next[i.batchId] = units(i.qtyMilli)
      else delete next[i.batchId]
      return next
    })

  const submit = (e) => {
    e.preventDefault()
    const lines = Object.entries(picked).map(([batchId, qty]) => ({ batchId, qty }))
    if (!lines.length) return
    run(async () => {
      await api('/api/inv/putaway', { method: 'POST', body: { toZone: zone, lines } })
      say(`${lines.length} batch${lines.length === 1 ? '' : 'es'} moved to ${WAREHOUSE_ZONES.find((z) => z.value === zone)?.label}.`)
      setPicked({})
      await loadStock()
    })
  }

  return (
    <>
      <div className="inv-list-head">
        <h3>Waiting in Receiving</h3>
        <button type="button" className="inv-ghost" onClick={loadStock}>Refresh</button>
      </div>
      <p className="inv-hint">
        Receiving is not pickable, so nothing here can go to a machine until it is put
        away. That is deliberate: it means someone has taken responsibility for the
        physical stock before it can be promised to anyone.
      </p>

      {!inRecv.length && <p className="inv-empty">Nothing waiting. Receive a bill first.</p>}

      {!!inRecv.length && (
        <form className="inv-form" onSubmit={submit}>
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead><tr><th></th><th>Product</th><th>Batch</th><th>Expiry</th><th className="inv-num">Waiting</th><th className="inv-num">Move</th></tr></thead>
              <tbody>
                {inRecv.map((i) => {
                  const on = picked[i.batchId] !== undefined
                  return (
                    <tr key={i.batchId} className={on ? 'is-picked' : ''}>
                      <td>
                        <input type="checkbox" checked={on} onChange={(e) => toggle(i, e.target.checked)}
                          aria-label={`Put away ${i.batchCode}`} />
                      </td>
                      <td>{i.productName}</td>
                      <td className="inv-mono">{i.batchCode}</td>
                      <td className={`inv-nowrap inv-${band(i.daysToExpiry, i.expired)}`}>{fmtDate(i.expiryDate)}</td>
                      <td className="inv-num">{units(i.qtyMilli)} {i.uom}</td>
                      <td className="inv-num">
                        <input className="inv-numin" value={picked[i.batchId] ?? ''} disabled={!on}
                          onChange={(e) => setPicked((p) => ({ ...p, [i.batchId]: e.target.value }))}
                          inputMode="decimal" aria-label={`Quantity for ${i.batchCode}`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="inv-actions">
            <label className="inv-field">
              <span>Move to</span>
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {WAREHOUSE_ZONES.filter((z) => !['WH-MLR/RECV', 'WH-MLR/STAGE'].includes(z.value))
                  .map((z) => <option key={z.value} value={z.value}>{z.label} — {z.note}</option>)}
              </select>
            </label>
            <button type="submit" className="inv-primary" disabled={busy || !Object.keys(picked).length}>
              {busy ? 'Moving…' : `Put away ${Object.keys(picked).length || ''}`}
            </button>
          </div>
        </form>
      )}
    </>
  )
}

/* =============================================================== runs ===== */

const blankRunLine = () => ({
  key: Math.random().toString(36).slice(2),
  podId: '', slotName: '', vliteSlotId: '', batchId: '', qty: '',
})

function RunsView({ pods, stock, loadStock, run, say, busy }) {
  const [runs, setRuns] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [lines, setLines] = useState([blankRunLine()])
  const [runDate, setRunDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [open, setOpen] = useState(null)

  const loadRuns = useCallback(async () => {
    try { setRuns((await api('/api/inv/runs')).runs || []) } catch { /* surfaced elsewhere */ }
  }, [])
  useEffect(() => { loadRuns() }, [loadRuns])

  // Only stock that can actually be sent out: main storage, not expired, not
  // quarantined. Offering anything else would just invite a refusal.
  const pickable = useMemo(
    () => (stock?.items || [])
      .filter((i) => i.locationId === 'WH-MLR/MAIN' && !i.expired && !i.quarantined)
      .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate))),
    [stock],
  )

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const r = await api('/api/inv/runs', {
        method: 'POST',
        body: {
          runDate, notes,
          lines: lines.map((l) => ({
            podId: l.podId, slotName: l.slotName,
            vliteSlotId: l.vliteSlotId ? Number(l.vliteSlotId) : undefined,
            batchId: l.batchId, qty: l.qty,
          })),
        },
      })
      say(`${r.runNumber} planned — ${r.lines} line${r.lines === 1 ? '' : 's'} in ${r.bags} bag${r.bags === 1 ? '' : 's'}.`)
      setLines([blankRunLine()]); setShowForm(false)
      await loadRuns()
    })
  }

  const act = (id, what) => run(async () => {
    const r = await api(`/api/inv/runs/${id}/${what}`, {
      method: 'POST',
      body: what === 'cancel' ? { reason: 'Cancelled from the dashboard' } : {},
    })
    say(`Run is now ${r.status}.`)
    await Promise.all([loadRuns(), loadStock()])
    if (open?.run?.id === id) setOpen(await api(`/api/inv/runs/${id}`))
  })

  const openRun = (id) => run(async () => setOpen(await api(`/api/inv/runs/${id}`)))

  return (
    <>
      {!showForm && (
        <button type="button" className="inv-primary" onClick={() => setShowForm(true)}>
          + Plan a run
        </button>
      )}

      {showForm && (
        <form className="inv-form" onSubmit={submit}>
          <div className="inv-form-head">
            <h3>Plan a run</h3>
            <button type="button" className="inv-x" onClick={() => setShowForm(false)} aria-label="Close">×</button>
          </div>
          <p className="inv-hint">
            Batches are chosen here, in the warehouse, by whoever can see them. That
            decision is the record — the refiller gets a bag number and a slot, and
            never has to identify a batch in the field. Earliest expiry first.
          </p>

          <div className="inv-grid">
            <label className="inv-field">
              <span>Run date</span>
              <input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} required />
            </label>
            <label className="inv-field">
              <span>Notes</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Morning route" />
            </label>
          </div>

          <div className="inv-lines">
            <div className="inv-line inv-line-run inv-line-head">
              <span>Pod</span><span>Slot</span><span>VLite slot id</span><span>Batch (earliest expiry first)</span><span>Qty</span><span></span>
            </div>
            {lines.map((l) => (
              <div className="inv-line inv-line-run" key={l.key}>
                <select value={l.podId} onChange={(e) => setLine(l.key, { podId: e.target.value })} required>
                  <option value="">Choose…</option>
                  {pods.map((p) => <option key={p.podId} value={p.podId}>{p.label || p.podId}</option>)}
                </select>
                <input value={l.slotName} onChange={(e) => setLine(l.key, { slotName: e.target.value })} placeholder="A3" required />
                <input className="inv-numin" value={l.vliteSlotId} onChange={(e) => setLine(l.key, { vliteSlotId: e.target.value })} placeholder="143108" />
                <select value={l.batchId} onChange={(e) => setLine(l.key, { batchId: e.target.value })} required>
                  <option value="">Choose…</option>
                  {pickable.map((i) => (
                    <option key={i.batchId} value={i.batchId}>
                      {i.productName} · {i.batchCode} · exp {i.expiryDate} · {units(i.qtyMilli)} left
                    </option>
                  ))}
                </select>
                <input className="inv-numin" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} inputMode="decimal" placeholder="24" required />
                <button type="button" className="inv-x" disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line">×</button>
              </div>
            ))}
          </div>
          <button type="button" className="inv-add" onClick={() => setLines((ls) => [...ls, blankRunLine()])}>
            + Add line
          </button>

          <div className="inv-actions">
            <button type="button" className="inv-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="inv-primary" disabled={busy}>
              {busy ? 'Planning…' : 'Plan the run'}
            </button>
          </div>
        </form>
      )}

      <div className="inv-list-head"><h3>Runs</h3></div>
      {!runs && <p className="inv-empty">Loading…</p>}
      {runs?.length === 0 && <p className="inv-empty">No runs yet.</p>}
      {!!runs?.length && (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Run</th><th>Date</th><th>Stops</th><th className="inv-num">Units</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={r.status === 'cancelled' ? 'is-cancelled' : ''}>
                  <td className="inv-mono">{r.runNumber}</td>
                  <td className="inv-nowrap">{fmtDate(r.runDate)}</td>
                  <td>{r.stops}{r.openPulls ? <span className="inv-tag">{r.openPulls} to pull</span> : null}</td>
                  <td className="inv-num">{units(r.plannedMilli)}</td>
                  <td><span className={`inv-pill inv-pill-${r.status}`}>{r.status}</span></td>
                  <td className="inv-rowacts">
                    <button type="button" className="inv-link" onClick={() => openRun(r.id)}>Open</button>
                    {r.status === 'planned' && <button type="button" className="inv-link" onClick={() => act(r.id, 'pick')}>Pick</button>}
                    {r.status === 'picked' && <button type="button" className="inv-link" onClick={() => act(r.id, 'dispatch')}>Dispatch</button>}
                    {['planned', 'picked', 'dispatched'].includes(r.status)
                      && <button type="button" className="inv-link inv-link-danger" onClick={() => act(r.id, 'cancel')}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="inv-form inv-form-inline">
          <div className="inv-form-head">
            <h3>{open.run.runNumber} — {open.run.status}</h3>
            <button type="button" className="inv-x" onClick={() => setOpen(null)} aria-label="Close">×</button>
          </div>

          <div className="inv-actions inv-actions-left">
            <button type="button" className="inv-primary" onClick={() => printRunSheet(open)}>
              Print run sheet
            </button>
            {!!open.pulls.length && (
              <button type="button" className="inv-ghost" onClick={() => printReturnBagLabel(open)}>
                Print red bag label
              </button>
            )}
          </div>

          {!!open.pulls.length && (
            <>
              <h4 className="inv-sub-h">Take out first</h4>
              <ul className="inv-plain">
                {open.pulls.map((p) => (
                  <li key={p.pullId}>
                    <strong>{p.slotName || '—'}</strong> {p.productName} — {units(p.qtyMilli)} {p.uom}
                    <em> ({p.reason.replace(/_/g, ' ')})</em>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4 className="inv-sub-h">Load</h4>
          <ul className="inv-plain">
            {open.load.map((l, i) => (
              <li key={`${l.podId}-${l.slotName}-${i}`}>
                <strong>{l.slotName}</strong> {l.productName} — {units(l.plannedMilli)} {l.uom}
                <em> from bag {l.bagNo} · {l.batchCode} · exp {fmtDate(l.expiryDate)}</em>
              </li>
            ))}
          </ul>

          {!!open.inTransit.length && (
            <>
              <h4 className="inv-sub-h">In the crate right now</h4>
              <ul className="inv-plain">
                {open.inTransit.map((t, i) => (
                  <li key={i}>{t.productName} — {units(t.qtyMilli)} {t.uom} <em>({t.batchCode})</em></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  )
}

/* ============================================================= expiry ===== */

function ExpiryView({ run, oops }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)

  const load = useCallback((d) => {
    api(`/api/inv/reports/expiry?withinDays=${d}`).then(setData).catch(oops)
  }, [oops])
  useEffect(() => { load(days) }, [load, days])

  return (
    <>
      <div className="inv-list-head">
        <h3>Expiring stock</h3>
        <label className="inv-field inv-field-inline">
          <span>Within</span>
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); load(Number(e.target.value)) }}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>

      {!data && <p className="inv-empty">Loading…</p>}

      {data && (
        <>
          <div className="inv-stats">
            <div className="inv-stat inv-stat-warn">
              <span>{data.summary.expiredCount}</span><label>Already expired</label>
              <em>{rupees(data.summary.expiredValuePaise)}</em>
            </div>
            <div className="inv-stat">
              <span>{data.summary.nearExpiryCount}</span><label>Expiring soon</label>
              <em>{rupees(data.summary.nearExpiryValuePaise)}</em>
            </div>
          </div>

          {!data.batches.length && <p className="inv-empty">Nothing expiring in the next {days} days.</p>}

          {!!data.batches.length && (
            <div className="inv-table-wrap">
              <table className="inv-table">
                <thead><tr><th>Product</th><th>Batch</th><th>Where</th><th className="inv-num">Qty</th><th>Expiry</th><th className="inv-num">Value</th></tr></thead>
                <tbody>
                  {data.batches.map((b) => (
                    <tr key={`${b.batchId}-${b.locationId}`} className={b.expired ? 'is-expired' : ''}>
                      <td>{b.productName}</td>
                      <td className="inv-mono">{b.batchCode}</td>
                      <td className="inv-nowrap">{b.locationLabel}</td>
                      <td className="inv-num">{units(b.qtyMilli)} {b.uom}</td>
                      <td className={`inv-nowrap inv-${band(b.daysToExpiry, b.expired)}`}>
                        {fmtDate(b.expiryDate)}
                        <small>{b.expired ? `${-b.daysToExpiry}d ago` : `${b.daysToExpiry}d`}</small>
                      </td>
                      <td className="inv-num">{rupees(b.valuePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="inv-hint">
            Expired stock cannot be picked or dispatched — the database refuses it, not
            just this page. Write it off from the Stock tab; if the supplier is at
            fault, flag it there for a debit note.
          </p>
        </>
      )}
    </>
  )
}

/* ============================================================ masters ===== */

function MastersView({ products, suppliers, loadRefs, run, say, busy }) {
  const [pForm, setPForm] = useState({ sku: '', name: '', category: 'chips', uom: 'pcs', gstBps: 1200, mrp: '', shelfLifeDays: '', hsn: '', barcode: '' })
  const [sForm, setSForm] = useState({ name: '', gstin: '', address: '', phone: '', email: '' })

  const addProduct = (e) => {
    e.preventDefault()
    run(async () => {
      await api('/api/inv/products', { method: 'POST', body: pForm })
      say(`${pForm.name} added.`)
      setPForm({ ...pForm, sku: '', name: '', mrp: '', shelfLifeDays: '', hsn: '', barcode: '' })
      await loadRefs()
    })
  }

  const addSupplier = (e) => {
    e.preventDefault()
    run(async () => {
      await api('/api/inv/suppliers', { method: 'POST', body: sForm })
      say(`${sForm.name} added.`)
      setSForm({ name: '', gstin: '', address: '', phone: '', email: '' })
      await loadRefs()
    })
  }

  return (
    <div className="inv-two">
      <div>
        <form className="inv-form" onSubmit={addProduct}>
          <div className="inv-form-head"><h3>Add a product</h3></div>
          <div className="inv-grid">
            <label className="inv-field"><span>SKU <em>required</em></span>
              <input value={pForm.sku} onChange={(e) => setPForm({ ...pForm, sku: e.target.value })} placeholder="LAY-MM-52" required /></label>
            <label className="inv-field"><span>Name <em>required</em></span>
              <input value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} placeholder="Lay's Magic Masala 52g" required /></label>
            <label className="inv-field"><span>Category</span>
              <select value={pForm.category} onChange={(e) => setPForm({ ...pForm, category: e.target.value })}>
                {PRODUCT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select></label>
            <label className="inv-field"><span>Unit</span>
              <select value={pForm.uom} onChange={(e) => setPForm({ ...pForm, uom: e.target.value })}>
                {UOM_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select></label>
            <label className="inv-field"><span>GST</span>
              <select value={pForm.gstBps} onChange={(e) => setPForm({ ...pForm, gstBps: Number(e.target.value) })}>
                {GST_RATES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select></label>
            <label className="inv-field"><span>MRP ₹</span>
              <input value={pForm.mrp} onChange={(e) => setPForm({ ...pForm, mrp: e.target.value })} inputMode="decimal" placeholder="20" /></label>
            <label className="inv-field"><span>Shelf life <em>days</em></span>
              <input value={pForm.shelfLifeDays} onChange={(e) => setPForm({ ...pForm, shelfLifeDays: e.target.value })} inputMode="numeric" placeholder="120" /></label>
            <label className="inv-field"><span>HSN</span>
              <input value={pForm.hsn} onChange={(e) => setPForm({ ...pForm, hsn: e.target.value })} inputMode="numeric" placeholder="2005" /></label>
            <label className="inv-field inv-span2"><span>Barcode <em>the manufacturer’s, for scanning</em></span>
              <input value={pForm.barcode} onChange={(e) => setPForm({ ...pForm, barcode: e.target.value })} placeholder="8901491101837" /></label>
          </div>
          <p className="inv-hint">
            Shelf life matters: it defaults the expiry date when receiving, and an
            expiry more than 1.5× beyond it is refused as a likely mistyped year.
          </p>
          <div className="inv-actions">
            <button type="submit" className="inv-primary" disabled={busy}>Add product</button>
          </div>
        </form>

        <div className="inv-list-head"><h3>Products <span>{products.length}</span></h3></div>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Name</th><th>SKU</th><th>GST</th><th className="inv-num">MRP</th><th className="inv-num">Shelf life</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td className="inv-mono">{p.sku}</td>
                  <td>{(p.gstBps / 100).toFixed(0)}%</td>
                  <td className="inv-num">{rupees(p.mrpPaise)}</td>
                  <td className="inv-num">{p.shelfLifeDays ? `${p.shelfLifeDays}d` : '—'}</td>
                </tr>
              ))}
              {!products.length && <tr><td colSpan={5} className="inv-empty">No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <form className="inv-form" onSubmit={addSupplier}>
          <div className="inv-form-head"><h3>Add a supplier</h3></div>
          <div className="inv-grid">
            <label className="inv-field inv-span2"><span>Name <em>required</em></span>
              <input value={sForm.name} onChange={(e) => setSForm({ ...sForm, name: e.target.value })} required /></label>
            <label className="inv-field"><span>GSTIN</span>
              <input value={sForm.gstin} onChange={(e) => setSForm({ ...sForm, gstin: e.target.value.toUpperCase() })} placeholder="29AAAAA0000A1Z5" maxLength={15} /></label>
            <label className="inv-field"><span>Phone</span>
              <input value={sForm.phone} onChange={(e) => setSForm({ ...sForm, phone: e.target.value })} /></label>
            <label className="inv-field inv-span2"><span>Address</span>
              <input value={sForm.address} onChange={(e) => setSForm({ ...sForm, address: e.target.value })} /></label>
            <label className="inv-field inv-span2"><span>Email</span>
              <input value={sForm.email} onChange={(e) => setSForm({ ...sForm, email: e.target.value })} type="email" /></label>
          </div>
          <p className="inv-hint">
            The GSTIN’s state code decides CGST + SGST versus IGST on their bills, so
            it is worth getting right.
          </p>
          <div className="inv-actions">
            <button type="submit" className="inv-primary" disabled={busy}>Add supplier</button>
          </div>
        </form>

        <div className="inv-list-head"><h3>Suppliers <span>{suppliers.length}</span></h3></div>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Name</th><th>GSTIN</th><th>State</th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="inv-mono">{s.gstin || '—'}</td>
                  <td>{s.stateCode === '29' ? 'Karnataka (intra)' : s.stateCode ? `${s.stateCode} (inter)` : '—'}</td>
                </tr>
              ))}
              {!suppliers.length && <tr><td colSpan={3} className="inv-empty">No suppliers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* =========================================================== catalogue ==== */

/**
 * Import the branch catalogue from VLite.
 *
 * The machines already vend from a catalogue held upstream, so retyping it here
 * would guarantee the two drift apart. Only identity and pricing come across --
 * name, HSN, MRP, GST and the barcode. Batch, expiry, quantity and cost stay
 * ours, because those are the facts VLite must never be the authority on.
 *
 * VLite keeps the barcode in a field it calls customProductId, which is what
 * makes a scanned EAN resolve to a product at goods-in.
 */
function CatalogueView({ loadRefs, run, say, oops, busy }) {
  const [data, setData] = useState(null)
  const [chosen, setChosen] = useState({})
  const [cats, setCats] = useState({})
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('new')
  const [result, setResult] = useState(null)

  const load = () => run(async () => {
    setResult(null)
    const d = await api('/api/inv/vlite/products')
    setData(d)
    setChosen({})
  })

  const shown = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.items.filter((i) => {
      if (only === 'new' && i.status !== 'new') return false
      if (only === 'unlinked' && i.status === 'linked') return false
      if (!needle) return true
      return `${i.name} ${i.barcode || ''} ${i.displayProductId || ''} ${i.brand || ''}`
        .toLowerCase().includes(needle)
    })
  }, [data, q, only])

  const toggle = (id, on) => setChosen((c) => {
    const next = { ...c }
    if (on) next[id] = true; else delete next[id]
    return next
  })

  const importNow = () => run(async () => {
    const ids = Object.keys(chosen).map(Number)
    const r = await api('/api/inv/vlite/products/import', {
      method: 'POST',
      body: { vliteProductIds: ids, categories: cats },
    })
    setResult(r)
    say(`${r.created.length} created, ${r.linked.length} linked to products already here, ${r.skipped.length} skipped.`)
    setChosen({})
    await Promise.all([loadRefs(), load()])
  })

  return (
    <>
      {!data && (
        <div className="inv-form">
          <div className="inv-form-head"><h3>Import products from VLite</h3></div>
          <p className="inv-hint">
            Pulls the branch catalogue the machines already vend from, so the two do
            not drift apart. Only name, HSN, MRP, GST and the barcode come across —
            batch, expiry, quantity and cost stay here, because those are the facts
            VLite must never be the authority on.
          </p>
          <div className="inv-actions inv-actions-left">
            <button type="button" className="inv-primary" onClick={load} disabled={busy}>
              {busy ? 'Fetching…' : 'Fetch the VLite catalogue'}
            </button>
          </div>
        </div>
      )}

      {result?.followUp && <div className="inv-callout"><div><strong>Next</strong><p>{result.followUp}</p></div></div>}

      {data && (
        <>
          <div className="inv-stats">
            <div className="inv-stat"><span>{data.summary.total}</span><label>In VLite</label></div>
            <div className="inv-stat"><span>{data.summary.new}</span><label>Not here yet</label></div>
            <div className="inv-stat"><span>{data.summary.linked}</span><label>Already linked</label></div>
            <div className="inv-stat"><span>{data.summary.matchesBarcode}</span><label>Same barcode</label></div>
            <div className="inv-stat inv-stat-warn"><span>{data.summary.missingBarcode}</span><label>No barcode</label></div>
            <div className="inv-stat inv-stat-warn"><span>{data.summary.missingGst}</span><label>GST unclear</label></div>
          </div>

          <div className="inv-cat-head">
            <div className="inv-cat-search">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, barcode or brand…" />
            </div>
            <select value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="new">Not here yet</option>
              <option value="unlinked">Everything unlinked</option>
              <option value="all">Everything</option>
            </select>
            <button type="button" className="inv-ghost" onClick={load}>Refresh</button>
            <button type="button" className="inv-primary" disabled={busy || !Object.keys(chosen).length} onClick={importNow}>
              {busy ? 'Importing…' : `Import ${Object.keys(chosen).length || ''}`}
            </button>
          </div>

          {!shown.length && <p className="inv-empty">Nothing matches that filter.</p>}

          {!!shown.length && (
            <div className="inv-table-wrap">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th></th><th>Product</th><th>Barcode</th><th>Brand</th>
                    <th className="inv-num">MRP</th><th>GST</th><th>Category here</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const on = !!chosen[i.vliteProductId]
                    const disabled = i.status === 'linked'
                    return (
                      <tr key={i.vliteProductId} className={on ? 'is-picked' : ''}>
                        <td>
                          <input type="checkbox" checked={on} disabled={disabled}
                            onChange={(e) => toggle(i.vliteProductId, e.target.checked)}
                            aria-label={`Import ${i.name}`} />
                        </td>
                        <td>{i.name}<small>{i.displayProductId}</small></td>
                        <td className="inv-mono">
                          {i.barcode || <span className="inv-warn-cell">none — cannot be scanned</span>}
                        </td>
                        <td>{i.brand || '—'}</td>
                        <td className="inv-num">{rupees(i.mrpPaise)}</td>
                        <td>
                          {i.gstBps == null
                            ? <span className="inv-warn-cell">unclear</span>
                            : `${(i.gstBps / 100).toFixed(0)}%`}
                        </td>
                        <td>
                          <select
                            value={cats[i.vliteProductId] ?? i.suggestedCategory}
                            onChange={(e) => setCats((c) => ({ ...c, [i.vliteProductId]: e.target.value }))}
                            disabled={disabled}
                          >
                            {PRODUCT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </td>
                        <td>
                          {i.status === 'linked'   && <span className="inv-badge inv-badge-linked">linked</span>}
                          {i.status === 'new'      && <span className="inv-badge inv-badge-new">new</span>}
                          {i.status === 'matches_barcode' && (
                            <span className="inv-badge inv-badge-match" title={`Same barcode as ${i.localName}`}>
                              same barcode
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="inv-hint">
            The category is a guess from VLite’s own wording — correct it here before
            importing. An import never overwrites a name, MRP or GST rate already
            corrected by hand: if the two disagree, the local value is the one
            somebody chose deliberately.
          </p>
        </>
      )}
    </>
  )
}
