/**
 * The vNetra bulk-upload sheet, and the GST split it needs.
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

/** The template's sheet name. The importer looks for it. */
export const SHEET_NAME = 'Products'

/** The template's column order. If an upload is rejected, correct it here. */
export const COLUMNS = [
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

/**
 * Paise -> rupees as a NUMBER, because the template's own price cells are
 * numeric and a text price is the kind of thing an importer rejects.
 *
 * Missing stays blank. Number(null) and Number('') are both 0, so without the
 * guard a product with no MRP would be priced at zero -- and zero on a vending
 * machine means free. Blank is caught by the reviewer; free is not.
 */
export function priceOf(paise) {
  if (paise === null || paise === undefined || paise === '') return ''
  const n = Number(paise)
  if (!Number.isFinite(n)) return ''
  return Math.round(n) / 100
}

/**
 * HSN as a number where that is safe, as text where it is not.
 *
 * The template's HSN cell is numeric, so numeric is the default. But HSN codes
 * carry meaningful leading zeros -- 0901 is coffee -- and 0901 written as a
 * number is 901, a different code on a tax-bearing record. Those stay text.
 */
export function hsnCell(hsn) {
  const s = String(hsn ?? '').trim()
  if (!s) return ''
  if (/^[1-9]\d*$/.test(s)) return Number(s)
  return s
}

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
      'Selling Price': priceOf(mrp),
      'Stock Qty': 0,
      'HSN Code': hsnCell(hsn),
      'Product Description': name,
      'CGST (%)': cgst, 'SGST (%)': sgst, 'CESS (%)': cess, 'IGST (%)': igst,
    },
    flag,
    hsn,
  }
}

