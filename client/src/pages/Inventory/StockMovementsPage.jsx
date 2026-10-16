/**
 * Stock movements — the append-only ledger.
 *
 * Every row states what changed, why, and who did it. Nothing here can be
 * edited; a correction is a new, opposing movement.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, History, Plus } from 'lucide-react';
import { STOCK_MOVEMENT_LABELS } from '@shared/constants.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { usePaginated } from '@/hooks/useApi.js';
import { useListState } from '@/hooks/index.js';
import { stock as stockApi } from '@/services/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import {
  Button,
  Card,
  EmptyState,
  Select,
  StatusBadge,
} from '@/components/ui/index.jsx';
import AdjustStockModal from '@/components/AdjustStockModal.jsx';
import { formatDateTime, formatMoney, formatNumber } from '@/utils/format.js';

export default function StockMovementsPage() {
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const [state, update] = useListState({});
  const [adjustOpen, setAdjustOpen] = useState(false);

  const params = useMemo(
    () => ({
      page: state.page,
      limit: state.limit,
      type: state.type || undefined,
      product: state.product || undefined,
      from: state.from || undefined,
      to: state.to || undefined,
    }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = usePaginated(() => ({
    queryKey: ['movements', businessId, params],
    queryFn: () => stockApi.history(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));

  const columns = useMemo(
    () => [
      {
        key: 'occurredAt',
        label: 'When',
        render: (row) => <span className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(row.occurredAt)}</span>,
      },
      {
        key: 'product',
        label: 'Product',
        render: (row) => (
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-900">
              {row.product?.name ?? 'Deleted product'}
            </span>
            <span className="block truncate text-2xs text-ink-400">{row.product?.sku}</span>
          </div>
        ),
      },
      {
        key: 'type',
        label: 'Type',
        render: (row) => <StatusBadge status="recorded" label={STOCK_MOVEMENT_LABELS[row.type] ?? row.type} />,
      },
      {
        key: 'quantity',
        label: 'Change',
        align: 'right',
        render: (row) => (
          <span className={`font-medium tabular ${row.quantity > 0 ? 'text-success-600' : 'text-danger-600'}`}>
            {row.quantity > 0 ? '+' : ''}
            {formatNumber(row.quantity)}
          </span>
        ),
      },
      {
        key: 'quantityAfter',
        label: 'On hand after',
        align: 'right',
        render: (row) => <span className="tabular text-ink-700">{formatNumber(row.quantityAfter)}</span>,
      },
      {
        key: 'reason',
        label: 'Reason',
        render: (row) => (
          <div className="min-w-0">
            <span className="block truncate text-xs text-ink-700">{row.reason}</span>
            {row.related?.number && (
              <span className="block truncate text-2xs text-ink-400">{row.related.number}</span>
            )}
          </div>
        ),
      },
      {
        key: 'performedBy',
        label: 'By',
        render: (row) => <span className="text-xs text-ink-500">{row.performedBy?.name ?? 'system'}</span>,
      },
      {
        key: 'valueMinor',
        label: 'Value',
        align: 'right',
        hideOnMobile: true,
        render: (row) => <span className="tabular text-ink-500">{formatMoney(row.valueMinor, business)}</span>,
      },
    ],
    [business]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="-ml-2 mb-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to inventory
          </Button>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Stock movements</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Every change to stock, with the reason it was made. This ledger cannot be edited.
          </p>
        </div>
        {can('stock:adjust') && (
          <Button onClick={() => setAdjustOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Adjust stock
          </Button>
        )}
      </header>

      <Card>
        <TableToolbar search={state.search} onSearchChange={() => {}} placeholder="Search is available on the inventory list">
          <label htmlFor="movement-type" className="sr-only">
            Filter by movement type
          </label>
          <Select
            id="movement-type"
            className="h-9 w-auto py-1 text-sm"
            value={state.type ?? ''}
            onChange={(e) => update({ type: e.target.value })}
          >
            <option value="">All types</option>
            {Object.entries(STOCK_MOVEMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </TableToolbar>

        <DataTable
          columns={columns}
          rows={data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          page={state.page}
          limit={state.limit}
          total={meta?.total ?? 0}
          onPageChange={(page, limit) => update({ page, limit })}
          empty={
            <EmptyState
              icon={History}
              title="No stock movements yet"
              description="Sales, purchases and manual adjustments all appear here."
            />
          }
        />
      </Card>

      <AdjustStockModal open={adjustOpen} onClose={() => setAdjustOpen(false)} onSaved={refetch} />
    </div>
  );
}
