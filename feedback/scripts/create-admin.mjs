#!/usr/bin/env node
/**
 * Create (or update) a dashboard login.
 *
 *   npm run admin:create -- you@thefetch.in
 *   npm run admin:create -- you@thefetch.in --local     # local dev DB
 *
 * The password is typed into this prompt on your machine, hashed here with
 * PBKDF2-SHA256, and only the hash is sent to D1. The plaintext is never
 * written to disk, never echoed to the terminal, and never appears in shell
 * history or the wrangler logs.
 *
 * Hash format matches worker/auth.js exactly:
 *   pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { PBKDF2_ITERATIONS } from '../shared/constants.js'

const MIN_PASSWORD_LENGTH = 12
const ROLES = ['admin', 'inventory_manager', 'refiller']

const args = process.argv.slice(2)
const local = args.includes('--local')
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase()

/** Value of a `--flag value` pair. */
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

const role = flagValue('role') || 'admin'
const displayName = (flagValue('name') || '').trim()

/**
 * Escapes a value for a single-quoted SQL literal.
 *
 * wrangler d1 execute takes a SQL string, so every interpolated value has to be
 * escaped here -- there is no bind-parameter path through the CLI. Doubling the
 * quote is the SQLite-correct escape; control characters are dropped because
 * they have no business in a name and would corrupt the command line.
 */
const sqlLit = (v) =>
  `'${String(v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/'/g, "''")}'`

const usage =
  '\n  Usage: npm run admin:create -- you@thefetch.in [--role admin|inventory_manager|refiller]' +
  '\n                                [--name "Ramesh K"] [--local]\n'

if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
  console.error(usage)
  process.exit(1)
}
if (!ROLES.includes(role)) {
  console.error(`\n  ✗ Unknown role "${role}". Use one of: ${ROLES.join(', ')}\n`)
  process.exit(1)
}
if (displayName && displayName.length > 60) {
  console.error('\n  ✗ --name must be 60 characters or fewer.\n')
  process.exit(1)
}

/** Reads a password without echoing it to the terminal. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })
    const onData = (char) => {
      const s = String(char)
      if (s === '\n' || s === '\r' || s === '') {
        stdin.removeListener('data', onData)
      } else {
        // Re-write the prompt line so the password isn't visible.
        stdout.clearLine(0)
        stdout.cursorTo(0)
        stdout.write(question)
      }
    }
    stdin.on('data', onData)
    rl.question(question, (answer) => {
      rl.close()
      stdout.write('\n')
      resolve(answer)
    })
  })
}

const hashPassword = (password) => {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256')
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`
}

const main = async () => {
  console.log(`\n  Creating dashboard login for: ${email}`)
  console.log('  (the password is hashed locally — only the hash reaches the database)\n')

  const password = await promptHidden('  Password: ')
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`\n  ✗ Too short — use at least ${MIN_PASSWORD_LENGTH} characters.\n`)
    process.exit(1)
  }
  const confirm = await promptHidden('  Confirm:  ')
  if (password !== confirm) {
    console.error('\n  ✗ Passwords do not match.\n')
    process.exit(1)
  }

  const passwordHash = hashPassword(password)

  // Upsert: re-running for an existing email rotates that user's password and
  // updates the role. Every value goes through sqlLit() -- the role is also
  // allowlisted above, and display_name is free text from the command line.
  const sql =
    `INSERT INTO admin_users (email, password_hash, role, display_name) ` +
    `VALUES (${sqlLit(email)}, ${sqlLit(passwordHash)}, ${sqlLit(role)}, ` +
    `${displayName ? sqlLit(displayName) : 'NULL'}) ` +
    `ON CONFLICT(email) DO UPDATE SET ` +
    `password_hash = excluded.password_hash, ` +
    `role = excluded.role, ` +
    `display_name = COALESCE(excluded.display_name, admin_users.display_name), ` +
    `active = 1;`

  const flags = ['d1', 'execute', 'fetch-feedback', local ? '--local' : '--remote', '--command', sql]
  console.log(`\n  Writing to ${local ? 'local' : 'remote'} D1…`)

  const res = spawnSync('npx', ['wrangler', ...flags], { stdio: ['ignore', 'pipe', 'pipe'] })
  const out = `${res.stdout || ''}${res.stderr || ''}`

  if (res.status !== 0) {
    console.error('\n  ✗ Failed to write the user:\n')
    console.error(out.split('\n').slice(-15).join('\n'))
    process.exit(1)
  }

  const where = role === 'refiller'
    ? 'can now be used by the refiller app'
    : 'can now sign in at https://admin.thefetch.in'
  console.log(`\n  ✓ ${email} (${role}) ${where}\n`)

  // Invalidate any existing sessions for safety when a password or role
  // changes -- a session created under the old role must not outlive it.
  spawnSync('npx', [
    'wrangler', 'd1', 'execute', 'fetch-feedback', local ? '--local' : '--remote', '--command',
    `DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE email = ${sqlLit(email)});`,
  ], { stdio: 'ignore' })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
