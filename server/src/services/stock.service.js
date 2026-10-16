/**
 * Stock service — the only place `Product.stockQuantity` is ever mutated.
 *
 * Rules enforced here:
 *   1. Every change writes a StockMovement row (append-only audit ledger).
 *   2. Every change carries a reason and a causing document.
 *   3. Quantities may never go negative unless the business opts in.
 *   4. Discrete units must receive whole quantities.
 *   5. The product update uses an optimistic-concurrency predicate
 *      (`stockVersion`) so a concurrent writer is rejected, not silently lost.
 *   6. The product is always re-read inside the caller's session/transaction so
 *      the movement records the true before/after figures.
 */
import mongoose from 'mongoose';
import Product, { DISCRETE_UNITS } from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { AppError } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import { assertNotDuplicate } from './transaction.service.js';

/** Direction implied by a movement type. */
const DIRECTION = {
  opening: +1,
  purchase: +1,
  purchase_return: -1,
  sale: -1,
  sale_return: +1,
  adjustment_in: +1,
  adjustment_out: -1,
  damage: -1,
  transfer: 0, // caller supplies an explicit signed quantity
  recount: 0,
};

const INBOUND = new Set(['opening', 'purchase', 'sale_return', 'adjustment_in']);

/**
 * Reject a negative magnitude on the operator-facing entry point.
 *
 * Direction comes from the movement type, not from the sign of the number, and
 * `Math.abs()` inside `applyStockChange` would quietly turn a typed `-9` on an
 * "Adjustment (+)" into `+9` -- recording the exact opposite of what the
 * operator asked for. Failing loudly is the only safe option.
 *
 * This deliberately lives in `adjustStock` and not in `applyStockChange`:
 * internal callers such as the sale and refund paths pass an explicit signed
 * quantity (`-line.quantity`) and rely on that.
 */
function assertOperatorQuantity(quantity, type) {
  if (Number(quantity) >= 0) return;
  const fix =
    type === 'recount'
      ? 'A counted figure cannot be negative.'
      : 'Use a positive number and choose "Adjustment (−)" or "Damaged" to reduce stock.';
  throw AppError.badRequest(`${fix} Direction is taken from the movement type, not the sign.`, {
    fields: ['quantity'],
  });
}

/**
 * Apply one stock change.
 *
 * `quantity` may be signed for internal callers; the direction for
 * operator-initiated adjustments is enforced in `adjustStock`.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.productId
 * @param {number} params.quantity          signed change, or a positive magnitude
 * @param {string} params.type              STOCK_MOVEMENT_TYPES value
 * @param {string} params.reason            mandatory
 * @param {object} params.relatedDocument   { type, id, number }
 * @param {number} [params.unitCostMinor]
 * @param {string} [params.performedBy]
 * @param {string} [params.idempotencyKey]
 * @param {import('mongoose').ClientSession|null} [params.session]
 * @param {boolean} [params.allowNegative]
 * @param {Date} [params.occurredAt]
 */
export async function applyStockChange(params) {
  const {
    businessId,
    productId,
    quantity,
    type,
    reason,
    note = '',
    reference = '',
    relatedDocument,
    unitCostMinor,
    performedBy,
    idempotencyKey,
    session = null,
    allowNegative = false,
    occurredAt = new Date(),
    reverses = null,
  } = params;

  if (!Number.isFinite(quantity) || Number(quantity) === 0) {
    throw AppError.badRequest('Stock quantity must be a non-zero number', { fields: ['quantity'] });
  }
  if (!reason || String(reason).trim().length < 3) {
    throw AppError.badRequest('A reason is required for every stock change', { fields: ['reason'] });
  }
  if (!relatedDocument?.type || !relatedDocument?.id) {
    throw AppError.badRequest('A stock change must reference its source document');
  }

  // Replay guard: an identical logical operation must not double-apply.
  if (idempotencyKey) {
    const existing = await StockMovement.findOne({ business: businessId, idempotencyKey })
      .session(session)
      .lean();
    if (existing) return { movement: existing, product: null, replayed: true };
  }

  const product = await Product.findOne({
    _id: productId,
    business: businessId,
    deletedAt: null,
  })
    .session(session);

  if (!product) throw AppError.notFound('Product not found');
  if (!product.isTrackable && !INBOUND.has(type)) {
    throw AppError.badRequest(`"${product.name}" is not stock-tracked`);
  }

  const magnitude = Math.abs(Number(quantity));
  let signed = DIRECTION[type] === 0 ? Number(quantity) : DIRECTION[type] * magnitude;
  signed = Math.trunc(signed);

  const before = product.stockQuantity ?? 0;
  const after = before + signed;

  if (after < 0 && !allowNegative) {
    throw new AppError(
      `Insufficient stock for "${product.name}". Available ${before}, requested ${magnitude}.`,
      { status: 422, code: 'INSUFFICIENT_STOCK', details: { productId, available: before, requested: magnitude } }
    );
  }

  if (DISCRETE_UNITS.has(product.unit) && !Number.isInteger(signed)) {
    throw AppError.badRequest(`"${product.name}" is measured in whole ${product.unit}`);
  }

  const cost = Number.isFinite(unitCostMinor) ? Math.trunc(unitCostMinor) : (product.averageCostMinor ?? product.costPriceMinor ?? 0);
  const valueMinor = Math.abs(signed) * cost;

  // Optimistic concurrency: only mutate if the version we read is still current.
  const update = {
    $set: { stockQuantity: after },
    $inc: { stockVersion: 1 },
  };

  // Receiving stock refreshes the weighted-average cost.
  if (type === 'purchase' || type === 'opening') {
    const currentQty = before;
    const currentCost = product.averageCostMinor ?? product.costPriceMinor ?? 0;
    const newQty = after;
    const newCost =
      newQty > 0
        ? Math.round((currentQty * currentCost + magnitude * cost) / newQty)
        : cost;
    update.$set.averageCostMinor = Math.max(0, newCost);
    update.$set.costPriceMinor = Math.max(0, newCost);
  }

  const updated = await Product.findOneAndUpdate(
    { _id: product._id, business: businessId, stockVersion: product.stockVersion },
    update,
    {
      new: true,
      session,
      // Carried out-of-band so the schema guard can read the authorisation
      // without it leaking into the update document as an unknown operator.
      allowNegativeStock: allowNegative === true,
    }
  );

  if (!updated) {
    throw new AppError('Stock was modified by someone else. Reload and try again.', {
      status: 409,
      code: 'STOCK_VERSION_CONFLICT',
      details: { productId },
    });
  }

  let movement;
  try {
    [movement] = await StockMovement.create(
      [
        {
          business: businessId,
          product: product._id,
          quantity: signed,
          quantityBefore: before,
          quantityAfter: after,
          type,
          unitCostMinor: cost,
          valueMinor,
          reason,
          note,
          reference,
          relatedDocument: {
            type: relatedDocument.type,
            id: relatedDocument.id,
            number: relatedDocument.number ?? '',
          },
          occurredAt,
          performedBy,
          stockVersionAfter: updated.stockVersion,
          idempotencyKey: idempotencyKey ?? null,
          reverses: reverses ?? null,
          createdBy: performedBy,
        },
      ],
      { session }
    );
  } catch (err) {
    assertNotDuplicate(err, 'This stock movement has already been recorded');
    throw err;
  }

  return { movement, product: updated, replayed: false };
}

/**
 * Manual adjustment from the Inventory screen. Always requires a reason.
 * `recount` sets stock to an absolute counted figure (signed delta computed).
 */
export async function adjustStock(params) {
  const { businessId, productId, type, quantity, reason, note, reference, performedBy, session, allowNegative, costPrice } = params;

  const product = await Product.findOne({ _id: productId, business: businessId, deletedAt: null }).session(session);
  if (!product) throw AppError.notFound('Product not found');

  assertOperatorQuantity(quantity, type);

  let delta = Number(quantity);

  if (type === 'recount') {
    // `quantity` is the counted on-hand figure, not a delta.
    const counted = Number(quantity);
    if (counted < 0 && !allowNegative) {
      throw AppError.badRequest('Counted stock cannot be negative');
    }
    delta = counted - (product.stockQuantity ?? 0);
    if (delta === 0) {
      throw AppError.badRequest('Counted quantity matches the current stock — no adjustment needed');
    }
  }

  const result = await applyStockChange({
    businessId,
    productId,
    quantity: delta,
    type,
    reason,
    note,
    reference,
    relatedDocument: { type: 'Adjustment', id: product._id, number: product.sku },
    unitCostMinor: costPrice !== undefined ? Math.trunc(costPrice) : product.averageCostMinor ?? product.costPriceMinor,
    performedBy,
    idempotencyKey: params.idempotencyKey,
    session,
    allowNegative: allowNegative ?? false,
  });

  await recordAudit({
    business: businessId,
    actor: { _id: performedBy },
    role: params.role,
    action: delta > 0 ? 'stock.receive' : 'stock.issue',
    entity: 'StockMovement',
    entityId: result.movement._id,
    amountMinor: Math.abs(result.movement.valueMinor),
    changes: {
      product: product.name,
      sku: product.sku,
      type,
      quantity: delta,
      before: result.movement.quantityBefore,
      after: result.movement.quantityAfter,
      reason,
    },
    ip: params.ip,
  });

  return result;
}

/** Apply several adjustments in one call (bulk adjust screen). */
export async function bulkAdjust({ businessId, items, performedBy, role, allowNegative, session }) {
  const results = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const r = await adjustStock({
      businessId,
      productId: item.product,
      type: item.type,
      quantity: item.quantity,
      reason: item.reason,
      note: item.note,
      reference: item.reference,
      performedBy,
      role,
      allowNegative,
      session,
    });
    results.push(r);
  }
  return results;
}

/** Reverse every movement belonging to a document (sale cancellation). */
export async function reverseMovements({ businessId, relatedDocument, reason, performedBy, session, allowNegative, ip }) {
  const movements = await StockMovement.find({
    business: businessId,
    'relatedDocument.type': relatedDocument.type,
    'relatedDocument.id': relatedDocument.id,
  }).session(session);

  const results = [];
  for (const movement of movements) {
    if (movement.reverses) continue; // already reversed
    // eslint-disable-next-line no-await-in-loop
    const r = await applyStockChange({
      businessId,
      productId: movement.product,
      quantity: -movement.quantity,
      // Pick the reversal type from the SIGN of the original movement:
      // stock that left must come back (inbound), stock that arrived must go
      // back out (outbound). Getting this backwards silently deletes inventory.
      type: movement.quantity < 0 ? 'sale_return' : 'purchase_return',
      reason,
      note: `Reversal of ${movement.type}`,
      reference: movement.reference,
      relatedDocument: { type: 'Adjustment', id: movement.product, number: movement.reference },
      unitCostMinor: movement.unitCostMinor,
      performedBy,
      session,
      allowNegative,
      reverses: movement._id,
    });
    // eslint-disable-next-line no-await-in-loop
    await StockMovement.updateOne(
      { _id: movement._id },
      { $set: { reverses: r.movement._id } },
      { session }
    );
    results.push(r);
  }

  await recordAudit({
    business: businessId,
    actor: { _id: performedBy },
    action: 'stock.adjust',
    entity: 'StockMovement',
    changes: { reversed: movements.length, reason, source: relatedDocument },
    ip,
  });

  return results;
}

/** Current stock value for the whole catalogue, computed in one aggregation. */
export async function inventoryValuation(businessId, { category } = {}) {
  const match = { business: new mongoose.Types.ObjectId(String(businessId)), deletedAt: null };
  if (category) match.category = category;

  return Product.aggregate([
    { $match: match },
    {
      $project: {
        name: 1,
        sku: 1,
        unit: 1,
        stockQuantity: 1,
        averageCostMinor: { $ifNull: ['$averageCostMinor', '$costPriceMinor'] },
        sellingPriceMinor: 1,
        minStockLevel: 1,
        stockValueMinor: {
          $multiply: [
            { $ifNull: ['$stockQuantity', 0] },
            { $ifNull: [{ $ifNull: ['$averageCostMinor', '$costPriceMinor'] }, 0] },
          ],
        },
        retailValueMinor: {
          $multiply: [{ $ifNull: ['$stockQuantity', 0] }, { $ifNull: ['$sellingPriceMinor', 0] }],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalUnits: { $sum: '$stockQuantity' },
        costValueMinor: { $sum: '$stockValueMinor' },
        retailValueMinor: { $sum: '$retailValueMinor' },
        productCount: { $sum: 1 },
        inStockCount: { $sum: { $cond: [{ $gt: ['$stockQuantity', 0] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, totalUnits: 1, costValueMinor: 1, retailValueMinor: 1, productCount: 1, inStockCount: 1 } },
  ]);
}

/** Recent ledger entries with product join, paginated by the caller. */
export async function movementHistory(businessId, filter = {}, { page = 1, limit = 25, sort, order } = {}) {
  const skip = (page - 1) * limit;
  const direction = order === 'asc' ? 1 : -1;
  const sortSpec = { [sort || 'occurredAt']: direction };

  const [items, total] = await Promise.all([
    StockMovement.find({ business: businessId, ...filter })
      .populate('product', 'name sku unit imageUrl')
      .populate('performedBy', 'name')
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .lean(),
    StockMovement.countDocuments({ business: businessId, ...filter }),
  ]);

  return { items, total, page, limit };
}
