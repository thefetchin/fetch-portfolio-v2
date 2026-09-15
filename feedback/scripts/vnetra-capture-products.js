/* =====================================================================
   vNetra → Fetch : capture the product catalogue
   =====================================================================
   Reads every product vNetra holds and saves it as a .json file, which
   you then load in the Fetch dashboard under
   Inventory → Compare with vNetra.

   HOW TO RUN
     1. Open https://vnetra.in/products/view and sign in.
     2. DevTools → Console (Cmd+Option+J), paste this whole file, Enter.
     3. It pages through the list and downloads vnetra-products-<date>.json.
     4. In admin.thefetch.in → Inventory → Compare with vNetra,
        choose that file, then press Compare.

   WHY A FILE AND NOT A DIRECT UPLOAD
     The Fetch inventory API sends no CORS headers, on purpose: it is
     authenticated by a cookie, and opening it to other origins would be a
     real CSRF hole in the dashboard. A file hands the data over without
     punching that hole, and it also means you can see exactly what is
     being sent before you send it.

   THIS SCRIPT ONLY READS. It changes nothing in vNetra.
   ===================================================================== */
(() => {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, timeout = 15000, step = 200) => {
  const end = Date.now() + timeout
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step) }
}

const rows     = () => [...document.querySelectorAll('tr')]
const cellsOf  = (r) => [...r.querySelectorAll('td')].map((c) => c.textContent.trim())
// Alphanumeric brand segment: "7 Up" gives AT17UP0022857, which an
// [A-Z]{3} pattern would silently skip.
const codeOf   = (r) => cellsOf(r).find((t) => /^AT1[A-Z0-9]{3}\d{7}$/.test(t))
const hasThumb = (r) => (r.querySelector('img')?.src || '').includes('products%2Fthumbs')

/** The product name is the longest cell that is not the code and not a number
 *  — vNetra's column order has moved before, so this does not trust position. */
const nameOf = (r) => {
  const code = codeOf(r)
  const candidates = cellsOf(r)
    .filter((t) => t && t !== code && !/^[\d.,₹%\s-]*$/.test(t) && t.length < 120)
  return candidates.sort((a, b) => b.length - a.length)[0] || null
}

const collected = new Map()

function harvest() {
  let added = 0
  for (const r of rows()) {
    const code = codeOf(r)
    if (!code || collected.has(code)) continue
    collected.set(code, { code, name: nameOf(r), hasImage: hasThumb(r) })
    added++
  }
  return added
}

/** Finds the pagination "next" control, whatever it is called this week. */
function nextControl() {
  const byLabel = [...document.querySelectorAll('button,a,[role=button]')].find((el) => {
    const s = `${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.textContent || ''}`.trim()
    return /^(next|›|»|>)$/i.test(s) || /next page/i.test(s)
  })
  if (byLabel && !byLabel.disabled && byLabel.getAttribute('aria-disabled') !== 'true') return byLabel
  return null
}

async function run() {
  console.log('%cvNetra product capture', 'font-weight:bold')
  harvest()
  console.log(`  page 1 — ${collected.size} products so far`)

  for (let page = 2; page <= 60; page++) {
    const next = nextControl()
    if (!next) break
    const before = collected.size
    next.click()
    // Wait for the table to actually change rather than for a fixed delay:
    // a slow page would otherwise be harvested twice and the last one missed.
    await until(() => harvest() > 0, 12000)
    if (collected.size === before) break
    console.log(`  page ${page} — ${collected.size} products so far`)
    await sleep(250)
  }

  const products = [...collected.values()]
  if (!products.length) {
    console.warn('No products found. Is the product list actually on screen?')
    return
  }

  const payload = { source: 'browser_bridge', capturedAt: new Date().toISOString(), products }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vnetra-products-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)

  const withImages = products.filter((p) => p.hasImage).length
  console.log(
    `%cCaptured ${products.length} products (${withImages} with images). File downloaded.`,
    'font-weight:bold'
  )
  console.log('Load it in admin.thefetch.in → Inventory → Compare with vNetra.')
  window.__vnetraCapture = payload
}

run()
})();
