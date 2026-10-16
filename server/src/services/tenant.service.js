/**
 * Business tenancy and authorisation.
 *
 * THE INVARIANT: every tenant-scoped query is built by `ctx.scope(filter)`, which
 * always injects the *authenticated* business id taken from the verified
 * membership -— never a raw value from the request body or query string.
 *
 * A request that names business B while authenticated for business A is either
 * switched to A (header/query selector) or rejected with 403. It can never read
 * B's data.
 */
import mongoose from 'mongoose';
import BusinessMembership from '../models/BusinessMembership.js';
import { AppError } from '../utils/errors.js';
import { isAtLeast, permissionsForRole, roleHasEveryPermission, roleHasPermission } from '../../../shared/constants.js';

/**
 * Build the request-scoped tenancy context.
 *
 * @param {object} params
 * @param {import('mongoose').Document} params.user  authenticated user
 * @param {string} [params.requestedBusinessId]  selector from X-Business-Id / query
 * @param {boolean} [params.required]
 */
export async function resolveBusinessContext({ user, requestedBusinessId, required = true }) {
  const base = {
    user,
    userId: user._id,
    business: null,
    businessId: null,
    membership: null,
    role: null,
    permissions: [],
    overrides: null,
    ownRecordsOnly: false,
  };

  const memberships = await BusinessMembership.find({
    user: user._id,
    status: 'active',
    deletedAt: null,
  })
    .populate({
      path: 'business',
      match: { deletedAt: null },
      select: 'name logoUrl settings status subscription stats createdBy',
    })
    .lean();

  const usable = memberships.filter((m) => m.business);

  if (requestedBusinessId) {
    const wanted = String(requestedBusinessId);
    if (!mongoose.isValidObjectId(wanted)) {
      throw AppError.badRequest('Invalid business identifier');
    }
    const found = usable.find((m) => String(m.business._id) === wanted);
    if (!found) {
      // Do not confirm or deny existence -— just deny access.
      throw AppError.forbidden('You do not have access to this business');
    }
    return decorate({ ...base, membership: found, business: found.business }, found);
  }

  if (usable.length === 0) {
    if (!required) return { ...base, hasBusiness: false };
    throw new AppError('You do not belong to any business yet', { status: 403, code: 'NO_BUSINESS_ACCESS' });
  }

  const preferred =
    usable.find((m) => String(m.business._id) === String(user.lastActiveBusiness)) ??
    usable.sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))[0];

  return decorate({ ...base, membership: preferred, business: preferred.business }, preferred);
}

function decorate(ctx, membership) {
  ctx.businessId = membership.business._id;
  ctx.role = membership.role;
  ctx.overrides = membership.permissionOverrides ?? null;
  ctx.permissions = permissionsForRole(membership.role);
  ctx.ownRecordsOnly = Boolean(membership.scope?.ownRecordsOnly);
  ctx.isOwner = membership.role === 'owner';
  return ctx;
}

/**
 * Base filter every tenant-scoped read must include.
 * @param {object} ctx
 * @param {object} [filter]
 */
export function scope(ctx, filter = {}) {
  return { ...filter, business: ctx.businessId };
}

/**
 * Additionally restrict to documents created by this user when the membership
 * carries the `ownRecordsOnly` data scope.
 */
export function scopeRead(ctx, filter = {}) {
  const base = scope(ctx, filter);
  if (ctx.ownRecordsOnly) base.createdBy = ctx.userId;
  return base;
}

/** Guard a single business id (route params etc.). */
export function assertBusinessAccess(ctx, businessId) {
  if (!businessId) return;
  if (String(businessId) !== String(ctx.businessId)) {
    throw AppError.forbidden('Cross-business access is not permitted');
  }
}

/** Permission check that respects per-member overrides. */
export function assertPermission(ctx, permission) {
  if (!ctx?.role) throw AppError.forbidden();
  if (!roleHasPermission(ctx.role, permission, ctx.overrides)) {
    throw AppError.forbidden(`Your role (${ctx.role}) cannot perform "${permission}"`);
  }
  return true;
}

export function assertAnyPermission(ctx, permissions) {
  const ok = permissions.some((p) => roleHasPermission(ctx.role, p, ctx.overrides));
  if (!ok) throw AppError.forbidden(`Your role (${ctx.role}) cannot perform this action`);
  return true;
}

export function assertEveryPermission(ctx, permissions) {
  if (!roleHasEveryPermission(ctx.role, permissions, ctx.overrides)) {
    throw AppError.forbidden(`Your role (${ctx.role}) cannot perform this action`);
  }
  return true;
}

/** Minimum-role checks for genuinely privileged operations. */
export function assertRole(ctx, minimumRole) {
  if (!isAtLeast(ctx.role, minimumRole)) {
    throw AppError.forbidden(`This action requires the ${minimumRole} role or higher`);
  }
  return true;
}

/** Workspaces the user can switch to. */
export async function listAccessibleBusinesses(userId) {
  const memberships = await BusinessMembership.find({
    user: userId,
    status: 'active',
    deletedAt: null,
  })
    .populate('business', 'name logoUrl settings status subscription stats')
    .sort({ lastActiveAt: -1, createdAt: 1 })
    .lean();

  return memberships
    .filter((m) => m.business)
    .map((m) => ({
      id: m.business._id,
      name: m.business.name,
      logoUrl: m.business.logoUrl,
      role: m.role,
      permissions: permissionsForRole(m.role),
      currency: m.business.settings?.currency ?? 'NPR',
      currencySymbol: m.business.settings?.currencySymbol ?? 'Rs.',
      timezone: m.business.settings?.timezone ?? 'Asia/Kathmandu',
      plan: m.business.subscription?.plan ?? 'free',
      joinedAt: m.joinedAt,
      lastActiveAt: m.lastActiveAt,
    }));
}

export function can(ctx, permission) {
  return roleHasPermission(ctx.role, permission, ctx.overrides);
}

export default {
  resolveBusinessContext,
  scope,
  scopeRead,
  assertPermission,
  assertAnyPermission,
  assertEveryPermission,
  assertRole,
  assertBusinessAccess,
  listAccessibleBusinesses,
  can,
};
