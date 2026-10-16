import mongoose from 'mongoose';
import { guard, queryUpdate, sanitized, softDelete, tenantScope, updatedFields } from './plugins.js';
import { STOCK_MOVEMENT_TYPES } from '../../../shared/constants.js';

const { Schema } = mongoose;

/**
 * Append-only stock ledger.
 *
 * Invariants enforced by the service layer + the guards below:
 *  1. `quantityAfter` always equals `quantityBefore + quantity` (signed).
 *  2. A movement is never updated or deleted; corrections are new movements.
 *  3. Every movement carries a reason and a reference document.
 */
const stockMovementSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },

    /** Signed change applied to stock: +received, −issued. */
    quantity: { type: Number, required: true, validate: (v) => v !== 0 },
    quantityBefore: { type: Number, required: true },
    quantityAfter: { type: Number, required: true },

    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true, index: true },
    unitCostMinor: { type: Number, min: 0, default: 0 },
    /** Value of the movement for valuation reporting (always positive). */
    valueMinor: { type: Number, min: 0, default: 0 },

    reason: { type: String, trim: true, maxlength: 280, required: true },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    reference: { type: String, trim: true, maxlength: 80, default: '' },

    /** Polymorphic pointer to the causing document (sale, purchase, refund⬦). */
    relatedDocument: {
      type: { type: String, enum: ['Sale', 'Purchase', 'Refund', 'Adjustment', 'Product', 'SaleCancellation'], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      number: { type: String, trim: true, maxlength: 40, default: '' },
    },

    occurredAt: { type: Date, default: Date.now, index: true },
    /** Recomputes the ledger if stock was later corrected. */
    reverses: { type: Schema.Types.ObjectId, ref: 'StockMovement', default: null },

    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stockVersionAfter: { type: Number, default: 0 },
    idempotencyKey: { type: String, trim: true, maxlength: 128, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Exactly-once stock application per logical operation.
stockMovementSchema.index(
  { business: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } }, name: 'movement_idempotency' }
);
stockMovementSchema.index({ business: 1, product: 1, occurredAt: -1 });
stockMovementSchema.index({ business: 1, type: 1, occurredAt: -1 });
stockMovementSchema.index({ business: 1, 'relatedDocument.type': 1, 'relatedDocument.id': 1 });
stockMovementSchema.index({ performedBy: 1, occurredAt: -1 });

/** Ledger integrity: the arithmetic must close. */
stockMovementSchema.pre('validate', function validateArity(next) {
  if (this.quantityAfter !== this.quantityBefore + this.quantity) {
    return next(new Error('Stock movement arithmetic is inconsistent'));
  }
  if (this.quantityBefore < 0) {
    return next(new Error('Stock movement cannot start from a negative quantity'));
  }
  return next();
});

/** Fields that define what a movement MEANT. None of them may ever be edited. */
const FORBIDDEN_MOVEMENT_EDITS = ['quantity', 'quantityBefore', 'quantityAfter', 'type', 'product', 'business'];

/** Append-only. A movement may only be archived, never rewritten. */
stockMovementSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], guard((query) => {
  const fields = updatedFields(queryUpdate(query));
  if (FORBIDDEN_MOVEMENT_EDITS.some((k) => fields.has(k))) {
    return new Error('Stock movements are immutable: record a correcting movement instead');
  }
  return undefined;
}));

stockMovementSchema.plugin(tenantScope({ indexPrefix: 'movement' }));
stockMovementSchema.plugin(softDelete);
sanitized(stockMovementSchema);

export const StockMovement =
  mongoose.models.StockMovement || mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;
