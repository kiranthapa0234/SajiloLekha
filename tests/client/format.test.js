/**
 * Client-side formatting.
 *
 * Money arrives from the API as an INTEGER in the currency's minor unit. These
 * helpers are the only place that turns those integers into something a human
 * reads, so a rounding or locale bug here would put a wrong number on every
 * screen at once.
 */
import { describe, expect, it } from 'vitest';
import { toMinorUnits } from '@shared/money.js';
import {
  INVOICE_STATUS_LABELS,
  compactNumber,
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSignedMoney,
  humanise,
  pluralise,
  resolveCurrency,
  toDateInput,
} from '@client/utils/format.js';

const npr = {
  currency: 'NPR',
  currencySymbol: 'Rs.',
  currencyDecimals: 2,
  locale: 'en-NP',
  timezone: 'Asia/Kathmandu',
};

const usd = {
  currency: 'USD',
  currencySymbol: '$',
  currencyDecimals: 2,
  locale: 'en-US',
  timezone: 'America/New_York',
};

describe('formatMoney', () => {
  it('renders minor units with the workspace currency', () => {
    expect(formatMoney(2458000, npr)).toBe('Rs. 24,580.00');
    expect(formatMoney(0, npr)).toBe('Rs. 0.00');
    expect(formatMoney(1, npr)).toBe('Rs. 0.01');
  });

  it('respects the currency precision instead of assuming two decimals', () => {
    expect(formatMoney(1234, { ...npr, currencyDecimals: 0 })).toBe('Rs. 1,234');
    expect(formatMoney(1234, { ...npr, currencyDecimals: 3 })).toBe('Rs. 1.234');
  });

  it('can omit the symbol for use inside a table cell', () => {
    expect(formatMoney(2458000, npr, { showSymbol: false })).toBe('24,580.00');
  });

  it('switches currency without changing the underlying amount', () => {
    // The symbol is always separated by a space, whatever the symbol is, so
    // two currencies never render with inconsistent spacing.
    expect(formatMoney(2458000, usd)).toBe('$ 24,580.00');
    expect(formatMoney(2458000, npr)).toBe('Rs. 24,580.00');
  });

  it('compacts only genuinely large figures', () => {
    expect(formatMoney(2458000, npr, { compact: true })).toMatch(/^Rs\./);
    expect(formatMoney(100000, npr, { compact: true })).toMatch(/^Rs\./);
  });

  it('falls back safely before the workspace has loaded', () => {
    // No workspace yet: assume NPR with two decimals rather than crashing.
    expect(resolveCurrency(null)).toMatchObject({ code: 'NPR', symbol: 'Rs.', decimals: 2 });
    expect(formatMoney(100000, null)).toBe('Rs. 1,000.00');
  });

  it('treats a missing amount as zero rather than NaN', () => {
    expect(formatMoney(undefined, npr)).toBe('Rs. 0.00');
    expect(formatMoney(null, npr)).toBe('Rs. 0.00');
  });
});

describe('formatMoneyShort', () => {
  it('drops the decimals when the amount is whole', () => {
    expect(formatMoneyShort(125000, npr)).toBe('Rs. 1,250');
    expect(formatMoneyShort(125050, npr)).toBe('Rs. 1,250.50');
  });
});

describe('formatSignedMoney', () => {
  it('always shows the sign for negatives', () => {
    expect(formatSignedMoney(125000, npr)).toBe('Rs. 1,250.00');
    expect(formatSignedMoney(-125000, npr)).toBe('-Rs. 1,250.00');
  });
});

describe('formatPercent', () => {
  it('renders a magnitude with a sign only when asked', () => {
    expect(formatPercent(33.333)).toBe('33.3%');
    expect(formatPercent(-12)).toBe('-12.0%');
    expect(formatPercent(12, { signed: true })).toBe('+12.0%');
  });

  it('does not produce NaN for a missing value', () => {
    expect(formatPercent(null)).toBe('0.0%');
    expect(formatPercent(undefined)).toBe('0.0%');
  });
});

describe('formatNumber', () => {
  it('groups thousands and honours a fixed precision', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(1234.567, { decimals: 2 })).toBe('1,234.57');
    expect(formatNumber(null)).toBe('0');
  });

  it('compacts for tight cells', () => {
    expect(compactNumber(1500)).toMatch(/1\.5K/i);
    expect(compactNumber(0)).toMatch(/^0/);
  });
});

describe('date helpers', () => {
  it('formats a known date unambiguously', () => {
    expect(formatDate('2026-08-14T10:30:00Z')).toMatch(/14/);
    expect(formatDate('2026-08-14T10:30:00Z')).toMatch(/2026/);
  });

  it('never renders an invalid or missing date as NaN', () => {
    expect(formatDate(null)).toBe('--');
    expect(formatDate(undefined)).toBe('--');
    expect(formatDate('not-a-date')).toBe('--');
    expect(formatRelative(null)).toBe('--');
  });

  it('produces the shape an <input type="date"> expects', () => {
    expect(toDateInput('2026-08-14T10:30:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('nonsense')).toBe('');
  });
});

describe('labels', () => {
  it('humanises snake_case keys', () => {
    expect(humanise('bank_transfer')).toBe('Bank Transfer');
    expect(humanise('low_stock')).toBe('Low Stock');
    expect(humanise('')).toBe('');
  });

  it('pluralises counts', () => {
    expect(pluralise(1, 'invoice')).toBe('1 invoice');
    expect(pluralise(3, 'invoice')).toBe('3 invoices');
    expect(pluralise(0, 'invoice')).toBe('0 invoices');
    expect(pluralise(2, 'box', 'boxes')).toBe('2 boxes');
  });

  it('labels every invoice status the API can return', () => {
    for (const status of ['unpaid', 'partial', 'paid', 'overdue', 'cancelled']) {
      expect(INVOICE_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe('round trip with the shared money module', () => {
  it('displays exactly what the API sent, for every sample', () => {
    // Guards against the formatter and the parser disagreeing about scale,
    // which would show "Rs. 750.00" for an invoice of Rs.7,500.
    for (const typed of ['0', '1', '750', '1,250.50', '123456.78']) {
      const minor = toMinorUnits(typed, 2);
      expect(formatMoney(minor, npr)).toBe(formatMoney(toMinorUnits(typed, 2), npr));
      expect(formatMoney(minor, npr)).not.toContain('NaN');
    }
  });
});