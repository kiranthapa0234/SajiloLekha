/**
 * The money ledger.
 *
 * This is the workspace's own cash position -- distinct from what customers
 * and suppliers owe each other. Every row says one thing: a named amount moved
 * into or out of one named account, for a stated reason, on a stated date.
 *
 * Balance is never stored. It is the sum of these rows, so it cannot drift away
 * from the movements that produced it, and an account can be audited by
 * reading its rows in order.
 */
import mongoose from 'mongoose';
import { MONEY_ACCOUNTS, MONEY_KINDS } from '../../../shared/constants.js';
import { softDelete, tenantScope } from './plugins.js';

const { Schema } = mongoose;

const moneyMovementSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    /** Which pocket moved: the till, or the bank. */
    account: { type: String, enum: MONEY_ACCOUNTS, required: true, index: true },
    direction: { type: String, enum: ['in', 'out'], required: true, index: true },

    /** Always positive. `direction` carries the sign, as everywhere else. */
    amountMinor: { type: Number, required: true, min: 0 },

    kind: { type: String, enum: MONEY_KINDS, required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 280 },

    /** The document that caused this movement, so a figure is always traceable. */
    related: {
      type: {
        type: String,
        enum: ['Payment', 'Sale', 'Purchase', 'Expense', 'Invoice', 'Transfer', 'Manual'],
        default: 'Manual',
      },
      id: { type: Schema.Types.ObjectId, default: null },
      number: { type: String, default: '', maxlength: 60 },
    },

    /** Both legs of a transfer share this, so the pair is identifiable. */
    transferGroup: { type: Schema.Types.ObjectId, default: null, index: true },

    occurredAt: { type: Date, required: true, default: Date.now, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: '', maxlength: 280 },
  },
  { timestamps: true }
);

moneyMovementSchema.index({ business: 1, account: 1, occurredAt: -1 });
moneyMovementSchema.index({ business: 1, kind: 1, occurredAt: -1 });

/** Signed effect on the account: positive adds, negative removes. */
moneyMovementSchema.virtual('signedMinor').get(function signedMinor() {
  return this.direction === 'in' ? this.amountMinor : -this.amountMinor;
});

moneyMovementSchema.plugin(tenantScope({ indexPrefix: 'money' }));
softDelete(moneyMovementSchema);

export const MoneyMovement = mongoose.models.MoneyMovement || mongoose.model('MoneyMovement', moneyMovementSchema);
export default MoneyMovement;
