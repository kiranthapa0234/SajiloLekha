import { AppError, asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as productService from '../services/product.service.js';
import * as stockService from '../services/stock.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await productService.listProducts(req.ctx, req.validated.query);
  return sendOk(res, result.items, { page: result.page, limit: result.limit, total: result.total, summary: result.summary });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.getProduct(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  return sendCreated(res, await productService.createProduct(req.ctx, req.validated.body));
});

export const update = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.updateProduct(req.ctx, req.params.id, req.validated.body));
});

export const archive = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.setProductArchived(req.ctx, req.params.id, true, req.body?.reason));
});

export const restore = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.setProductArchived(req.ctx, req.params.id, false, req.body?.reason));
});

export const search = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.searchProductsForSale(req.ctx, req.query.q, Number(req.query.limit) || 12));
});

export const alerts = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.stockAlerts(req.ctx, Number(req.query.limit) || 20));
});

/* ------------------------------------------------------------ CATEGORIES -- */

export const listCategories = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.listCategories(req.ctx));
});

export const createCategory = asyncHandler(async (req, res) => {
  return sendCreated(res, await productService.createCategory(req.ctx, req.validated.body));
});

export const updateCategory = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.updateCategory(req.ctx, req.params.id, req.validated.body));
});

export const archiveCategory = asyncHandler(async (req, res) => {
  return sendOk(res, await productService.archiveCategory(req.ctx, req.params.id, req.body?.archived !== false));
});

/* ---------------------------------------------------------------- STOCK -- */

export const adjustStock = asyncHandler(async (req, res) => {
  // Two routes reach here: `POST /products/:id/stock` carries the id in the
  // path, `POST /stock/adjust` carries it in the body. Reading only the path
  // parameter made the body form look up `undefined` and 404 with a
  // misleading "Product not found".
  const productId = req.params.id ?? req.validated.body.product;
  if (!productId) {
    throw AppError.badRequest('A product id is required', { fields: ['product'] });
  }

  const result = await stockService.adjustStock({
    ...req.validated.body,
    productId,
    businessId: req.ctx.businessId,
    performedBy: req.user._id,
    role: req.ctx.role,
    allowNegative: req.ctx.business?.settings?.allowNegativeStock ?? false,
    ip: req.ip,
  });
  return sendCreated(res, {
    movement: result.movement,
    product: result.product,
    replayed: result.replayed,
  });
});

export const bulkAdjustStock = asyncHandler(async (req, res) => {
  const results = await stockService.bulkAdjust({
    businessId: req.ctx.businessId,
    items: req.validated.body.items,
    performedBy: req.user._id,
    role: req.ctx.role,
    allowNegative: req.ctx.business?.settings?.allowNegativeStock ?? false,
    ip: req.ip,
  });
  return sendCreated(res, { adjusted: results.length, results: results.map((r) => r.movement) });
});

export const movementHistory = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;
  const filter = { deletedAt: null };
  if (req.validated.query.product) filter.product = req.validated.query.product;
  if (req.validated.query.type) filter.type = req.validated.query.type;
  if (req.validated.query.from || req.validated.query.to) {
    filter.occurredAt = {};
    if (req.validated.query.from) filter.occurredAt.$gte = req.validated.query.from;
    if (req.validated.query.to) filter.occurredAt.$lte = req.validated.query.to;
  }

  const result = await stockService.movementHistory(req.ctx.businessId, filter, {
    page,
    limit,
    sort: req.validated.query.sort,
    order: req.validated.query.order,
  });

  return sendOk(res, result.items, { page, limit, total: result.total });
});
