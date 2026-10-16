/**
 * Money service: the workspace's own cash and bank position.
 *
 * Balance is always derived by aggregation over the movement ledger, never
 * stored on the business. That is the whole point: a stored balance can quietly
 * disagree with the movements that produced it, and nobody can tell which one
 * is lying. A ledger can always be re-summed and checked.
 *
 * Money only ever moves through a row here, and every row names a reason and
 * the document that caused it. That mirrors the rule already applied to stock.
 */
import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import MoneyMovement from '../models/MoneyMovement.js';
import { MONEY_ACCOUNTS, PAYMENT_METHOD_ACCOUNT } from '../../../shared/constants.js';

const isVoided = { voidedAt: null, deletedAt: null };

/**
 * Accept a date that may be absent, a Date, or an ISO string, and refuse
 * anything else rather than silently dating the movement "now".
 */
function parseWhen(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw AppError.badRequest('That date could not be understood', { fields: ['occurredAt'] });
  }
  return d;
}

/**
 * Current balance per account, plus the total.
 *
 * `credit` payments are excluded by construction: they never reach this ledger,
 * so a sale on credit cannot inflate the bank.
 */
export async function getBalances(businessId, { session = null } = {}) {
  const rows = await MoneyMovement.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(businessId)), ...isVoided } },
    {
      $group: {
        _id: '$account',
        // in minus out, in integer minor units
        totalMinor: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amountMinor', { $multiply: ['$amountMinor', -1] }] } },
        inMinor: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amountMinor', 0] } },
        outMinor: { $sum: { $cond: [{ $eq: ['$direction', 'out'] }, '$amountMinor', 0] } },
      },
    },
  ]).session(session);

  const byAccount = Object.fromEntries(MONEY_ACCOUNTS.map((a) => [a, { totalMinor: 0, inMinor: 0, outMinor: 0 }]));
  for (const row of rows) {
    if (byAccount[row._id]) {
      byAccount[row._id] = {
        totalMinor: row.totalMinor,
        inMinor: row.inMinor,
        outMinor: row.outMinor,
      };
    }
  }

  const totalMinor = Object.values(byAccount).reduce((sum, a) => sum + a.totalMinor, 0);
  return { accounts: byAccount, totalMinor };
}

/**
 * Reject money leaving an account that does not hold it.
 *
 * Balance is `sum(in) - sum(out)`, so an outbound row larger than the account's
 * balance does not "borrow" — it just makes the reported balance wrong, and
 * since movements are voided rather than deleted, that wrong number is now
 * permanent. The check is per-account because that is the account whose ledger
 * row would go negative: a payment recorded against cash must be covered by
 * cash, whatever the bank happens to hold. The other account's balance is named
 * so the fix is obvious (transfer first, or pay by the other method).
 */
async function assertFunds(businessId, account, amountMinor, session) {
  const { accounts, totalMinor } = await getBalances(businessId, { session });
  const available = accounts[account]?.totalMinor ?? 0;
  if (amountMinor <= available) return;

  const other = MONEY_ACCOUNTS.find((a) => a !== account);
  const otherAvailable = accounts[other]?.totalMinor ?? 0;
  const short = amountMinor - available;
  const fmt = (minor) => (minor / 100).toFixed(2);

  // An account that is already overdrawn means the books are wrong upstream, so
  // "you have -6,000" would be nonsense. Say what is actually true: there is
  // nothing to spend, and the position has to be corrected first.
  const message =
    available < 0
      ? `${account} is already overdrawn by ${fmt(-available)}. ` +
        'Set the real opening balance on the Accountant screen before paying anything out.'
      : `Not enough ${account} to cover this. You have ${fmt(available)} in ${account}, ` +
        `this is ${fmt(amountMinor)} — ${fmt(short)} short. ` +
        `Your ${other} holds ${fmt(otherAvailable)}, so transfer from ${other} first or pay by ${other}.`;

  throw new AppError(message, {
    status: 422,
    code: 'INSUFFICIENT_FUNDS',
    details: {
      account,
      availableMinor: available,
      requestedMinor: amountMinor,
      shortfallMinor: short,
      overdrawn: available < 0,
      otherAccount: other,
      otherAvailableMinor: otherAvailable,
      totalMinor,
    },
  });
}

/** Append one movement. Internal callers use this; the API goes through the wrappers below. */
export async function recordMovement(params) {
  const {
    businessId,
    account,
    direction,
    amountMinor,
    kind,
    reason,
    related = { type: 'Manual' },
    transferGroup = null,
    occurredAt,
    performedBy = null,
    session = null,
  } = params;

  if (!MONEY_ACCOUNTS.includes(account)) {
    throw AppError.badRequest(`"${account}" is not a money account`, { fields: ['account'] });
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw AppError.badRequest('The amount must be a positive whole number of minor units', { fields: ['amountMinor'] });
  }

  const movement = await MoneyMovement.create(
    [
      {
        business: businessId,
        account,
        direction,
        amountMinor,
        kind,
        reason,
        related,
        transferGroup,
        occurredAt: parseWhen(occurredAt),
        createdBy: performedBy,
        updatedBy: performedBy,
      },
    ],
    { session }
  );

  return movement[0];
}

/**
 * The single entry point for money arriving in or leaving the business.
 *
 * Called from the payment service so that every flow already covered -- sales,
 * purchases and expenses -- writes to the ledger without duplicating logic.
 * A payment method that settles nowhere (credit) is ignored rather than
 * guessed at.
 *
 * This is also where the no-negative-balance rule is enforced. Every outbound
 * movement in the system -- paying a supplier, a standalone money-out, a refund
 * -- comes through here, so checking once here covers all of them. `transfer`
 * and `withdraw` have their own checks at their entry points.
 */
export async function recordForPayment({ payment, direction, businessId, performedBy, session = null }) {
  const account = PAYMENT_METHOD_ACCOUNT[payment.method];
  if (!account) return null; // credit: nothing has actually moved

  const amountMinor = payment.netMinor ?? payment.amountMinor;

  // Money arriving is always fine; money leaving has to exist first.
  if (direction === 'out') {
    await assertFunds(businessId, account, amountMinor, session);
  }

  return recordMovement({
    businessId,
    account,
    direction,
    amountMinor,
    kind: direction === 'in' ? (payment.purchase ? 'supplier_payment' : 'sale') : payment.purchase ? 'purchase' : 'refund',
    reason: movementReason({ payment, direction }),
    related: {
      type: 'Payment',
      id: payment._id,
      number: payment.reference ?? '',
    },
    occurredAt: payment.paidAt ?? new Date(),
    performedBy,
    session,
  });
}

function movementReason({ payment, direction }) {
  if (payment.purchase) return direction === 'in' ? 'Payment to supplier' : 'Purchase paid';
  if (direction === 'out') return payment.sale ? 'Refund to customer' : 'Money paid out';
  return payment.invoice ? 'Invoice payment received' : 'Payment received';
}

/** Move money between the till and the bank. Total is unchanged by definition. */
export async function transfer({ businessId, from, to, amountMinor, reason, performedBy, occurredAt, session = null }) {
  if (!MONEY_ACCOUNTS.includes(from) || !MONEY_ACCOUNTS.includes(to)) {
    throw AppError.badRequest('Choose cash or bank for both sides of the transfer', { fields: ['from', 'to'] });
  }
  if (from === to) {
    throw AppError.badRequest('Choose two different accounts', { fields: ['to'] });
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw AppError.badRequest('Enter an amount greater than zero', { fields: ['amountMinor'] });
  }
  if (!reason || String(reason).trim().length < 3) {
    throw AppError.badRequest('A reason is required for every movement of money', { fields: ['reason'] });
  }

  await assertFunds(businessId, from, amountMinor, session);

  const group = new mongoose.Types.ObjectId();
  const when = occurredAt ?? new Date();
  const text = String(reason).trim();

  const out = await recordMovement({
    businessId,
    account: from,
    direction: 'out',
    amountMinor,
    kind: 'transfer_out',
    reason: text,
    related: { type: 'Transfer', id: group, number: '' },
    transferGroup: group,
    occurredAt: when,
    performedBy,
    session,
  });

  const into = await recordMovement({
    businessId,
    account: to,
    direction: 'in',
    amountMinor,
    kind: 'transfer_in',
    reason: text,
    related: { type: 'Transfer', id: group, number: '' },
    transferGroup: group,
    occurredAt: when,
    performedBy,
    session,
  });

  await recordAudit({
    business: businessId,
    actor: performedBy,
    action: 'money.transfer',
    entity: 'MoneyMovement',
    entityId: out._id,
    amountMinor,
    changes: { from, to, reason: text },
  }).catch(() => {});

  return { out, into, group };
}

/** Add money from outside the business (owner capital, bank top-up, cash-in). */
export async function deposit({ businessId, account, amountMinor, kind, reason, performedBy, occurredAt, session = null }) {
  const movement = await recordMovement({
    businessId,
    account,
    direction: 'in',
    amountMinor,
    kind: kind === 'opening' ? 'opening' : 'deposit',
    reason,
    occurredAt,
    performedBy,
    session,
  });
  await recordAudit({
    business: businessId,
    actor: performedBy,
    action: 'money.deposit',
    entity: 'MoneyMovement',
    entityId: movement._id,
    amountMinor,
    changes: { account, kind },
  }).catch(() => {});
  return movement;
}

/** Take money out of the business entirely. */
export async function withdraw({ businessId, account, amountMinor, reason, performedBy, occurredAt, session = null }) {
  await assertFunds(businessId, account, amountMinor, session);
  const movement = await recordMovement({
    businessId,
    account,
    direction: 'out',
    amountMinor,
    kind: 'withdrawal',
    reason,
    occurredAt,
    performedBy,
    session,
  });
  await recordAudit({
    business: businessId,
    actor: performedBy,
    action: 'money.withdraw',
    entity: 'MoneyMovement',
    entityId: movement._id,
    amountMinor,
    changes: { account },
  }).catch(() => {});
  return movement;
}

/** The ledger, newest first, with a running total for the chosen account. */
export async function listMovements(businessId, { account, kind, from, to, page = 1, limit = 50 } = {}) {
  const filter = { business: businessId, ...isVoided };
  if (account && MONEY_ACCOUNTS.includes(account)) filter.account = account;
  if (kind) filter.kind = kind;
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = new Date(from);
    if (to) filter.occurredAt.$lte = new Date(to);
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    MoneyMovement.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name')
      .lean({ virtuals: true }),
    MoneyMovement.countDocuments(filter),
  ]);

  return {
    items,
    page: Math.max(1, page),
    limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Undo the ledger entries a payment created.
 *
 * Movements are never deleted -- the ledger is append-only, like stock. They
 * are marked voided so the balance excludes them while the history survives.
 */
export async function voidMoneyForPayment({ payment, businessId, reason, performedBy, session = null }) {
  const rows = await MoneyMovement.find({
    business: businessId,
    'related.id': payment._id,
    voidedAt: null,
    deletedAt: null,
  }).session(session);

  if (rows.length === 0) return 0;

  await MoneyMovement.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    { $set: { voidedAt: new Date(), voidedBy: performedBy, voidReason: reason } },
    { session }
  );

  return rows.length;
}

export default {
  getBalances,
  recordMovement,
  recordForPayment,
  voidMoneyForPayment,
  transfer,
  deposit,
  withdraw,
  listMovements,
};
