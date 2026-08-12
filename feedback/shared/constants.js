/**
 * Single source of truth for every option the form can submit.
 *
 * Imported by BOTH the React form and the Worker. The Worker validates
 * incoming payloads against these exact arrays, so the client physically
 * cannot store a value the backend doesn't recognise — this is the core of
 * the data-quality guarantee.
 *
 * Rules for changing this file:
 *  - Never rename an existing `value`. Old rows in D1 still reference it.
 *  - Add new options at the end.
 *  - `label` is display-only and safe to reword at any time.
 */

export const ISSUE_TYPES = [
  { value: 'no_dispense',    label: 'Paid but nothing came out', payment: true },
  { value: 'wrong_item',     label: 'Wrong item dispensed',      payment: false },
  { value: 'damaged_item',   label: 'Item damaged or expired',   payment: false },
  { value: 'double_charge',  label: 'Charged twice',             payment: true },
  { value: 'payment_failed', label: 'Payment failed',            payment: true },
  { value: 'machine_fault',  label: 'Machine not working',       payment: false },
  { value: 'other',          label: 'Something else',            payment: false },
]

/** Issue types where we ask for amount + payment reference. */
export const PAYMENT_ISSUES = ISSUE_TYPES.filter((i) => i.payment).map((i) => i.value)

export const OCCURRED_WHEN = [
  { value: 'just_now', label: 'Just now' },
  { value: 'today',    label: 'Earlier today' },
  { value: 'earlier',  label: 'Yesterday or before' },
]

export const PRODUCT_CATEGORIES = [
  { value: 'chips',      label: 'Chips & namkeen' },
  { value: 'chocolate',  label: 'Chocolate & candy' },
  { value: 'cold_drink', label: 'Cold drinks' },
  { value: 'water',      label: 'Water' },
  { value: 'coffee_tea', label: 'Coffee & tea' },
  { value: 'healthy',    label: 'Healthy snacks' },
  { value: 'protein',    label: 'Protein & fitness' },
  { value: 'ready_meal', label: 'Ready meals' },
  { value: 'other',      label: 'Something else' },
]

export const PRICE_FEEL = [
  { value: 'expensive', label: 'Too expensive' },
  { value: 'fair',      label: 'About right' },
  { value: 'good',      label: 'Good value' },
]

export const USAGE_FREQ = [
  { value: 'first_time', label: 'First time' },
  { value: 'sometimes',  label: 'Now and then' },
  { value: 'weekly',     label: 'Weekly' },
  { value: 'daily',      label: 'Daily' },
]

export const RATINGS = [
  { value: 1, emoji: '😞', label: 'Bad' },
  { value: 2, emoji: '😐', label: 'Meh' },
  { value: 3, emoji: '🙂', label: 'Fine' },
  { value: 4, emoji: '😀', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Great' },
]

export const SUBMISSION_KINDS = ['complaint', 'feedback']

export const SUBMISSION_STATUSES = ['new', 'in_progress', 'resolved', 'spam']

/** Field length caps, enforced server-side (and hinted client-side). */
export const LIMITS = {
  comment: 400,
  productText: 80,
  wantedText: 80,
  paymentRef: 64,
  email: 160,
  phone: 20,
  podId: 40,
  /** ₹20,000 in paise — a vending purchase above this is certainly bogus. */
  maxAmountPaise: 2_000_000,
}

/** Helper: turn an option array into a Set of valid values for validation. */
export const valuesOf = (options) => new Set(options.map((o) => o.value))
