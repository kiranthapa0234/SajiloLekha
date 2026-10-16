/**
 * Centralised error handling.
 *
 * Every failure path in the application funnels through `notFound` and
 * `errorHandler`, which guarantee:
 *   - one response shape,
 *   - no stack traces or internal messages leaked in production,
 *   - Mongoose and JWT errors translated into meaningful HTTP statuses,
 *   - every unexpected 5xx logged with a correlation id.
 */
import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import env from '../config/env.js';

export function notFound(req, _res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

/** Translate driver-level errors into AppErrors. */
function translate(err) {
  if (err instanceof AppError) return err;

  // Mongoose: validation
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return AppError.validation('Please correct the highlighted fields', details);
  }

  // Mongoose: bad ObjectId
  if (err instanceof mongoose.Error.CastError) {
    return AppError.badRequest(`Invalid value for "${err.path}"`, { fields: [err.path] });
  }

  // Duplicate key
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern ?? {});
    return AppError.conflict(
      `A record with this ${fields.join(' and ') || 'value'} already exists`,
      { fields }
    );
  }

  // Document too large / invalid options
  if (err?.code === 2 || err?.name === 'BSONError') {
    return AppError.badRequest('Malformed request payload');
  }

  // Body parser
  if (err?.type === 'entity.parse.failed') {
    return AppError.badRequest('Request body is not valid JSON');
  }
  if (err?.type === 'entity.too.large') {
    return AppError.badRequest('Request body is too large');
  }

  // MongoDB availability
  if (err?.name === 'MongoServerSelectionError' || err?.name === 'MongoNetworkError') {
    return new AppError('Database is temporarily unavailable. Please retry shortly.', {
      status: 503,
      code: 'DB_UNAVAILABLE',
    });
  }

  // Transactions unavailable
  if (err?.codeName === 'IllegalOperation' && /transaction/i.test(err?.message ?? '')) {
    return new AppError('This deployment cannot run multi-document transactions for the requested action', {
      status: 503,
      code: 'TRANSACTIONS_UNAVAILABLE',
    });
  }

  if (err?.name === 'MulterError') {
    return AppError.badRequest(
      err.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large' : `Upload failed: ${err.message}`
    );
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const translated = translate(err) ?? err;
  const status = translated.status ?? 500;
  const isServerError = status >= 500;

  const logMeta = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl?.split('?')[0],
    userId: req.user?._id?.toString(),
    businessId: req.ctx?.businessId?.toString(),
    status,
    code: translated.code,
    error: translated.message,
  };

  if (isServerError) {
    logger.error('Unhandled request failure', {
      ...logMeta,
      stack: env.isProduction ? undefined : translated.stack?.split('\n').slice(0, 8).join('\n'),
      originalName: translated.name,
    });
  } else {
    logger.debug('Request rejected', logMeta);
  }

  const expose = translated.expose ?? status < 500;

  res.status(status).json({
    success: false,
    error: {
      code: translated.code ?? 'INTERNAL_ERROR',
      message: expose ? translated.message : 'Something went wrong. Please try again.',
      ...(expose && translated.details ? { details: translated.details } : {}),
      ...(!env.isProduction && status >= 500 ? { stack: translated.stack?.split('\n').slice(0, 6) } : {}),
      requestId: req.requestId,
    },
  });
}

/** 404 handler for unmatched API routes (mounted before the SPA fallback). */
export function apiNotFound(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`,
      requestId: req.requestId,
    },
  });
}
