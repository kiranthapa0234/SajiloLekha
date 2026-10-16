import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as saleService from '../services/sale.service.js';
import * as paymentService from '../services/payment.service.js';
import { createMoneyContext } from '../services/money.context.js';

export const list = asyncHandler(async (req, res) => {
  const result = await saleService.listSales(req.ctx, req.validated.query);
  return sendOk(res, result.items, { page: result.page, limit: result.limit, total: result.total });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await saleService.getSale(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const { sale, invoice, replayed } = await saleService.createSale(req.ctx, req.validated.body);
  return sendCreated(res, { sale, invoice, replayed }, { message: replayed ? 'Sale already recorded' : undefined });
});

export const update = asyncHandler(async (req, res) => {
  return sendOk(res, await saleService.updateSale(req.ctx, req.params.id, req.validated.body));
});

export const cancel = asyncHandler(async (req, res) => {
  return sendOk(res, await saleService.cancelSale(req.ctx, req.params.id, req.validated.body), {
    message: 'Sale cancelled and stock reversed',
  });
});

export const refund = asyncHandler(async (req, res) => {
  return sendCreated(res, await saleService.refundSale(req.ctx, req.params.id, req.validated.body), {
    message: 'Refund recorded',
  });
});

export const addPayment = asyncHandler(async (req, res) => {
  const sale = await saleService.getSale(req.ctx, req.params.id);
  if (!sale.invoice) throw new Error('This sale has no invoice to pay');
  const result = await paymentService.recordInvoicePayment(req.ctx, {
    invoiceId: sale.invoice._id,
    ...req.validated.body,
  });
  return sendCreated(res, result, { message: 'Payment recorded' });
});

/**
 * Price a cart without committing it. Pure preview so the checkout screen can
 * show totals that exactly match what the server will charge.
 */
export const quote = asyncHandler(async (req, res) => {
  const money = createMoneyContext(req.ctx.business);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];

  const priced = await saleService.priceCart({
    businessId: req.ctx.businessId,
    lines,
    money,
    business: req.ctx.business,
    session: null,
  });

  const grossMinor = priced.reduce((s, l) => s + l.grossMinor, 0);
  const netSalesMinor = priced.reduce((s, l) => s + l.netMinor, 0);
  const taxMinor = priced.reduce((s, l) => s + l.taxMinor, 0);
  const cogsMinor = priced.reduce((s, l) => s + l.lineCogsMinor, 0);

  return sendOk(res, {
    currency: { code: money.currency, symbol: money.symbol, decimals: money.decimals },
    lines: priced.map(({ _product, ...line }) => ({
      ...line,
      product: line.product,
      available: _product?.stockQuantity ?? 0,
      stockStatus: _product?.stockStatus ?? 'unknown',
    })),
    totals: {
      grossMinor,
      totalDiscountMinor: grossMinor - netSalesMinor - taxMinor,
      netSalesMinor,
      taxMinor,
      totalMinor: netSalesMinor + taxMinor,
      cogsMinor,
      grossProfitMinor: netSalesMinor - cogsMinor,
      items: priced.reduce((s, l) => s + l.quantity, 0),
    },
  });
});
