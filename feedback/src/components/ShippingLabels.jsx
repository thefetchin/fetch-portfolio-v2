import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ShippingLabel from './ShippingLabel'
import './ShippingLabel.css'
import './ShippingLabels.css'

/**
 * Shipping labels for parts going back to a manufacturer.
 *
 * Everything on the label is editable here, and everything optional can be
 * switched off. What is worth keeping is kept: our own address, the
 * manufacturers, and the page settings. The label itself is not stored — it is
 * a sheet of paper describing what is in a box today.
 *
 * Printing is the browser's, deliberately. It already knows this printer, and
 * the sheet is drawn at real millimetres, so "print to PDF" and "print to the
 * label printer" are the same action with the same result.
 */

const BLANK_ITEM = { description: '', partNo: '', qty: '1', unit: 'pcs', value: '' }

/** Sortable, readable, and unique enough for a parcel: FR-YYMMDD-XXXX. */
function makeRef() {
  const d = new Date()
  const stamp = [
    String(d.getFullYear()).slice(2),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('')
  // No I/O/0/1: these are read off a box and typed back in by hand.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((n) => alphabet[n % alphabet.length]).join('')
  return `FR-${stamp}-${tail}`
}

const today = () => new Date().toISOString().slice(0, 10)

const BLANK_PARTY = { name: '', attention: '', lines: '', gstin: '', phone: '', email: '' }

export default function ShippingLabels() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const [from, setFrom] = useState(BLANK_PARTY)
  const [to, setTo] = useState(BLANK_PARTY)
  const [addressId, setAddressId] = useState('')   // which saved consignee is loaded
  const [shipment, setShipment] = useState({
    ref: makeRef(),
    date: today(),
    kicker: 'Shipping label',
    title: 'Spare parts — return to manufacturer',
    packages: '1',
    weight: '',
    dimensions: '',
    carrier: '',
    docket: '',
    mode: 'Surface',
    docRef: '',
  })
  const [items, setItems] = useState([{ ...BLANK_ITEM }])
  const [pageSize, setPageSize] = useState('A4')
  const [orientation, setOrientation] = useState('landscape')
  const [show, setShow] = useState({})
  const [declaration, setDeclaration] = useState('')
  const [footerNote, setFooterNote] = useState('')
  const [zoom, setZoom] = useState(1)

  const sheetWrap = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/shipping', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the shipping settings.')
      setData(d)
      setFrom({ ...BLANK_PARTY, ...d.settings.from })
      setPageSize(d.settings.pageSize)
      setOrientation(d.settings.orientation)
      setShow(d.settings.show)
      setDeclaration(d.settings.declaration)
      setFooterNote(d.settings.footerNote)
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  /* The sheet is drawn at real size; this is only how much of it fits on the
     screen. Recomputed on resize so the preview never overflows its column. */
  const page = useMemo(() => {
    const found = (data?.pageSizes || []).find((p) => p.value === pageSize)
    const base = found || { w: 210, h: 297 }
    return orientation === 'landscape'
      ? { w: base.h, h: base.w }
      : { w: base.w, h: base.h }
  }, [data, pageSize, orientation])

  useEffect(() => {
    const fit = () => {
      const el = sheetWrap.current
      if (!el) return
      const mmToPx = 96 / 25.4
      const avail = el.clientWidth - 8
      setZoom(Math.min(1, avail / (page.w * mmToPx)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [page])

  /* ------------------------------------------------------------ saving -- */

  const saveSettings = async () => {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/shipping/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, pageSize, orientation, show, declaration, footerNote }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not save those defaults.')
      setNotice('Saved. New labels start from these.')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const saveConsignee = async () => {
    setBusy(true); setError(null)
    try {
      const isNew = !addressId
      const r = await fetch(
        isNew ? '/api/admin/shipping/addresses' : `/api/admin/shipping/addresses/${addressId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(to),
        }
      )
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not save that address.')
      if (d.addressId) setAddressId(d.addressId)
      setNotice(isNew ? 'Consignee saved.' : 'Consignee updated.')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const removeConsignee = async () => {
    if (!addressId) return
    if (!window.confirm(`Remove "${to.name}" from the list?`)) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/admin/shipping/addresses/${addressId}`, {
        method: 'DELETE', credentials: 'include',
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not remove it.')
      setAddressId(''); setTo(BLANK_PARTY)
      setNotice('Removed from the list. Labels already printed are unaffected.')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const pickConsignee = (id) => {
    setAddressId(id)
    if (!id) { setTo(BLANK_PARTY); return }
    const a = (data?.addresses || []).find((x) => x.addressId === id)
    if (a) {
      setTo({
        name: a.name || '', attention: a.attention || '', lines: a.lines || '',
        gstin: a.gstin || '', phone: a.phone || '', email: a.email || '',
      })
    }
  }

  /* ---------------------------------------------------------- printing -- */

  /* The @page rule has to exist in the document before print, and its size is
     not something a class can carry — so it is written as the sheet changes.
     Everything else is hidden by visibility rather than display, which keeps
     the sheet's own layout untouched while it prints. */
  useEffect(() => {
    const id = 'ship-page-rule'
    let tag = document.getElementById(id)
    if (!tag) {
      tag = document.createElement('style')
      tag.id = id
      document.head.appendChild(tag)
    }
    tag.textContent = `@page { size: ${page.w}mm ${page.h}mm; margin: 0; }`
    return () => { /* left in place: the next render rewrites it */ }
  }, [page])

  const set = (fn) => (e) => fn(e.target.value)
  const setItem = (i, patch) =>
    setItems((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  if (!data) return <p className="ship-empty">Loading…</p>

  const toggles = [
    ['shipmentBox', 'Shipment details box'],
    ['items', 'Itemised contents'],
    ['itemValue', 'Value per line'],
    ['totalValue', 'Declared value'],
    ['declaration', 'Declaration'],
    ['fromGstin', 'Sender GSTIN'],
    ['toGstin', 'Consignee GSTIN'],
    ['contact', 'Phone and email'],
    ['refQr', 'QR of the reference'],
    ['footer', 'Handling note'],
    ['cutMarks', 'Trim outline'],
  ]

  return (
    <section className="ship">
      {error && <div className="ship-error" role="alert">{error}</div>}
      {notice && <div className="ship-notice" role="status">{notice}</div>}

      <div className="ship-head ship-noprint">
        <div>
          <h2>Shipping labels</h2>
          <p className="ship-sub">
            For parts going back to a manufacturer. Everything here is editable,
            and anything optional can be left off. Print goes straight to your
            printer, or to PDF — the sheet is drawn at the real size of the
            page, so what you see is what comes out.
          </p>
        </div>
        <div className="ship-head-actions">
          <button type="button" className="ship-print-btn" onClick={() => window.print()}>
            Print label
          </button>
        </div>
      </div>

      <div className="ship-layout">
        {/* ------------------------------------------------ the controls -- */}
        <div className="ship-controls ship-noprint">

          <details className="ship-group" open>
            <summary>Page</summary>
            <div className="ship-row">
              <label className="ship-field">
                <span>Size</span>
                <select value={pageSize} onChange={set(setPageSize)}>
                  {data.pageSizes.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="ship-field">
                <span>Orientation</span>
                <select value={orientation} onChange={set(setOrientation)}>
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </label>
            </div>
            <p className="ship-note">
              {page.w} × {page.h} mm. Set your printer to the same size and to
              100% scale — "fit to page" is what shrinks a label by 4%.
            </p>
          </details>

          <details className="ship-group" open>
            <summary>What appears on the label</summary>
            <div className="ship-toggles">
              {toggles.map(([key, label]) => (
                <label key={key} className="ship-check">
                  <input
                    type="checkbox" checked={show[key] !== false}
                    onChange={(e) => setShow({ ...show, [key]: e.target.checked })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </details>

          <details className="ship-group">
            <summary>From — our address</summary>
            <label className="ship-field">
              <span>Name</span>
              <input value={from.name} maxLength={120}
                onChange={(e) => setFrom({ ...from, name: e.target.value })} />
            </label>
            <label className="ship-field">
              <span>Address</span>
              <textarea rows={3} value={from.lines} maxLength={480}
                onChange={(e) => setFrom({ ...from, lines: e.target.value })} />
            </label>
            <div className="ship-row">
              <label className="ship-field">
                <span>GSTIN</span>
                <input value={from.gstin} maxLength={15}
                  onChange={(e) => setFrom({ ...from, gstin: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Phone</span>
                <input value={from.phone} maxLength={30}
                  onChange={(e) => setFrom({ ...from, phone: e.target.value })} />
              </label>
            </div>
            <label className="ship-field">
              <span>Email</span>
              <input value={from.email} maxLength={120}
                onChange={(e) => setFrom({ ...from, email: e.target.value })} />
            </label>
          </details>

          <details className="ship-group" open>
            <summary>To — the manufacturer</summary>
            <label className="ship-field">
              <span>Saved consignees</span>
              <select value={addressId} onChange={(e) => pickConsignee(e.target.value)}>
                <option value="">— new address —</option>
                {data.addresses.map((a) => (
                  <option key={a.addressId} value={a.addressId}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="ship-field">
              <span>Name</span>
              <input value={to.name} maxLength={120}
                onChange={(e) => setTo({ ...to, name: e.target.value })} />
            </label>
            <label className="ship-field">
              <span>Attention</span>
              <input value={to.attention} maxLength={80} placeholder="Service desk / RMA"
                onChange={(e) => setTo({ ...to, attention: e.target.value })} />
            </label>
            <label className="ship-field">
              <span>Address</span>
              <textarea rows={3} value={to.lines} maxLength={480}
                onChange={(e) => setTo({ ...to, lines: e.target.value })} />
            </label>
            <div className="ship-row">
              <label className="ship-field">
                <span>GSTIN</span>
                <input value={to.gstin} maxLength={15}
                  onChange={(e) => setTo({ ...to, gstin: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Phone</span>
                <input value={to.phone} maxLength={30}
                  onChange={(e) => setTo({ ...to, phone: e.target.value })} />
              </label>
            </div>
            <label className="ship-field">
              <span>Email</span>
              <input value={to.email} maxLength={120}
                onChange={(e) => setTo({ ...to, email: e.target.value })} />
            </label>
            <div className="ship-actions">
              <button type="button" onClick={saveConsignee} disabled={busy || !to.name.trim()}>
                {addressId ? 'Update saved address' : 'Save to the list'}
              </button>
              {addressId && (
                <button type="button" onClick={removeConsignee} disabled={busy}>Remove</button>
              )}
            </div>
          </details>

          <details className="ship-group" open>
            <summary>This shipment</summary>
            <div className="ship-row">
              <label className="ship-field">
                <span>Reference</span>
                <input value={shipment.ref} maxLength={40}
                  onChange={(e) => setShipment({ ...shipment, ref: e.target.value })} />
              </label>
              <label className="ship-field ship-field--btn">
                <span>&nbsp;</span>
                <button type="button" onClick={() => setShipment({ ...shipment, ref: makeRef() })}>
                  New reference
                </button>
              </label>
            </div>
            <div className="ship-row">
              <label className="ship-field">
                <span>Date</span>
                <input type="date" value={shipment.date}
                  onChange={(e) => setShipment({ ...shipment, date: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Packages</span>
                <input value={shipment.packages} maxLength={10}
                  onChange={(e) => setShipment({ ...shipment, packages: e.target.value })} />
              </label>
            </div>
            <div className="ship-row">
              <label className="ship-field">
                <span>Weight</span>
                <input value={shipment.weight} maxLength={20} placeholder="4.2 kg"
                  onChange={(e) => setShipment({ ...shipment, weight: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Dimensions</span>
                <input value={shipment.dimensions} maxLength={30} placeholder="40 × 30 × 25 cm"
                  onChange={(e) => setShipment({ ...shipment, dimensions: e.target.value })} />
              </label>
            </div>
            <div className="ship-row">
              <label className="ship-field">
                <span>Carrier</span>
                <input value={shipment.carrier} maxLength={40} placeholder="Blue Dart"
                  onChange={(e) => setShipment({ ...shipment, carrier: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Docket / AWB</span>
                <input value={shipment.docket} maxLength={40}
                  onChange={(e) => setShipment({ ...shipment, docket: e.target.value })} />
              </label>
            </div>
            <div className="ship-row">
              <label className="ship-field">
                <span>Mode</span>
                <input value={shipment.mode} maxLength={20}
                  onChange={(e) => setShipment({ ...shipment, mode: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Doc ref</span>
                <input value={shipment.docRef} maxLength={40} placeholder="Delivery challan no."
                  onChange={(e) => setShipment({ ...shipment, docRef: e.target.value })} />
              </label>
            </div>
            <div className="ship-row">
              <label className="ship-field">
                <span>Small line above the title</span>
                <input value={shipment.kicker} maxLength={40}
                  onChange={(e) => setShipment({ ...shipment, kicker: e.target.value })} />
              </label>
              <label className="ship-field">
                <span>Title</span>
                <input value={shipment.title} maxLength={80}
                  onChange={(e) => setShipment({ ...shipment, title: e.target.value })} />
              </label>
            </div>
          </details>

          <details className="ship-group" open>
            <summary>Contents</summary>
            <div className="ship-items">
              {items.map((it, i) => (
                <div key={i} className="ship-item">
                  <input
                    className="ship-item-desc" placeholder="Description" maxLength={120}
                    value={it.description}
                    onChange={(e) => setItem(i, { description: e.target.value })}
                  />
                  <input
                    className="ship-item-part" placeholder="Part no." maxLength={40}
                    value={it.partNo}
                    onChange={(e) => setItem(i, { partNo: e.target.value })}
                  />
                  <input
                    className="ship-item-qty" placeholder="Qty" inputMode="numeric" maxLength={6}
                    value={it.qty}
                    onChange={(e) => setItem(i, { qty: e.target.value })}
                  />
                  <input
                    className="ship-item-unit" placeholder="Unit" maxLength={8}
                    value={it.unit}
                    onChange={(e) => setItem(i, { unit: e.target.value })}
                  />
                  <input
                    className="ship-item-val" placeholder="₹ each" inputMode="decimal" maxLength={12}
                    value={it.value}
                    onChange={(e) => setItem(i, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >✕</button>
                </div>
              ))}
            </div>
            <button
              type="button" className="ship-additem"
              onClick={() => setItems([...items, { ...BLANK_ITEM }])}
            >Add a line</button>
            <p className="ship-note">
              Value is per unit; the label multiplies by the quantity. Switch the
              whole list off above if the box goes out without a manifest.
            </p>
          </details>

          <details className="ship-group">
            <summary>Wording</summary>
            <label className="ship-field">
              <span>Declaration</span>
              <textarea rows={3} value={declaration} maxLength={400}
                onChange={set(setDeclaration)} />
            </label>
            <label className="ship-field">
              <span>Handling note</span>
              <input value={footerNote} maxLength={160} onChange={set(setFooterNote)} />
            </label>
          </details>

          <div className="ship-actions ship-actions--save">
            <button type="button" className="ship-save" onClick={saveSettings} disabled={busy}>
              {busy ? 'Saving…' : 'Save as defaults'}
            </button>
            <span className="ship-note">
              Keeps the sender, the page and the wording for next time. The
              shipment and the contents are per label and are not saved.
            </span>
          </div>
        </div>

        {/* -------------------------------------------------- the sheet -- */}
        <div className="ship-preview" ref={sheetWrap}>
          <div className="ship-preview-head ship-noprint">
            <span>Preview · {page.w} × {page.h} mm</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <div className="ship-scaler" style={{ '--ship-zoom': zoom }}>
            <ShippingLabel
              page={page} from={from} to={to} shipment={shipment}
              items={items} show={show}
              declaration={declaration} footerNote={footerNote}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
