import {
  ISSUER,
  DEBIT_NOTE_REASONS,
  GST_RATES,
  UOM_OPTIONS,
  DN_LIMITS,
  GSTIN_RE,
  valuesOf,
} from '../shared/constants.js'
import { cleanText } from './validate.js'

/**
 * Debit note maths and validation.
 *
 * Every amount is an integer number of paise and every quantity an integer
 * number of thousandths. Nothing here uses floating point, because a document
 * that goes to a supplier's accounts team has to reconcile to the last paisa.
 */

const REASON_SET = valuesOf(DEBIT_NOTE_REASONS)
const UOM_SET = valuesOf(UOM_OPTIONS)
const GST_SET = new Set(GST_RATES.map((r) => r.value))

/* ------------------------------------------------------------ IST dates -- */

/** Workers run in UTC; invoices are dated in IST (UTC+5:30). */
export function istNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
}

export function istDateString(d = istNow()) {
  return d.toISOString().slice(0, 10)
}

/**
 * Indian financial year for a date: 1 April – 31 March.
 * 2026-08-13 -> "2026-27";  2026-02-10 -> "2025-26"
 */
export function financialYear(d = istNow()) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1 // 1-12
  const start = m >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/* ------------------------------------------------------------ numbering -- */

/**
 * Allocates the next raw sequence number in a series atomically.
 *
 * The upsert returns the row's new last_no in both branches: a fresh insert
 * yields 1, a conflict yields the incremented value. There is therefore no
 * read-then-write race.
 */
export async function nextCounter(env, series, fy) {
  const row = await env.DB.prepare(
    `INSERT INTO document_counters (series, fy, last_no) VALUES (?1, ?2, 1)
     ON CONFLICT(series, fy) DO UPDATE SET last_no = last_no + 1
     RETURNING last_no`
  ).bind(series, fy).first()

  const seq = row?.last_no
  if (!Number.isInteger(seq) || seq < 1) throw new Error('Number allocation failed')
  return seq
}

/** Formats a sequence number as a document number: FETCH/DN/2026-27/0001. */
export function documentNumber(series, fy, seq) {
  return `FETCH/${series}/${fy}/${String(seq).padStart(4, '0')}`
}

/**
 * Allocates a formatted document number in its own round trip.
 *
 * Prefer counterBumpStatement() inside a batch where the number is being
 * written to a table -- this variant burns the sequence number if whatever
 * follows it fails. It remains for callers that only need a number.
 */
export async function allocateNumber(env, series, fy) {
  const seq = await nextCounter(env, series, fy)
  return { seq, number: documentNumber(series, fy, seq) }
}

/**
 * Counter bump as a statement, for use as the FIRST entry of an env.DB.batch().
 *
 * A later statement in the same batch derives its document number from
 * document_counters (see DOC_NUMBER_SQL), reading this statement's own write.
 * Because the whole batch is one transaction, a failing insert rolls the
 * counter back with it -- so a rejected document leaves no gap in the series.
 * That matters for GST-facing documents, where gaps invite questions.
 */
export function counterBumpStatement(env, series, fy) {
  return env.DB.prepare(
    `INSERT INTO document_counters (series, fy, last_no) VALUES (?1, ?2, 1)
     ON CONFLICT(series, fy) DO UPDATE SET last_no = last_no + 1`
  ).bind(series, fy)
}

/**
 * SQL producing the formatted document number for a counter row aliased `c`.
 * Mirrors documentNumber() above; keep the two in step.
 */
export const DOC_NUMBER_SQL =
  `('FETCH/' || c.series || '/' || c.fy || '/' || printf('%04d', c.last_no))`

/* ---------------------------------------------------------------- maths -- */

/** Rupees (string or number) -> integer paise. Returns null if unusable. */
export function toPaise(input) {
  if (input === '' || input == null) return null
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input).replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Quantity -> integer thousandths, so 2.5 becomes 2500. */
export function toMilli(input) {
  if (input === '' || input == null) return null
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 1000)
}

/**
 * Whether to charge IGST instead of CGST+SGST.
 *
 * Comparison is on the GSTIN state code. With no supplier GSTIN we cannot
 * know, so we assume intra-state — the conservative choice, because it splits
 * the same total across two heads rather than inventing an interstate supply.
 */
export function isInterstate(supplierGstin) {
  if (!supplierGstin) return false
  return supplierGstin.slice(0, 2) !== ISSUER.stateCode
}

/**
 * Computes one line. taxable = qty * rate, then tax on taxable.
 * CGST and SGST are split so that cgst + sgst === total tax exactly; the odd
 * paisa lands on SGST rather than vanishing.
 */
export function computeLine(line, interstate) {
  const taxable = Math.round((line.qty_milli * line.rate_paise) / 1000)
  const tax = Math.round((taxable * line.gst_bps) / 10000)

  let cgst = 0
  let sgst = 0
  let igst = 0
  if (interstate) {
    igst = tax
  } else {
    cgst = Math.floor(tax / 2)
    sgst = tax - cgst
  }

  return {
    ...line,
    taxable_paise: taxable,
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: igst,
    total_paise: taxable + tax,
  }
}

/** Sums lines and applies the customary round-off to the nearest rupee. */
export function computeTotals(lines) {
  const sum = (k) => lines.reduce((t, l) => t + l[k], 0)
  const taxable = sum('taxable_paise')
  const cgst = sum('cgst_paise')
  const sgst = sum('sgst_paise')
  const igst = sum('igst_paise')
  const gross = taxable + cgst + sgst + igst

  const rounded = Math.round(gross / 100) * 100
  return {
    taxable_paise: taxable,
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: igst,
    round_off_paise: rounded - gross,
    total_paise: rounded,
  }
}

/* ------------------------------------------------------------ formatting -- */

export const formatPaise = (p) =>
  (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

const twoDigits = (n) =>
  n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`

const threeDigits = (n) => {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ')
}

/** Indian numbering: crore, lakh, thousand, hundred. */
export function amountInWords(paise) {
  const rupees = Math.floor(paise / 100)
  const pais = paise % 100
  if (rupees === 0 && pais === 0) return 'Zero Rupees Only'

  const parts = []
  const crore = Math.floor(rupees / 10000000)
  const lakh = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const rest = rupees % 1000

  if (crore) parts.push(`${threeDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rest) parts.push(threeDigits(rest))

  let out = parts.join(' ').trim()
  out = out ? `${out} Rupees` : ''
  if (pais) out += `${out ? ' and ' : ''}${twoDigits(pais)} Paise`
  return `${out} Only`.replace(/\s+/g, ' ')
}

/* ----------------------------------------------------------- validation -- */

/**
 * Validates a debit note payload and returns fully computed values.
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validateDebitNote(payload) {
  const errors = []
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Malformed request body.'] }
  }

  const supplierName = cleanText(payload.supplierName, DN_LIMITS.supplierName)
  if (!supplierName) errors.push('Supplier name is required.')

  let supplierGstin = cleanText(payload.supplierGstin, DN_LIMITS.gstin)
  if (supplierGstin) {
    supplierGstin = supplierGstin.toUpperCase().replace(/\s/g, '')
    if (!GSTIN_RE.test(supplierGstin)) {
      errors.push('That GSTIN is not valid. It should be 15 characters, e.g. 29ABBCA9450H1ZH.')
    }
  }

  const reason = typeof payload.reason === 'string' && REASON_SET.has(payload.reason)
    ? payload.reason
    : null
  if (!reason) errors.push('Choose a reason for the debit note.')

  const rawLines = Array.isArray(payload.lines) ? payload.lines : []
  if (!rawLines.length) errors.push('Add at least one line item.')
  if (rawLines.length > DN_LIMITS.maxLines) {
    errors.push(`A debit note can carry at most ${DN_LIMITS.maxLines} lines.`)
  }

  const interstate = isInterstate(supplierGstin)
  const lines = []

  rawLines.slice(0, DN_LIMITS.maxLines).forEach((raw, i) => {
    const n = i + 1
    const description = cleanText(raw.description, DN_LIMITS.description)
    const qty_milli = toMilli(raw.qty)
    const rate_paise = toPaise(raw.rate)
    const gst_bps = GST_SET.has(Number(raw.gstBps)) ? Number(raw.gstBps) : 0
    const uom = typeof raw.uom === 'string' && UOM_SET.has(raw.uom) ? raw.uom : 'pcs'
    const hsn = cleanText(raw.hsn, DN_LIMITS.hsn)

    if (!description) errors.push(`Line ${n}: description is required.`)
    if (qty_milli == null) errors.push(`Line ${n}: quantity must be greater than zero.`)
    if (rate_paise == null) errors.push(`Line ${n}: rate is not a valid amount.`)
    if (hsn && !/^\d{4,8}$/.test(hsn)) errors.push(`Line ${n}: HSN should be 4 to 8 digits.`)

    if (description && qty_milli != null && rate_paise != null) {
      const computed = computeLine(
        { line_no: n, description, hsn, qty_milli, uom, rate_paise, gst_bps },
        interstate
      )
      if (computed.taxable_paise > DN_LIMITS.maxLineValuePaise) {
        errors.push(`Line ${n}: value looks too large — please check the quantity and rate.`)
      }
      lines.push(computed)
    }
  })

  if (errors.length) return { ok: false, errors }

  const totals = computeTotals(lines)

  return {
    ok: true,
    value: {
      supplier_name: supplierName,
      supplier_gstin: supplierGstin,
      supplier_address: cleanText(payload.supplierAddress, DN_LIMITS.supplierAddress),
      supplier_state: cleanText(payload.supplierState, 40),
      reason,
      invoice_ref: cleanText(payload.invoiceRef, DN_LIMITS.invoiceRef),
      invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(payload.invoiceDate || '') ? payload.invoiceDate : null,
      notes: cleanText(payload.notes, DN_LIMITS.notes),
      is_interstate: interstate ? 1 : 0,
      lines,
      ...totals,
    },
  }
}
