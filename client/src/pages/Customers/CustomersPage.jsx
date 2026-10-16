/**
 * Customers list with live search, filters and lifetime-balance summary.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { customers as customersApi } from '@/services/index.js';
import { useApiMutation, useCustomers } from '@/hooks/useApi.js';
import { useListState } from '@/hooks/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { Alert, Button, Card, ConfirmDialog, EmptyState, Select } from '@/components/ui/index.jsx';
import { formatMoney, formatMoneyShort, formatNumber, formatRelative } from '@/utils/format.js';

export default function CustomersPage() {
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const navigate = useNavigate();
  const [state, update] = useListState({ status: 'active' });
  const [archiving, setArchiving] = useState(null);

  const params = useMemo(
    () => ({ page: state.page, limit: state.limit, search: state.search, status: state.status, sort: state.sort || 'createdAt', order: state.order }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = useCustomers(params);

  const archive = useApiMutation((id) => customersApi.archive(id, 'Archived from the customer list'), {
    successMessage: 'Customer archived',
    onSuccess: () => {
      setArchiving(null);
      refetch();
    },
  });

  const unarchive = useApiMutation((id) => customersApi.restore(id), {
    successMessage: 'Customer restored',
    onSuccess: refetch,
  });

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Customer',
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <Link
              to={`/customers/${row._id}`}
              className="block truncate text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline"
            >
              {row.name}
            </Link>
            <span className="block truncate text-2xs text-ink-400">
              {row.customerCode || 'No code'} · {row.phone}
            </span>
          </div>
        ),
      },
      {
        key: 'invoiceCount',
        label: 'Orders',
        align: 'right',
        sortable: true,
        render: (row) => formatNumber(row.invoiceCount ?? 0),
      },
      {
        key: 'totalSalesMinor',
        label: 'Lifetime sales',
        align: 'right',
        sortable: true,
        render: (row) => <span className="tabular text-ink-900">{formatMoney(row.totalSalesMinor, business)}</span>,
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
        key: 'lastTransactionAt',
        label: 'Last active',
        sortable: true,
        render: (row) => (
          <span className="whitespace-nowrap text-xs text-ink-500">{formatRelative(row.lastTransactionAt)}</span>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => (
          <span className="text-2xs text-ink-500">{row.archivedAt ? 'Archived' : row.isWalkIn ? 'Walk-in' : 'Active'}</span>
        ),
      },
    ],
    [business]
  );

  const summary = meta?.summary ?? {};

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Customers</h1>
          <p className="mt-0.5 text-sm text-ink-500">Balances, purchase history and statements.</p>
        </div>
        {can('customer:write') && (
          <Button onClick={() => navigate('/customers/new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New customer
          </Button>
        )}
      </header>

      <section aria-label="Customer summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Customers" value={formatNumber(summary.customers ?? 0)} tone="brand" />
        <KpiCard label="Lifetime sales" value={formatMoneyShort(summary.lifetimeSalesMinor ?? 0, business)} tone="success" />
        <KpiCard
          label="Outstanding"
          value={formatMoneyShort(summary.outstandingMinor ?? 0, business)}
          subtitle={`${formatNumber(summary.owing ?? 0)} customer(s) owing`}
          tone={(summary.outstandingMinor ?? 0) > 0 ? 'warning' : 'success'}
        />
        <KpiCard label="Collected" value={formatMoneyShort(summary.lifetimePaidMinor ?? 0, business)} tone="neutral" />
      </section>

      <Card>
        <TableToolbar
          search={state.search}
          onSearchChange={(search) => update({ search })}
          placeholder="Search by name, phone or code…"
        >
          <label htmlFor="customer-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="customer-status"
            className="h-9 w-auto py-1 text-sm"
            value={state.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value="active">Active</option>
            <option value="all">All</option>
            <option value="archived">Archived</option>
          </Select>

          {can('customer:write') && state.status === 'archived' && (
            <Button variant="secondary" size="sm" onClick={() => update({ status: 'active' })}>
              Back to active
            </Button>
          )}
        </TableToolbar>

        {state.status === 'archived' && (
          <div className="px-4 pt-3">
            <Alert tone="info">
              Archived customers are hidden from checkout but keep their full history for audit.
              {data?.length ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => unarchive.mutate(data[0]._id)}
                  >
                    Restore {data[0].name}
                  </button>
                </>
              ) : null}
            </Alert>
          </div>
        )}

        <DataTable
          columns={columns}
          rows={data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(row) => navigate(`/customers/${row._id}`)}
          page={state.page}
          limit={state.limit}
          total={meta?.total ?? 0}
          onPageChange={(page, limit) => update({ page, limit })}
          sort={{ key: state.sort || 'createdAt', order: state.order }}
          onSortChange={({ key, order }) => update({ sort: key, order })}
          empty={
            <EmptyState
              icon={Users}
              title={state.search ? 'No customers match your search' : 'No customers yet'}
              description={
                state.search
                  ? 'Try a different name, phone number or customer code.'
                  : 'Customers appear automatically when you record a sale against them.'
              }
              action={
                can('customer:write') && !state.search ? (
                  <Button onClick={() => navigate('/customers/new')}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add a customer
                  </Button>
                ) : null
              }
            />
          }
        />
      </Card>

      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={() => archive.mutate(archiving._id)}
        title={`Archive ${archiving?.name ?? 'customer'}?`}
        description="They will be hidden from checkout and search. Their invoices, payments and statements are kept."
        confirmLabel="Archive"
        loading={archive.isPending}
      >
        {archive.error && <Alert tone="danger">{archive.error.message}</Alert>}
      </ConfirmDialog>

      <span className="sr-only" aria-live="polite">
        {archive.isPending ? 'Archiving customer' : ''}
      </span>
      <span className="sr-only">Workspace {businessId}</span>
    </div>
  );
}
