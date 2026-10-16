/**
 * Payment service -— the authoritative record of money in and out.
 *
 * Invariants
 *   - A payment only counts once it is persisted here. The frontend's opinion is
 *     irrelevant; every controller calls this service and returns its result.
 *   - Valid payments against an invoice may never exceed the invoice's
 *     outstanding balance. There is no "overpayment" escape hatch: a cashier who
 *     takes too much must reduce the amount or raise a credit note.
 *   - Voiding is the only correction. Amounts and methods are immutable so the
 *     audit trail stays provable.
 *   - Customer and supplier lifetime totals move in the same transaction.
 */
import Payment from '../models/Payment.js';
import Invoice from '../models/Invoice.js';
import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import { AppError } from '../utils/errors.js';
import { deriveInvoiceStatus } from '../../../shared/accounting.js';
import { createMoneyContext } from './money.context.js';
import { recordAudit } from './audit.service.js';
import { recordForPayment, voidMoneyForPayment } from './money.service.js';
import { nextSequence, withTransaction } from './transaction.service.js';

/**
 * Record an inbound customer payment against an invoice.
 * Supports partial payments and many payments against one invoice.
 */
export async function recordInvoicePayment(ctx, { invoiceId, amount, method, paidAt, transactionReference, notes, idempotencyKey }) {
  const money = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    if (idempotencyKey) {
      const replay = await Payment.findOne({ business: ctx.businessId, idempotencyKey }).session(session);
      if (replay) return { payment: replay, replayed: true, invoice: null };
    }

    const invoice = await Invoice.findOne({ _id: invoiceId, business: ctx.businessId, deletedAt: null }).session(session);
    if (!invoice) throw AppError.notFound('Invoice not found');
    if (invoice.status === 'cancelled') throw AppError.badRequest('This invoice has been cancelled');

    const amountMinor = money.parse(amount, 0);
    if (amountMinor <= 0) throw AppError.badRequest('Payment amount must be greater than zero');

    const outstanding = invoice.totalMinor - invoice.paidMinor - (invoice.writtenOffMinor ?? 0);
    if (outstanding <= 0) {
      throw new AppError(`Invoice ${invoice.invoiceNumber} is already fully paid`, {
        status: 422,
        code: 'ALREADY_PAID',
      });
    }
    if (amountMinor > outstanding) {
      throw new AppError(
        `Payment of ${money.format(amountMinor)} exceeds the outstanding balance of ${money.format(outstanding)}`,
        { status: 422, code: 'OVERPAYMENT_BLOCKED', details: { outstandingMinor: outstanding, attemptedMinor: amountMinor } }
      );
    }

    const { reference } = await nextSequence(ctx.businessId, 'receipt', { session });

    const [payment] = await Payment.create(
      [
        {
          business: ctx.businessId,
          reference,
          direction: 'inbound',
          invoice: invoice._id,
          sale: invoice.sale,
          customer: invoice.customer,
          amountMinor,
          currency: money.currency,
          method,
          transactionReference: transactionReference ?? '',
          paidAt: paidAt ?? new Date(),
          status: 'valid',
          notes: notes ?? '',
          idempotencyKey: idempotencyKey ?? null,
          createdBy: ctx.user._id,
        },
      ],
      { session }
    );

    const paidMinor = invoice.paidMinor + amountMinor;
    const status = deriveInvoiceStatus({
      totalMinor: invoice.totalMinor,
      paidMinor,
      status: invoice.status,
      dueDate: invoice.dueDate,
    });

    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { paidMinor, status, paidAt: status === 'paid' ? (invoice.paidAt ?? new Date()) : null, updatedBy: ctx.user._id } },
      { session }
    );

    if (invoice.sale) {
      await Sale.updateOne({ _id: invoice.sale }, { $inc: { paidMinor: amountMinor }, $set: { updatedBy: ctx.user._id } }, { session });
    }

    if (invoice.customer) {
      await Customer.updateOne(
        { _id: invoice.customer, business: ctx.businessId },
        { $inc: { totalPaidMinor: amountMinor }, $set: { lastTransactionAt: payment.paidAt } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'payment.create',
      entity: 'Payment',
      entityId: payment._id,
      amountMinor,
      currency: money.currency,
      changes: {
        reference,
        invoice: invoice.invoiceNumber,
        customer: invoice.customerName,
        method,
        paidMinorBefore: invoice.paidMinor,
        paidMinorAfter: paidMinor,
        invoiceStatus: status,
      },
      ip: ctx.ip,
    });

    // Money has physically arrived, so it belongs in the cash/bank position.
    // A credit sale never reaches here, so nothing is double counted.
    await recordForPayment({
      payment,
      direction: 'in',
      businessId: ctx.businessId,
      performedBy: ctx.user._id,
      session,
    });

    return { payment, invoice: { ...invoice.toObject(), paidMinor, status }, replayed: false };
  }, { label: 'recordInvoicePayment' });
}

/**
 * Record a standalone payment, optionally linked to an open invoice.
 * Used by the Payments screen for ad-hoc receipts and credit sales.
 */
export async function recordPayment(ctx, payload) {
  const money = createMoneyContext(ctx.business);

  // Settling an invoice or a sale goes through the invoice path, which enforces
  // the outstanding-balance rule and updates every dependent total.
  if (payload.sale) {
    const sale = await Sale.findOne({ _id: payload.sale, business: ctx.businessId, deletedAt: null });
    if (!sale) throw AppError.notFound('Sale not found');
    if (!sale.invoice) throw AppError.badRequest('This sale does not have an invoice to pay');
    return recordInvoicePayment(ctx, { ...payload, invoiceId: sale.invoice });
  }

  if (payload.invoice) {
    return recordInvoicePayment(ctx, { ...payload, invoiceId: payload.invoice });
  }

  return withTransaction(async ({ session }) => {
    if (payload.idempotencyKey) {
      const replay = await Payment.findOne({
        business: ctx.businessId,
        idempotencyKey: payload.idempotencyKey,
      }).session(session);
      if (replay) return { payment: replay, replayed: true };
    }

    const amountMinor = money.parse(payload.amount, 0);
    if (amountMinor <= 0) throw AppError.badRequest('Payment amount must be greater than zero');

    let customer = null;
    if (payload.customer) {
      customer = await Customer.findOne({ _id: payload.customer, business: ctx.businessId, deletedAt: null }).session(session);
      if (!customer) throw AppError.notFound('Customer not found');
    }

    const { reference } = await nextSequence(ctx.businessId, 'receipt', { session });

    const [payment] = await Payment.create(
      [
        {
          business: ctx.businessId,
          reference,
          direction: 'inbound',
          customer: customer?._id ?? null,
          amountMinor,
          currency: money.currency,
          method: payload.method,
          transactionReference: payload.transactionReference ?? '',
          paidAt: payload.paidAt ?? new Date(),
          status: 'valid',
          notes: payload.notes ?? '',
          idempotencyKey: payload.idempotencyKey ?? null,
          createdBy: ctx.user._id,
        },
      ],
      { session }
    );

    if (customer) {
      await Customer.updateOne(
        { _id: customer._id },
        { $inc: { totalPaidMinor: amountMinor }, $set: { lastTransactionAt: payment.paidAt } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'payment.create',
      entity: 'Payment',
      entityId: payment._id,
      amountMinor,
      currency: money.currency,
      changes: { reference, customer: customer?.name, method: payload.method, standalone: true },
      ip: ctx.ip,
    });

    await recordForPayment({
      payment,
      direction: 'in',
      businessId: ctx.businessId,
      performedBy: ctx.user._id,
      session,
    });

    return { payment, replayed: false };
  }, { label: 'recordPayment' });
}

/** Outbound payment to a supplier against a purchase. */
export async function recordPurchasePayment(ctx, { purchaseId, amount, method, paidAt, transactionReference, notes }) {
  const money = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    const purchase = await Purchase.findOne({ _id: purchaseId, business: ctx.businessId, deletedAt: null }).session(session);
    if (!purchase) throw AppError.notFound('Purchase not found');
    if (purchase.status === 'cancelled') throw AppError.badRequest('This purchase has been cancelled');

    const amountMinor = money.parse(amount, 0);
    if (amountMinor <= 0) throw AppError.badRequest('Payment amount must be greater than zero');

    const outstanding = purchase.totalMinor - purchase.paidMinor;
    if (outstanding <= 0) throw new AppError('This purchase is already fully paid', { status: 422, code: 'ALREADY_PAID' });
    if (amountMinor > outstanding) {
      throw new AppError(
        `Payment of ${money.format(amountMinor)} exceeds the outstanding balance of ${money.format(outstanding)}`,
        { status: 422, code: 'OVERPAYMENT_BLOCKED' }
      );
    }

    const { reference } = await nextSequence(ctx.businessId, 'receipt', { session });

    const [payment] = await Payment.create(
      [
        {
          business: ctx.businessId,
          reference,
          direction: 'outbound',
          purchase: purchase._id,
          supplier: purchase.supplier,
          amountMinor,
          currency: money.currency,
          method,
          transactionReference: transactionReference ?? '',
          paidAt: paidAt ?? new Date(),
          status: 'valid',
          notes: notes ?? '',
          createdBy: ctx.user._id,
        },
      ],
      { session }
    );

    await Purchase.updateOne(
      { _id: purchase._id },
      { $inc: { paidMinor: amountMinor }, $set: { updatedBy: ctx.user._id } },
      { session }
    );

    if (purchase.supplier) {
      await Supplier.updateOne(
        { _id: purchase.supplier, business: ctx.businessId },
        { $inc: { totalPaidMinor: amountMinor }, $set: { lastTransactionAt: payment.paidAt } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'payment.create',
      entity: 'Payment',
      entityId: payment._id,
      amountMinor,
      currency: money.currency,
      changes: { reference, direction: 'outbound', purchase: purchase.reference, supplier: purchase.supplierName },
      ip: ctx.ip,
    });

    // Paying a supplier is what actually cuts the balance.
    await recordForPayment({
      payment,
      direction: 'out',
      businessId: ctx.businessId,
      performedBy: ctx.user._id,
      session,
    });

    // Return the purchase as it now stands, so the caller can tell the operator
    // what is still owed without a second round trip.
    const updated = await Purchase.findById(purchase._id)
      .session(session)
      .lean({ virtuals: true });

    return {
      payment,
      purchase: { ...updated, outstandingMinor: Math.max(0, updated.totalMinor - updated.paidMinor) },
    };
  }, { label: 'recordPurchasePayment' });
}

/**
 * Void a payment and unwind its effect on the invoice and customer totals.
 * The payment row is retained with status `voided` -— never deleted.
 */
export async function voidPayment(ctx, paymentId, reason) {
  const money = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    const payment = await Payment.findOne({ _id: paymentId, business: ctx.businessId, deletedAt: null }).session(session);
    if (!payment) throw AppError.notFound('Payment not found');
    if (payment.status === 'voided') throw AppError.badRequest('This payment is already voided');

    const effective = payment.amountMinor - payment.refundedMinor;

    if (payment.invoice) {
      const invoice = await Invoice.findById(payment.invoice).session(session);
      if (invoice) {
        const paidMinor = Math.max(0, invoice.paidMinor - payment.amountMinor);
        const status = deriveInvoiceStatus({
          totalMinor: invoice.totalMinor,
          paidMinor,
          status: invoice.status === 'cancelled' ? 'cancelled' : undefined,
          dueDate: invoice.dueDate,
        });
        await Invoice.updateOne(
          { _id: invoice._id },
          { $set: { paidMinor, status, paidAt: status === 'paid' ? invoice.paidAt : null, updatedBy: ctx.user._id } },
          { session }
        );

        if (invoice.sale) {
          await Sale.updateOne(
            { _id: invoice.sale },
            { $inc: { paidMinor: -payment.amountMinor }, $set: { updatedBy: ctx.user._id } },
            { session }
          );
        }
        if (invoice.customer) {
          await Customer.updateOne(
            { _id: invoice.customer },
            { $inc: { totalPaidMinor: -payment.amountMinor } },
            { session }
          );
        }
      }
    }

    if (payment.purchase) {
      await Purchase.updateOne({ _id: payment.purchase }, { $inc: { paidMinor: -payment.amountMinor } }, { session });
      if (payment.supplier) {
        await Supplier.updateOne({ _id: payment.supplier }, { $inc: { totalPaidMinor: -payment.amountMinor } }, { session });
      }
    }

    if (payment.customer && !payment.invoice) {
      await Customer.updateOne({ _id: payment.customer }, { $inc: { totalPaidMinor: -payment.amountMinor } }, { session });
    }

    await Payment.updateOne(
      { _id: payment._id },
      { $set: { status: 'voided', voidedAt: new Date(), voidedBy: ctx.user._id, voidReason: reason, updatedBy: ctx.user._id } },
      { session }
    );

    // A voided payment never happened, so the money position it created must
    // be unwound too -- otherwise voiding would quietly leave the balance wrong.
    await voidMoneyForPayment({
      payment,
      businessId: ctx.businessId,
      reason,
      performedBy: ctx.user._id,
      session,
    });

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'payment.void',
      entity: 'Payment',
      entityId: payment._id,
      amountMinor: effective,
      currency: money.currency,
      changes: { reference: payment.reference, reason, method: payment.method },
      ip: ctx.ip,
    });

    return { payment, voidedMinor: effective };
  }, { label: 'voidPayment' });
}

/* -------------------------------------------------------------- QUERIES -- */

export async function listPayments(ctx, query) {
  const { page, limit, skip } = query;
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['paidAt', 'amountMinor', 'reference', 'createdAt', 'method'].includes(query.sort)
    ? query.sort
    : 'paidAt';

  const filter = { business: ctx.businessId };
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.method) filter.method = query.method;
  if (query.customer) filter.customer = query.customer;
  if (query.direction && query.direction !== 'all') filter.direction = query.direction;
  if (query.from || query.to) {
    filter.paidAt = {};
    if (query.from) filter.paidAt.$gte = query.from;
    if (query.to) filter.paidAt.$lte = query.to;
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { reference: rx },
      { transactionReference: rx },
      { notes: rx },
      { 'invoice.invoiceNumber': rx },
      { 'customer.name': rx },
    ];
  }

  const [items, total, summaryRows] = await Promise.all([
    Payment.find(filter)
      .populate('customer', 'name customerCode phone')
      .populate('supplier', 'name supplierCode')
      .populate('invoice', 'invoiceNumber status totalMinor paidMinor dueDate')
      .populate('createdBy', 'name')
      .sort({ [sortField]: direction, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
    Payment.aggregate([
      { $match: { business: ctx.business._id, status: 'valid', ...(query.from || query.to ? { paidAt: buildDateFilter(query) } : {}) } },
      {
        $group: {
          _id: '$direction',
          totalMinor: { $sum: '$amountMinor' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const summary = { inboundMinor: 0, outboundMinor: 0, inboundCount: 0, outboundCount: 0 };
  for (const row of summaryRows) {
    if (row._id === 'inbound') {
      summary.inboundMinor = row.totalMinor;
      summary.inboundCount = row.count;
    } else {
      summary.outboundMinor = row.totalMinor;
      summary.outboundCount = row.count;
    }
  }
  summary.netMinor = summary.inboundMinor - summary.outboundMinor;

  return { items, total, page, limit, summary };
}

function buildDateFilter(query) {
  const dateFilter = {};
  if (query.from) dateFilter.$gte = query.from;
  if (query.to) dateFilter.$lte = query.to;
  return dateFilter;
}

/** Payment methods split used by the dashboard doughnut chart. */
export async function paymentMethodBreakdown(ctx, { from, to } = {}) {
  return Payment.aggregate([
    {
      $match: {
        business: ctx.business._id,
        status: 'valid',
        direction: 'inbound',
        ...(from || to ? { paidAt: buildDateFilter({ from, to }) } : {}),
      },
    },
    {
      $group: {
        _id: '$method',
        totalMinor: { $sum: '$amountMinor' },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalMinor: -1 } },
    {
      $project: {
        _id: 0,
        method: '$_id',
        totalMinor: 1,
        count: 1,
      },
    },
  ]);
}

export async function getPayment(ctx, id) {
  const payment = await Payment.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .populate('customer', 'name customerCode phone email')
    .populate('invoice', 'invoiceNumber totalMinor paidMinor status dueDate')
    .populate('purchase', 'reference totalMinor paidMinor')
    .populate('supplier', 'name supplierCode')
    .populate('createdBy', 'name')
    .lean();
  if (!payment) throw AppError.notFound('Payment not found');
  return payment;
}

/** Reconcile a payment against a bank statement line. */
export async function reconcilePayment(ctx, paymentId, { status, bankReference, note }) {
  const payment = await Payment.findOne({ _id: paymentId, business: ctx.businessId, deletedAt: null });
  if (!payment) throw AppError.notFound('Payment not found');
  if (payment.status !== 'valid') throw AppError.badRequest('Only valid payments can be reconciled');

  payment.reconciliation = {
    status,
    reconciledAt: status === 'unreconciled' ? null : new Date(),
    reconciledBy: ctx.user._id,
    bankReference: bankReference ?? payment.reconciliation?.bankReference ?? '',
    note: note ?? '',
  };
  payment.updatedBy = ctx.user._id;
  await payment.save();

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'update',
    entity: 'Payment',
    entityId: payment._id,
    changes: { reconciliation: payment.reconciliation },
    ip: ctx.ip,
  });

  return payment;
}

export default {
  recordInvoicePayment,
  recordPayment,
  recordPurchasePayment,
  voidPayment,
  listPayments,
  getPayment,
  reconcilePayment,
  paymentMethodBreakdown,
};
