/**
 * Batch stickers.
 *
 * One sticker per CONTAINER -- carton, tote or inner bag -- never per unit.
 * "One batch per container" is the rule the whole system rests on: it is what
 * lets someone load the right batch into the right slot without reading a code,
 * because the bag itself carries the identity.
 *
 * The expiry date is the largest thing on the label, deliberately. It is the one
 * fact a human has to be able to act on from across a warehouse, and it is the
 * fact that survives when a code gets scuffed.
 *
 * The QR encodes the plain batch code, unsigned -- unlike the public Pod QRs,
 * which are HMAC-signed because anyone can scan them. These are internal, the
 * scanner is authenticated, and the server checks the batch exists, so a forged
 * sticker resolves to nothing and achieves nothing.
 *
 * Two layouts, because a warehouse may or may not have a label printer:
 *   'a4'      3 x 8 on A4 at standard 63.5 x 33.9 mm Avery spacing
 *   'thermal' 50 x 25 mm, one per page, for a roll printer
 */

let qrLibPromise = null
const qrLib = () => {
  if (!qrLibPromise) qrLibPromise = import('qrcode')
  return qrLibPromise
}

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 2026-12-10 -> 10 Dec 2026. Unambiguous: no numeric month to misread. */
const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

const rupees = (paise) =>
  paise == null ? null : (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const qty = (milli) => {
  if (milli == null) return ''
  const n = milli / 1000
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/* ------------------------------------------------------------------ CSS ---- */

const SHARED_CSS = `
  /* A printed document paints its own ground: without an explicit
     background and color-scheme it inherits the viewer's dark theme and
     previews as black on black. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .code { font-family: "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.08em; }
  .expiry-label {
    font-size: 6.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #000; font-weight: 700;
  }
  /* The one figure that has to be readable at arm's length. */
  .expiry { font-weight: 800; line-height: 1.05; }
  .product { font-weight: 700; line-height: 1.15; overflow: hidden; }
  .meta { font-size: 6.5pt; color: #222; }
  .qr { display: block; }
`

const A4_CSS = `
  @page { size: A4; margin: 0; }
  body { width: 210mm; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(3, 63.5mm);
    grid-auto-rows: 33.9mm;
    /* Avery L7159-style: 7.2mm top margin, 7.75mm side, no gutter. */
    padding: 7.2mm 7.75mm;
    gap: 0;
    page-break-after: always;
  }
  .label {
    width: 63.5mm; height: 33.9mm;
    padding: 2mm 2.4mm;
    display: grid;
    grid-template-columns: 1fr 19mm;
    grid-template-rows: auto 1fr auto;
    column-gap: 1.6mm;
    overflow: hidden;
  }
  .label.cut { outline: 0.2mm dashed #bbb; outline-offset: -0.1mm; }
  .product  { grid-column: 1; font-size: 8.5pt; max-height: 7.6mm; }
  .qrcell   { grid-column: 2; grid-row: 1 / span 3; display: flex; align-items: center; justify-content: center; }
  .qr       { width: 17mm; height: 17mm; }
  .middle   { grid-column: 1; align-self: center; }
  .expiry   { font-size: 15pt; }
  .foot     { grid-column: 1; display: flex; justify-content: space-between; align-items: baseline; gap: 1.5mm; }
  .foot .code { font-size: 9pt; font-weight: 700; }
`

const THERMAL_CSS = `
  @page { size: 50mm 25mm; margin: 0; }
  body { width: 50mm; }
  .label {
    width: 50mm; height: 25mm;
    padding: 1.4mm 1.8mm;
    display: grid;
    grid-template-columns: 1fr 15mm;
    grid-template-rows: auto 1fr auto;
    column-gap: 1.2mm;
    page-break-after: always;
    overflow: hidden;
  }
  .product  { grid-column: 1; font-size: 7pt; max-height: 5.6mm; }
  .qrcell   { grid-column: 2; grid-row: 1 / span 3; display: flex; align-items: center; justify-content: center; }
  .qr       { width: 13.5mm; height: 13.5mm; }
  .middle   { grid-column: 1; align-self: center; }
  .expiry   { font-size: 12pt; }
  .foot     { grid-column: 1; display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; }
  .foot .code { font-size: 8pt; font-weight: 700; }
  .meta     { font-size: 5.5pt; }
`

/* ---------------------------------------------------------------- render --- */

function labelHtml(sticker, qrDataUrl, { cutLines }) {
  const mrp = rupees(sticker.mrpPaise)
  return `
  <div class="label${cutLines ? ' cut' : ''}">
    <div class="product">${esc(sticker.productName)}</div>
    <div class="qrcell">${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="">` : '<div class="qr"></div>'}</div>
    <div class="middle">
      <div class="expiry-label">Use by</div>
      <div class="expiry">${esc(fmtDate(sticker.expiryDate))}</div>
    </div>
    <div class="foot">
      <span class="code">${esc(sticker.batchCode)}</span>
      <span class="meta">${mrp ? `MRP ₹${esc(mrp)}` : ''}${
        sticker.qtyMilli != null ? `${mrp ? ' · ' : ''}${esc(qty(sticker.qtyMilli))} ${esc(sticker.uom || '')}` : ''
      }</span>
    </div>
  </div>`
}

/**
 * Prints batch stickers.
 *
 * @param {Array} stickers  [{ batchCode, productName, expiryDate, mrpPaise, qtyMilli, uom, copies }]
 * @param {object} [opts]
 * @param {'a4'|'thermal'} [opts.layout='a4']
 * @param {boolean} [opts.cutLines=true]  faint guides on A4; ignored on thermal
 */
export async function printBatchStickers(stickers, { layout = 'a4', cutLines = true } = {}) {
  const list = (Array.isArray(stickers) ? stickers : [stickers]).filter(Boolean)
  if (!list.length) return

  // Expand `copies` so one bag per container is genuinely one sticker each.
  const expanded = []
  for (const s of list) {
    const n = Math.max(1, Math.min(Number(s.copies) || 1, 200))
    for (let i = 0; i < n; i++) expanded.push(s)
  }

  // Open the window BEFORE awaiting: a popup opened after an await is no longer
  // tied to the click that triggered it, and browsers block it.
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) {
    alert('Please allow pop-ups for this site to print stickers.')
    return
  }
  w.document.write('<!doctype html><title>Batch stickers</title><p style="font:14px sans-serif;padding:24px">Preparing stickers…</p>')

  let QRCode = null
  try {
    QRCode = (await qrLib()).default
  } catch {
    // No QR library: still print, because the human-readable code and the
    // expiry date are what actually matter on the label.
    QRCode = null
  }

  const codes = [...new Set(expanded.map((s) => s.batchCode))]
  const qrByCode = {}
  if (QRCode) {
    await Promise.all(codes.map(async (code) => {
      try {
        qrByCode[code] = await QRCode.toDataURL(String(code), {
          errorCorrectionLevel: 'M',
          margin: 0,
          width: 256,
          color: { dark: '#000000', light: '#ffffff' },
        })
      } catch {
        qrByCode[code] = null
      }
    }))
  }

  const isA4 = layout !== 'thermal'
  const labels = expanded.map((s) => labelHtml(s, qrByCode[s.batchCode], { cutLines: isA4 && cutLines })).join('')

  // A4: 24 per page, so chunk into sheets. Thermal: one label per page via CSS.
  let body
  if (isA4) {
    const perPage = 24
    const pages = []
    for (let i = 0; i < expanded.length; i += perPage) {
      pages.push(expanded.slice(i, i + perPage)
        .map((s) => labelHtml(s, qrByCode[s.batchCode], { cutLines }))
        .join(''))
    }
    body = pages.map((p) => `<div class="sheet">${p}</div>`).join('')
  } else {
    body = labels
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Batch stickers — ${expanded.length} label${expanded.length === 1 ? '' : 's'}</title>
<style>${SHARED_CSS}${isA4 ? A4_CSS : THERMAL_CSS}</style>
</head><body>${body}
<script>window.onload = function () { window.print() }<\/script>
</body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}

export { fmtDate as formatStickerDate }
