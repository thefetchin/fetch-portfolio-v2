/**
 * A minimal .xlsx writer.
 *
 * An xlsx is a ZIP of a few XML parts, and that is all this builds -- one
 * sheet, a header row, and typed cells. Written by hand rather than pulled
 * from a library because the alternatives are hundreds of kilobytes to produce
 * a twelve-column file, and this ships in a browser bundle the dashboard
 * downloads on every visit.
 *
 * Entries are STORED, not deflated. A few hundred kilobytes uncompressed is
 * nothing over a download, and it keeps the compression path -- and its bugs --
 * out of something whose only job is to be readable by Excel.
 */

/* ------------------------------------------------------------------ zip -- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const utf8 = (s) => new TextEncoder().encode(s)

/**
 * Builds a ZIP from [{ name, data }]. Stored entries only.
 *
 * The DOS timestamp is fixed rather than read from the clock, so the same
 * input produces the same bytes -- which is what lets a test assert on the
 * file itself instead of on the code that wrote it.
 */
export function zip(files) {
  const parts = []
  const central = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = 0x2821 // 2000-01-01

  for (const f of files) {
    const nameBytes = utf8(f.name)
    const data = f.data
    const sum = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true)            // method 0 = stored
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, sum, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    parts.push(local, data)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, sum, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    central.push(cd)

    offset += local.length + data.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const all = [...parts, ...central, end]
  const total = all.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}

/* ----------------------------------------------------------------- xlsx -- */

/** XML text escape. Control characters are stripped: Excel refuses to open a
 *  file containing them, and a product name should never carry one. */
function esc(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 1 -> A, 26 -> Z, 27 -> AA */
export function colName(n) {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * A cell is numeric only when the value is a JS number. Strings stay strings,
 * which is how an HSN code with a leading zero survives: 0901 written as a
 * number is 901, and that is a wrong code on a tax-bearing record.
 */
function cellXml(ref, value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
}

/**
 * Builds a one-sheet workbook.
 *
 *   columns  header labels, in order
 *   rows     objects keyed by those labels; a number is written as a number,
 *            anything else as text
 */
export function buildXlsx({ sheetName = 'Sheet1', columns, rows }) {
  const lines = []
  lines.push(`<row r="1">${columns.map((c, i) => cellXml(`${colName(i + 1)}1`, c)).join('')}</row>`)
  rows.forEach((row, ri) => {
    const r = ri + 2
    const cells = columns.map((c, i) => cellXml(`${colName(i + 1)}${r}`, row[c])).join('')
    lines.push(`<row r="${r}">${cells}</row>`)
  })

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${lines.join('')}</sheetData></worksheet>`

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${esc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1"'
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
    + ' Target="worksheets/sheet1.xml"/></Relationships>'

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1"'
    + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
    + ' Target="xl/workbook.xml"/></Relationships>'

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml"'
    + ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml"'
    + ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>'

  // [Content_Types].xml must be the first entry in the archive.
  return zip([
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheet) },
  ])
}
