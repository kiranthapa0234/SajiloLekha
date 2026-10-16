/**
 * Supplier service -— contacts, balances and purchase history.
 */
import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import Payment from '../models/Payment.js';
import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { createMoneyContext } from './money.context.js';
import { recordAudit } from './audit.service.js';
import { assertNotDuplicate, withTransaction } from './transaction.service.js';
import { escapeRegex } from '../../../shared/validators/primitives.js';

export async function listSuppliers(ctx, query) {
  const { page, limit, skip } = query;
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['name', 'supplierCode', 'phone', 'createdAt', 'lastTransactionAt', 'totalPurchasedMinor'].includes(query.sort)
    ? query.sort
    : 'createdAt';

  const filter = { business: ctx.businessId, deletedAt: null };
  if (query.status === 'active') filter.isActive = true;
  if (query.status === 'archived') filter.archivedAt = { $ne: null };
  if (query.status === 'due') filter.isActive = true;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { supplierCode: rx }, { email: rx }, { contactPerson: rx }];
  }

  const [items, total, summary] = await Promise.all([
    Supplier.find(filter).sort({ [sortField]: direction, _id: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Supplier.countDocuments(filter),
    Supplier.aggregate([
      { $match: { business: ctx.business._id, deletedAt: null, isActive: true } },
      {
        $project: {
          outstandingMinor: {
            $max: [
              0,
              {
                $add: [
                  { $subtract: ['$totalPurchasedMinor', '$totalPaidMinor'] },
                  { $multiply: ['$openingBalanceMinor', { $cond: [{ $eq: ['$openingBalanceType', 'credit'] }, 1, -1] }] },
                ],
              },
            ],
          },
          lifetimePurchasedMinor: '$totalPurchasedMinor',
          lifetimePaidMinor: '$totalPaidMinor',
        },
      },
      {
        $group: {
          _id: null,
          suppliers: { $sum: 1 },
          outstandingMinor: { $sum: '$outstandingMinor' },
          lifetimePurchasedMinor: { $sum: '$lifetimePurchasedMinor' },
          owing: { $sum: { $cond: [{ $gt: ['$outstandingMinor', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  return {
    items,
    total,
    page,
    limit,
    summary: summary[0] ?? { suppliers: 0, outstandingMinor: 0, lifetimePurchasedMinor: 0, owing: 0 },
  };
}

export async function getSupplier(ctx, id) {
  const supplier = await Supplier.findOne({ _id: id, business: ctx.businessId, deletedAt: null }).lean({ virtuals: true });
  if (!supplier) throw AppError.notFound('Supplier not found');

  const [purchases, payments, products] = await Promise.all([
    Purchase.find({ business: ctx.businessId, supplier: id, deletedAt: null })
      .sort({ purchasedAt: -1 })
      .limit(50)
      .select('reference supplierInvoiceNumber purchasedAt dueDate netMinor taxMinor totalMinor paidMinor status lines')
      .lean(),
    Payment.find({ business: ctx.businessId, supplier: id, deletedAt: null, status: 'valid' })
      .sort({ paidAt: -1 })
      .limit(50)
      .select('reference paidAt amountMinor refundedMinor method transactionReference purchase')
      .lean(),
    mongoose
      .model('Product')
      .find({ business: ctx.businessId, supplier: id, deletedAt: null })
      .sort({ name: 1 })
      .select('name sku stockQuantity minStockLevel sellingPriceMinor costPriceMinor stockStatus')
      .lean({ virtuals: true }),
  ]);

  return { ...supplier, purchases, payments, products };
}

export async function createSupplier(ctx, payload) {
  const m = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    const openingBalanceMinor = payload.openingBalance ? m.parse(payload.openingBalance) : 0;
    if (openingBalanceMinor > 0 && !payload.openingBalanceReason) {
      throw AppError.badRequest('A reason is required when recording an opening balance', {
        fields: ['openingBalanceReason'],
      });
    }

    let supplier;
    try {
      [supplier] = await Supplier.create(
        [
          {
            business: ctx.businessId,
            name: payload.name,
            supplierCode: payload.supplierCode?.toUpperCase() ?? '',
            contactPerson: payload.contactPerson ?? '',
            phone: payload.phone,
            email: payload.email ?? '',
            address: payload.address ?? '',
            taxNumber: payload.taxNumber ?? '',
            notes: payload.notes ?? '',
            openingBalanceMinor,
            openingBalanceType: payload.openingBalanceType ?? 'credit',
            createdBy: ctx.user._id,
          },
        ],
        { session }
      );
    } catch (err) {
      assertNotDuplicate(err, 'A supplier with this code already exists');
      throw err;
    }

    await mongoose.model('Business').updateOne(
      { _id: ctx.businessId },
      { $inc: { 'stats.supplierCount': 1 } },
      { session }
    );

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'create',
      entity: 'Supplier',
      entityId: supplier._id,
      amountMinor: openingBalanceMinor,
      changes: { name: supplier.name, code: supplier.supplierCode },
      ip: ctx.ip,
    });

    return supplier;
  }, { label: 'createSupplier' });
}

export async function updateSupplier(ctx, id, payload) {
  const supplier = await Supplier.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!supplier) throw AppError.notFound('Supplier not found');

  const set = {};
  for (const f of ['name', 'contactPerson', 'phone', 'email', 'address', 'taxNumber', 'notes', 'isActive', 'leadTimeDays', 'paymentTermsDays']) {
    if (payload[f] !== undefined) set[f] = payload[f];
  }
  if (payload.supplierCode !== undefined) set.supplierCode = payload.supplierCode?.toUpperCase() ?? '';
  set.updatedBy = ctx.user._id;

  try {
    supplier.set(set);
    await supplier.save();
  } catch (err) {
    assertNotDuplicate(err, 'A supplier with this code already exists');
    throw err;
  }

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'update',
    entity: 'Supplier',
    entityId: id,
    changes: set,
    ip: ctx.ip,
  });
  return supplier;
}

export async function setSupplierArchived(ctx, id, archived, reason) {
  const supplier = await Supplier.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!supplier) throw AppError.notFound('Supplier not found');

  if (archived) {
    const unpaid = await Purchase.countDocuments({
      business: ctx.businessId,
      supplier: id,
      deletedAt: null,
      status: 'received',
      $expr: { $lt: ['$paidMinor', '$totalMinor'] },
    });
    if (unpaid > 0) {
      throw AppError.badRequest(`Settle ${unpaid} outstanding purchase(s) before archiving this supplier`);
    }
  }

  supplier.archivedAt = archived ? new Date() : null;
  supplier.isActive = !archived;
  supplier.updatedBy = ctx.user._id;
  await supplier.save();

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: archived ? 'archive' : 'restore',
    entity: 'Supplier',
    entityId: id,
    changes: { reason, archived },
    ip: ctx.ip,
  });
  return supplier;
}

export async function supplierLedger(ctx, supplierId, { from, to } = {}) {
  const supplier = await Supplier.findOne({ _id: supplierId, business: ctx.businessId, deletedAt: null }).lean();
  if (!supplier) throw AppError.notFound('Supplier not found');

  const dateFilter = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const hasRange = Boolean(from || to);

  const [purchases, payments] = await Promise.all([
    Purchase.find({
      business: ctx.businessId,
      supplier: supplierId,
      ...(hasRange ? { purchasedAt: dateFilter } : {}),
    })
      .sort({ purchasedAt: -1 })
      .select('reference supplierInvoiceNumber purchasedAt netMinor taxMinor totalMinor paidMinor status')
      .lean(),
    Payment.find({
      business: ctx.businessId,
      supplier: supplierId,
      status: 'valid',
      ...(hasRange ? { paidAt: dateFilter } : {}),
    })
      .sort({ paidAt: -1 })
      .select('reference paidAt amountMinor method transactionReference purchase')
      .lean(),
  ]);

  return { supplier, purchases, payments };
}

export default {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  setSupplierArchived,
  supplierLedger,
};
