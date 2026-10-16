/**
 * Customer service.
 *
 * Lifetime counters (totalSales / totalPaid / totalRefunded) are maintained by
 * the sale and payment services inside their transactions. This module never
 * writes them directly, which keeps a single source of truth for the money.
 */
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { createMoneyContext } from './money.context.js';
import { recordAudit } from './audit.service.js';
import { assertNotDuplicate, withTransaction } from './transaction.service.js';
import { escapeRegex } from '../../../shared/validators/primitives.js';

export async function listCustomers(ctx, query) {
  const { page, limit, skip } = query;
  const m = createMoneyContext(ctx.business);
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['name', 'customerCode', 'phone', 'createdAt', 'lastTransactionAt', 'totalSalesMinor'].includes(query.sort)
    ? query.sort
    : 'createdAt';

  const filter = { business: ctx.businessId, deletedAt: null };
  if (query.status === 'active') filter.isActive = true;
  if (query.status === 'archived') filter.archivedAt = { $ne: null };
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { customerCode: rx }, { email: rx }];
  }

  const [items, total, summary] = await Promise.all([
    Customer.find(filter)
      .sort({ [sortField]: direction, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Customer.countDocuments(filter),
    Customer.aggregate([
      { $match: { business: ctx.business._id, deletedAt: null, isActive: true } },
      {
        $project: {
          outstandingMinor: {
            $max: [
              0,
              {
                $subtract: [
                  {
                    $add: [
                      '$totalSalesMinor',
                      { $multiply: ['$openingBalanceMinor', { $cond: [{ $eq: ['$openingBalanceType', 'debit'] }, 1, -1] }] },
                    ],
                  },
                  { $add: ['$totalPaidMinor', '$totalRefundedMinor'] },
                ],
              },
            ],
          },
          lifetimeSalesMinor: '$totalSalesMinor',
          lifetimePaidMinor: '$totalPaidMinor',
        },
      },
      {
        $group: {
          _id: null,
          customers: { $sum: 1 },
          outstandingMinor: { $sum: '$outstandingMinor' },
          lifetimeSalesMinor: { $sum: '$lifetimeSalesMinor' },
          lifetimePaidMinor: { $sum: '$lifetimePaidMinor' },
          owing: { $sum: { $cond: [{ $gt: ['$outstandingMinor', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const agg = summary[0] ?? { customers: 0, outstandingMinor: 0, lifetimeSalesMinor: 0, lifetimePaidMinor: 0, owing: 0 };

  return {
    items: items.map((c) => ({
      ...c,
      totalSales: m.toDecimal(c.totalSalesMinor),
      totalPaid: m.toDecimal(c.totalPaidMinor),
      outstanding: m.toDecimal(c.outstandingMinor),
    })),
    total,
    page,
    limit,
    summary: agg,
  };
}

export async function getCustomer(ctx, id) {
  const customer = await Customer.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .lean({ virtuals: true });
  if (!customer) throw AppError.notFound('Customer not found');

  const [invoices, payments, sales] = await Promise.all([
    Invoice.find({ business: ctx.businessId, customer: id, deletedAt: null })
      .sort({ issuedAt: -1 })
      .limit(50)
      .select('invoiceNumber issuedAt dueDate totalMinor paidMinor refundedMinor writtenOffMinor status')
      .lean({ virtuals: true }),
    Payment.find({ business: ctx.businessId, customer: id, deletedAt: null, status: 'valid' })
      .sort({ paidAt: -1 })
      .limit(50)
      .select('reference paidAt amountMinor refundedMinor method transactionReference status invoice')
      .lean(),
    Sale.find({ business: ctx.businessId, customer: id, deletedAt: null })
      .sort({ soldAt: -1 })
      .limit(20)
      .select('reference soldAt totalMinor paidMinor netSalesMinor grossProfitMinor status channel')
      .lean(),
  ]);

  return { ...customer, invoices, payments, sales };
}

export async function createCustomer(ctx, payload) {
  const m = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    const openingBalanceMinor = payload.openingBalance ? m.parse(payload.openingBalance) : 0;

    if (openingBalanceMinor > 0 && !payload.openingBalanceReason) {
      throw AppError.badRequest('A reason is required when recording an opening balance', {
        fields: ['openingBalanceReason'],
      });
    }

    let customer;
    try {
      [customer] = await Customer.create(
        [
          {
            business: ctx.businessId,
            name: payload.name,
            customerCode: payload.customerCode?.toUpperCase() ?? '',
            phone: payload.phone,
            email: payload.email ?? '',
            address: payload.address ?? '',
            notes: payload.notes ?? '',
            tags: payload.tags ?? [],
            isWalkIn: payload.isWalkIn ?? false,
            creditLimitMinor: payload.creditLimit ? m.parse(payload.creditLimit) : 0,
            openingBalanceMinor,
            openingBalanceType: payload.openingBalanceType ?? 'debit',
            createdBy: ctx.user._id,
          },
        ],
        { session }
      );
    } catch (err) {
      assertNotDuplicate(err, 'A customer with this code already exists');
      throw err;
    }

    if (!customer.isWalkIn) {
      await mongoose.model('Business').updateOne(
        { _id: ctx.businessId },
        { $inc: { 'stats.customerCount': 1 } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'create',
      entity: 'Customer',
      entityId: customer._id,
      amountMinor: openingBalanceMinor,
      changes: { name: customer.name, code: customer.customerCode, openingBalanceMinor, creditLimitMinor: customer.creditLimitMinor },
      ip: ctx.ip,
    });

    return customer;
  }, { label: 'createCustomer' });
}

export async function updateCustomer(ctx, id, payload) {
  const m = createMoneyContext(ctx.business);
  const customer = await Customer.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!customer) throw AppError.notFound('Customer not found');

  const set = {};
  for (const f of ['name', 'phone', 'email', 'address', 'notes', 'tags', 'isActive', 'isWalkIn']) {
    if (payload[f] !== undefined) set[f] = payload[f];
  }
  if (payload.customerCode !== undefined) set.customerCode = payload.customerCode?.toUpperCase() ?? '';
  if (payload.creditLimit !== undefined) set.creditLimitMinor = m.parse(payload.creditLimit);
  set.updatedBy = ctx.user._id;

  try {
    customer.set(set);
    await customer.save();
  } catch (err) {
    assertNotDuplicate(err, 'A customer with this code already exists');
    throw err;
  }

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'update',
    entity: 'Customer',
    entityId: id,
    changes: set,
    ip: ctx.ip,
  });

  return customer;
}

export async function setCustomerArchived(ctx, id, archived, reason) {
  const customer = await Customer.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!customer) throw AppError.notFound('Customer not found');

  if (archived) {
    const unpaid = await Invoice.countDocuments({
      business: ctx.businessId,
      customer: id,
      deletedAt: null,
      status: { $in: ['unpaid', 'partial', 'overdue'] },
    });
    if (unpaid > 0) {
      throw AppError.badRequest(`Settle or cancel ${unpaid} outstanding invoice(s) before archiving this customer`);
    }
  }

  customer.archivedAt = archived ? new Date() : null;
  customer.isActive = !archived;
  customer.updatedBy = ctx.user._id;
  await customer.save();

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: archived ? 'archive' : 'restore',
    entity: 'Customer',
    entityId: id,
    changes: { reason, archived },
    ip: ctx.ip,
  });
  return customer;
}

/** Returns (or creates) the single walk-in bucket for a business. */
export async function getWalkInCustomer(ctx) {
  const existing = await Customer.findOne({
    business: ctx.businessId,
    isWalkIn: true,
    customerCode: Customer.WALK_IN_CODE,
    deletedAt: null,
  });
  if (existing) return existing;

  const [bucket] = await Customer.create([
    {
      business: ctx.businessId,
      name: 'Walk-in Customer',
      phone: '0000000000',
      customerCode: Customer.WALK_IN_CODE,
      isWalkIn: true,
      notes: 'Default bucket for sales that do not need a permanent customer record',
      createdBy: ctx.user._id,
    },
  ]);
  return bucket;
}

export async function customerLedger(ctx, customerId, { from, to } = {}) {
  const customer = await Customer.findOne({ _id: customerId, business: ctx.businessId, deletedAt: null }).lean();
  if (!customer) throw AppError.notFound('Customer not found');

  const dateFilter = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const hasRange = Boolean(from || to);

  const [sales, payments] = await Promise.all([
    Sale.find({
      business: ctx.businessId,
      customer: customerId,
      status: 'completed',
      ...(hasRange ? { soldAt: dateFilter } : {}),
    })
      .sort({ soldAt: -1 })
      .select('reference soldAt totalMinor paidMinor netSalesMinor grossProfitMinor status')
      .lean(),
    Payment.find({
      business: ctx.businessId,
      customer: customerId,
      status: 'valid',
      ...(hasRange ? { paidAt: dateFilter } : {}),
    })
      .sort({ paidAt: -1 })
      .select('reference paidAt amountMinor refundedMinor method transactionReference invoice')
      .lean(),
  ]);

  return { customer, sales, payments };
}
