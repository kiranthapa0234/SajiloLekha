import mongoose from 'mongoose';
import { sanitized, softDelete, tenantScope } from './plugins.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../../../shared/constants.js';

const { Schema } = mongoose;

/**
 * Operating expense. Inventory purchases deliberately live in the Purchase
 * collection so they capitalise into stock instead of hitting the P&L on the
 * day they are paid.
 */
const expenseSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    /** Integer minor units. */
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, trim: true, maxlength: 8, default: 'NPR' },

    spentAt: { type: Date, required: true, default: Date.now, index: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true, default: 'cash', index: true },
    /** Money already left the business -— used by the cash-flow report. */
    isPaid: { type: Boolean, default: true },

    vendor: { type: String, trim: true, maxlength: 160, default: '' },
    reference: { type: String, trim: true, maxlength: 80, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    receiptUrl: { type: String, trim: true, maxlength: 500, default: null },

    recurring: { type: Boolean, default: false },
    recurrence: { type: String, enum: ['none', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'], default: 'none' },

    /** Set when the expense is voided; excluded from every report. */
    status: { type: String, enum: ['recorded', 'voided'], default: 'recorded', index: true },
    voidReason: { type: String, trim: true, maxlength: 280, default: '' },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

expenseSchema.index({ business: 1, spentAt: -1 });
expenseSchema.index({ business: 1, category: 1, spentAt: -1 });
expenseSchema.index({ business: 1, status: 1, archivedAt: 1 });
expenseSchema.index({ business: 1, reference: 1 });

expenseSchema.pre('validate', function normaliseExpense(next) {
  if (this.amountMinor !== undefined) this.amountMinor = Math.trunc(this.amountMinor);
  next();
});

expenseSchema.plugin(tenantScope({ indexPrefix: 'expense' }));
expenseSchema.plugin(softDelete);
sanitized(expenseSchema);

export const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
export default Expense;
