/**
 * Purchase service -— goods received from suppliers.
 *
 * A purchase is NOT an expense. It capitalises into inventory via StockMovement
 * and only affects the profit & loss statement later, as COGS, when sold.
 */
import Purchase from '../models/Purchase.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import Payment from '../models/Payment.js';
import { AppError } from '../utils/errors.js';
import { multiplyMinor, sumMinor } from '../../../shared/money.js';
import { createMoneyContext } from './money.context.js';
import { applyStockChange, reverseMovements } from './stock.service.js';
import { recordForPayment, recordMovement } from './money.service.js';
import { MONEY_ACCOUNTS } from '../../../shared/constants.js';
import { recordAudit } from './audit.service.js';
import { recordPurchasePayment } from './payment.service.js';
import { assertNotDuplicate, nextSequence, withTransaction } from './transaction.service.js';

export async function listPurchases(ctx, query) {
  const { page, limit, skip } = query;
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['purchasedAt', 'totalMinor', 'reference', 'createdAt'].includes(query.sort) ? query.sort : 'purchasedAt';

  const filter = { business: ctx.businessId, deletedAt: null };
  if (query.status && query.status !== 'all') {
    if (['partial', 'paid', 'unpaid'].includes(query.status)) {
      filter.$expr = {
        $eq: [
          {
            $switch: {
              branches: [
                { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' },
                { case: { $gte: ['$paidMinor', '$totalMinor'] }, then: 'paid' },
                { case: { $gt: ['$paidMinor', 0] }, then: 'partial' },
              ],
              default: 'unpaid',
            },
          },
          query.status,
        ],
      };
    } else {
      filter.status = query.status;
    }
  }
  if (query.supplier) filter.supplier = query.supplier;
  if (query.from || query.to) {
    filter.purchasedAt = {};
    if (query.from) filter.purchasedAt.$gte = query.from;
    if (query.to) filter.purchasedAt.$lte = query.to;
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ reference: rx }, { supplierInvoiceNumber: rx }, { supplierName: rx }];
  }

  const [items, total, summary] = await Promise.all([
    Purchase.find(filter)
      .populate('supplier', 'name supplierCode')
      .populate('createdBy', 'name')
      .sort({ [sortField]: direction, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Purchase.countDocuments(filter),
    Purchase.aggregate([
      { $match: { business: ctx.business._id, deletedAt: null, status: 'received' } },
      {
        $group: {
          _id: null,
          totalMinor: { $sum: '$totalMinor' },
          paidMinor: { $sum: '$paidMinor' },
          netMinor: { $sum: '$netMinor' },
          taxMinor: { $sum: '$taxMinor' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const agg = summary[0] ?? { totalMinor: 0, paidMinor: 0, netMinor: 0, taxMinor: 0, count: 0 };

  return {
    items,
    total,
    page,
    limit,
    summary: { ...agg, outstandingMinor: Math.max(0, agg.totalMinor - agg.paidMinor) },
  };
}

export async function getPurchase(ctx, id) {
  const purchase = await Purchase.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .populate('supplier', 'name supplierCode phone email')
    .populate('createdBy', 'name')
    .lean({ virtuals: true });
  if (!purchase) throw AppError.notFound('Purchase not found');

  const payments = await Payment.find({ purchase: id, business: ctx.businessId, status: 'valid' })
    .sort({ paidAt: 1 })
    .lean();

  return { ...purchase, payments };
}

export async function createPurchase(ctx, payload) {
  const money = createMoneyContext(ctx.business);

  if (payload.idempotencyKey) {
    const replay = await Purchase.findOne({ business: ctx.businessId, idempotencyKey: payload.idempotencyKey });
    if (replay) return { purchase: replay, replayed: true };
  }

  return withTransaction(async ({ session }) => {
    // ---- Resolve & price the lines --------------------------------------
    const productIds = [...new Set(payload.lines.map((l) => String(l.product)))];
    const products = await Product.find({
      _id: { $in: productIds },
      business: ctx.businessId,
      deletedAt: null,
      archivedAt: null,
    }).session(session);

    const byId = new Map(products.map((p) => [String(p._id), p]));
    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length) throw AppError.notFound(`Product not found: ${missing.join(', ')}`);

    let supplier = null;
    if (payload.supplier) {
      supplier = await Supplier.findOne({ _id: payload.supplier, business: ctx.businessId, deletedAt: null }).session(session);
      if (!supplier) throw AppError.notFound('Supplier not found');
    }

    const lines = [];
    for (const line of payload.lines) {
      const product = byId.get(String(line.product));
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw AppError.badRequest(`Invalid quantity for "${product.name}"`);
      }
      const unitCostMinor = money.parse(line.costPrice);
      if (unitCostMinor < 0) throw AppError.badRequest(`Invalid cost for "${product.name}"`);

      const grossMinor = multiplyMinor(unitCostMinor, quantity);
      const taxPercent = Number(line.taxPercent ?? payload.taxPercent ?? 0);
      const taxMinor = taxPercent > 0 ? Math.round((grossMinor * taxPercent) / 100) : 0;

      lines.push({
        product: product._id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity,
        unitCostMinor,
        suggestedSellingPriceMinor: line.sellingPrice !== undefined ? money.parse(line.sellingPrice) : product.sellingPriceMinor,
        taxPercent,
        discountMinor: 0,
        netMinor: grossMinor,
        taxMinor,
        totalMinor: grossMinor + taxMinor,
        note: line.note ?? '',
        returnedQuantity: 0,
      });
    }

    const grossMinor = sumMinor(lines.map((l) => l.netMinor));
    const taxMinor = sumMinor(lines.map((l) => l.taxMinor));
    const totalMinor = sumMinor(lines.map((l) => l.totalMinor));

    const payments = (payload.payments ?? []).map((p) => ({
      amountMinor: money.parse(p.amount, 0),
      method: p.method,
      reference: p.reference ?? '',
      paidAt: p.paidAt ?? payload.purchasedAt ?? new Date(),
      note: p.note ?? '',
    }));

    const paidMinor = sumMinor(payments.map((p) => p.amountMinor));
    if (paidMinor > totalMinor) {
      throw AppError.badRequest('Payments cannot exceed the purchase total');
    }

    const purchasedAt = payload.purchasedAt ?? new Date();
    const { reference } = await nextSequence(ctx.businessId, 'purchase', { session });

    let purchase;
    try {
      [purchase] = await Purchase.create(
        [
          {
            business: ctx.businessId,
            reference,
            supplierInvoiceNumber: payload.reference ?? '',
            supplier: supplier?._id ?? null,
            supplierName: supplier?.name ?? '',
            lines,
            currency: money.currency,
            grossMinor,
            totalDiscountMinor: 0,
            netMinor: grossMinor,
            taxLabel: ctx.business.settings?.taxLabel ?? 'VAT',
            taxMinor,
            totalMinor,
            paidMinor,
            status: 'received',
            purchasedAt,
            dueDate:
              payload.dueDate ??
              (paidMinor < totalMinor
                ? new Date(purchasedAt.getTime() + (supplier?.paymentTermsDays ?? ctx.business.settings?.invoiceDueDays ?? 0) * 86400000)
                : null),
            paymentMethod: payments[0]?.method ?? payload.paymentMethod ?? 'cash',
            note: payload.note ?? '',
            idempotencyKey: payload.idempotencyKey ?? null,
            createdBy: ctx.user._id,
          },
        ],
        { session }
      );
    } catch (err) {
      assertNotDuplicate(err, 'This purchase has already been recorded');
      throw err;
    }

    // ---- Receive stock ----------------------------------------------------
    for (const [index, line] of lines.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await applyStockChange({
        businessId: ctx.businessId,
        productId: line.product,
        quantity: line.quantity,
        type: 'purchase',
        reason: `Purchase ${reference}${supplier ? ` from ${supplier.name}` : ''}`,
        reference: payload.reference || reference,
        relatedDocument: { type: 'Purchase', id: purchase._id, number: reference },
        unitCostMinor: line.unitCostMinor,
        performedBy: ctx.user._id,
        idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:line:${index}` : null,
        session,
        occurredAt: purchasedAt,
      });

      if (payload.updateCostPrice) {
        // eslint-disable-next-line no-await-in-loop
        await Product.updateOne(
          { _id: line.product, business: ctx.businessId },
          { $set: { sellingPriceMinor: line.suggestedSellingPriceMinor, updatedBy: ctx.user._id } },
          { session }
        );
      }
    }

    // ---- Payments to supplier --------------------------------------------
    const createdPayments = [];
    for (const [index, p] of payments.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const [payment] = await Payment.create(
        [
          {
            business: ctx.businessId,
            reference: `${reference}-P${index + 1}`,
            direction: 'outbound',
            purchase: purchase._id,
            supplier: supplier?._id ?? null,
            amountMinor: p.amountMinor,
            currency: money.currency,
            method: p.method,
            transactionReference: p.reference,
            paidAt: p.paidAt,
            status: 'valid',
            notes: p.note,
            idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:pay:${index}` : null,
            createdBy: ctx.user._id,
          },
        ],
        { session }
      );
      createdPayments.push(payment);

      // Paying a supplier is what actually cuts the cash/bank position. These
      // payments are created inline rather than through recordPurchasePayment,
      // so the ledger entry has to be written here too.
      // eslint-disable-next-line no-await-in-loop
      await recordForPayment({
        payment,
        direction: 'out',
        businessId: ctx.businessId,
        performedBy: ctx.user._id,
        session,
      });
    }

    if (supplier) {
      await Supplier.updateOne(
        { _id: supplier._id },
        {
          $inc: { totalPurchasedMinor: totalMinor, totalPaidMinor: paidMinor, purchaseCount: 1 },
          $set: { lastTransactionAt: purchasedAt },
        },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'purchase.create',
      entity: 'Purchase',
      entityId: purchase._id,
      amountMinor: totalMinor,
      currency: money.currency,
      changes: {
        reference,
        supplier: supplier?.name,
        lines: lines.length,
        unitsReceived: lines.reduce((s, l) => s + l.quantity, 0),
        netMinor: grossMinor,
        taxMinor,
        totalMinor,
        paidMinor,
        accountingNote: 'Capitalised into inventory; recognised as COGS when sold',
      },
      ip: ctx.ip,
    });

    return { purchase, payments: createdPayments, replayed: false };
  }, { label: 'createPurchase' });
}

/**
 * Return stock to a supplier who refunded us.
 *
 * Stock leaving the shelf is not, by itself, a money event. But when a supplier
 * takes goods back and hands the money over, it is — and before this existed that
 * cash simply vanished: the stock dropped, the money stayed gone, and the books
 * showed a purchase that had been paid in full for goods the business no longer
 * had.
 *
 * Where the refund lands depends on whether the money is already gone:
 *
 *   - Purchase still owed money  -> the refund cancels that debt. Nothing is
 *     paid out and nothing comes in, so no cash is invented.
 *   - Purchase already paid      -> the money comes back into Cash/Bank.
 *
 * Both parts happen in one transaction with the stock movement, so a half-finished
 * return is not possible.
 *
 * @param {object} ctx
 * @param {string} productId
 * @param {object} payload
 * @param {string} payload.supplier
 * @param {number} payload.quantity       units going back
 * @param {string} payload.refundAmount   money the supplier returned (major units)
 * @param {string} [payload.purchase]     the purchase being credited, if any
 * @param {string} [payload.reason]
 * @param {string} [payload.reference]    credit note number
 * @param {string} [payload.account]      where cash lands; defaults to cash
 */
export async function returnStockToSupplier(ctx, productId, payload) {
  const money = createMoneyContext(ctx.business);

  const quantity = Number(payload.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw AppError.badRequest('Enter how many units are going back', { fields: ['quantity'] });
  }

  const refundMinor = money.parse(payload.refundAmount);
  if (refundMinor < 0) throw AppError.badRequest('Enter the refund amount', { fields: ['refundAmount'] });

  const account = payload.account ?? 'cash';
  if (!MONEY_ACCOUNTS.includes(account)) {
    throw AppError.badRequest('Choose cash or bank for the refund', { fields: ['account'] });
  }

  return withTransaction(async ({ session }) => {
    const supplier = await Supplier.findOne({
      _id: payload.supplier,
      business: ctx.businessId,
      deletedAt: null,
    }).session(session);
    if (!supplier) throw AppError.notFound('Supplier not found');

    // --- Which purchase is being credited? ---------------------------------
    // A purchase is only usable as the counterpart if it is for this supplier
    // and actually covers this product, otherwise the refund would settle an
    // unrelated bill.
    let purchase = null;
    if (payload.purchase) {
      purchase = await Purchase.findOne({
        _id: payload.purchase,
        business: ctx.businessId,
        deletedAt: null,
        status: 'received',
      })
        .populate('supplier', 'name supplierCode')
        .session(session);
      if (!purchase) throw AppError.notFound('Purchase not found');
      if (String(purchase.supplier?._id ?? purchase.supplier) !== String(supplier._id)) {
        throw AppError.badRequest('That purchase belongs to a different supplier');
      }
      const covers = purchase.lines.some((l) => String(l.product) === String(productId));
      if (!covers) throw AppError.badRequest('That purchase does not include this product');
    }

    const outstanding = purchase ? purchase.totalMinor - purchase.paidMinor : 0;

    // Credit the debt first, then hand back any excess as real cash. This is
    // what stops a return against an unpaid bill from inventing money.
    const debtCredit = Math.max(0, Math.min(refundMinor, outstanding));
    const cashBack = refundMinor - debtCredit;

    // --- Goods go back ------------------------------------------------------
    // `relatedDocument.type` is constrained by the model's enum, so an unlinked
    // return is filed against the supplier as an Adjustment rather than
    // inventing a document type the schema does not know.
    const stockResult = await applyStockChange({
      businessId: ctx.businessId,
      productId,
      quantity,
      type: 'purchase_return',
      reason:
        payload.reason?.trim() ||
        `Returned to ${supplier.name}${payload.reference ? ` on ${payload.reference}` : ''}`,
      note: payload.note ?? '',
      reference: payload.reference ?? '',
      relatedDocument: {
        type: purchase ? 'Purchase' : 'Adjustment',
        id: purchase ? purchase._id : supplier._id,
        number: purchase ? purchase.reference : supplier.name.slice(0, 40),
      },
      performedBy: ctx.user._id,
      session,
      allowNegative: ctx.business?.settings?.allowNegativeStock ?? false,
      occurredAt: new Date(),
    });

    // --- Reduce the debt we owe, if there was one ---------------------------
    if (debtCredit > 0) {
      await Purchase.updateOne(
        { _id: purchase._id },
        {
          $inc: { totalMinor: -debtCredit, netMinor: -debtCredit, grossMinor: -debtCredit },
          $set: { updatedBy: ctx.user._id },
        },
        { session }
      );
    }

    // --- Money actually comes back ------------------------------------------
    // Same reasoning: `related.type` is an enum, so point at the purchase when
    // there is one and fall back to Manual otherwise.
    let movement = null;
    if (cashBack > 0) {
      movement = await recordMovement({
        businessId: ctx.businessId,
        account,
        direction: 'in',
        amountMinor: cashBack,
        kind: 'supplier_refund',
        reason: `Refund from ${supplier.name} for ${quantity} returned unit(s)`,
        related: {
          type: purchase ? 'Purchase' : 'Manual',
          id: purchase ? purchase._id : stockResult.movement._id,
          number: purchase ? purchase.reference : '',
        },
        performedBy: ctx.user._id,
        session,
      });
    }

    if (cashBack > 0) {
      await Supplier.updateOne(
        { _id: supplier._id },
        { $inc: { totalPaidMinor: cashBack }, $set: { lastTransactionAt: new Date() } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'purchase.return',
      entity: 'StockMovement',
      entityId: stockResult.movement._id,
      amountMinor: refundMinor,
      currency: money.currency,
      changes: {
        supplier: supplier.name,
        product: stockResult.product?.name,
        quantity,
        refundMinor,
        debtCreditMinor: debtCredit,
        cashBackMinor: cashBack,
        account: cashBack > 0 ? account : null,
        purchase: purchase?.reference ?? null,
        accountingNote: debtCredit > 0 ? 'Refund cancelled an owed amount' : 'Refund received into cash',
      },
      ip: ctx.ip,
    });

    return {
      movement: stockResult.movement,
      product: stockResult.product,
      moneyMovement: movement,
      debtCreditMinor: debtCredit,
      cashBackMinor: cashBack,
      purchase: purchase && debtCredit > 0 ? await Purchase.findById(purchase._id).session(session).lean() : null,
    };
  }, { label: 'returnStockToSupplier' });
}

export async function cancelPurchase(ctx, id, { reason, restock = false }) {
  return withTransaction(async ({ session }) => {
    const purchase = await Purchase.findOne({ _id: id, business: ctx.businessId, deletedAt: null }).session(session);
    if (!purchase) throw AppError.notFound('Purchase not found');
    if (purchase.status === 'cancelled') throw AppError.badRequest('Purchase is already cancelled');

    const outstanding = purchase.totalMinor - purchase.paidMinor;
    if (outstanding < 0) {
      throw AppError.badRequest('Settle this purchase before cancelling it');
    }
    if (purchase.paidMinor > 0) {
      throw AppError.badRequest('Refund the recorded supplier payments before cancelling this purchase');
    }

    if (restock) {
      await reverseMovements({
        businessId: ctx.businessId,
        relatedDocument: { type: 'Purchase', id: purchase._id },
        reason: `Cancellation of ${purchase.reference}: ${reason}`,
        performedBy: ctx.user._id,
        session,
        allowNegative: ctx.business?.settings?.allowNegativeStock ?? false,
        ip: ctx.ip,
      });
    }

    await Purchase.updateOne(
      { _id: purchase._id },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: ctx.user._id,
          cancellationReason: reason,
          updatedBy: ctx.user._id,
        },
      },
      { session }
    );

    if (purchase.supplier) {
      await Supplier.updateOne(
        { _id: purchase.supplier },
        { $inc: { totalPurchasedMinor: -purchase.totalMinor, purchaseCount: -1 } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'purchase.cancel',
      entity: 'Purchase',
      entityId: purchase._id,
      amountMinor: purchase.totalMinor,
      changes: { reference: purchase.reference, reason, restock },
      ip: ctx.ip,
    });

    return Purchase.findById(purchase._id).session(session).lean();
  }, { label: 'cancelPurchase' });
}

export { recordPurchasePayment };
