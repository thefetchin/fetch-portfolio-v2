/**
 * Tests for worker/vlite.js against a stubbed VLite.
 *
 *   node tests/vlite-unit.mjs
 *
 * Nothing here touches the real machine cloud. The point is to pin down the
 * things that would be expensive to get wrong against live hardware: the exact
 * settingsChange payload, that a disable preserves the slot's other settings,
 * the Down -> write -> Online sequence, and that a machine is never left down.
 */

import {
  OPERATION_DOWN,
  OPERATION_ONLINE,
  VliteError,
  getSlots,
  getTransactionLines,
  sessionId,
  setSlotEnabled,
  _resetTokenCache,
} from '../worker/vlite.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const truthy = (name, v) => eq(name, !!v, true)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

/* ------------------------------------------------------------- the stub ---- */

const env = { VLITE_MOBILE: '9000000000', VLITE_PASSWORD: 'pw', VLITE_BASE_URL: 'https://vlite.test' }

let calls = []
let handlers = {}

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (url, init) => {
  const endpoint = String(url).split('/').pop()
  const body = init?.body ? JSON.parse(init.body) : {}
  calls.push({ endpoint, body, auth: init?.headers?.authorization })
  const h = handlers[endpoint]
  if (!h) return jsonRes({ code: 'NOT_STUBBED' }, 404)
  return h(body)
}

const reset = () => {
  calls = []
  _resetTokenCache()
  handlers = {
    login: () => jsonRes({ code: 'COMPANY_USER_LOGGED_IN', token: 'jwt-abc' }),
    updateOperationStatus: () => jsonRes({ code: 'MACHINE_STATUS_LOGGED' }),
    slotUpdateBulk: () => jsonRes({ code: 'SLOT_UPDATED' }),
  }
}

// A slot as the real API presents it: note 0/1 rather than booleans, and the
// "coloumnNumber" spelling.
const RAW_SLOT = {
  id: 143108,
  slotName: 'A3',
  rowNumber: 1,
  coloumnNumber: 3,
  productId: 84469,
  'client_level_product.name': 'Lays Magic Masala 52g',
  stockLimit: 24,
  currentStock: 7,
  slotIssueFound: 0,
  enable: 1,
  showProductCost: 1,
  showProductName: 1,
  showProductImage: 0,      // deliberately OFF, to prove it is preserved
  stocklimitEnabled: 1,
  stockData: [{ id: 1, stockId: 55, expiresAt: 1790000000000, qty: 7, transitId: null }],
}

/* ------------------------------------------------------------------ reads -- */
section('reading slots')
reset()
handlers.getSlotsForMachine = () => jsonRes({ code: 'SUCCESS', data: [RAW_SLOT] })

let slots = await getSlots(env, 41341)
eq('one slot returned', slots.length, 1)
eq('slot id mapped', slots[0].vliteSlotId, 143108)
eq('VLite\'s coloumnNumber is mapped to columnNumber', slots[0].columnNumber, 3)
eq('0/1 flags are normalised to booleans', slots[0].settings, {
  enable: true, showProductCost: true, showProductName: true,
  showProductImage: false, stocklimitEnabled: true,
})
eq('product name is picked up from the flattened key', slots[0].productName, 'Lays Magic Masala 52g')
truthy('stockData is NOT surfaced — expiry is ours, not VLite\'s',
  !('stockData' in slots[0]) && !JSON.stringify(slots[0]).includes('expiresAt'))
eq('the JWT is sent with no Bearer prefix',
  calls.find((c) => c.endpoint === 'getSlotsForMachine').auth, 'jwt-abc')

/* ----------------------------------------------------------- the sequence -- */
section('disabling a slot')
reset()
handlers.getSlotsForMachine = () => jsonRes({ code: 'SUCCESS', data: [RAW_SLOT] })
slots = await getSlots(env, 41341)

const result = await setSlotEnabled(env, 41341, slots[0], false, { reason: 'expired batch' })
const order = calls.map((c) => c.endpoint)
// Ignore the token warm-up: the cached JWT means the number of logins depends on
// what ran before, which is not what this assertion is about.
const seq = order.filter((e) => e !== 'login' && e !== 'getSlotsForMachine')
eq('the machine is brought down, written, then put back online',
  seq, ['updateOperationStatus', 'slotUpdateBulk', 'updateOperationStatus'])
eq('the cached token means one sign-in served both calls',
  order.filter((e) => e === 'login').length, 1)

const ops = calls.filter((c) => c.endpoint === 'updateOperationStatus')
eq('down first', ops[0].body.operationStatus, OPERATION_DOWN)
eq('...with the reason passed through', ops[0].body.operationStatusReason, 'expired batch')
eq('online last', ops[1].body.operationStatus, OPERATION_ONLINE)

const write = calls.find((c) => c.endpoint === 'slotUpdateBulk')
eq('the payload matches the captured shape exactly', write.body, {
  sessionId: result.sessionId,
  machineId: 41341,
  settingsChange: [{
    slotId: 143108,
    enable: false,
    showProductCost: true,
    showProductName: true,
    showProductImage: false,   // preserved as OFF, not clobbered to true
    stocklimitEnabled: true,
  }],
  productChange: [],
})
truthy('the session id looks like SESS...', /^SESS[A-Z0-9]{12}$/.test(write.body.sessionId))
truthy('sessionId() is not constant', sessionId() !== sessionId())
eq('productChange is empty for a settings-only write', write.body.productChange, [])

/* --------------------------------------- the hazard this signature prevents */
section('read-modify-write is enforced')
reset()
let threw = null
try {
  // Exactly the mistake that would silently change customer-visible settings.
  await setSlotEnabled(env, 41341, { vliteSlotId: 143108 }, false)
} catch (err) { threw = err }
truthy('a slot without its settings is refused', threw instanceof VliteError)
truthy('...with an explanation', /other settings/.test(threw?.message || ''))
eq('...and nothing was written', calls.filter((c) => c.endpoint === 'slotUpdateBulk').length, 0)
eq('...and the machine was never brought down',
  calls.filter((c) => c.endpoint === 'updateOperationStatus').length, 0)

/* ------------------------------------------------------- failure handling -- */
section('failure handling')

reset()
handlers.getSlotsForMachine = () => jsonRes({ code: 'SUCCESS', data: [RAW_SLOT] })
slots = await getSlots(env, 41341)
handlers.slotUpdateBulk = () => jsonRes({ code: 'BAD_REQUEST' }, 400)
threw = null
try { await setSlotEnabled(env, 41341, slots[0], false) } catch (err) { threw = err }
truthy('a failed write throws', !!threw)
eq('...but the machine is still brought back online',
  calls.filter((c) => c.endpoint === 'updateOperationStatus' && c.body.operationStatus === OPERATION_ONLINE).length, 1)

reset()
handlers.getSlotsForMachine = () => jsonRes({ code: 'SUCCESS', data: [RAW_SLOT] })
slots = await getSlots(env, 41341)
let opCalls = 0
handlers.updateOperationStatus = (b) => {
  opCalls++
  // fail only the "back online" call
  return b.operationStatus === OPERATION_ONLINE ? jsonRes({ code: 'ERR' }, 500) : jsonRes({ code: 'OK' })
}
threw = null
try { await setSlotEnabled(env, 41341, slots[0], false) } catch (err) { threw = err }
eq('a machine left down raises a distinct, loud error', threw?.code, 'vlite_left_down')
truthy('...naming the machine', /41341/.test(threw?.message || ''))

reset()
delete handlers.login
handlers.login = () => jsonRes({ code: 'INVALID' }, 401)
threw = null
try { await getSlots({ ...env }, 41341) } catch (err) { threw = err }
truthy('a bad sign-in throws rather than hanging', threw instanceof VliteError)

reset()
threw = null
try { await getSlots({ VLITE_BASE_URL: env.VLITE_BASE_URL }, 41341) } catch (err) { threw = err }
eq('missing credentials are reported as configuration, not a server fault',
  threw?.code, 'vlite_not_configured')

reset()
handlers.getSlotsForMachine = () => new Response('<html>login page</html>', { status: 200 })
threw = null
try { await getSlots(env, 41341) } catch (err) { threw = err }
truthy('an HTML response (a gateway or captive portal) is caught, not parsed as data',
  /non-JSON/.test(threw?.message || ''))

/* ------------------------------------------------- 401 retry, exactly once */
section('token refresh')
reset()
let slotHits = 0
handlers.getSlotsForMachine = () => {
  slotHits++
  return slotHits === 1 ? jsonRes({ code: 'UNAUTH' }, 401) : jsonRes({ code: 'SUCCESS', data: [RAW_SLOT] })
}
slots = await getSlots(env, 41341)
eq('a 401 triggers one re-login and the call succeeds', slots.length, 1)
eq('...and it logged in twice, not more', calls.filter((c) => c.endpoint === 'login').length, 2)

reset()
handlers.getSlotsForMachine = () => jsonRes({ code: 'UNAUTH' }, 401)
threw = null
try { await getSlots(env, 41341) } catch (err) { threw = err }
truthy('a persistent 401 gives up instead of looping', !!threw)
truthy('...after at most two sign-ins (never a lockout loop)',
  calls.filter((c) => c.endpoint === 'login').length <= 2)

/* ------------------------------------------------------- sales attribution */
section('sales lines')
reset()
handlers.getTransactionDetails = () => jsonRes({
  code: 'SUCCESS',
  data: {
    cartData: [
      { id: 991, machineId: 41341, productId: 84469, productName: 'Lays', slotName: 'A3', qty: 2, amount: 4000, status: 'DISPENSED', stockId: 55 },
    ],
  },
})
const lines = await getTransactionLines(env, 'TRX-1')
eq('a cart line carries the slot, product and quantity',
  [lines[0].slotName, lines[0].vliteProductId, lines[0].qty], ['A3', 84469, 2])
eq('the cart line id is kept for deduping a re-pull', lines[0].cartLineId, 991)
truthy('stockId is not used to attribute a batch — our own layers do that',
  !('stockId' in lines[0]))

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
