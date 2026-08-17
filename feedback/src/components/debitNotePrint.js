import { ISSUER, DEBIT_NOTE_REASONS } from '../../shared/constants.js'
import { amountInWords } from '../../worker/invoicing.js'

/**
 * Renders a stored debit note as a self-contained printable document.
 *
 * Everything comes from the server's stored figures — never from the form
 * preview — so a reprint months later is byte-identical to the original.
 *
 * Opens a new window with inline styles rather than printing the dashboard,
 * so the app's own layout and print rules can't leak into the document.
 */

const rupees = (paise) =>
  (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const qty = (milli) => {
  const n = milli / 1000
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[Number(m) - 1]} ${y}`
}

export function printDebitNote(note, lines) {
  const interstate = note.is_interstate === 1
  const reasonLabel =
    DEBIT_NOTE_REASONS.find((r) => r.value === note.reason)?.label || note.reason

  const taxCols = interstate
    ? '<th class="r">IGST</th>'
    : '<th class="r">CGST</th><th class="r">SGST</th>'

  const rows = lines.map((l) => `
    <tr>
      <td class="c">${l.line_no}</td>
      <td>${esc(l.description)}</td>
      <td class="c">${esc(l.hsn || '—')}</td>
      <td class="r">${qty(l.qty_milli)} ${esc(l.uom)}</td>
      <td class="r">${rupees(l.rate_paise)}</td>
      <td class="r">${rupees(l.taxable_paise)}</td>
      <td class="c">${(l.gst_bps / 100).toFixed(l.gst_bps % 100 ? 2 : 0)}%</td>
      ${interstate
        ? `<td class="r">${rupees(l.igst_paise)}</td>`
        : `<td class="r">${rupees(l.cgst_paise)}</td><td class="r">${rupees(l.sgst_paise)}</td>`}
      <td class="r b">${rupees(l.total_paise)}</td>
    </tr>`).join('')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(note.note_number)} — Debit Note</title>
<style>
  /* A printed document paints its own ground: without an explicit
     background and color-scheme it inherits the viewer's dark theme and
     previews as black on black. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111; background: #fff;
    margin: 0; padding: 28px 30px; font-size: 12px; line-height: 1.45;
  }
  .doc { max-width: 780px; margin: 0 auto; }
  .title-bar {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 14px;
  }
  .issuer-name { font-size: 19px; font-weight: 700; letter-spacing: -0.3px; }
  .issuer-meta { color: #444; font-size: 11px; margin-top: 3px; }
  .doc-type {
    text-align: right; font-size: 17px; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase;
  }
  .doc-no { font-size: 12px; font-weight: 600; margin-top: 4px; }
  .doc-date { font-size: 11px; color: #444; }
  .parties { display: flex; gap: 18px; margin-bottom: 14px; }
  .party {
    flex: 1; border: 1px solid #ccc; padding: 9px 11px; border-radius: 3px;
  }
  .party h3 {
    margin: 0 0 5px; font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
    color: #666; font-weight: 700;
  }
  .party .nm { font-weight: 700; font-size: 12.5px; }
  .party div { font-size: 11px; color: #333; }
  .ref {
    display: flex; gap: 22px; flex-wrap: wrap; font-size: 11px;
    background: #f6f7f9; border: 1px solid #e3e6ea; border-radius: 3px;
    padding: 8px 11px; margin-bottom: 14px;
  }
  .ref b { display: block; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 7px; vertical-align: top; }
  th {
    background: #f0f2f5; font-size: 9px; letter-spacing: 0.6px; text-transform: uppercase;
    text-align: left; font-weight: 700;
  }
  td { font-size: 11.5px; }
  .r { text-align: right; white-space: nowrap; }
  .c { text-align: center; white-space: nowrap; }
  .b { font-weight: 700; }
  .foot { display: flex; gap: 18px; align-items: flex-start; }
  .words { flex: 1; font-size: 11px; }
  .words .lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #666; }
  .words .val { font-weight: 700; margin-top: 2px; }
  .sums { width: 270px; }
  .sums table { margin: 0; }
  .sums td { border: none; padding: 3px 0; font-size: 11.5px; }
  .sums tr.total td {
    border-top: 1.5px solid #111; padding-top: 6px; font-weight: 700; font-size: 13.5px;
  }
  .note-body {
    margin: 12px 0; padding: 9px 11px; border-left: 3px solid #888; background: #fafafa;
    font-size: 11px;
  }
  .sign {
    margin-top: 34px; display: flex; justify-content: space-between; align-items: flex-end;
    font-size: 11px;
  }
  .sign .box { text-align: center; }
  .sign .line { border-top: 1px solid #333; padding-top: 4px; min-width: 190px; }
  .fineprint { margin-top: 18px; font-size: 9.5px; color: #777; line-height: 1.5; }
  .cancelled {
    color: #b91c1c; border: 2px solid #b91c1c; padding: 2px 8px; border-radius: 3px;
    font-weight: 700; letter-spacing: 1px; font-size: 11px;
  }
  @media print { @page { margin: 12mm; size: A4; } body { padding: 0; } }
</style></head>
<body><div class="doc">

  <div class="title-bar">
    <div>
      <div class="issuer-name">${esc(ISSUER.legalName)}</div>
      <div class="issuer-meta">
        Trading as ${esc(ISSUER.tradeName)}<br>
        ${ISSUER.address.map(esc).join('<br>')}<br>
        GSTIN: <b>${esc(ISSUER.gstin)}</b> &nbsp;·&nbsp; CIN: ${esc(ISSUER.cin)}<br>
        ${esc(ISSUER.email)} &nbsp;·&nbsp; ${esc(ISSUER.phone)}
      </div>
    </div>
    <div>
      <div class="doc-type">Debit Note</div>
      <div class="doc-no">${esc(note.note_number)}</div>
      <div class="doc-date">Dated ${fmtDate(note.note_date)}</div>
      ${note.status === 'cancelled' ? '<div class="doc-date"><span class="cancelled">CANCELLED</span></div>' : ''}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Debit to — supplier</h3>
      <div class="nm">${esc(note.supplier_name)}</div>
      ${note.supplier_address ? `<div>${esc(note.supplier_address)}</div>` : ''}
      ${note.supplier_gstin ? `<div>GSTIN: <b>${esc(note.supplier_gstin)}</b></div>` : '<div>GSTIN: not provided</div>'}
    </div>
    <div class="party">
      <h3>Raised by</h3>
      <div class="nm">${esc(ISSUER.legalName)}</div>
      <div>${esc(ISSUER.address.join(', '))}</div>
      <div>GSTIN: <b>${esc(ISSUER.gstin)}</b></div>
    </div>
  </div>

  <div class="ref">
    <div><b>Reason</b>${esc(reasonLabel)}</div>
    <div><b>Their invoice</b>${esc(note.invoice_ref || '—')}</div>
    <div><b>Invoice date</b>${note.invoice_date ? fmtDate(note.invoice_date) : '—'}</div>
    <div><b>Supply type</b>${interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</div>
  </div>

  <table>
    <thead><tr>
      <th class="c">#</th><th>Description</th><th class="c">HSN</th>
      <th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th>
      <th class="c">GST</th>${taxCols}<th class="r">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${note.notes ? `<div class="note-body"><b>Notes:</b> ${esc(note.notes)}</div>` : ''}

  <div class="foot">
    <div class="words">
      <div class="lbl">Amount in words</div>
      <div class="val">${esc(amountInWords(note.total_paise))}</div>
    </div>
    <div class="sums"><table>
      <tr><td>Taxable value</td><td class="r">${rupees(note.taxable_paise)}</td></tr>
      ${interstate
        ? `<tr><td>IGST</td><td class="r">${rupees(note.igst_paise)}</td></tr>`
        : `<tr><td>CGST</td><td class="r">${rupees(note.cgst_paise)}</td></tr>
           <tr><td>SGST</td><td class="r">${rupees(note.sgst_paise)}</td></tr>`}
      ${note.round_off_paise ? `<tr><td>Round off</td><td class="r">${rupees(note.round_off_paise)}</td></tr>` : ''}
      <tr class="total"><td>Total debited</td><td class="r">₹ ${rupees(note.total_paise)}</td></tr>
    </table></div>
  </div>

  <div class="sign">
    <div class="box"><div class="line">Supplier acknowledgement</div></div>
    <div class="box"><div class="line">For ${esc(ISSUER.legalName)}<br>Authorised signatory</div></div>
  </div>

  <div class="fineprint">
    This debit note is raised by ${esc(ISSUER.legalName)} on the supplier named above in respect of
    the goods listed. It records a claim against the supplier and is issued for commercial and
    accounting purposes. Where the supply is taxable, any corresponding reduction in the supplier's
    output tax liability is to be effected by a credit note issued by the supplier under section 34
    of the CGST Act, 2017. Computer generated document.
  </div>

</div>
<script>window.onload = function () { window.print() }<\/script>
</body></html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) {
    alert('Please allow pop-ups for this site to print the debit note.')
    return
  }
  w.document.write(html)
  w.document.close()
}
