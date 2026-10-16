/**
 * Money context: converts the human-facing decimal inputs used by API clients
 * into integer minor units, and back again for responses.
 *
 * A single object is created per request from the business settings, so the
 * currency scale is never guessed.
 */
import { fromMinorUnits, toMinorUnits } from '../../../shared/money.js';
import { currencyMeta } from '../../../shared/constants.js';
import env from '../config/env.js';

export function createMoneyContext(businessOrSettings) {
  const settings = businessOrSettings?.settings ?? businessOrSettings ?? {};
  const code = settings.currency ?? env.business.currency;
  const meta = currencyMeta(code);
  const decimals = Number.isInteger(settings.currencyDecimals)
    ? settings.currencyDecimals
    : meta.decimals;

  return {
    currency: code,
    symbol: settings.currencySymbol || meta.symbol,
    decimals,
    locale: settings.locale || meta.locale,
    timezone: settings.timezone || env.business.timezone,

    /** "1,250.50" - ’ 125050 */
    parse(amount, fallback = 0) {
      if (amount === null || amount === undefined || amount === '') return fallback;
      try {
        return toMinorUnits(amount, decimals);
      } catch {
        return fallback;
      }
    },

    /** 125050 - ’ "1250.5" (for JSON responses the client formats for humans). */
    toDecimal(minor) {
      return fromMinorUnits(minor ?? 0, decimals);
    },

    format(minor) {
      const value = fromMinorUnits(minor ?? 0, decimals);
      try {
        return new Intl.NumberFormat(this.locale, {
          style: 'currency',
          currency: code === 'NPR_rupee' ? 'NPR' : code,
          currencyDisplay: 'narrowSymbol',
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(value);
      } catch {
        return `${this.symbol} ${value.toFixed(decimals)}`;
      }
    },

    formatPlain(minor) {
      return `${this.symbol}${fromMinorUnits(minor ?? 0, decimals).toFixed(decimals)}`;
    },
  };
}

/**
 * Attach both representations to a money object so the API is friendly without
 * ever storing a float. `*Minor` is authoritative; `*Amount` is display-only.
 */
export function moneyPair(minor, money, suffix = '') {
  return {
    [`${suffix}Minor`]: minor ?? 0,
    [`${suffix}Amount`]: money.toDecimal(minor ?? 0),
  };
}

export default { createMoneyContext, moneyPair };
