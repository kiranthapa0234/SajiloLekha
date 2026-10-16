import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as paymentService from '../services/payment.service.js';
import { createMoneyContext } from '../services/money.context.js';

export const list = asyncHandler(async (req, res) => {
  const result = await paymentService.listPayments(req.ctx, req.validated.query);
  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    summary: result.summary,
  });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await paymentService.getPayment(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const result = await paymentService.recordPayment(req.ctx, req.validated.body);
  return sendCreated(res, result, { message: 'Payment recorded' });
});

export const voidPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.voidPayment(req.ctx, req.params.id, req.validated.body.reason);
  return sendOk(res, result, { message: 'Payment voided' });
});

export const reconcile = asyncHandler(async (req, res) => {
  return sendOk(res, await paymentService.reconcilePayment(req.ctx, req.params.id, req.body ?? {}));
});

export const methods = asyncHandler(async (req, res) => {
  const m = createMoneyContext(req.ctx.business);
  const breakdown = await paymentService.paymentMethodBreakdown(req.ctx, {
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
  });
  return sendOk(res, {
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    totalMinor: breakdown.reduce((s, p) => s + p.totalMinor, 0),
    items: breakdown,
  });
});

export { create as record };
