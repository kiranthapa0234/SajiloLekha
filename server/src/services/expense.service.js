/**
 * Expense service -— operating expenses only.
 *
 * An expense never touches stock. Inventory spend belongs in the Purchases
 * module, which capitalises it into inventory. Mixing the two would double-count
 * stock value and understate gross profit.
 */
import Expense from '../models/Expense.js';
import { AppError } from '../utils/errors.js';
import { createMoneyContext } from './money.context.js';
import { recordAudit } from './audit.service.js';
import { withTransaction } from './transaction.service.js';
import { escapeRegex } from '../../../shared/validators/primitives.js';

export async function listExpenses(ctx, query) {
  const { page, limit, skip } = query;
  const m = createMoneyContext(ctx.business);
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['spentAt', 'amountMinor', 'title', 'createdAt', 'category'].includes(query.sort) ? query.sort : 'spentAt';

  const filter = { business: ctx.businessId, deletedAt: null, archivedAt: null };
  if (query.category) filter.category = query.category;
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.from || query.to) {
    filter.spentAt = {};
    if (query.from) filter.spentAt.$gte = query.from;
    if (query.to) filter.spentAt.$lte = query.to;
  }
  if (query.minAmount !== undefined || query.maxAmount !== undefined) {
    filter.amountMinor = {};
    if (query.minAmount !== undefined) filter.amountMinor.$gte = m.parse(query.minAmount);
    if (query.maxAmount !== undefined) filter.amountMinor.$lte = m.parse(query.maxAmount);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ title: rx }, { vendor: rx }, { reference: rx }, { notes: rx }];
  }

  const [items, total, summary] = await Promise.all([
    Expense.find(filter)
      .populate('createdBy', 'name')
      .sort({ [sortField]: direction, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([
      { $match: { ...filter, business: ctx.business._id } },
      {
        $group: {
          _id: '$status',
          totalMinor: { $sum: '$amountMinor' },
          count: { $sum: 1 },
        },
      },
    ]).then((rows) => {
      const recorded = rows.find((r) => r._id === 'recorded') ?? { totalMinor: 0, count: 0 };
      return {
        totalMinor: recorded.totalMinor,
        count: recorded.count,
        voidedCount: rows.filter((r) => r._id === 'voided').reduce((s, r) => s + r.count, 0),
      };
    }),
  ]);

  return {
    items: items.map((e) => ({ ...e, amount: m.toDecimal(e.amountMinor) })),
    total,
    page,
    limit,
    summary,
  };
}

export async function getExpense(ctx, id) {
  const expense = await Expense.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .populate('createdBy', 'name')
    .lean();
  if (!expense) throw AppError.notFound('Expense not found');
  return expense;
}

export async function createExpense(ctx, payload) {
  const m = createMoneyContext(ctx.business);
  const amountMinor = m.parse(payload.amount);
  if (amountMinor <= 0) throw AppError.badRequest('Amount must be greater than zero', { fields: ['amount'] });

  const expense = await Expense.create({
    business: ctx.businessId,
    title: payload.title,
    category: payload.category,
    amountMinor,
    currency: m.currency,
    spentAt: payload.spentAt ?? new Date(),
    paymentMethod: payload.paymentMethod,
    isPaid: payload.isPaid ?? true,
    vendor: payload.vendor ?? '',
    reference: payload.reference ?? '',
    notes: payload.notes ?? '',
    receiptUrl: payload.receiptUrl ?? null,
    recurring: payload.recurring ?? false,
    recurrence: payload.recurring ? (payload.recurrence ?? 'monthly') : 'none',
    createdBy: ctx.user._id,
  });

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'expense.create',
    entity: 'Expense',
    entityId: expense._id,
    amountMinor,
    currency: m.currency,
    changes: { title: expense.title, category: expense.category, spentAt: expense.spentAt, paymentMethod: expense.paymentMethod },
    ip: ctx.ip,
  });

  return expense;
}

export async function updateExpense(ctx, id, payload) {
  const m = createMoneyContext(ctx.business);
  const expense = await Expense.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!expense) throw AppError.notFound('Expense not found');
  if (expense.status === 'voided') throw AppError.badRequest('A voided expense cannot be edited');

  const before = {
    title: expense.title,
    category: expense.category,
    amountMinor: expense.amountMinor,
    spentAt: expense.spentAt,
    paymentMethod: expense.paymentMethod,
  };

  const set = {};
  for (const f of ['title', 'category', 'spentAt', 'paymentMethod', 'vendor', 'reference', 'notes', 'recurring', 'receiptUrl']) {
    if (payload[f] !== undefined) set[f] = payload[f];
  }
  if (payload.amount !== undefined) {
    const amountMinor = m.parse(payload.amount);
    if (amountMinor <= 0) throw AppError.badRequest('Amount must be greater than zero', { fields: ['amount'] });
    set.amountMinor = amountMinor;
  }
  if (payload.recurring !== undefined) set.recurrence = payload.recurring ? (payload.recurrence ?? 'monthly') : 'none';
  set.updatedBy = ctx.user._id;

  expense.set(set);
  await expense.save();

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'expense.update',
    entity: 'Expense',
    entityId: id,
    amountMinor: expense.amountMinor,
    changes: { before, after: set },
    ip: ctx.ip,
  });

  return expense;
}

/**
 * Voiding excludes the record from every report while keeping it queryable for
 * audit -— the correct behaviour for an accounting system.
 */
export async function voidExpense(ctx, id, reason) {
  return withTransaction(async ({ session }) => {
    const expense = await Expense.findOne({ _id: id, business: ctx.businessId, deletedAt: null }).session(session);
    if (!expense) throw AppError.notFound('Expense not found');
    if (expense.status === 'voided') throw AppError.badRequest('Expense is already voided');

    expense.status = 'voided';
    expense.voidReason = reason;
    expense.voidedAt = new Date();
    expense.voidedBy = ctx.user._id;
    await expense.save({ session });

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'expense.void',
      entity: 'Expense',
      entityId: id,
      amountMinor: expense.amountMinor,
      changes: { title: expense.title, reason },
      ip: ctx.ip,
    });

    return expense;
  }, { label: 'voidExpense' });
}

export async function setExpenseArchived(ctx, id, archived) {
  const expense = await Expense.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!expense) throw AppError.notFound('Expense not found');
  expense.archivedAt = archived ? new Date() : null;
  expense.updatedBy = ctx.user._id;
  await expense.save();
  return expense;
}

/** Compact daily/monthly/yearly totals for the expenses overview cards. */
export async function expenseTotals(ctx, { from, to } = {}) {
  const match = { business: ctx.business._id, status: 'recorded', deletedAt: null, archivedAt: null };
  if (from || to) match.spentAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  // `$facet` still yields an array of exactly one document — the container of
  // all the sub-pipelines — so it has to be unwrapped before the facets can be
  // read. Reading it as the document itself left every facet undefined and the
  // endpoint 500'd on `.map`.
  const [result] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      {
        $facet: {
          byDay: [
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$spentAt', timezone: 'UTC' } }, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          byMonth: [
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$spentAt', timezone: 'UTC' } }, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          byYear: [
            { $group: { _id: { $dateToString: { format: '%Y', date: '$spentAt', timezone: 'UTC' } }, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          totals: [{ $group: { _id: null, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } }],
        },
      },
    ]),
  ]);

  const rows = result?.[0] ?? { byDay: [], byMonth: [], byYear: [], totals: [] };

  return {
    daily: (rows.byDay ?? []).map((r) => ({ date: r._id, totalMinor: r.totalMinor, count: r.count })),
    monthly: (rows.byMonth ?? []).map((r) => ({ month: r._id, totalMinor: r.totalMinor, count: r.count })),
    yearly: (rows.byYear ?? []).map((r) => ({ year: r._id, totalMinor: r.totalMinor, count: r.count })),
    totals: rows.totals?.[0] ?? { totalMinor: 0, count: 0 },
  };
}

export default {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  voidExpense,
  setExpenseArchived,
  expenseTotals,
};
