import mongoose from 'mongoose';
import { sanitized, softDelete, tenantScope } from './plugins.js';
import { INVOICE_STATUSES } from '../../../shared/constants.js';

const { Schema } = mongoose;

const invoiceLineSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 64, default: '' },
    unit: { type: String, trim: true, maxlength: 24, default: 'pcs' },
    quantity: { type: Number, required: true, min: 0 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    discountMinor: { type: Number, min: 0, default: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    netMinor: { type: Number, required: true, min: 0 },
    taxMinor: { type: Number, required: true, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    returnedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

/**
 * The customer-facing billing document. One invoice per completed sale.
 *
 * Money fields are copied from the Sale at issue time and are never recalculated
 * from Product -— this is what makes a printed invoice historically accurate.
 */
const invoiceSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    /** Sequential per business, e.g. INV-2024-00042. Unique per business. */
    invoiceNumber: { type: String, required: true, trim: true, maxlength: 40 },
    sequence: { type: Number, required: true, min: 1 },

    sale: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    customerName: { type: String, trim: true, maxlength: 160, default: 'Walk-in customer' },
    customerPhone: { type: String, trim: true, maxlength: 24, default: '' },
    customerAddress: { type: String, trim: true, maxlength: 300, default: '' },
    customerTaxNumber: { type: String, trim: true, maxlength: 60, default: '' },

    /** Business identity snapshot so a later rebrand does not alter history. */
    businessSnapshot: {
      name: { type: String, trim: true, maxlength: 120, default: '' },
      legalName: { type: String, trim: true, maxlength: 160, default: '' },
      address: { type: String, trim: true, maxlength: 400, default: '' },
      phone: { type: String, trim: true, maxlength: 24, default: '' },
      email: { type: String, trim: true, maxlength: 254, default: '' },
      taxNumber: { type: String, trim: true, maxlength: 60, default: '' },
      logoUrl: { type: String, trim: true, maxlength: 500, default: null },
    },

    lines: { type: [invoiceLineSchema], default: [] },

    currency: { type: String, trim: true, maxlength: 8, default: 'NPR' },
    currencySymbol: { type: String, trim: true, maxlength: 8, default: 'Rs.' },
    currencyDecimals: { type: Number, min: 0, max: 3, default: 2 },

    grossMinor: { type: Number, required: true, min: 0, default: 0 },
    totalDiscountMinor: { type: Number, required: true, min: 0, default: 0 },
    netSalesMinor: { type: Number, required: true, min: 0, default: 0 },
    taxLabel: { type: String, trim: true, maxlength: 24, default: 'VAT' },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    taxMinor: { type: Number, required: true, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    paidMinor: { type: Number, required: true, min: 0, default: 0 },
    refundedMinor: { type: Number, required: true, min: 0, default: 0 },
    /** Written off / credited balance. Reduces receivables without a refund. */
    writtenOffMinor: { type: Number, required: true, min: 0, default: 0 },

    /** Derived from amounts + due date on every read/write. Never client-set. */
    status: { type: String, enum: INVOICE_STATUSES, default: 'unpaid', index: true },

    issuedAt: { type: Date, required: true, default: Date.now, index: true },
    dueDate: { type: Date, default: null, index: true },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, maxlength: 280, default: '' },

    note: { type: String, trim: true, maxlength: 1000, default: '' },
    terms: { type: String, trim: true, maxlength: 2000, default: '' },
    footer: { type: String, trim: true, maxlength: 300, default: '' },

    /** Print/download counters, useful for audit. */
    issuedCopies: { type: Number, default: 0, min: 0 },
    lastPrintedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Invoice numbers must be unique *within* a business, never globally.
invoiceSchema.index(
  { business: 1, invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'business_invoice_number_unique' }
);
invoiceSchema.index({ business: 1, issuedAt: -1 });
invoiceSchema.index({ business: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ business: 1, customer: 1, issuedAt: -1 });
invoiceSchema.index({ business: 1, status: 1, issuedAt: -1 });

invoiceSchema.virtual('outstandingMinor').get(function outstandingMinor() {
  return Math.max(
    0,
    (this.totalMinor ?? 0) - (this.paidMinor ?? 0) - (this.writtenOffMinor ?? 0)
  );
});

invoiceSchema.virtual('isSettled').get(function isSettled() {
  return this.status === 'paid' || this.status === 'cancelled';
});

invoiceSchema.virtual('daysOverdue').get(function daysOverdue() {
  if (!this.dueDate || this.isSettled) return 0;
  const diff = Date.now() - this.dueDate.getTime();
  return diff > 0 ? Math.ceil(diff / 86_400_000) : 0;
});

invoiceSchema.pre('validate', function validateInvoice(next) {
  if (this.netSalesMinor + this.taxMinor !== this.totalMinor) {
    return next(new Error('Invoice total does not equal net sales plus tax'));
  }
  if (this.paidMinor > this.totalMinor + this.writtenOffMinor) {
    return next(new Error('Recorded payments exceed the invoice total'));
  }
  next();
});

invoiceSchema.pre('remove', function blockRemoval(next) {
  next(new Error('Invoices cannot be deleted -— cancel the invoice instead'));
});

invoiceSchema.plugin(tenantScope({ indexPrefix: 'invoice' }));
invoiceSchema.plugin(softDelete);
sanitized(invoiceSchema);

export const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
export default Invoice;
