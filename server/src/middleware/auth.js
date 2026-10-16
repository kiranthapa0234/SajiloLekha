/**
 * Authentication middleware.
 *
 * `authenticate` verifies the JWT and loads a *live* user. Suspended or deleted
 * accounts are rejected immediately even if their token is still valid.
 */
import User from '../models/User.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import { verifyAccessToken } from '../services/auth.service.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

function extractBearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  // Fallback for the PDF/print window and file downloads triggered by <a>.
  if (typeof req.query.access_token === 'string') return req.query.access_token;
  return null;
}

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) {
    throw AppError.unauthorized('Authentication required');
  }

  const payload = verifyAccessToken(token);

  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('Account no longer exists');
  if (user.status === 'suspended') throw AppError.forbidden('This account has been suspended');
  if (user.status === 'pending') throw AppError.forbidden('Verify your email address to continue');
  if (user.deletedAt) throw AppError.unauthorized('Account no longer exists');

  req.user = user;
  req.auth = {
    userId: user._id.toString(),
    jti: payload.jti,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    claimsBusiness: payload.biz ?? null,
    claimsRole: payload.role ?? null,
  };
  next();
});

/** Attaches req.user when a valid token is present, but never rejects. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.status === 'active' && !user.deletedAt) {
      req.user = user;
      req.auth = { userId: user._id.toString(), claimsBusiness: payload.biz ?? null };
    }
  } catch {
    /* anonymous request */
  }
  return next();
});

/**
 * Lightweight per-request logging with a correlation id.
 * The id is echoed in the response header so a user can quote it in support.
 */
export function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || Math.random().toString(36).slice(2, 12);
  req.requestId = String(requestId).slice(0, 64);
  req.startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-Id', req.requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level]('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?._id?.toString(),
      businessId: req.ctx?.businessId?.toString(),
      ip: req.ip,
    });
  });

  next();
}

/** Best-effort client identity for rate limiting and audit records. */
export function clientIp(req) {
  if (env.security.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
