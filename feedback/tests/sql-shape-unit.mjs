/**
 * Every UNION in the worker must have matching column counts.
 *
 *   node tests/sql-shape-unit.mjs
 *
 * This exists because of a real failure. Three columns were added to two
 * branches of the chat-thread UNION and silently not to the third, and SQLite
 * only complains when the query runs — so the panel returned
 * "Something went wrong on our side" for any conversation, while every unit
 * test passed and the build was clean.
 *
 * A query is not type-checked by anything else here, so this reads the SQL out
 * of the source and counts the branches itself.
 */

import { readdir, readFile } from 'node:fs/promises'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}

/** Splits a SELECT list on top-level commas, ignoring those inside brackets. */
function countColumns(selectList) {
  let depth = 0
  let n = 1
  for (const ch of selectList) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) n++
  }
  return n
}

const files = (await readdir(new URL('../worker/', import.meta.url)))
  .filter((f) => f.endsWith('.js'))

console.log(`\n── UNION column counts across ${files.length} worker files ${'─'.repeat(20)}`)

let checked = 0
for (const file of files) {
  const src = await readFile(new URL(`../worker/${file}`, import.meta.url), 'utf8')

  // Template literals that look like SQL containing a UNION.
  for (const m of src.matchAll(/`([^`]*\bUNION\b[^`]*)`/gi)) {
    const sql = m[1]
    if (!/\bSELECT\b/i.test(sql)) continue

    const branches = sql.split(/\bUNION(?:\s+ALL)?\b/i)
      .map((b) => {
        const i = b.search(/\bSELECT\b/i)
        const j = b.search(/\bFROM\b/i)
        return i === -1 || j === -1 || j < i ? null : b.slice(i + 6, j)
      })
      .filter(Boolean)

    if (branches.length < 2) continue
    checked++

    const counts = branches.map(countColumns)
    eq(`${file}: all ${counts.length} branches select the same number of columns`,
      [...new Set(counts)].length, 1)
    if ([...new Set(counts)].length !== 1) {
      console.log(`          branch columns: ${counts.join(', ')}`)
    }
  }
}

eq('at least one UNION was actually found and checked', checked > 0, true)

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
