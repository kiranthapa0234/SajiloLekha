import mongoose from 'mongoose';
import { sanitized, softDelete, tenantScope } from './plugins.js';
import { PAYMENT_METHODS } from '../../../shared/constants.js';

const { Schema } = mongoose;

const purchaseLineSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 64, default: '' },
    unit: { type: String, trim: true, maxlength: 24, default: 'pcs' },

    quantity: { type: Number, required: true, min: 0 },
    /** Unit cost paid to the supplier -> drives weighted average cost. */
    unitCostMinor: { type: Number, required: true, min: 0 },
    suggestedSellingPriceMinor: { type: Number, required: true, min: 0, default: 0 },

    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    discountMinor: { type: Number, min: 0, default: 0 },
    netMinor: { type: Number, required: true, min: 0 },
    taxMinor: { type: Number, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },

    note: { type: String, trim: true, maxlength: 280, default: '' },
    returnedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

/**
 * Goods received from a supplier.
 *
 * A purchase capitalises into inventory (it is NOT an expense). Its cost reaches
 * the profit & loss statement only as COGS when the stock is sold.
 */
const purchaseSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    reference: { type: String, required: true, trim: true, maxlength: 40 },
    supplierInvoiceNumber: { type: String, trim: true, maxlength: 80, default: '' },

    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    supplierName: { type: String, trim: true, maxlength: 160, default: '' },

    lines: {
      type: [purchaseLineSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'A purchase must contain at least one line'],
    },

    currency: { type: String, trim: true, maxlength: 8, default: 'NPR' },
    grossMinor: { type: Number, required: true, min: 0, default: 0 },
    totalDiscountMinor: { type: Number, required: true, min: 0, default: 0 },
    netMinor: { type: Number, required: true, min: 0, default: 0 },
    taxLabel: { type: String, trim: true, maxlength: 24, default: 'VAT' },
    taxMinor: { type: Number, required: true, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    paidMinor: { type: Number, required: true, min: 0, default: 0 },

    status: { type: String, enum: ['received', 'cancelled'], default: 'received', index: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, maxlength: 280, default: '' },

    purchasedAt: { type: Date, required: true, default: Date.now, index: true },
    dueDate: { type: Date, default: null, index: true },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    attachmentUrl: { type: String, trim: true, maxlength: 500, default: null },

    idempotencyKey: { type: String, trim: true, maxlength: 128, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

purchaseSchema.index(
  { business: 1, reference: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'business_purchase_reference_unique' }
);
purchaseSchema.index(
  { business: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } }, name: 'business_purchase_idempotency' }
);
purchaseSchema.index({ business: 1, purchasedAt: -1 });
purchaseSchema.index({ business: 1, supplier: 1, purchasedAt: -1 });
purchaseSchema.index({ business: 1, status: 1, purchasedAt: -1 });

purchaseSchema.virtual('outstandingMinor').get(function outstandingMinor() {
  return Math.max(0, (this.totalMinor ?? 0) - (this.paidMinor ?? 0));
});

purchaseSchema.pre('validate', function validatePurchase(next) {
  if (this.netMinor + this.taxMinor !== this.totalMinor) {
    return next(new Error('Purchase total does not equal net plus tax'));
  }
  if (this.paidMinor > this.totalMinor) {
    return next(new Error('Recorded payments exceed the purchase total'));
  }
  return next();
});

purchaseSchema.pre('remove', function blockRemoval(next) {
  next(new Error('Purchases cannot be deleted -— cancel the purchase instead'));
});

purchaseSchema.plugin(tenantScope({ indexPrefix: 'purchase' }));
purchaseSchema.plugin(softDelete);
sanitized(purchaseSchema);

export const Purchase = mongoose.models.Purchase || mongoose.model('Purchase', purchaseSchema);
export default Purchase;
