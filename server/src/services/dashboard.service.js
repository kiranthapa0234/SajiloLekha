/**
 * Dashboard service.
 *
 * EVERY figure comes from a MongoDB aggregation over real records. There is no
 * seeded, cached or hardcoded "live" number anywhere in this file.
 *
 * Accounting definitions are documented in `shared/accounting.js`; the short
 * version used here:
 *   netSalesMinor  = invoice revenue excluding tax, net of discounts/refunds
 *   cogsMinor      = sum(cost-at-sale-time x qty)
 *   grossProfit    = netSales - cogs
 *   expensesMinor  = operating expenses only (purchases are inventory assets)
 *   netProfitMinor = grossProfit - expenses
 *   outstanding    = sum(invoiceTotal - paid - writtenOff)
 */
import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import { percentChange } from '../../../shared/accounting.js';
import { createMoneyContext } from './money.context.js';

/** Resolve a preset into concrete [from, to) bounds. */
export function resolveRange({ from, to, preset }, now = new Date()) {
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (from || to) {
    return { from: from ?? null, to: to ?? null, preset: preset ?? 'custom', label: 'Custom range' };
  }

  const p = preset ?? 'today';
  switch (p) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), preset: 'today', label: 'Today' };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y), preset: 'yesterday', label: 'Yesterday' };
    }
    case 'week': {
      const s = startOfDay(now);
      s.setDate(s.getDate() - 6);
      return { from: s, to: endOfDay(now), preset: 'week', label: 'Last 7 days' };
    }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: s, to: endOfDay(now), preset: 'month', label: 'This month' };
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      const s = new Date(now.getFullYear(), q, 1);
      return { from: s, to: endOfDay(now), preset: 'quarter', label: 'This quarter' };
    }
    case 'year': {
      const s = new Date(now.getFullYear(), 0, 1);
      return { from: s, to: endOfDay(now), preset: 'year', label: 'This year' };
    }
    case 'all':
    default:
      return { from: null, to: null, preset: 'all', label: 'All time' };
  }
}

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Match fragment for a date range. */
function dateMatch(field, { from, to }) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
}

/**
 * Profit & loss for an arbitrary window. Shared by the dashboard KPI cards and
 * the full report so the two can never disagree.
 */
export async function profitAndLoss(businessId, range) {
  const salesMatch = { business: oid(businessId), status: 'completed', ...dateMatch('soldAt', range) };
  const expenseMatch = { business: oid(businessId), status: 'recorded', deletedAt: null, archivedAt: null, ...dateMatch('spentAt', range) };

  const [salesAgg, expenseAgg] = await Promise.all([
    Sale.aggregate([
      { $match: salesMatch },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          grossMinor: { $sum: '$grossMinor' },
          discountMinor: { $sum: '$totalDiscountMinor' },
          netSalesMinor: { $sum: '$netSalesMinor' },
          taxMinor: { $sum: '$taxMinor' },
          totalMinor: { $sum: '$totalMinor' },
          cogsMinor: { $sum: '$cogsMinor' },
          refundsMinor: { $sum: '$refundedMinor' },
          itemsSold: { $sum: { $sum: '$lines.quantity' } },
        },
      },
    ]),
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]),
  ]);

  const s = salesAgg[0] ?? {
    count: 0,
    grossMinor: 0,
    discountMinor: 0,
    netSalesMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    cogsMinor: 0,
    refundsMinor: 0,
    itemsSold: 0,
  };
  const e = expenseAgg[0] ?? { totalMinor: 0, count: 0 };

  const revenueMinor = s.netSalesMinor - s.refundsMinor;
  const grossProfitMinor = revenueMinor - s.cogsMinor;
  const netProfitMinor = grossProfitMinor - e.totalMinor;

  return {
    orders: s.count,
    itemsSold: s.itemsSold,
    grossMinor: s.grossMinor,
    discountMinor: s.discountMinor,
    netSalesMinor: s.netSalesMinor,
    taxMinor: s.taxMinor,
    totalBilledMinor: s.totalMinor,
    refundsMinor: s.refundsMinor,
    revenueMinor,
    cogsMinor: s.cogsMinor,
    grossProfitMinor,
    expensesMinor: e.totalMinor,
    expenseCount: e.count,
    netProfitMinor,
    grossMarginPercent: revenueMinor ? Math.round((grossProfitMinor / revenueMinor) * 10000) / 100 : 0,
    netMarginPercent: revenueMinor ? Math.round((netProfitMinor / revenueMinor) * 10000) / 100 : 0,
  };
}

/**
 * The full dashboard payload: KPI cards + charts + tables.
 */
export async function getDashboardSummary(ctx, query) {
  const { business, businessId } = ctx;
  const money = createMoneyContext(business);
  const now = new Date();

  const range = resolveRange(query, now);
  const compare = query.compare !== false;

  // Previous window of identical length, for the "vs previous" deltas.
  const previousRange = (() => {
    if (!range.from || !range.to) return null;
    const span = range.to.getTime() - range.from.getTime();
    return { from: new Date(range.from.getTime() - span - 1), to: new Date(range.from.getTime() - 1), preset: 'previous' };
  })?.() ?? null;

  // "Today's sales" is always today, regardless of the selected window -—
  // it is a distinct KPI in the product spec.
  const todayRange = resolveRange({ preset: 'today' }, now);

  const [
    todayPl,
    windowPl,
    previousPl,
    todayCount,
    outstanding,
    lowStockCount,
    outOfStockCount,
    paymentMethods,
    salesChart,
    profitChart,
    latestTransactions,
    bestSellers,
    newCustomers,
    stockAlerts,
  ] = await Promise.all([
    profitAndLoss(businessId, todayRange),
    profitAndLoss(businessId, range),
    previousRange ? profitAndLoss(businessId, previousRange) : Promise.resolve(null),
    Sale.countDocuments({ business: oid(businessId), status: 'completed', ...dateMatch('soldAt', todayRange) }),
    outstandingBalance(businessId),
    // A field-to-field comparison (`$lte: '$minStockLevel'`) is only valid
    // inside `$expr`, never in a plain query filter.
    Product.countDocuments({
      business: oid(businessId),
      deletedAt: null,
      archivedAt: null,
      isActive: true,
      isTrackable: true,
      $expr: { $and: [{ $gt: ['$stockQuantity', 0] }, { $lte: ['$stockQuantity', '$minStockLevel'] }] },
    }),
    Product.countDocuments({
      business: oid(businessId),
      deletedAt: null,
      archivedAt: null,
      isActive: true,
      isTrackable: true,
      stockQuantity: { $lte: 0 },
    }),
    paymentMethodBreakdown(businessId, range),
    salesTrend(businessId, range, 'day'),
    salesTrend(businessId, range, 'day'),
    recentTransactions(businessId, 8),
    topSellingProducts(businessId, range, query.limit ?? 5),
    recentCustomers(businessId, 5),
    lowStockItems(businessId, 6),
  ]);

  const delta = (current, prior) => (prior === null || prior === undefined ? null : percentChange(current, prior));

  return {
    currency: {
      code: money.currency,
      symbol: money.symbol,
      decimals: money.decimals,
      locale: money.locale,
    },
    range: { ...range, from: range.from, to: range.to },
    previousRange,
    generatedAt: now,

    kpis: {
      todaySales: {
        // Revenue booked today (excluding tax), with the gross billed total too.
        valueMinor: todayPl.netSalesMinor,
        billedMinor: todayPl.totalBilledMinor,
        orders: todayCount,
        profitMinor: todayPl.netProfitMinor,
        changePercent: compare ? delta(todayPl.netSalesMinor, previousPl?.netSalesMinor) : null,
        formula: 'netSales (excl. tax) − refunds for sales dated today',
      },
      totalOrders: {
        value: windowPl.orders,
        todayValue: todayCount,
        itemsSold: windowPl.itemsSold,
        changePercent: compare ? delta(windowPl.orders, previousPl?.orders) : null,
        formula: 'Count of completed, non-cancelled sales in the selected range',
      },
      netProfit: {
        valueMinor: windowPl.netProfitMinor,
        revenueMinor: windowPl.revenueMinor,
        grossProfitMinor: windowPl.grossProfitMinor,
        expensesMinor: windowPl.expensesMinor,
        cogsMinor: windowPl.cogsMinor,
        marginPercent: windowPl.netMarginPercent,
        changePercent: compare ? delta(windowPl.netProfitMinor, previousPl?.netProfitMinor) : null,
        formula: '(netSales − refunds − COGS) − operating expenses',
      },
      outstanding: {
        valueMinor: outstanding.totalMinor,
        invoiceCount: outstanding.invoiceCount,
        overdueMinor: outstanding.overdueMinor,
        overdueCount: outstanding.overdueCount,
        changePercent: null,
        formula: 'Σ max(invoiceTotal − paid − writtenOff, 0) across unsettled invoices',
      },
      totalExpenses: {
        valueMinor: windowPl.expensesMinor,
        count: windowPl.expenseCount,
        changePercent: compare ? delta(windowPl.expensesMinor, previousPl?.expensesMinor) : null,
        formula: 'Σ recorded, non-inventory expenses in the selected range',
      },
      lowStock: {
        value: lowStockCount + outOfStockCount,
        lowStockCount,
        outOfStockCount,
        changePercent: null,
        formula: 'Active, stock-tracked products at or below their minimum level',
      },
    },

    charts: {
      // Sales vs profit -— the reference dashboard's main visual.
      salesOverview: salesChart,
      paymentMethods: {
        totalMinor: paymentMethods.reduce((s, p) => s + p.totalMinor, 0),
        items: paymentMethods,
      },
      cashFlow: profitChart,
    },

    tables: {
      recentTransactions: latestTransactions,
      topProducts: bestSellers,
      recentCustomers: newCustomers,
      lowStockItems: stockAlerts,
    },

    profitAndLoss: windowPl,
  };
}

/** Total customer money owed, computed in one aggregation (no N+1). */
export async function outstandingBalance(businessId) {
  const rows = await Invoice.aggregate([
    {
      $match: {
        business: oid(businessId),
        deletedAt: null,
        status: { $in: ['unpaid', 'partial', 'overdue'] },
      },
    },
    {
      $project: {
        outstandingMinor: {
          $max: [0, { $subtract: [{ $subtract: ['$totalMinor', '$paidMinor'] }, { $ifNull: ['$writtenOffMinor', 0] }] }],
        },
        overdueMinor: {
          $cond: [
            { $and: [{ $ne: [{ $ifNull: ['$dueDate', null] }, null] }, { $lt: ['$dueDate', '$$NOW'] }] },
            { $max: [0, { $subtract: [{ $subtract: ['$totalMinor', '$paidMinor'] }, { $ifNull: ['$writtenOffMinor', 0] }] }] },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalMinor: { $sum: '$outstandingMinor' },
        overdueMinor: { $sum: '$overdueMinor' },
        invoiceCount: { $sum: 1 },
        overdueCount: { $sum: { $cond: [{ $gt: ['$overdueMinor', 0] }, 1, 0] } },
      },
    },
  ]);

  return rows[0] ?? { totalMinor: 0, overdueMinor: 0, invoiceCount: 0, overdueCount: 0 };
}

/** Payment methods for the doughnut chart, restricted to settled inbound cash. */
export async function paymentMethodBreakdown(businessId, range) {
  return Payment.aggregate([
    {
      $match: {
        business: oid(businessId),
        status: 'valid',
        direction: 'inbound',
        ...dateMatch('paidAt', range),
      },
    },
    { $group: { _id: '$method', totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    { $sort: { totalMinor: -1 } },
    { $project: { _id: 0, method: '$_id', totalMinor: 1, count: 1 } },
  ]);
}

/** Sales vs profit time series, gap-filled so charts have no holes. */
export async function salesTrend(businessId, range, granularity = 'day') {
  const now = new Date();

  // Without an explicit window, default the chart to the last 30 days.
  const effectiveRange =
    range.from && range.to
      ? range
      : (() => {
          const from = new Date(now);
          from.setDate(from.getDate() - 29);
          from.setHours(0, 0, 0, 0);
          const to = new Date(now);
          to.setHours(23, 59, 59, 999);
          return { from, to };
        })();

  const match = { business: oid(businessId), status: 'completed', ...dateMatch('soldAt', effectiveRange) };

  const buckets = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$soldAt', timezone: 'UTC' } },
        revenueMinor: { $sum: '$netSalesMinor' },
        totalMinor: { $sum: '$totalMinor' },
        profitMinor: { $sum: '$grossProfitMinor' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const expenseBuckets = await Expense.aggregate([
    {
      $match: {
        business: oid(businessId),
        status: 'recorded',
        deletedAt: null,
        archivedAt: null,
        ...dateMatch('spentAt', effectiveRange),
      },
    },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$spentAt', timezone: 'UTC' } }, expensesMinor: { $sum: '$amountMinor' } } },
    { $sort: { _id: 1 } },
  ]);

  const saleMap = new Map(buckets.map((b) => [b._id, b]));
  const expenseMap = new Map(expenseBuckets.map((b) => [b._id, b.expensesMinor]));

  // Gap-fill every day in the window so the chart line is continuous.
  const series = [];
  const cursor = new Date(effectiveRange.from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(effectiveRange.to);
  end.setUTCHours(0, 0, 0, 0);

  let guard = 0;
  while (cursor <= end && guard < 400) {
    const key = cursor.toISOString().slice(0, 10);
    const s = saleMap.get(key);
    const expenses = expenseMap.get(key) ?? 0;
    const revenueMinor = s?.revenueMinor ?? 0;
    const grossProfitMinor = s?.profitMinor ?? 0;
    series.push({
      date: key,
      label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      revenueMinor,
      profitMinor: grossProfitMinor,
      netProfitMinor: grossProfitMinor - expenses,
      expensesMinor: expenses,
      totalMinor: s?.totalMinor ?? 0,
      orders: s?.orders ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }

  return {
    granularity,
    from: effectiveRange.from,
    to: effectiveRange.to,
    series,
    totals: {
      revenueMinor: series.reduce((acc, p) => acc + p.revenueMinor, 0),
      profitMinor: series.reduce((acc, p) => acc + p.profitMinor, 0),
      netProfitMinor: series.reduce((acc, p) => acc + p.netProfitMinor, 0),
      expensesMinor: series.reduce((acc, p) => acc + p.expensesMinor, 0),
    },
  };
}

/** Latest invoices, denormalised enough that no extra joins are needed. */
export async function recentTransactions(businessId, limit = 8) {
  return Invoice.find({ business: oid(businessId), deletedAt: null })
    .sort({ issuedAt: -1, _id: -1 })
    .limit(limit)
    .select('invoiceNumber customerName totalMinor paidMinor refundedMinor writtenOffMinor status issuedAt dueDate currency')
    .lean()
    .then((rows) =>
      rows.map((r) => ({
        id: r._id,
        invoiceNumber: r.invoiceNumber,
        customerName: r.customerName,
        totalMinor: r.totalMinor,
        paidMinor: r.paidMinor,
        refundedMinor: r.refundedMinor,
        outstandingMinor: Math.max(0, r.totalMinor - r.paidMinor - (r.writtenOffMinor ?? 0)),
        status: r.status,
        issuedAt: r.issuedAt,
        dueDate: r.dueDate,
        currency: r.currency,
      }))
    );
}

/**
 * Best sellers over the window, unwinding the sale line array.
 *
 * Ranked by how many units moved, not by revenue: a shop wants to see what it
 * sells most often, and revenue sorting puts a single high-value sale (an
 * iPhone) above a staple bought hundreds of times (a kilo of sugar), which
 * reads as the opposite of "top product". Revenue is the tiebreaker so equal
 * quantities still order by value and the result is deterministic.
 */
export async function topSellingProducts(businessId, range, limit = 5) {
  return Sale.aggregate([
    { $match: { business: oid(businessId), status: 'completed', ...dateMatch('soldAt', range) } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.product',
        name: { $last: '$lines.name' },
        sku: { $last: '$lines.sku' },
        unitsSold: { $sum: '$lines.quantity' },
        revenueMinor: { $sum: '$lines.netMinor' },
        profitMinor: { $sum: '$lines.lineProfitMinor' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { unitsSold: -1, revenueMinor: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        product: '$_id',
        name: 1,
        sku: 1,
        unitsSold: 1,
        revenueMinor: 1,
        profitMinor: 1,
        orderCount: 1,
        marginPercent: {
          $cond: [
            { $gt: ['$revenueMinor', 0] },
            { $round: [{ $multiply: [{ $divide: ['$profitMinor', '$revenueMinor'] }, 100] }, 2] },
            0,
          ],
        },
      },
    },
  ]);
}

export async function recentCustomers(businessId, limit = 5) {
  return Customer.find({ business: oid(businessId), deletedAt: null, isActive: true })
    .sort({ lastTransactionAt: -1, createdAt: -1 })
    .limit(limit)
    .select('name customerCode phone isWalkIn totalSalesMinor totalPaidMinor totalRefundedMinor invoiceCount lastTransactionAt openingBalanceMinor openingBalanceType')
    .lean({ virtuals: true })
    .then((rows) =>
      rows.map((c) => ({
        id: c._id,
        name: c.name,
        code: c.customerCode,
        phone: c.phone,
        isWalkIn: c.isWalkIn,
        totalSalesMinor: c.totalSalesMinor,
        outstandingMinor: c.outstandingMinor,
        invoiceCount: c.invoiceCount,
        lastTransactionAt: c.lastTransactionAt,
      }))
    );
}

export async function lowStockItems(businessId, limit = 6) {
  return Product.find({
    business: oid(businessId),
    deletedAt: null,
    archivedAt: null,
    isActive: true,
    isTrackable: true,
    $expr: { $lte: ['$stockQuantity', '$minStockLevel'] },
  })
    .sort({ stockQuantity: 1, name: 1 })
    .limit(limit)
    .populate('category', 'name color')
    .select('name sku stockQuantity minStockLevel unit imageUrl sellingPriceMinor costPriceMinor averageCostMinor')
    .lean({ virtuals: true })
    .then((rows) =>
      rows.map((p) => ({
        id: p._id,
        name: p.name,
        sku: p.sku,
        stockQuantity: p.stockQuantity,
        minStockLevel: p.minStockLevel,
        unit: p.unit,
        imageUrl: p.imageUrl,
        category: p.category?.name ?? null,
        status: p.stockStatus,
        shortfall: Math.max(0, p.minStockLevel - p.stockQuantity),
        restockValueMinor: Math.round(Math.max(0, p.minStockLevel - p.stockQuantity) * (p.averageCostMinor ?? p.costPriceMinor ?? 0)),
      }))
    );
}

/** Compact KPI strip used by the mobile dashboard. */
export async function quickStats(businessId) {
  const today = resolveRange({ preset: 'today' });
  const [pl, outstanding] = await Promise.all([profitAndLoss(businessId, today), outstandingBalance(businessId)]);
  return {
    todaySalesMinor: pl.netSalesMinor,
    todayProfitMinor: pl.netProfitMinor,
    todayOrders: pl.orders,
    outstandingMinor: outstanding.totalMinor,
  };
}

export { oid, dateMatch, profitAndLoss as computeProfitAndLoss };

/** Referenced by reports to reuse the same product/customer helpers. */
export const helpers = { outstandingBalance, salesTrend, topSellingProducts, lowStockItems, recentCustomers, recentTransactions, resolveRange, dateMatch, oid };

/** Exposed for the suppliers module's dashboard cards. */
export async function supplierPayables(businessId) {
  const rows = await Supplier.aggregate([
    { $match: { business: oid(businessId), deletedAt: null, isActive: true } },
    {
      $project: {
        name: 1,
        totalPurchasedMinor: 1,
        totalPaidMinor: 1,
        outstandingMinor: {
          $max: [
            0,
            {
              $add: [
                { $subtract: ['$totalPurchasedMinor', '$totalPaidMinor'] },
                {
                  $multiply: [
                    '$openingBalanceMinor',
                    { $cond: [{ $eq: ['$openingBalanceType', 'credit'] }, 1, -1] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    { $sort: { outstandingMinor: -1 } },
  ]);
  return rows;
}
