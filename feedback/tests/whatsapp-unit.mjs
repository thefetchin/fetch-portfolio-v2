/**
 * Tests for the WhatsApp refill opt-in.
 *
 *   node tests/whatsapp-unit.mjs
 *
 * Two things carry the weight here. First, the number has to come out in the
 * form WhatsApp itself addresses -- country code included -- because the
 * existing cleanPhone deliberately strips it and a mix-up would be silent.
 * Second, a number given WITHOUT the box ticked must never be stored: that is
 * the difference between a consent record and a harvested list.
 */

import { cleanWhatsApp, cleanPhone, validateSubmission } from '../worker/validate.js'
import { WA_CONSENT_TEXT, WHATSAPP_STATUSES } from '../shared/constants.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

/* ------------------------------------------------ normalising the number -- */
section('normalising a WhatsApp number')

eq('bare 10 digits gain the country code', cleanWhatsApp('9876543210'), '919876543210')
eq('+91 with spaces',                      cleanWhatsApp('+91 98765 43210'), '919876543210')
eq('+91 with hyphens',                     cleanWhatsApp('+91-98765-43210'), '919876543210')
eq('leading trunk zero is dropped',        cleanWhatsApp('09876543210'), '919876543210')
eq('already normalised passes through',    cleanWhatsApp('919876543210'), '919876543210')
eq('91 without the plus',                  cleanWhatsApp('91 98765 43210'), '919876543210')

// Every accepted value must be exactly what WhatsApp addresses: digits only.
for (const input of ['9876543210', '+91 98765 43210', '09876543210']) {
  eq(`${input} yields digits only`, /^\d+$/.test(cleanWhatsApp(input)), true)
}

// A landline with an STD code and a mobile with a trunk zero are BOTH 11
// digits, and stripping the zero from 0824-2441234 leaves 824..., which is a
// valid mobile prefix. The two are not distinguishable by syntax, so this is
// accepted and will simply never deliver. That is what the 'invalid' status
// in whatsapp_optins is for -- asserting null here would be asserting a
// guarantee the format cannot give.
eq('an STD landline is indistinguishable from a mobile, and is accepted',
  cleanWhatsApp('0824 2441234'), '918242441234')
eq('a landline whose local part starts below 6 IS caught',
  cleanWhatsApp('011 25551234'), null)
eq('starts with 5, not a mobile -> null',        cleanWhatsApp('5876543210'), null)
eq('too short -> null',                          cleanWhatsApp('98765'), null)
eq('too long -> null',                           cleanWhatsApp('9198765432101234'), null)
eq('letters -> null',                            cleanWhatsApp('nine eight seven'), null)
eq('empty -> null',                              cleanWhatsApp(''), null)
eq('not a string -> null',                       cleanWhatsApp(null), null)

// The two cleaners are NOT interchangeable, and that is the point.
eq('cleanPhone strips the country code, cleanWhatsApp adds it',
  [cleanPhone('+919876543210'), cleanWhatsApp('+919876543210')],
  ['9876543210', '919876543210'])

/* ----------------------------------------------------- consent behaviour -- */
section('consent is required before a number is kept')

const fb = { kind: 'feedback', rating: 4 }

const noTick = validateSubmission({ ...fb, whatsappNumber: '9876543210' })
eq('a number typed WITHOUT ticking the box is not stored',
  [noTick.value.whatsapp_opt_in, noTick.value.whatsapp_number], [0, null])

const ticked = validateSubmission({ ...fb, whatsappOptIn: true, whatsappNumber: '+91 98765 43210' })
eq('ticked with a number is stored normalised',
  [ticked.value.whatsapp_opt_in, ticked.value.whatsapp_number], [1, '919876543210'])

const fallback = validateSubmission({ ...fb, whatsappOptIn: true, contactPhone: '9876543210' })
eq('the contact phone stands in when the WhatsApp box is left blank',
  fallback.value.whatsapp_number, '919876543210')

const explicitWins = validateSubmission({
  ...fb, whatsappOptIn: true, whatsappNumber: '9000000001', contactPhone: '9000000002',
})
eq('an explicit WhatsApp number beats the contact phone',
  explicitWins.value.whatsapp_number, '919000000001')

const badNumber = validateSubmission({ ...fb, whatsappOptIn: true, whatsappNumber: '123' })
eq('ticked with an unusable number is an error, not a silent drop',
  badNumber.ok, false)
eq('and the error names WhatsApp',
  /WhatsApp/.test(badNumber.errors.join(' ')), true)

const noNumber = validateSubmission({ ...fb, whatsappOptIn: true })
eq('ticked with no number at all is an error', noNumber.ok, false)

/* Offered on both tabs: the person reporting an empty machine is exactly the
   person who wants telling when it is filled. */
const complaint = validateSubmission({
  kind: 'complaint', issueType: 'no_dispense', occurredWhen: 'just_now',
  whatsappOptIn: true, whatsappNumber: '9876543210',
})
eq('a problem report can opt in too', complaint.value.whatsapp_number, '919876543210')

/* The form now offers ONE contact field, the WhatsApp number, and sends it as
   contactPhone. These pin the shape that field actually posts. */
section('the single-field form')

const formShape = validateSubmission({
  kind: 'feedback', rating: 5, comment: 'nice', contactPhone: '9876543210', whatsappOptIn: true,
})
eq('a payload with no email and no separate whatsappNumber still opts in',
  [formShape.ok, formShape.value.whatsapp_number, formShape.value.contact_email],
  [true, '919876543210', null])

const refundByPhone = validateSubmission({
  kind: 'complaint', issueType: 'double_charge', occurredWhen: 'today',
  refundRequested: true, contactPhone: '9876543210',
})
eq('a refund can be claimed with the number alone', refundByPhone.ok, true)

const refundNoContact = validateSubmission({
  kind: 'complaint', issueType: 'double_charge', occurredWhen: 'today', refundRequested: true,
})
eq('a refund with no way to reach them is still refused', refundNoContact.ok, false)
eq('and the message names the field the form actually shows',
  /WhatsApp number/.test(refundNoContact.errors.join(' ')), true)

/* ------------------------------------------------------------- the row --- */
section('what reaches the database')

eq('the opt-in is not a submissions column',
  Object.keys(validateSubmission(fb).value).filter((k) => k.startsWith('whatsapp_')).sort(),
  ['whatsapp_number', 'whatsapp_opt_in'])

eq('the consent wording is a real sentence we can store',
  typeof WA_CONSENT_TEXT === 'string' && WA_CONSENT_TEXT.length > 10, true)

// Mirrors the CHECK in migrations/006_whatsapp_optin.sql. If one list grows a
// value and the other does not, the database rejects rows the app thinks are
// valid -- so the two are asserted together here.
eq('statuses match the migration', WHATSAPP_STATUSES, ['active', 'unsubscribed', 'invalid'])

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
