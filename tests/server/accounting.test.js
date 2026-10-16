/**
 * Accounting rules, isolated from HTTP.
 *
 * These are the definitions every report in the product is built on. If any of
 * these change, the dashboard, the P&L and the exports would all silently change
 * meaning, so they are pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTotals,
  computeLine,
  deriveInvoiceStatus,
  deriveProfit,
  isPastDue,
  outstandingMinor,
  percentChange,
} from '@shared/accounting.js';

const rs = (rupees) => rupees * 100;

describe('computeLine', () => {
  it('computes a plain line', () => {
    const line = computeLine({ unitPriceMinor: rs(150), quantity: 3, costMinor: rs(90) });
    expect(line.grossMinor).toBe(rs(450));
    expect(line.netMinor).toBe(rs(450));
    expect(line.taxMinor).toBe(0);
    expect(line.totalMinor).toBe(rs(450));
    expect(line.lineCogsMinor).toBe(rs(270));
  });

  it('applies a percentage discount', () => {
    const line = computeLine({ unitPriceMinor: rs(200), quantity: 2, discountPercent: 10, costMinor: rs(120) });
    expect(line.discountMinor).toBe(rs(40)); // 10% of Rs.400
    expect(line.netMinor).toBe(rs(360));
  });

  it('applies a fixed discount and caps it at the line total', () => {
    const line = computeLine({ unitPriceMinor: rs(100), quantity: 1, discountMinor: rs(500) });
    expect(line.discountMinor).toBe(rs(100));
    expect(line.netMinor).toBe(0);
    expect(line.totalMinor).toBe(0);
  });

  it('adds exclusive tax on the discounted amount', () => {
    const line = computeLine({ unitPriceMinor: rs(1000), quantity: 1, taxPercent: 13, costMinor: rs(600) });
    expect(line.netMinor).toBe(rs(1000)); // revenue excludes tax
    expect(line.taxMinor).toBe(rs(130)); // tax is a liability
    expect(line.totalMinor).toBe(rs(1130));
  });

  it('backs tax out of tax-inclusive prices so revenue stays exclusive', () => {
    const line = computeLine({
      unitPriceMinor: rs(1130),
      quantity: 1,
      taxPercent: 13,
      taxInclusive: true,
      costMinor: rs(600),
    });
    expect(line.netMinor).toBe(rs(1000));
    expect(line.taxMinor).toBe(rs(130));
    expect(line.totalMinor).toBe(rs(1130));
  });

  it('stays integer throughout — every money figure, never a float', () => {
    const line = computeLine({ unitPriceMinor: 3333, quantity: 3, taxPercent: 7.5, costMinor: 1999 });
    const moneyFields = ['unitPriceMinor', 'grossMinor', 'discountMinor', 'netMinor', 'taxMinor', 'totalMinor', 'costMinor', 'lineCogsMinor'];
    for (const key of moneyFields) {
      expect(Number.isSafeInteger(line[key]), `${key} must be an integer`).toBe(true);
    }
  });

  it('rejects non-positive quantities', () => {
    expect(() => computeLine({ unitPriceMinor: 100, quantity: 0 })).toThrow();
    expect(() => computeLine({ unitPriceMinor: 100, quantity: -1 })).toThrow();
  });
});

describe('computeInvoiceTotals', () => {
  const lines = [
    { grossMinor: rs(450), discountMinor: 0, netMinor: rs(450), taxMinor: 0, lineCogsMinor: rs(270) },
    { grossMinor: rs(400), discountMinor: rs(40), netMinor: rs(360), taxMinor: 0, lineCogsMinor: rs(240) },
  ];

  it('sums lines', () => {
    const totals = computeInvoiceTotals(lines);
    expect(totals.grossMinor).toBe(rs(850));
    expect(totals.totalDiscountMinor).toBe(rs(40));
    expect(totals.netSalesMinor).toBe(rs(810));
    expect(totals.totalMinor).toBe(rs(810));
    expect(totals.cogsMinor).toBe(rs(510));
    expect(totals.profitMinor).toBe(rs(300));
  });

  it('spreads an invoice-level discount proportionally across tax and COGS', () => {
    const taxed = [
      { grossMinor: rs(1000), discountMinor: 0, netMinor: rs(1000), taxMinor: rs(130), lineCogsMinor: rs(600) },
    ];
    const totals = computeInvoiceTotals(taxed, { invoiceDiscountMinor: rs(100) });
    // Revenue falls to Rs.900; tax scales with it, staying consistent.
    expect(totals.netSalesMinor).toBe(rs(900));
    expect(totals.totalMinor).toBe(rs(900 + 117));
    expect(totals.netSalesMinor + totals.taxMinor).toBe(totals.totalMinor);
  });

  it('never lets an invoice discount exceed the subtotal', () => {
    const totals = computeInvoiceTotals(lines, { invoiceDiscountMinor: rs(99999) });
    expect(totals.netSalesMinor).toBe(0);
    expect(totals.totalMinor).toBe(0);
  });
});

describe('deriveProfit', () => {
  it('follows the documented formula', () => {
    const result = deriveProfit({
      invoiceTotals: [{ netSalesMinor: rs(1000), cogsMinor: rs(600), refundMinor: rs(100) }],
      expenseTotals: [rs(200)],
    });

    expect(result.revenueMinor).toBe(rs(900)); // netSales - refunds
    expect(result.grossProfitMinor).toBe(rs(300)); // revenue - cogs
    expect(result.operatingExpensesMinor).toBe(rs(200));
    expect(result.netProfitMinor).toBe(rs(100));
    expect(result.grossMarginPercent).toBe(33.33);
    expect(result.netMarginPercent).toBe(11.11);
  });

  it('reports zero margins when there is no revenue rather than dividing by zero', () => {
    const result = deriveProfit({ invoiceTotals: [{ netSalesMinor: 0, cogsMinor: 0, refundMinor: 0 }], expenseTotals: [rs(50)] });
    expect(result.grossMarginPercent).toBe(0);
    expect(result.netMarginPercent).toBe(0);
    expect(result.netProfitMinor).toBe(-rs(50));
  });

  it('never subtracts cash expenses from cash collected to make profit', () => {
    // A fully unpaid sale of Rs.1,000 costing Rs.600, with Rs.300 of paid rent:
    // the business made Rs.100 of profit and collected Rs.0 of cash.
    const result = deriveProfit({
      invoiceTotals: [{ netSalesMinor: rs(1000), cogsMinor: rs(600), refundMinor: 0 }],
      expenseTotals: [rs(300)],
    });
    expect(result.netProfitMinor).toBe(rs(100));
  });
});

describe('deriveInvoiceStatus', () => {
  const due = new Date('2026-01-10T00:00:00Z');
  const before = new Date('2026-01-01T00:00:00Z');
  const after = new Date('2026-02-01T00:00:00Z');

  it('is unpaid with nothing collected and no due date', () => {
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: 0 })).toBe('unpaid');
  });

  it('is partial with a part payment', () => {
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: rs(40), dueDate: due, now: before })).toBe('partial');
  });

  it('is paid when fully collected', () => {
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: rs(100), dueDate: due, now: after })).toBe('paid');
  });

  it('becomes overdue purely with the passage of time', () => {
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: 0, dueDate: due, now: after })).toBe('overdue');
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: rs(40), dueDate: due, now: after })).toBe('overdue');
  });

  it('is paid once settled even if the due date has passed', () => {
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: rs(100), dueDate: due, now: after })).toBe('paid');
  });

  it('stays cancelled once cancelled', () => {
    expect(deriveInvoiceStatus({ totalMinor: rs(100), paidMinor: rs(100), status: 'cancelled', dueDate: due, now: after })).toBe(
      'cancelled'
    );
  });

  it('treats a zero-total document as settled', () => {
    expect(deriveInvoiceStatus({ totalMinor: 0, paidMinor: 0 })).toBe('paid');
  });
});

describe('isPastDue', () => {
  it('is false without a due date', () => {
    expect(isPastDue(null)).toBe(false);
    expect(isPastDue(undefined)).toBe(false);
  });

  it('is false for an invalid date', () => {
    expect(isPastDue(new Date('nonsense'))).toBe(false);
  });

  it('compares strictly', () => {
    const d = new Date('2026-01-10T00:00:00Z');
    expect(isPastDue(d, new Date('2026-01-10T00:00:00Z'))).toBe(false);
    expect(isPastDue(d, new Date('2026-01-10T00:00:00.001Z'))).toBe(true);
  });
});

describe('outstandingMinor and percentChange', () => {
  it('never returns a negative balance', () => {
    expect(outstandingMinor(rs(100), rs(40))).toBe(rs(60));
    expect(outstandingMinor(rs(100), rs(100))).toBe(0);
    expect(outstandingMinor(rs(100), rs(150))).toBe(0);
  });

  it('computes period-over-period change', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });

  it('refuses to call growth from a zero baseline a percentage', () => {
    // A shop that did Rs. 8,500 this month against nothing last month has not
    // "doubled". Returning 100 here would put a false claim on the dashboard.
    expect(percentChange(850_000, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(-100, 0)).toBeNull();
  });
});
