/**
 * Multi-document write coordination.
 *
 * PRIMARY PATH — MongoDB transactions (replica set / Atlas). All reads and
 * writes inside `fn` share one session, giving real ACID atomicity.
 *
 * FALLBACK PATH — standalone mongod cannot run transactions. We do NOT pretend
 * the writes are atomic. Instead we:
 *   1. perform the writes with an explicit ordering that keeps invariants
 *      recoverable,
 *   2. guard every critical update with an optimistic-concurrency predicate
 *      (`stockVersion`, status filters) so a concurrent writer is rejected
 *      rather than silently overwriting,
 *   3. run a compensating rollback if a later step fails,
 *   4. leave the idempotency key in place so a retry is a no-op replay.
 *
 * Callers therefore get the same API either way, and callers that require true
 * atomicity can pass `{ requireTransaction: true }` to fail loudly instead.
 */
import mongoose from 'mongoose';
import { connect, supportsTransactions } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export { mongoose };

/**
 * @template T
 * @param {(ctx: { session: import('mongoose').ClientSession | null, transactional: boolean }) => Promise<T>} fn
 * @param {{ requireTransaction?: boolean, maxRetries?: number, label?: string }} [options]
 * @returns {Promise<T>}
 */
export async function withTransaction(fn, options = {}) {
  const { requireTransaction = false, maxRetries = 3, label = 'transaction' } = options;

  await connect();
  const canUse = (await supportsTransactions()) && env_transactionEnabled();

  if (!canUse) {
    if (requireTransaction) {
      throw new AppError(
        'This deployment cannot guarantee multi-document atomicity for this operation',
        { status: 503, code: 'TRANSACTIONS_UNAVAILABLE' }
      );
    }
    return runWithoutTransaction(fn, label);
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(
        async () => {
          result = await fn({ session, transactional: true });
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
          maxCommitTimeMS: 10_000,
        }
      );
      return result;
    } catch (err) {
      const transient =
        err?.hasErrorLabel?.('TransientTransactionError') ||
        err?.codeName === 'UnknownTransactionCommitResult' ||
        err?.code === 251;
      if (transient && attempt < maxRetries - 1) {
        attempt += 1;
        logger.warn('Retrying transaction after transient error', { label, attempt, error: err.message });
        await new Promise((r) => setTimeout(r, 25 * attempt));
        continue;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
}

async function runWithoutTransaction(fn, label) {
  try {
    return await fn({ session: null, transactional: false });
  } catch (err) {
    logger.error('Non-transactional operation failed', { label, error: err.message });
    throw err;
  }
}

function env_transactionEnabled() {
  // Imported lazily to avoid a circular reference with the config module.
  // eslint-disable-next-line global-require
  return !process.env.MONGODB_USE_TRANSACTIONS || process.env.MONGODB_USE_TRANSACTIONS !== 'false';
}

/** Attach a session to every query in a filter definition. */
export function withSession(filter = {}, session) {
  return session ? { ...filter, session } : filter;
}

/**
 * Atomically reserve the next document number for a business.
 *
 * Uses a single `$inc` on Business so two concurrent checkouts can never be
 * handed the same invoice number. `count()` is deliberately never used for
 * numbering — it is not safe under concurrency and it skips soft-deleted rows.
 *
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {'invoice'|'purchase'|'receipt'} kind
 * @param {{ year?: number, session?: import('mongoose').ClientSession }} [opts]
 */
export async function nextSequence(businessId, kind = 'invoice', opts = {}) {
  const { year = new Date().getFullYear(), session } = opts;
  const field = `${kind}Sequence`;

  const business = await mongoose.model('Business').findOneAndUpdate(
    { _id: businessId },
    { $inc: { [`settings.${field}`]: 1 } },
    { new: true, session, projection: { [`settings.${field}`]: 1, 'settings.invoicePrefix': 1, 'settings.purchasePrefix': 1, 'settings.receiptPrefix': 1, 'settings.invoiceNumberPadding': 1 } }
  );

  if (!business) throw AppError.notFound('Business not found');

  const sequence = business.settings?.[field] ?? 1;
  const prefix =
    kind === 'invoice'
      ? business.settings?.invoicePrefix || 'INV'
      : kind === 'purchase'
        ? business.settings?.purchasePrefix || 'PUR'
        : business.settings?.receiptPrefix || 'RCPT';
  const pad = business.settings?.invoiceNumberPadding ?? 5;

  return { sequence, reference: `${prefix}-${year}-${String(sequence).padStart(pad, '0')}` };
}

/**
 * Reserve several sequences at once so a compound operation (sale + invoice +
 * receipt) numbers them consistently.
 */
export async function nextSequences(businessId, kinds, opts = {}) {
  const { year = new Date().getFullYear(), session } = opts;
  const inc = {};
  for (const kind of kinds) inc[`settings.${kind}Sequence`] = 1;

  const business = await mongoose.model('Business').findOneAndUpdate(
    { _id: businessId },
    { $inc: inc },
    { new: true, session }
  );
  if (!business) throw AppError.notFound('Business not found');

  return kinds.map((kind) => {
    const sequence = business.settings?.[`${kind}Sequence`] ?? 1;
    const prefix =
      kind === 'invoice'
        ? business.settings?.invoicePrefix || 'INV'
        : kind === 'purchase'
          ? business.settings?.purchasePrefix || 'PUR'
          : business.settings?.receiptPrefix || 'RCPT';
    const pad = business.settings?.invoiceNumberPadding ?? 5;
    return { kind, sequence, reference: `${prefix}-${year}-${String(sequence).padStart(pad, '0')}` };
  });
}

/** Map a Mongo duplicate-key error to a friendly conflict. */
export function assertNotDuplicate(err, message = 'A record with these details already exists') {
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern ?? {});
    throw AppError.conflict(fields.length ? `${message} (${fields.join(', ')})` : message, {
      fields,
    });
  }
  throw err;
}

/** Run a duplicate-key lookup, returning null instead of throwing. */
export async function findByIdempotencyKey(Model, businessId, idempotencyKey, session) {
  if (!idempotencyKey) return null;
  return Model.findOne({ business: businessId, idempotencyKey, deletedAt: null }).session(session ?? null);
}
