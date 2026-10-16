import mongoose from 'mongoose';
import { sanitized, softDelete } from './plugins.js';
import { DEFAULT_BUSINESS_SETTINGS, SUPPORTED_CURRENCIES } from '../../../shared/constants.js';

const { Schema } = mongoose;

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 160, default: '' },
    line2: { type: String, trim: true, maxlength: 160, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    state: { type: String, trim: true, maxlength: 80, default: '' },
    postalCode: { type: String, trim: true, maxlength: 20, default: '' },
    country: { type: String, trim: true, maxlength: 80, default: '' },
  },
  { _id: false }
);

const settingsSchema = new Schema(
  {
    currency: { type: String, enum: SUPPORTED_CURRENCIES.map((c) => c.code), default: 'NPR' },
    currencySymbol: { type: String, trim: true, maxlength: 8, default: 'Rs.' },
    currencyDecimals: { type: Number, min: 0, max: 3, default: 2 },
    locale: { type: String, trim: true, maxlength: 16, default: 'en-NP' },
    timezone: { type: String, trim: true, maxlength: 64, default: 'Asia/Kathmandu' },

    taxEnabled: { type: Boolean, default: false },
    taxRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    taxInclusive: { type: Boolean, default: false },
    taxLabel: { type: String, trim: true, maxlength: 24, default: 'VAT' },

    invoicePrefix: { type: String, trim: true, maxlength: 10, default: 'INV' },
    /** Monotonic counter; consumed atomically, never derived from count(). */
    invoiceSequence: { type: Number, min: 0, default: 0 },
    invoiceNumberPadding: { type: Number, min: 0, max: 10, default: 5 },
    purchasePrefix: { type: String, trim: true, maxlength: 10, default: 'PUR' },
    purchaseSequence: { type: Number, min: 0, default: 0 },
    receiptPrefix: { type: String, trim: true, maxlength: 10, default: 'RCPT' },
    receiptSequence: { type: Number, min: 0, default: 0 },

    paymentMethods: {
      type: [String],
      default: () => ['cash', 'bank_transfer', 'card', 'digital_wallet', 'credit'],
    },
    /** 0 = due on receipt. */
    invoiceDueDays: { type: Number, min: 0, max: 365, default: 0 },

    allowNegativeStock: { type: Boolean, default: false },
    lowStockAlerts: { type: Boolean, default: true },
    requirePaymentReason: { type: Boolean, default: false },
    /** Default sale discount cap enforced server-side. */
    maxDiscountPercent: { type: Number, min: 0, max: 100, default: 20 },

    /**
     * Accounting mode. `accrual` (default) is correct: purchases capitalise into
     * inventory and only reach the P&L as COGS when sold.
     */
    accounting: {
      basis: { type: String, enum: ['accrual', 'cash'], default: 'accrual' },
      purchaseAsExpense: { type: Boolean, default: false },
    },

    receiptFooter: { type: String, trim: true, maxlength: 300, default: 'Thank you for your business.' },
    terms: { type: String, trim: true, maxlength: 2000, default: '' },
    invoiceNotes: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { _id: false }
);

const businessSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },
    legalName: { type: String, trim: true, maxlength: 160, default: '' },
    registrationNumber: { type: String, trim: true, maxlength: 60, default: '' },
    taxNumber: { type: String, trim: true, maxlength: 60, default: '' },

    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 24, default: '' },
    website: { type: String, trim: true, maxlength: 200, default: '' },
    address: { type: addressSchema, default: () => ({}) },
    logoUrl: { type: String, trim: true, maxlength: 500, default: null },

    settings: { type: settingsSchema, default: () => ({}) },
    subscription: {
      plan: { type: String, enum: ['free', 'starter', 'growth', 'enterprise'], default: 'free' },
      status: { type: String, enum: ['active', 'trialing', 'past_due', 'cancelled'], default: 'active' },
      trialEndsAt: { type: Date, default: null },
      seats: { type: Number, default: 5, min: 1 },
    },

    /** Denormalised counters kept in step via $inc inside the sale transaction. */
    stats: {
      productCount: { type: Number, default: 0 },
      customerCount: { type: Number, default: 0 },
      supplierCount: { type: Number, default: 0 },
      saleCount: { type: Number, default: 0 },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

businessSchema.index({ name: 'text', legalName: 'text', email: 'text' });

businessSchema.methods.decimals = function decimals() {
  return this.settings?.currencyDecimals ?? 2;
};

businessSchema.methods.activePaymentMethods = function activePaymentMethods() {
  return this.settings?.paymentMethods?.length
    ? this.settings.paymentMethods
    : DEFAULT_BUSINESS_SETTINGS.paymentMethods;
};

businessSchema.virtual('displayAddress').get(function displayAddress() {
  const a = this.address || {};
  return [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ');
});

softDelete(businessSchema);
sanitized(businessSchema);

export const Business = mongoose.models.Business || mongoose.model('Business', businessSchema);
export { addressSchema, settingsSchema };
export default Business;
