/**
 * Tests for the QR generator.
 *
 *   node tests/qr-unit.mjs
 *
 * The parts worth pinning: a Wi-Fi payload whose password contains a separator
 * (which silently truncates the QR if unescaped, joining the wrong network or
 * none), and which codes encode a tracked short link versus their content
 * directly — the difference between a poster we can repoint and one we cannot.
 */

import { encodedValue, wifiPayload } from '../worker/qr.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const HOST = 'feedback.thefetch.in'

/* ------------------------------------------------------- what is encoded -- */
section('what the QR actually carries')

eq('a tracked link encodes our short url, so it can be repointed later',
  encodedValue({ code: 'A1B2C3D', kind: 'link', tracked: true, content: 'https://thefetch.in' }, HOST),
  'https://feedback.thefetch.in/q/A1B2C3D')

// An untracked code keeps working even if this service disappears. That is the
// trade for not being able to count or repoint it.
eq('an untracked link encodes the destination directly',
  encodedValue({ code: 'A1B2C3D', kind: 'link', tracked: false, content: 'https://thefetch.in' }, HOST),
  'https://thefetch.in')

eq('text is encoded as itself',
  encodedValue({ code: 'X', kind: 'text', tracked: false, content: 'Back in 5 minutes' }, HOST),
  'Back in 5 minutes')

/* ------------------------------------------------------------- wifi ------ */
section('wi-fi payloads')

eq('the ordinary case',
  wifiPayload({ ssid: 'FetchGuest', password: 'hunter2' }),
  'WIFI:T:WPA;S:FetchGuest;P:hunter2;;')

// Semicolons, colons, commas, quotes and backslashes all separate fields in
// this format. Unescaped, the payload truncates and the phone joins the wrong
// network or fails outright -- and nobody would guess why.
const BS = String.fromCharCode(92)   // a single backslash, stated unambiguously

eq('a semicolon in the password is escaped',
  wifiPayload({ ssid: 'Fetch', password: 'a;b' }),
  `WIFI:T:WPA;S:Fetch;P:a${BS};b;;`)
eq('a colon in the ssid is escaped',
  wifiPayload({ ssid: 'Fetch:Guest', password: 'x' }),
  'WIFI:T:WPA;S:Fetch\\:Guest;P:x;;')
eq('a backslash is escaped',
  wifiPayload({ ssid: `A${BS}B`, password: 'x' }),
  `WIFI:T:WPA;S:A${BS}${BS}B;P:x;;`)
eq('an open network carries no password field',
  wifiPayload({ ssid: 'FetchOpen', security: 'nopass' }),
  'WIFI:T:nopass;S:FetchOpen;;')
eq('a hidden network is flagged',
  wifiPayload({ ssid: 'Fetch', password: 'x', hidden: true }),
  'WIFI:T:WPA;S:Fetch;P:x;H:true;;')
eq('WEP is passed through for old kit',
  wifiPayload({ ssid: 'Old', password: 'x', security: 'WEP' }).startsWith('WIFI:T:WEP;'), true)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
