/* =====================================================================
   vNetra → Fetch : capture how a product is written
   =====================================================================
   Records the Firestore write vNetra makes when YOU add one product, so
   the Fetch push proxy can create products in exactly the same shape.

   Run this once. After that the proxy can be built and this script is
   never needed again.

   HOW TO RUN
     1. Open https://vnetra.in and sign in.
     2. DevTools → Console (Cmd+Option+J), paste this whole file, Enter.
     3. Add ONE product through vNetra's normal "add product" screen.
        Use a real product you actually need — nothing here is undone.
     4. Run  __vnetraSchema.save()  to download the capture.
     5. Send me that file.

   WHAT IT RECORDS
     The request URL, method and BODY of writes to Firestore and to
     Google Cloud Functions — that is, the document path and the field
     names vNetra uses for a product.

   WHAT IT DELIBERATELY DOES NOT RECORD
     Authorization headers, cookies, ID tokens, refresh tokens and API
     keys are stripped before anything is stored, and stripped again on
     the way out. Check the file before you send it — it is plain JSON
     and you can read every line of it.

     It records nothing until you add a product, and it only watches
     WRITES. Reads, page loads and analytics are ignored.
   ===================================================================== */
(() => {
const SECRET_KEYS = /^(authorization|cookie|x-goog-api-key|x-firebase-appcheck|proxy-authorization)$/i
const SECRET_FIELDS = /(token|password|secret|apikey|api_key|credential|idtoken|refreshtoken|authorization)/i

/** Recursively blanks anything that looks like a credential. Applied to every
 *  captured body, so a token buried in a nested object does not slip out. */
function redact(value, depth = 0) {
  if (depth > 8) return '[deep]'
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELDS.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string') {
    // Bare JWTs anywhere in a string value.
    if (/^ey[A-Za-z0-9_-]{10,}\./.test(value)) return '[redacted jwt]'
    if (value.length > 3000) return value.slice(0, 3000) + '…[truncated]'
  }
  return value
}

const parseBody = (body) => {
  if (!body) return null
  if (typeof body === 'string') {
    try { return redact(JSON.parse(body)) } catch { return redact(body) }
  }
  if (body instanceof URLSearchParams) return redact(Object.fromEntries(body))
  return `[${body.constructor?.name || typeof body}]`
}

const INTERESTING = /firestore\.googleapis\.com|cloudfunctions\.net|firebasedatabase|\/v1\/projects\/[^/]+\/databases/
const WRITES = /^(POST|PATCH|PUT|DELETE)$/i

const S = window.__vnetraSchema = { calls: [], armedAt: new Date().toISOString() }

const note = (method, url, body) => {
  if (!INTERESTING.test(url)) return
  if (!WRITES.test(method) && !/:(commit|batchWrite|runQuery)/.test(url)) return
  S.calls.push({
    at: new Date().toISOString(),
    method: method.toUpperCase(),
    // The path is what matters; a query string can carry a key, so it goes.
    url: String(url).split('?')[0],
    body: parseBody(body),
  })
  console.log(`  captured ${method.toUpperCase()} ${String(url).split('?')[0].slice(0, 90)}  (${S.calls.length} so far)`)
}

const origFetch = window.fetch
window.fetch = function (input, init = {}) {
  try {
    const url = typeof input === 'string' ? input : input?.url
    const method = init?.method || (typeof input !== 'string' ? input?.method : null) || 'GET'
    note(method, url, init?.body)
  } catch { /* never let the recorder break the page */ }
  return origFetch.apply(this, arguments)
}

const origOpen = XMLHttpRequest.prototype.open
const origSend = XMLHttpRequest.prototype.send
XMLHttpRequest.prototype.open = function (method, url) {
  this.__m = method; this.__u = url
  return origOpen.apply(this, arguments)
}
XMLHttpRequest.prototype.send = function (body) {
  try { note(this.__m || 'GET', this.__u || '', body) } catch { /* ignore */ }
  return origSend.apply(this, arguments)
}

S.save = () => {
  if (!S.calls.length) {
    console.warn('Nothing captured yet. Add a product first, then run __vnetraSchema.save()')
    return
  }
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `vnetra-write-capture-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  console.log(`Saved ${S.calls.length} calls. Read the file before sending it.`)
}

S.stop = () => { window.fetch = origFetch; XMLHttpRequest.prototype.open = origOpen; XMLHttpRequest.prototype.send = origSend; console.log('Recorder off.') }

console.log('%cvNetra write recorder armed.', 'font-weight:bold')
console.log('Now add ONE product through the normal screen, then run:  __vnetraSchema.save()')
console.log('Credentials are stripped before anything is stored. Turn it off with __vnetraSchema.stop()')
})();
