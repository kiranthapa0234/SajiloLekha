/**
 * Multi-tenancy middleware.
 *
 * Establishes `req.ctx` — the object every tenant-scoped service consumes.
 *
 * IMPORTANT: `req.ctx.businessId` comes from a verified BusinessMembership
 * lookup, never from the raw request. A request may *ask* for a workspace via
 * `X-Business-Id`, `?businessId=` or a `:businessId` route param, but the ask is
 * only ever honoured after the membership is proven.
 */
import { asyncHandler } from '../utils/errors.js';
import { resolveBusinessContext, scope, assertPermission, assertAnyPermission } from '../services/tenant.service.js';
import { recordAudit } from '../services/audit.service.js';

/** Where a client may legitimately request the active workspace from. */
const WORKSPACE_SOURCES = [
  (req) => req.headers['x-business-id'],
  (req) => req.query?.businessId,
  (req) => req.params?.businessId,
  (req) => req.body?.businessId,
];

export function readRequestedBusinessId(req) {
  for (const source of WORKSPACE_SOURCES) {
    const value = source(req);
    if (value && typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.required] 404-ish 403 when the user has no business
 * @param {string|string[]} [options.permission] gate applied after resolution
 * @param {boolean} [options.attachAudit] expose a helper to record an audit entry
 */
export function withBusiness(options = {}) {
  const { required = true, permission, attachAudit = false } = options;

  return asyncHandler(async (req, _res, next) => {
    const requested = readRequestedBusinessId(req);

    const ctx = await resolveBusinessContext({
      user: req.user,
      requestedBusinessId: requested,
      required,
    });

    ctx.ip = req.ip;
    ctx.userAgent = req.headers['user-agent'] ?? null;
    ctx.requestId = req.requestId;
    ctx.permissionOverrides = ctx.overrides;

    if (permission) {
      const list = Array.isArray(permission) ? permission : [permission];
      if (list.length === 1) assertPermission(ctx, list[0]);
      else assertAnyPermission(ctx, list);
    }

    if (attachAudit) {
      ctx.audit = (entry) =>
        recordAudit({
          business: ctx.businessId,
          actor: req.user,
          role: ctx.role,
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          ip: req.ip,
          userAgent: ctx.userAgent,
          ...entry,
        });
    }

    req.ctx = ctx;
    req.businessId = ctx.businessId;
    next();
  });
}

/**
 * Business-scoped convenience for controllers: builds the filter and knows the
 * optional "own records only" data scope.
 */
export function ctxScope(ctx, filter = {}) {
  return scope(ctx, filter);
}

export { scope };
