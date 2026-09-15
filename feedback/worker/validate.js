import {
  ISSUE_TYPES,
  OCCURRED_WHEN,
  PRODUCT_CATEGORIES,
  PRICE_FEEL,
  USAGE_FREQ,
  PAYMENT_ISSUES,
  LIMITS,
  WA_DEFAULT_COUNTRY_CODE,
  valuesOf,
} from '../shared/constants.js'

const ISSUE_SET    = valuesOf(ISSUE_TYPES)
const WHEN_SET     = valuesOf(OCCURRED_WHEN)
const CATEGORY_SET = valuesOf(PRODUCT_CATEGORIES)
const PRICE_SET    = valuesOf(PRICE_FEEL)
const USAGE_SET    = valuesOf(USAGE_FREQ)

/**
 * Normalise free text before it ever reaches the database:
 *  - strip control characters (including zero-width spam padding)
 *  - collapse runs of whitespace
 *  - trim
 *  - hard-truncate to the column's cap
 * Returns null for anything that ends up empty, so we store NULL rather
 * than a row full of empty strings.
 */
export function cleanText(input, maxLen) {
  if (typeof input !== 'string') return null
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
  return cleaned.length ? cleaned : null
}

/** Enum guard — anything not on the whitelist becomes null. */
const pickEnum = (value, set) =>
  typeof value === 'string' && set.has(value) ? value : null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
/** Indian mobile numbers, with or without +91 / leading 0. */
const PHONE_RE = /^(?:\+?91[\s-]?)?[06-9]\d{9}$/

export function cleanEmail(input) {
  const text = cleanText(input, LIMITS.email)
  if (!text) return null
  const lower = text.toLowerCase()
  return EMAIL_RE.test(lower) ? lower : null
}

export function cleanPhone(input) {
  const text = cleanText(input, LIMITS.phone)
  if (!text) return null
  const digits = text.replace(/[\s-]/g, '')
  return PHONE_RE.test(digits) ? digits.replace(/^\+?91/, '') : null
}

/**
 * Normalise a WhatsApp number to the form WhatsApp itself uses: country code
 * plus subscriber number, digits only, no '+'.
 *
 * `cleanPhone` deliberately STRIPS the country code -- it exists to store a
 * local number someone will read off a screen and dial. A WhatsApp number is
 * an address, not a display string, and 9876543210 addresses nobody. So this
 * adds the country code rather than removing it, and the two functions are
 * kept separate rather than one growing a flag, because their outputs are not
 * interchangeable and a mix-up would be silent.
 *
 * Accepts +91 98765 43210, 09876543210, 9876543210 and returns 919876543210.
 * Returns null for anything that is not a plausible Indian mobile.
 */
export function cleanWhatsApp(input) {
  const text = cleanText(input, LIMITS.whatsapp)
  if (!text) return null

  let digits = text.replace(/[^\d+]/g, '').replace(/^\+/, '')

  // Drop a trunk '0' only on a bare local number (09876543210), never inside
  // an already-prefixed one.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 10) digits = WA_DEFAULT_COUNTRY_CODE + digits

  // Indian mobiles are 10 digits starting 6-9.
  //
  // This catches most landlines but cannot catch all of them: 0824-2441234 is
  // 11 digits, exactly like a mobile written with a trunk zero, and dropping
  // the zero leaves 824... which is a valid mobile prefix. No format check
  // separates those two. Such a number is accepted here and will simply never
  // deliver -- which is what the 'invalid' status on whatsapp_optins records,
  // rather than pretending the check is stronger than it is.
  if (!/^91[6-9]\d{9}$/.test(digits)) return null
  return digits
}

/**
 * Amount arrives as rupees (what the user typed) and is stored as paise
 * (integer) so we never keep money in a float.
 */
function cleanAmount(rupees) {
  const n = typeof rupees === 'number' ? rupees : Number.parseFloat(rupees)
  if (!Number.isFinite(n) || n <= 0) return null
  const paise = Math.round(n * 100)
  if (paise <= 0 || paise > LIMITS.maxAmountPaise) return null
  return paise
}

/**
 * Validate and normalise a submission payload.
 * Returns { ok: true, value } or { ok: false, errors: string[] }.
 *
 * Everything not explicitly whitelisted here is dropped — the payload the
 * client sends is treated as a suggestion, never as truth.
 */
export function validateSubmission(payload) {
  const errors = []
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Malformed request body.'] }
  }

  const kind = payload.kind === 'complaint' || payload.kind === 'feedback'
    ? payload.kind
    : null
  if (!kind) errors.push('Unknown submission type.')

  // Fields shared by both tabs
  const comment      = cleanText(payload.comment, LIMITS.comment)
  const productText  = cleanText(payload.productText, LIMITS.productText)
  const productCat   = pickEnum(payload.productCategory, CATEGORY_SET)
  const contactEmail = cleanEmail(payload.contactEmail)
  const contactPhone = cleanPhone(payload.contactPhone)

  // If the user typed something in a contact field but it didn't parse,
  // tell them rather than silently dropping it.
  if (payload.contactEmail && !contactEmail) errors.push('That email address doesn\'t look right.')
  if (payload.contactPhone && !contactPhone) errors.push('That phone number doesn\'t look right.')

  const base = {
    kind,
    comment,
    product_category: productCat,
    product_text: productText,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    // complaint-only
    issue_type: null,
    occurred_when: null,
    amount_paise: null,
    payment_ref: null,
    refund_requested: 0,
    // feedback-only
    rating: null,
    wanted_categories: null,
    wanted_text: null,
    price_feel: null,
    usage_freq: null,
    notify_opt_in: 0,
    // WhatsApp refill alerts. Stored in whatsapp_optins, not on the
    // submission -- a consent has its own lifecycle and outlives the report
    // it arrived on.
    whatsapp_opt_in: 0,
    whatsapp_number: null,
  }

  // Offered on BOTH tabs on purpose: the person most likely to want telling
  // when a Pod is refilled is the one reporting that it is empty.
  //
  // The number is only read when the box is ticked. A number typed and then
  // left unticked is not consent, and storing it "because they gave it to us"
  // is exactly the reasoning that makes a marketing list indefensible.
  if (payload.whatsappOptIn) {
    // Fall back to the contact phone so nobody has to type the same number
    // into two boxes on a phone keypad.
    const wa = cleanWhatsApp(payload.whatsappNumber) || cleanWhatsApp(payload.contactPhone)
    if (wa) {
      base.whatsapp_opt_in = 1
      base.whatsapp_number = wa
    } else {
      errors.push('Add a WhatsApp number so we can tell you when this Pod is refilled.')
    }
  }

  if (kind === 'complaint') {
    base.issue_type = pickEnum(payload.issueType, ISSUE_SET)
    if (!base.issue_type) errors.push('Please tell us what went wrong.')

    base.occurred_when = pickEnum(payload.occurredWhen, WHEN_SET)
    if (!base.occurred_when) errors.push('Please tell us when this happened.')

    base.refund_requested = payload.refundRequested ? 1 : 0

    if (PAYMENT_ISSUES.includes(base.issue_type)) {
      base.amount_paise = cleanAmount(payload.amount)
      base.payment_ref = cleanText(payload.paymentRef, LIMITS.paymentRef)
    }

    // A refund we can't actually pay out is worse than no refund request:
    // require a way to reach them.
    //
    // Either channel still satisfies this. The form now offers only the
    // WhatsApp number, but older clients and anything else posting here may
    // still send an email, and refusing a refund request that carries a
    // perfectly good address would be the wrong way round.
    if (base.refund_requested && !contactEmail && !contactPhone) {
      errors.push('Add your WhatsApp number so we can process the refund.')
    }
  }

  if (kind === 'feedback') {
    const rating = Number.parseInt(payload.rating, 10)
    base.rating = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null
    if (!base.rating) errors.push('Please tap a rating.')

    // De-duplicate and whitelist the multi-select, then store as JSON.
    const wanted = Array.isArray(payload.wantedCategories) ? payload.wantedCategories : []
    const cleanWanted = [...new Set(
      wanted.filter((v) => typeof v === 'string' && CATEGORY_SET.has(v))
    )].slice(0, PRODUCT_CATEGORIES.length)
    base.wanted_categories = cleanWanted.length ? JSON.stringify(cleanWanted) : null

    base.wanted_text = cleanText(payload.wantedText, LIMITS.wantedText)
    base.price_feel  = pickEnum(payload.priceFeel, PRICE_SET)
    base.usage_freq  = pickEnum(payload.usageFreq, USAGE_SET)

    base.notify_opt_in = payload.notifyOptIn && contactEmail ? 1 : 0
    if (payload.notifyOptIn && !contactEmail) {
      errors.push('Add your email if you\'d like us to tell you when we stock it.')
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: base }
}
