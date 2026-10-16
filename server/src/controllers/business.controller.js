/**
 * Business + membership + settings controller.
 *
 * Creating a second workspace, inviting a member, changing roles and editing
 * settings all live here. Role changes and ownership transfer are owner-only.
 */
import mongoose from 'mongoose';
import Business from '../models/Business.js';
import BusinessMembership from '../models/BusinessMembership.js';
import User from '../models/User.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import { listAccessibleBusinesses } from '../services/tenant.service.js';
import { recordAudit } from '../services/audit.service.js';
import { withTransaction } from '../services/transaction.service.js';
import { currencyMeta, permissionsForRole, roleHasPermission } from '../../../shared/constants.js';

export const list = asyncHandler(async (req, res) => {
  return sendOk(res, await listAccessibleBusinesses(req.user._id));
});

export const create = asyncHandler(async (req, res) => {
  const currency = req.body.currency ? currencyMeta(req.body.currency) : null;
  if (currency) req.body.settings = { ...(req.body.settings ?? {}), currency: currency.code, currencySymbol: currency.symbol, currencyDecimals: currency.decimals, locale: currency.locale };

  const business = await withTransaction(async ({ session }) => {
    const [doc] = await Business.create([{ ...req.body, createdBy: req.user._id }], { session });
    await BusinessMembership.create(
      [{ user: req.user._id, business: doc._id, role: 'owner', status: 'active', joinedAt: new Date() }],
      { session }
    );
    await req.user.updateOne({ $set: { lastActiveBusiness: doc._id } });
    return doc;
  });

  await recordAudit({
    business: business._id,
    actor: req.user,
    role: 'owner',
    action: 'business.create',
    entity: 'Business',
    entityId: business._id,
    changes: { name: business.name },
    ip: req.ip,
  });

  return sendCreated(res, business);
});

export const current = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ _id: req.ctx.businessId, deletedAt: null }).lean();
  if (!business) throw AppError.notFound('Business not found');
  return sendOk(res, business);
});

export const update = asyncHandler(async (req, res) => {
  const payload = { ...req.body };

  // Settings are nested one level deep; merge rather than replace so a partial
  // settings patch never wipes unrelated configuration.
  if (payload.settings) {
    const current = await Business.findOne({ _id: req.ctx.businessId }).select('settings').lean();
    payload.settings = { ...current.settings, ...payload.settings };
    if (payload.settings.currency) {
      const meta = currencyMeta(payload.settings.currency);
      payload.settings.currencySymbol = payload.settings.currencySymbol || meta.symbol;
      payload.settings.currencyDecimals = payload.settings.currencyDecimals ?? meta.decimals;
      payload.settings.locale = payload.settings.locale || meta.locale;
    }
  }
  delete payload.businessId;

  const before = await Business.findOne({ _id: req.ctx.businessId }).lean();
  const business = await Business.findOneAndUpdate(
    { _id: req.ctx.businessId, deletedAt: null },
    { $set: { ...payload, updatedBy: req.user._id } },
    { new: true, runValidators: true }
  );
  if (!business) throw AppError.notFound('Business not found');

  await recordAudit({
    business: req.ctx.businessId,
    actor: req.user,
    role: req.ctx.role,
    action: Object.keys(payload).includes('settings') ? 'settings.update' : 'business.update',
    entity: 'Business',
    entityId: business._id,
    changes: { before: { name: before.name, settings: before.settings }, after: { name: business.name, settings: business.settings } },
    ip: req.ip,
  });

  return sendOk(res, business);
});

/* ------------------------------------------------------------ MEMBERS --- */

export const listMembers = asyncHandler(async (req, res) => {
  const members = await BusinessMembership.find({ business: req.ctx.businessId, deletedAt: null })
    .populate('user', 'name email phone avatarUrl status lastLoginAt emailVerified')
    .populate('invitedBy', 'name')
    .sort({ createdAt: 1 })
    .lean();

  return sendOk(
    res,
    members.map((m) => ({
      id: m._id,
      user: m.user,
      role: m.role,
      status: m.status,
      permissions: permissionsForRole(m.role),
      permissionOverrides: m.permissionOverrides,
      scope: m.scope,
      joinedAt: m.joinedAt,
      lastActiveAt: m.lastActiveAt,
      invitedBy: m.invitedBy,
      invitedAt: m.invitedAt,
    }))
  );
});

export const inviteMember = asyncHandler(async (req, res) => {
  const existingUser = await User.findByEmail(req.body.email);
  if (existingUser) {
    const already = await BusinessMembership.exists({
      user: existingUser._id,
      business: req.ctx.businessId,
      deletedAt: null,
    });
    if (already) throw AppError.conflict('This person already belongs to the workspace', { fields: ['email'] });
  }

  const membership = await withTransaction(async ({ session }) => {
    let user = existingUser;
    if (!user) {
      // Invite by email: create a placeholder account. A password-reset link is
      // issued so the invitee sets their own credential (never a shared one).
      [user] = await User.create(
        [
          {
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone ?? null,
            status: 'pending',
            passwordHash: 'invitation-pending', // replaced on first sign-in
          },
        ],
        { session }
      );
    }

    const [doc] = await BusinessMembership.create(
      [
        {
          user: user._id,
          business: req.ctx.businessId,
          role: req.body.role ?? 'staff',
          status: user === existingUser ? 'invited' : 'invited',
          invitedBy: req.user._id,
          invitedAt: new Date(),
        },
      ],
      { session }
    );
    return doc;
  });

  await recordAudit({
    business: req.ctx.businessId,
    actor: req.user,
    role: req.ctx.role,
    action: 'member.invite',
    entity: 'BusinessMembership',
    entityId: membership._id,
    changes: { email: req.body.email, role: membership.role },
    ip: req.ip,
  });

  return sendCreated(res, {
    id: membership._id,
    role: membership.role,
    status: membership.status,
    permissions: permissionsForRole(membership.role),
    message: `Invitation prepared for ${req.body.email}`,
  });
});

export const updateMember = asyncHandler(async (req, res) => {
  const membership = await BusinessMembership.findOne({
    _id: req.params.id,
    business: req.ctx.businessId,
    deletedAt: null,
  });
  if (!membership) throw AppError.notFound('Member not found');

  // A user must never be able to remove or demote their own owner access, and
  // the last remaining owner must not be stripped of the owner role.
  if (String(membership.user) === String(req.user._id) && req.body.role && req.body.role !== membership.role) {
    throw AppError.badRequest('You cannot change your own role');
  }
  if (membership.role === 'owner' && req.body.role && req.body.role !== 'owner') {
    const ownerCount = await BusinessMembership.countDocuments({
      business: req.ctx.businessId,
      role: 'owner',
      status: 'active',
      deletedAt: null,
    });
    if (ownerCount <= 1) throw AppError.badRequest('A business must always have at least one owner');
  }
  if (req.body.permissionOverrides) {
    for (const key of ['allow', 'deny']) {
      for (const permission of req.body.permissionOverrides[key] ?? []) {
        if (!roleHasPermission('owner', permission)) {
          throw AppError.badRequest(`Unknown permission "${permission}"`);
        }
      }
    }
  }

  membership.set({ ...req.body });
  await membership.save();

  await recordAudit({
    business: req.ctx.businessId,
    actor: req.user,
    role: req.ctx.role,
    action: 'member.update',
    entity: 'BusinessMembership',
    entityId: membership._id,
    changes: req.body,
    ip: req.ip,
  });

  return sendOk(res, { id: membership._id, role: membership.role, status: membership.status, permissionOverrides: membership.permissionOverrides });
});

export const removeMember = asyncHandler(async (req, res) => {
  const membership = await BusinessMembership.findOne({
    _id: req.params.id,
    business: req.ctx.businessId,
    deletedAt: null,
  });
  if (!membership) throw AppError.notFound('Member not found');

  if (String(membership.user) === String(req.user._id)) {
    throw AppError.badRequest('You cannot remove yourself from the workspace');
  }
  if (membership.role === 'owner') {
    const ownerCount = await BusinessMembership.countDocuments({
      business: req.ctx.businessId,
      role: 'owner',
      status: 'active',
      deletedAt: null,
    });
    if (ownerCount <= 1) throw AppError.badRequest('A business must always have at least one owner');
  }

  membership.deletedAt = new Date();
  await membership.save();

  await recordAudit({
    business: req.ctx.businessId,
    actor: req.user,
    role: req.ctx.role,
    action: 'member.remove',
    entity: 'BusinessMembership',
    entityId: membership._id,
    changes: { role: membership.role, user: membership.user },
    ip: req.ip,
  });

  return sendOk(res, { removed: true });
});

/* ------------------------------------------------------------- STORAGE -- */

/** Attachment upload (logo, receipt, supplier invoice). */
export const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('No file was uploaded');
  const url = `/uploads/${req.file.filename}`;
  return sendCreated(res, {
    url,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
});

/** Overview counts for the settings page. */
export const stats = asyncHandler(async (req, res) => {
  const bid = new mongoose.Types.ObjectId(String(req.ctx.businessId));
  const [users, products, customers, suppliers, sales, invoices, categories] = await Promise.all([
    BusinessMembership.countDocuments({ business: bid, deletedAt: null }),
    mongoose.model('Product').countDocuments({ business: bid, deletedAt: null }),
    mongoose.model('Customer').countDocuments({ business: bid, deletedAt: null, isWalkIn: false }),
    mongoose.model('Supplier').countDocuments({ business: bid, deletedAt: null }),
    mongoose.model('Sale').countDocuments({ business: bid, deletedAt: null }),
    mongoose.model('Invoice').countDocuments({ business: bid, deletedAt: null }),
    mongoose.model('ProductCategory').countDocuments({ business: bid, deletedAt: null }),
  ]);

  return sendOk(res, {
    members: users,
    products,
    categories,
    customers,
    suppliers,
    sales,
    invoices,
  });
});
