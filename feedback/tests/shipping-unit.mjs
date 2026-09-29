/**
 * Tests for the shipping-label settings.
 *
 *   node tests/shipping-unit.mjs
 *
 * The label is rendered in the browser, so what is worth pinning here is the
 * data behind it: the page sizes it can print at, the switches it reads, and
 * the address cleaning that stands between a pasted block of text and a label
 * that runs off the sheet.
 */

import { cleanLines, PAGE_SIZES, PAGE_SIZE_VALUES, SHOW_KEYS, DEFAULT_SHOW } from '../worker/shipping.js'

let pass = 0
let fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? (pass++, console.log(`  ok    ${name}`))
     : (fail++, console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`))
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

/* ------------------------------------------------------------ addresses -- */
section('an address is cleaned before it reaches a label')

eq('lines survive intact',
  cleanLines('Plot 42, Phase II\nHinjawadi, Pune 411057'),
  'Plot 42, Phase II\nHinjawadi, Pune 411057')

eq('windows line endings are handled',
  cleanLines('One\r\nTwo'), 'One\nTwo')

eq('blank lines are dropped rather than printed as gaps',
  cleanLines('One\n\n\nTwo'), 'One\nTwo')

eq('surrounding whitespace goes',
  cleanLines('  One  \n\tTwo\t'), 'One\nTwo')

// A pasted email signature would otherwise run off the bottom of the box.
eq('a long paste is cut to six lines',
  cleanLines('1\n2\n3\n4\n5\n6\n7\n8').split('\n').length, 6)

eq('a single very long line is cut, not wrapped forever',
  cleanLines('x'.repeat(200)).length, 80)

eq('nothing in, nothing out', cleanLines(''), '')
eq('null is not the string "null"', cleanLines(null), '')

/* ---------------------------------------------------------- page sizes -- */
section('the page sizes the label can print at')

eq('every size carries real millimetres',
  PAGE_SIZES.every((p) => p.w > 0 && p.h > 0 && p.h >= p.w), true)
eq('A4 is 210 x 297',
  PAGE_SIZES.find((p) => p.value === 'A4'), { value: 'A4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 })
// The preview and the @page rule both read these, so a duplicate value would
// silently pick whichever came first.
eq('values are unique', new Set(PAGE_SIZE_VALUES).size, PAGE_SIZE_VALUES.length)

/* -------------------------------------------------------------- shows -- */
section('the switches that hide parts of the label')

// A key with no default would read as "off" the moment it is saved, which is
// a part of the label vanishing because someone pressed Save.
eq('every switch has a default',
  SHOW_KEYS.filter((k) => typeof DEFAULT_SHOW[k] !== 'boolean'), [])
eq('no default without a switch',
  Object.keys(DEFAULT_SHOW).filter((k) => !SHOW_KEYS.includes(k)), [])
// Everything on by default except the trim outline: a label should arrive
// complete, and leaving things off is the deliberate act.
eq('only the trim outline starts off',
  SHOW_KEYS.filter((k) => DEFAULT_SHOW[k] === false), ['cutMarks'])

console.log(`\n══ ${pass} passed, ${fail} failed ══`)
process.exit(fail ? 1 : 0)
