/**
 * The inventory API caller.
 *
 * Its own module because two views now use it, and the alternative was either
 * a second copy that can drift or an import cycle between them.
 *
 * Every mutating call carries an Idempotency-Key. The Worker requires it, and
 * generating it per click rather than per attempt is the point: a double-tap or
 * a retry reuses the same key and cannot book the same stock twice.
 */
export async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers['Idempotency-Key'] = key || crypto.randomUUID()

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong.')
    err.code = data.error
    err.errors = data.errors
    err.status = res.status
    throw err
  }
  return data
}
