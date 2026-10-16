import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as expenseService from '../services/expense.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await expenseService.listExpenses(req.ctx, req.validated.query);
  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    summary: result.summary,
  });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await expenseService.getExpense(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  return sendCreated(res, await expenseService.createExpense(req.ctx, req.validated.body));
});

export const update = asyncHandler(async (req, res) => {
  return sendOk(res, await expenseService.updateExpense(req.ctx, req.params.id, req.validated.body));
});

export const voidExpense = asyncHandler(async (req, res) => {
  return sendOk(res, await expenseService.voidExpense(req.ctx, req.params.id, req.body?.reason ?? 'No reason supplied'), {
    message: 'Expense voided and excluded from reports',
  });
});

export const archive = asyncHandler(async (req, res) => {
  return sendOk(res, await expenseService.setExpenseArchived(req.ctx, req.params.id, true));
});

export const restore = asyncHandler(async (req, res) => {
  return sendOk(res, await expenseService.setExpenseArchived(req.ctx, req.params.id, false));
});

/** Daily / monthly / yearly rollups for the expenses overview cards. */
export const totals = asyncHandler(async (req, res) => {
  return sendOk(
    res,
    await expenseService.expenseTotals(req.ctx, {
      from: req.query.from ? new Date(req.query.from) : undefined,
      to: req.query.to ? new Date(req.query.to) : undefined,
    })
  );
});
