/**
 * Per-file server setup: connect Mongoose to the in-memory replica set and
 * build the Express app (importing it registers every model and index).
 */
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect, disconnect, supportsTransactions } from '../../server/src/config/database.js';

// Registering every model builds the indexes we assert on.
import { createApp } from '../../server/src/app.js';

const URI_FILE = path.join(os.tmpdir(), 'lekhapana-test-mongo-uri.txt');

/** Resolve the in-memory URI from whichever channel the setup process used. */
function resolveMongoUri() {
  // `inject` throws outside the global-setup context; the other two channels
  // below still work, so the failure is expected rather than exceptional.
  let injected;
  try {
    injected = inject('mongoUri');
  } catch {
    injected = null;
  }
  if (injected) return injected;
  if (fs.existsSync(URI_FILE)) return fs.readFileSync(URI_FILE, 'utf8').trim();
  return process.env.MONGODB_URI ?? null;
}

// Re-exported so test files can `import { app } from '../setup/server.setup.js'`.
let application = null;
export { application as app };

beforeAll(async () => {
  const uri = resolveMongoUri();
  if (!uri) throw new Error('No in-memory MongoDB URI — check tests/setup/global.setup.js');

  await connect(uri);

  // If the harness cannot run transactions, the integration suite would be
  // silently validating the fallback path. Fail loudly instead.
  const supported = await supportsTransactions();
  if (!supported) {
    throw new Error('In-memory MongoDB must run as a replica set for the integration suite');
  }

  application = createApp();
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections)
      .filter((c) => !c.collectionName.startsWith('system.'))
      .map((c) => c.deleteMany({}))
  );
});

afterAll(async () => {
  await disconnect();
});
