import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Two levels up: config/ -> src/ -> server/. One level would resolve to
// `server/src`, which silently pushes REPO_ROOT to `server/` and makes the
// repo-root .env invisible -- the app then boots on the hardcoded default
// secrets below.
export const SERVER_ROOT = path.resolve(__dirname, '../..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// Repo-root .env first, then server/.env so deployments can override.
const envFiles = [path.join(REPO_ROOT, '.env'), path.join(SERVER_ROOT, '.env')];
for (const file of envFiles) {
  if (fs.existsSync(file)) dotenv.config({ path: file });
}

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  return value === undefined || value === '' ? undefined : value;
};

const bool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/**
 * Refuse to boot with development secrets in production. This is the single
 * most common cause of a JWT forgery vulnerability in a deployed app.
 */
function assertProductionSecrets(env) {
  if (!isProduction) return;
  const weak = ['replace_me_with_a_long_random_string_at_least_32_chars', 'change-me', 'secret', 'test'];
  for (const key of ['jwtAccessSecret', 'jwtRefreshSecret', 'jwtPepper']) {
    const v = String(env[key] ?? '').toLowerCase();
    if (!v || v.length < 32 || weak.some((w) => v.includes(w))) {
      throw new Error(
        `Refusing to start: ${key} is missing, too short (<32 chars) or still a placeholder.`
      );
    }
  }
}

export const env = {
  nodeEnv: NODE_ENV,
  isProduction,
  isTest,
  isDevelopment: NODE_ENV === 'development',

  port: int(required('PORT'), 4000),
  clientUrl: required('CLIENT_URL', 'http://localhost:5173'),
  serverUrl: required('SERVER_URL', 'http://localhost:4000'),
  logLevel: required('LOG_LEVEL', isTest ? 'silent' : 'info'),

  paths: {
    root: REPO_ROOT,
    server: SERVER_ROOT,
    shared: path.join(REPO_ROOT, 'shared'),
    uploads: path.resolve(SERVER_ROOT, required('UPLOAD_DIR', './uploads')),
  },

  mongo: {
    uri: required('MONGODB_URI', 'mongodb+srv://kiranthapa0234_db_user:BPhk40gkyPchM0N6@cluster0.dx3rcng.mongodb.net/lekhapana'),
    txnUri: required('MONGODB_URI_TXN'),
    useTransactions: bool(required('MONGODB_USE_TRANSACTIONS'), true),
    maxPoolSize: int(required('MONGODB_MAX_POOL_SIZE'), 20),
    serverSelectionTimeoutMS: int(required('MONGODB_SERVER_SELECTION_TIMEOUT_MS'), 8000),
  },

  auth: {
    accessSecret: required('JWT_ACCESS_SECRET', 'ab722877f988de1305676e262b2aa87ab7119bd62b2eeb8c244562d59069d27f'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'ab722877f988de1305676e262b2aa87ab7119bd62b2eeb8c244562d59069d27f'),
    pepper: required('JWT_PEPPER', 'ab722877f988de1305676e262b2aa87ab7119bd62b2eeb8c244562d59069d27f'),
    accessTtl: required('JWT_ACCESS_TTL', '15m'),
    refreshTtl: required('JWT_REFRESH_TTL', '30d'),
    bcryptRounds: int(required('BCRYPT_ROUNDS'), 12),
    issuer: 'lekhapana',
    audience: 'lekhapana-client',
  },

  cookies: {
    secure: bool(required('COOKIE_SECURE'), isProduction),
    sameSite: required('COOKIE_SAME_SITE', 'lax'),
    domain: required('COOKIE_DOMAIN') || undefined,
    refreshName: 'lekhapana_rt',
  },

  security: {
    rateLimitWindowMs: int(required('RATE_LIMIT_WINDOW_MS'), 15 * 60 * 1000),
    rateLimitMax: int(required('RATE_LIMIT_MAX'), 600),
    authRateLimitMax: int(required('AUTH_RATE_LIMIT_MAX'), 15),
    trustProxy: bool(required('TRUST_PROXY'), false),
    headersEnabled: bool(required('SECURITY_HEADERS_ENABLED'), true),
    maxBodySize: '2mb',
  },

  uploads: {
    dir: path.resolve(SERVER_ROOT, required('UPLOAD_DIR', './uploads')),
    maxBytes: int(required('MAX_UPLOAD_BYTES'), 5 * 1024 * 1024),
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
  },

  business: {
    currency: required('DEFAULT_CURRENCY', 'NPR'),
    currencySymbol: required('DEFAULT_CURRENCY_SYMBOL', 'Rs.'),
    timezone: required('DEFAULT_TIMEZONE', 'Asia/Kathmandu'),
    locale: required('DEFAULT_LOCALE', 'en-NP'),
  },

  seed: {
    enabled: bool(required('SEED_DEMO_DATA'), false),
    adminName: required('SEED_ADMIN_NAME', 'SajiloLekha Owner'),
    adminEmail: required('SEED_ADMIN_EMAIL', 'owner@lekhapana.test'),
    adminPassword: required('SEED_ADMIN_PASSWORD', 'ChangeMe!2024'),
  },
};

assertProductionSecrets(env.auth);

export default env;
