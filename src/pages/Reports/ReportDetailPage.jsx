/**
 * Report detail.
 *
 * Each report renders its own headline figures, a table of rows, and exports.
 * Reports with a definition block (profit & loss, collections) display the
 * formula explicitly so the numbers are auditable rather than trusted.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useReport } from '@/hooks/useApi.js';
import { RANGE_PRESETS, useDateRange, useDownload } from '@/hooks/index.js';
import { reports as reportsApi } from '@/services/index.js';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataPoint,
  Select,
  Spinner,
} from '@/components/ui/index.jsx';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, humanise, toDateInput } from '@/utils/format.js';

const TITLES = {
  sales: 'Sales report',
  'profit-loss': 'Profit & loss',
  expenses: 'Expense report',
  inventory: 'Inventory valuation',
  'stock-movements': 'Stock movement report',
  'low-stock': 'Low stock report',
  customers: 'Customer transaction report',
  collections: 'Payment collection report',
  outstanding: 'Outstanding invoices',
  suppliers: 'Supplier balances',
};

export default function ReportDetailPage() {
  const { key } = useParams();
  const { business, can } = useAuth();
  const navigate = useNavigate();
  const download = useDownload();
  const { range, setRange, params: rangeParams } = useDateRange({ preset: 'month' });
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState(null);

  const params = useMemo(
    () => ({
      ...rangeParams,
      format: 'json',
      limit: 500,
    }),
    [rangeParams]
  );

  const { data, isLoading, error } = useReport(key, params);
  const title = TITLES[key] ?? 'Report';
  const needsDates = !['inventory', 'low-stock'].includes(key);

  const runExport = async (format) => {
    setExporting(format);
    setExportError(null);
    try {
      if (format === 'csv') {
        const { blob, filename } = await reportsApi.export(key, params);
        download(blob, filename);
      } else {
        const { blob, filename } = await reportsApi.exportPdf(key, params);
        download(blob, filename);
      }
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/reports')} className="-ml-2 mb-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All reports
          </Button>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {data?.range?.from && (
            <p className="mt-0.5 text-sm text-ink-500">
              {formatDate(data.range.from)} to {formatDate(data.range.to)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsDates && (
            <>
              <Select
                className="h-9 w-auto py-1 text-sm"
                value={range.preset}
                onChange={(e) => setRange({ preset: e.target.value })}
                aria-label="Reporting period"
              >
                {RANGE_PRESETS.filter((p) => p.key !== 'custom').map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </Select>

              {range.preset === 'custom' && (
                <>
                  <input
                    type="date"
                    className="lk-input h-9 w-auto py-1 text-sm"
                    value={range.from ?? ''}
                    max={range.to ?? undefined}
                    onChange={(e) => setRange({ ...range, preset: 'custom', from: toDateInput(e.target.value) })}
                    aria-label="From date"
                  />
                  <input
                    type="date"
                    className="lk-input h-9 w-auto py-1 text-sm"
                    value={range.to ?? ''}
                    min={range.from ?? undefined}
                    onChange={(e) => setRange({ ...range, preset: 'custom', to: toDateInput(e.target.value) })}
                    aria-label="To date"
                  />
                </>
              )}
            </>
          )}

          {can('report:export') && (
            <>
              <Button
                variant="secondary"
                onClick={() => runExport('csv')}
                loading={exporting === 'csv'}
                disabled={Boolean(exporting)}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => runExport('pdf')}
                loading={exporting === 'pdf'}
                disabled={Boolean(exporting)}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                PDF
              </Button>
            </>
          )}
        </div>
      </header>

      {exportError && <Alert tone="danger">{exportError}</Alert>}

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      )}

      {error && <Alert tone="danger" title="Could not build this report">{error.message}</Alert>}

      {data && (
        <>
          {(data.notes || data.note) && (
            <Alert tone="info" title="How to read this report">
              <ul className="list-disc space-y-1 pl-4">
                {(Array.isArray(data.notes) ? data.notes : [data.note]).filter(Boolean).map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
                {data.method && <li>{data.method}</li>}
              </ul>
            </Alert>
          )}

          {key === 'profit-loss' && <ProfitLossReport report={data} business={business} />}
          {key === 'sales' && <SalesReport report={data} business={business} />}
          {key === 'expenses' && <ExpenseReport report={data} business={business} />}
          {key === 'inventory' && <InventoryReport report={data} business={business} />}
          {key === 'low-stock' && <LowStockReport report={data} business={business} />}
          {key === 'collections' && <CollectionsReport report={data} business={business} />}
          {key === 'outstanding' && <OutstandingReport report={data} business={business} />}
          {key === 'customers' && <CustomersReport report={data} business={business} />}
          {key === 'suppliers' && <SuppliersReport report={data} business={business} />}
          {key === 'stock-movements' && <MovementsReport report={data} business={business} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- REPORTS -- */

function ProfitLossReport({ report, business }) {
  return (
    <>
      <Card>
        <CardHeader title="Statement" subtitle="Every line states the formula behind it" />
        <CardBody className="p-0">
          <table className="lk-table">
            <caption className="sr-only">Profit and loss statement</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col" className="text-right">
                  Amount
                </th>
                <th scope="col">Definition</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => (
                <tr key={line.key} className={line.emphasis ? 'bg-brand-50/50' : undefined}>
                  <td className={line.emphasis ? 'font-semibold text-ink-900' : undefined}>{line.label}</td>
                  <td
                    className={`text-right tabular ${
                      line.amountMinor < 0 ? 'text-danger-600' : line.key === 'netProfit' ? 'font-semibold text-ink-900' : 'text-ink-800'
                    }`}
                  >
                    {formatMoney(line.amountMinor, business)}
                  </td>
                  <td className="max-w-[320px] text-xs text-ink-500">{line.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Orders" value={formatNumber(report.metrics.orders)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Gross margin" value={`${report.metrics.grossMarginPercent}%`} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Net margin" value={`${report.metrics.netMarginPercent}%`} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint
                label="Cash collected"
                value={formatMoneyShort(report.metrics.cashCollectedMinor, business)}
              />
              <p className="mt-1 text-2xs text-ink-400">Cash metric, not profit.</p>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Expenses by category" />
        <CardBody className="p-0">
          <table className="lk-table">
            <caption className="sr-only">Expenses by category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="text-right">Count</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col" className="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.map((row) => (
                <tr key={row.category}>
                  <td>{humanise(row.category)}</td>
                  <td className="text-right tabular">{formatNumber(row.count)}</td>
                  <td className="text-right tabular">{formatMoney(row.totalMinor, business)}</td>
                  <td className="text-right tabular text-ink-500">{row.sharePercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <DataPoint label="Tax collected" value={formatMoneyShort(report.metrics.taxCollectedMinor, business)} />
            <DataPoint label="Receivable" value={formatMoneyShort(report.metrics.receivableMinor, business)} />
            <DataPoint label="Closing stock value" value={formatMoneyShort(report.metrics.closingStockValueMinor, business)} />
            <DataPoint label="Basis" value={humanise(report.basis)} />
          </dl>
        </CardBody>
      </Card>
    </>
  );
}

function SalesReport({ report, business }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Orders" value={formatNumber(report.totals.orders)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Billed" value={formatMoneyShort(report.totals.totalMinor, business)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Average order" value={formatMoneyShort(report.totals.averageOrderMinor, business)} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Uncollected" value={formatMoneyShort(report.totals.uncollectedMinor, business)} />
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Daily" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'orders', label: 'Orders', align: 'right' },
              { key: 'items', label: 'Items', align: 'right' },
              { key: 'grossMinor', label: 'Gross', align: 'right', money: true },
              { key: 'discountMinor', label: 'Discount', align: 'right', money: true },
              { key: 'netSalesMinor', label: 'Net sales', align: 'right', money: true },
              { key: 'taxMinor', label: 'Tax', align: 'right', money: true },
              { key: 'grossProfitMinor', label: 'Gross profit', align: 'right', money: true },
            ]}
            rows={report.rows}
            business={business}
            empty="No sales in this period."
          />
        </CardBody>
      </Card>
    </>
  );
}

function ExpenseReport({ report, business }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Total" value={formatMoneyShort(report.totalMinor, business)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Records" value={formatNumber(report.count)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Average" value={formatMoneyShort(report.averageMinor, business)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Projected monthly" value={formatMoneyShort(report.monthlyProjectionMinor, business)} />
              <p className="mt-1 text-2xs text-ink-400">Based on the daily run rate in this period.</p>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="By category" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'label', label: 'Category' },
              { key: 'count', label: 'Count', align: 'right' },
              { key: 'totalMinor', label: 'Amount', align: 'right', money: true },
              { key: 'sharePercent', label: 'Share', align: 'right', suffix: '%' },
            ]}
            rows={report.byCategory}
            business={business}
            empty="No expenses in this period."
          />
        </CardBody>
      </Card>
    </>
  );
}

function InventoryReport({ report, business }) {
  const s = report.summary;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Stock at cost" value={formatMoneyShort(s.stockValueMinor, business)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Retail value" value={formatMoneyShort(s.retailValueMinor, business)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Potential profit" value={formatMoneyShort(s.potentialProfitMinor, business)} />
            </dl>
          </CardBody>
        </Card>
        <Card><CardBody><dl><DataPoint label="Units on hand" value={formatNumber(s.units)} /></dl></CardBody></Card>
      </div>

      <Card>
        <CardHeader title="By product" subtitle="Weighted average cost basis" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'sku', label: 'SKU' },
              { key: 'categoryName', label: 'Category' },
              { key: 'stockQuantity', label: 'On hand', align: 'right' },
              { key: 'effectiveCostMinor', label: 'Unit cost', align: 'right', money: true },
              { key: 'stockValueMinor', label: 'Stock value', align: 'right', money: true },
              { key: 'status', label: 'Status' },
            ]}
            rows={report.rows}
            business={business}
            empty="No products to value."
          />
        </CardBody>
      </Card>
    </>
  );
}

function LowStockReport({ report, business }) {
  const s = report.summary;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Needs restock" value={formatNumber(s.total)} tone="warning" /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Out of stock" value={formatNumber(s.outOfStock)} tone="danger" /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Shortfall units" value={formatNumber(s.shortfallUnits)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Restock cost" value={formatMoneyShort(s.restockCostMinor, business)} />
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Products to reorder" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'sku', label: 'SKU' },
              { key: 'stockQuantity', label: 'On hand', align: 'right' },
              { key: 'minStockLevel', label: 'Minimum', align: 'right' },
              { key: 'shortfall', label: 'Shortfall', align: 'right' },
              { key: 'restockCostMinor', label: 'Cost to restock', align: 'right', money: true },
              { key: 'status', label: 'Status' },
            ]}
            rows={report.rows}
            business={business}
            empty="Every product is above its reorder level."
          />
        </CardBody>
      </Card>
    </>
  );
}

function CollectionsReport({ report, business }) {
  const t = report.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Billed" value={formatMoneyShort(t.billedMinor, business)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Collected" value={formatMoneyShort(t.collectedMinor, business)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Collection rate" value={`${t.collectionRatePercent}%`} />
            </dl>
          </CardBody>
        </Card>
        <Card><CardBody><dl><DataPoint label="Net cash" value={formatMoneyShort(t.netCashMinor, business)} /></dl></CardBody></Card>
      </div>

      <Card>
        <CardHeader title="By payment method" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'label', label: 'Method' },
              { key: 'count', label: 'Count', align: 'right' },
              { key: 'totalMinor', label: 'Collected', align: 'right', money: true },
              { key: 'reconciledMinor', label: 'Reconciled', align: 'right', money: true },
              { key: 'unreconciledMinor', label: 'Unreconciled', align: 'right', money: true },
              { key: 'sharePercent', label: 'Share', align: 'right', suffix: '%' },
            ]}
            rows={report.byMethod}
            business={business}
            empty="No payments collected in this period."
          />
        </CardBody>
      </Card>
    </>
  );
}

function OutstandingReport({ report, business }) {
  const t = report.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Outstanding" value={formatMoneyShort(t.outstandingMinor, business)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Overdue" value={formatMoneyShort(t.overdueMinor, business)} tone="danger" /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Invoices" value={formatNumber(t.count)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Overdue count" value={formatNumber(t.overdueCount)} /></dl></CardBody></Card>
      </div>

      <Card>
        <CardHeader title="Ageing" subtitle="Standard receivables buckets" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'label', label: 'Bucket' },
              { key: 'count', label: 'Invoices', align: 'right' },
              { key: 'totalMinor', label: 'Amount', align: 'right', money: true },
            ]}
            rows={report.ageing}
            business={business}
            empty="Nothing outstanding."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Invoices" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'invoiceNumber', label: 'Invoice' },
              { key: 'customerName', label: 'Customer' },
              { key: 'issuedAt', label: 'Issued', date: true },
              { key: 'dueDate', label: 'Due', date: true },
              { key: 'totalMinor', label: 'Total', align: 'right', money: true },
              { key: 'outstandingMinor', label: 'Outstanding', align: 'right', money: true },
              { key: 'daysOverdue', label: 'Days overdue', align: 'right' },
              { key: 'status', label: 'Status' },
            ]}
            rows={report.rows}
            business={business}
            empty="Nothing outstanding."
          />
        </CardBody>
      </Card>
    </>
  );
}

function CustomersReport({ report, business }) {
  const t = report.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Customers" value={formatNumber(t.customers)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Billed" value={formatMoneyShort(t.billedMinor, business)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Gross profit" value={formatMoneyShort(t.profitMinor, business)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Outstanding" value={formatMoneyShort(t.outstandingMinor, business)} />
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="By customer" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'name', label: 'Customer' },
              { key: 'phone', label: 'Phone' },
              { key: 'orders', label: 'Orders', align: 'right' },
              { key: 'billedMinor', label: 'Billed', align: 'right', money: true },
              { key: 'averageOrderMinor', label: 'Avg order', align: 'right', money: true },
              { key: 'outstandingMinor', label: 'Outstanding', align: 'right', money: true },
              { key: 'lastOrderAt', label: 'Last order', date: true },
            ]}
            rows={report.rows}
            business={business}
            empty="No customer activity in this period."
          />
        </CardBody>
      </Card>
    </>
  );
}

function SuppliersReport({ report, business }) {
  const t = report.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Purchased" value={formatMoneyShort(t.periodPurchasedMinor, business)} /></dl></CardBody></Card>
        <Card><CardBody><dl><DataPoint label="Paid" value={formatMoneyShort(t.periodPaidMinor, business)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Payable" value={formatMoneyShort(t.periodPayableMinor, business)} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Total outstanding" value={formatMoneyShort(t.outstandingMinor, business)} />
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="By supplier" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'name', label: 'Supplier' },
              { key: 'phone', label: 'Phone' },
              { key: 'periodPurchasedMinor', label: 'Purchased', align: 'right', money: true },
              { key: 'periodPaidMinor', label: 'Paid', align: 'right', money: true },
              { key: 'outstandingMinor', label: 'Outstanding', align: 'right', money: true },
              { key: 'purchaseCount', label: 'Purchases', align: 'right' },
            ]}
            rows={report.rows}
            business={business}
            empty="No supplier activity in this period."
          />
        </CardBody>
      </Card>
    </>
  );
}

function MovementsReport({ report, business }) {
  const t = report.totals;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody><dl><DataPoint label="Movements" value={formatNumber(t.count)} /></dl></CardBody></Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Value in" value={formatMoneyShort(t.valueInMinor, business)} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <dl>
              <DataPoint label="Value out" value={formatMoneyShort(t.valueOutMinor, business)} />
            </dl>
          </CardBody>
        </Card>
        <Card><CardBody><dl><DataPoint label="Types" value={formatNumber(report.byType.length)} /></dl></CardBody></Card>
      </div>

      <Card>
        <CardHeader title="By movement type" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'label', label: 'Type' },
              { key: 'count', label: 'Count', align: 'right' },
              { key: 'unitsIn', label: 'Units in', align: 'right' },
              { key: 'unitsOut', label: 'Units out', align: 'right' },
              { key: 'valueInMinor', label: 'Value in', align: 'right', money: true },
              { key: 'valueOutMinor', label: 'Value out', align: 'right', money: true },
            ]}
            rows={report.byType}
            business={business}
            empty="No stock movements in this period."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Movement ledger" subtitle="Append-only record of every stock change" />
        <CardBody className="p-0">
          <ReportTable
            columns={[
              { key: 'occurredAt', label: 'Date', date: true },
              { key: 'productName', label: 'Product' },
              { key: 'typeLabel', label: 'Type' },
              { key: 'quantity', label: 'Qty', align: 'right' },
              { key: 'quantityAfter', label: 'After', align: 'right' },
              { key: 'reason', label: 'Reason' },
              { key: 'performedBy', label: 'By' },
            ]}
            rows={report.movements}
            business={business}
            empty="No stock movements in this period."
          />
        </CardBody>
      </Card>
    </>
  );
}

/** Minimal table renderer shared by every report. */
function ReportTable({ columns, rows, business, empty }) {
  if (!rows?.length) {
    return <p className="px-5 py-10 text-center text-sm text-ink-400">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="lk-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'right' ? 'text-right' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row._id ?? row.invoiceNumber ?? `${columns[0].key}-${index}`}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'text-right tabular' : undefined}>
                  {formatCell(row[column.key], column, business)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value, column, business) {
  if (value === null || value === undefined || value === '') return '--';
  if (column.money) return formatMoney(value, business);
  if (column.date) return formatDate(value);
  if (column.suffix) return `${value}${column.suffix}`;
  if (typeof value === 'number') return formatNumber(value);
  return value;
}
