/**
 * Reports service.
 *
 * All ten reports are computed with MongoDB aggregations against real records.
 * Money is integer minor units throughout; a CSV/PDF export is produced from the
 * exact same dataset the JSON response returns, so an export can never disagree
 * with what the user saw on screen.
 */
import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import Payment from '../models/Payment.js';
import { APP_NAME } from '../utils/helpers.js';
import {
  ACCOUNTING_BASIS,
  PROFIT_LOSS_LINE_ORDER,
  REPORT_DEFINITIONS,
  deriveProfit,
  outstandingMinor,
} from '../../../shared/accounting.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHOD_LABELS, STOCK_MOVEMENT_LABELS } from '../../../shared/constants.js';
import { createMoneyContext } from './money.context.js';
import { resolveRange } from './dashboard.service.js';
import { inventoryValuation } from './stock.service.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const money = (ctx) => createMoneyContext(ctx.business);

function matchRange(field, range) {
  if (!range.from && !range.to) return {};
  return { [field]: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } };
}

const withDecimals = (rows) => rows.map((row) => ({ ...row }));

/* ------------------------------------------------------------ 1. SALES -- */

export async function salesReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);

  const rows = await Sale.aggregate([
    { $match: { business: oid(ctx.businessId), status: 'completed', ...matchRange('soldAt', range) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$soldAt', timezone: 'UTC' } },
        orders: { $sum: 1 },
        items: { $sum: { $sum: '$lines.quantity' } },
        grossMinor: { $sum: '$grossMinor' },
        discountMinor: { $sum: '$totalDiscountMinor' },
        netSalesMinor: { $sum: '$netSalesMinor' },
        taxMinor: { $sum: '$taxMinor' },
        totalMinor: { $sum: '$totalMinor' },
        cogsMinor: { $sum: '$cogsMinor' },
        grossProfitMinor: { $sum: '$grossProfitMinor' },
        refundedMinor: { $sum: '$refundedMinor' },
        paidMinor: { $sum: '$paidMinor' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totals = rows.reduce(
    (acc, r) => {
      for (const [k, v] of Object.entries(r)) if (k !== '_id') acc[k] = (acc[k] ?? 0) + v;
      return acc;
    },
    { orders: 0, items: 0, grossMinor: 0, discountMinor: 0, netSalesMinor: 0, taxMinor: 0, totalMinor: 0, cogsMinor: 0, grossProfitMinor: 0, refundedMinor: 0, paidMinor: 0 }
  );

  return {
    title: 'Sales report',
    basis: ACCOUNTING_BASIS.ACCRUAL,
    definitions: REPORT_DEFINITIONS,
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    rows: withDecimals(rows.map((r) => ({ date: r._id, ...r })), ctx),
    totals: {
      ...totals,
      averageOrderMinor: totals.orders ? Math.round(totals.totalMinor / totals.orders) : 0,
      uncollectedMinor: Math.max(0, totals.totalMinor - totals.paidMinor),
    },
  };
}

/* -------------------------------------------------- 2. PROFIT AND LOSS -- */

export async function profitLossReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);
  const settings = ctx.business.settings ?? {};

  const salesMatch = { business: oid(ctx.businessId), status: 'completed', ...matchRange('soldAt', range) };
  const expenseMatch = { business: oid(ctx.businessId), status: 'recorded', deletedAt: null, archivedAt: null, ...matchRange('spentAt', range) };

  const [salesAgg, expenseByCategory, taxAgg, cashAgg] = await Promise.all([
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
          profitMinor: { $sum: '$grossProfitMinor' },
        },
      },
    ]),
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: '$category', totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      { $sort: { totalMinor: -1 } },
    ]),
    Sale.aggregate([
      { $match: salesMatch },
      { $group: { _id: null, taxMinor: { $sum: '$taxMinor' } } },
    ]),
    Payment.aggregate([
      { $match: { business: oid(ctx.businessId), status: 'valid', direction: 'inbound', ...matchRange('paidAt', range) } },
      { $group: { _id: null, collectedMinor: { $sum: '$amountMinor' } } },
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
    profitMinor: 0,
  };

  const operatingExpensesMinor = expenseByCategory.reduce((sum, r) => sum + r.totalMinor, 0);
  const pnl = deriveProfit({
    invoiceTotals: [
      { netSalesMinor: s.netSalesMinor, cogsMinor: s.cogsMinor, refundMinor: s.refundsMinor },
    ],
    expenseTotals: [operatingExpensesMinor],
  });

  const inventoryValue = await inventoryValuation(ctx.businessId);
  const stockValueMinor = inventoryValue[0]?.costValueMinor ?? 0;
  const cashCollectedMinor = cashAgg[0]?.collectedMinor ?? 0;

  const lines = [
    {
      key: 'netSales',
      label: 'Net sales (revenue)',
      amountMinor: s.netSalesMinor,
      kind: 'income',
      definition: REPORT_DEFINITIONS.netSales,
    },
    {
      key: 'refunds',
      label: 'Less refunds & returns',
      amountMinor: -s.refundsMinor,
      kind: 'deduction',
      definition: REPORT_DEFINITIONS.refunds,
    },
    {
      key: 'cogs',
      label: 'Less cost of goods sold',
      amountMinor: -s.cogsMinor,
      kind: 'deduction',
      definition: REPORT_DEFINITIONS.cogs,
    },
    {
      key: 'grossProfit',
      label: 'Gross profit',
      amountMinor: pnl.grossProfitMinor,
      kind: 'subtotal',
      emphasis: true,
      definition: REPORT_DEFINITIONS.grossProfit,
    },
    {
      key: 'operatingExpenses',
      label: 'Less operating expenses',
      amountMinor: -operatingExpensesMinor,
      kind: 'deduction',
      definition: REPORT_DEFINITIONS.operatingExpenses,
    },
    {
      key: 'netProfit',
      label: 'Net profit',
      amountMinor: pnl.netProfitMinor,
      kind: 'total',
      emphasis: true,
      definition: REPORT_DEFINITIONS.netProfit,
    },
  ];

  return {
    title: 'Profit & loss',
    basis: settings.accounting?.basis ?? ACCOUNTING_BASIS.ACCRUAL,
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    lines,
    order: PROFIT_LOSS_LINE_ORDER,
    expenses: expenseByCategory.map((r) => ({
      category: r._id,
      label: r._label ?? r._id,
      totalMinor: r.totalMinor,
      count: r.count,
      sharePercent: operatingExpensesMinor ? Math.round((r.totalMinor / operatingExpensesMinor) * 10000) / 100 : 0,
    })),
    metrics: {
      orders: s.count,
      grossMarginPercent: pnl.grossMarginPercent,
      netMarginPercent: pnl.netMarginPercent,
      cashCollectedMinor,
      taxCollectedMinor: taxAgg[0]?.taxMinor ?? 0,
      receivableMinor: Math.max(0, s.totalMinor - cashCollectedMinor),
      closingStockValueMinor: stockValueMinor,
    },
    notes: [
      'Revenue is recognised when the sale is recorded, not when cash is collected.',
      'Inventory purchases are capitalised into stock and expensed as COGS only when sold.',
      'Tax collected is a liability and is excluded from revenue and profit.',
    ],
  };
}

/* ---------------------------------------------------------- 3. EXPENSES -- */

export async function expenseReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);
  const match = {
    business: oid(ctx.businessId),
    status: 'recorded',
    deletedAt: null,
    archivedAt: null,
    ...matchRange('spentAt', range),
    ...(query.category ? { category: query.category } : {}),
  };

  const [byCategory, byMethod, daily, totals] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      { $sort: { totalMinor: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      { $sort: { totalMinor: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$spentAt', timezone: 'UTC' } },
          totalMinor: { $sum: '$amountMinor' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]),
  ]);

  const totalMinor = totals[0]?.totalMinor ?? 0;
  const dayCount = Math.max(1, Math.ceil(((range.to ?? new Date()) - (range.from ?? new Date(range.to ?? Date.now() - 30 * 86400000))) / 86400000) + 1);

  return {
    title: 'Expense report',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    totalMinor,
    count: totals[0]?.count ?? 0,
    averageMinor: totals[0]?.count ? Math.round(totalMinor / totals[0].count) : 0,
    dailyAverageMinor: Math.round(totalMinor / dayCount),
    monthlyProjectionMinor: Math.round((totalMinor / dayCount) * 30),
    byCategory: byCategory.map((r) => ({
      category: r._id,
      label: r._id,
      totalMinor: r.totalMinor,
      count: r.count,
      sharePercent: totalMinor ? Math.round((r.totalMinor / totalMinor) * 10000) / 100 : 0,
    })),
    byMethod: byMethod.map((r) => ({
      method: r._id,
      label: PAYMENT_METHOD_LABELS[r._id] ?? r._id,
      totalMinor: r.totalMinor,
      count: r.count,
      sharePercent: totalMinor ? Math.round((r.totalMinor / totalMinor) * 10000) / 100 : 0,
    })),
    daily: daily.map((r) => ({ date: r._id, totalMinor: r.totalMinor, count: r.count })),
    categories: EXPENSE_CATEGORIES,
  };
}

/* ------------------------------------------------- 4. INVENTORY VALUE --- */

export async function inventoryReport(ctx, query) {
  const m = money(ctx);
  const valuation = await inventoryValuation(ctx.businessId, { category: query.category });

  const byProduct = await Product.aggregate([
    {
      $match: {
        business: oid(ctx.businessId),
        deletedAt: null,
        archivedAt: null,
        ...(query.category ? { category: query.category } : {}),
      },
    },
    {
      $lookup: {
        from: 'productcategories',
        let: { cat: '$category' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$cat'] } } }, { $project: { name: 1, color: 1 } }],
        as: 'categoryInfo',
      },
    },
    {
      $addFields: {
        effectiveCostMinor: { $ifNull: ['$averageCostMinor', '$costPriceMinor'] },
      },
    },
    {
      $project: {
        name: 1,
        sku: 1,
        unit: 1,
        isActive: 1,
        stockQuantity: 1,
        minStockLevel: 1,
        effectiveCostMinor: 1,
        sellingPriceMinor: 1,
        categoryName: { $ifNull: [{ $first: '$categoryInfo.name' }, 'Uncategorised'] },
        stockValueMinor: { $multiply: [{ $ifNull: ['$stockQuantity', 0] }, { $ifNull: ['$effectiveCostMinor', 0] }] },
        retailValueMinor: { $multiply: [{ $ifNull: ['$stockQuantity', 0] }, { $ifNull: ['$sellingPriceMinor', 0] }] },
        status: {
          $cond: [
            { $lte: ['$stockQuantity', 0] },
            'out_of_stock',
            { $cond: [{ $lte: ['$stockQuantity', '$minStockLevel'] }, 'low_stock', 'in_stock'] },
          ],
        },
      },
    },
    { $sort: { stockValueMinor: -1, name: 1 } },
    { $limit: query.limit ?? 500 },
  ]);

  const summary = byProduct.reduce(
    (acc, p) => {
      acc.stockValueMinor += p.stockValueMinor ?? 0;
      acc.retailValueMinor += p.retailValueMinor ?? 0;
      acc.units += p.stockQuantity ?? 0;
      acc.products += 1;
      if (p.status === 'low_stock') acc.lowStock += 1;
      if (p.status === 'out_of_stock') acc.outOfStock += 1;
      return acc;
    },
    { stockValueMinor: 0, retailValueMinor: 0, units: 0, products: 0, lowStock: 0, outOfStock: 0 }
  );

  return {
    title: 'Inventory valuation',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    method: 'Weighted average cost. Value = on-hand quantity - average unit cost.',
    range: { from: null, to: null },
    summary: {
      ...summary,
      potentialProfitMinor: summary.retailValueMinor - summary.stockValueMinor,
      summaryOnly: valuation[0] ?? null,
    },
    rows: byProduct,
  };
}

/* ------------------------------------------------- 5. STOCK MOVEMENTS --- */

export async function stockMovementReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);
  const match = {
    business: oid(ctx.businessId),
    ...matchRange('occurredAt', range),
    ...(query.product ? { product: query.product } : {}),
    ...(query.category ? { product: query.category } : {}),
  };

  const [byType, movements, totals] = await Promise.all([
    StockMovement.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          units: { $sum: '$quantity' },
          valueInMinor: { $sum: { $cond: [{ $gt: ['$quantity', 0] }, '$valueMinor', 0] } },
          valueOutMinor: { $sum: { $cond: [{ $lt: ['$quantity', 0] }, { $multiply: ['$valueMinor', -1] }, 0] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    StockMovement.aggregate([
      { $match: match },
      { $sort: { occurredAt: -1 } },
      { $limit: query.limit ?? 500 },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productInfo',
          pipeline: [{ $project: { name: 1, sku: 1, unit: 1 } }],
        },
      },
      { $lookup: { from: 'users', localField: 'performedBy', foreignField: '_id', as: 'userInfo', pipeline: [{ $project: { name: 1 } }] } },
      {
        $project: {
          _id: 1,
          productName: { $ifNull: [{ $first: '$productInfo.name' }, 'Deleted product'] },
          sku: { $ifNull: [{ $first: '$productInfo.sku' }, ''] },
          unit: { $ifNull: [{ $first: '$productInfo.unit' }, ''] },
          performedBy: { $ifNull: [{ $first: '$userInfo.name' }, 'system' ] },
          quantity: 1,
          quantityBefore: 1,
          quantityAfter: 1,
          type: 1,
          typeLabel: 1,
          reason: 1,
          reference: 1,
          valueMinor: 1,
          occurredAt: 1,
          related: '$relatedDocument',
        },
      },
    ]),
    StockMovement.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          valueInMinor: { $sum: { $cond: [{ $gt: ['$quantity', 0] }, '$valueMinor', 0] } },
          valueOutMinor: { $sum: { $cond: [{ $lt: ['$quantity', 0] }, { $multiply: ['$valueMinor', -1] }, 0] } },
        },
      },
    ]),
  ]);

  return {
    title: 'Stock movement report',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    byType: byType.map((r) => ({
      type: r._id,
      label: STOCK_MOVEMENT_LABELS[r._id] ?? r._id,
      count: r.count,
      unitsIn: r.units > 0 ? r.units : 0,
      unitsOut: r.units < 0 ? Math.abs(r.units) : 0,
      valueInMinor: r.valueInMinor,
      valueOutMinor: r.valueOutMinor,
    })),
    totals: totals[0] ?? { count: 0, valueInMinor: 0, valueOutMinor: 0 },
    movements,
    movementTypes: STOCK_MOVEMENT_LABELS,
  };
}

/* ------------------------------------------------------- 6. LOW STOCK --- */

export async function lowStockReport(ctx, query) {
  const m = money(ctx);
  const rows = await Product.aggregate([
    {
      $match: {
        business: oid(ctx.businessId),
        deletedAt: null,
        archivedAt: null,
        isActive: true,
        isTrackable: true,
        $expr: { $lte: ['$stockQuantity', '$minStockLevel'] },
        ...(query.category ? { category: query.category } : {}),
      },
    },
    { $addFields: { effectiveCostMinor: { $ifNull: ['$averageCostMinor', '$costPriceMinor'] } } },
    {
      $project: {
        name: 1,
        sku: 1,
        unit: 1,
        stockQuantity: 1,
        minStockLevel: 1,
        effectiveCostMinor: 1,
        sellingPriceMinor: 1,
        supplier: 1,
        status: { $cond: [{ $lte: ['$stockQuantity', 0] }, 'out_of_stock', 'low_stock'] },
        shortfall: { $max: [0, { $subtract: ['$minStockLevel', '$stockQuantity'] }] },
      },
    },
    { $addFields: { restockCostMinor: { $multiply: ['$shortfall', { $ifNull: ['$effectiveCostMinor', 0] }] } } },
    { $sort: { stockQuantity: 1, name: 1 } },
    { $limit: query.limit ?? 500 },
  ]);

  const supplierIds = [...new Set(rows.map((r) => r.supplier).filter(Boolean))];
  const suppliers = supplierIds.length
    ? await Supplier.find({ _id: { $in: supplierIds }, business: oid(ctx.businessId) }).select('name phone').lean()
    : [];
  const supplierMap = new Map(suppliers.map((s) => [String(s._id), s]));

  const summary = rows.reduce(
    (acc, r) => {
      acc.total += 1;
      acc.restockCostMinor += r.restockCostMinor ?? 0;
      acc.shortfallUnits += r.shortfall ?? 0;
      if (r.status === 'out_of_stock') acc.outOfStock += 1;
      else acc.lowStock += 1;
      return acc;
    },
    { total: 0, lowStock: 0, outOfStock: 0, restockCostMinor: 0, shortfallUnits: 0 }
  );

  return {
    title: 'Low stock report',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range: { from: null, to: null },
    summary,
    rows: rows.map((r) => ({
      ...r,
      supplier: r.supplier ? supplierMap.get(String(r.supplier)) ?? null : null,
    })),
  };
}

/* ------------------------------------------------ 7. CUSTOMER ACTIVITY -- */

export async function customerReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);

  const rows = await Sale.aggregate([
    { $match: { business: oid(ctx.businessId), status: 'completed', ...matchRange('soldAt', range) } },
    {
      $group: {
        _id: '$customer',
        name: { $last: '$customerName' },
        orders: { $sum: 1 },
        billedMinor: { $sum: '$totalMinor' },
        netSalesMinor: { $sum: '$netSalesMinor' },
        profitMinor: { $sum: '$grossProfitMinor' },
        paidMinor: { $sum: '$paidMinor' },
        lastOrderAt: { $max: '$soldAt' },
        firstOrderAt: { $min: '$soldAt' },
      },
    },
    { $sort: { billedMinor: -1 } },
    { $limit: query.limit ?? 500 },
  ]);

  const ids = rows.map((r) => r._id).filter(Boolean);
  const customers = ids.length
    ? await Customer.find({ _id: { $in: ids }, business: oid(ctx.businessId) })
        .select('name customerCode phone email totalPaidMinor totalRefundedMinor openingBalanceMinor openingBalanceType')
        .lean({ virtuals: true })
    : [];
  const map = new Map(customers.map((c) => [String(c._id), c]));

  const enriched = rows.map((r) => {
    const c = r._id ? map.get(String(r._id)) : null;
    const opening = c ? (c.openingBalanceType === 'debit' ? 1 : -1) * (c.openingBalanceMinor ?? 0) : 0;
    const lifetimePaid = c?.totalPaidMinor ?? 0;
    return {
      customerId: r._id,
      name: r.name,
      code: c?.customerCode ?? '',
      phone: c?.phone ?? '',
      email: c?.email ?? '',
      orders: r.orders,
      billedMinor: r.billedMinor,
      netSalesMinor: r.netSalesMinor,
      profitMinor: r.profitMinor,
      paidInRangeMinor: r.paidMinor,
      lifetimePaidMinor: lifetimePaid,
      averageOrderMinor: r.orders ? Math.round(r.billedMinor / r.orders) : 0,
      outstandingMinor: Math.max(0, opening + (c?.totalSalesMinor ?? r.billedMinor) - lifetimePaid - (c?.totalRefundedMinor ?? 0)),
      firstOrderAt: r.firstOrderAt,
      lastOrderAt: r.lastOrderAt,
    };
  });

  return {
    title: 'Customer transaction report',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    rows: enriched,
    totals: {
      customers: enriched.length,
      billedMinor: enriched.reduce((s, r) => s + r.billedMinor, 0),
      profitMinor: enriched.reduce((s, r) => s + r.profitMinor, 0),
      outstandingMinor: enriched.reduce((s, r) => s + r.outstandingMinor, 0),
    },
  };
}

/* ------------------------------------------------ 8. PAYMENT COLLECTION -- */

export async function paymentCollectionReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);

  const [byMethod, byDay, totals, unreconciled] = await Promise.all([
    Payment.aggregate([
      { $match: { business: oid(ctx.businessId), status: 'valid', direction: 'inbound', ...matchRange('paidAt', range) } },
      {
        $group: {
          _id: '$method',
          totalMinor: { $sum: '$amountMinor' },
          count: { $sum: 1 },
          reconciledMinor: { $sum: { $cond: [{ $eq: ['$reconciliation.status', 'reconciled'] }, '$amountMinor', 0] } },
        },
      },
      { $sort: { totalMinor: -1 } },
    ]),
    Payment.aggregate([
      { $match: { business: oid(ctx.businessId), status: 'valid', direction: 'inbound', ...matchRange('paidAt', range) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'UTC' } },
          totalMinor: { $sum: '$amountMinor' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: { business: oid(ctx.businessId), status: 'valid', ...matchRange('paidAt', range) } },
      {
        $group: {
          _id: '$direction',
          totalMinor: { $sum: '$amountMinor' },
          count: { $sum: 1 },
        },
      },
    ]),
    Payment.countDocuments({
      business: oid(ctx.businessId),
      status: 'valid',
      direction: 'inbound',
      'reconciliation.status': 'unreconciled',
    }),
  ]);

  const inbound = totals.find((t) => t._id === 'inbound') ?? { totalMinor: 0, count: 0 };
  const outbound = totals.find((t) => t._id === 'outbound') ?? { totalMinor: 0, count: 0 };

  const billed = await Sale.aggregate([
    { $match: { business: oid(ctx.businessId), status: 'completed', ...matchRange('soldAt', range) } },
    { $group: { _id: null, totalMinor: { $sum: '$totalMinor' } } },
  ]);

  const billedMinor = billed[0]?.totalMinor ?? 0;

  return {
    title: 'Payment collection report',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    byMethod: byMethod.map((r) => ({
      method: r._id,
      label: PAYMENT_METHOD_LABELS[r._id] ?? r._id,
      totalMinor: r.totalMinor,
      count: r.count,
      reconciledMinor: r.reconciledMinor,
      unreconciledMinor: r.totalMinor - r.reconciledMinor,
      sharePercent: inbound.totalMinor ? Math.round((r.totalMinor / inbound.totalMinor) * 10000) / 100 : 0,
    })),
    daily: byDay.map((r) => ({ date: r._id, totalMinor: r.totalMinor, count: r.count })),
    totals: {
      billedMinor,
      collectedMinor: inbound.totalMinor,
      uncollectedMinor: Math.max(0, billedMinor - inbound.totalMinor),
      paidOutMinor: outbound.totalMinor,
      netCashMinor: inbound.totalMinor - outbound.totalMinor,
      collectionRatePercent: billedMinor ? Math.round((inbound.totalMinor / billedMinor) * 10000) / 100 : 0,
      paymentCount: inbound.count,
      unreconciledCount: unreconciled,
    },
    note: 'Cash collected is a cash metric and is deliberately not used to derive profit.',
  };
}

/* ----------------------------------------------- 9. OUTSTANDING INVOICES -- */

export async function outstandingReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);

  const rows = await Invoice.aggregate([
    {
      $match: {
        business: oid(ctx.businessId),
        deletedAt: null,
        status: { $in: ['unpaid', 'partial', 'overdue'] },
        ...matchRange('issuedAt', range),
      },
    },
    {
      $addFields: {
        outstandingMinor: {
          $max: [0, { $subtract: [{ $subtract: ['$totalMinor', '$paidMinor'] }, { $ifNull: ['$writtenOffMinor', 0] }] }],
        },
        daysOverdue: {
          $cond: [{ $lt: [{ $ifNull: ['$dueDate', new Date(8.64e15)] }, new Date()] }, { $dateDiff: { startDate: '$dueDate', endDate: new Date(), unit: 'day' } }, 0],
        },
      },
    },
    { $sort: { daysOverdue: -1, outstandingMinor: -1 } },
    { $limit: query.limit ?? 500 },
    {
      $project: {
        invoiceNumber: 1,
        customerName: 1,
        customerPhone: 1,
        issuedAt: 1,
        dueDate: 1,
        status: 1,
        totalMinor: 1,
        paidMinor: 1,
        outstandingMinor: 1,
        daysOverdue: 1,
        currency: 1,
      },
    },
  ]);

  // Ageing buckets -— the standard receivables view.
  const buckets = [
    { key: 'current', label: 'Not yet due', min: -Infinity, max: 0 },
    { key: '1_30', label: '1-–30 days', min: 1, max: 30 },
    { key: '31_60', label: '31-–60 days', min: 31, max: 60 },
    { key: '61_90', label: '61-–90 days', min: 61, max: 90 },
    { key: '90_plus', label: '90+ days', min: 91, max: Infinity },
  ].map((b) => {
    const matched = rows.filter((r) => r.daysOverdue > b.min && r.daysOverdue <= b.max);
    return {
      ...b,
      min: undefined,
      max: undefined,
      count: matched.length,
      totalMinor: matched.reduce((s, r) => s + r.outstandingMinor, 0),
    };
  });

  return {
    title: 'Outstanding invoices',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    rows,
    ageing: buckets,
    totals: {
      count: rows.length,
      outstandingMinor: rows.reduce((s, r) => s + r.outstandingMinor, 0),
      overdueMinor: rows.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.outstandingMinor, 0),
      overdueCount: rows.filter((r) => r.daysOverdue > 0).length,
    },
  };
}

/* --------------------------------------------------- 10. SUPPLIER BALANCES */

export async function supplierReport(ctx, query) {
  const range = resolveRange(query);
  const m = money(ctx);

  const rows = await Supplier.aggregate([
    {
      $match: { business: oid(ctx.businessId), deletedAt: null, ...(query.supplier ? { _id: query.supplier } : {}) },
    },
    {
      $lookup: {
        from: 'purchases',
        let: { id: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$supplier', '$$id'] }, { $eq: ['$status', 'received'] }] } } },
          { $match: matchRange('purchasedAt', range) },
          {
            $group: {
              _id: null,
              purchasedMinor: { $sum: '$netMinor' },
              purchasedTotalMinor: { $sum: '$totalMinor' },
              paidMinor: { $sum: '$paidMinor' },
              count: { $sum: 1 },
              unitsReceived: { $sum: { $sum: '$lines.quantity' } },
            },
          },
        ],
        as: 'periodStats',
      },
    },
    {
      $addFields: {
        openingSigned: {
          $multiply: ['$openingBalanceMinor', { $cond: [{ $eq: ['$openingBalanceType', 'credit'] }, 1, -1] }],
        },
      },
    },
    {
      $project: {
        name: 1,
        supplierCode: 1,
        contactPerson: 1,
        phone: 1,
        email: 1,
        isActive: 1,
        openingSigned: 1,
        lifetimePurchasedMinor: '$totalPurchasedMinor',
        lifetimePaidMinor: '$totalPaidMinor',
        purchaseCount: '$purchaseCount',
        periodPurchasedMinor: { $ifNull: [{ $first: '$periodStats.purchasedTotalMinor' }, 0] },
        periodPaidMinor: { $ifNull: [{ $first: '$periodStats.paidMinor' }, 0] },
        periodPurchaseCount: { $ifNull: [{ $first: '$periodStats.count' }, 0] },
        unitsReceived: { $ifNull: [{ $first: '$periodStats.unitsReceived' }, 0] },
        outstandingMinor: {
          $max: [0, { $add: [{ $subtract: ['$totalPurchasedMinor', '$totalPaidMinor'] }, '$openingSigned'] }],
        },
      },
    },
    { $sort: { outstandingMinor: -1, name: 1 } },
  ]);

  const purchaseTotals = await Purchase.aggregate([
    { $match: { business: oid(ctx.businessId), status: 'received', ...matchRange('purchasedAt', range) } },
    {
      $group: {
        _id: null,
        netMinor: { $sum: '$netMinor' },
        taxMinor: { $sum: '$taxMinor' },
        totalMinor: { $sum: '$totalMinor' },
        paidMinor: { $sum: '$paidMinor' },
        count: { $sum: 1 },
      },
    },
  ]);

  const t = purchaseTotals[0] ?? { netMinor: 0, taxMinor: 0, totalMinor: 0, paidMinor: 0, count: 0 };

  return {
    title: 'Supplier balances',
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    range,
    rows,
    totals: {
      suppliers: rows.length,
      periodPurchasedMinor: t.totalMinor,
      periodPaidMinor: t.paidMinor,
      periodPayableMinor: Math.max(0, t.totalMinor - t.paidMinor),
      purchaseCount: t.count,
      outstandingMinor: rows.reduce((s, r) => s + r.outstandingMinor, 0),
    },
    note: 'Purchases are inventory acquisitions, not expenses. Their cost reaches the P&L as COGS when sold.',
  };
}

/* ------------------------------------------------------------ DISPATCH -- */

const REPORTS = {
  sales: { fn: salesReport, label: 'Sales' },
  'profit-loss': { fn: profitLossReport, label: 'Profit & loss' },
  expenses: { fn: expenseReport, label: 'Expenses' },
  inventory: { fn: inventoryReport, label: 'Inventory valuation' },
  'stock-movements': { fn: stockMovementReport, label: 'Stock movements' },
  'low-stock': { fn: lowStockReport, label: 'Low stock' },
  customers: { fn: customerReport, label: 'Customer transactions' },
  collections: { fn: paymentCollectionReport, label: 'Payment collections' },
  outstanding: { fn: outstandingReport, label: 'Outstanding invoices' },
  suppliers: { fn: supplierReport, label: 'Supplier balances' },
};

export const AVAILABLE_REPORTS = Object.entries(REPORTS).map(([key, v]) => ({ key, label: v.label }));

export async function buildReport(ctx, key, query) {
  const entry = REPORTS[key];
  if (!entry) throw new Error(`Unknown report "${key}"`);
  const data = await entry.fn(ctx, query);
  await ctx.audit?.();
  return { key, ...data };
}

/** Flatten a report to tabular rows for CSV/PDF export. */
export function reportToRows(key, report) {
  const ctx = report.currency;
  switch (key) {
    case 'sales':
      return {
        columns: [
          { header: 'Date', key: 'date' },
          { header: 'Orders', key: 'orders' },
          { header: 'Items', key: 'items' },
          { header: 'Gross', key: 'grossMinor' },
          { header: 'Discount', key: 'discountMinor' },
          { header: 'Net sales', key: 'netSalesMinor' },
          { header: 'Tax', key: 'taxMinor' },
          { header: 'Total', key: 'totalMinor' },
          { header: 'COGS', key: 'cogsMinor' },
          { header: 'Gross profit', key: 'grossProfitMinor' },
          { header: 'Refunded', key: 'refundedMinor' },
        ],
        rows: report.rows,
      };
    case 'profit-loss':
      return {
        columns: [
          { header: 'Line', key: 'label' },
          { header: 'Kind', key: 'kind' },
          { header: `Amount (${ctx.symbol})`, value: (r) => (ctx.decimals ? (r.amountMinor / 10 ** ctx.decimals).toFixed(ctx.decimals) : r.amountMinor) },
          { header: 'Definition', key: 'definition' },
        ],
        rows: report.lines,
      };
    case 'expenses':
      return {
        columns: [
          { header: 'Category', key: 'label' },
          { header: 'Count', key: 'count' },
          { header: 'Total', key: 'totalMinor' },
          { header: 'Share %', key: 'sharePercent' },
        ],
        rows: report.byCategory,
      };
    case 'inventory':
      return {
        columns: [
          { header: 'Product', key: 'name' },
          { header: 'SKU', key: 'sku' },
          { header: 'Category', key: 'categoryName' },
          { header: 'Qty', key: 'stockQuantity' },
          { header: 'Unit', key: 'unit' },
          { header: 'Unit cost', key: 'effectiveCostMinor' },
          { header: 'Stock value', key: 'stockValueMinor' },
          { header: 'Status', key: 'status' },
        ],
        rows: report.rows,
      };
    case 'stock-movements':
      return {
        columns: [
          { header: 'Date', value: (r) => new Date(r.occurredAt).toISOString().slice(0, 10) },
          { header: 'Product', key: 'name' },
          { header: 'SKU', key: 'sku' },
          { header: 'Type', key: 'type' },
          { header: 'Quantity', key: 'quantity' },
          { header: 'Before', key: 'quantityBefore' },
          { header: 'After', key: 'quantityAfter' },
          { header: 'Reason', key: 'reason' },
          { header: 'Reference', key: 'reference' },
          { header: 'By', key: 'performedBy' },
        ],
        rows: report.movements,
      };
    case 'low-stock':
      return {
        columns: [
          { header: 'Product', key: 'name' },
          { header: 'SKU', key: 'sku' },
          { header: 'On hand', key: 'stockQuantity' },
          { header: 'Minimum', key: 'minStockLevel' },
          { header: 'Shortfall', key: 'shortfall' },
          { header: 'Restock cost', key: 'restockCostMinor' },
          { header: 'Status', key: 'status' },
        ],
        rows: report.rows,
      };
    case 'customers':
      return {
        columns: [
          { header: 'Customer', key: 'name' },
          { header: 'Code', key: 'code' },
          { header: 'Phone', key: 'phone' },
          { header: 'Orders', key: 'orders' },
          { header: 'Billed', key: 'billedMinor' },
          { header: 'Avg order', key: 'averageOrderMinor' },
          { header: 'Outstanding', key: 'outstandingMinor' },
          { header: 'Last order', value: (r) => (r.lastOrderAt ? new Date(r.lastOrderAt).toISOString().slice(0, 10) : '') },
        ],
        rows: report.rows,
      };
    case 'collections':
      return {
        columns: [
          { header: 'Method', key: 'label' },
          { header: 'Count', key: 'count' },
          { header: 'Collected', key: 'totalMinor' },
          { header: 'Reconciled', key: 'reconciledMinor' },
          { header: 'Unreconciled', key: 'unreconciledMinor' },
          { header: 'Share %', key: 'sharePercent' },
        ],
        rows: report.byMethod,
      };
    case 'outstanding':
      return {
        columns: [
          { header: 'Invoice', key: 'invoiceNumber' },
          { header: 'Customer', key: 'customerName' },
          { header: 'Issued', value: (r) => new Date(r.issuedAt).toISOString().slice(0, 10) },
          { header: 'Due', value: (r) => (r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : '') },
          { header: 'Total', key: 'totalMinor' },
          { header: 'Paid', key: 'paidMinor' },
          { header: 'Outstanding', key: 'outstandingMinor' },
          { header: 'Days overdue', key: 'daysOverdue' },
          { header: 'Status', key: 'status' },
        ],
        rows: report.rows,
      };
    case 'suppliers':
      return {
        columns: [
          { header: 'Supplier', key: 'name' },
          { header: 'Code', key: 'supplierCode' },
          { header: 'Contact', key: 'contactPerson' },
          { header: 'Phone', key: 'phone' },
          { header: 'Purchased (period)', key: 'periodPurchasedMinor' },
          { header: 'Paid (period)', key: 'periodPaidMinor' },
          { header: 'Outstanding', key: 'outstandingMinor' },
          { header: 'Purchases', key: 'purchaseCount' },
        ],
        rows: report.rows,
      };
    default:
      return { columns: [{ header: 'Value', key: 'value' }], rows: [] };
  }
}

export { outstandingMinor, APP_NAME };
