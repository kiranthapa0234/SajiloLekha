/**
 * Invoices — the customer-facing billing documents.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, FileText } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useInvoices } from '@/hooks/useApi.js';
import { useDownload, useListState } from '@/hooks/index.js';
import { invoices as invoicesApi } from '@/services/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { Button, Card, EmptyState, Select, StatusBadge } from '@/components/ui/index.jsx';
import { INVOICE_STATUS_LABELS, formatDate, formatMoney, formatMoneyShort, formatNumber } from '@/utils/format.js';

export default function InvoicesPage() {
  const { business } = useAuth();
  const navigate = useNavigate();
  const [state, update] = useListState({ status: 'all' });

  const params = useMemo(
    () => ({ page: state.page, limit: state.limit, search: state.search, status: state.status, sort: 'issuedAt', order: 'desc' }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = useInvoices(params);
  const summary = meta?.summary ?? {};

  const downloadFile = useDownload();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  // The filter is applied server-side, so the file contains the rows on screen
  // rather than whatever happens to be loaded on this page of results.
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await invoicesApi.exportCsv({
        status: state.status,
        search: state.search,
        sort: 'issuedAt',
        order: 'desc',
      });
      downloadFile(blob, filename);
    } catch (err) {
      setExportError(err.message ?? 'The export could not be created.');
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'invoiceNumber',
        label: 'Invoice',
        sortable: true,
        render: (row) => (
          <Link to={`/invoices/${row._id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
            {row.invoiceNumber}
          </Link>
        ),
      },
      {
        key: 'customerName',
        label: 'Customer',
        sortable: true,
        render: (row) => <span className="block max-w-[200px] truncate">{row.customerName}</span>,
      },
      {
        key: 'issuedAt',
        label: 'Issued',
        sortable: true,
        render: (row) => <span className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.issuedAt)}</span>,
      },
      {
        key: 'dueDate',
        label: 'Due',
        sortable: true,
        render: (row) => (
          <span className="whitespace-nowrap text-xs text-ink-500">
            {row.dueDate ? formatDate(row.dueDate) : 'On receipt'}
          </span>
        ),
      },
      {
        key: 'totalMinor',
        label: 'Total',
        align: 'right',
        sortable: true,
        render: (row) => <span className="tabular font-medium text-ink-900">{formatMoney(row.totalMinor, business)}</span>,
      },
      {
        key: 'outstandingMinor',
        label: 'Outstanding',
        align: 'right',
        render: (row) =>
          row.outstandingMinor > 0 ? (
            <span className="tabular font-medium text-warning-600">{formatMoney(row.outstandingMinor, business)}</span>
          ) : (
            <span className="text-ink-400">--</span>
          ),
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => <StatusBadge status={row.status} label={INVOICE_STATUS_LABELS[row.status]} />,
      },
    ],
    [business]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Invoices</h1>
        <p className="mt-0.5 text-sm text-ink-500">Every invoice issued, and what is still owed on it.</p>
      </header>

      <section aria-label="Invoice summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Billed" value={formatMoneyShort(summary.billedMinor ?? 0, business)} tone="brand" />
        <KpiCard label="Collected" value={formatMoneyShort(summary.paidMinor ?? 0, business)} tone="success" />
        <KpiCard
          label="Outstanding"
          value={formatMoneyShort(summary.outstandingMinor ?? 0, business)}
          tone={(summary.outstandingMinor ?? 0) > 0 ? 'warning' : 'success'}
        />
        <KpiCard label="Refunded" value={formatMoneyShort(summary.refundedMinor ?? 0, business)} tone="neutral" />
      </section>

      <Card>
        <TableToolbar
          search={state.search}
          onSearchChange={(search) => update({ search })}
          placeholder="Search by invoice number or customer…"
        >
          <label htmlFor="invoice-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="invoice-status"
            className="h-9 w-auto py-1 text-sm"
            value={state.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value="all">All invoices</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Part paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={exporting || !(meta?.total ?? 0)}
            title={exporting ? 'Preparing the export…' : 'Download every invoice matching this filter as CSV'}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </TableToolbar>

        {exportError && (
          <p role="alert" className="border-t border-danger-200 bg-danger-50 px-4 py-2 text-2xs text-danger-700">
            {exportError}
          </p>
        )}

        <DataTable
          columns={columns}
          rows={data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(row) => navigate(`/invoices/${row._id}`)}
          page={state.page}
          limit={state.limit}
          total={meta?.total ?? 0}
          onPageChange={(page, limit) => update({ page, limit })}
          sort={{ key: state.sort || 'issuedAt', order: state.order }}
          onSortChange={({ key, order }) => update({ sort: key, order })}
          empty={
            <EmptyState
              icon={FileText}
              title="No invoices in this view"
              description="An invoice is created automatically whenever you record a sale."
              action={
                <Button variant="secondary" onClick={() => navigate('/sales')}>
                  Go to sales
                </Button>
              }
            />
          }
        />

        <p className="border-t border-ink-100 px-4 py-3 text-2xs text-ink-400">
          {formatNumber(meta?.total ?? 0)} invoice(s) match this filter. Outstanding is computed as
          total minus paid minus written-off.
        </p>
      </Card>
    </div>
  );
}
