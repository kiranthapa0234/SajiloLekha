import mongoose from 'mongoose';
import env from './env.js';
import logger from '../utils/logger.js';

let connectionPromise = null;

/**
 * Mongoose is configured once per process. Silent indexes in production only
 * when explicitly disabled; by default index creation is awaited at boot so a
 * fresh deployment does not serve slow unindexed queries.
 */
function configure() {
  mongoose.set('strictQuery', true);

  // NOTE: `sanitizeFilter` is deliberately OFF.
  // In Mongoose 8.24 it wraps *any* operator object in `$eq`, which breaks every
  // legitimate range query such as `{ soldAt: { $gte, $lte } }` (reproducible
  // with Date objects, ISO strings and epoch numbers alike). Relying on it would
  // mean shipping either broken date filters or a silent injection hole.
  //
  // Operator injection is blocked one layer up instead, by `rejectMongoOperators`
  // in middleware/validate.js, which rejects `$`-prefixed and dotted keys at the
  // HTTP boundary with a 400. That is both correct and auditable.
  mongoose.set('sanitizeFilter', false);

  mongoose.set('strictPopulate', true);
  mongoose.set('bufferCommands', false);
  if (env.isProduction) {
    mongoose.set('autoIndex', process.env.MONGO_AUTO_INDEX === 'true');
  }
}

export async function connect(uri = env.mongo.uri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  configure();

  connectionPromise = mongoose
    .connect(uri, {
      maxPoolSize: env.mongo.maxPoolSize,
      serverSelectionTimeoutMS: env.mongo.serverSelectionTimeoutMS,
      autoIndex: !env.isProduction,
      retryWrites: true,
    })
    .then((m) => {
      logger.info('MongoDB connected', { database: m.connection.name });
      return m.connection;
    })
    .catch((err) => {
      connectionPromise = null;
      logger.error('MongoDB connection failed', { error: err.message });
      throw err;
    });

  return connectionPromise;
}

export async function disconnect() {
  connectionPromise = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

/**
 * Detects whether the deployment can run multi-document transactions.
 * Standalone `mongod` cannot; Atlas and replica sets can. Result is cached so we
 * probe at most once.
 */
let transactionsSupported = null;

export async function supportsTransactions(connection = mongoose.connection) {
  if (transactionsSupported !== null) return transactionsSupported;
  try {
    const admin = connection.db.admin();
    const info = await admin.command({ hello: 1 });
    const hasReplicaSet = Boolean(info.setName);
    const isMongos = info.msg === 'isdbgrid';
    transactionsSupported = hasReplicaSet || isMongos;
    if (!transactionsSupported) {
      logger.warn(
        'MongoDB transactions unavailable (standalone). Falling back to compensated writes with optimistic concurrency.'
      );
    }
  } catch (err) {
    logger.warn('Could not probe transaction support; assuming unsupported', { error: err.message });
    transactionsSupported = false;
  }
  return transactionsSupported;
}

export function setTransactionsSupported(value) {
  transactionsSupported = value;
}

export async function ping() {
  const conn = await connect();
  return conn.db.admin().ping();
}

export default { connect, disconnect, supportsTransactions, ping, mongoose };
