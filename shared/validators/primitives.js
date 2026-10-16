/**
 * Reusable Zod primitives. Exported so feature schemas stay short and the
 * server never accepts a shape the client would have rejected.
 */
import { z } from 'zod';

/** Mongo ObjectId (24 hex chars) — safe to use without pulling mongoose in. */
export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid identifier')
  .transform((v) => v);

export const objectIdOrNull = z.union([objectId, z.literal(''), z.null()]).transform((v) => (v ? v : null));

/** ISO date (yyyy-mm-dd) or full ISO datetime. Normalised to a Date. */
export const dateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
  .transform((v) => new Date(v));

export const optionalDate = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

export const requiredDate = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((v) => !Number.isNaN(v.getTime()), 'Invalid date');

/** A decimal money input as typed by a human: "1,250.50" or 1250.5 */
export const moneyInput = z
  .union([z.string(), z.number()])
  .refine((v) => {
    try {
      const raw = typeof v === 'number' ? String(v) : String(v).trim().replace(/[\s\u00a0\u202f]/g, '');
      return raw !== '' && /^-?[\d.,]*\d$/.test(raw);
    } catch {
      return false;
    }
  }, 'Enter a valid amount')
  .transform((v) => (typeof v === 'number' ? v : v.trim()));

/**
 * An optional amount, where leaving the field blank means "not specified".
 *
 * `moneyInput` deliberately rejects an empty string, which is right for a
 * required amount but wrong for an optional one: a blank "What you already
 * owed" box was reported as "Enter a valid amount" and blocked saving a
 * supplier outright. Nullish and empty collapse to null, which the services
 * already read as zero.
 */
export const optionalMoney = z
  .union([moneyInput, z.literal(''), z.null(), z.undefined()])
  .transform((v) => {
    if (v === '' || v === null || v === undefined) return null;
    return typeof v === 'number' ? v : v.trim();
  });

export const nonnegativeMoneyInput = moneyInput.refine((v) => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n >= 0 : true;
}, 'Amount cannot be negative');

export const positiveMoneyInput = moneyInput.refine((v) => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n > 0 : false;
}, 'Amount must be greater than zero');

/** Quantities: integers for discrete units, decimals for kg/litre. */
export const quantityInput = z
  .union([z.string(), z.number()])
  .refine((v) => {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n);
  }, 'Enter a valid quantity')
  .refine((v) => {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return n > 0;
  }, 'Quantity must be greater than zero')
  .transform((v) => Number(typeof v === 'number' ? v : String(v).trim()));

export const nonNegativeQuantity = z
  .union([z.string(), z.number()])
  .refine((v) => Number.isFinite(Number(v)), 'Enter a valid quantity')
  .refine((v) => Number(v) >= 0, 'Quantity cannot be negative')
  .transform((v) => Number(v));

export const percentInput = z
  .union([z.string(), z.number()])
  .refine((v) => Number.isFinite(Number(v)), 'Enter a valid percentage')
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Percentage must be between 0 and 100')
  .transform((v) => Number(v));

export const phoneInput = z
  .string()
  .trim()
  .min(7, 'Phone number is too short')
  .max(24, 'Phone number is too long')
  .regex(/^[+]?[\d\s\-()]{7,24}$/, 'Enter a valid phone number');

export const optionalPhone = z.union([phoneInput, z.literal(''), z.null()]).optional();

export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254, 'Email is too long');

export const optionalEmail = z.union([emailInput, z.literal(''), z.null()]).optional();

export const nameInput = z
  .string()
  .trim()
  .min(2, 'Must be at least 2 characters')
  .max(120, 'Must be at most 120 characters');

/**
 * Optional free text. Use `requiredShortText` when a value is mandatory.
 * Note: in Zod `z.string()` is required by default, so this deliberately
 * appends `.optional()` rather than leaving it implied.
 */
export const shortText = (max = 200, label = 'Text') =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`).optional();

export const requiredShortText = (max = 200, label = 'Text') =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

export const passwordInput = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Include a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Include an uppercase letter')
  .refine((v) => /\d/.test(v), 'Include a number')
  .refine(
    (v) => !/(.)\1{3,}/.test(v),
    'Password is too repetitive'
  );

/**
 * Pagination. `limit` is hard-capped server-side so a hostile client cannot
 * ask for the entire collection.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().trim().max(60).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(120).optional(),
});

export const dateRangeBaseSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  preset: z.enum(['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'custom', 'all']).optional(),
  timezone: z.string().trim().max(64).optional(),
});

export const dateRangeSchema = dateRangeBaseSchema
  .transform((v) => {
    if (v.preset === 'all' || (!v.from && !v.to)) return { from: null, to: null, preset: v.preset ?? 'custom' };
    return v;
  })
  .refine((v) => !v.from || !v.to || v.from.getTime() <= v.to.getTime(), {
    message: 'Start date must be before end date',
    path: ['from'],
  });

/** Escapes user input before it is placed into a RegExp for search. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sortDirection = (order) => (order === 'asc' ? 1 : -1);

/** Whitelist-based sort: never pass raw client strings to Mongoose `sort`. */
export function safeSort(sort, allowed, fallback) {
  const key = allowed.includes(sort) ? sort : fallback;
  return key;
}

export const idArray = z
  .array(objectId)
  .min(1, 'Select at least one item')
  .max(200, 'Too many items selected');

/** Idempotency: a client-generated key that prevents duplicate submissions. */
export const idempotencyKey = z.string().trim().min(8).max(128).optional();

export const reasonInput = requiredShortText(280, 'Reason');

/** Strip unknown keys — protects against mass-assignment of internal fields. */
export function pick(source, keys) {
  const out = {};
  for (const k of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined) {
      out[k] = source[k];
    }
  }
  return out;
}

/** Zod middleware-friendly error formatter. */
export function formatZodError(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
    code: issue.code,
  }));
}
