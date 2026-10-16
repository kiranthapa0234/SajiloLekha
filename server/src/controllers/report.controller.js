/**
 * Reports controller -— build, export (CSV / PDF) and share a report.
 *
 * The CSV and PDF are generated from the identical dataset returned as JSON, so
 * an export can never disagree with what the user saw.
 */
import PDFDocument from 'pdfkit';
import { asyncHandler } from '../utils/errors.js';
import { sendOk } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { AVAILABLE_REPORTS, buildReport, reportToRows } from '../services/report.service.js';
import { createMoneyContext } from '../services/money.context.js';
import { toCsv } from '../utils/helpers.js';
import { formatDate } from '../services/invoice.service.js';
import { fromMinorUnits } from '../../../shared/money.js';

const BRAND = '#7657E8';

export const index = asyncHandler(async (_req, res) => {
  return sendOk(res, AVAILABLE_REPORTS);
});

export const show = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const format = req.validated.query.format ?? 'json';

  if (!AVAILABLE_REPORTS.some((r) => r.key === key)) {
    throw AppError.notFound(`Unknown report "${key}"`);
  }

  const report = await buildReport(req.ctx, key, req.validated.query);

  if (format === 'csv') {
    await req.ctx.audit?.({ action: 'report.export', entity: 'Report', entityId: null, changes: { report: key, format } });
    const { columns, rows } = reportToRows(key, report);
    const csv = toCsv(rows, columns);
    const filename = `${key}-${formatDate(report.range?.from ?? new Date())}-to-${formatDate(report.range?.to ?? new Date())}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(`\uFEFF${csv}`); // BOM keeps Excel happy with UTF-8
  }

  if (format === 'pdf') {
    await req.ctx.audit?.({ action: 'report.export', entity: 'Report', entityId: null, changes: { report: key, format } });
    const filename = `${key}-report.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return streamReportPdf(res, key, report, req.ctx.business);
  }

  return sendOk(res, report);
});

/* ------------------------------------------------------------ PDF -------- */

function streamReportPdf(res, key, report, business) {
  const settings = business?.settings ?? {};
  const decimals = settings.currencyDecimals ?? 2;
  const symbol = settings.currencySymbol ?? 'Rs.';
  const { columns, rows } = reportToRows(key, report);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: report.title } });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - left - doc.page.margins.right;
  let y = doc.page.margins.top;

  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(18).text(report.title, left, y + 18);
  doc.font('Helvetica').fontSize(9).fillColor('#64748B');
  doc.text(`${business?.name ?? 'SajiloLekha'} · ${formatDate(report.range?.from ?? new Date())} to ${formatDate(report.range?.to ?? new Date())}`, left, doc.y + 3, { width: pageWidth });
  y = doc.y + 18;

  if (report.notes) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#475569');
    const notes = Array.isArray(report.notes) ? report.notes : [report.notes];
    notes.forEach((n) => {
      doc.text(`⬢ ${n}`, left, y, { width: pageWidth });
      y = doc.y + 1;
    });
    doc.font('Helvetica').fontSize(9);
    y += 6;
  }
  if (report.method || report.note) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#475569');
    doc.text(report.method ?? report.note, left, y, { width: pageWidth });
    y = doc.y + 8;
  }

  // Column widths: proportional, with the first column wider.
  const weights = columns.map((c, i) => (i === 0 ? 1.6 : 1));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const colWidths = weights.map((w) => (pageWidth * w) / totalWeight);

  const drawHeader = () => {
    doc.rect(left, y, pageWidth, 20).fill('#F1F5F9');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.5);
    let x = left;
    columns.forEach((c, i) => {
      doc.text(String(c.header).toUpperCase(), x + 4, y + 6, { width: colWidths[i] - 8, align: 'left', lineBreak: false, ellipsis: true });
      x += colWidths[i];
    });
    y += 20;
  };
  drawHeader();

  const cellText = (row, col) => {
    const value = typeof col.value === 'function' ? col.value(row) : row[col.key];
    if (typeof value === 'number' && Math.abs(value) > 0 && !Number.isInteger(value) && key !== 'customers') {
      return fromMinorUnits(value, decimals).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    if (typeof value === 'number' && Math.abs(value) >= 10000) return value.toLocaleString('en-US');
    return value === null || value === undefined ? '' : String(value);
  };

  doc.font('Helvetica').fontSize(7.8);
  for (const row of rows) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      doc.font('Helvetica').fontSize(7.8);
    }
    let x = left;
    columns.forEach((c, i) => {
      doc.fillColor('#0F172A').text(cellText(row, c), x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true, lineBreak: false });
      x += colWidths[i];
    });
    y += 16;
    doc.moveTo(left, y).lineTo(left + pageWidth, y).lineWidth(0.4).strokeColor('#F1F5F9').stroke();
  }

  if (rows.length === 0) {
    doc.fillColor('#94A3B8').fontSize(10).text('No data for the selected period.', left, y + 8);
  }

  // Totals block
  if (report.totals && Object.keys(report.totals).length) {
    y += 16;
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.rect(left, y, pageWidth, 2).fill(BRAND);
    y += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A').text('TOTALS', left, y);
    y += 14;
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
    const entries = Object.entries(report.totals).filter(([, v]) => typeof v === 'number');
    for (let i = 0; i < entries.length; i += 2) {
      const chunk = entries.slice(i, i + 2);
      for (let j = 0; j < chunk.length; j += 1) {
        const [label, value] = chunk[j];
        const x = left + j * (pageWidth / 2);
        doc.font('Helvetica').fillColor('#64748B').text(`${humanise(label)}:`, x, y, { width: 140 });
        doc.font('Helvetica-Bold').fillColor('#0F172A').text(formatTotal(label, value, symbol, decimals), x + 145, y, { width: pageWidth / 2 - 150 });
      }
      y += 14;
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor('#94A3B8').text(
      `Generated by SajiloLekha · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · Page ${i - range.start + 1} of ${range.count}`,
      left,
      doc.page.height - 30,
      { width: pageWidth, align: 'center' }
    );
  }

  doc.end();
  return doc;
}

const MONEY_KEYS = /minor|amount|revenue|profit|sales|cost|expense|paid|collected|value|tax|discount|refund|outstanding|price|balance|total/i;

function formatTotal(label, value, symbol, decimals) {
  if (MONEY_KEYS.test(label)) {
    return `${symbol} ${fromMinorUnits(value, decimals).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
  return value.toLocaleString('en-US');
}

function humanise(key) {
  return key
    .replace(/Minor$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase());
}

export { createMoneyContext };
