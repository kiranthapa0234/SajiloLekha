/**
 * Formatting helpers.
 *
 * Every money value in the API is an INTEGER in the currency's minor unit. These
 * helpers are the single place that turns those integers into something a human
 * should read, so a rupee sign never disagrees between two screens.
 */
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import { fromMinorUnits } from '@shared/money.js';
import { currencyMeta } from '@shared/constants.js';

dayjs.extend(relativeTime);
dayjs.extend(advancedFormat);

/** Fallbacks used before the workspace settings have loaded. */
const FALLBACK = { code: 'NPR', symbol: 'Rs.', decimals: 2, locale: 'en-NP', timezone: 'Asia/Kathmandu' };

export function resolveCurrency(business) {
  if (!business) return FALLBACK;
  return {
    code: business.currency ?? FALLBACK.code,
    symbol: business.currencySymbol ?? FALLBACK.symbol,
    decimals: Number.isInteger(business.currencyDecimals) ? business.currencyDecimals : FALLBACK.decimals,
    locale: business.locale ?? FALLBACK.locale,
    timezone: business.timezone ?? FALLBACK.timezone,
  };
}

/**
 * Rs. 24,580.00 — the compact form used in KPI cards and tables.
 * @param {number} minor integer minor units
 */
export function formatMoney(minor, business, { showSymbol = true, compact = false } = {}) {
  const c = resolveCurrency(business);
  const value = fromMinorUnits(minor ?? 0, c.decimals);

  if (compact && Math.abs(value) >= 100000) {
    return `${showSymbol ? `${c.symbol} ` : ''}${new Intl.NumberFormat(c.locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)}`;
  }

  const formatted = new Intl.NumberFormat(c.locale, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  }).format(value);

  return showSymbol ? `${c.symbol} ${formatted}` : formatted;
}

/** Drop the decimals when they are all zero: "Rs. 1,250" not "Rs. 1,250.00". */
export function formatMoneyShort(minor, business) {
  const c = resolveCurrency(business);
  const value = fromMinorUnits(minor ?? 0, c.decimals);
  if (!Number.isInteger(value)) return formatMoney(minor, business);
  return `${c.symbol} ${new Intl.NumberFormat(c.locale, { maximumFractionDigits: 0 }).format(value)}`;
}

/** Always shows the minus sign for negatives: "-Rs. 1,200". */
export function formatSignedMoney(minor, business) {
  const value = minor ?? 0;
  if (value < 0) return `-${formatMoney(Math.abs(value), business, { showSymbol: true })}`;
  return formatMoney(value, business);
}

export function formatNumber(value, { decimals = 0 } = {}) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0);
}

export function formatPercent(value, { decimals = 1, signed = false } = {}) {
  const n = Number(value) || 0;
  const formatted = `${Math.abs(n).toFixed(decimals)}%`;
  if (signed && n > 0) return `+${formatted}`;
  return n < 0 ? `-${formatted}` : formatted;
}

/* -------------------------------------------------------------- DATES --- */

export function formatDate(value, pattern = 'DD MMM YYYY') {
  if (!value) return '--';
  const d = dayjs(value);
  return d.isValid() ? d.format(pattern) : '--';
}

export function formatDateTime(value) {
  return formatDate(value, 'DD MMM YYYY, h:mm A');
}

export function formatTime(value) {
  return formatDate(value, 'h:mm A');
}

export function formatRelative(value) {
  if (!value) return '--';
  const d = dayjs(value);
  return d.isValid() ? d.fromNow() : '--';
}

/** `2026-08-14` — the value an <input type="date"> expects. */
export function toDateInput(value) {
  if (!value) return '';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD') : '';
}

/* ---------------------------------------------------------- LABELS ------ */

export const INVOICE_STATUS_LABELS = {
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  digital_wallet: 'Digital wallet',
  cheque: 'Cheque',
  credit: 'On credit',
};

export const STOCK_STATUS_LABELS = {
  in_stock: 'In stock',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  not_tracked: 'Not tracked',
  archived: 'Archived',
};

export function humanise(value) {
  if (!value) return '';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 24580 -> "24.6k", used for tight table cells. */
export function compactNumber(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

export function pluralise(count, singular, plural) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

export { dayjs, currencyMeta };
