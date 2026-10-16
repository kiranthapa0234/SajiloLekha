/**
 * Global test setup.
 *
 * Boots ONE in-memory MongoDB as a single-node replica set so multi-document
 * transactions are genuinely exercised (not mocked), then injects its URI into
 * the worker processes via Vitest's `provide`/`inject` contract.
 *
 * Environment variables are set here too, but they are process-local to the
 * setup process — the URI travels via `inject`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * The URI is handed to worker processes two ways, because it does not exist
 * until this process has started a database:
 *   1. a temp file that `server.setup.js` reads (version-proof), and
 *   2. Vitest's `provide`/`inject` contract, when the installed version has it.
 */
const URI_FILE = path.join(os.tmpdir(), 'lekhapana-test-mongo-uri.txt');

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  JWT_ACCESS_SECRET: 'test_access_secret_that_is_at_least_32_chars_long',
  JWT_REFRESH_SECRET: 'test_refresh_secret_that_is_at_least_32_chars_long',
  JWT_PEPPER: 'test_pepper_value_that_is_at_least_32_chars_long',
  RATE_LIMIT_MAX: '1000000',
  AUTH_RATE_LIMIT_MAX: '1000000',
  COOKIE_SECURE: 'false',
  MONGODB_USE_TRANSACTIONS: 'true',
  UPLOAD_DIR: './tests/.tmp/uploads',
};

export default async function setup({ provide } = {}) {
  Object.assign(process.env, TEST_ENV);

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri('lekhapana_test');
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_URI_TXN = uri;

  fs.mkdirSync(path.dirname(URI_FILE), { recursive: true });
  fs.writeFileSync(URI_FILE, uri, 'utf8');

  try {
    provide?.('mongoUri', uri);
  } catch {
    // Older Vitest: the temp file above is the channel.
  }

  return async () => {
    await replSet?.stop();
    try {
      fs.unlinkSync(URI_FILE);
    } catch {
      /* best effort */
    }
  };
}
