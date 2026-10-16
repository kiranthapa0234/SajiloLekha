import mongoose from 'mongoose';
import { sanitized, softDelete, tenantScope } from './plugins.js';
import { PAYMENT_METHODS } from '../../../shared/constants.js';

const { Schema } = mongoose;

/**
 * A sale line is an immutable snapshot.
 *
 * Product name, SKU, unit price, cost and description are copied at checkout
 * and never read from Product again, so editing a product tomorrow cannot
 * rewrite a historical invoice or last month's profit.
 */
const saleLineSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    /** Snapshot fields -— the historical truth. */
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 64, default: '' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    unit: { type: String, trim: true, maxlength: 24, default: 'pcs' },

    quantity: { type: Number, required: true, min: 0 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    /** Unit cost at time of sale -> drives COGS and profit. */
    unitCostMinor: { type: Number, required: true, min: 0, default: 0 },

    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    discountMinor: { type: Number, min: 0, default: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },

    grossMinor: { type: Number, required: true, min: 0 },
    netMinor: { type: Number, required: true, min: 0 },
    taxMinor: { type: Number, required: true, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    lineCogsMinor: { type: Number, required: true, min: 0, default: 0 },
    lineProfitMinor: { type: Number, required: true, default: 0 },

    note: { type: String, trim: true, maxlength: 280, default: '' },
    /** Units already returned against this line (refunds/returns). */
    returnedQuantity: { type: Number, default: 0, min: 0 },
    /** Discount applied by whom and why -— needed for discount abuse audits. */
    discountApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true }
);

const discountSchema = new Schema(
  {
    percent: { type: Number, min: 0, max: 100, default: 0 },
    amountMinor: { type: Number, min: 0, default: 0 },
    reason: { type: String, trim: true, maxlength: 280, default: '' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const saleSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    /** Human-facing checkout reference, unique per business. */
    reference: { type: String, required: true, trim: true, maxlength: 40 },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    /** Snapshot so the document still reads correctly if the customer is renamed. */
    customerName: { type: String, trim: true, maxlength: 160, default: 'Walk-in customer' },
    customerPhone: { type: String, trim: true, maxlength: 24, default: '' },
    isWalkIn: { type: Boolean, default: true },

    channel: { type: String, enum: ['pos', 'online', 'manual'], default: 'pos' },
    status: { type: String, enum: ['completed', 'cancelled'], default: 'completed', index: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, maxlength: 280, default: '' },

    lines: {
      type: [saleLineSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'A sale must contain at least one line'],
    },

    discount: { type: discountSchema, default: () => ({}) },

    // ---- TOTALS (integer minor units; the invoice copies these verbatim) ----
    currency: { type: String, trim: true, maxlength: 8, default: 'NPR' },
    grossMinor: { type: Number, required: true, min: 0, default: 0 },
    totalDiscountMinor: { type: Number, required: true, min: 0, default: 0 },
    /** Revenue excluding tax and net of refunds. */
    netSalesMinor: { type: Number, required: true, min: 0, default: 0 },
    taxMinor: { type: Number, required: true, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    cogsMinor: { type: Number, required: true, min: 0, default: 0 },
    grossProfitMinor: { type: Number, required: true, default: 0 },
    /** Total refunded against this sale (contra-revenue). */
    refundedMinor: { type: Number, required: true, min: 0, default: 0 },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    paidMinor: { type: Number, required: true, min: 0, default: 0 },

    note: { type: String, trim: true, maxlength: 1000, default: '' },
    soldAt: { type: Date, required: true, default: Date.now, index: true },

    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },

    /** Set when this sale was created by a return/refund flow. */
    parentSale: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
    idempotencyKey: { type: String, trim: true, maxlength: 128, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Reference is unique per business: `count()` is never used for numbering.
saleSchema.index(
  { business: 1, reference: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'business_sale_reference_unique' }
);
// Duplicate-submission guard on checkout.
saleSchema.index(
  { business: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } }, name: 'business_sale_idempotency' }
);
saleSchema.index({ business: 1, soldAt: -1 });
saleSchema.index({ business: 1, customer: 1, soldAt: -1 });
saleSchema.index({ business: 1, status: 1, soldAt: -1 });
saleSchema.index({ business: 1, 'lines.product': 1, soldAt: -1 });
saleSchema.index({ customer: 1, soldAt: -1 });

saleSchema.virtual('outstandingMinor').get(function outstandingMinor() {
  return Math.max(0, (this.totalMinor ?? 0) - (this.paidMinor ?? 0));
});

saleSchema.virtual('lineCount').get(function lineCount() {
  return (this.lines || []).length;
});

saleSchema.virtual('itemCount').get(function itemCount() {
  return (this.lines || []).reduce((sum, l) => sum + (l.quantity ?? 0), 0);
});

/** Ledger invariants for a completed sale. */
saleSchema.pre('validate', function validateSale(next) {
  if (!this.isModified('lines') && !this.isNew) return next();

  const computedGross = (this.lines || []).reduce((s, l) => s + l.grossMinor, 0);
  const computedNet = (this.lines || []).reduce((s, l) => s + l.netMinor, 0);
  const computedTax = (this.lines || []).reduce((s, l) => s + l.taxMinor, 0);
  const computedCogs = (this.lines || []).reduce((s, l) => s + l.lineCogsMinor, 0);

  if (this.lines?.length) {
    if (computedGross !== this.grossMinor) this.grossMinor = computedGross;
    if (computedTax !== this.taxMinor) this.taxMinor = computedTax;
    if (computedCogs !== this.cogsMinor) this.cogsMinor = computedCogs;
    if (computedNet - computedCogs !== this.grossProfitMinor) {
      this.grossProfitMinor = computedNet - computedCogs;
    }
  }

  if (this.netSalesMinor + this.taxMinor !== this.totalMinor) {
    this.totalMinor = this.netSalesMinor + this.taxMinor;
  }
  if (this.paidMinor > this.totalMinor) {
    return next(new Error('Recorded payments cannot exceed the invoice total'));
  }
  return next();
});

/** A sale is never physically deleted; only cancelled (with stock reversal). */
saleSchema.pre('remove', function blockRemoval(next) {
  next(new Error('Sales cannot be deleted -— cancel the sale instead'));
});

saleSchema.plugin(tenantScope({ indexPrefix: 'sale' }));
saleSchema.plugin(softDelete);
sanitized(saleSchema);

export const Sale = mongoose.models.Sale || mongoose.model('Sale', saleSchema);
export { saleLineSchema };
export default Sale;
