/**
 * Sales list — every checkout, searchable and filterable by settlement state.
 */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ShoppingCart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useSales } from '@/hooks/useApi.js';
import { useListState } from '@/hooks/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { Button, Card, EmptyState, Select, StatusBadge } from '@/components/ui/index.jsx';
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS, formatDate, formatMoney, formatRelative } from '@/utils/format.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All sales' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function SalesListPage() {
  const { business, can } = useAuth();
  const navigate = useNavigate();
  const [state, update] = useListState({ status: 'all' });

  const params = useMemo(
    () => ({ page: state.page, limit: state.limit, search: state.search, status: state.status, sort: 'soldAt', order: 'desc' }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = useSales(params);
  const rows = useMemo(() => data ?? [], [data]);

  const columns = useMemo(
    () => [
      {
        key: 'reference',
        label: 'Reference',
        sortable: true,
        render: (row) => (
          <Link to={`/sales/${row._id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
            {row.reference}
          </Link>
        ),
      },
      {
        key: 'customerName',
        label: 'Customer',
        sortable: true,
        render: (row) => (
          <span className="block max-w-[180px] truncate">
            {row.customerName}
            {row.isWalkIn && <span className="ml-1.5 text-2xs text-ink-400">(walk-in)</span>}
          </span>
        ),
      },
      {
        key: 'items',
        label: 'Items',
        align: 'right',
        render: (row) => row.itemCount ?? row.lines?.length ?? 0,
      },
      {
        key: 'paymentMethod',
        label: 'Method',
        render: (row) => PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
      },
      {
        key: 'totalMinor',
        label: 'Total',
        align: 'right',
        sortable: true,
        render: (row) => (
          <div>
            <span className="font-medium tabular text-ink-900">{formatMoney(row.totalMinor, business)}</span>
            {row.outstandingMinor > 0 && (
              <span className="ml-1.5 text-2xs tabular text-warning-600">
                {formatMoney(row.outstandingMinor, business)} due
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'soldAt',
        label: 'Sold',
        sortable: true,
        render: (row) => (
          <span className="whitespace-nowrap text-xs text-ink-500" title={formatRelative(row.soldAt)}>
            {formatDate(row.soldAt)}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => {
          const status = row.status === 'cancelled' ? 'cancelled' : row.invoice?.status ?? 'unpaid';
          return <StatusBadge status={status} label={INVOICE_STATUS_LABELS[status]} />;
        },
      },
    ],
    [business]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Sales</h1>
          <p className="mt-0.5 text-sm text-ink-500">Every checkout recorded in this workspace.</p>
        </div>
        {can('sale:write') && (
          <Button onClick={() => navigate('/sales/new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New sale
          </Button>
        )}
      </header>

      <Card>
        <TableToolbar
          search={state.search}
          onSearchChange={(search) => update({ search })}
          placeholder="Search by reference, customer or item…"
        >
          <label htmlFor="sales-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="sales-status"
            className="h-9 w-auto py-1 text-sm"
            value={state.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </TableToolbar>

        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(row) => navigate(`/sales/${row._id}`)}
          page={state.page}
          limit={state.limit}
          total={meta?.total ?? 0}
          onPageChange={(page, limit) => update({ page, limit })}
          sort={{ key: state.sort, order: state.order }}
          onSortChange={({ key, order }) => update({ sort: key, order })}
          empty={
            <EmptyState
              icon={ShoppingCart}
              title="No sales recorded yet"
              description="Your checkouts will appear here with their invoice, payment and stock impact."
              action={
                can('sale:write') ? (
                  <Button onClick={() => navigate('/sales/new')}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Record your first sale
                  </Button>
                ) : null
              }
            />
          }
        />
      </Card>
    </div>
  );
}
