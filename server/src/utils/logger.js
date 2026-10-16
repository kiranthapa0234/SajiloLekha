/**
 * Structured, level-based logger. Emits newline-delimited JSON in production
 * (ingestable by any log pipeline) and a readable line in development.
 *
 * Never logs secrets, tokens, passwords or raw JWTs.
 */
import env from '../config/env.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const activeLevel = LEVELS[env.logLevel] ?? LEVELS.info;

const REDACT_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'setcookie',
  'secret',
  'pepper',
  'jwt',
  'authorizationtoken',
  'otp',
]);

export function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 2000) {
      out[k] = `${v.slice(0, 2000)}…[truncated]`;
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level, message, meta) {
  if ((LEVELS[level] ?? 99) > activeLevel) return;
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  if (env.isProduction) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const stream = level === 'error' ? process.stderr : process.stdout;
  const time = payload.time.slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  let line = `${time} ${tag} ${message}`;
  if (meta && Object.keys(meta).length) {
    line += ` ${JSON.stringify(redact(meta))}`;
  }
  stream.write(`${line}\n`);
}

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
  /** Create a child logger that stamps every line with shared context. */
  child(bindings) {
    return {
      error: (m, meta) => emit('error', m, { ...bindings, ...meta }),
      warn: (m, meta) => emit('warn', m, { ...bindings, ...meta }),
      info: (m, meta) => emit('info', m, { ...bindings, ...meta }),
      debug: (m, meta) => emit('debug', m, { ...bindings, ...meta }),
      child: (extra) => logger.child({ ...bindings, ...extra }),
    };
  },
};

export default logger;
