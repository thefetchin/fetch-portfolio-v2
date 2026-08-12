/**
 * Email + password auth for the admin dashboard.
 *
 * Design notes (why it looks like this):
 *
 *  - Passwords are stored ONLY as PBKDF2-SHA256 hashes. The Workers runtime
 *    has no bcrypt/argon2 without WASM, so PBKDF2 with a high iteration
 *    count is the right primitive here. Format is self-describing so the
 *    parameters can be raised later without invalidating old hashes:
 *        pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
 *
 *  - Session tokens are random 32-byte values. The DB stores only a SHA-256
 *    hash of the token, so a leaked database cannot be replayed as a live
 *    session. The raw token exists only in the user's cookie.
 *
 *  - Cookies are HttpOnly + Secure + SameSite=Lax, so page JS can't read the
 *    session and it isn't sent on cross-site POSTs.
 *
 *  - Login failures are deliberately indistinguishable (same message, same
 *    work done) so the endpoint can't be used to enumerate valid emails.
 */

import { PBKDF2_ITERATIONS } from '../shared/constants.js'

// (iteration count and the CPU-budget rationale live in shared/constants.js)
const SESSION_TTL_DAYS = 7
export const SESSION_COOKIE = 'fetch_admin_session'

/* ------------------------------------------------------------- encoding -- */

const b64 = (bytes) => {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin)
}

const fromB64 = (s) => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  return hex(await crypto.subtle.digest('SHA-256', data))
}

/** Constant-time comparison to avoid leaking hash prefixes via timing. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/* ------------------------------------------------------------- password -- */

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  )
  return new Uint8Array(bits)
}

/** Produces `pbkdf2$sha256$<iters>$<saltB64>$<hashB64>`. */
export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, iterations)
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(hash)}`
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false

  const iterations = Number.parseInt(parts[2], 10)
  if (!Number.isInteger(iterations) || iterations < 1000) return false

  let salt
  try {
    salt = fromB64(parts[3])
  } catch {
    return false
  }

  const computed = b64(await pbkdf2(password, salt, iterations))
  return timingSafeEqual(computed, parts[4])
}

/* -------------------------------------------------------------- sessions -- */

function cookieValue(header, name) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export function sessionCookie(token, maxAgeSeconds) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  return attrs.join('; ')
}

export const clearedSessionCookie = () =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`

async function createSession(env, userId) {
  const raw = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const tokenHash = await sha256Hex(raw)
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19)

  await env.DB.prepare(
    'INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)'
  ).bind(tokenHash, userId, expires).run()

  return { token: raw, maxAge: SESSION_TTL_DAYS * 86_400 }
}

/**
 * Verifies the session cookie.
 * @returns {{ok: true, email: string, userId: number} | {ok: false, reason: string}}
 */
export async function verifySession(request, env) {
  const token = cookieValue(request.headers.get('Cookie'), SESSION_COOKIE)
  if (!token) return { ok: false, reason: 'Not signed in.' }

  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.email, u.active
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = ?1`
  ).bind(tokenHash).first()

  if (!row) return { ok: false, reason: 'Session not recognised.' }
  if (!row.active) return { ok: false, reason: 'This account is disabled.' }

  // Compare as UTC strings — created_at/expires_at are stored via SQLite's
  // datetime('now'), which is UTC.
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19)
  if (row.expires_at <= nowUtc) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1')
      .bind(tokenHash).run()
    return { ok: false, reason: 'Session expired. Please sign in again.' }
  }

  return { ok: true, email: row.email, userId: row.user_id }
}

/* ---------------------------------------------------------------- login -- */

const LOGIN_ATTEMPT_LIMIT = 8
const LOGIN_WINDOW_MINUTES = 15

/** Brute-force guard: counts recent failures for this IP. */
async function tooManyAttempts(env, ipHash) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM admin_login_attempts WHERE ip_hash = ?1 AND created_at > ?2'
  ).bind(ipHash, since).first()
  return (row?.n ?? 0) >= LOGIN_ATTEMPT_LIMIT
}

async function recordAttempt(env, ipHash, email, success) {
  await env.DB.prepare(
    'INSERT INTO admin_login_attempts (ip_hash, email, success) VALUES (?1, ?2, ?3)'
  ).bind(ipHash, email || null, success ? 1 : 0).run()
}

export async function handleLogin(request, env) {
  let body
  try {
    body = await request.json()
  } catch {
    return { status: 400, data: { error: 'bad_json', message: 'Malformed request.' } }
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  const ip = request.headers.get('CF-Connecting-IP') || ''
  const ipHash = await sha256Hex(`login:${ip}`)

  if (await tooManyAttempts(env, ipHash)) {
    return {
      status: 429,
      data: {
        error: 'rate_limited',
        message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
      },
    }
  }

  if (!email || !password) {
    await recordAttempt(env, ipHash, email, false)
    return { status: 400, data: { error: 'missing', message: 'Email and password are required.' } }
  }

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, active FROM admin_users WHERE email = ?1'
  ).bind(email).first()

  // Always run a hash comparison, even when the user doesn't exist, so the
  // response time doesn't reveal which emails are registered.
  const stored = user?.password_hash
    || `pbkdf2$sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`
  const passwordOk = await verifyPassword(password, stored)

  if (!user || !user.active || !passwordOk) {
    await recordAttempt(env, ipHash, email, false)
    return {
      status: 401,
      data: { error: 'invalid', message: 'Invalid email or password.' },
    }
  }

  await recordAttempt(env, ipHash, email, true)
  await env.DB.prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?1")
    .bind(user.id).run()

  const { token, maxAge } = await createSession(env, user.id)

  return {
    status: 200,
    data: { ok: true, email: user.email },
    cookie: sessionCookie(token, maxAge),
  }
}

export async function handleLogout(request, env) {
  const token = cookieValue(request.headers.get('Cookie'), SESSION_COOKIE)
  if (token) {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1')
      .bind(await sha256Hex(token)).run()
  }
  return { status: 200, data: { ok: true }, cookie: clearedSessionCookie() }
}
