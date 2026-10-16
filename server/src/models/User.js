import mongoose from 'mongoose';
import { sanitized } from './plugins.js';
import { ROLE_LABELS } from '../../../shared/constants.js';

const { Schema } = mongoose;

/** Preferred contact channel the user wants notifications on. */
const PREFERENCES = {
  language: { type: String, default: 'en' },
  timezone: { type: String, default: 'Asia/Kathmandu' },
  notifications: {
    email: { type: Boolean, default: true },
    lowStock: { type: Boolean, default: true },
    overdueInvoices: { type: Boolean, default: true },
  },
  theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
};

/**
 * One refresh-token session.
 * `tokenHash` is `select: false` so it can never leak through an ordinary read;
 * only `findByRefreshTokenHash` opts into it.
 */
const sessionSchema = new Schema(
  {
    jti: { type: String, required: true },
    tokenHash: { type: String, required: true, select: false },
    userAgent: { type: String, default: null, maxlength: 400 },
    ip: { type: String, default: null, maxlength: 64 },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    /** When the rotation happened. Distinguishes a benign replay from a leak. */
    rotatedAt: { type: Date, default: null },
    replacedByJti: { type: String, default: null },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, minlength: 2 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      maxlength: 254,
    },
    /** argon2id hash -— never a raw or reversible password. */
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true, maxlength: 24, default: null },
    avatarUrl: { type: String, trim: true, maxlength: 500, default: null },

    status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active', index: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null, select: false },

    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
    /** Failed login counter for brute-force lockout. */
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },

    /** Refresh token families let us revoke a whole device/session tree. */
    sessions: { type: [sessionSchema], default: [] },

    preferences: { type: PREFERENCES, default: () => ({}) },
    lastActiveBusiness: { type: Schema.Types.ObjectId, ref: 'Business', default: null },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// We intentionally do NOT index deletedAt-only lookups; login path is by email.
userSchema.index({ status: 1, deletedAt: 1 });
userSchema.index({ 'sessions.expiresAt': 1 });

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
});

userSchema.methods.isSessionActive = function isSessionActive(jti) {
  return (this.sessions || []).some(
    (s) => s.jti === jti && !s.revokedAt && s.expiresAt.getTime() > Date.now()
  );
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    avatarUrl: this.avatarUrl,
    status: this.status,
    emailVerified: this.emailVerified,
    lastLoginAt: this.lastLoginAt,
    preferences: this.preferences,
    createdAt: this.createdAt,
  };
};

userSchema.statics.findByEmail = function findByEmail(email, withSecrets = false) {
  const query = this.findOne({ email: String(email).toLowerCase().trim(), deletedAt: null });
  return withSecrets ? query.select('+passwordHash +emailVerificationTokenHash +passwordResetTokenHash') : query;
};

/**
 * Login lookup. The password hash is `select: false` everywhere else, so it is
 * opted into here explicitly  never leak it on an ordinary read.
 */
userSchema.statics.findForAuthentication = function findForAuthentication(email) {
  return this.findOne({ email: String(email).toLowerCase().trim(), deletedAt: null }).select('+passwordHash');
};

/** Refresh-token rotation needs to read the stored token hash. */
userSchema.statics.findByRefreshTokenHash = function findByRefreshTokenHash(tokenHash) {
  return this.findOne({ 'sessions.tokenHash': tokenHash }).select('+sessions.tokenHash');
};

sanitized(userSchema, { remove: ['passwordHash', 'sessions', 'emailVerificationTokenHash', 'passwordResetTokenHash'] });

export const ROLE_ENUM = Object.keys(ROLE_LABELS);
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
