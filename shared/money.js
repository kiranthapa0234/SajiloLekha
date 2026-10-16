/**
 * Monetary value handling.
 *
 * FINANCIAL RULE: All money is persisted and computed as an INTEGER number of
 * MINOR UNITS (for NPR: 1 rupee = 100 paisa). Floating point is never used for
 * storage or for intermediate arithmetic. Decimal input from forms / APIs is
 * converted through string parsing so that `0.1 + 0.2` can never happen.
 *
 * JavaScript's Number is an IEEE-754 double: exact for integers up to
 * 2^53-1. Minor-unit amounts stay far below that ceiling for realistic
 * business volumes, and all arithmetic is integer-only, so Number is safe here.
 */

export const MIN_UNITS_PER_MAJOR = 1000;

/** Supported decimal scales. NPR/LKR/INR use paisa (2), JPY uses sen (0). */
export const SUPPORTED_SCALES = [0, 2, 3];

export class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertScale(decimals) {
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 6) {
    throw new MoneyError(`Invalid currency scale: ${decimals}`);
  }
  return d;
}

/**
 * Convert a decimal amount (number or string like "1,234.56", "Rs. 90", "-12")
 * into integer minor units.
 *
 * @param {number|string} amount
 * @param {number} decimals currency decimal places (default 2)
 * @returns {number} integer minor units
 */
export function toMinorUnits(amount, decimals = 2) {
  const scale = assertScale(decimals);
  if (amount === null || amount === undefined || amount === '') {
    throw new MoneyError('Amount is required');
  }

  let raw = typeof amount === 'number' ? String(amount) : String(amount).trim();
  if (raw === '') throw new MoneyError('Amount is required');

  // Drop a leading currency label or symbol first ("Rs. 1,250.50",
  // "NPR 90", "₹90"). Doing this before the generic strip matters: "Rs."
  // contains a dot, which would otherwise look like an extra decimal point.
  raw = raw.replace(/^\s*(?:[A-Za-z]{1,4}\.?|Rs\.?|NRs\.?|[₹$€£¥₦₨])\s*/i, '');

  // Strip spacing (incl. NBSP / narrow NBSP) and any remaining noise.
  raw = raw
    .replace(/[\u00A0\u202F]/g, '')
    .replace(/\s/g, '')
    .replace(/[^\d.,+-]/g, '');

  if (raw === '' || raw === '-' || raw === '+') {
    throw new MoneyError(`Invalid amount: ${amount}`);
  }

  // ---- Work out which separator is the decimal point ----------------------
  // A documented, predictable rule (the target locale writes "1,250.50"):
  //   1. Both separators present -> the RIGHTMOST is the decimal point and the
  //      other is thousands grouping ("1,234.56", "1.234,56").
  //   2. Only dots -> the dot is the decimal point ("2.675" is Rs.2.675).
  //   3. Only commas -> commas are thousands grouping ("1,250" is Rs.1,250).
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');
  let decimalSep = null;
  let thousandSep = null;

  if (hasDot && hasComma) {
    decimalSep = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
    thousandSep = decimalSep === '.' ? ',' : '.';
  } else if (hasDot) {
    decimalSep = '.';
  } else if (hasComma) {
    thousandSep = ',';
  }

  let cleaned = raw;
  if (thousandSep) cleaned = cleaned.split(thousandSep).join('');
  if (decimalSep && decimalSep !== '.') cleaned = cleaned.split(decimalSep).join('.');

  if (!/^[+-]?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.' || cleaned === '-.') {
    throw new MoneyError(`Invalid amount: ${amount}`);
  }

  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');
  const dotIndex = unsigned.indexOf('.');
  const intDigits = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fracDigits = dotIndex === -1 ? '' : unsigned.slice(dotIndex + 1);

  const intValue = intDigits === '' ? 0 : Number(intDigits);
  if (!Number.isSafeInteger(intValue)) {
    throw new MoneyError(`Amount out of safe range: ${amount}`);
  }

  // Scale the major-unit integer part up, then add the fractional remainder.
  // Everything here is integer arithmetic: `0.1 + 0.2` cannot occur.
  let minor = intValue * 10 ** scale;
  if (scale > 0) {
    if (fracDigits.length <= scale) {
      minor += Number((fracDigits || '').padEnd(scale, '0'));
    } else {
      // More precision than the currency supports: round half-up rather than
      // silently truncating, so 1.005 at scale 2 becomes 1.01.
      minor += Number(fracDigits.slice(0, scale).padEnd(scale, '0'));
      if (Number(fracDigits[scale]) >= 5) minor += 1;
    }
  }

  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Amount out of safe range: ${amount}`);
  }
  return negative ? -minor : minor;
}

/** Convert integer minor units back to a decimal number (for display/forms only). */
export function fromMinorUnits(minor, decimals = 2) {
  const scale = assertScale(decimals);
  const n = Number(minor ?? 0);
  if (!Number.isFinite(n)) throw new MoneyError(`Invalid minor amount: ${minor}`);
  if (scale === 0) return n;
  return Number((n / 10 ** scale).toFixed(scale));
}

/**
 * Percentage of an integer amount, rounded half-up.
 * Both arguments and the result stay in the same minor unit, so no scaling
 * factor is involved: 13% of Rs.100.00 (10000 minor) is Rs.13.00 (1300 minor).
 */
export function applyPercent(minor, percent, decimals = 2) {
  assertScale(decimals);
  const base = Number(minor ?? 0);
  const pct = Number(percent ?? 0);
  if (!Number.isFinite(base)) throw new MoneyError('Invalid base amount');
  if (!Number.isFinite(pct)) throw new MoneyError('Invalid percentage');

  const scaled = base * pct;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) / 100);
  return Math.trunc(rounded);
}

/** Integer sum that refuses fractional contamination rather than truncating it. */
export function sumMinor(values) {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new MoneyError(`Non-integer money value: ${v}`);
    total += n;
    if (!Number.isSafeInteger(total)) throw new MoneyError('Money total overflow');
  }
  return total;
}

/** Integer multiply for unit-price x quantity (keeps result integral). */
export function multiplyMinor(unitMinor, quantity) {
  const unit = Number(unitMinor ?? 0);
  const qty = Number(quantity ?? 0);
  if (!Number.isSafeInteger(unit)) throw new MoneyError(`Non-integer unit price: ${unitMinor}`);
  if (!Number.isFinite(qty)) throw new MoneyError(`Invalid quantity: ${quantity}`);
  return Math.trunc(unit * qty);
}

export function isMinorAmount(value) {
  return Number.isSafeInteger(value);
}

/** Safe integer ceiling division. `-0` is normalised to `0`. */
export function ceilDiv(a, b) {
  const n = Math.trunc(Number(a));
  const d = Math.trunc(Number(b));
  if (d === 0) throw new MoneyError('Division by zero');
  const result = Math.ceil(n / d);
  return result === 0 ? 0 : result;
}

export function clampMinor(value, min, max) {
  let v = Math.trunc(Number(value ?? 0));
  if (min !== undefined && min !== null && v < min) v = min;
  if (max !== undefined && max !== null && v > max) v = max;
  return v;
}

export const ZERO_MINOR = 0;
