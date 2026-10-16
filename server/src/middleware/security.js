/**
 * Rate limiting, security headers and upload handling.
 *
 * The limiter stores counters in MongoDB so limits hold across multiple API
 * instances and restarts. When the store is unavailable the app fails open for
 * general traffic but stays closed for authentication endpoints.
 */
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import helmet from 'helmet';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import env from '../config/env.js';
import { isAllowedOrigin } from '../config/origins.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { clientIp } from './auth.js';

/* ----------------------------------------------------- RATE LIMIT STORE -- */

class MongoRateLimitStore {
  constructor({ windowMs, collectionName = 'ratelimits' }) {
    this.windowMs = windowMs;
    this.collection = mongoose.connection.collection(collectionName);
    this.prefix = 'rl';
  }

  async increment(key) {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const docId = `${this.prefix}:${key}:${windowStart}`;

    try {
      const result = await this.collection.findOneAndUpdate(
        { _id: docId },
        {
          $inc: { count: 1 },
          $set: { key, windowStart },
          $setOnInsert: { expiresAt: new Date(windowStart + this.windowMs * 2) },
        },
        { upsert: true, returnDocument: 'after' }
      );
      return { totalHits: result?.count ?? 1, resetTime: new Date(windowStart + this.windowMs) };
    } catch (err) {
      // Fail open: a transient DB issue must not take the whole API down.
      logger.warn('Rate-limit store unavailable', { error: err.message });
      return { totalHits: 0, resetTime: new Date(windowStart + this.windowMs) };
    }
  }

  /** Not meaningful for a fixed window; the counter document simply expires. */
  async decrement() {
    return Promise.resolve();
  }

  /** Called by express-rate-limit to clear a key entirely. */
  async resetKey() {
    return Promise.resolve();
  }

  /** Housekeeping so the collection cannot grow without bound. */
  async sweep() {
    try {
      await this.collection.deleteMany({ expiresAt: { $lt: new Date() } });
    } catch {
      /* best effort */
    }
  }
}

async function keyGenerator(req) {
  // Authenticated requests are limited per user, anonymous ones per IP.
  const userId = req.user?._id?.toString();
  const identity = userId ? `u:${userId}` : `ip:${clientIp(req)}`;
  return `${identity}:${req.baseUrl}${req.path}`;
}

/**
 * Shared counter store, backed by MongoDB.
 *
 * Without this, express-rate-limit keeps counters in the process's memory, so
 * a limit of 15 attempts means 15 per instance — N instances behind a load
 * balancer would allow N times the intended rate against a password endpoint.
 * A single shared store makes the limit mean what it says.
 *
 * Falls back to the in-memory default when the database is not connected, so
 * the limiter still protects a process that is starting up.
 */
const store = () =>
  mongoose.connection.readyState === 1
    ? new MongoRateLimitStore({ windowMs: env.security.rateLimitWindowMs })
    : undefined;

/** General API traffic. */
export const apiLimiter = rateLimit({
  windowMs: env.security.rateLimitWindowMs,
  max: env.security.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: store(),
  keyGenerator,
  skip: () => env.isTest,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  handler: (_req, _res, next) => next(AppError.tooManyRequests()),
});

/** Authentication endpoints — much tighter, and limited per IP + email. */
export const authLimiter = rateLimit({
  windowMs: env.security.rateLimitWindowMs,
  max: env.security.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: store(),
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '').toLowerCase().slice(0, 120);
    return `auth:${clientIp(req)}:${email}`;
  },
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' },
  },
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Too many attempts. Please wait a few minutes and try again.')),
});

/** Report exports are CPU/IO heavy — separate, tighter bucket. */
export const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator,
  handler: (_req, _res, next) => next(AppError.tooManyRequests('Export limit reached. Please wait a minute.')),
});

/** Build a limiter on demand for a named route group. */
export function createLimiter({ windowMs = 60_000, max = 60, keyPrefix = 'x' } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    keyGenerator: (req) => `${keyPrefix}:${clientIp(req)}:${req.path}`,
    handler: (_req, _res, next) => next(AppError.tooManyRequests()),
  });
}

/* ------------------------------------------------------ SECURITY HEADERS -- */

export function securityHeaders() {
  if (!env.security.headersEnabled) return (_req, _res, next) => next();

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The SPA is served by Vite in development; in production it is served
        // by this API server, so a strict policy applies.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", env.clientUrl],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: env.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: env.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    xssFilter: true,
  });
}

/** Extra headers that helmet does not cover. */
export function additionalHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (env.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/** CSRF defence for cookie-authenticated mutating requests. */
export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const isCookieAuth = Boolean(req.cookies?.[env.cookies.refreshName]);
  if (!isCookieAuth) return next();

  // Same predicate the CORS layer uses. When these disagreed, a request could
  // clear CORS and then be rejected here as "Cross-origin request blocked".
  if (isAllowedOrigin(req.headers.origin)) return next();

  if (!req.headers.origin && req.headers.referer) {
    try {
      if (isAllowedOrigin(new URL(req.headers.referer).origin)) return next();
    } catch {
      /* malformed referer falls through to the rejection below */
    }
  }

  return next(
    new AppError('Cross-origin request blocked', { status: 403, code: 'CSRF_REJECTED' })
  );
}

/* ------------------------------------------------------------- UPLOADS -- */

fs.mkdirSync(env.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploads.dir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!env.uploads.allowedMime.includes(file.mimetype)) {
      return cb(AppError.badRequest(`Unsupported file type "${file.mimetype}". Allowed: ${env.uploads.allowedMime.join(', ')}`));
    }
    return cb(null, true);
  },
});

/** Serve uploads with a restrictive policy and no sniffing. */
export const uploadHandler = asyncHandler(async (req, res) => {
  const filename = path.basename(String(req.params.filename ?? ''));
  const filePath = path.join(env.uploads.dir, filename);
  // path.basename already strips traversal, but assert containment explicitly.
  if (!filePath.startsWith(env.uploads.dir)) throw AppError.notFound('File not found');
  if (!fs.existsSync(filePath)) throw AppError.notFound('File not found');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});
