import { INV_LIMITS } from '../shared/constants.js'

/**
 * Replay protection for inventory writes.
 *
 * Every write under /api/inv/* is an append-only stock movement, so a duplicate
 * is not a cosmetic annoyance -- it is phantom stock. Clients on flaky data
 * retry, and people double-tap, so exactly-once has to be enforced here rather
 * than hoped for.
 *
 * The rule is blanket: every non-GET needs a key. The moment there are
 * exceptions, a caller has to consult a table, and the endpoint they get wrong
 * will be the one that double-books a dispatch.
 */

const KEY_RE = /^[A-Za-z0-9_-]{8,200}$/

const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input)
  return hex(await crypto.subtle.digest('SHA-256', data))
}

/**
 * Claims an idempotency key before a handler runs.
 *
 * The claim is INSERT ... ON CONFLICT DO NOTHING RETURNING, so the winner of a
 * double-tap race is decided by the database rather than by a read-then-write
 * that two concurrent Workers could both pass -- the same trick allocateNumber
 * uses for document numbers.
 *
 * Also reads and parses the body, because a Request body can only be consumed
 * once and the request hash needs the raw bytes.
 *
 * Returns one of:
 *   { replay: <Response> }                     an earlier identical call's result
 *   { error: {...}, status }                    reject before the handler runs
 *   { body, finish(data, status), abandon() }   proceed
 */
export async function beginIdempotent(request, env, auth, json) {
  const key = request.headers.get('Idempotency-Key') || ''
  if (!KEY_RE.test(key)) {
    return {
      status: 422,
      error: {
        error: 'idempotency_required',
        message: 'Every change needs an Idempotency-Key header so a retry cannot be counted twice.',
      },
    }
  }

  const raw = await request.text()
  let body
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return { status: 400, error: { error: 'bad_json', message: 'Malformed request.' } }
  }

  const url = new URL(request.url)
  const endpoint = `${request.method} ${url.pathname}`
  const keyHash = await sha256Hex(`idem:${auth.userId}:${key}`)
  const requestHash = await sha256Hex(`${endpoint}|${raw}`)

  const claimed = await env.DB.prepare(
    `INSERT INTO idempotency_keys (key_hash, user_id, endpoint, request_hash)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(key_hash) DO NOTHING
     RETURNING key_hash`
  ).bind(keyHash, auth.userId, endpoint, requestHash).first()

  if (!claimed) {
    const prior = await env.DB.prepare(
      'SELECT request_hash, state, status, response_json FROM idempotency_keys WHERE key_hash = ?1'
    ).bind(keyHash).first()

    // Same key, different body: a client bug worth surfacing rather than
    // papering over by serving an unrelated stored response.
    if (!prior || prior.request_hash !== requestHash) {
      return {
        status: 409,
        error: {
          error: 'idempotency_mismatch',
          message: 'That Idempotency-Key was already used for a different request. Use a new key.',
        },
      }
    }
    if (prior.state === 'in_flight') {
      return {
        status: 409,
        error: {
          error: 'idempotency_in_progress',
          message: 'That request is still being processed. Try again in a moment.',
        },
      }
    }
    return {
      replay: json(JSON.parse(prior.response_json), prior.status, {
        'idempotency-replayed': 'true',
      }),
    }
  }

  return {
    body,

    /** Records the outcome and returns it. A replay will be byte-identical. */
    async finish(data, status = 200) {
      await env.DB.prepare(
        `UPDATE idempotency_keys
            SET state = 'done', status = ?1, response_json = ?2, completed_at = datetime('now')
          WHERE key_hash = ?3`
      ).bind(status, JSON.stringify(data), keyHash).run()
      return json(data, status, { 'idempotency-replayed': 'false' })
    },

    /**
     * Releases the key so the caller can fix the payload and retry with the
     * same one. Used for validation failures and for unexpected errors: a
     * transient fault must not poison a key permanently, or a client's queue
     * jams on a poison message for the whole retention window.
     */
    async abandon() {
      await env.DB.prepare('DELETE FROM idempotency_keys WHERE key_hash = ?1')
        .bind(keyHash).run()
    },
  }
}

/**
 * Prunes expired keys opportunistically, roughly one request in 32.
 *
 * A Cron trigger for a table holding a few hundred rows a week would be a
 * second deployment concept for no benefit. Call inside ctx.waitUntil so it
 * never delays a response.
 */
export function maybePrune(env) {
  if ((crypto.getRandomValues(new Uint8Array(1))[0] & 31) !== 0) return null
  return env.DB.prepare(
    `DELETE FROM idempotency_keys
      WHERE created_at < datetime('now', '-${INV_LIMITS.idempotencyTtlHours} hours')`
  ).run()
}
