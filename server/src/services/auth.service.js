/**
 * Authentication + session lifecycle.
 *
 * Token strategy
 *   - Access token: short-lived signed JWT, sent as a Bearer header. Stateless.
 *   - Refresh token: long-lived opaque random string delivered ONLY in an
 *     HttpOnly + SameSite + Secure cookie. The server stores only its SHA-256
 *     hash (peppered), so the database cannot be used to mint sessions.
 *   - Refresh rotation: every use issues a new token and revokes the old one.
 *     Reuse of a revoked token revokes the entire family (theft detection).
 */
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import env from '../config/env.js';
import User from '../models/User.js';
import Business from '../models/Business.js';
import BusinessMembership from '../models/BusinessMembership.js';
import { AppError } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import {
  fakeVerify,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  isLegacyHash,
  needsRehash,
  verifyLegacy,
  verifyPassword,
} from './password.service.js';

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function parseDuration(spec) {
  const match = /^(\d+)([smhd])$/.exec(String(spec));
  if (!match) return 60 * 1000;
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return value * unit;
}

export const ACCESS_TTL_SECONDS = Math.floor(parseDuration(env.auth.accessTtl) / 1000);
export const REFRESH_TTL_MS = parseDuration(env.auth.refreshTtl);

/* ------------------------------------------------------------- TOKENS --- */

export function signAccessToken(user, membership = null) {
  const payload = {
    sub: user._id.toString(),
    email: user.email,
    name: user.name,
    // The active business is a convenience claim only. Every request re-verifies
    // membership server-side, so a tampered claim cannot widen access.
    biz: membership?.business?.toString() ?? null,
    role: membership?.role ?? null,
    typ: 'access',
  };
  return jwt.sign(payload, env.auth.accessSecret, {
    expiresIn: env.auth.accessTtl,
    issuer: env.auth.issuer,
    audience: env.auth.audience,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.auth.accessSecret, {
      issuer: env.auth.issuer,
      audience: env.auth.audience,
      algorithms: ['HS256'],
    });
    if (payload.typ !== 'access') throw AppError.unauthorized('Invalid token type');
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Session expired', { status: 401, code: 'TOKEN_EXPIRED' });
    }
    throw AppError.unauthorized('Invalid authentication token');
  }
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: env.cookies.sameSite,
    domain: env.cookies.domain,
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  };
}

export function setRefreshCookie(res, token) {
  res.cookie(env.cookies.refreshName, token, refreshCookieOptions());
}

export function clearRefreshCookie(res) {
  res.clearCookie(env.cookies.refreshName, { ...refreshCookieOptions(), maxAge: undefined });
}

/* --------------------------------------------------------- REGISTRATION -- */

/**
 * Registers a user and their first business in a single transaction so a
 * partially-created account can never exist.
 */
export async function registerUser({ name, email, password, phone, businessName, businessCurrency, businessTimezone }, ctx = {}) {
  const existing = await User.findByEmail(email);
  if (existing) {
    throw AppError.conflict('An account with this email already exists', { fields: ['email'] });
  }

  const passwordHash = await hashPassword(password);

  const session = await mongoose.startSession();
  try {
    let user;
    let business;
    await session.withTransaction(async () => {
      user = await User.create(
        [
          {
            name,
            email,
            phone: phone || null,
            passwordHash,
            emailVerified: env.isProduction ? false : true,
          },
        ],
        { session }
      );
      user = user[0];

      business = await Business.create(
        [
          {
            name: businessName,
            email,
            phone: phone || '',
            settings: {
              ...(businessCurrency ? { currency: businessCurrency } : {}),
              ...(businessTimezone ? { timezone: businessTimezone } : {}),
            },
            createdBy: user._id,
          },
        ],
        { session }
      );
      business = business[0];

      await BusinessMembership.create(
        [
          {
            user: user._id,
            business: business._id,
            role: 'owner',
            status: 'active',
            joinedAt: new Date(),
          },
        ],
        { session }
      );

      await user.updateOne({ $set: { lastActiveBusiness: business._id } }, { session });
    });

    await recordAudit({
      business: business._id,
      actor: user,
      role: 'owner',
      action: 'business.create',
      entity: 'Business',
      entityId: business._id,
      changes: { created: business.name, owner: user.email },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { user, business };
  } catch (err) {
    if (err?.code === 11000) {
      throw AppError.conflict('An account with this email already exists', { fields: ['email'] });
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/* ---------------------------------------------------------------- LOGIN -- */

export async function loginUser({ email, password, businessId }, ctx = {}) {
  const user = await User.findForAuthentication(email);

  // Constant-ish work whether or not the account exists.
  if (!user) {
    await fakeVerify();
    await recordAudit({
      business: null,
      actorName: email,
      action: 'auth.login_failed',
      entity: 'User',
      changes: { reason: 'unknown_email' },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw AppError.unauthorized('Incorrect email or password');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(`Too many failed attempts. Try again in ${minutes} minute(s).`, {
      status: 423,
      code: 'ACCOUNT_LOCKED',
    });
  }

  if (user.status === 'suspended') {
    throw AppError.forbidden('This account has been suspended');
  }

  const hash = user.passwordHash;
  const valid = isLegacyHash(hash)
    ? await verifyLegacy(hash, password)
    : await verifyPassword(hash, password);

  if (!valid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: lockUntil ? 0 : attempts, lockedUntil: lockUntil } }
    );
    await recordAudit({
      business: null,
      actor: user,
      action: 'auth.login_failed',
      entity: 'User',
      entityId: user._id,
      changes: { attempts, locked: Boolean(lockUntil) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw AppError.unauthorized('Incorrect email or password');
  }

  // Transparent upgrade of legacy hashes and any parameter drift.
  if (needsRehash(hash)) {
    const upgraded = await hashPassword(password);
    user.passwordHash = upgraded;
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.lastLoginIp = ctx.ip ?? null;

  const membership = await pickMembership(user, businessId);
  if (membership) user.lastActiveBusiness = membership.business._id;
  await user.save();

  await recordAudit({
    business: membership?.business?._id ?? null,
    actor: user,
    role: membership?.role,
    action: 'auth.login',
    entity: 'User',
    entityId: user._id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { user, membership };
}

/** Choose the requested workspace, else the last used, else the first active. */
export async function pickMembership(user, requestedBusinessId) {
  const memberships = await BusinessMembership.find({
    user: user._id,
    status: 'active',
    deletedAt: null,
  })
    .populate('business', 'name logoUrl settings status deletedAt')
    .sort({ lastActiveAt: -1, createdAt: 1 })
    .lean();

  const usable = memberships.filter((m) => m.business && !m.business.deletedAt);
  if (usable.length === 0) return null;

  if (requestedBusinessId) {
    const match = usable.find((m) => String(m.business._id) === String(requestedBusinessId));
    // A valid user asking for a workspace they do not belong to must get a 403,
    // not silently a different workspace.
    if (!match) {
      throw AppError.forbidden('You do not have access to this business');
    }
    return match;
  }

  const preferred = usable.find((m) => String(m.business._id) === String(user.lastActiveBusiness));
  return preferred ?? usable[0];
}

/* -------------------------------------------------------------- SESSIONS -- */

export async function issueSession(user, ctx = {}) {
  const { token, hash } = generateOpaqueToken(48);
  const { token: jti } = generateOpaqueToken(16);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        sessions: {
          jti,
          tokenHash: hash,
          userAgent: ctx.userAgent ?? null,
          ip: ctx.ip ?? null,
          createdAt: new Date(),
          expiresAt,
          lastUsedAt: new Date(),
        },
      },
    }
  );

  // Opportunistic cleanup so the array cannot grow without bound.
  await User.updateOne(
    { _id: user._id },
    { $pull: { sessions: { $or: [{ expiresAt: { $lt: new Date() } }, { revokedAt: { $ne: null } }] } } },
    { ignoreUndefined: true }
  ).catch(() => {});

  return { token, jti, expiresAt };
}

/**
 * How long a just-rotated token stays acceptable.
 *
 * Rotation is not atomic with the browser receiving the replacement cookie, so
 * a client can legitimately present the previous token a moment after it was
 * rotated -- a double refresh, a retried request, two tabs waking together.
 * Treating that as a stolen token signs the user out of every device, which is
 * a far worse outcome than the narrow window it defends.
 *
 * Outside the window, or with no recorded rotation, the strict reuse rule
 * applies. Set REFRESH_ROTATION_GRACE_MS=0 to disable it entirely.
 */
const ROTATION_GRACE_MS = Number.parseInt(process.env.REFRESH_ROTATION_GRACE_MS ?? '15000', 10) || 0;

/**
 * Validates and rotates a refresh token.
 * Presenting an already-rotated token means it leaked: kill the whole family.
 */
export async function rotateSession(refreshToken, ctx = {}) {
  if (!refreshToken) throw AppError.unauthorized('Refresh token missing');

  const tokenHash = hashToken(refreshToken);
  const user = await User.findByRefreshTokenHash(tokenHash);

  if (!user) throw AppError.unauthorized('Session is no longer valid');

  const session = user.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) throw AppError.unauthorized('Session is no longer valid');

  if (session.revokedAt) {
    // A rotation that happened moments ago is a client race, not a leak.
    const rotatedAt = session.rotatedAt ?? session.revokedAt;
    const withinGrace =
      ROTATION_GRACE_MS > 0 && Date.now() - new Date(rotatedAt).getTime() < ROTATION_GRACE_MS;

    if (withinGrace && session.replacedByJti) {
      const successor = user.sessions.find(
        (s) => s.jti === session.replacedByJti && !s.revokedAt && s.expiresAt.getTime() > Date.now()
      );
      if (successor) {
        // Issue a fresh branch from the still-live successor rather than
        // punishing the user for a race they did not cause.
        const next = await issueSession(user, ctx);
        await User.updateOne(
          { _id: user._id },
          { $set: { 'sessions.$[s].revokedAt': new Date(), 'sessions.$[s].rotatedAt': new Date(), 'sessions.$[s].replacedByJti': next.jti, 'sessions.$[s].lastUsedAt': new Date() } },
          { arrayFilters: [{ 's.jti': successor.jti }] }
        );
        const membership = await pickMembership(user, null);
        return { user, refreshToken: next.token, membership, recoveredRace: true };
      }
    }

    await User.updateOne({ _id: user._id }, { $set: { 'sessions.$[].revokedAt': new Date() } });
    await recordAudit({
      business: null,
      actor: user,
      action: 'auth.logout',
      entity: 'User',
      entityId: user._id,
      changes: { reason: 'refresh_token_reuse_detected', allSessionsRevoked: true },
      ip: ctx.ip,
    });
    throw new AppError('Session revoked for your security. Please sign in again.', {
      status: 401,
      code: 'TOKEN_REUSE_DETECTED',
    });
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError('Session expired, please sign in again', { status: 401, code: 'TOKEN_EXPIRED' });
  }

  const next = await issueSession(user, ctx);

  // Retire the presented token. `replacedByJti` records the rotation chain so a
  // later forensic pass can reconstruct the session lineage; `rotatedAt` lets a
  // replay inside the grace window be told apart from a stolen token.
  await User.updateOne(
    { _id: user._id },
    { $set: { 'sessions.$[s].revokedAt': new Date(), 'sessions.$[s].rotatedAt': new Date(), 'sessions.$[s].replacedByJti': next.jti, 'sessions.$[s].lastUsedAt': new Date() } },
    { arrayFilters: [{ 's.tokenHash': tokenHash }] }
  );

  const membership = await pickMembership(user, null);
  return { user, refreshToken: next.token, membership };
}

export async function revokeSession(refreshToken) {
  if (!refreshToken) return false;
  const tokenHash = hashToken(refreshToken);

  // The raw token is the only thing the caller has, so the owning user is
  // resolved from the hash rather than taken as a parameter.
  const user = await User.findByRefreshTokenHash(tokenHash);
  if (!user) return false;

  const result = await User.updateOne(
    { _id: user._id },
    { $set: { 'sessions.$[s].revokedAt': new Date(), 'sessions.$[s].tokenHash': '' } },
    { arrayFilters: [{ 's.tokenHash': tokenHash, 's.revokedAt': null }] }
  ).catch(() => null);
  return Boolean(result?.modifiedCount);
}

export async function revokeAllSessions(userId, exceptJti = null) {
  if (exceptJti) {
    return User.updateOne(
      { _id: userId },
      { $set: { 'sessions.$[s].revokedAt': new Date(), 'sessions.$[s].tokenHash': '' } },
      { arrayFilters: [{ 's.revokedAt': null, 's.jti': { $ne: exceptJti } }] }
    );
  }
  return User.updateOne(
    { _id: userId },
    { $set: { 'sessions.$[]s.revokedAt': new Date(), 'sessions.$[]s.tokenHash': '' } }
  );
}

/**
 * Update the signed-in user's own details.
 *
 * Only the fields on `updateProfileSchema` are touched, and the email is
 * deliberately NOT among them: changing a sign-in identifier needs
 * re-verification, so it goes through a dedicated, audited flow rather than
 * being a free-text field in the profile form.
 */
export async function changeProfile(user, payload = {}) {
  const updates = {};

  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.phone !== undefined) updates.phone = payload.phone || null;
  if (payload.avatarUrl !== undefined) updates.avatarUrl = payload.avatarUrl || null;

  // Locale and time zone live under `preferences` on the schema, so the flat
  // payload keys are mapped onto their stored paths here rather than creating
  // top-level fields that do not exist.
  if (payload.locale !== undefined) updates['preferences.language'] = payload.locale;
  if (payload.timezone !== undefined) updates['preferences.timezone'] = payload.timezone;

  if (Object.keys(updates).length === 0) return user;

  const updated = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true, runValidators: true });
  if (!updated) throw AppError.notFound('User not found');

  return updated;
}

export async function listSessions(userId) {
  const user = await User.findById(userId).select('sessions').lean();
  return (user?.sessions ?? [])
    .filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now())
    .map((s) => ({
      jti: s.jti,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
    }));
}

/* ------------------------------------------------------- PASSWORD MGMT -- */

export async function changePassword(userId, { currentPassword, newPassword }, ctx = {}) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw AppError.notFound('User not found');

  const valid = isLegacyHash(user.passwordHash)
    ? await verifyLegacy(user.passwordHash, currentPassword)
    : await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) throw AppError.badRequest('Current password is incorrect', { fields: ['currentPassword'] });

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await revokeAllSessions(userId);
  await recordAudit({
    business: user.lastActiveBusiness,
    actor: user,
    action: 'auth.password_change',
    entity: 'User',
    entityId: user._id,
    ip: ctx.ip,
  });

  return user;
}

export async function requestPasswordReset(email) {
  const user = await User.findByEmail(email, true);
  // Always resolve successfully: revealing which emails exist is a leak.
  if (!user) return { sent: true };

  const { token, hash } = generateOpaqueToken(32);
  user.passwordResetTokenHash = hash;
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  return { sent: true, token: env.isProduction ? undefined : token };
}

export async function resetPassword({ token, password }, ctx = {}) {
  const hash = hashToken(token);
  const user = await User.findOne({
    passwordResetTokenHash: hash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordHash');
  if (!user) throw AppError.badRequest('This reset link is invalid or has expired');

  user.passwordHash = await hashPassword(password);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await revokeAllSessions(user._id);
  await recordAudit({
    business: user.lastActiveBusiness,
    actor: user,
    action: 'auth.password_reset',
    entity: 'User',
    entityId: user._id,
    ip: ctx.ip,
  });

  return user;
}

export async function verifyEmail(token) {
  const hash = hashToken(token);
  const user = await User.findOne({ emailVerificationTokenHash: hash }).select('+emailVerificationTokenHash');
  if (!user) throw AppError.badRequest('Verification link is invalid or has already been used');
  user.emailVerified = true;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();
  return user;
}

export { MAX_FAILED_ATTEMPTS };
