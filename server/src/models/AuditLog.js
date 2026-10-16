import mongoose from 'mongoose';
import { guard, sanitized, tenantScope } from './plugins.js';

const { Schema } = mongoose;

/**
 * Append-only audit trail.
 *
 * Every financial change records: who, which business, what entity, before and
 * after values, the request context and the amount involved. Logs are never
 * updated or deleted; retention is a compliance concern handled by a separate
 * archival job, not by application code.
 */
const auditLogSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', index: true },

    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, trim: true, maxlength: 120, default: 'system' },
    actorRole: { type: String, trim: true, maxlength: 24, default: 'system' },

    action: {
      type: String,
      required: true,
      enum: [
        'create',
        'update',
        'delete',
        'archive',
        'restore',
        'sale.create',
        'sale.cancel',
        'sale.refund',
        'payment.create',
        'payment.void',
        'payment.refund',
        'purchase.create',
        'purchase.cancel',
        'purchase.return',
        'stock.adjust',
        'stock.receive',
        'stock.issue',
        'invoice.create',
        'invoice.cancel',
        'invoice.writeoff',
        'expense.create',
        'expense.update',
        'expense.void',
        'auth.login',
        'auth.login_failed',
        'auth.logout',
        'auth.password_change',
        'auth.password_reset',
        'member.invite',
        'member.update',
        'member.remove',
        'business.update',
        'business.create',
        'business.transfer',
        'settings.update',
        'report.export',
        'money.transfer',
        'money.deposit',
        'money.withdraw',
      ],
      index: true,
    },

    entity: { type: String, required: true, trim: true, maxlength: 60, index: true },
    entityId: { type: Schema.Types.ObjectId, default: null, index: true },

    /** Redacted, size-capped before/after snapshots. */
    changes: { type: Schema.Types.Mixed, default: null },

    amountMinor: { type: Number, default: null },
    currency: { type: String, trim: true, maxlength: 8, default: null },

    ip: { type: String, trim: true, maxlength: 64, default: null },
    userAgent: { type: String, trim: true, maxlength: 400, default: null },
    requestId: { type: String, trim: true, maxlength: 64, default: null },
    method: { type: String, trim: true, maxlength: 10, default: null },
    path: { type: String, trim: true, maxlength: 300, default: null },

    /** True for changes that move money or stock. Used by reconciliation. */
    isFinancial: { type: Boolean, default: false, index: true },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

auditLogSchema.index({ business: 1, createdAt: -1 });
auditLogSchema.index({ business: 1, entity: 1, entityId: 1 });
auditLogSchema.index({ business: 1, isFinancial: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

// Hard immutability: an audit trail that can be edited is not evidence.
auditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'remove'],
  guard(() => new Error('Audit logs are immutable'))
);

auditLogSchema.statics.record = async function record(entry) {
  try {
    return await this.create(entry);
  } catch {
    // An audit failure must never break the business operation that succeeded.
    // It is logged loudly as an operational problem instead.
    const { default: logger } = await import('../utils/logger.js');
    logger.error('Audit write failed', { action: entry.action, entity: entry.entity });
    return null;
  }
};

// `requireBusiness: false`: authentication events (failed login, password
// reset requested) happen before any workspace is known. Requiring a business
// reference there threw on every failed login and silently discarded exactly
// the audit trail you most want.
auditLogSchema.plugin(tenantScope({ indexPrefix: 'audit', requireBusiness: false }));
sanitized(auditLogSchema);

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
