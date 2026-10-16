import { asyncHandler } from '../utils/errors.js';
import { sendOk } from '../utils/response.js';
import { toCsv } from '../utils/helpers.js';
import * as invoiceService from '../services/invoice.service.js';

/**
 * Money is stored in minor units, so a CSV consumer would otherwise see
 * integers and have to guess the scale. Amounts are written as major-unit
 * decimals here; `fromMinorUnits` does the rounding so the exported column
 * adds up to the invoice total.
 */
const major = (minor, decimals = 2) => (Number(minor ?? 0) / 10 ** decimals).toFixed(decimals);

const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

const LIST_COLUMNS = [
  { header: 'Invoice', key: 'invoiceNumber' },
  { header: 'Issued', value: (r) => day(r.issuedAt) },
  { header: 'Due', value: (r) => day(r.dueDate) },
  { header: 'Customer', key: 'customerName' },
  { header: 'Status', key: 'status' },
  { header: 'Subtotal', value: (r) => major(r.netSalesMinor) },
  { header: 'Discount', value: (r) => major(r.totalDiscountMinor) },
  { header: 'Tax', value: (r) => major(r.taxMinor) },
  { header: 'Total', value: (r) => major(r.totalMinor) },
  { header: 'Paid', value: (r) => major(r.paidMinor) },
  { header: 'Refunded', value: (r) => major(r.refundedMinor) },
  { header: 'Written off', value: (r) => major(r.writtenOffMinor) },
  { header: 'Outstanding', value: (r) => major(r.outstandingMinor) },
  { header: 'Days overdue', key: 'daysOverdue' },
  { header: 'Currency', key: 'currency' },
];

export const list = asyncHandler(async (req, res) => {
  const result = await invoiceService.listInvoices(req.ctx, req.validated.query);

  if (req.validated.query.format === 'csv') {
    await req.ctx.audit?.({ action: 'report.export', entity: 'Invoice', entityId: null });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-${day(new Date())}.csv"`);
    // A BOM keeps Excel from mangling non-ASCII customer names.
    return res.send(`\uFEFF${toCsv(result.items, LIST_COLUMNS)}`);
  }

  return sendOk(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    summary: result.summary,
  });
});

export const get = asyncHandler(async (req, res) => {
  return sendOk(res, await invoiceService.getInvoice(req.ctx, req.params.id));
});

/** JSON, CSV, printable HTML or PDF. PDF is generated server-side from the stored snapshot. */
export const download = asyncHandler(async (req, res) => {
  const format = req.validated.query.format;
  const invoice = await invoiceService.getInvoice(req.ctx, req.params.id);
  const isPdf = format === 'pdf';
  const isPrint = format === 'print';
  const isCsv = format === 'csv';

  if (isPdf || isPrint || isCsv) {
    await req.ctx.audit?.({
      action: 'report.export',
      entity: 'Invoice',
      entityId: invoice._id,
      amountMinor: invoice.totalMinor,
    });
  }

  if (isPrint) {
    res.type('html');
    return res.send(renderPrintableInvoice(invoice, req.ctx.business));
  }

  if (isCsv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${invoice.invoiceNumber.replace(/[^\w.-]/g, '_')}.csv"`,
    );
    return res.send(`\uFEFF${toCsv([invoiceSummaryRow(invoice)], LIST_COLUMNS)}`);
  }

  if (isPdf) {
    const filename = `${invoice.invoiceNumber.replace(/[^\w.-]/g, '_')}.pdf`;
    res.setHeader('Content-Disposition', `${isPrint ? 'inline' : 'attachment'}; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return invoiceService.streamInvoicePdf(res, invoice, {
      business: req.ctx.business,
      payments: invoice.payments ?? [],
      copy: req.validated.query.copy,
    });
  }

  return sendOk(res, invoice);
});

/** A single invoice rendered into the same row shape the list export uses. */
function invoiceSummaryRow(invoice) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    customerName: invoice.customerName,
    status: invoice.status,
    netSalesMinor: invoice.netSalesMinor,
    totalDiscountMinor: invoice.totalDiscountMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    refundedMinor: invoice.refundedMinor,
    writtenOffMinor: invoice.writtenOffMinor,
    outstandingMinor: invoice.outstandingMinor,
    daysOverdue: invoice.daysOverdue,
    currency: invoice.currency,
  };
}

export const cancel = asyncHandler(async (req, res) => {
  return sendOk(res, await invoiceService.cancelInvoice(req.ctx, req.params.id, req.body?.reason ?? 'No reason supplied'), {
    message: 'Invoice cancelled',
  });
});

export const writeOff = asyncHandler(async (req, res) => {
  return sendOk(res, await invoiceService.writeOffInvoice(req.ctx, req.params.id, req.body), {
    message: 'Balance written off',
  });
});

/** Force a status re-derivation sweep (used by the nightly job and on demand). */
export const reconcile = asyncHandler(async (req, res) => {
  const result = await invoiceService.reconcileStatuses(req.ctx.businessId);
  return sendOk(res, result, { message: `${result.updated} invoice(s) updated` });
});

/* ------------------------------------------------------- PRINTABLE HTML -- */

/**
 * Server-rendered printable invoice. Gives the user a browser-native
 * "Save as PDF" path in addition to the binary PDF endpoint, and works even if
 * the PDF font pipeline is unavailable.
 */
function renderPrintableInvoice(invoice, business) {
  const symbol = invoice.currencySymbol ?? business?.settings?.currencySymbol ?? 'Rs.';
  const d = invoice.currencyDecimals ?? 2;
  const fmt = (minor) =>
    `${symbol} ${(Number(minor ?? 0) / 10 ** d).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })}`;
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const snap = invoice.businessSnapshot ?? {};

  const rows = (invoice.lines ?? [])
    .map(
      (l) => `<tr>
        <td>${esc(l.name)}${l.sku ? `<div class="sku">SKU ${esc(l.sku)}</div>` : ''}</td>
        <td class="num">${esc(l.quantity)}</td>
        <td class="num">${fmt(l.unitPriceMinor)}</td>
        <td class="num">${l.discountMinor ? `-${fmt(l.discountMinor)}` : ''}</td>
        <td class="num">${l.taxMinor ? fmt(l.taxMinor) : ''}</td>
        <td class="num strong">${fmt(l.totalMinor)}</td>
      </tr>`
    )
    .join('');

  const outstanding = invoice.totalMinor - invoice.paidMinor - (invoice.writtenOffMinor ?? 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Invoice ${esc(invoice.invoiceNumber)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
         margin: 0; padding: 32px; color: #0f172a; background: #fff; font-size: 13px; }
  .sheet { max-width: 820px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 3px solid #7657E8; padding-bottom: 20px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 30px; margin: 0; color: #7657E8; letter-spacing: 0.08em; }
  .muted { color: #64748b; }
  .num { text-align: right; }
  .strong { font-weight: 600; }
  .parties { display: flex; gap: 24px; margin: 24px 0; background: #f8f7fe; padding: 16px; border-radius: 10px; }
  .parties > div { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
       color: #64748b; background: #f8fafc; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
  td { padding: 11px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  th.num, td.num { text-align: right; }
  .sku { font-size: 11px; color: #94a3b8; }
  .totals { margin-left: auto; width: 320px; margin-top: 20px; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
  .totals .grand { border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 12px;
                   font-size: 16px; font-weight: 700; }
  .due { color: #dc2626; font-weight: 700; }
  .pill { display: inline-block; padding: 4px 12px; border-radius: 999px; color: #fff;
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0;
           text-align: center; color: #94a3b8; font-size: 12px; }
  .actions { max-width: 820px; margin: 0 auto 16px; display: flex; gap: 8px; justify-content: flex-end; }
  button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid #7657E8;
           background: #7657E8; color: #fff; cursor: pointer; }
  button.ghost { background: #fff; color: #7657E8; }
  @media print { .actions { display: none; } body { padding: 0; } }
</style></head>
<body>
<div class="actions">
  <button class="ghost" onclick="window.close()">Close</button>
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="sheet">
  <header>
    <div>
      <h1>${esc(snap.name || business?.name || 'SajiloLekha')}</h1>
      <div class="muted">${[snap.address, [snap.phone, snap.email].filter(Boolean).join(' - ')].filter(Boolean).map(esc).join('<br>')}</div>
      ${snap.taxNumber ? `<div class="muted">Tax / VAT: ${esc(snap.taxNumber)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <h2>INVOICE</h2>
      <div class="strong">${esc(invoice.invoiceNumber)}</div>
      <div class="muted">Issued ${esc(invoiceService.formatDate(invoice.issuedAt))}</div>
      ${invoice.dueDate ? `<div class="muted">Due ${esc(invoiceService.formatDate(invoice.dueDate))}</div>` : ''}
      <div class="pill" style="margin-top:8px;background:${
        { paid: '#16a34a', partial: '#d97706', unpaid: '#dc2626', overdue: '#dc2626', cancelled: '#64748b' }[invoice.status] ?? '#64748b'
      }">${esc(invoice.status)}</div>
    </div>
  </header>

  <div class="parties">
    <div>
      <div class="muted" style="font-size:11px;letter-spacing:.06em">BILL TO</div>
      <div class="strong">${esc(invoice.customerName || 'Walk-in customer')}</div>
      <div class="muted">${[invoice.customerPhone, invoice.customerAddress].filter(Boolean).map(esc).join(' - ')}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Item</th><th class="num">Qty</th><th class="num">Price</th>
      <th class="num">Discount</th><th class="num">${esc(invoice.taxLabel || 'Tax')}</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span>${fmt(invoice.grossMinor)}</span></div>
    ${invoice.totalDiscountMinor > 0 ? `<div><span>Discount</span><span>-${fmt(invoice.totalDiscountMinor)}</span></div>` : ''}
    <div><span>Net sales</span><span>${fmt(invoice.netSalesMinor)}</span></div>
    ${invoice.taxMinor > 0 ? `<div><span>${esc(invoice.taxLabel || 'Tax')}</span><span>${fmt(invoice.taxMinor)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${fmt(invoice.totalMinor)}</span></div>
    <div><span>Paid</span><span>-${fmt(invoice.paidMinor)}</span></div>
    ${invoice.refundedMinor > 0 ? `<div><span>Refunded</span><span>+${fmt(invoice.refundedMinor)}</span></div>` : ''}
    ${outstanding > 0 ? `<div class="grand due"><span>Balance due</span><span>${fmt(outstanding)}</span></div>` : ''}
  </div>

  ${invoice.note ? `<p class="muted" style="margin-top:28px"><strong>Notes:</strong> ${esc(invoice.note)}</p>` : ''}
  ${invoice.terms ? `<p class="muted"><strong>Terms:</strong> ${esc(invoice.terms)}</p>` : ''}
  <footer>${esc(invoice.footer || '')}</footer>
</div>
</body></html>`;
}
