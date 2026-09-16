/**
 * Tests for the WhatsApp delivery webhook.
 *
 *   node tests/whatsapp-webhook-unit.mjs
 *
 * The webhook is a PUBLIC endpoint that writes "this message was delivered"
 * into our records. If it accepted unsigned callbacks, anyone who learned the
 * URL could mark anything delivered — so most of what follows is about what it
 * refuses.
 */

import { handleWebhook, handleWebhookVerify } from '../worker/whatsapp-send.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const SECRET = 'app-secret'
const sign = async (raw) => {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A D1 stand-in that records the bindings each statement was run with. */
const fakeDb = () => {
  const runs = []
  return {
    runs,
    prepare: (sql) => ({
      bind: (...args) => ({ run: async () => { runs.push({ sql, args }); return {} } }),
    }),
  }
}

const post = async (env, body, signature) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return handleWebhook(new Request('https://x/api/whatsapp/webhook', {
    method: 'POST',
    body: raw,
    headers: signature ? { 'x-hub-signature-256': signature } : {},
  }), env, null)
}

const statusBody = (id, status, errors) => ({
  entry: [{ changes: [{ value: { statuses: [{ id, status, ...(errors ? { errors } : {}) }] } }] }],
})

/* --------------------------------------------------------- verification -- */
section('the subscription handshake')

const vEnv = { WHATSAPP_VERIFY_TOKEN: 'sekret' }
const verify = (qs) => handleWebhookVerify(new Request(`https://x/api/whatsapp/webhook?${qs}`), vEnv)

const good = verify('hub.mode=subscribe&hub.verify_token=sekret&hub.challenge=12345')
eq('the right token echoes the challenge', [good.status, await good.text()], [200, '12345'])

const wrong = verify('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345')
eq('the wrong token is refused', wrong.status, 403)
eq('no token configured is refused', handleWebhookVerify(
  new Request('https://x/?hub.mode=subscribe&hub.verify_token=&hub.challenge=1'), {}).status, 403)

/* ------------------------------------------------------------ signature -- */
section('who is allowed to write delivery statuses')

const env = () => ({ WHATSAPP_APP_SECRET: SECRET, DB: fakeDb() })

const body = statusBody('wamid.ABC', 'delivered')
const raw = JSON.stringify(body)

let e = env()
const forged = await post(e, raw, 'sha256=' + '0'.repeat(64))
eq('a forged signature is refused', forged.status, 403)
eq('and writes nothing', e.DB.runs.length, 0)

e = env()
const unsigned = await post(e, raw, null)
eq('no signature at all is refused', unsigned.status, 403)
eq('and writes nothing', e.DB.runs.length, 0)

// An unset secret must not mean "trust everyone" -- that is the failure that
// turns a missing config line into an open write endpoint.
e = { DB: fakeDb() }
const noSecret = await post(e, raw, await sign(raw))
eq('with no app secret configured the callback is refused, not trusted',
  noSecret.status, 503)
eq('and writes nothing', e.DB.runs.length, 0)

e = env()
const okRes = await post(e, raw, await sign(raw))
eq('a correct signature is accepted', okRes.status, 200)
eq('and writes one row', e.DB.runs.length, 1)
eq('binding the message id and status',
  [e.DB.runs[0].args[0], e.DB.runs[0].args[1]], ['wamid.ABC', 'delivered'])

/* ---------------------------------------------------------- the payload -- */
section('reading what Meta sends')

e = env()
await post(e, JSON.stringify(statusBody('wamid.X', 'nonsense')), await sign(JSON.stringify(statusBody('wamid.X', 'nonsense'))))
eq('an unknown status is ignored rather than stored', e.DB.runs.length, 0)

const withErr = statusBody('wamid.Y', 'failed', [{
  code: 131049, title: 'Message not delivered to maintain quality',
  error_data: { details: 'per-user marketing limit' },
}])
const rawErr = JSON.stringify(withErr)
e = env()
await post(e, rawErr, await sign(rawErr))
eq('Meta\'s failure reason is kept, code and all',
  e.DB.runs[0].args[2],
  '(#131049) Message not delivered to maintain quality per-user marketing limit')

// Meta retries a webhook that errors and eventually disables it, so anything
// unusable must still answer 200.
const junk = 'not json at all'
e = env()
const bad = await post(e, junk, await sign(junk))
eq('unparseable json still answers 200, or Meta disables the webhook', bad.status, 200)

const empty = JSON.stringify({ entry: [] })
e = env()
eq('a payload with no statuses answers 200',
  (await post(e, empty, await sign(empty))).status, 200)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
