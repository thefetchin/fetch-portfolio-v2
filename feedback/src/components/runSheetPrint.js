/**
 * The run sheet, and the red bag label.
 *
 * This is the only thing a refiller receives from us, so it is written for
 * someone standing in front of a machine with a crate: plain words, slot
 * numbers, bag numbers, and no codes to interpret. Remove-first comes before
 * load, because pulling before loading is what keeps FEFO satisfiable.
 *
 * Deliberately not shown: batch codes, costs, suppliers, expiry arithmetic.
 * A refiller does not need to decide anything, and every extra field is another
 * thing to misread.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

const qty = (milli) => {
  if (milli == null) return ''
  const n = milli / 1000
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

const SHEET_CSS = `
  /* A printed document paints its own ground: without an explicit
     background and color-scheme it inherits the viewer's dark theme and
     previews as black on black. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #000; background: #fff; font-size: 12pt;
  }
  .sheet { padding: 14mm 14mm 18mm; page-break-after: always; }
  .top { border-bottom: 2.5pt solid #000; padding-bottom: 6pt; margin-bottom: 14pt; }
  .pod { font-size: 21pt; font-weight: 800; letter-spacing: -0.4pt; line-height: 1.1; }
  .where { font-size: 11pt; color: #333; margin-top: 2pt; }
  .runmeta { font-size: 10pt; color: #555; margin-top: 5pt; }
  h2 {
    font-size: 13pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6pt;
    margin: 16pt 0 7pt; padding: 4pt 7pt; border-radius: 2pt;
  }
  h2.remove { background: #000; color: #fff; }
  h2.load   { background: #eee; color: #000; border: 1pt solid #000; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-size: 8.5pt; letter-spacing: 0.6pt; text-transform: uppercase;
    color: #444; border-bottom: 1pt solid #999; padding: 0 6pt 3pt;
  }
  td { padding: 7pt 6pt; border-bottom: 0.75pt solid #ccc; vertical-align: middle; }
  .slot { font-size: 17pt; font-weight: 800; white-space: nowrap; width: 20mm; }
  .what { font-size: 12pt; }
  .what small { display: block; font-size: 9.5pt; color: #444; margin-top: 1pt; }
  .count { font-size: 17pt; font-weight: 800; text-align: right; white-space: nowrap; width: 26mm; }
  .bag {
    font-size: 11pt; font-weight: 700; white-space: nowrap; width: 22mm; text-align: center;
    border: 1.25pt solid #000; border-radius: 2pt; padding: 3pt 0;
  }
  .tick { width: 12mm; text-align: center; }
  .tick span { display: inline-block; width: 6.5mm; height: 6.5mm; border: 1.25pt solid #000; }
  .none { font-size: 11pt; color: #555; padding: 6pt; }
  .footnote {
    margin-top: 16pt; padding: 8pt 10pt; border: 1.25pt solid #000; border-radius: 2pt;
    font-size: 11pt; font-weight: 600;
  }
  .sign { margin-top: 20pt; display: flex; gap: 14mm; font-size: 10pt; }
  .sign div { flex: 1; border-top: 1pt solid #333; padding-top: 4pt; }
  @media print { @page { size: A4; margin: 0; } }
`

const BAG_CSS = `
  /* A printed document paints its own ground: without an explicit
     background and color-scheme it inherits the viewer's dark theme and
     previews as black on black. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #000; background: #fff;
  }
  .label {
    width: 99mm; height: 67mm; padding: 7mm; page-break-after: always;
    display: flex; flex-direction: column; justify-content: space-between;
    border: 3mm solid #000;
  }
  .kicker { font-size: 10pt; letter-spacing: 1.4pt; text-transform: uppercase; font-weight: 700; }
  .big { font-size: 30pt; font-weight: 800; line-height: 1; letter-spacing: -0.6pt; }
  .sub { font-size: 12pt; margin-top: 3mm; }
  .foot { font-size: 10pt; color: #333; }
  @media print { @page { size: 99mm 67mm; margin: 0; } }
`

function sheetForPod(detail, podId) {
  const stop = detail.stops.find((s) => s.podId === podId)
  const pulls = detail.pulls.filter((p) => p.podId === podId)
  const load = detail.load.filter((l) => l.podId === podId)

  const pullRows = pulls.length ? pulls.map((p) => `
    <tr>
      <td class="slot">${esc(p.slotName || '—')}</td>
      <td class="what">${esc(p.productName)}
        <small>${p.reason === 'expired' ? `expired ${esc(fmtDate(p.expiryDate))}` : esc(p.reason.replace(/_/g, ' '))} — put in the RED bag</small>
      </td>
      <td class="count">TAKE OUT<br>${esc(qty(p.qtyMilli))}</td>
      <td class="tick"><span></span></td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="none">Nothing to take out at this machine.</td></tr>'

  const loadRows = load.length ? load.map((l) => `
    <tr>
      <td class="slot">${esc(l.slotName)}</td>
      <td class="what">${esc(l.productName)}</td>
      <td class="bag">BAG ${esc(l.bagNo)}</td>
      <td class="count">${esc(qty(l.plannedMilli))}</td>
      <td class="tick"><span></span></td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="none">Nothing to load at this machine.</td></tr>'

  return `
  <div class="sheet">
    <div class="top">
      <div class="pod">${esc(stop?.label || podId)}</div>
      <div class="where">${esc(stop?.location || '')}</div>
      <div class="runmeta">
        ${esc(detail.run.runNumber)} &nbsp;·&nbsp; ${esc(fmtDate(detail.run.runDate))}
        ${detail.run.assignedTo?.name ? ` &nbsp;·&nbsp; ${esc(detail.run.assignedTo.name)}` : ''}
        ${detail.stops.length > 1 ? ` &nbsp;·&nbsp; stop ${esc(stop?.seq)} of ${detail.stops.length}` : ''}
      </div>
    </div>

    <h2 class="remove">1 &nbsp; Take these out first</h2>
    <table>
      <thead><tr><th>Slot</th><th>What</th><th>How many</th><th>Done</th></tr></thead>
      <tbody>${pullRows}</tbody>
    </table>

    <h2 class="load">2 &nbsp; Then load these</h2>
    <table>
      <thead><tr><th>Slot</th><th>What</th><th>From</th><th>How many</th><th>Done</th></tr></thead>
      <tbody>${loadRows}</tbody>
    </table>

    <div class="footnote">
      Put the quantities into the machine app as usual.${
        pulls.length ? ' Bring the RED bag back to the warehouse — do not put anything from it into a machine.' : ''
      }
    </div>

    <div class="sign">
      <div>Done by</div><div>Date and time</div><div>Anything wrong? Write it here</div>
    </div>
  </div>`
}

/** One A4 sheet per Pod on the run. */
export function printRunSheet(detail) {
  if (!detail?.run) return
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) { alert('Please allow pop-ups for this site to print the run sheet.'); return }

  const pods = detail.stops.length
    ? detail.stops.map((s) => s.podId)
    : [...new Set(detail.load.map((l) => l.podId))]

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(detail.run.runNumber)} — run sheet</title>
<style>${SHEET_CSS}</style></head>
<body>${pods.map((p) => sheetForPod(detail, p)).join('')}
<script>window.onload = function () { window.print() }<\/script>
</body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}

/**
 * A label for the bag pulled stock comes back in.
 *
 * It exists so returned stock is attributable when the crate reaches the
 * warehouse. The refiller does not decide where it goes -- the pull reason does
 * -- so the label says only which run and Pod it came from.
 */
export function printReturnBagLabel(detail, podId = null) {
  if (!detail?.run) return
  const w = window.open('', '_blank', 'width=700,height=520')
  if (!w) { alert('Please allow pop-ups for this site to print the label.'); return }

  const pods = podId ? [podId] : (detail.stops.map((s) => s.podId))
  const labels = pods.map((pid) => {
    const stop = detail.stops.find((s) => s.podId === pid)
    const n = detail.pulls.filter((p) => p.podId === pid).length
    return `
    <div class="label">
      <div>
        <div class="kicker">Return to warehouse</div>
        <div class="big">RED BAG</div>
        <div class="sub">${esc(stop?.label || pid)}</div>
      </div>
      <div class="foot">
        ${esc(detail.run.runNumber)} · ${esc(fmtDate(detail.run.runDate))}<br>
        ${n} item${n === 1 ? '' : 's'} to pull · do not put any of this into a machine
      </div>
    </div>`
  }).join('')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Return bag — ${esc(detail.run.runNumber)}</title>
<style>${BAG_CSS}</style></head>
<body>${labels}
<script>window.onload = function () { window.print() }<\/script>
</body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}
