/**
 * Sale service -— checkout, cancellation and refunds.
 *
 * A sale touches at minimum: Product stock, StockMovement rows, Sale, Invoice,
 * Payment rows and Customer totals. Those writes are coordinated by
 * `withTransaction` so the set either lands completely or not at all.
 *
 * Guard rails:
 *   - Prices, costs and names are snapshotted from Product at checkout, so a
 *     later product edit can never rewrite a historical invoice.
 *   - The server decides the sale total. The client's arithmetic is ignored.
 *   - Discounts beyond the business cap are rejected, not silently trimmed.
 *   - Client-supplied product ids are re-resolved inside the business scope, so
 *     a forged id from another tenant yields "Product not found".
 *   - `idempotencyKey` makes a double-clicked checkout a replay, not a sale.
 */
import Sale from '../models/Sale.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Business from '../models/Business.js';
import { AppError } from '../utils/errors.js';
import { computeInvoiceTotals, computeLine, deriveInvoiceStatus } from '../../../shared/accounting.js';
import { createMoneyContext } from './money.context.js';
import { applyStockChange, reverseMovements } from './stock.service.js';
import { recordAudit } from './audit.service.js';
import { assertNotDuplicate, nextSequence, withTransaction } from './transaction.service.js';
import { recordForPayment, voidMoneyForPayment } from './money.service.js';

/* ------------------------------------------------------------- HELPERS -- */

/**
 * Resolve + price a requested cart. Returns fully-computed lines; the caller
 * never supplies trusted money values.
 */
async function priceCart({ businessId, lines, money, business, session }) {
  const settings = business.settings ?? {};
  const defaultTax = settings.taxEnabled ? (settings.taxRatePercent ?? 0) : 0;
  const maxDiscount = settings.maxDiscountPercent ?? 100;

  const productIds = [...new Set(lines.map((l) => String(l.product)))];
  const products = await Product.find({
    _id: { $in: productIds },
    business: businessId,
    deletedAt: null,
    archivedAt: null,
    isActive: true,
  }).session(session);

  const byId = new Map(products.map((p) => [String(p._id), p]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw AppError.notFound(`Product not found: ${missing.join(', ')}`);
  }

  // Merge duplicate lines for the same product so stock checks are correct.
  const merged = new Map();
  for (const line of lines) {
    const key = String(line.product);
    const prev = merged.get(key);
    if (prev) {
      merged.set(key, { ...prev, quantity: prev.quantity + Number(line.quantity) });
    } else {
      merged.set(key, { ...line });
    }
  }

  const computed = [];
  const usedQuantities = new Map();

  for (const line of merged.values()) {
    const product = byId.get(String(line.product));
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw AppError.badRequest(`Invalid quantity for "${product.name}"`, {
        fields: ['lines'],
      });
    }

    const unitPriceMinor =
      line.unitPrice !== undefined && line.unitPrice !== null && line.unitPrice !== ''
        ? money.parse(line.unitPrice)
        : product.sellingPriceMinor;
    if (unitPriceMinor < 0) {
      throw AppError.badRequest(`Invalid price for "${product.name}"`);
    }

    // Price tampering check: a user without a manager/admin role may not
    // override the catalogue price upward. Overrides are recorded, not hidden.
    const isBelowList = unitPriceMinor < product.sellingPriceMinor;
    const overridePercent =
      product.sellingPriceMinor > 0 && isBelowList
        ? Math.round(((product.sellingPriceMinor - unitPriceMinor) / product.sellingPriceMinor) * 10000) / 100
        : 0;
    if (overridePercent > maxDiscount) {
      throw AppError.forbidden(
        `A ${overridePercent}% discount on "${product.name}" exceeds the ${maxDiscount}% limit for your role`
      );
    }

    const discountPercent = Number(line.discountPercent ?? 0);
    if (discountPercent > maxDiscount) {
      throw AppError.forbidden(
        `Line discount of ${discountPercent}% on "${product.name}" exceeds the ${maxDiscount}% limit`
      );
    }

    let discountMinor = 0;
    if (line.discountAmount !== undefined && line.discountAmount !== null && line.discountAmount !== '') {
      discountMinor = money.parse(line.discountAmount);
      const impliedPercent =
        product.sellingPriceMinor > 0
          ? Math.round((discountMinor / (product.sellingPriceMinor * quantity)) * 10000) / 100
          : 0;
      if (impliedPercent > maxDiscount) {
        throw AppError.forbidden(
          `Line discount of ${impliedPercent}% on "${product.name}" exceeds the ${maxDiscount}% limit`
        );
      }
    }

    const taxPercent = line.taxPercent ?? defaultTax;

    const result = computeLine({
      unitPriceMinor,
      quantity,
      discountMinor,
      discountPercent: discountMinor ? 0 : discountPercent,
      taxPercent,
      taxInclusive: settings.taxInclusive,
      costMinor: product.averageCostMinor ?? product.costPriceMinor ?? 0,
    });

    computed.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      description: product.description ?? '',
      unit: product.unit,
      quantity: result.quantity,
      unitPriceMinor: result.unitPriceMinor,
      unitCostMinor: result.costMinor,
      discountPercent: result.discountPercent,
      discountMinor: result.discountMinor,
      taxPercent: result.taxPercent,
      grossMinor: result.grossMinor,
      netMinor: result.netMinor,
      taxMinor: result.taxMinor,
      totalMinor: result.totalMinor,
      lineCogsMinor: result.lineCogsMinor,
      lineProfitMinor: result.netMinor - result.lineCogsMinor,
      note: line.note ?? '',
      returnedQuantity: 0,
      _product: product,
    });

    usedQuantities.set(String(product._id), quantity);
  }

  return computed;
}

/** Invoice-level discount, validated against the business cap. */
function resolveInvoiceDiscount({ lines, discountPercent, discountAmount, money, business }) {
  const subtotal = lines.reduce((s, l) => s + l.netMinor + l.taxMinor, 0);
  const maxDiscount = business.settings?.maxDiscountPercent ?? 100;

  if (discountAmount !== undefined && discountAmount !== null && discountAmount !== '') {
    const minor = money.parse(discountAmount);
    if (minor < 0) throw AppError.badRequest('Invoice discount cannot be negative');
    if (minor > subtotal) throw AppError.badRequest('Invoice discount cannot exceed the subtotal');
    return { percent: 0, amountMinor: minor, reason: '' };
  }

  const percent = Number(discountPercent ?? 0);
  if (percent > 0 && percent > maxDiscount) {
    throw AppError.forbidden(`Invoice discount of ${percent}% exceeds the ${maxDiscount}% limit`);
  }
  if (percent === 0) return { percent: 0, amountMinor: 0, reason: '' };
  return { percent, amountMinor: 0, reason: '' };
}

/* ------------------------------------------------------------- CREATE --- */

/**
 * @param {object} ctx request tenancy context (business, user, business settings)
 * @param {object} payload validated createSaleSchema output
 */
export async function createSale(ctx, payload) {
  const { business, businessId, user } = ctx;
  const money = createMoneyContext(business);

  // Replay guard before doing any work.
  if (payload.idempotencyKey) {
    const existing = await Sale.findOne({ business: businessId, idempotencyKey: payload.idempotencyKey });
    if (existing) {
      const invoice = await Invoice.findOne({ sale: existing._id, business: businessId });
      return { sale: existing, invoice, replayed: true };
    }
  }

  return withTransaction(async ({ session }) => {
    const lines = await priceCart({
      businessId,
      lines: payload.lines,
      money,
      business,
      session,
    });

    const discount = resolveInvoiceDiscount({
      lines,
      discountPercent: payload.discountPercent,
      discountAmount: payload.discountAmount,
      money,
      business,
    });

    const totals = computeInvoiceTotals(
      lines.map((l) => ({
        grossMinor: l.grossMinor,
        discountMinor: l.discountMinor,
        netMinor: l.netMinor,
        taxMinor: l.taxMinor,
        lineCogsMinor: l.lineCogsMinor,
      })),
      { invoiceDiscountMinor: discount.amountMinor }
    );

    // ---- Validate the declared payment intent against the computed total ----
    const requestedPayments = (payload.payments ?? []).map((p) => ({
      amountMinor: money.parse(p.amount, 0),
      method: p.method,
      reference: p.reference ?? '',
      paidAt: p.paidAt ?? payload.soldAt ?? new Date(),
      note: p.note ?? '',
    }));

    for (const p of requestedPayments) {
      if (p.amountMinor <= 0) throw AppError.badRequest('Payment amounts must be greater than zero');
    }

    const paymentTotal = requestedPayments.reduce((s, p) => s + p.amountMinor, 0);

    if (payload.invoiceStatus === 'paid' && paymentTotal !== totals.totalMinor) {
      throw AppError.badRequest(
        `Payments total ${money.formatPlain(paymentTotal)} but the invoice total is ${money.formatPlain(totals.totalMinor)}`
      );
    }
    if (paymentTotal > totals.totalMinor) {
      throw AppError.badRequest('Payments cannot exceed the invoice total');
    }

    // ---- Customer resolution (walk-in supported) --------------------------
    const customer = await resolveCustomer({
      businessId,
      customerId: payload.customer,
      customerName: payload.customerName,
      userId: user._id,
      session,
    });

    const soldAt = payload.soldAt ?? new Date();
    const dueDays = business.settings?.invoiceDueDays ?? 0;

    // `dueDays === 0` means "due on receipt". Giving such an invoice a due date
    // equal to the sale timestamp would make it overdue a millisecond later,
    // which is nonsense. Only credit terms produce a real due date.
    const dueDate =
      payload.dueDate ??
      (dueDays > 0 && paymentTotal < totals.totalMinor
        ? new Date(soldAt.getTime() + dueDays * 86400000)
        : null);

    // ---- Sale -------------------------------------------------------------
    const { sequence, reference } = await nextSequence(businessId, 'invoice', { session });

    const documentLines = lines.map(({ _product, ...line }) => line);

    let sale;
    try {
      [sale] = await Sale.create(
        [
          {
            business: businessId,
            reference,
            customer: customer?._id ?? null,
            // The name typed at the counter wins. For a walk-in this is what belongs on
      // the invoice, even though every walk-in shares one bucket customer record.
      customerName: payload.customerName ?? customer?.name ?? 'Walk-in customer',
            customerPhone: customer?.phone ?? '',
            isWalkIn: customer?.isWalkIn ?? !customer,
            channel: payload.channel,
            status: 'completed',
            lines: documentLines,
            discount,
            currency: money.currency,
            grossMinor: totals.grossMinor,
            totalDiscountMinor: totals.totalDiscountMinor,
            netSalesMinor: totals.netSalesMinor,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            cogsMinor: totals.cogsMinor,
            grossProfitMinor: totals.profitMinor,
            refundedMinor: 0,
            paymentMethod: requestedPayments[0]?.method ?? payload.paymentMethod ?? 'cash',
            paidMinor: paymentTotal,
            note: payload.note ?? '',
            soldAt,
            idempotencyKey: payload.idempotencyKey ?? null,
            createdBy: user._id,
          },
        ],
        { session }
      );
    } catch (err) {
      assertNotDuplicate(err, 'This sale has already been recorded');
      throw err;
    }

    // ---- Stock: issue every line -----------------------------------------
    for (const [index, line] of lines.entries()) {
      const product = line._product;
      const available = product.isTrackable ? product.stockQuantity : 0;
      if (product.isTrackable && available < line.quantity) {
        throw new AppError(
          `Insufficient stock for "${product.name}". Available ${available}, requested ${line.quantity}.`,
          { status: 422, code: 'INSUFFICIENT_STOCK', details: { product: product.name, available, requested: line.quantity } }
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await applyStockChange({
        businessId,
        productId: product._id,
        quantity: -line.quantity,
        type: 'sale',
        reason: `Sale ${reference}`,
        reference,
        relatedDocument: { type: 'Sale', id: sale._id, number: reference },
        unitCostMinor: line.unitCostMinor,
        performedBy: user._id,
        idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:line:${index}` : null,
        session,
        allowNegative: business.settings?.allowNegativeStock ?? false,
        occurredAt: soldAt,
      });
    }

    // ---- Invoice ----------------------------------------------------------
    const invoiceStatus = deriveInvoiceStatus({
      totalMinor: totals.totalMinor,
      paidMinor: paymentTotal,
      dueDate,
    });

    let invoice;
    try {
      [invoice] = await Invoice.create(
        [
          {
            business: businessId,
            invoiceNumber: reference,
            sequence,
            sale: sale._id,
            customer: customer?._id ?? null,
            customerName: customer?.name ?? sale.customerName,
            customerPhone: customer?.phone ?? '',
            customerAddress: customer?.address ?? '',
            customerTaxNumber: '',
            businessSnapshot: {
              name: business.name,
              legalName: business.legalName ?? '',
              address: business.displayAddress ?? '',
              phone: business.phone ?? '',
              email: business.email ?? '',
              taxNumber: business.taxNumber ?? '',
              logoUrl: business.logoUrl ?? null,
            },
            lines: documentLines.map((l) => ({
              product: l.product,
              name: l.name,
              sku: l.sku,
              unit: l.unit,
              quantity: l.quantity,
              unitPriceMinor: l.unitPriceMinor,
              discountPercent: l.discountPercent,
              discountMinor: l.discountMinor,
              taxPercent: l.taxPercent,
              netMinor: l.netMinor,
              taxMinor: l.taxMinor,
              totalMinor: l.totalMinor,
              returnedQuantity: 0,
            })),
            currency: money.currency,
            currencySymbol: money.symbol,
            currencyDecimals: money.decimals,
            grossMinor: totals.grossMinor,
            totalDiscountMinor: totals.totalDiscountMinor,
            netSalesMinor: totals.netSalesMinor,
            taxLabel: business.settings?.taxLabel ?? 'VAT',
            taxPercent: business.settings?.taxRatePercent ?? 0,
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            paidMinor: paymentTotal,
            refundedMinor: 0,
            writtenOffMinor: 0,
            status: invoiceStatus,
            issuedAt: soldAt,
            dueDate,
            paidAt: paymentTotal >= totals.totalMinor ? soldAt : null,
            note: payload.note ?? business.settings?.invoiceNotes ?? '',
            terms: business.settings?.terms ?? '',
            footer: business.settings?.receiptFooter ?? '',
            createdBy: user._id,
          },
        ],
        { session }
      );
    } catch (err) {
      assertNotDuplicate(err, `Invoice ${reference} already exists`);
      throw err;
    }

    await Sale.updateOne({ _id: sale._id }, { $set: { invoice: invoice._id } }, { session });
    // Keep the returned document consistent with what was written, so the
    // client never receives `invoice: null` alongside a freshly issued invoice.
    sale.invoice = invoice._id;

    // ---- Payments ---------------------------------------------------------
    const payments = [];
    for (const [index, p] of requestedPayments.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const [payment] = await Payment.create(
        [
          {
            business: businessId,
            reference: `${reference}-P${index + 1}`,
            direction: 'inbound',
            invoice: invoice._id,
            sale: sale._id,
            customer: customer?._id ?? null,
            amountMinor: p.amountMinor,
            currency: money.currency,
            method: p.method,
            transactionReference: p.reference,
            paidAt: p.paidAt,
            status: 'valid',
            notes: p.note,
            idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:pay:${index}` : null,
            createdBy: user._id,
          },
        ],
        { session }
      );
      payments.push(payment);

      // Money has physically arrived, so it belongs in the cash/bank position.
      // These payments are created inline rather than through the invoice
      // payment path, so the ledger entry is written here.
      // eslint-disable-next-line no-await-in-loop
      await recordForPayment({
        payment,
        direction: 'in',
        businessId,
        performedBy: user._id,
        session,
      });
    }

    // ---- Customer lifetime counters ---------------------------------------
    if (customer) {
      await Customer.updateOne(
        { _id: customer._id, business: businessId },
        {
          $inc: {
            totalSalesMinor: totals.totalMinor,
            totalPaidMinor: paymentTotal,
            invoiceCount: 1,
          },
          $set: { lastTransactionAt: soldAt, lastVisitedAt: soldAt },
        },
        { session }
      );
    }

    await Business.updateOne({ _id: businessId }, { $inc: { 'stats.saleCount': 1 } }, { session });

    await recordAudit({
      business: businessId,
      actor: user,
      role: ctx.role,
      action: 'sale.create',
      entity: 'Sale',
      entityId: sale._id,
      amountMinor: totals.totalMinor,
      currency: money.currency,
      changes: {
        reference,
        invoice: invoice.invoiceNumber,
        customer: sale.customerName,
        items: lines.length,
        netSalesMinor: totals.netSalesMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        paidMinor: paymentTotal,
        cogsMinor: totals.cogsMinor,
        grossProfitMinor: totals.profitMinor,
        status: invoiceStatus,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { sale, invoice, payments, replayed: false };
  }, { label: 'createSale' });
}

/** Fetch a walk-in customer document, or a real customer, scoped to business. */
async function resolveCustomer({ businessId, customerId, customerName, userId, session }) {
  if (customerId) {
    const customer = await Customer.findOne({ _id: customerId, business: businessId, deletedAt: null }).session(session);
    if (!customer) throw AppError.notFound('Customer not found');
    if (!customer.isActive) throw AppError.badRequest(`${customer.name} is archived`);
    return customer;
  }
  if (!customerName) return null;

  // Walk-in sales share ONE bucket customer per business. That keeps lifetime
  // totals coherent without inventing a permanent customer record per name.
  //
  // The create is an atomic upsert rather than find-then-create: two tills
  // checking out simultaneously would otherwise both miss the lookup and the
  // second insert would fail on the unique customer-code index.
  const filter = {
    business: businessId,
    isWalkIn: true,
    customerCode: Customer.WALK_IN_CODE,
    deletedAt: null,
  };
  const definition = {
    ...filter,
    name: customerName,
    phone: '0000000000',
    notes: 'Auto-created from a walk-in checkout',
    createdBy: userId,
  };

  try {
    return await Customer.findOneAndUpdate(
      filter,
      { $setOnInsert: definition },
      { upsert: true, new: true, session, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // A concurrent upsert can still lose the race inside a transaction; the
    // row then exists, so reading it back is the correct resolution.
    if (err?.code !== 11000) throw err;
    const existing = await Customer.findOne(filter).session(session);
    if (!existing) throw err;
    return existing;
  }
}

/* ------------------------------------------------------------- READS ---- */

export async function listSales(ctx, query) {
  const { businessId } = ctx;
  const { page, limit, skip } = query;
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['soldAt', 'totalMinor', 'reference', 'createdAt', 'customerName'].includes(query.sort)
    ? query.sort
    : 'soldAt';
  const sort = { [sortField]: direction, _id: -1 };

  const filter = { business: businessId };
  if (query.status && query.status !== 'all') {
    if (['unpaid', 'partial', 'paid', 'overdue'].includes(query.status)) {
      // Settlement state is derived from amounts, exactly like the invoice.
      filter.$expr = {
        $eq: [
          {
            $switch: {
              branches: [
                { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' },
                {
                  case: { $and: [{ $gt: ['$totalMinor', 0] }, { $gte: ['$paidMinor', '$totalMinor'] }] },
                  then: 'paid',
                },
                { case: { $gt: ['$paidMinor', 0] }, then: 'partial' },
                { case: { $eq: ['$paidMinor', 0] }, then: 'unpaid' },
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
  if (query.customer) filter.customer = query.customer;
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.from || query.to) {
    filter.soldAt = {};
    if (query.from) filter.soldAt.$gte = query.from;
    if (query.to) filter.soldAt.$lte = query.to;
  }
  if (query.minTotal !== undefined || query.maxTotal !== undefined) {
    filter.totalMinor = {};
    const money = createMoneyContext(ctx.business);
    if (query.minTotal !== undefined) filter.totalMinor.$gte = money.parse(query.minTotal);
    if (query.maxTotal !== undefined) filter.totalMinor.$lte = money.parse(query.maxTotal);
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ reference: rx }, { customerName: rx }, { 'lines.name': rx }, { 'lines.sku': rx }];
  }

  const [items, total] = await Promise.all([
    Sale.find(filter)
      .populate('customer', 'name customerCode phone isWalkIn')
      .populate('invoice', 'invoiceNumber status dueDate paidMinor refundedMinor writtenOffMinor')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Sale.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

export async function getSale(ctx, id) {
  const sale = await Sale.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .populate('customer', 'name customerCode phone email address isWalkIn creditLimitMinor')
    .populate('createdBy', 'name')
    .populate('cancelledBy', 'name')
    .lean({ virtuals: true });

  if (!sale) throw AppError.notFound('Sale not found');

  const [invoice, payments] = await Promise.all([
    Invoice.findOne({ sale: sale._id, business: ctx.businessId }).lean({ virtuals: true }),
    Payment.find({ sale: sale._id, business: ctx.businessId, status: 'valid' })
      .populate('createdBy', 'name')
      .sort({ paidAt: 1 })
      .lean(),
  ]);

  return { ...sale, invoice, payments };
}

/* -------------------------------------------------------------- UPDATE -- */

export async function updateSale(ctx, id, payload) {
  const sale = await Sale.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!sale) throw AppError.notFound('Sale not found');
  if (sale.status === 'cancelled') throw AppError.badRequest('A cancelled sale cannot be edited');

  const update = {};
  if (payload.reference !== undefined) update.reference = payload.reference;
  if (payload.note !== undefined) update.note = payload.note;
  if (payload.dueDate !== undefined) {
    update.dueDate = payload.dueDate;
    if (sale.invoice) {
      await Invoice.updateOne(
        { _id: sale.invoice, business: ctx.businessId },
        {
          $set: {
            dueDate: payload.dueDate,
            status: deriveInvoiceStatus({
              totalMinor: sale.totalMinor,
              paidMinor: sale.paidMinor,
              dueDate: payload.dueDate,
            }),
          },
        }
      );
    }
  }
  update.updatedBy = ctx.user._id;

  sale.set(update);
  await sale.save();

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'update',
    entity: 'Sale',
    entityId: sale._id,
    changes: update,
    ip: ctx.ip,
  });

  return sale;
}

/* ------------------------------------------------------------- CANCEL --- */

/**
 * Cancels a sale: reverses stock, voids its payments and cancels the invoice.
 * Money already collected must be refunded separately -— this never invents a
 * refund implicitly, but it does block the cancel while money is outstanding.
 */
export async function cancelSale(ctx, id, { reason, restock = true, restockReason }) {
  return withTransaction(async ({ session }) => {
    const sale = await Sale.findOne({ _id: id, business: ctx.businessId, deletedAt: null }).session(session);
    if (!sale) throw AppError.notFound('Sale not found');
    if (sale.status === 'cancelled') throw AppError.badRequest('Sale is already cancelled');

    const payments = await Payment.find({ sale: sale._id, business: ctx.businessId, status: 'valid' }).session(session);
    const collected = payments.reduce((s, p) => s + (p.amountMinor - p.refundedMinor), 0);
    if (collected > 0) {
      throw new AppError(
        `This sale has ${money(ctx).format(collected)} still collected. Refund it before cancelling.`,
        { status: 422, code: 'PAYMENTS_PRESENT' }
      );
    }

    if (restock) {
      await reverseMovements({
        businessId: ctx.businessId,
        relatedDocument: { type: 'Sale', id: sale._id },
        reason: restockReason || `Cancellation of ${sale.reference}: ${reason}`,
        performedBy: ctx.user._id,
        session,
        allowNegative: ctx.business?.settings?.allowNegativeStock ?? false,
        ip: ctx.ip,
      });
    }

    await Sale.updateOne(
      { _id: sale._id },
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

    // A cancelled sale never happened, so the money its payments created must
    // be unwound or the balance would keep money that was never received.
    for (const payment of await Payment.find({ sale: sale._id, status: 'valid' }).session(session)) {
      // eslint-disable-next-line no-await-in-loop
      await voidMoneyForPayment({
        payment,
        businessId: ctx.businessId,
        reason: `Sale ${sale.reference} cancelled: ${reason}`,
        performedBy: ctx.user._id,
        session,
      });
    }

    if (sale.invoice) {
      await Invoice.updateOne(
        { _id: sale.invoice, business: ctx.businessId },
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
    }

    await Payment.updateMany(
      { sale: sale._id, business: ctx.businessId, status: 'valid' },
      { $set: { status: 'voided', voidedAt: new Date(), voidedBy: ctx.user._id, voidReason: reason } },
      { session }
    );

    if (sale.customer) {
      await Customer.updateOne(
        { _id: sale.customer, business: ctx.businessId },
        { $inc: { totalSalesMinor: -sale.totalMinor, invoiceCount: -1 }, $set: { updatedBy: ctx.user._id } },
        { session }
      );
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'sale.cancel',
      entity: 'Sale',
      entityId: sale._id,
      amountMinor: sale.totalMinor,
      changes: { reference: sale.reference, reason, restock },
      ip: ctx.ip,
    });

    // Read inside the transaction's session, otherwise the find would miss the
    // uncommitted update and report the pre-cancel state.
    const updated = await Sale.findById(sale._id).session(session).lean();
    return updated;
  }, { label: 'cancelSale' });
}

function money(ctx) {
  return createMoneyContext(ctx.business);
}

/* -------------------------------------------------------------- REFUND -- */

/**
 * Records a refund (money out) with optional restock.
 * Refunds are contra-revenue: they reduce net sales in the P&L rather than
 * creating a negative "expense".
 */
export async function refundSale(ctx, saleId, payload) {
  const moneyCtx = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    const sale = await Sale.findOne({ _id: saleId, business: ctx.businessId, deletedAt: null }).session(session);
    if (!sale) throw AppError.notFound('Sale not found');
    if (sale.status === 'cancelled') throw AppError.badRequest('A cancelled sale cannot be refunded');

    const alreadyRefunded = sale.refundedMinor ?? 0;
    const refundAmountMinor = moneyCtx.parse(payload.amount, 0);
    if (refundAmountMinor <= 0) throw AppError.badRequest('Refund amount must be greater than zero');
    if (alreadyRefunded + refundAmountMinor > sale.totalMinor) {
      throw AppError.badRequest(
        `Refund of ${moneyCtx.format(refundAmountMinor)} exceeds the remaining refundable balance of ${moneyCtx.format(sale.totalMinor - alreadyRefunded)}`
      );
    }

    // Refund payments newest-first so the money trail is intact.
    const payments = await Payment.find({
      sale: sale._id,
      business: ctx.businessId,
      status: 'valid',
    })
      .sort({ paidAt: -1 })
      .session(session);

    const collected = payments.reduce((s, p) => s + (p.amountMinor - p.refundedMinor), 0);
    if (refundAmountMinor > collected) {
      throw new AppError(
        `Cannot refund ${moneyCtx.format(refundAmountMinor)} -— only ${moneyCtx.format(collected)} was collected`,
        { status: 422, code: 'REFUND_EXCEEDS_COLLECTED' }
      );
    }

    let remaining = refundAmountMinor;
    const reversedLines = [];
    for (const p of payments) {
      if (remaining <= 0) break;
      const refundable = p.amountMinor - p.refundedMinor;
      if (refundable <= 0) continue;
      const portion = Math.min(refundable, remaining);
      // eslint-disable-next-line no-await-in-loop
      await Payment.updateOne(
        { _id: p._id },
        { $inc: { refundedMinor: portion }, $set: { updatedBy: ctx.user._id } },
        { session }
      );
      remaining -= portion;
      reversedLines.push({ payment: p._id, amountMinor: portion });
    }

    // ---- Restock: reverse quantities, proportionally per line -------------
    if (payload.restock && Array.isArray(payload.lines) && payload.lines.length) {
      for (const requested of payload.lines) {
        const line = sale.lines[requested.line];
        if (!line) throw AppError.badRequest(`Sale line ${requested.line} does not exist`);
        const alreadyReturned = line.returnedQuantity ?? 0;
        const maxReturnable = line.quantity - alreadyReturned;
        if (requested.quantity > maxReturnable) {
          throw AppError.badRequest(
            `Only ${maxReturnable} of "${line.name}" can still be returned`
          );
        }
        // eslint-disable-next-line no-await-in-loop
        await Sale.updateOne(
          { _id: sale._id },
          { $inc: { [`lines.${requested.line}.returnedQuantity`]: requested.quantity } },
          { session }
        );
        // eslint-disable-next-line no-await-in-loop
        await applyStockChange({
          businessId: ctx.businessId,
          productId: line.product,
          quantity: requested.quantity,
          type: 'sale_return',
          reason: payload.restockReason || `Refund of ${sale.reference}`,
          reference: sale.reference,
          relatedDocument: { type: 'Refund', id: sale._id, number: sale.reference },
          unitCostMinor: line.unitCostMinor,
          performedBy: ctx.user._id,
          idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:restock:${requested.line}` : null,
          session,
          allowNegative: ctx.business?.settings?.allowNegativeStock ?? false,
        });
      }
    }

    // ---- Money out -------------------------------------------------------
    const [outboundPayment] = await Payment.create(
      [
        {
          business: ctx.businessId,
          reference: `${sale.reference}-R${Date.now().toString(36).toUpperCase().slice(-5)}`,
          direction: 'outbound',
          invoice: sale.invoice ?? null,
          sale: sale._id,
          customer: sale.customer ?? null,
          amountMinor: refundAmountMinor,
          currency: moneyCtx.currency,
          method: payload.method ?? 'cash',
          transactionReference: payload.reference ?? '',
          paidAt: new Date(),
          status: 'valid',
          notes: payload.reason,
          idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey}:refund` : null,
          createdBy: ctx.user._id,
        },
      ],
      { session }
    );

    await Sale.updateOne(
      { _id: sale._id },
      { $inc: { refundedMinor: refundAmountMinor }, $set: { updatedBy: ctx.user._id } },
      { session }
    );

    // A refund hands money back, so it leaves the cash/bank position.
    await recordForPayment({
      payment: outboundPayment,
      direction: 'out',
      businessId: ctx.businessId,
      performedBy: ctx.user._id,
      session,
    });

    if (sale.customer) {
      await Customer.updateOne(
        { _id: sale.customer, business: ctx.businessId },
        { $inc: { totalRefundedMinor: refundAmountMinor }, $set: { updatedBy: ctx.user._id } },
        { session }
      );
    }

    if (sale.invoice) {
      const invoice = await Invoice.findById(sale.invoice).session(session);
      if (invoice) {
        const refunded = (invoice.refundedMinor ?? 0) + refundAmountMinor;
        const status = deriveInvoiceStatus({
          totalMinor: invoice.totalMinor,
          paidMinor: invoice.paidMinor,
          status: invoice.status,
          dueDate: invoice.dueDate,
        });
        await Invoice.updateOne(
          { _id: invoice._id },
          { $set: { refundedMinor: refunded, status, updatedBy: ctx.user._id } },
          { session }
        );
      }
    }

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'sale.refund',
      entity: 'Sale',
      entityId: sale._id,
      amountMinor: refundAmountMinor,
      currency: moneyCtx.currency,
      changes: {
        reference: sale.reference,
        reason: payload.reason,
        method: payload.method,
        restock: payload.restock,
        payments: reversedLines,
        refundPayment: outboundPayment.reference,
      },
      ip: ctx.ip,
    });

    return { payment: outboundPayment, refundAmountMinor };
  }, { label: 'refundSale' });
}

export { priceCart, resolveCustomer };
