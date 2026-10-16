import mongoose from 'mongoose';
import { sanitized, softDelete } from './plugins.js';
import { ROLES } from '../../../shared/constants.js';

const { Schema } = mongoose;

/**
 * The authorisation backbone of the product.
 *
 * EVERY tenant-scoped read and write resolves through this collection:
 *   isActiveMember(userId, businessId, permission)
 * There is no code path that trusts a client-supplied businessId on its own.
 */
const businessMembershipSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    role: { type: String, enum: ROLES, required: true, default: 'staff', index: true },
    status: { type: String, enum: ['active', 'suspended', 'invited'], default: 'active', index: true },

    /** Fine-grained grants layered on top of the role matrix. */
    permissionOverrides: {
      allow: { type: [String], default: () => [] },
      deny: { type: [String], default: () => [] },
    },

    /** Optional data scoping: staff only see their own documents when set. */
    scope: {
      ownRecordsOnly: { type: Boolean, default: false },
      branches: [{ type: Schema.Types.ObjectId, ref: 'Business' }],
    },

    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    invitedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: () => new Date() },
    lastActiveAt: { type: Date, default: null },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One membership per user per business -— the tenant isolation anchor.
businessMembershipSchema.index({ user: 1, business: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
businessMembershipSchema.index({ business: 1, role: 1, status: 1 });
businessMembershipSchema.index({ user: 1, status: 1 });

businessMembershipSchema.virtual('effectivePermissions').get(function effectivePermissions() {
  return this.permissionOverrides || { allow: [], deny: [] };
});

softDelete(businessMembershipSchema);
sanitized(businessMembershipSchema);

export const BusinessMembership =
  mongoose.models.BusinessMembership || mongoose.model('BusinessMembership', businessMembershipSchema);
export default BusinessMembership;
