/**
 * Invoice service -— issuing, listing, statements and PDF rendering.
 *
 * Invoice status is always recomputed from amounts + due date, never accepted
 * from the client. `reconcileStatuses` exists because a document can become
 * overdue purely by the passage of time with no write occurring.
 */
import PDFDocument from 'pdfkit';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import { AppError } from '../utils/errors.js';
import { deriveInvoiceStatus, outstandingMinor } from '../../../shared/accounting.js';
import { fromMinorUnits } from '../../../shared/money.js';
import { PAYMENT_METHOD_LABELS } from '../../../shared/constants.js';
import { createMoneyContext } from './money.context.js';
import { recordAudit } from './audit.service.js';
import { withTransaction } from './transaction.service.js';

const BRAND = '#7657E8';

export async function listInvoices(ctx, query) {
  const { page, limit, skip } = query;
  const direction = query.order === 'asc' ? 1 : -1;
  const sortField = ['issuedAt', 'dueDate', 'totalMinor', 'invoiceNumber'].includes(query.sort)
    ? query.sort
    : 'issuedAt';

  const filter = { business: ctx.businessId };
  if (query.status && query.status !== 'all') {
    if (query.status === 'overdue') {
      filter.status = { $in: ['unpaid', 'partial', 'overdue'] };
      filter.dueDate = { $lt: new Date() };
    } else {
      filter.status = query.status;
    }
  }
  if (query.customer) filter.customer = query.customer;
  if (query.from || query.to) {
    filter.issuedAt = {};
    if (query.from) filter.issuedAt.$gte = query.from;
    if (query.to) filter.issuedAt.$lte = query.to;
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ invoiceNumber: rx }, { customerName: rx }, { customerPhone: rx }];
  }

  const [items, total, totalsRow] = await Promise.all([
    Invoice.find(filter)
      .populate('customer', 'name customerCode phone')
      .sort({ [sortField]: direction, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: { business: ctx.business._id, ...(query.status && query.status !== 'all' ? { status: query.status } : {}) } },
      {
        $group: {
          _id: null,
          billedMinor: { $sum: '$totalMinor' },
          paidMinor: { $sum: '$paidMinor' },
          refundedMinor: { $sum: '$refundedMinor' },
          writtenOffMinor: { $sum: '$writtenOffMinor' },
        },
      },
    ]),
  ]);

  const agg = totalsRow[0] ?? { billedMinor: 0, paidMinor: 0, refundedMinor: 0, writtenOffMinor: 0 };

  return {
    items,
    total,
    page,
    limit,
    summary: {
      billedMinor: agg.billedMinor,
      paidMinor: agg.paidMinor,
      refundedMinor: agg.refundedMinor,
      writtenOffMinor: agg.writtenOffMinor,
      outstandingMinor: Math.max(0, agg.billedMinor - agg.paidMinor - agg.writtenOffMinor),
    },
  };
}

export async function getInvoice(ctx, id) {
  const invoice = await Invoice.findOne({ _id: id, business: ctx.businessId, deletedAt: null })
    .populate('customer', 'name customerCode phone email address')
    .populate('createdBy', 'name')
    .lean({ virtuals: true });

  if (!invoice) throw AppError.notFound('Invoice not found');

  const payments = await Payment.find({ invoice: invoice._id, business: ctx.businessId, status: 'valid' })
    .populate('createdBy', 'name')
    .sort({ paidAt: 1 })
    .lean();

  return { ...invoice, payments };
}

/**
 * Bring stored statuses back in line with the clock.
 * Backs a nightly job and the dashboard's first read of the day.
 */
export async function reconcileStatuses(businessId, { session } = {}) {
  const now = new Date();
  const stale = await Invoice.find({
    business: businessId,
    deletedAt: null,
    status: { $in: ['unpaid', 'partial'] },
    dueDate: { $ne: null, $lt: now },
  }).session(session ?? null);

  let updated = 0;
  for (const invoice of stale) {
    const next = deriveInvoiceStatus({
      totalMinor: invoice.totalMinor,
      paidMinor: invoice.paidMinor,
      status: invoice.status,
      dueDate: invoice.dueDate,
    });
    if (next !== invoice.status) {
      // eslint-disable-next-line no-await-in-loop
      await Invoice.updateOne({ _id: invoice._id }, { $set: { status: next } }, { session });
      updated += 1;
    }
  }
  return { scanned: stale.length, updated };
}

export async function cancelInvoice(ctx, id, reason) {
  return withTransaction(async ({ session }) => {
    const invoice = await Invoice.findOne({ _id: id, business: ctx.businessId, deletedAt: null }).session(session);
    if (!invoice) throw AppError.notFound('Invoice not found');
    if (invoice.status === 'cancelled') throw AppError.badRequest('Invoice is already cancelled');

    const collected = await Payment.aggregate([
      { $match: { invoice: invoice._id, business: ctx.business._id, status: 'valid' } },
      { $group: { _id: null, total: { $sum: '$amountMinor' }, refunded: { $sum: '$refundedMinor' } } },
    ]);
    const net = (collected[0]?.total ?? 0) - (collected[0]?.refunded ?? 0);
    if (net > 0) {
      throw new AppError('Refund the collected amount before cancelling this invoice', {
        status: 422,
        code: 'PAYMENTS_PRESENT',
      });
    }

    await Invoice.updateOne(
      { _id: invoice._id },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: ctx.user._id,
          cancellationReason: reason,
          updatedBy: ctx.user._id,
        },
      },
      { session }
    );

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'invoice.cancel',
      entity: 'Invoice',
      entityId: invoice._id,
      amountMinor: invoice.totalMinor,
      changes: { invoiceNumber: invoice.invoiceNumber, reason },
      ip: ctx.ip,
    });

    return Invoice.findById(invoice._id).session(session).lean();
  }, { label: 'cancelInvoice' });
}

/** Write off a bad debt balance without moving cash. */
export async function writeOffInvoice(ctx, id, { amount, reason }) {
  const money = createMoneyContext(ctx.business);

  return withTransaction(async ({ session }) => {
    const invoice = await Invoice.findOne({ _id: id, business: ctx.businessId, deletedAt: null }).session(session);
    if (!invoice) throw AppError.notFound('Invoice not found');
    if (invoice.status === 'cancelled') throw AppError.badRequest('A cancelled invoice cannot be written off');

    const amountMinor = money.parse(amount, 0);
    const outstanding = outstandingMinor(invoice.totalMinor, invoice.paidMinor) - (invoice.writtenOffMinor ?? 0);
    if (amountMinor <= 0) throw AppError.badRequest('Write-off amount must be greater than zero');
    if (amountMinor > outstanding) {
      throw AppError.badRequest(`Write-off of ${money.format(amountMinor)} exceeds the outstanding ${money.format(outstanding)}`);
    }

    const writtenOffMinor = (invoice.writtenOffMinor ?? 0) + amountMinor;
    const status = deriveInvoiceStatus({
      totalMinor: invoice.totalMinor,
      paidMinor: invoice.paidMinor + writtenOffMinor,
      status: invoice.status === 'cancelled' ? 'cancelled' : undefined,
      dueDate: invoice.dueDate,
    });

    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { writtenOffMinor, status, updatedBy: ctx.user._id }, $push: { writeOffs: { amountMinor, reason, by: ctx.user._id, at: new Date() } } },
      { session }
    );

    await recordAudit({
      business: ctx.businessId,
      actor: ctx.user,
      role: ctx.role,
      action: 'invoice.writeoff',
      entity: 'Invoice',
      entityId: invoice._id,
      amountMinor,
      changes: { invoiceNumber: invoice.invoiceNumber, reason, writtenOffMinor },
      ip: ctx.ip,
    });

    return Invoice.findById(invoice._id).session(session).lean();
  }, { label: 'writeOffInvoice' });
}

/* ------------------------------------------------------------- PDF ------- */

/**
 * Render an invoice to a PDFKit stream.
 * Every figure is derived from minor units -— PDFKit never sees a float sum.
 */
export function streamInvoicePdf(res, invoice, { business, payments = [], copy = false } = {}) {
  const decimals = invoice.currencyDecimals ?? business?.settings?.currencyDecimals ?? 2;
  const symbol = invoice.currencySymbol ?? business?.settings?.currencySymbol ?? 'Rs.';

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: {
    Title: `Invoice ${invoice.invoiceNumber}`,
    Author: invoice.businessSnapshot?.name || business?.name || 'SajiloLekha',
    Subject: 'Invoice',
  } });

  doc.pipe(res);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  let y = doc.page.margins.top;

  const fmt = (minor) => `${symbol} ${fromMinorUnits(minor ?? 0, decimals).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;

  const fmtQty = (q) => (Number.isInteger(q) ? String(q) : String(Number(q.toFixed(3))));

  // ---- Header band ------------------------------------------------------
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);

  const snap = invoice.businessSnapshot ?? {};
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(20).text(snap.name || 'SajiloLekha', left, y + 18);
  const businessLines = [
    snap.legalName && snap.legalName !== snap.name ? snap.legalName : null,
    snap.address,
    [snap.phone, snap.email].filter(Boolean).join(' · '),
    snap.taxNumber ? `Tax / VAT: ${snap.taxNumber}` : null,
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(9).fillColor('#64748B');
  businessLines.forEach((line) => {
    doc.text(line, left, doc.y + 2, { width: pageWidth / 2 });
  });

  const titleX = left + pageWidth / 2 + 20;
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(26).text('INVOICE', titleX, y + 14, { align: 'right', width: pageWidth / 2 - 20 });
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11).text(invoice.invoiceNumber, titleX, doc.y + 2, { align: 'right', width: pageWidth / 2 - 20 });
  doc.font('Helvetica').fontSize(9).fillColor('#64748B');
  doc.text(`Issued ${formatDate(invoice.issuedAt)}`, titleX, doc.y + 2, { align: 'right', width: pageWidth / 2 - 20 });
  if (invoice.dueDate) {
    doc.text(`Due ${formatDate(invoice.dueDate)}`, titleX, doc.y + 1, { align: 'right', width: pageWidth / 2 - 20 });
  }
  if (copy) {
    doc.fillColor('#B45309').font('Helvetica-Bold').text('COPY -— NOT VALID FOR PAYMENT', titleX, doc.y + 3, { align: 'right', width: pageWidth / 2 - 20 });
  }

  y = Math.max(doc.y, y + 92) + 12;

  // ---- Bill to ----------------------------------------------------------
  doc.roundedRect(left, y, pageWidth, 54, 6).fill('#F8F7FE');
  doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(8).text('BILL TO', left + 12, y + 10);
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11).text(invoice.customerName || 'Walk-in customer', left + 12, y + 22, { width: pageWidth / 2 - 24 });
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  const customerMeta = [invoice.customerPhone, invoice.customerAddress].filter(Boolean).join(' · ');
  if (customerMeta) doc.text(customerMeta, left + 12, doc.y + 1, { width: pageWidth / 2 - 24 });

  const statusColors = { paid: '#16A34A', partial: '#D97706', unpaid: '#DC2626', overdue: '#DC2626', cancelled: '#64748B' };
  const statusLabel = String(invoice.status ?? '').toUpperCase();
  doc.roundedRect(left + pageWidth - 116, y + 12, 104, 26, 13).fill(statusColors[invoice.status] ?? '#64748B');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text(statusLabel, left + pageWidth - 116, y + 20, { width: 104, align: 'center' });

  y += 54 + 16;

  // ---- Line items table --------------------------------------------------
  const columns = [
    { key: 'item', label: 'Item', width: 0.36, align: 'left' },
    { key: 'qty', label: 'Qty', width: 0.1, align: 'right' },
    { key: 'price', label: 'Price', width: 0.16, align: 'right' },
    { key: 'discount', label: 'Discount', width: 0.12, align: 'right' },
    { key: 'tax', label: invoice.taxLabel || 'Tax', width: 0.1, align: 'right' },
    { key: 'total', label: 'Amount', width: 0.16, align: 'right' },
  ];
  const colX = {};
  let acc = left;
  for (const c of columns) {
    colX[c.key] = { x: acc, width: pageWidth * c.width };
    acc += pageWidth * c.width;
  }

  const drawHeader = () => {
    doc.rect(left, y, pageWidth, 22).fill('#F1F5F9');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8.5);
    for (const c of columns) {
      doc.text(c.label.toUpperCase(), colX[c.key].x + 6, y + 7, {
        width: colX[c.key].width - 12,
        align: c.align,
        lineBreak: false,
      });
    }
    y += 22;
  };
  drawHeader();

  doc.font('Helvetica').fontSize(9);
  for (const line of invoice.lines ?? []) {
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      doc.font('Helvetica').fontSize(9);
    }
    const rowHeight = 22;
    doc.fillColor('#0F172A')
      .text(line.name, colX.item.x + 6, y + 6, { width: colX.item.width - 12, height: rowHeight, ellipsis: true })
      .fillColor('#475569')
      .text(line.sku ? `SKU ${line.sku}` : '', colX.item.x + 6, y + 15, { width: colX.item.width - 12, fontSize: 7, lineBreak: false })
      .fillColor('#0F172A')
      .text(fmtQty(line.quantity), colX.qty.x + 6, y + 7, { width: colX.qty.width - 12, align: 'right' })
      .text(fmt(line.unitPriceMinor), colX.price.x + 6, y + 7, { width: colX.price.width - 12, align: 'right' })
      .text(line.discountMinor ? `-${fmt(line.discountMinor)}` : '-—', colX.discount.x + 6, y + 7, { width: colX.discount.width - 12, align: 'right' })
      .text(line.taxPercent ? fmt(line.taxMinor) : '-—', colX.tax.x + 6, y + 7, { width: colX.tax.width - 12, align: 'right' })
      .font('Helvetica-Bold')
      .text(fmt(line.totalMinor), colX.total.x + 6, y + 7, { width: colX.total.width - 12, align: 'right' });
    doc.font('Helvetica');
    y += rowHeight;
    doc.moveTo(left, y).lineTo(left + pageWidth, y).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
    doc.fillColor('#0F172A');
  }

  y += 12;

  // ---- Totals -----------------------------------------------------------
  const totalsX = left + pageWidth * 0.55;
  const totalsWidth = pageWidth * 0.45;
  const row = (label, value, { bold = false, color = '#334155' } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9.5).fillColor(color);
    doc.text(label, totalsX, y, { width: totalsWidth * 0.55 });
    doc.text(value, totalsX + totalsWidth * 0.55, y, { width: totalsWidth * 0.45, align: 'right' });
    y += bold ? 18 : 15;
  };

  row('Subtotal', fmt(invoice.grossMinor));
  if (invoice.totalDiscountMinor > 0) row('Discount', `-${fmt(invoice.totalDiscountMinor)}`, { color: '#B45309' });
  row('Net sales', fmt(invoice.netSalesMinor));
  if (invoice.taxMinor > 0) row(`${invoice.taxLabel || 'Tax'}`, fmt(invoice.taxMinor));
  doc.moveTo(totalsX, y).lineTo(left + pageWidth, y).lineWidth(0.8).strokeColor('#CBD5E1').stroke();
  y += 8;
  row('Total', fmt(invoice.totalMinor), { bold: true, color: '#0F172A' });
  row('Paid', `-${fmt(invoice.paidMinor)}`, { color: '#16A34A' });
  if (invoice.refundedMinor > 0) row('Refunded', `+${fmt(invoice.refundedMinor)}`, { color: '#DC2626' });
  if (invoice.writtenOffMinor > 0) row('Written off', `+${fmt(invoice.writtenOffMinor)}`, { color: '#64748B' });
  const due = outstandingMinor(invoice.totalMinor, invoice.paidMinor) - (invoice.writtenOffMinor ?? 0);
  if (due > 0) row('Balance due', fmt(due), { bold: true, color: '#DC2626' });

  // ---- Payment trail ----------------------------------------------------
  if (payments.length) {
    y += 10;
    if (y > doc.page.height - 170) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A').text('Payment history', left, y);
    y += 14;
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
    for (const p of payments) {
      const line = `${formatDate(p.paidAt)}   ${PAYMENT_METHOD_LABELS[p.method] ?? p.method}   ${p.reference}${p.transactionReference ? `  (${p.transactionReference})` : ''}`;
      doc.text(line, left, y, { width: pageWidth });
      doc.text(fmt(p.amountMinor), left + pageWidth - 100, y, { width: 100, align: 'right' });
      y += 13;
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    }
  }

  // ---- Footer -----------------------------------------------------------
  if (invoice.note) {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 10;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0F172A').text('Notes', left, y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569').text(invoice.note, left, y + 12, { width: pageWidth });
    y = doc.y + 6;
  }
  if (invoice.terms) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0F172A').text('Terms', left, y);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(invoice.terms, left, y + 11, { width: pageWidth });
    y = doc.y + 6;
  }

  // Page numbers + footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const pageY = doc.page.height - 34;
    doc.font('Helvetica').fontSize(8).fillColor('#94A3B8');
    if (invoice.footer) {
      doc.text(invoice.footer, left, pageY - 10, { width: pageWidth, align: 'center' });
    }
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, pageY + 4, { width: pageWidth, align: 'center' });
  }

  doc.end();
  return doc;
}

export function formatDate(value) {
  if (!value) return '-—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-—';
  return d.toISOString().slice(0, 10);
}

/**
 * Render a customer statement (opening balance -> every movement -> closing
 * balance) as a printable PDF ledger.
 */
export function streamStatementPdf(res, statement, { business } = {}) {
  const settings = business?.settings ?? {};
  const decimals = settings.currencyDecimals ?? 2;
  const symbol = settings.currencySymbol ?? 'Rs.';
  const fmt = (minor) =>
    `${symbol} ${fromMinorUnits(minor ?? 0, decimals).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Statement -— ${statement.customer.name}` } });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - left - doc.page.margins.right;
  let y = doc.page.margins.top;

  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(20).text(business?.name ?? APP_NAME_SAFE, left, y + 18);
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(16).text('CUSTOMER STATEMENT', left + pageWidth / 2, y + 18, {
    align: 'right',
    width: pageWidth / 2,
  });
  y += 46;

  doc.fillColor('#475569').font('Helvetica').fontSize(9);
  if (statement.period.from || statement.period.to) {
    doc.text(`Period: ${formatDate(statement.period.from)} to ${formatDate(statement.period.to)}`, left, y, { width: pageWidth / 2 });
  }
  doc.text(`Generated: ${formatDate(statement.generatedAt)}`, left + pageWidth / 2, y, { width: pageWidth / 2, align: 'right' });
  y += 22;

  doc.roundedRect(left, y, pageWidth, 48, 6).fill('#F8F7FE');
  doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(8).text('CUSTOMER', left + 12, y + 10);
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11).text(statement.customer.name, left + 12, y + 21);
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569').text(
    [statement.customer.code, statement.customer.phone, statement.customer.email].filter(Boolean).join(' · '),
    left + 12,
    y + 34,
    { width: pageWidth - 24 }
  );
  y += 66;

  // ---- Summary strip ----------------------------------------------------
  const summaryItems = [
    ['Opening balance', fmt(statement.openingBalanceMinor)],
    ['Billed', fmt(statement.billedMinor)],
    ['Collected', fmt(statement.collectedMinor)],
    ['Closing balance', fmt(statement.closingBalanceMinor)],
  ];
  const boxWidth = pageWidth / summaryItems.length;
  summaryItems.forEach(([label, value], i) => {
    const x = left + i * boxWidth;
    doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), x, y, { width: boxWidth - 8 });
    doc.fillColor(i === 3 ? (statement.outstandingMinor > 0 ? '#DC2626' : '#16A34A') : '#0F172A')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(value, x, y + 12, { width: boxWidth - 8 });
  });
  y += 40;

  // ---- Ledger table -----------------------------------------------------
  const columns = [
    { key: 'date', label: 'Date', w: 0.12 },
    { key: 'reference', label: 'Reference', w: 0.2 },
    { key: 'description', label: 'Description', w: 0.36 },
    { key: 'debit', label: 'Debit', w: 0.16 },
    { key: 'credit', label: 'Credit', w: 0.16 },
  ];
  const colX = {};
  let acc = left;
  for (const c of columns) {
    colX[c.key] = { x: acc, width: pageWidth * c.w };
    acc += pageWidth * c.w;
  }
  const drawHead = () => {
    doc.rect(left, y, pageWidth, 20).fill('#F1F5F9');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8);
    for (const c of columns) {
      doc.text(c.label.toUpperCase(), colX[c.key].x + 5, y + 6, {
        width: colX[c.key].width - 10,
        align: c.key === 'debit' || c.key === 'credit' ? 'right' : 'left',
        lineBreak: false,
      });
    }
    // running balance column
    doc.text('BALANCE', left + pageWidth - 90, y + 6, { width: 84, align: 'right', lineBreak: false });
    y += 20;
  };
  drawHead();

  doc.font('Helvetica').fontSize(8.5);
  if (statement.entries.length === 0) {
    doc.fillColor('#94A3B8').text('No transactions in this period.', left + 5, y + 8);
    y += 24;
  }

  for (const entry of statement.entries) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHead();
      doc.font('Helvetica').fontSize(8.5);
    }
    const rowH = 17;
    doc.fillColor('#0F172A')
      .text(formatDate(entry.date), colX.date.x + 5, y + 5, { width: colX.date.width - 10 })
      .fillColor('#475569')
      .text(entry.reference, colX.reference.x + 5, y + 5, { width: colX.reference.width - 10, ellipsis: true })
      .fillColor('#0F172A')
      .text(entry.description, colX.description.x + 5, y + 5, { width: colX.description.width - 10, ellipsis: true })
      .text(entry.debitMinor ? fmt(entry.debitMinor) : '-—', colX.debit.x + 5, y + 5, { width: colX.debit.width - 10, align: 'right' })
      .text(entry.creditMinor ? fmt(entry.creditMinor) : '-—', colX.credit.x + 5, y + 5, { width: colX.credit.width - 10, align: 'right' })
      .font('Helvetica-Bold')
      .text(fmt(entry.balanceMinor), left + pageWidth - 90, y + 5, { width: 84, align: 'right' });
    doc.font('Helvetica');
    y += rowH;
    doc.moveTo(left, y).lineTo(left + pageWidth, y).lineWidth(0.4).strokeColor('#F1F5F9').stroke();
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#94A3B8').text(
      `Page ${i - range.start + 1} of ${range.count}`,
      left,
      doc.page.height - 34,
      { width: pageWidth, align: 'center' }
    );
  }

  doc.end();
  return doc;
}

const APP_NAME_SAFE = 'SajiloLekha';

/**
 * Customer statement: opening balance, every billed/paid movement, closing
 * balance. Rendered as JSON for the UI and as PDF for printing.
 */
export async function customerStatement(ctx, customerId, { from, to } = {}) {
  const money = createMoneyContext(ctx.business);
  const customer = await Customer.findOne({ _id: customerId, business: ctx.businessId, deletedAt: null }).lean();
  if (!customer) throw AppError.notFound('Customer not found');

  const sales = await Sale.find({
    business: ctx.businessId,
    customer: customerId,
    status: 'completed',
    ...(from || to ? { soldAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}),
  })
    .sort({ soldAt: 1 })
    .lean();

  const invoices = await Invoice.find({
    business: ctx.businessId,
    customer: customerId,
    status: { $ne: 'cancelled' },
  })
    .sort({ issuedAt: 1 })
    .lean({ virtuals: true });

  const payments = await Payment.find({
    business: ctx.businessId,
    customer: customerId,
    status: 'valid',
    ...(from || to ? { paidAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}),
  })
    .sort({ paidAt: 1 })
    .lean();

  const openingMinor =
    (customer.openingBalanceType === 'debit' ? 1 : -1) * (customer.openingBalanceMinor ?? 0);

  const entries = [];
  for (const sale of sales) {
    entries.push({
      date: sale.soldAt,
      reference: sale.reference,
      description: `Invoice ${sale.reference}${sale.lines?.length ? ` -— ${sale.lines.length} item(s)` : ''}`,
      debitMinor: sale.totalMinor,
      creditMinor: 0,
      kind: 'invoice',
    });
  }
  for (const payment of payments) {
    entries.push({
      date: payment.paidAt,
      reference: payment.reference,
      description: `Payment via ${PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}${payment.transactionReference ? ` (${payment.transactionReference})` : ''}`,
      debitMinor: 0,
      creditMinor: payment.amountMinor - payment.refundedMinor,
      kind: 'payment',
    });
  }
  for (const invoice of invoices) {
    if (invoice.refundedMinor > 0) {
      entries.push({
        date: invoice.issuedAt,
        reference: invoice.invoiceNumber,
        description: 'Refund',
        debitMinor: 0,
        creditMinor: invoice.refundedMinor,
        kind: 'refund',
      });
    }
  }

  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = openingMinor;
  for (const entry of entries) {
    running += (entry.debitMinor ?? 0) - (entry.creditMinor ?? 0);
    entry.balanceMinor = running;
  }

  const billedMinor = sales.reduce((s, x) => s + x.totalMinor, 0);
  const collectedMinor = payments.reduce((s, p) => s + (p.amountMinor - p.refundedMinor), 0);
  const closingMinor = running;

  return {
    customer: {
      id: customer._id,
      name: customer.name,
      code: customer.customerCode,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
    },
    period: { from: from ?? null, to: to ?? null },
    currency: money.currency,
    openingBalanceMinor: openingMinor,
    billedMinor,
    collectedMinor,
    closingBalanceMinor: closingMinor,
    outstandingMinor: Math.max(0, closingMinor),
    entries,
    generatedAt: new Date(),
  };
}

export default {
  listInvoices,
  getInvoice,
  reconcileStatuses,
  cancelInvoice,
  writeOffInvoice,
  streamInvoicePdf,
  streamStatementPdf,
  customerStatement,
  formatDate,
};
