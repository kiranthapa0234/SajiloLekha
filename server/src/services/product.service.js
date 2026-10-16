/**
 * Product (inventory item) service.
 *
 * Stock is never written here directly -— opening stock and any manual correction
 * go through the stock service so a ledger row always exists.
 */
import Product from '../models/Product.js';
import ProductCategory from '../models/ProductCategory.js';
import StockMovement from '../models/StockMovement.js';import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { createMoneyContext } from './money.context.js';
import { applyStockChange } from './stock.service.js';
import { recordAudit } from './audit.service.js';
import { assertNotDuplicate, withTransaction } from './transaction.service.js';
import { escapeRegex } from '../../../shared/validators/primitives.js';

/* ----------------------------------------------------------- CATEGORIES -- */

export async function listCategories(ctx) {
  return ProductCategory.find({ business: ctx.businessId, deletedAt: null, archivedAt: null })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
}

export async function createCategory(ctx, payload) {
  try {
    const [category] = await ProductCategory.create([
      { ...payload, business: ctx.businessId, createdBy: ctx.user._id },
    ]);
    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'create',
      entity: 'ProductCategory',
      entityId: category._id,
      changes: { name: category.name },
      ip: ctx.ip,
    });
    return category;
  } catch (err) {
    assertNotDuplicate(err, 'A category with this name already exists');
    throw err;
  }
}

export async function updateCategory(ctx, id, payload) {
  const category = await ProductCategory.findOneAndUpdate(
    { _id: id, business: ctx.businessId, deletedAt: null },
    { $set: { ...payload, updatedBy: ctx.user._id } },
    { new: true, runValidators: true }
  );
  if (!category) throw AppError.notFound('Category not found');

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: 'update',
    entity: 'ProductCategory',
    entityId: category._id,
    changes: payload,
    ip: ctx.ip,
  });
  return category;
}

export async function archiveCategory(ctx, id, archived = true) {
  const category = await ProductCategory.findOneAndUpdate(
    { _id: id, business: ctx.businessId, deletedAt: null },
    { $set: { archivedAt: archived ? new Date() : null, updatedBy: ctx.user._id } },
    { new: true }
  );
  if (!category) throw AppError.notFound('Category not found');

  if (archived) {
    await Product.updateMany(
      { category: id, business: ctx.businessId, deletedAt: null },
      { $set: { category: null, updatedBy: ctx.user._id } }
    );
  }
  return category;
}

/* ------------------------------------------------------------- PRODUCTS -- */

export async function listProducts(ctx, query) {
  const { page, limit, skip } = query;
  const m = createMoneyContext(ctx.business);
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['name', 'sku', 'stockQuantity', 'sellingPriceMinor', 'costPriceMinor', 'createdAt', 'updatedAt'].includes(query.sort)
    ? query.sort
    : 'createdAt';

  const filter = { business: ctx.businessId, deletedAt: null };
  if (!query.includeArchived) filter.archivedAt = null;
  if (query.category) filter.category = query.category;
  if (query.supplier) filter.supplier = query.supplier;
  if (query.status === 'active') filter.isActive = true;
  if (query.status === 'archived') filter.archivedAt = { $ne: null };

  const status = query.stockStatus ?? (query.status !== 'all' && ['in_stock', 'low_stock', 'out_of_stock'].includes(query.status) ? query.status : null);
  if (status === 'in_stock') filter.stockQuantity = { $gt: 0 };
  if (status === 'out_of_stock') filter.stockQuantity = { $lte: 0 };
  if (status === 'low_stock') {
    filter.$expr = { $and: [{ $gt: ['$stockQuantity', 0] }, { $lte: ['$stockQuantity', '$minStockLevel'] }] };
  }

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$and = [
      ...(filter.$and ?? []),
      { $or: [{ name: rx }, { sku: rx }, { barcode: rx }, { description: rx }] },
    ];
  }

  const [items, total, aggregate] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name color')
      .populate('supplier', 'name supplierCode')
      .sort({ [sortField]: direction, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Product.countDocuments(filter),
    Product.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(ctx.businessId)), deletedAt: null, archivedAt: null } },
      {
        $group: {
          _id: null,
          costValueMinor: {
            $sum: { $multiply: [{ $ifNull: ['$stockQuantity', 0] }, { $ifNull: [{ $ifNull: ['$averageCostMinor', '$costPriceMinor'] }, 0] }] },
          },
          retailValueMinor: { $sum: { $multiply: [{ $ifNull: ['$stockQuantity', 0] }, { $ifNull: ['$sellingPriceMinor', 0] }] } },
          totalUnits: { $sum: { $ifNull: ['$stockQuantity', 0] } },
          lowStock: { $sum: { $cond: [{ $and: [{ $gt: ['$stockQuantity', 0] }, { $lte: ['$stockQuantity', '$minStockLevel'] }] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const summary = aggregate[0] ?? { costValueMinor: 0, retailValueMinor: 0, totalUnits: 0, lowStock: 0, outOfStock: 0 };

  return {
    items: items.map((p) => ({
      ...p,
      costPrice: m.toDecimal(p.costPriceMinor),
      sellingPrice: m.toDecimal(p.sellingPriceMinor),
      stockValue: m.toDecimal(p.stockValueMinor),
    })),
    total,
    page,
    limit,
    summary: {
      ...summary,
      potentialProfitMinor: summary.retailValueMinor - summary.costValueMinor,
    },
  };
}

export async function getProduct(ctx, id) {
  const product = await Product.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .populate('category', 'name color')
    .populate('supplier', 'name supplierCode phone')
    .lean({ virtuals: true });
  if (!product) throw AppError.notFound('Product not found');

  const recentMovements = await StockMovement.find({ business: ctx.businessId, product: id, deletedAt: null })
    .sort({ occurredAt: -1 })
    .limit(15)
    .populate('performedBy', 'name')
    .lean();

  return { ...product, recentMovements };
}

export async function createProduct(ctx, payload) {
  const m = createMoneyContext(ctx.business);
  const openingQuantity = Number(payload.stockQuantity ?? 0);

  return withTransaction(async ({ session }) => {
    if (payload.category) {
      const categoryExists = await ProductCategory.exists({
        _id: payload.category,
        business: ctx.businessId,
        deletedAt: null,
      }).session(session);
      if (!categoryExists) throw AppError.notFound('Category not found');
    }
    if (payload.supplier) {
      const supplierExists = await mongoose.model('Supplier').exists({
        _id: payload.supplier,
        business: ctx.businessId,
        deletedAt: null,
      }).session(session);
      if (!supplierExists) throw AppError.notFound('Supplier not found');
    }

    const costMinor = m.parse(payload.costPrice);
    const sellingMinor = m.parse(payload.sellingPrice);
    if (sellingMinor < costMinor) {
      // Allowed, but worth surfacing: many retailers do run below cost.
      // We keep it and let the UI show a loss-making badge.
    }

    let product;
    try {
      [product] = await Product.create(
        [
          {
            business: ctx.businessId,
            name: payload.name,
            sku: payload.sku.toUpperCase(),
            barcode: payload.barcode || '',
            category: payload.category ?? null,
            supplier: payload.supplier ?? null,
            description: payload.description ?? '',
            unit: payload.unit ?? 'pcs',
            imageUrl: payload.imageUrl ?? null,
            costPriceMinor: costMinor,
            sellingPriceMinor: sellingMinor,
            averageCostMinor: costMinor,
            taxPercent: payload.taxPercent ?? 0,
            stockQuantity: 0,
            minStockLevel: Number(payload.minStockLevel ?? 0),
            maxStockLevel: payload.maxStockLevel === undefined ? null : Number(payload.maxStockLevel),
            isTrackable: payload.isTrackable ?? true,
            isActive: payload.isActive ?? true,
            createdBy: ctx.user._id,
          },
        ],
        { session }
      );
    } catch (err) {
      assertNotDuplicate(err, 'A product with this SKU or barcode already exists');
      throw err;
    }

    if (openingQuantity > 0) {
      await applyStockChange({
        businessId: ctx.businessId,
        productId: product._id,
        quantity: openingQuantity,
        type: 'opening',
        reason: payload.openingStockReason || 'Opening stock',
        relatedDocument: { type: 'Product', id: product._id, number: product.sku },
        unitCostMinor: costMinor,
        performedBy: ctx.user._id,
        session,
        allowNegative: ctx.business?.settings?.allowNegativeStock ?? false,
      });
    }

    await mongoose.model('Business').updateOne(
      { _id: ctx.businessId },
      { $inc: { 'stats.productCount': 1 } },
      { session }
    );

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'create',
      entity: 'Product',
      entityId: product._id,
      amountMinor: sellingMinor,
      changes: {
        name: product.name,
        sku: product.sku,
        openingStock: openingQuantity,
        costPrice: m.toDecimal(costMinor),
        sellingPrice: m.toDecimal(sellingMinor),
      },
      ip: ctx.ip,
    });

    // Re-read inside the transaction's session. Without `.session()` the query
    // runs on the primary outside the transaction and cannot see the insert
    // that has not committed yet, so it returns null.
    const fresh = await Product.findById(product._id)
      .session(session)
      .lean({ virtuals: true });
    return fresh;
  }, { label: 'createProduct' });
}

export async function updateProduct(ctx, id, payload) {
  const m = createMoneyContext(ctx.business);
  const product = await Product.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!product) throw AppError.notFound('Product not found');

  const before = {
    name: product.name,
    sku: product.sku,
    sellingPriceMinor: product.sellingPriceMinor,
    costPriceMinor: product.costPriceMinor,
  };

  const set = {};
  const scalarFields = ['name', 'description', 'unit', 'taxPercent', 'minStockLevel', 'maxStockLevel', 'isTrackable', 'isActive', 'imageUrl'];
  for (const f of scalarFields) if (payload[f] !== undefined) set[f] = payload[f];
  if (payload.sku !== undefined) set.sku = payload.sku.toUpperCase();
  if (payload.barcode !== undefined) set.barcode = payload.barcode || '';
  if (payload.category !== undefined) set.category = payload.category ?? null;
  if (payload.supplier !== undefined) set.supplier = payload.supplier ?? null;
  if (payload.costPrice !== undefined) {
    set.costPriceMinor = m.parse(payload.costPrice);
    if (!product.stockQuantity) set.averageCostMinor = set.costPriceMinor;
  }
  if (payload.sellingPrice !== undefined) set.sellingPriceMinor = m.parse(payload.sellingPrice);
  set.updatedBy = ctx.user._id;

  // NOTE: stockQuantity is deliberately absent -— stock moves only via StockMovement.
  try {
    const updated = await Product.findOneAndUpdate(
      { _id: id, business: ctx.businessId, deletedAt: null },
      { $set: set },
      { new: true, runValidators: true }
    );
    if (!updated) throw AppError.notFound('Product not found');
    if (!updated) throw AppError.notFound('Product not found');

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'update',
      entity: 'Product',
      entityId: id,
      changes: { before, after: { name: updated.name, sku: updated.sku, sellingPriceMinor: updated.sellingPriceMinor, costPriceMinor: updated.costPriceMinor } },
      ip: ctx.ip,
    });

    return updated;
  } catch (err) {
    assertNotDuplicate(err, 'A product with this SKU or barcode already exists');
    throw err;
  }
}

export async function setProductArchived(ctx, id, archived, reason) {
  const product = await Product.findOne({ _id: id, business: ctx.businessId, deletedAt: null });
  if (!product) throw AppError.notFound('Product not found');

  if (archived && product.stockQuantity > 0) {
    const hasHistory = await mongoose.model('Sale').exists({
      business: ctx.businessId,
      status: 'completed',
      'lines.product': id,
    });
    if (!hasHistory) {
      throw AppError.badRequest('Only products with zero stock and no sales history can be archived');
    }
  }

  product.archivedAt = archived ? new Date() : null;
  product.isActive = !archived;
  product.updatedBy = ctx.user._id;
  await product.save();

  await recordAudit({
    business: ctx.businessId,
    actor: ctx.user,
    role: ctx.role,
    action: archived ? 'archive' : 'restore',
    entity: 'Product',
    entityId: id,
    changes: { reason, archived, stockQuantity: product.stockQuantity },
    ip: ctx.ip,
  });
  return product;
}

/** Lookup helpers used by the checkout product picker (autocomplete). */
export async function searchProductsForSale(ctx, term, limit = 12) {
  const filter = {
    business: ctx.businessId,
    deletedAt: null,
    archivedAt: null,
    isActive: true,
  };
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }
  return Product.find(filter).sort({ name: 1 }).limit(limit).lean({ virtuals: true });
}

/** Stock alerts feed (dashboard + inventory badge). */
export async function stockAlerts(ctx, limit = 20) {
  return Product.find({
    business: ctx.businessId,
    deletedAt: null,
    archivedAt: null,
    isActive: true,
    isTrackable: true,
    $expr: { $lte: ['$stockQuantity', '$minStockLevel'] },
  })
    .sort({ stockQuantity: 1 })
    .limit(limit)
    .populate('category', 'name color')
    .lean({ virtuals: true });
}

export default {
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  setProductArchived,
  searchProductsForSale,
  stockAlerts,
};
