import crypto from 'node:crypto';

export const APP_NAME = 'SajiloLekha';
export const APP_VERSION = '1.0.0';
export const API_PREFIX = '/api';

/** Cryptographically strong, URL-safe opaque token. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Constant-time string compare that tolerates length mismatch. */
export function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so timing does not leak the length check.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Human-facing document reference, e.g. SAL-2024-00042. */
export function buildReference(prefix, sequence, { pad = 5, year = new Date().getFullYear() } = {}) {
  return `${prefix}-${year}-${String(sequence).padStart(pad, '0')}`;
}

export function buildPublicCode(prefix, length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${out}`;
}

/** CSV escaping per RFC 4180 — prevents spreadsheet formula injection. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // formula-injection guard
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c.header ?? c.key)).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','))
    .join('\r\n');
  return `${header}\r\n${body}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded exponential backoff with jitter for retryable operations. */
export async function withRetry(fn, { attempts = 3, baseDelayMs = 40, factor = 2 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = err?.code === 11000 || err?.labels?.includes('TransientTransactionError');
      if (!retryable || i === attempts - 1) throw err;
      await sleep(baseDelayMs * factor ** i * (0.5 + Math.random() / 2));
    }
  }
  throw lastError;
}

/** Accepts `a,b,c` or repeated query params and returns a clean array. */
export function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(toArray);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
