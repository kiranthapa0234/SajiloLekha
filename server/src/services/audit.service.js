/**
 * Audit trail writer.
 *
 * Called from services (not controllers) so that every state change is recorded
 * next to the code that caused it. Logging never throws into the caller: a
 * failure to write an audit row must not roll back a successful sale, but it is
 * logged loudly as an operational problem.
 */
import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

/** Financial actions worth an immutable, reconciliation-grade record. */
const FINANCIAL_ACTIONS = new Set([
  'sale.create',
  'sale.cancel',
  'sale.refund',
  'payment.create',
  'payment.void',
  'payment.refund',
  'purchase.create',
  'purchase.cancel',
  'stock.adjust',
  'stock.receive',
  'stock.issue',
  'invoice.create',
  'invoice.cancel',
  'invoice.writeoff',
  'expense.create',
  'expense.void',
]);

/** Trim a before/after snapshot so a 2 MB product blob never reaches Mongo. */
function compactSnapshot(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[binary]';
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => compactSnapshot(v, depth + 1));

  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(value)) {
    if (count >= 60) break;
    if (['__v', 'businessSnapshot', 'lines', 'sessions', 'images'].includes(k)) continue;
    out[k] = compactSnapshot(v, depth + 1);
    count += 1;
  }
  return out;
}

/** Compute the fields that actually changed — keeps the log meaningful. */
export function diff(before, after, ignore = ['updatedAt', '__v', 'createdAt']) {
  if (!before || !after) return { before: compactSnapshot(before), after: compactSnapshot(after) };
  const b = before.toObject ? before.toObject({ virtuals: false }) : { ...before };
  const a = after.toObject ? after.toObject({ virtuals: false }) : { ...after };
  const changed = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (ignore.includes(key)) continue;
    const bv = JSON.stringify(compactSnapshot(b[key]));
    const av = JSON.stringify(compactSnapshot(a[key]));
    if (bv !== av) changed[key] = { from: compactSnapshot(b[key]), to: compactSnapshot(a[key]) };
  }
  return changed;
}

/**
 * @param {object} entry
 * @param {import('mongoose').Types.ObjectId|null} [entry.business]
 * @param {object|null} [entry.actor]  request user document or `{ _id, name }`
 */
export async function recordAudit(entry) {
  try {
    const actor = entry.actor ?? null;
    const isFinancial = FINANCIAL_ACTIONS.has(entry.action);

    return await AuditLog.create({
      business: entry.business ?? null,
      actor: actor?._id ?? actor?.id ?? null,
      actorName: actor?.name ?? entry.actorName ?? 'system',
      actorRole: entry.actorRole ?? entry.role ?? 'system',
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      changes: entry.changes ? compactSnapshot(entry.changes) : null,
      amountMinor: entry.amountMinor ?? null,
      currency: entry.currency ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
      method: entry.method ?? null,
      path: entry.path ?? null,
      isFinancial,
    });
  } catch (err) {
    logger.error('Audit write failed', {
      action: entry.action,
      entity: entry.entity,
      error: err.message,
    });
    return null;
  }
}

/** Convenience wrapper used by services that already hold a session. */
export function auditSession(session) {
  return (entry) => recordAudit({ ...entry, session });
}

export default { recordAudit, diff, auditSession };
