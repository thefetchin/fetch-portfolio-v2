import { useEffect, useState } from 'react'

/**
 * The label itself, drawn at the real size of the page it prints on.
 *
 * Millimetres throughout, not pixels: the sheet on screen and the sheet in the
 * printer are then the same object, and "it looked right in the preview" stops
 * being a thing anyone has to say. Screen scaling is a transform on the
 * outside, which print ignores.
 */

let qrLibPromise = null
function qrLib() {
  if (!qrLibPromise) qrLibPromise = import('qrcode')
  return qrLibPromise
}

const lines = (text) => String(text || '').split(/\r?\n/).filter(Boolean)

export const rupees = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null

function Party({ heading, party, showGstin, showContact }) {
  return (
    <div className="lbl-party">
      <div className="lbl-party-head">{heading}</div>
      <div className="lbl-party-name">{party.name || '—'}</div>
      {party.attention && <div className="lbl-party-attn">Attn: {party.attention}</div>}
      <div className="lbl-party-lines">
        {lines(party.lines).map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {(showContact && (party.phone || party.email)) && (
        <div className="lbl-party-contact">
          {party.phone}{party.phone && party.email ? ' · ' : ''}{party.email}
        </div>
      )}
      {showGstin && party.gstin && (
        <div className="lbl-party-gstin">GSTIN {party.gstin}</div>
      )}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="lbl-field">
      <span className="lbl-field-label">{label}</span>
      <span className="lbl-field-value">{value || '—'}</span>
    </div>
  )
}

export default function ShippingLabel({ page, from, to, shipment, items, show, declaration, footerNote }) {
  const [qr, setQr] = useState(null)

  // The QR carries the reference, so a warehouse can scan the box instead of
  // reading a handwritten number back over the phone.
  useEffect(() => {
    let dead = false
    if (!show.refQr || !shipment.ref) { setQr(null); return }
    qrLib()
      .then((QR) => QR.toDataURL(shipment.ref, { margin: 0, width: 240, errorCorrectionLevel: 'M' }))
      .then((url) => !dead && setQr(url))
      .catch(() => !dead && setQr(null))
    return () => { dead = true }
  }, [show.refQr, shipment.ref])

  const priced = items.filter((i) => i.description)
  const total = priced.reduce(
    (sum, i) => sum + (Number(i.value) || 0) * (Number(i.qty) || 0), 0
  )

  // A 4x6 thermal label cannot carry two addresses side by side and a
  // four-column details grid. Below this width the same design stacks instead
  // of shrinking, because a shipping label that needs squinting at has failed
  // at the one thing it does.
  const compact = page.w < 120

  return (
    <div
      className={`lbl-sheet ${compact ? 'is-compact' : ''} ${show.cutMarks ? 'has-marks' : ''}`}
      style={{ '--lbl-w': `${page.w}mm`, '--lbl-h': `${page.h}mm` }}
    >
      <div className="lbl-inner">
        <header className="lbl-top">
          <div className="lbl-title-wrap">
            <div className="lbl-kicker">{shipment.kicker || 'Shipping label'}</div>
            <h1 className="lbl-title">{shipment.title || 'Spare parts — return to manufacturer'}</h1>
          </div>
          <div className="lbl-ref-wrap">
            <div className="lbl-ref">
              <span className="lbl-field-label">Reference</span>
              <span className="lbl-ref-value">{shipment.ref || '—'}</span>
            </div>
            {qr && <img className="lbl-qr" src={qr} alt="" />}
          </div>
        </header>

        <div className="lbl-parties">
          <Party
            heading="From (consignor)" party={from}
            showGstin={show.fromGstin} showContact={show.contact}
          />
          {/* The delivery address is the one that matters, so it is the one
              given weight -- a courier reads it from a distance, not from a
              chair. */}
          <Party
            heading="To (consignee)" party={to}
            showGstin={show.toGstin} showContact={show.contact}
          />
        </div>

        {show.shipmentBox && (
          <div className="lbl-shipment">
            <Field label="Date" value={shipment.date} />
            <Field label="Packages" value={shipment.packages} />
            <Field label="Weight" value={shipment.weight} />
            <Field label="Dimensions" value={shipment.dimensions} />
            <Field label="Carrier" value={shipment.carrier} />
            <Field label="Docket / AWB" value={shipment.docket} />
            <Field label="Mode" value={shipment.mode} />
            <Field label="Doc ref" value={shipment.docRef} />
          </div>
        )}

        {show.items && !!priced.length && (
          <table className="lbl-items">
            <thead>
              <tr>
                <th className="lbl-col-n">#</th>
                <th>Description</th>
                <th>Part no.</th>
                <th className="lbl-col-num">Qty</th>
                {show.itemValue && <th className="lbl-col-num">Value (₹)</th>}
              </tr>
            </thead>
            <tbody>
              {priced.map((it, i) => (
                <tr key={i}>
                  <td className="lbl-col-n">{i + 1}</td>
                  <td>{it.description}</td>
                  <td>{it.partNo || '—'}</td>
                  <td className="lbl-col-num">{it.qty || '—'}{it.unit ? ` ${it.unit}` : ''}</td>
                  {show.itemValue && (
                    <td className="lbl-col-num">
                      {rupees((Number(it.value) || 0) * (Number(it.qty) || 0)) || '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {show.totalValue && (
              <tfoot>
                <tr>
                  <td colSpan={show.itemValue ? 4 : 3}>Declared value</td>
                  <td className="lbl-col-num">₹{rupees(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {/* Value with no itemised list still has to appear somewhere: a
            carrier asks what the box is worth, not what is in it. */}
        {show.totalValue && (!show.items || !priced.length) && (
          <div className="lbl-value-only">
            <span className="lbl-field-label">Declared value</span>
            <span className="lbl-value-big">₹{rupees(total)}</span>
          </div>
        )}

        <div className="lbl-bottom">
          {show.declaration && declaration && (
            <p className="lbl-declaration">{declaration}</p>
          )}
          {show.footer && footerNote && (
            <p className="lbl-footer">{footerNote}</p>
          )}
        </div>
      </div>
    </div>
  )
}
