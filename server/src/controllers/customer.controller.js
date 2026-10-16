import { asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import * as customerService from '../services/customer.service.js';
import * as invoiceService from '../services/invoice.service.js';

export const list = asyncHandler(async (req, res) => {
  const result = await customerService.listCustomers(req.ctx, req.validated.query);
  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    summary: result.summary,
  });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await customerService.getCustomer(req.ctx, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  return sendCreated(res, await customerService.createCustomer(req.ctx, req.validated.body));
});

export const update = asyncHandler(async (req, res) => {
  return sendOk(res, await customerService.updateCustomer(req.ctx, req.params.id, req.validated.body));
});

export const archive = asyncHandler(async (req, res) => {
  return sendOk(res, await customerService.setCustomerArchived(req.ctx, req.params.id, true, req.body?.reason));
});

export const restore = asyncHandler(async (req, res) => {
  return sendOk(res, await customerService.setCustomerArchived(req.ctx, req.params.id, false, req.body?.reason));
});

export const walkIn = asyncHandler(async (req, res) => {
  return sendOk(res, await customerService.getWalkInCustomer(req.ctx));
});

export const ledger = asyncHandler(async (req, res) => {
  return sendOk(
    res,
    await customerService.customerLedger(req.ctx, req.params.id, {
      from: req.query.from ? new Date(req.query.from) : undefined,
      to: req.query.to ? new Date(req.query.to) : undefined,
    })
  );
});

/** Account statement — printable/downloadable. */
export const statement = asyncHandler(async (req, res) => {
  const statement = await invoiceService.customerStatement(req.ctx, req.params.id, {
    from: req.query.from ? new Date(req.query.from) : undefined,
    to: req.query.to ? new Date(req.query.to) : undefined,
  });

  if (req.query.format === 'pdf') {
    await req.ctx.audit?.({ action: 'report.export', entity: 'CustomerStatement', entityId: req.params.id });
    return invoiceService.streamStatementPdf(res, statement);
  }
  return sendOk(res, statement);
});
