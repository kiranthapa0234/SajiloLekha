import mongoose from 'mongoose';
import { guard, queryUpdate, sanitized, softDelete, tenantScope, updatedFields } from './plugins.js';
import { PAYMENT_METHODS } from '../../../shared/constants.js';

const { Schema } = mongoose;

/**
 * An immutable money movement. Payments are never edited: a mistake is voided
 * and re-entered, which keeps the audit trail provable.
 *
 * `status`: valid | voided | failed. Partial refunds keep the status `valid` and
 * reduce `refundedMinor`.
 */
const paymentSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    reference: { type: String, required: true, trim: true, maxlength: 40 },

    /** What the money settles. Populated references are validated on write. */
    direction: { type: String, enum: ['inbound', 'outbound'], required: true, default: 'inbound', index: true },

    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    sale: { type: Schema.Types.ObjectId, ref: 'Sale', default: null, index: true },
    purchase: { type: Schema.Types.ObjectId, ref: 'Purchase', default: null, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },

    /** Integer minor units. */
    amountMinor: { type: Number, required: true, min: 1 },
    refundedMinor: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, trim: true, maxlength: 8, default: 'NPR' },

    method: { type: String, enum: PAYMENT_METHODS, required: true, index: true },
    /** Bank/ne/wallet transaction id supplied by the client for reconciliation. */
    transactionReference: { type: String, trim: true, maxlength: 80, default: '' },

    paidAt: { type: Date, required: true, default: Date.now, index: true },
    status: { type: String, enum: ['valid', 'voided', 'failed'], default: 'valid', index: true },

    notes: { type: String, trim: true, maxlength: 500, default: '' },

    /** Reconciliation state against a bank statement. */
    reconciliation: {
      status: { type: String, enum: ['unreconciled', 'reconciled', 'mismatch'], default: 'unreconciled' },
      reconciledAt: { type: Date, default: null },
      reconciledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      bankReference: { type: String, trim: true, maxlength: 80, default: '' },
      note: { type: String, trim: true, maxlength: 280, default: '' },
    },

    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, trim: true, maxlength: 280, default: '' },

    /** Refunds recorded against this payment. */
    refundIds: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],

    idempotencyKey: { type: String, trim: true, maxlength: 128, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentSchema.index(
  { business: 1, reference: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'business_payment_reference_unique' }
);
paymentSchema.index(
  { business: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } }, name: 'business_payment_idempotency' }
);
paymentSchema.index({ business: 1, paidAt: -1 });
paymentSchema.index({ business: 1, method: 1, paidAt: -1 });
paymentSchema.index({ invoice: 1, status: 1, paidAt: -1 });
paymentSchema.index({ purchase: 1, status: 1, paidAt: -1 });
paymentSchema.index({ customer: 1, paidAt: -1 });
paymentSchema.index({ supplier: 1, paidAt: -1 });
paymentSchema.index({ business: 1, 'reconciliation.status': 1 });

paymentSchema.virtual('netMinor').get(function netMinor() {
  return this.amountMinor - this.refundedMinor;
});

paymentSchema.pre('validate', function validatePayment(next) {
  if (this.refundedMinor > this.amountMinor) {
    return next(new Error('Refunded amount cannot exceed the payment amount'));
  }
  if (this.paidAt instanceof Date && Number.isNaN(this.paidAt.getTime())) {
    return next(new Error('Invalid payment date'));
  }
  return next();
});

/**
 * The settled facts of a payment are immutable. Only refund counters,
 * reconciliation bookkeeping and the void fields may be written afterwards.
 */
const PROTECTED_PAYMENT_FIELDS = [
  'amountMinor',
  'method',
  'invoice',
  'business',
  'direction',
  'paidAt',
  'customer',
  'supplier',
  'purchase',
];

paymentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], guard((query) => {
  const fields = updatedFields(queryUpdate(query));
  for (const field of fields) {
    if (PROTECTED_PAYMENT_FIELDS.includes(field)) {
      return new Error('Payment details are immutable: void and re-record instead');
    }
  }
  return undefined;
}));

paymentSchema.pre(['remove', 'deleteOne', 'deleteMany'], guard(
  () => new Error('Payments cannot be deleted: void the payment instead')
));

paymentSchema.plugin(tenantScope({ indexPrefix: 'payment' }));
paymentSchema.plugin(softDelete);
sanitized(paymentSchema);

export const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
export default Payment;
