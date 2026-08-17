/**
 * Client for the VLite (Vendolite) machine cloud.
 *
 * VLite is the machine-control layer and nothing more. It answers two kinds of
 * question -- what is physically in this slot, and is it switched on -- and
 * accepts one instruction: switch this slot off. Every judgement about shelf
 * life, batch identity and fitness for sale is made against our own D1.
 *
 * In particular we NEVER read or write VLite's stockData[].expiresAt. It exists
 * upstream, and mirroring the one fact that must never be wrong into a system we
 * do not control, cannot migrate, and could not adjudicate against when the two
 * copies disagree is the sort of shortcut that ends as a food-safety incident.
 * One expiry date, one owner.
 *
 * Auth: `Authorization: <raw JWT>` with NO "Bearer " prefix. That is unusual and
 * easy to get wrong, and it is distinct from the bearer tokens we issue for our
 * own API.
 */

const DEFAULT_BASE = 'https://elite.vendoliteindia.com'
const PREFIX = '/api/leanCloud'
const TIMEOUT_MS = 15_000

/**
 * Token cache, per isolate.
 *
 * Workers isolates are short-lived and there may be several, so this is a
 * best-effort saving of one round trip -- not a shared session store. A 401 on
 * any call clears it and re-logs in once.
 */
let cachedToken = null
let cachedAt = 0
const TOKEN_TTL_MS = 30 * 60 * 1000

export class VliteError extends Error {
  constructor(message, { status = 502, code = null, endpoint = null } = {}) {
    super(message)
    this.name = 'VliteError'
    this.status = status
    this.code = code
    this.endpoint = endpoint
  }
}

const base = (env) => (env.VLITE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')

/** Every VLite endpoint is a POST with a JSON body, even the reads. */
async function rawCall(env, endpoint, body, token) {
  const url = `${base(env)}${PREFIX}/${endpoint}`
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  // No "Bearer " prefix. This is not an oversight.
  if (token) headers.authorization = token

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // A non-JSON body from a JSON API means we are talking to something else --
    // an auth gateway, a captive portal, an error page.
    throw new VliteError(
      `VLite ${endpoint} returned a non-JSON response (HTTP ${res.status}).`,
      { status: 502, endpoint },
    )
  }

  return { res, data }
}

async function login(env) {
  const mobile = env.VLITE_MOBILE
  const password = env.VLITE_PASSWORD
  if (!mobile || !password) {
    throw new VliteError(
      'VLite credentials are not configured. Set VLITE_MOBILE and VLITE_PASSWORD as Worker secrets.',
      { status: 503, code: 'vlite_not_configured' },
    )
  }

  const { res, data } = await rawCall(env, 'login', { mobile, password }, null)
  if (!res.ok || !data?.token) {
    throw new VliteError(
      `VLite sign-in failed (HTTP ${res.status}${data?.code ? `, ${data.code}` : ''}).`,
      { status: 502, code: data?.code || null, endpoint: 'login' },
    )
  }

  cachedToken = data.token
  cachedAt = Date.now()
  return cachedToken
}

async function token(env) {
  if (cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS) return cachedToken
  return login(env)
}

/**
 * Calls VLite, logging in on demand and retrying once on a 401.
 *
 * A single retry only: if a fresh token is also rejected the credentials or the
 * account are wrong, and retrying in a loop would just lock the account out.
 */
async function call(env, endpoint, body) {
  let t = await token(env)
  let { res, data } = await rawCall(env, endpoint, body, t)

  if (res.status === 401 || res.status === 403) {
    cachedToken = null
    t = await login(env)
    ;({ res, data } = await rawCall(env, endpoint, body, t))
  }

  if (!res.ok) {
    throw new VliteError(
      `VLite ${endpoint} failed (HTTP ${res.status}${data?.code ? `, ${data.code}` : ''}).`,
      { status: res.status >= 500 ? 502 : 502, code: data?.code || null, endpoint },
    )
  }
  return data
}

/* ------------------------------------------------------------------ reads -- */

export async function getMachines(env, { limit = 100, page = 0 } = {}) {
  const data = await call(env, 'getMachines', {
    machineId: [], clientName: [], operationStatus: [], sort: 'default', limit, page,
  })
  return (data?.data || []).map((m) => ({
    vliteMachineId: m.id,
    displayId: m.machineDisplayId,
    serialNumber: m.serialNumber,
    city: m.city,
    state: m.state,
    cloudStatus: m.cloudStatus,
    operationStatus: m.operationStatus,
    capacity: m.capacity,
    currentStock: m.currentStock,
    percent: m.percent,
    rows: m.slotRowCount,
    columns: m.slotColumnCount,
  }))
}

/** `enable` and the other flags may arrive as 0/1 or as booleans. */
const bool = (v) => v === true || v === 1 || v === '1'

/**
 * Every slot on a machine.
 *
 * `settings` is kept verbatim so a later disable can send the slot's own values
 * back rather than guessing them -- see setSlotEnabled.
 *
 * stockData[] is deliberately NOT surfaced. VLite's per-entry expiresAt is not
 * our source of truth and reading it here would invite someone to trust it.
 * Quantity comes from `currentStock`, which is what we reconcile against.
 */
export async function getSlots(env, vliteMachineId) {
  const data = await call(env, 'getSlotsForMachine', { machineId: vliteMachineId })
  return (data?.data || []).map((s) => ({
    vliteSlotId: s.id,
    slotName: s.slotName,
    rowNumber: s.rowNumber,
    // VLite's own spelling; kept as-is at the boundary so the mapping is obvious.
    columnNumber: s.coloumnNumber,
    vliteProductId: s.productId,
    productName: s['client_level_product.name'] ?? s.client_level_product?.name ?? null,
    stockLimit: s.stockLimit,
    currentStock: s.currentStock,
    slotIssueFound: bool(s.slotIssueFound),
    enable: bool(s.enable),
    settings: {
      enable: bool(s.enable),
      showProductCost: bool(s.showProductCost),
      showProductName: bool(s.showProductName),
      showProductImage: bool(s.showProductImage),
      stocklimitEnabled: bool(s.stocklimitEnabled),
    },
  }))
}

export async function getTransactions(env, { startDate, endDate, page = 0, limit = 100 }) {
  const data = await call(env, 'getTransactions', { startDate, endDate, page, limit })
  return (data?.data || []).map((t) => ({
    trxId: t.trxId,
    vliteMachineId: t.machineId,
    machineDisplayId: t['machine.machineDisplayId'] ?? null,
    status: t.status,
    cartTotalPaise: t.cartTotal,
    paidTotalPaise: t.paidTotal,
    refundPaise: t.refundAmount,
    transactionTime: t.transactionTime,
  }))
}

/** Cart lines for one transaction: what actually came out, and from which slot. */
export async function getTransactionLines(env, trxId) {
  const data = await call(env, 'getTransactionDetails', { trxId: String(trxId) })
  return (data?.data?.cartData || []).map((c) => ({
    cartLineId: c.id,
    trxId: String(trxId),
    vliteMachineId: c.machineId,
    vliteProductId: c.productId,
    productName: c.productName,
    slotName: c.slotName,
    qty: c.qty,
    amountPaise: c.amount,
    status: c.status,
  }))
}

/* ----------------------------------------------------------------- writes -- */

/** VLite expects a client-generated session id on any slot write. */
export function sessionId() {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const b = crypto.getRandomValues(new Uint8Array(12))
  let s = ''
  for (const byte of b) s += A[byte % A.length]
  return `SESS${s}`
}

export const OPERATION_ONLINE = 'Online'
export const OPERATION_DOWN = 'Down (Planned)'

export async function setOperationStatus(env, vliteMachineId, status, reason = '') {
  await call(env, 'updateOperationStatus', {
    machineId: vliteMachineId,
    operationStatus: status,
    operationStatusReason: reason,
  })
  return true
}

/**
 * Turns a slot off (or back on).
 *
 * settingsChange[] is a WHOLE-SETTINGS WRITE, not a patch: the captured payload
 * carries all five slot settings, so sending only { slotId, enable } would
 * overwrite showProductCost / showProductName / showProductImage /
 * stocklimitEnabled with whatever the caller happened to pass. Three of those
 * are visible to a customer on the machine's screen.
 *
 * So this function refuses to take loose values. It requires the `slot` object
 * as read back from getSlots() and reuses that slot's own settings, changing
 * only `enable`. Read-modify-write, enforced by the signature.
 *
 * VLite also requires the machine to be down before a slot write, so the caller
 * gets a three-step sequence. Order matters and partial failure is real:
 *   - our ledger and slot state are committed BEFORE this is called, so a failed
 *     push leaves our books correct and the machine catching up later;
 *   - a failure to return the machine to Online is the loud one, because a
 *     machine left down is lost revenue.
 */
export async function setSlotEnabled(env, vliteMachineId, slot, enable, { reason = '' } = {}) {
  if (!slot || typeof slot !== 'object' || !slot.vliteSlotId || !slot.settings) {
    throw new VliteError(
      'setSlotEnabled needs a slot object from getSlots(), so the slot\'s other '
      + 'settings can be preserved rather than guessed.',
      { status: 500, code: 'vlite_bad_slot' },
    )
  }

  const entry = {
    slotId: slot.vliteSlotId,
    // Only this field changes. The rest are the slot's own current values.
    enable: !!enable,
    showProductCost: !!slot.settings.showProductCost,
    showProductName: !!slot.settings.showProductName,
    showProductImage: !!slot.settings.showProductImage,
    stocklimitEnabled: !!slot.settings.stocklimitEnabled,
  }

  const session = sessionId()
  let broughtDown = false
  try {
    await setOperationStatus(env, vliteMachineId, OPERATION_DOWN, reason)
    broughtDown = true

    await call(env, 'slotUpdateBulk', {
      sessionId: session,
      machineId: vliteMachineId,
      settingsChange: [entry],
      productChange: [],
    })
  } finally {
    // Always try to bring the machine back, including when the write failed --
    // leaving it down would turn a failed slot change into a dead machine.
    if (broughtDown) {
      try {
        await setOperationStatus(env, vliteMachineId, OPERATION_ONLINE, '')
      } catch (err) {
        console.error(
          `VLite: machine ${vliteMachineId} may be LEFT DOWN after a slot write`,
          err?.message || err,
        )
        throw new VliteError(
          `Slot updated but machine ${vliteMachineId} could not be brought back online. `
          + 'Check it in the VLite portal.',
          { status: 502, code: 'vlite_left_down', endpoint: 'updateOperationStatus' },
        )
      }
    }
  }

  return { sessionId: session, slotId: slot.vliteSlotId, enable: !!enable }
}

/** Test-only: drops the cached JWT so a test can force a fresh login. */
export function _resetTokenCache() {
  cachedToken = null
  cachedAt = 0
}
