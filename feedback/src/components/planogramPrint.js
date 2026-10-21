/**
 * The planogram sheet a refiller carries to a machine.
 *
 * Written like the run sheet, for someone standing in front of a machine with
 * a crate: the grid is laid out the way the machine is, each slot shows what
 * goes there with a picture of it, and underneath, in order, what to use when
 * that product is not on the van. A refiller cannot phone anybody from a
 * basement car park, so the answer has to be on the paper.
 *
 * Pictures are the point of printing this at all. Brand names in English are
 * not how everyone reads a shelf.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmtToday = () => {
  const d = new Date()
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

const rupees = (paise) =>
  paise == null ? '' : `₹${(paise / 100).toLocaleString('en-IN')}`

const SHEET_CSS = `
  /* A printed document paints its own ground: without an explicit
     background and color-scheme it inherits the viewer's dark theme and
     previews as black on black. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #000; background: #fff; font-size: 11pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { padding: 10mm 10mm 12mm; page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }

  .top { border-bottom: 2.5pt solid #000; padding-bottom: 6pt; margin-bottom: 10pt;
         display: flex; justify-content: space-between; align-items: flex-end; gap: 10pt; }
  .pod { font-size: 20pt; font-weight: 800; letter-spacing: -0.4pt; line-height: 1.1; }
  .where { font-size: 10.5pt; color: #333; margin-top: 2pt; }
  .meta { font-size: 9pt; color: #555; text-align: right; white-space: nowrap; }
  .kicker { font-size: 8.5pt; font-weight: 800; letter-spacing: 1pt;
            text-transform: uppercase; color: #555; }

  .row { page-break-inside: avoid; margin-bottom: 7pt; }
  .rowhead {
    font-size: 8.5pt; font-weight: 800; letter-spacing: 1pt; text-transform: uppercase;
    color: #fff; background: #000; padding: 2pt 6pt; border-radius: 2pt;
    display: inline-block; margin-bottom: 4pt;
  }
  .cells { display: grid; gap: 5pt; }

  .cell {
    border: 1pt solid #000; border-radius: 3pt; padding: 5pt;
    page-break-inside: avoid; min-height: 34mm;
    display: flex; flex-direction: column; gap: 4pt;
  }
  /* An empty slot is stated rather than left blank: blank on a printed sheet
     reads as "this page is wrong", and someone will fill it with a guess. */
  .cell.empty { border-style: dashed; color: #666; }

  .slotline { display: flex; align-items: baseline; justify-content: space-between; gap: 5pt; }
  .slot { font-size: 14pt; font-weight: 800; letter-spacing: -0.2pt; }
  .cap { font-size: 8.5pt; color: #444; white-space: nowrap; }

  .first { display: flex; gap: 5pt; align-items: flex-start; }
  .shot {
    width: 17mm; height: 17mm; flex: 0 0 17mm;
    border: 0.75pt solid #bbb; border-radius: 2pt; background: #fff;
    object-fit: contain;
  }
  .noshot {
    width: 17mm; height: 17mm; flex: 0 0 17mm;
    border: 0.75pt dashed #bbb; border-radius: 2pt;
    display: flex; align-items: center; justify-content: center;
    font-size: 7pt; color: #888; text-align: center; line-height: 1.2; padding: 2pt;
  }
  .pname { font-size: 10.5pt; font-weight: 700; line-height: 1.2; }
  .pmeta { font-size: 8.5pt; color: #444; margin-top: 1.5pt; }

  .alts { border-top: 0.75pt solid #ccc; padding-top: 3pt; margin-top: auto; }
  .altshead {
    font-size: 7.5pt; font-weight: 800; letter-spacing: 0.6pt;
    text-transform: uppercase; color: #555;
  }
  .alt { font-size: 9pt; line-height: 1.35; }
  .altn { font-weight: 800; }
  .note { font-size: 8.5pt; font-style: italic; color: #444; margin-top: 2pt; }

  .foot { margin-top: 10pt; border-top: 1pt solid #999; padding-top: 5pt;
          font-size: 8.5pt; color: #555; }

  @media print { @page { size: __PAGE__; margin: 0; } }
`

function cell(slot) {
  const [first, ...alts] = slot.choices || []

  // A picture that will not load is swapped for the same gap a missing one
  // leaves. An empty framed square on a printed sheet reads as a mistake.
  const shot = first?.imageUrl
    ? `<img class="shot" src="${esc(first.imageUrl)}" alt=""
            onerror="this.outerHTML='&lt;div class=\'noshot\'&gt;no picture&lt;/div&gt;'">`
    : `<div class="noshot">no picture</div>`

  const body = first
    ? `<div class="first">
         ${shot}
         <div>
           <div class="pname">${esc(first.name)}</div>
           <div class="pmeta">${esc(first.sku || '')}${
             first.mrpPaise != null ? ` · ${esc(rupees(first.mrpPaise))}` : ''
           }</div>
         </div>
       </div>`
    : `<div class="pname">Leave empty</div>`

  // Ranks are printed as the numbers they are, so "second choice" on the sheet
  // and "rank 2" in the panel are plainly the same thing.
  const altList = alts.length
    ? `<div class="alts">
         <div class="altshead">If not available</div>
         ${alts.map((a) => `<div class="alt"><span class="altn">${a.rank}.</span> ${esc(a.name)}</div>`).join('')}
       </div>`
    : ''

  return `<div class="cell ${first ? '' : 'empty'}">
    <div class="slotline">
      <span class="slot">${esc(slot.slotName)}</span>
      ${slot.capacity != null ? `<span class="cap">holds ${slot.capacity}</span>` : ''}
    </div>
    ${body}
    ${slot.note ? `<div class="note">${esc(slot.note)}</div>` : ''}
    ${altList}
  </div>`
}

/**
 * Groups the slots into the rows of the machine.
 *
 * Slots with no row number go into a row of their own at the end rather than
 * being dropped or guessed at: a slot missing from the sheet is a slot that
 * does not get filled.
 */
export function groupRows(slots) {
  const rows = new Map()
  const loose = []
  for (const s of slots) {
    if (s.rowNumber == null) { loose.push(s); continue }
    if (!rows.has(s.rowNumber)) rows.set(s.rowNumber, [])
    rows.get(s.rowNumber).push(s)
  }
  const out = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, cells]) => ({
      rowNumber,
      cells: cells.sort((a, b) =>
        (a.columnNumber ?? 0) - (b.columnNumber ?? 0)
        || String(a.slotName).localeCompare(String(b.slotName), undefined, { numeric: true })),
    }))
  if (loose.length) {
    out.push({
      rowNumber: null,
      cells: loose.sort((a, b) =>
        String(a.slotName).localeCompare(String(b.slotName), undefined, { numeric: true })),
    })
  }
  return out
}

export function printPlanogram({ pod, slots, page = 'A4 landscape', columns = 0 }) {
  if (!pod) return
  const w = window.open('', '_blank', 'width=1100,height=900')
  if (!w) { alert('Please allow pop-ups for this site to print the planogram.'); return }

  const rows = groupRows(slots)
  // Every row is drawn on the same number of columns as the widest one, so the
  // printed grid lines up with the machine instead of re-flowing per row.
  const widest = Math.max(1, ...rows.map((r) => r.cells.length))
  const cols = columns > 0 ? columns : widest

  const filled = slots.filter((s) => (s.choices || []).length).length
  const withAlts = slots.filter((s) => (s.choices || []).length > 1).length

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(pod.label || pod.podId)} — planogram</title>
<style>${SHEET_CSS.replace('__PAGE__', esc(page))}</style></head>
<body>
  <div class="sheet">
    <div class="top">
      <div>
        <div class="kicker">Planogram</div>
        <div class="pod">${esc(pod.label || pod.podId)}</div>
        <div class="where">${esc(pod.location || '')}${pod.city ? ` · ${esc(pod.city)}` : ''}</div>
      </div>
      <div class="meta">
        ${esc(pod.podId)}<br>
        ${esc(fmtToday())}<br>
        ${filled} of ${slots.length} slots planned
      </div>
    </div>

    ${rows.map((r) => `
      <div class="row">
        <div class="rowhead">${r.rowNumber == null ? 'Other slots' : `Row ${r.rowNumber}`}</div>
        <div class="cells" style="grid-template-columns: repeat(${cols}, 1fr)">
          ${r.cells.map(cell).join('')}
        </div>
      </div>`).join('')}

    <div class="foot">
      Load the first choice. If it is not on the van, work down the list under
      “If not available”. ${withAlts} of ${slots.length} slots have a second choice.
      Printed ${esc(fmtToday())} — check the panel for a newer plan.
    </div>
  </div>
<script>window.onload = function () { window.print() }<\/script>
</body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}
