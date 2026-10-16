import mongoose from 'mongoose';
import { sanitized, searchRegex, softDelete, tenantScope } from './plugins.js';

const { Schema } = mongoose;

const customerSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    customerCode: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    phone: { type: String, trim: true, maxlength: 24, required: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    tags: { type: [String], default: () => [] },

    /**
     * Walk-in customers allow a sale without creating a permanent record.
     * Every walk-in sale still links to a real customer document (isWalkIn=true)
     * so history and receivables remain auditable.
     */
    isWalkIn: { type: Boolean, default: false, index: true },

    // ---- MONEY (minor units) ---------------------------------------------
    creditLimitMinor: { type: Number, min: 0, default: 0 },
    openingBalanceMinor: { type: Number, default: 0 },
    openingBalanceType: { type: String, enum: ['debit', 'credit'], default: 'debit' },

    /** Denormalised lifetime totals; recomputed inside the sale/payment txn. */
    totalSalesMinor: { type: Number, default: 0 },
    totalPaidMinor: { type: Number, default: 0 },
    totalRefundedMinor: { type: Number, default: 0 },
    invoiceCount: { type: Number, default: 0 },

    lastTransactionAt: { type: Date, default: null },
    lastVisitedAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

customerSchema.index(
  { business: 1, customerCode: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null, customerCode: { $type: 'string', $gt: '' } }, name: 'business_customer_code_unique' }
);
customerSchema.index({ business: 1, name: 'text', phone: 'text', customerCode: 'text', email: 'text' }, {
  name: 'business_customer_text',
  weights: { name: 10, customerCode: 6, phone: 6, email: 3 },
});
customerSchema.index({ business: 1, isActive: 1, archivedAt: 1, createdAt: -1 });
customerSchema.index({ business: 1, lastTransactionAt: -1 });

/** Outstanding = billed − paid − refunds. Derived, never stored as a truth. */
customerSchema.virtual('outstandingMinor').get(function outstandingMinor() {
  const billed = this.totalSalesMinor + this.openingBalanceMinor;
  return Math.max(0, billed - this.totalPaidMinor - this.totalRefundedMinor);
});

customerSchema.virtual('creditAvailableMinor').get(function creditAvailableMinor() {
  return Math.max(0, this.creditLimitMinor - this.outstandingMinor);
});

customerSchema.virtual('isOverLimit').get(function isOverLimit() {
  return this.creditLimitMinor > 0 && this.outstandingMinor > this.creditLimitMinor;
});

customerSchema.statics.searchByText = function searchByText(businessId, term) {
  const rx = searchRegex(term);
  if (!rx) return this.find({ business: businessId });
  return this.find({
    business: businessId,
    deletedAt: null,
    $or: [{ name: rx }, { phone: rx }, { customerCode: rx }, { email: rx }],
  });
};

/** Walk-in buckets keep the walk-in slot present without a live document. */
customerSchema.statics.WALK_IN_CODE = 'WALK-IN';

customerSchema.plugin(tenantScope({ indexPrefix: 'customer' }));
customerSchema.plugin(softDelete);
sanitized(customerSchema);

export const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
export default Customer;
