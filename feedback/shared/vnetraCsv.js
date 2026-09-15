/**
 * The vNetra bulk-upload CSV, and the GST split it needs.
 *
 * Ported from scripts/vlite-products-export.py, which worked this out against
 * the live catalogue. The important finding, repeated here because it is
 * counter-intuitive: VLite returns cgst / sgst / utgst as AMOUNTS, and in this
 * catalogue they are zero for almost every product. Deriving a rate from them
 * gives a confident, wrong 0%. The rate that actually drives pricing comes from
 * the two figures VLite does populate:
 *
 *     total rate = (mrp - taxablePrice) / taxablePrice
 *
 * The amount fields are the fallback, not the primary.
 */

/** The template's column order. If an upload is rejected, correct it here. */
export const CSV_COLUMNS = [
  'Product Code', 'Product Name (English)', 'Brand', 'Category',
  'Selling Price', 'Stock Qty', 'HSN Code', 'Product Description',
  'CGST (%)', 'SGST (%)', 'CESS (%)', 'IGST (%)',
]

/**
 * Total rate -> the four columns. 40% is 28% GST plus 12% cess on aerated and
 * energy drinks, which is why it is a real total even though 40 is not a slab.
 */
const KNOWN_TOTALS = {
  0:  { cgst: 0,   sgst: 0,   cess: 0 },
  5:  { cgst: 2.5, sgst: 2.5, cess: 0 },
  12: { cgst: 6,   sgst: 6,   cess: 0 },
  18: { cgst: 9,   sgst: 9,   cess: 0 },
  28: { cgst: 14,  sgst: 14,  cess: 0 },
  40: { cgst: 14,  sgst: 14,  cess: 12 },
}

const TOLERANCE = 0.35

/** Total tax rate implied by the gross and net prices. */
export function impliedTotal(mrpPaise, taxablePaise) {
  const mrp = Number(mrpPaise)
  const taxable = Number(taxablePaise)
  if (!Number.isFinite(mrp) || !Number.isFinite(taxable) || taxable <= 0) return null
  return ((mrp - taxable) / taxable) * 100
}

function snap(value) {
  if (value == null) return null
  const allowed = Object.keys(KNOWN_TOTALS).map(Number)
  let best = allowed[0]
  for (const a of allowed) if (Math.abs(a - value) < Math.abs(best - value)) best = a
  return Math.abs(best - value) <= TOLERANCE ? best : null
}

/**
 * Splits a total rate into the four columns.
 *
 * Returns { cgst, sgst, cess, igst, flag }. `flag` is a sentence for a human
 * when the rate is not one India uses. The row is still filled -- a blank tax
 * column in a bulk upload helps nobody -- but every flag is reported so it can
 * be checked before the file is used.
 */
export function splitTotal(total) {
  if (total == null) {
    return { cgst: null, sgst: null, cess: null, igst: null,
             flag: 'no MRP or taxable price to derive a rate from' }
  }

  const snapped = snap(total)
  if (snapped != null) {
    const { cgst, sgst, cess } = KNOWN_TOTALS[snapped]
    return { cgst, sgst, cess, igst: 0, flag: null }
  }

  const rounded = Math.round(total * 100) / 100
  if (Math.abs(rounded - 10) <= TOLERANCE) {
    return { cgst: 5, sgst: 5, cess: 0, igst: 0,
             flag: 'comes out at 10%, which is not a GST slab -- looks like 5 in both '
                 + 'the CGST and SGST boxes; 5 + 5 reproduced as-is' }
  }
  const half = Math.round((rounded / 2) * 100) / 100
  return { cgst: half, sgst: half, cess: 0, igst: 0,
           flag: `comes out at ${rounded}%, which is not a recognisable rate -- `
               + 'the MRP and taxable price disagree' }
}

/** Percentage an amount represents of the taxable value. The fallback path. */
export function pctOf(amountPaise, taxablePaise) {
  const taxable = Number(taxablePaise)
  if (!Number.isFinite(taxable) || taxable <= 0) return null
  return (Number(amountPaise || 0) / taxable) * 100
}

/** Paise -> a two-decimal string. A bare float writes 35 as "35.0", which some
 *  importers read as a malformed price. */
export function rupees(paise) {
  // Number(null) and Number('') are both 0, so a missing MRP would otherwise
  // be written as "0.00" -- a price of zero, which on a vending machine means
  // the product is free. Missing has to stay blank and be caught by the
  // reviewer, not silently become the cheapest thing in the file.
  if (paise === null || paise === undefined || paise === '') return ''
  const n = Number(paise)
  return Number.isFinite(n) ? (n / 100).toFixed(2) : ''
}

/** RFC 4180: quote everything, double any embedded quote. A product name with
 *  a comma in it would otherwise shift every later column by one. */
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

/**
 * One product -> one CSV row object, plus anything worth telling a human.
 *
 * Stock Qty is 0 deliberately. Stock in vNetra comes from loading a machine,
 * and inventing an opening quantity here would put phantom stock on the books
 * for every product in the file.
 */
export function rowFor(p) {
  const taxable = p.taxablePaise ?? p.taxablePriceS ?? p.taxablePriceUT ?? null
  const mrp = p.mrpPaise ?? p.mrp ?? null

  let total = impliedTotal(mrp, taxable)
  if (total == null) {
    const amounts = Number(p.cgst || 0) + Number(p.sgst || 0) + Number(p.utgst || 0)
    total = pctOf(amounts, taxable)
  }
  const { cgst, sgst, cess, igst, flag } = splitTotal(total)

  const name = (p.name || '').trim()
  const hsn = (p.hsn || p.hsnCode || '').trim()

  return {
    row: {
      'Product Code': (p.displayProductId || '').trim().toUpperCase(),
      'Product Name (English)': name,
      Brand: (p.brand || '').trim(),
      Category: (p.category || '').trim(),
      'Selling Price': rupees(mrp),
      'Stock Qty': 0,
      'HSN Code': hsn,
      'Product Description': name,
      'CGST (%)': cgst, 'SGST (%)': sgst, 'CESS (%)': cess, 'IGST (%)': igst,
    },
    flag,
    hsn,
  }
}

/** Rows -> the CSV text. */
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(cell).join(',')]
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => cell(r[c])).join(','))
  // Trailing newline: some importers drop the last row without one.
  return lines.join('\r\n') + '\r\n'
}
