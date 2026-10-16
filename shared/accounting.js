/**
 * Accounting definitions — the single source of truth for every money figure
 * the product reports. Both the dashboard aggregations and the report services
 * build on these functions so a number can never mean two different things.
 *
 * ---------------------------------------------------------------------------
 * DEFINITIONS (accrual basis, integer minor units)
 * ---------------------------------------------------------------------------
 * NET SALES (revenue)
 *   sum(invoice.netSales) for non-cancelled invoices in period
 *   = sum(lineGross - lineDiscount)  [tax is EXCLUDED: tax collected is a
 *   liability owed to the tax authority, not income]
 *
 * TAX COLLECTED
 *   sum(invoice.taxTotal)  — liability, reported separately.
 *
 * INVOICE TOTAL (amount billed)
 *   netSales + taxTotal  (minus nothing else; refunds reduce revenue instead)
 *
 * CASH COLLECTED
 *   sum(payment.amount) for valid, non-voided payments in period.
 *   This is a CASH metric. It is NEVER used to derive profit, because sales can
 *   be unpaid and expenses can be paid on credit.
 *
 * REFUNDS
 *   sum(refund.amount) for non-voided refunds in period, treated as a
 *   contra-revenue. COGS is credited with the original cost of returned units.
 *
 * COST OF GOODS SOLD (COGS)
 *   sum(saleLine.costSnapshot * qty) for lines in non-cancelled invoices.
 *   Cost is snapshotted at sale time so later cost changes never rewrite
 *   historical profit.
 *
 * GROSS PROFIT
 *   netSales(after refunds) - COGS
 *
 * OPERATING EXPENSES
 *   sum(expense.amount) for non-cancelled, non-inventory expense categories in
 *   period. Inventory purchases are NOT expenses (see below).
 *
 * NET PROFIT
 *   grossProfit - operatingExpenses
 *
 * ---------------------------------------------------------------------------
 * WHY PURCHASES ARE NOT AN EXPENSE
 * ---------------------------------------------------------------------------
 * A purchase is a movement of an ASSET (inventory). Its cost reaches the P&L
 * only when the stock is sold, at which point it is recognised as COGS. Charging
 * purchases to expenses on the day they are paid would understate profit and
 * would make profit swing purely on supplier payment timing. Business setting
 * `accounting.purchaseAsExpense` exists only for the naive/legacy mode and is
 * OFF by default; reports label the figure clearly when it is used.
 */

import { applyPercent, multiplyMinor, sumMinor } from './money.js';

export const ACCOUNTING_BASIS = {
  ACCRUAL: 'accrual',
  CASH: 'cash',
};

export const REPORT_DEFINITIONS = {
  netSales: 'Invoice revenue excluding tax, after discounts and less refunds.',
  taxCollected: 'Sum of tax charged on invoices. A liability, not income.',
  invoiceTotal: 'netSales + taxCollected — the amount billed to customers.',
  cashCollected: 'Sum of valid payments received in the period. Cash metric only.',
  refunds: 'Contra-revenue: amounts returned to customers in the period.',
  cogs: 'Cost of goods sold = sum of cost-at-sale-time x quantity sold.',
  grossProfit: 'netSales - refunds - cogs.',
  operatingExpenses: 'Non-inventory operating expenses (rent, salary, utilities, ...).',
  netProfit: 'grossProfit - operatingExpenses.',
  stockValue: 'Closing inventory at current weighted cost: sum(stockQty * cost).',
  receivables: 'Outstanding customer balance = sum(max(invoiceTotal - paid, 0)).',
};

export const EXPENSE_GROUPS = {
  OPERATING: 'operating',
  COGS_LINKED: 'cogs_linked',
};

/** A fixed, ordered list so report totals always reconcile. */
export const PROFIT_LOSS_LINE_ORDER = [
  'netSales',
  'refunds',
  'cogs',
  'grossProfit',
  'operatingExpenses',
  'netProfit',
];

/**
 * Derive a single sale line's totals. All integer arithmetic.
 *
 * @param {object} input
 * @param {number} input.unitPriceMinor  price after product-level price
 * @param {number} input.quantity
 * @param {number} [input.discountMinor] absolute line discount
 * @param {number} [input.discountPercent]
 * @param {number} [input.taxPercent]
 * @param {boolean} [input.taxInclusive]
 * @param {number} [input.costMinor] unit cost snapshot
 */
export function computeLine(input) {
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`Invalid line quantity: ${input.quantity}`);
  }
  const unitPriceMinor = Math.trunc(input.unitPriceMinor ?? 0);
  const grossMinor = multiplyMinor(unitPriceMinor, qty);

  const discountPercent = Number(input.discountPercent ?? 0);
  const discountMinor =
    input.discountMinor !== undefined && input.discountMinor !== null
      ? Math.trunc(input.discountMinor)
      : discountPercent
        ? applyPercent(grossMinor, discountPercent)
        : 0;

  const boundedDiscount = Math.max(0, Math.min(discountMinor, grossMinor));
  const afterDiscount = grossMinor - boundedDiscount;

  // Tax-exclusive base. When prices include tax we back the tax out of the
  // discounted amount so revenue stays exclusive of tax.
  const taxPercent = Number(input.taxPercent ?? 0);
  let netMinor = afterDiscount;
  let taxMinor = 0;
  if (taxPercent > 0) {
    if (input.taxInclusive) {
      netMinor = Math.trunc(afterDiscount / (1 + taxPercent / 100));
      taxMinor = afterDiscount - netMinor;
    } else {
      taxMinor = applyPercent(afterDiscount, taxPercent);
    }
  }

  const costMinor = Math.trunc(input.costMinor ?? 0);

  // The customer always pays net + tax, whether the listed price was
  // tax-inclusive or tax-exclusive. Deriving it from `netMinor` rather than
  // `afterDiscount` is what stops tax being added twice on inclusive pricing.
  const totalMinor = netMinor + taxMinor;

  return {
    quantity: qty,
    unitPriceMinor,
    grossMinor,
    discountMinor: boundedDiscount,
    discountPercent: discountPercent || 0,
    taxPercent,
    netMinor,
    taxMinor,
    totalMinor,
    costMinor,
    lineCogsMinor: multiplyMinor(costMinor, qty),
  };
}

/** Sum line results into an invoice. Also applies an invoice-level discount. */
export function computeInvoiceTotals(lines, options = {}) {
  const grossMinor = sumMinor(lines.map((l) => l.grossMinor));
  const lineDiscountMinor = sumMinor(lines.map((l) => l.discountMinor));
  const afterLineDiscount = grossMinor - lineDiscountMinor;

  const invoiceDiscountMinor = Math.max(
    0,
    Math.min(Math.trunc(options.invoiceDiscountMinor ?? 0), afterLineDiscount)
  );
  const netSalesMinor = afterLineDiscount - invoiceDiscountMinor;

  const taxMinor = sumMinor(lines.map((l) => l.taxMinor));
  const cogsMinor = sumMinor(lines.map((l) => l.lineCogsMinor));

  // Invoice-level discount is proportional across lines so tax and COGS stay
  // consistent with the discounted revenue.
  const scaleRatio =
    afterLineDiscount === 0 ? 0 : netSalesMinor / afterLineDiscount;
  const adjustedCogs = Math.round(cogsMinor * scaleRatio);
  const adjustedTax = taxMinor === 0 ? 0 : Math.round(taxMinor * scaleRatio);

  return {
    grossMinor,
    lineDiscountMinor,
    invoiceDiscountMinor,
    totalDiscountMinor: lineDiscountMinor + invoiceDiscountMinor,
    netSalesMinor,
    taxMinor: adjustedTax,
    totalMinor: netSalesMinor + adjustedTax,
    cogsMinor: adjustedCogs,
    profitMinor: netSalesMinor - adjustedCogs,
  };
}

/** Net profit for a set of invoice rows + expense rows (all minor units). */
export function deriveProfit({ invoiceTotals = [], expenseTotals = [] }) {
  const netSalesMinor = sumMinor(invoiceTotals.map((i) => i.netSalesMinor ?? 0));
  const refundsMinor = sumMinor(invoiceTotals.map((i) => i.refundMinor ?? 0));
  const cogsMinor = sumMinor(invoiceTotals.map((i) => i.cogsMinor ?? 0));
  const operatingExpensesMinor = sumMinor(expenseTotals);

  const revenueMinor = netSalesMinor - refundsMinor;
  const grossProfitMinor = revenueMinor - cogsMinor;
  const netProfitMinor = grossProfitMinor - operatingExpensesMinor;

  return {
    netSalesMinor,
    refundsMinor,
    revenueMinor,
    cogsMinor,
    grossProfitMinor,
    operatingExpensesMinor,
    netProfitMinor,
    grossMarginPercent:
      revenueMinor === 0 ? 0 : Math.round((grossProfitMinor / revenueMinor) * 10000) / 100,
    netMarginPercent:
      revenueMinor === 0 ? 0 : Math.round((netProfitMinor / revenueMinor) * 10000) / 100,
  };
}

/**
 * Single source of truth for invoice status. Derived from money, never set by
 * a client. `dueDate` drives the overdue transition.
 *
 * @param {{ totalMinor:number, paidMinor:number, status?:string, dueDate?:Date|null, now?:Date }} args
 */
export function deriveInvoiceStatus({
  totalMinor,
  paidMinor,
  status,
  dueDate,
  now = new Date(),
}) {
  const total = Math.max(0, Math.trunc(totalMinor ?? 0));
  const paid = Math.max(0, Math.trunc(paidMinor ?? 0));

  if (status === 'cancelled') return 'cancelled';
  if (paid >= total && total > 0) return 'paid';
  if (total === 0) return 'paid';
  if (paid > 0) {
    return isPastDue(dueDate, now) ? 'overdue' : 'partial';
  }
  return isPastDue(dueDate, now) ? 'overdue' : 'unpaid';
}

export function isPastDue(dueDate, now = new Date()) {
  if (!dueDate) return false;
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now.getTime();
}

export function outstandingMinor(totalMinor, paidMinor) {
  return Math.max(0, Math.trunc(totalMinor ?? 0) - Math.trunc(paidMinor ?? 0));
}

/**
 * Percentage change between two periods.
 *
 * Growth from a zero baseline is undefined, not 100%: a shop that did Rs. 8,500
 * this month against nothing last month has not "doubled", and rendering
 * "+100%" is a false statement. `null` means "no meaningful comparison", which
 * the UI renders as no trend badge at all.
 */
export function percentChange(current, previous) {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  if (p === 0) return c === 0 ? 0 : null;
  return Math.round(((c - p) / Math.abs(p)) * 10000) / 100;
}
