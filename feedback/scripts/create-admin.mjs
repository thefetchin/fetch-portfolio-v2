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

const args = process.argv.slice(2)
const local = args.includes('--local')
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase()

if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
  console.error('\n  Usage: npm run admin:create -- you@thefetch.in [--local]\n')
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

  // Upsert: re-running for an existing email rotates that user's password.
  const sql =
    `INSERT INTO admin_users (email, password_hash) VALUES ('${email}', '${passwordHash}') ` +
    `ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, active = 1;`

  const flags = ['d1', 'execute', 'fetch-feedback', local ? '--local' : '--remote', '--command', sql]
  console.log(`\n  Writing to ${local ? 'local' : 'remote'} D1…`)

  const res = spawnSync('npx', ['wrangler', ...flags], { stdio: ['ignore', 'pipe', 'pipe'] })
  const out = `${res.stdout || ''}${res.stderr || ''}`

  if (res.status !== 0) {
    console.error('\n  ✗ Failed to write the user:\n')
    console.error(out.split('\n').slice(-15).join('\n'))
    process.exit(1)
  }

  console.log(`\n  ✓ ${email} can now sign in at https://admin.thefetch.in\n`)
  // Invalidate any existing sessions for safety when a password is rotated.
  spawnSync('npx', [
    'wrangler', 'd1', 'execute', 'fetch-feedback', local ? '--local' : '--remote', '--command',
    `DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE email = '${email}');`,
  ], { stdio: 'ignore' })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
