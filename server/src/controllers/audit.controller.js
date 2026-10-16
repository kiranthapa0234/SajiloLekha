/**
 * Audit log + system health controller.
 */
import mongoose from 'mongoose';
import { asyncHandler } from '../utils/errors.js';
import { sendOk } from '../utils/response.js';
import AuditLog from '../models/AuditLog.js';
import { supportsTransactions, ping } from '../config/database.js';
import { AVAILABLE_REPORTS } from '../services/report.service.js';
import { SUPPORTED_CURRENCIES, EXPENSE_CATEGORIES, PAYMENT_METHODS, UNITS_OF_MEASURE, STOCK_MOVEMENT_LABELS, ROLES, ROLE_LABELS } from '../../../shared/constants.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = req.validated.query;
  const direction = req.validated.query.order === 'asc' ? 1 : -1;

  const filter = { business: req.ctx.businessId };
  if (req.validated.query.action) filter.action = req.validated.query.action;
  if (req.validated.query.entity) filter.entity = req.validated.query.entity;
  if (req.validated.query.actor) filter.actor = req.validated.query.actor;
  if (req.validated.query.from || req.validated.query.to) {
    filter.createdAt = {};
    if (req.validated.query.from) filter.createdAt.$gte = req.validated.query.from;
    if (req.validated.query.to) filter.createdAt.$lte = req.validated.query.to;
  }

  const [items, total, financial] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: direction })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
    AuditLog.countDocuments({ business: req.ctx.businessId, isFinancial: true }),
  ]);

  return sendOk(res, items, { page, limit, total, summary: { financialEntries: financial } });
});

/** Reference metadata the client uses to build filter dropdowns. */
export const meta = asyncHandler(async (req, res) => {
  const actions = await AuditLog.distinct('action', { business: req.ctx.businessId });
  const entities = await AuditLog.distinct('entity', { business: req.ctx.businessId });
  return sendOk(res, {
    actions: actions.sort(),
    entities: entities.sort(),
    reports: AVAILABLE_REPORTS,
  });
});

/**
 * Liveness + readiness. Exposes the transaction capability so an operator can
 * confirm whether the deployment can run multi-document ACID writes.
 */
export const health = asyncHandler(async (_req, res) => {
  const started = Date.now();
  // Assigned on every path below; `status` is what an orchestrator polls.
  let database;
  let transactions = false;

  try {
    await ping();
    database = 'up';
    transactions = await supportsTransactions();
  } catch {
    database = 'down';
  }

  res.status(database === 'up' ? 200 : 503).json({
    success: true,
    data: {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      transactions,
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
  });
});

/** Everything the SPA needs to render selects and enums without hardcoding. */
export const enums = asyncHandler(async (_req, res) => {
  return sendOk(res, {
    currencies: SUPPORTED_CURRENCIES,
    paymentMethods: PAYMENT_METHODS,
    expenseCategories: EXPENSE_CATEGORIES,
    units: UNITS_OF_MEASURE,
    stockMovementTypes: STOCK_MOVEMENT_LABELS,
    roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
    reports: AVAILABLE_REPORTS,
  });
});

export default { list, meta, health, enums, mongoose };
