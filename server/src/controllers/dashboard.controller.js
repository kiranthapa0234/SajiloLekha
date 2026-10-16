/**
 * Dashboard controller — thin wrapper over the aggregation service.
 * No business logic lives here.
 */
import { asyncHandler } from '../utils/errors.js';
import { sendOk } from '../utils/response.js';
import {
  getDashboardSummary,
  quickStats,
  salesTrend,
  paymentMethodBreakdown,
  outstandingBalance,
} from '../services/dashboard.service.js';

export const summary = asyncHandler(async (req, res) => {
  return sendOk(res, await getDashboardSummary(req.ctx, req.validated.query));
});

export const stats = asyncHandler(async (req, res) => {
  return sendOk(res, await quickStats(req.ctx.businessId));
});

export const salesChart = asyncHandler(async (req, res) => {
  const trend = await salesTrend(req.ctx.businessId, req.validated.query, req.query.granularity ?? 'day');
  return sendOk(res, trend);
});

export const methods = asyncHandler(async (req, res) => {
  const items = await paymentMethodBreakdown(req.ctx.businessId, req.validated.query);
  return sendOk(res, {
    totalMinor: items.reduce((s, i) => s + i.totalMinor, 0),
    items,
  });
});

export const outstanding = asyncHandler(async (req, res) => {
  return sendOk(res, await outstandingBalance(req.ctx.businessId));
});
