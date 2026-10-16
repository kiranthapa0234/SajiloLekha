/**
 * Money endpoints: the workspace's own cash and bank position.
 *
 * Read endpoints return derived balances; write endpoints append to the
 * ledger. Nothing here stores a running total, so the figures can always be
 * re-derived from the movements.
 */
import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as moneyService from '../services/money.service.js';
import { toMinorUnits } from '../../../shared/money.js';

export const balances = asyncHandler(async (req, res) => {
  return sendOk(res, await moneyService.getBalances(req.ctx.businessId));
});

export const movements = asyncHandler(async (req, res) => {
  const result = await moneyService.listMovements(req.ctx.businessId, req.validated.query);
  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    pageCount: result.pageCount,
  });
});

export const move = asyncHandler(async (req, res) => {
  const { from, to, amount, reason, occurredAt } = req.validated.body;
  const result = await moneyService.transfer({
    businessId: req.ctx.businessId,
    from,
    to,
    amountMinor: toMinorUnits(amount),
    reason,
    occurredAt,
    performedBy: req.user._id,
  });
  return sendCreated(res, result);
});

export const add = asyncHandler(async (req, res) => {
  const { account, kind, amount, reason, occurredAt } = req.validated.body;
  const movement = await moneyService.deposit({
    businessId: req.ctx.businessId,
    account,
    kind,
    amountMinor: toMinorUnits(amount),
    reason,
    occurredAt,
    performedBy: req.user._id,
  });
  return sendCreated(res, movement);
});

export const remove = asyncHandler(async (req, res) => {
  const { account, amount, reason, occurredAt } = req.validated.body;
  const movement = await moneyService.withdraw({
    businessId: req.ctx.businessId,
    account,
    amountMinor: toMinorUnits(amount),
    reason,
    occurredAt,
    performedBy: req.user._id,
  });
  return sendCreated(res, movement);
});
