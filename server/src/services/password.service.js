/**
 * Password hashing.
 *
 * Uses argon2id — the current OWASP first choice (memory-hard, salted, with an
 * additional pepper from configuration). Kept behind a single module so it can
 * be swapped without touching call sites.
 */
import argon2 from 'argon2';
import crypto from 'node:crypto';
import env from '../config/env.js';

const OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB — OWASP recommendation
  timeCost: 3,
  parallelism: 4,
});

/** pepper is applied before hashing so a DB leak alone cannot mount a dictionary attack. */
function withPepper(password) {
  return `${password}${env.auth.pepper}`;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password is required');
  }
  return argon2.hash(withPepper(password), OPTIONS);
}

export async function verifyPassword(hash, password) {
  if (!hash || typeof password !== 'string') return false;
  try {
    return await argon2.verify(hash, withPepper(password));
  } catch {
    return false;
  }
}

/**
 * True when a stored hash uses weaker parameters than the current policy, so
 * the user is transparently upgraded on their next successful login.
 */
export function needsRehash(hash) {
  if (!hash) return true;
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return true;
  }
}

const LEGACY_BCRYPT = /^\$2[aby]\$/;

/** One-way migration path for accounts still on bcrypt. */
export function isLegacyHash(hash) {
  return LEGACY_BCRYPT.test(String(hash));
}

export async function verifyLegacy(hash, password) {
  if (!isLegacyHash(hash)) return false;
  const bcrypt = await import('bcryptjs').catch(() => null);
  if (!bcrypt) return false;
  return bcrypt.compare(password, hash).catch(() => false);
}

/** Opaque token for email verification / password reset (never a JWT). */
export function generateOpaqueToken(bytes = 32) {
  const token = crypto.randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Tokens are stored hashed, so a database leak yields no usable tokens. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(`${token}${env.auth.pepper}`).digest('hex');
}

/**
 * Burn roughly the same CPU as a real verification. Called on unknown-email
 * logins so response time does not reveal whether an account exists.
 */
// `let`, not `const`: the hash is computed once on first use and reused after.
// Declaring it `const` would throw a TypeError on the very first unknown-email
// login, turning an expected 401 into a 500.
let dummyHash = null;

export async function fakeVerify() {
  if (!dummyHash) {
    dummyHash = await argon2.hash(withPepper(crypto.randomBytes(24).toString('hex')), OPTIONS);
  }
  try {
    await argon2.verify(dummyHash, withPepper(crypto.randomBytes(24).toString('hex')));
  } catch {
    /* expected: the comparison is always a mismatch */
  }
}

export default { hashPassword, verifyPassword, needsRehash, generateOpaqueToken, hashToken, fakeVerify };
