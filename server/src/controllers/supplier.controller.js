import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as supplierService from '../services/supplier.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await supplierService.listSuppliers(req.ctx, req.validated.query);
  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    summary: result.summary,
  });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await supplierService.getSupplier(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  return sendCreated(res, await supplierService.createSupplier(req.ctx, req.validated.body));
});

export const update = asyncHandler(async (req, res) => {
  return sendOk(res, await supplierService.updateSupplier(req.ctx, req.params.id, req.validated.body));
});

export const archive = asyncHandler(async (req, res) => {
  return sendOk(res, await supplierService.setSupplierArchived(req.ctx, req.params.id, true, req.body?.reason));
});

export const restore = asyncHandler(async (req, res) => {
  return sendOk(res, await supplierService.setSupplierArchived(req.ctx, req.params.id, false, req.body?.reason));
});

export const ledger = asyncHandler(async (req, res) => {
  return sendOk(
    res,
    await supplierService.supplierLedger(req.ctx, req.params.id, {
      from: req.query.from ? new Date(req.query.from) : undefined,
      to: req.query.to ? new Date(req.query.to) : undefined,
    })
  );
});
