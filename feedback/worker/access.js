/**
 * Cloudflare Access verification for the admin endpoints.
 *
 * When a request passes through an Access-protected hostname, Cloudflare
 * injects a signed JWT in the `Cf-Access-Jwt-Assertion` header. We verify
 * that JWT against the team's public keys so the Worker can't be reached
 * directly (e.g. via its *.workers.dev URL) to bypass the login.
 *
 * Required Worker vars (set in wrangler.jsonc / dashboard):
 *   ACCESS_TEAM_DOMAIN — e.g. "aiumtech.cloudflareaccess.com"
 *   ACCESS_AUD         — the Application Audience tag from the Access app
 *
 * If either is unset we treat the deployment as local development and allow
 * the request, so `wrangler dev` works without an Access tunnel.
 */

const certCache = { keys: null, fetchedAt: 0 }
const CERT_TTL_MS = 60 * 60 * 1000 // 1 hour

const b64urlToBytes = (s) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const b64urlToJson = (s) =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(s)))

async function getKeys(teamDomain) {
  const fresh = certCache.keys && Date.now() - certCache.fetchedAt < CERT_TTL_MS
  if (fresh) return certCache.keys

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`)
  const { keys } = await res.json()

  certCache.keys = keys || []
  certCache.fetchedAt = Date.now()
  return certCache.keys
}

/**
 * @returns {Promise<{ok: true, email: string} | {ok: false, reason: string}>}
 */
export async function verifyAccess(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN
  const aud = env.ACCESS_AUD

  if (!teamDomain || !aud) {
    // Local dev / not yet configured.
    return { ok: true, email: 'dev@localhost', dev: true }
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('CF_Authorization='))
      ?.slice('CF_Authorization='.length)

  if (!token) return { ok: false, reason: 'No Access token on request.' }

  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'Malformed Access token.' }
  const [headerB64, payloadB64, signatureB64] = parts

  let header
  let payload
  try {
    header = b64urlToJson(headerB64)
    payload = b64urlToJson(payloadB64)
  } catch {
    return { ok: false, reason: 'Unreadable Access token.' }
  }

  const keys = await getKeys(teamDomain)
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) return { ok: false, reason: 'Unknown signing key.' }

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(signatureB64),
    signed
  )
  if (!valid) return { ok: false, reason: 'Bad Access token signature.' }

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) return { ok: false, reason: 'Access token expired.' }
  if (payload.nbf && payload.nbf > now) return { ok: false, reason: 'Access token not yet valid.' }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(aud)) return { ok: false, reason: 'Access token audience mismatch.' }

  const issuer = `https://${teamDomain}`
  if (payload.iss && payload.iss !== issuer) {
    return { ok: false, reason: 'Access token issuer mismatch.' }
  }

  return { ok: true, email: payload.email || 'unknown' }
}
