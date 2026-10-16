/**
 * Application error taxonomy. Every thrown error carries an HTTP status and a
 * stable machine code so the client can react without string-matching.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details, cause, expose } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose ?? status < 500;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details) {
    return new AppError(message, { status: 400, code: 'BAD_REQUEST', details });
  }

  static validation(message = 'Validation failed', details) {
    return new AppError(message, { status: 422, code: 'VALIDATION_ERROR', details });
  }

  static unauthorized(message = 'Authentication required', details) {
    return new AppError(message, { status: 401, code: 'UNAUTHORIZED', details });
  }

  static forbidden(message = 'You do not have permission to perform this action', details) {
    return new AppError(message, { status: 403, code: 'FORBIDDEN', details });
  }

  static notFound(message = 'Resource not found', details) {
    return new AppError(message, { status: 404, code: 'NOT_FOUND', details });
  }

  static conflict(message = 'Resource conflict', details) {
    return new AppError(message, { status: 409, code: 'CONFLICT', details });
  }

  static unprocessable(message = 'Request could not be processed', details) {
    return new AppError(message, { status: 422, code: 'UNPROCESSABLE', details });
  }

  static tooManyRequests(message = 'Too many requests', details) {
    return new AppError(message, { status: 429, code: 'RATE_LIMITED', details });
  }

  static internal(message = 'Something went wrong', details) {
    return new AppError(message, { status: 500, code: 'INTERNAL_ERROR', details, expose: false });
  }
}

/** Wraps an async route handler so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default AppError;
