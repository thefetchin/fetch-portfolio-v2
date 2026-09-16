/**
 * Tests for sending the refill message.
 *
 *   node tests/whatsapp-send-unit.mjs
 *
 * These messages reach customers' phones, so the things worth pinning down are
 * the ones that would embarrass us: a variable that makes Meta reject the whole
 * send, a template pointed at a field it should not read, and a token error
 * reported as something retryable.
 */

import {
  fillVariables, sendTemplate, WhatsappError, VARIABLE_FIELDS, MAX_SENDS_PER_CALL,
  buildComponents,
} from '../worker/whatsapp-send.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

/* ------------------------------------------------------------ variables -- */
section('filling template variables')

const pod = { label: 'Fetch Pod 003', location: 'Lucia Mansion lobby', city: 'Mangalore' }

eq('in the order the template expects',
  fillVariables(['pod_label', 'pod_city'], pod),
  [{ type: 'text', text: 'Fetch Pod 003' }, { type: 'text', text: 'Mangalore' }])

// Meta rejects the whole message for an empty variable, so a missing field has
// to become something visible rather than an empty string.
eq('a missing field becomes a visible placeholder, not an empty string',
  fillVariables(['pod_location'], { label: 'x' }),
  [{ type: 'text', text: '—' }])

// A newline in a variable is also rejected by Meta, and a two-line address is
// an entirely ordinary thing to have typed into the location box.
eq('newlines are flattened',
  fillVariables(['pod_location'], { location: 'Ground floor\nLucia Mansion' }),
  [{ type: 'text', text: 'Ground floor Lucia Mansion' }])

// A template must not be able to name a field it has no business reading.
eq('an unknown field is dropped, not guessed at',
  fillVariables(['pod_label', 'contact_phone', 'password'], pod),
  [{ type: 'text', text: 'Fetch Pod 003' }])
eq('the allowed fields are only Pod display details',
  VARIABLE_FIELDS, ['pod_label', 'pod_location', 'pod_city'])
eq('no variables is no components', fillVariables([], pod), [])
eq('rubbish input is safe', fillVariables(null, pod), [])

/* --------------------------------------------------------------- sending -- */
section('the call to Meta')

const baseEnv = { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123' }
let lastCall = null
const stub = (status, body) => {
  globalThis.fetch = async (url, init) => {
    lastCall = { url, init, body: JSON.parse(init.body) }
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    })
  }
}

stub(200, { messages: [{ id: 'wamid.TEST' }] })
const ok = await sendTemplate(baseEnv, {
  to: '919876543210', template: 'fetch_refill', language: 'en_US',
  components: [{ type: 'body', parameters: [{ type: 'text', text: 'Pod 3' }] }],
})
eq('returns the message id', ok, { ok: true, messageId: 'wamid.TEST' })
eq('posts to the phone number id',
  lastCall.url, 'https://graph.facebook.com/v25.0/123/messages')
eq('bearer token in the header', lastCall.init.headers.authorization, 'Bearer tok')
eq('sends a template, never free text',
  [lastCall.body.type, lastCall.body.messaging_product, lastCall.body.template.name],
  ['template', 'whatsapp', 'fetch_refill'])

// With no variables the components key must be absent entirely -- Meta rejects
// an empty array.
stub(200, { messages: [{ id: 'x' }] })
await sendTemplate(baseEnv, { to: '91', template: 't', language: 'en_US', components: [] })
eq('an empty components array is omitted', 'components' in lastCall.body.template, false)

// A seam for testing only. Unset in production, where it is Meta's own host.
stub(200, { messages: [{ id: 'x' }] })
await sendTemplate({ ...baseEnv, WHATSAPP_BASE_URL: 'http://localhost:8898' },
  { to: '91', template: 't' })
eq('the base url can be overridden, and defaults to Meta',
  lastCall.url, 'http://localhost:8898/v25.0/123/messages')

/* ---------------------------------------------------------------- errors -- */
section('when it goes wrong')

const caught = async (fn) => { try { await fn(); return null } catch (e) { return e } }

stub(401, { error: { message: 'Session has expired', code: 190 } })
const expired = await caught(() => sendTemplate(baseEnv, { to: '91', template: 't' }))
eq('an expired token gets its own code, because retrying cannot fix it',
  [expired.code, expired.status], ['whatsapp_token_expired', 503])
eq('and Meta\'s own wording survives', /expired/i.test(expired.message), true)

stub(400, { error: { message: 'Template name does not exist', code: 132001 } })
const badTemplate = await caught(() => sendTemplate(baseEnv, { to: '91', template: 'nope' }))
eq('an unapproved template is reported as Meta described it',
  [badTemplate.code, /Template name does not exist/.test(badTemplate.message)],
  ['whatsapp_rejected', true])

const unconfigured = await caught(() => sendTemplate({}, { to: '91', template: 't' }))
eq('no credentials is a 503 naming the secrets to set',
  [unconfigured.code, /WHATSAPP_TOKEN/.test(unconfigured.message)],
  ['whatsapp_not_configured', true])
eq('it is a WhatsappError, so callers can branch on it',
  unconfigured instanceof WhatsappError, true)

/* The Workers free plan allows 50 subrequests per request, so a batch has to
   stay under it with room for the D1 writes around it. */
eq('the per-call cap leaves headroom under the 50-subrequest limit',
  MAX_SENDS_PER_CALL <= 45, true)

/* ------------------------------------------------------- media headers -- */
section('templates with an image header')

/* Adding an image to an approved template adds a HEADER component, and every
   send must then carry a parameter for it. Sending only the body afterwards
   fails with "(#132012) Parameter format does not match format in the created
   template" -- an error that names no component and reads as though the body
   were at fault. */

const podX = { label: 'Fetch Pod 003', location: 'SJEC Admin Block', city: 'Mangalore' }

eq('no header configured sends only the body',
  buildComponents({ headerFormat: 'NONE', variables: ['pod_location'] }, podX),
  [{ type: 'body', parameters: [{ type: 'text', text: 'SJEC Admin Block' }] }])

eq('an image header is sent as a link parameter, header first',
  buildComponents(
    { headerFormat: 'IMAGE', headerMediaUrl: 'https://thefetch.in/og-image.png',
      variables: ['pod_location'] }, podX),
  [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'https://thefetch.in/og-image.png' } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'SJEC Admin Block' }] },
  ])

eq('video and document headers use their own key',
  [
    buildComponents({ headerFormat: 'VIDEO', headerMediaUrl: 'https://x/v.mp4', variables: [] }, podX)[0],
    buildComponents({ headerFormat: 'DOCUMENT', headerMediaUrl: 'https://x/d.pdf', variables: [] }, podX)[0],
  ],
  [
    { type: 'header', parameters: [{ type: 'video', video: { link: 'https://x/v.mp4' } }] },
    { type: 'header', parameters: [{ type: 'document', document: { link: 'https://x/d.pdf' } }] },
  ])

// A header format with no URL would produce a parameter with nothing in it,
// which Meta rejects for the whole message.
eq('a header format with no url is left out rather than sent empty',
  buildComponents({ headerFormat: 'IMAGE', headerMediaUrl: '', variables: [] }, podX), [])

eq('a header with no body variables still sends the header',
  buildComponents({ headerFormat: 'IMAGE', headerMediaUrl: 'https://x/i.png', variables: [] }, podX).length,
  1)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
