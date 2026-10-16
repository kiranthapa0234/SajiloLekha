/**
 * Request validation middleware driven by the shared Zod schemas.
 *
 * The SAME schema object validates the React Hook Form payload on the client and
 * the HTTP body here, so a divergence between the two is not possible by
 * construction.
 */
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { formatZodError } from '../../../shared/validators/primitives.js';

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 * @param {{ strip?: boolean }} [options] strip removes unknown keys (default true)
 */
export function validate(schema, source = 'body', options = {}) {
  const { strip = true } = options;

  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req[source] ?? {});
      if (source === 'query') {
        // Express 5 makes req.query a getter; assigning to a local keeps it safe
        // and also keeps parsed values visible to later middleware.
        Object.defineProperty(req, 'validatedQuery', { value: parsed, writable: true, configurable: true });
        req.validated = { ...(req.validated ?? {}), query: parsed };
      } else if (source === 'params') {
        req.validated = { ...(req.validated ?? {}), params: parsed };
      } else {
        req.body = strip ? parsed : { ...req.body, ...parsed };
        req.validated = { ...(req.validated ?? {}), body: parsed };
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = formatZodError(err);
        return next(
          AppError.validation(
            details.find((d) => d.code === 'unrecognized_keys')
              ? `Unexpected field${details.length > 1 ? 's' : ''}: ${details
                  .filter((d) => d.code === 'unrecognized_keys')
                  .map((d) => d.field)
                  .join(', ')}`
              : 'Please correct the highlighted fields',
            details
          )
        );
      }
      return next(err);
    }
  };
}

/**
 * Guards against NoSQL operator injection at the HTTP boundary.
 *
 * This is the replacement for Mongoose's `sanitizeFilter`, which is unusable in
 * Mongoose 8 (it wraps range operators in `$eq` and breaks every date filter).
 *
 * Rule: a client may never send a key beginning with `$` or containing `.`.
 * Both are MongoDB query/field operators. Legitimate queries that need those
 * operators are built server-side from validated, server-derived values only.
 *
 * Runs before route matching so it covers every endpoint, including ones whose
 * body is not otherwise validated.
 */
const MAX_SCAN_DEPTH = 6;

/** Returns the first forbidden key path found, or null. */
export function findOperatorKey(value, depth = 0, trail = '') {
  if (depth > MAX_SCAN_DEPTH || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findOperatorKey(value[i], depth + 1, `${trail}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  // Dates and Buffers are leaves, not containers.
  if (value instanceof Date || Buffer.isBuffer(value)) return null;

  for (const [key, child] of Object.entries(value)) {
    const path = trail ? `${trail}.${key}` : key;
    if (key.startsWith('$')) return path;
    if (key.includes('.')) return path;
    const hit = findOperatorKey(child, depth + 1, path);
    if (hit) return hit;
  }
  return null;
}

export function rejectMongoOperators(req, _res, next) {
  for (const source of ['body', 'query', 'params']) {
    const payload = req[source];
    if (!payload || typeof payload !== 'object') continue;
    const offending = findOperatorKey(payload);
    if (offending) {
      return next(
        AppError.badRequest(
          `Invalid field name "${offending}". Query operators and dotted paths are not accepted from clients.`,
          { fields: [offending] }
        )
      );
    }
  }
  return next();
}

/** Validate a raw payload outside the Express pipeline (services, tests, jobs). */
export function parseOrThrow(schema, payload, message = 'Validation failed') {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw AppError.validation(message, formatZodError(result.error));
  }
  return result.data;
}

/**
 * Guards against mass assignment: any body key not present in the validated
 * output is dropped before it reaches a service.
 */
export function assertNoUnknownKeys(allowed, body) {
  const unknown = Object.keys(body ?? {}).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw AppError.badRequest(`Unexpected field(s): ${unknown.join(', ')}`, { fields: unknown });
  }
}

export default { validate, parseOrThrow, assertNoUnknownKeys, rejectMongoOperators };
