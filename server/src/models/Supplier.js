import mongoose from 'mongoose';
import { sanitized, searchRegex, softDelete, tenantScope } from './plugins.js';

const { Schema } = mongoose;

const supplierSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    supplierCode: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    contactPerson: { type: String, trim: true, maxlength: 120, default: '' },
    // A supplier is identified by name; a phone number is useful but not
  // required. Making it `required: true` here contradicted the Zod schema and
  // the form, which both allow a supplier with only a name -- so saving one
  // failed with a Mongoose "Path `phone` is required" the form could not map
  // onto a field the user had left blank on purpose.
  phone: { type: String, trim: true, maxlength: 24, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    taxNumber: { type: String, trim: true, maxlength: 60, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },

    // ---- MONEY (minor units) ---------------------------------------------
    openingBalanceMinor: { type: Number, default: 0 },
    openingBalanceType: { type: String, enum: ['debit', 'credit'], default: 'credit' },

    totalPurchasedMinor: { type: Number, default: 0 },
    totalPaidMinor: { type: Number, default: 0 },
    purchaseCount: { type: Number, default: 0 },

    /** Default lead time in days, used for reorder projections. */
    leadTimeDays: { type: Number, min: 0, max: 365, default: 0 },
    paymentTermsDays: { type: Number, min: 0, max: 365, default: 0 },

    lastTransactionAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

supplierSchema.index(
  { business: 1, supplierCode: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null, supplierCode: { $type: 'string', $gt: '' } }, name: 'business_supplier_code_unique' }
);
supplierSchema.index({ business: 1, name: 'text', phone: 'text', supplierCode: 'text', email: 'text' }, {
  name: 'business_supplier_text',
  weights: { name: 10, supplierCode: 6, phone: 5, email: 3 },
});
supplierSchema.index({ business: 1, isActive: 1, archivedAt: 1, createdAt: -1 });

/** What we owe the supplier: received − paid − credits. */
supplierSchema.virtual('outstandingMinor').get(function outstandingMinor() {
  const sign = this.openingBalanceType === 'credit' ? 1 : -1;
  const opening = this.openingBalanceMinor * sign;
  return Math.max(0, this.totalPurchasedMinor - this.totalPaidMinor + opening);
});

supplierSchema.statics.searchByText = function searchByText(businessId, term) {
  const rx = searchRegex(term);
  if (!rx) return this.find({ business: businessId });
  return this.find({
    business: businessId,
    deletedAt: null,
    $or: [{ name: rx }, { phone: rx }, { supplierCode: rx }, { email: rx }, { contactPerson: rx }],
  });
};

supplierSchema.plugin(tenantScope({ indexPrefix: 'supplier' }));
supplierSchema.plugin(softDelete);
sanitized(supplierSchema);

export const Supplier = mongoose.models.Supplier || mongoose.model('Supplier', supplierSchema);
export default Supplier;
