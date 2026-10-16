import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as purchaseService from '../services/purchase.service.js';
import * as paymentService from '../services/payment.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await purchaseService.listPurchases(req.ctx, req.validated.query);
  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    summary: result.summary,
  });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await purchaseService.getPurchase(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const result = await purchaseService.createPurchase(req.ctx, req.validated.body);
  return sendCreated(res, result, { message: 'Purchase received — stock updated' });
});

export const cancel = asyncHandler(async (req, res) => {
  return sendOk(
    res,
    await purchaseService.cancelPurchase(req.ctx, req.params.id, {
      reason: req.body?.reason ?? 'No reason supplied',
      restock: req.body?.restock ?? false,
    }),
    { message: 'Purchase cancelled' }
  );
});

export const addPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.recordPurchasePayment(req.ctx, {
    purchaseId: req.params.id,
    ...req.validated.body,
  });
  return sendCreated(res, result, { message: 'Supplier payment recorded' });
});

export const returnToSupplier = asyncHandler(async (req, res) => {
  const { product, ...rest } = req.validated.body;
  const result = await purchaseService.returnStockToSupplier(req.ctx, product, rest);

  // Say which of the two things actually happened. A refund against a bill that
  // is still owed cancels the debt and moves no cash, and an operator who just
  // expected money in their till deserves to be told why it did not arrive.
  const message =
    result.cashBackMinor > 0
      ? 'Stock returned and the refund is back in your account'
      : result.debtCreditMinor > 0
        ? 'Stock returned — the amount owed to this supplier went down'
        : 'Stock returned';

  return sendCreated(res, result, { message });
});
