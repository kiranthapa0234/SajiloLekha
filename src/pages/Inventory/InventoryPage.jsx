/**
 * Inventory — products with search, category and stock-status filters.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Minus, Package, PackagePlus, Plus, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useCategories, useProducts } from '@/hooks/useApi.js';
import { useListState } from '@/hooks/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import AdjustStockModal from '@/components/AdjustStockModal.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { Button, Card, EmptyState, Select, StatusBadge } from '@/components/ui/index.jsx';
import { formatMoney, formatMoneyShort, formatNumber, humanise } from '@/utils/format.js';

const STOCK_FILTERS = [
  { value: 'all', label: 'All stock' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'low_stock', label: 'Low stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'archived', label: 'Archived' },
];

export default function InventoryPage() {
  const { business, can } = useAuth();
  const navigate = useNavigate();
  const [state, update] = useListState({ status: 'all', category: '' });

  /** The row whose stock is being changed, and which way. */
  const [adjusting, setAdjusting] = useState(null);

  // An empty list is either "you have nothing yet" or "your filters hid it".
  // The empty state has to say which, and offer the matching next step.
  const hasFilters = Boolean(state.search?.trim()) || state.status !== 'all' || Boolean(state.category);

  const params = useMemo(
    () => ({
      page: state.page,
      limit: state.limit,
      search: state.search,
      category: state.category || undefined,
      status: state.status,
      sort: state.sort || 'createdAt',
      order: state.order,
    }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = useProducts(params);
  const { data: categories } = useCategories();
  const summary = meta?.summary ?? {};

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Product',
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-3">
            {row.imageUrl ? (
              <img src={row.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-100 text-ink-400">
                <Package className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <Link
                to={`/inventory/${row._id}/edit`}
                className="block truncate text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline"
              >
                {row.name}
              </Link>
              <span className="block truncate text-2xs text-ink-400">
                {row.sku}
                {row.barcode ? ` · ${row.barcode}` : ''}
              </span>
            </div>
          </div>
        ),
      },
      {
        key: 'category',
        label: 'Category',
        hideOnMobile: true,
        render: (row) => row.category?.name ?? <span className="text-ink-400">Uncategorised</span>,
      },
      {
        key: 'stockQuantity',
        label: 'On hand',
        align: 'right',
        sortable: true,
        render: (row) => (
          <div>
            <span className="font-medium tabular text-ink-900">{formatNumber(row.stockQuantity)}</span>
            <span className="ml-1 text-2xs text-ink-400">{row.unit}</span>
            {row.minStockLevel > 0 && (
              <div className="text-2xs text-ink-400">min {formatNumber(row.minStockLevel)}</div>
            )}
          </div>
        ),
      },
      {
        key: 'stockStatus',
        label: 'Status',
        render: (row) => <StatusBadge status={row.stockStatus} label={humanise(row.stockStatus)} />,
      },
      {
        key: 'costPriceMinor',
        label: 'Cost',
        align: 'right',
        sortable: true,
        render: (row) => <span className="tabular text-ink-600">{formatMoney(row.costPriceMinor, business)}</span>,
      },
      {
        key: 'sellingPriceMinor',
        label: 'Price',
        align: 'right',
        sortable: true,
        render: (row) => (
          <div>
            <span className="tabular font-medium text-ink-900">{formatMoney(row.sellingPriceMinor, business)}</span>
            {row.marginPercent !== undefined && (
              <div
                className={`text-2xs tabular ${row.marginPercent >= 0 ? 'text-success-600' : 'text-danger-600'}`}
              >
                {row.marginPercent}%
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'stockValueMinor',
        label: 'Stock value',
        align: 'right',
        hideOnMobile: true,
        render: (row) => <span className="tabular text-ink-600">{formatMoney(row.stockValueMinor, business)}</span>,
      },
      // Raising or cutting stock is the most common thing done from this
      // screen, so it belongs on the row rather than behind a raw product id.
      ...(can('stock:adjust')
        ? [
            {
              key: 'actions',
              label: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdjusting({ product: row, direction: 'in' });
                    }}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add stock
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdjusting({ product: row, direction: 'out' });
                    }}
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              ),
            },
          ]
        : []),
    ],
    [business, can]
  );

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Inventory</h1>
          <p className="mt-0.5 text-sm text-ink-500">Products, pricing and stock levels.</p>
        </div>
        <div className="flex gap-2">
          {can('stock:adjust') && (
            <Button variant="secondary" onClick={() => navigate('/inventory/movements')}>
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              Movements
            </Button>
          )}
          {can('product:write') && (
            <Button onClick={() => navigate('/inventory/new')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New product
            </Button>
          )}
        </div>
      </header>

      <section aria-label="Inventory summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Stock value (cost)"
          value={formatMoneyShort(summary.costValueMinor ?? 0, business)}
          subtitle="Weighted average cost of on-hand stock"
          tone="brand"
        />
        <KpiCard
          label="Retail value"
          value={formatMoneyShort(summary.retailValueMinor ?? 0, business)}
          subtitle={`Potential profit ${formatMoneyShort(summary.potentialProfitMinor ?? 0, business)}`}
          tone="success"
        />
        <KpiCard
          label="Low stock"
          value={formatNumber(summary.lowStock ?? 0)}
          subtitle="At or below the minimum level"
          tone={(summary.lowStock ?? 0) > 0 ? 'warning' : 'success'}
          icon={TriangleAlert}
        />
        <KpiCard
          label="Out of stock"
          value={formatNumber(summary.outOfStock ?? 0)}
          subtitle="Blocking new sales"
          tone={(summary.outOfStock ?? 0) > 0 ? 'danger' : 'success'}
          icon={PackagePlus}
        />
      </section>

      <Card>
        <TableToolbar
          search={state.search}
          onSearchChange={(search) => update({ search })}
          placeholder="Search by name, SKU or barcode…"
        >
          <label htmlFor="stock-filter" className="sr-only">
            Filter by stock status
          </label>
          <Select
            id="stock-filter"
            className="h-9 w-auto py-1 text-sm"
            value={state.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            {STOCK_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <label htmlFor="category-filter" className="sr-only">
            Filter by category
          </label>
          <Select
            id="category-filter"
            className="h-9 w-auto py-1 text-sm"
            value={state.category}
            onChange={(e) => update({ category: e.target.value })}
          >
            <option value="">All categories</option>
            {(categories ?? []).map((category) => (
              <option key={category._id} value={category._id}>
                {category.name}
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
          onRowClick={(row) => navigate(`/inventory/${row._id}/edit`)}
          page={state.page}
          limit={state.limit}
          total={meta?.total ?? 0}
          onPageChange={(page, limit) => update({ page, limit })}
          sort={{ key: state.sort || 'createdAt', order: state.order }}
          onSortChange={({ key, order }) => update({ sort: key, order })}
          empty={
            <EmptyState
              icon={Package}
              title={
                hasFilters ? 'No products match your filters' : 'No products yet'
              }
              description={
                hasFilters
                  ? 'Try a different search term or clear the filters to see everything.'
                  : can('product:write')
                    ? 'Add your first product to start tracking stock and selling.'
                    : 'Products added by an owner or manager will appear here.'
              }
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {can('product:write') && (
                    <Button onClick={() => navigate('/inventory/new')}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add product
                    </Button>
                  )}
                  {/* Filters are the reason this list is empty, so offer a way out. */}
                  {hasFilters && (
                    <Button
                      variant="secondary"
                      onClick={() => update({ search: '', status: 'all' })}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              }
            />
          }
        />
      </Card>

      <AdjustStockModal
        key={adjusting ? `${adjusting.product._id}:${adjusting.direction}` : 'none'}
        open={Boolean(adjusting)}
        product={adjusting?.product ?? null}
        defaultDirection={adjusting?.direction ?? 'in'}
        onClose={() => setAdjusting(null)}
        onSaved={refetch}
      />
    </div>
  );
}
