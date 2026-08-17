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

/**
 * PBKDF2 iterations for admin passwords. Imported by BOTH worker/auth.js and
 * scripts/create-admin.mjs so the two can never drift.
 *
 * Why not the OWASP-recommended 210,000? Password hashing burns CPU, and a
 * Workers **free plan** request is capped at 10ms of CPU. Measured on this
 * hardware:
 *
 *     210,000 -> ~24ms   exceeds the free-plan budget, request is killed
 *     100,000 -> ~10ms   right at the limit
 *      50,000 -> ~5.6ms
 *      25,000 -> ~2.5ms  comfortable headroom for the DB work in the request
 *
 * 25,000 is therefore the safe ceiling on the free plan. The online-guessing
 * risk is covered by the 8-attempts-per-15-minutes lockout in worker/auth.js
 * plus a 12-character minimum password; the reduced count only matters to an
 * attacker who has already exfiltrated the D1 database.
 *
 * On Workers Paid (30s CPU/request) raise this to 210000 and re-run
 * `npm run admin:create` for each user to rotate their hash. The stored
 * format records its own iteration count, so old and new hashes coexist.
 */
export const PBKDF2_ITERATIONS = 25_000


/* ------------------------------------------------------------ invoicing --
 * Debit notes raised on suppliers for defective, short or wrongly supplied
 * goods. Imported by the Worker (validation, totals) and the admin UI (form
 * options), so the two can never disagree.
 */

/** Us. Appears on every document we issue. */
export const ISSUER = {
  legalName: 'AIUM Tech Private Limited',
  tradeName: 'Fetch',
  cin: 'U47990MN2025PTC015220',
  gstin: '29ABBCA9450H1ZH',
  stateCode: '29',
  stateName: 'Karnataka',
  // Place of business the goods are supplied to — drives CGST/SGST vs IGST.
  address: [
    'Lucia Mansion, Kalpane Kulshekara',
    'Mangalore 575005, Karnataka',
  ],
  registeredOffice: [
    'Nagamapal Khwai Brahmapur, Lalambung (Part),',
    'Imphal West, Lamphelpat, Manipur 795004',
  ],
  email: 'thefetch.in@gmail.com',
  phone: '+91 90195 26185',
}

export const DEBIT_NOTE_REASONS = [
  { value: 'damaged',      label: 'Damaged in transit' },
  { value: 'expired',      label: 'Expired or near expiry' },
  { value: 'quality',      label: 'Quality not acceptable' },
  { value: 'wrong_item',   label: 'Wrong item supplied' },
  { value: 'short_supply', label: 'Short supply' },
  { value: 'price_diff',   label: 'Price difference' },
  { value: 'other',        label: 'Other' },
]

/** GST rates as basis points so all tax maths stays in integers. */
export const GST_RATES = [
  { value: 0,    label: '0%' },
  { value: 500,  label: '5%' },
  { value: 1200, label: '12%' },
  { value: 1800, label: '18%' },
  { value: 2800, label: '28%' },
]

export const UOM_OPTIONS = [
  { value: 'pcs',  label: 'pcs' },
  { value: 'box',  label: 'box' },
  { value: 'case', label: 'case' },
  { value: 'pack', label: 'pack' },
  { value: 'kg',   label: 'kg' },
  { value: 'g',    label: 'g' },
  { value: 'l',    label: 'l' },
  { value: 'ml',   label: 'ml' },
]

export const DEBIT_NOTE_STATUSES = ['issued', 'settled', 'cancelled']

export const DN_LIMITS = {
  supplierName: 140,
  supplierAddress: 300,
  gstin: 15,
  invoiceRef: 40,
  description: 160,
  hsn: 8,
  notes: 600,
  maxLines: 30,
  /** Rs 50,00,000 in paise — a debit note above this wants a human check. */
  maxLineValuePaise: 500_000_000,
}

/** 15-char GSTIN: 2 state digits, 10-char PAN, entity, Z, checksum. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

/* ------------------------------------------------------------ inventory --
 * Batch-tracked stock: warehouse zones -> in transit -> Pod, with FEFO
 * picking and a hard expiry block.
 *
 * Every array here is mirrored by a CHECK constraint in
 * migrations/004_inventory.sql. If you add a value, add it in BOTH places or
 * the database will reject rows the application thinks are valid.
 *
 * Expiry and batch identity live here and in D1 -- never in VLite. The
 * machine cloud has fields for them and we deliberately neither read nor
 * write those; see docs/INVENTORY_API.md.
 */

export const USER_ROLES = [
  { value: 'admin',             label: 'Admin' },
  { value: 'inventory_manager', label: 'Inventory manager' },
  { value: 'refiller',          label: 'Refiller' },
]

/** Roles allowed to manage stock. Refillers are read-only, by design. */
export const STOCK_ROLES = ['admin', 'inventory_manager']

/**
 * How a session may be presented. `web` is the HttpOnly cookie, `token` a
 * bearer credential for a non-browser client. verifySession requires the
 * stored kind to match how the credential arrived, so the two are not
 * interchangeable. Mirrored by a CHECK on admin_sessions.kind.
 */
export const SESSION_KINDS = ['web', 'token']

/**
 * Where stock can sit.
 *
 * `supplier`, `sold` and `adjust` are contra locations: they are the second
 * leg of an otherwise one-sided event, which is what makes every batch sum to
 * zero across all locations. They are the only kinds allowed to go negative.
 */
export const LOCATION_KINDS = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'zone',      label: 'Zone' },
  { value: 'transit',   label: 'In transit' },
  { value: 'pod',       label: 'Pod' },
  { value: 'scrap',     label: 'Scrap' },
  { value: 'supplier',  label: 'Suppliers (contra)' },
  { value: 'sold',      label: 'Sold (contra)' },
  { value: 'adjust',    label: 'Adjustments (contra)' },
]

export const CONTRA_KINDS = ['supplier', 'sold', 'adjust']

/** The one warehouse and its zones. Only MAIN is pickable. */
export const WAREHOUSE_ID = 'WH-MLR'
export const WAREHOUSE_ZONES = [
  { value: 'WH-MLR/RECV',    label: 'Receiving',  pickable: false, note: 'Goods in, awaiting putaway' },
  { value: 'WH-MLR/MAIN',    label: 'Main',       pickable: true,  note: 'Sellable stock' },
  { value: 'WH-MLR/STAGE',   label: 'Staged',     pickable: false, note: 'Picked, awaiting dispatch' },
  { value: 'WH-MLR/QUAR',    label: 'Quarantine', pickable: false, note: 'Damaged, suspect, recall' },
  { value: 'WH-MLR/EXPIRED', label: 'Expired',    pickable: false, note: 'Segregated, awaiting write-off' },
]

export const CONTRA_LOCATIONS = {
  supplier: 'X-SUPP',
  sold:     'X-SOLD',
  adjust:   'X-ADJ',
}
export const SCRAP_LOCATION = 'SCRAP'

/**
 * Derived location ids.
 *
 * The colon separator matters: a Pod whose own id already starts with "POD-"
 * would otherwise produce "POD-POD-MNG-003". Colon also cannot appear in a
 * zone id, so a location id is unambiguous about what kind of thing it names.
 * Mirrored by trg_pods_mirror_location in migrations/004_inventory.sql.
 */
export const podLocationId = (podId) => `POD:${podId}`
export const transitLocationId = (runId) => `TRANSIT:${runId}`

/**
 * Ledger reason codes.
 *
 * `consumed` is the revenue signal and `count_short` the shrinkage signal.
 * They are deliberately separate: identical arithmetic, completely different
 * meaning to the business.
 *
 * `blocksExpired` marks the reasons the expiry trigger refuses. Note that
 * writeoff, purchase_return and transit_return are NOT blocked -- expired
 * stock must retain a lawful exit or it is trapped in the warehouse forever.
 */
export const MOVEMENT_REASONS = [
  { value: 'purchase_in',     label: 'Received from supplier', blocksExpired: false },
  { value: 'purchase_return', label: 'Returned to supplier',   blocksExpired: false },
  { value: 'putaway',         label: 'Put away',               blocksExpired: false },
  { value: 'pick',            label: 'Picked for a run',       blocksExpired: true  },
  { value: 'dispatch',        label: 'Dispatched',             blocksExpired: true  },
  { value: 'refill',          label: 'Loaded into a Pod',      blocksExpired: true  },
  { value: 'transit_return',  label: 'Returned to warehouse',  blocksExpired: false },
  { value: 'pod_pull',        label: 'Pulled from a Pod',      blocksExpired: false },
  { value: 'consumed',        label: 'Sold',                   blocksExpired: false },
  { value: 'count_short',     label: 'Count short',            blocksExpired: false },
  { value: 'count_over',      label: 'Count over',             blocksExpired: false },
  { value: 'writeoff',        label: 'Written off',            blocksExpired: false },
  { value: 'transfer',        label: 'Transferred',            blocksExpired: true  },
  { value: 'opening',         label: 'Opening stock',          blocksExpired: false },
  { value: 'reversal',        label: 'Reversal',               blocksExpired: false },
]

/** Reasons the expiry gate refuses. Derived so the two can never drift. */
export const EXPIRY_BLOCKED_REASONS =
  MOVEMENT_REASONS.filter((r) => r.blocksExpired).map((r) => r.value)

export const BATCH_STATUSES = ['active', 'quarantined', 'closed']

export const PURCHASE_BILL_STATUSES = ['posted', 'cancelled']

export const RUN_STATUSES = ['planned', 'picked', 'dispatched', 'reconciled', 'cancelled']

export const RUN_STOP_STATES = ['pending', 'reconciled', 'skipped']

export const WRITEOFF_REASONS = [
  { value: 'expired',  label: 'Expired',            zone: 'WH-MLR/EXPIRED' },
  { value: 'damaged',  label: 'Damaged',            zone: 'WH-MLR/QUAR' },
  { value: 'theft',    label: 'Missing or stolen',   zone: null },
  { value: 'recall',   label: 'Recalled',           zone: 'WH-MLR/QUAR' },
  { value: 'sample',   label: 'Sample or tasting',  zone: null },
  { value: 'other',    label: 'Other',              zone: null },
]

/**
 * Why stock is being pulled out of a machine, and where it goes on return.
 *
 * `returnZone` is the whole point: the refiller brings back one bag and the
 * reason decides the destination, so expired stock can never re-enter
 * pickable storage and nobody in the field has to know the policy.
 */
export const PULL_REASONS = [
  { value: 'expired',          label: 'Expired',            returnZone: 'WH-MLR/EXPIRED' },
  { value: 'near_expiry',      label: 'Expiring soon',      returnZone: 'WH-MLR/MAIN' },
  { value: 'recall',           label: 'Recalled',           returnZone: 'WH-MLR/QUAR' },
  { value: 'damaged',          label: 'Damaged',            returnZone: 'WH-MLR/QUAR' },
  { value: 'planogram_change', label: 'Planogram change',   returnZone: 'WH-MLR/MAIN' },
  { value: 'slow_moving',      label: 'Not selling',        returnZone: 'WH-MLR/MAIN' },
]

export const PULL_STATUSES = ['open', 'assigned', 'done', 'cancelled']

/** How a slot layer's batch was determined. Reports must distinguish these. */
export const LAYER_ATTRIBUTION = ['planned', 'fefo_inferred']

export const SLOT_EVENTS = ['load', 'pull', 'relocate', 'remap', 'disable', 'enable']

/** Drift between our slot map and what the machine reports. */
export const DRIFT_KINDS = [
  { value: 'match',            label: 'Matches the plan' },
  { value: 'qty_low',          label: 'Fewer than planned' },
  { value: 'qty_high',         label: 'More than planned' },
  { value: 'product_changed',  label: 'Different product in the slot' },
  { value: 'relocated',        label: 'Moved to another slot' },
  { value: 'missing',          label: 'Gone with no matching sales' },
]

export const DRIFT_STATUSES = ['open', 'resolved', 'ignored']

export const INV_LIMITS = {
  sku: 40,
  productName: 120,
  supplierName: 140,
  supplierAddress: 300,
  billNumber: 40,
  batchCode: 12,
  supplierBatchNo: 40,
  slotName: 20,
  notes: 600,
  reason: 300,
  deviceLabel: 60,
  maxBillLines: 60,
  maxPlanLines: 120,
  /** Rs 50,00,000 in paise — a purchase bill above this wants a human check. */
  maxLineValuePaise: 500_000_000,
  /** 100,000 units in thousandths — a sanity ceiling, not a business rule. */
  maxQtyMilli: 100_000_000,
  /** Default minimum shelf life on dispatch, in days. Overridable per product. */
  defaultMinShelfLifeDays: 21,
  /** An override cannot become a standing exemption. */
  overrideTtlMinutes: 30,
  /** Idempotency keys are replayable for this long. */
  idempotencyTtlHours: 168,
}

/**
 * Crockford base32 — no I, L, O or U, so 1/I and 0/O confusion is designed
 * out of batch codes. A code is read off a torn sticker far more often than
 * anyone would like.
 */
export const BATCH_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
