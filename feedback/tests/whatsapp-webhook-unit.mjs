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

// A status id could belong to a template send OR to a typed reply, and the
// webhook cannot tell which. Both tables are updated; only one will match.
eq('it updates both outbound tables', e.DB.runs.length, 2)
eq('the first is the template sends table', /whatsapp_sends/.test(e.DB.runs[0].sql), true)
eq('the second is the replies table', /whatsapp_replies/.test(e.DB.runs[1].sql), true)
eq('both bound to the same message id and status',
  e.DB.runs.map((r) => [r.args[0], r.args[1]]),
  [['wamid.ABC', 'delivered'], ['wamid.ABC', 'delivered']])

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

/* ------------------------------------------------- messages from people -- */
section('messages customers send us')

const msgBody = (m, contacts) => ({
  entry: [{ changes: [{ value: { messages: [m], ...(contacts ? { contacts } : {}) } }] }],
})

const send = async (payload) => {
  const raw = JSON.stringify(payload)
  const e2 = env()
  const res = await post(e2, raw, await sign(raw))
  return { res, runs: e2.DB.runs }
}

const plain = await send(msgBody(
  { id: 'wamid.IN1', from: '919876543210', type: 'text', timestamp: '1789000000',
    text: { body: 'Is the pod working?' } },
  [{ wa_id: '919876543210', profile: { name: 'Asha' } }]
))
eq('an inbound message is stored', plain.runs.length, 1)
eq('with sender, name, type and text',
  plain.runs[0].args.slice(0, 5),
  ['wamid.IN1', '919876543210', 'Asha', 'text', 'Is the pod working?'])

// An image or a location is still a customer trying to reach us. Dropping it
// because it has no text would lose the contact entirely.
const image = await send(msgBody(
  { id: 'wamid.IN2', from: '919876543210', type: 'image', image: { caption: 'broken slot' } }
))
eq('a message with no text still gets a row', image.runs.length, 1)
eq('and its caption is used as the body', image.runs[0].args[4], 'broken slot')

const tapped = await send(msgBody(
  { id: 'wamid.IN3', from: '91', type: 'button', button: { text: 'Find this Pod' } }
))
eq('a button tap is captured', tapped.runs[0].args[4], 'Find this Pod')

/* STOP is an opt-out and honouring it is not optional -- it must not wait for
   somebody to read the inbox. */
const stop = await send(msgBody(
  { id: 'wamid.IN4', from: '919876543210', type: 'text', text: { body: 'STOP' } }
))
eq('STOP writes the message AND unsubscribes them', stop.runs.length, 2)
eq('the opt-out targets that number',
  [/whatsapp_optins/.test(stop.runs[1].sql), stop.runs[1].args[0]],
  [true, '919876543210'])
eq('it only touches active rows, so an earlier opt-out date is not rewritten',
  /status = 'active'/.test(stop.runs[1].sql), true)

const lower = await send(msgBody(
  { id: 'wamid.IN5', from: '91', type: 'text', text: { body: '  stop ' } }
))
eq('lower case and stray spaces still count as STOP', lower.runs.length, 2)

const stopword = await send(msgBody(
  { id: 'wamid.IN6', from: '91', type: 'text', text: { body: 'stopped working' } }
))
eq('but "stopped working" is a complaint, not an opt-out', stopword.runs.length, 1)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
