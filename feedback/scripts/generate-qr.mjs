#!/usr/bin/env node
/**
 * Generate signed, print-ready QR codes for Fetch Pods.
 *
 *   QR_SECRET=... node scripts/generate-qr.mjs POD-MNG-001 POD-MNG-002
 *   QR_SECRET=... node scripts/generate-qr.mjs --file pods.txt
 *
 * Each QR encodes:
 *   https://feedback.thefetch.in/p/<POD_ID>?t=<signature>
 *
 * The signature is an HMAC-SHA256 of the pod ID under QR_SECRET, truncated
 * to 16 base64url chars. The Worker recomputes it on every request, so a
 * hand-typed or guessed pod ID is rejected — this is what keeps junk out of
 * the database.
 *
 * IMPORTANT: QR_SECRET must be the exact same value you set on the Worker
 * with `npx wrangler secret put QR_SECRET`. If you rotate it, every printed
 * QR code stops working.
 *
 * Output: ./qr-codes/<POD_ID>.png and .svg, plus a urls.csv manifest.
 */

import { createHmac } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import QRCode from 'qrcode'

const BASE_URL = process.env.FEEDBACK_BASE_URL || 'https://feedback.thefetch.in'
const SECRET = process.env.QR_SECRET
const OUT_DIR = process.env.QR_OUT_DIR || 'qr-codes'

if (!SECRET) {
  console.error('\n  ✗ QR_SECRET is not set.\n')
  console.error('    Generate one:  openssl rand -base64 32')
  console.error('    Then run:      QR_SECRET="<value>" npm run qr -- POD-MNG-001\n')
  console.error('    Use the SAME value for: npx wrangler secret put QR_SECRET\n')
  process.exit(1)
}

/** Must stay byte-identical to podSignature() in worker/index.js. */
function podSignature(podId) {
  return createHmac('sha256', SECRET)
    .update(`pod:${podId}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 16)
}

async function resolvePodIds(argv) {
  const fileFlag = argv.indexOf('--file')
  if (fileFlag !== -1) {
    const path = argv[fileFlag + 1]
    if (!path) throw new Error('--file needs a path')
    const text = await readFile(path, 'utf8')
    return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  }
  return argv.filter((a) => !a.startsWith('--'))
}

const POD_ID_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/

async function main() {
  const podIds = await resolvePodIds(process.argv.slice(2))

  if (!podIds.length) {
    console.error('\n  Usage: npm run qr -- POD-MNG-001 [POD-MNG-002 ...]')
    console.error('         npm run qr -- --file pods.txt\n')
    process.exit(1)
  }

  const invalid = podIds.filter((id) => !POD_ID_RE.test(id))
  if (invalid.length) {
    console.error(`\n  ✗ Invalid pod IDs (use A-Z, 0-9 and dashes): ${invalid.join(', ')}\n`)
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })

  const rows = ['pod_id,url']
  for (const podId of podIds) {
    const url = `${BASE_URL}/p/${podId}?t=${podSignature(podId)}`

    // High error correction so the code still scans with a logo sticker
    // over the middle, or with a scuffed label on a machine.
    const options = { errorCorrectionLevel: 'H', margin: 2, width: 1024 }

    await QRCode.toFile(join(OUT_DIR, `${podId}.png`), url, options)
    await QRCode.toFile(join(OUT_DIR, `${podId}.svg`), url, { ...options, type: 'svg' })

    rows.push(`${podId},${url}`)
    console.log(`  ✓ ${podId}  →  ${url}`)
  }

  await writeFile(join(OUT_DIR, 'urls.csv'), `${rows.join('\n')}\n`)

  console.log(`\n  ${podIds.length} QR code(s) written to ./${OUT_DIR}/`)
  console.log(`  Manifest: ./${OUT_DIR}/urls.csv`)
  console.log('\n  Reminder: each pod_id must also exist in the `pods` table:')
  console.log("    INSERT INTO pods (pod_id, label, location, city) VALUES ('POD-MNG-001', ...);\n")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
