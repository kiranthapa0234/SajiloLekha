/**
 * Overview — the dashboard.
 *
 * Layout mirrors the product reference: a row of KPI cards, a sales-versus-profit
 * chart beside a payment-method doughnut, then recent activity.
 *
 * Every figure on this page is computed by the server from real MongoDB records.
 * Nothing here is seeded, cached in the client, or hard-coded.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  PackageX,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useDashboardSummary } from '@/hooks/useApi.js';
import { RANGE_PRESETS } from '@/hooks/index.js';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Select } from '@/components/ui/index.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { CashFlowChart, PaymentMethodsChart, RankedBars, SalesOverviewChart } from '@/components/charts/index.jsx';
import {
  INVOICE_STATUS_LABELS,
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  formatRelative,
} from '@/utils/format.js';
import { StatusBadge } from '@/components/ui/index.jsx';

export default function DashboardPage() {
  const { business } = useAuth();
  const [preset, setPreset] = useState('today');
  const [showCashFlow, setShowCashFlow] = useState(false);

  const { data, isLoading, error, refetch } = useDashboardSummary({ preset, limit: 5 });

  const series = useMemo(() => data?.charts?.salesOverview?.series ?? [], [data]);
  const paymentMethods = useMemo(() => data?.charts?.paymentMethods?.items ?? [], [data]);

  if (error) {
    return <ErrorState error={error} onRetry={refetch} className="py-24" />;
  }

  const kpis = data?.kpis;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      {/* ---------------------------------------------------------- header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">The bigger picture.</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            A sample of your connected workspace
            {business?.name ? ` · ${business.name}` : ''}
          </p>
        </div>

        <RangeFilter value={preset} onChange={setPreset} />
      </header>

      {/* ------------------------------------------------------------ KPIs */}
      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Today's sales"
          value={formatMoney(kpis?.todaySales?.valueMinor ?? 0, business, { compact: true })}
          subtitle={`${formatNumber(kpis?.todaySales?.orders ?? 0)} orders today`}
          icon={ShoppingCart}
          tone="brand"
          changePercent={kpis?.todaySales?.changePercent ?? null}
          formula={kpis?.todaySales?.formula}
          loading={isLoading}
        />
        <KpiCard
          label="Total orders"
          value={formatNumber(kpis?.totalOrders?.value ?? 0)}
          subtitle={`${formatNumber(kpis?.totalOrders?.itemsSold ?? 0)} items sold`}
          icon={Receipt}
          tone="neutral"
          changePercent={kpis?.totalOrders?.changePercent ?? null}
          formula={kpis?.totalOrders?.formula}
          loading={isLoading}
        />
        <KpiCard
          label="Net profit"
          value={formatMoney(kpis?.netProfit?.valueMinor ?? 0, business, { compact: true })}
          subtitle={`${formatNumber(kpis?.netProfit?.marginPercent ?? 0)}% margin`}
          icon={TrendingUp}
          tone={kpis?.netProfit?.valueMinor >= 0 ? 'success' : 'danger'}
          changePercent={kpis?.netProfit?.changePercent ?? null}
          formula={kpis?.netProfit?.formula}
          loading={isLoading}
        />
        <KpiCard
          label="Outstanding"
          value={formatMoney(kpis?.outstanding?.valueMinor ?? 0, business, { compact: true })}
          subtitle={`${formatNumber(kpis?.outstanding?.overdueCount ?? 0)} overdue invoices`}
          icon={Wallet}
          tone={kpis?.outstanding?.overdueCount > 0 ? 'danger' : 'brand'}
          formula={kpis?.outstanding?.formula}
          loading={isLoading}
        />
        <KpiCard
          label="Total expenses"
          value={formatMoney(kpis?.totalExpenses?.valueMinor ?? 0, business, { compact: true })}
          subtitle={`${formatNumber(kpis?.totalExpenses?.count ?? 0)} recorded`}
          icon={Wallet}
          tone="warning"
          changePercent={kpis?.totalExpenses?.changePercent ?? null}
          formula={kpis?.totalExpenses?.formula}
          loading={isLoading}
        />
        <KpiCard
          label="Low stock"
          value={formatNumber(kpis?.lowStock?.value ?? 0)}
          subtitle={`${formatNumber(kpis?.lowStock?.outOfStockCount ?? 0)} out of stock`}
          icon={AlertTriangle}
          tone={kpis?.lowStock?.value > 0 ? 'warning' : 'success'}
          formula={kpis?.lowStock?.formula}
          loading={isLoading}
        />
      </section>

      {/* ----------------------------------------------- charts + summary */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Sales overview"
            subtitle="Revenue against profit for the selected period"
            action={
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Chart metric"
                  className="h-8 w-auto py-1 text-xs"
                  value={showCashFlow ? 'cashflow' : 'bars'}
                  onChange={(e) => setShowCashFlow(e.target.value === 'cashflow')}
                >
                  <option value="bars">Sales vs profit</option>
                  <option value="cashflow">Cash flow</option>
                </Select>
              </div>
            }
          />
          <CardBody>
            {showCashFlow ? (
              <CashFlowChart data={series} business={business} />
            ) : (
              <SalesOverviewChart data={series} business={business} height={280} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment methods" subtitle="How customers paid" />
          <CardBody>
            <PaymentMethodsChart items={paymentMethods} business={business} />
            {paymentMethods.length > 0 && (
              <ul className="mt-4 space-y-2">
                {paymentMethods.map((item) => (
                  <li key={item.method} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-ink-600">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: '#7657E8' }}
                        aria-hidden="true"
                      />
                      {item.method?.replace('_', ' ')}
                    </span>
                    <span className="font-medium tabular text-ink-900">
                      {formatMoneyShort(item.totalMinor, business)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------- recent activity */}
      <Card>
        <CardHeader
          title="Recent transactions"
          subtitle="Latest invoices issued in this workspace"
          action={
            <Link to="/invoices" className="lk-btn-ghost lk-btn-sm">
              View all
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        />
        <RecentTransactions rows={data?.tables?.recentTransactions ?? []} loading={isLoading} business={business} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Top products"
            subtitle="Most units sold in the selected period"
            action={
              <Link to="/reports/sales" className="lk-btn-ghost lk-btn-sm">
                Report
              </Link>
            }
          />
          <CardBody>
            <RankedBars
              items={data?.tables?.topProducts ?? []}
              business={business}
              valueKey="revenueMinor"
              rankKey="unitsSold"
              emptyLabel="No sales yet"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent customers"
            subtitle="Latest activity"
            action={
              <Link to="/customers" className="lk-btn-ghost lk-btn-sm">
                View all
              </Link>
            }
          />
          <CardBody className="p-0">
            {isLoading ? (
              <ul className="divide-y divide-ink-100">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className="h-8 w-8 animate-pulse rounded-full bg-ink-100" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-28 animate-pulse rounded bg-ink-100" />
                      <div className="h-2.5 w-16 animate-pulse rounded bg-ink-100" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (data?.tables?.recentCustomers ?? []).length === 0 ? (
              <EmptyState
                compact
                icon={UserPlus}
                title="No customers yet"
                description="Customers appear here as soon as you record a sale."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.tables.recentCustomers.map((customer) => (
                  <li key={customer.id}>
                    <Link
                      to={`/customers/${customer.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-brand-50/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {customer.name}
                          {customer.isWalkIn && (
                            <span className="ml-1.5 text-2xs text-ink-400">(walk-in)</span>
                          )}
                        </p>
                        <p className="truncate text-2xs text-ink-400">
                          {customer.invoiceCount} orders · {formatRelative(customer.lastTransactionAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular text-ink-900">
                          {formatMoneyShort(customer.totalSalesMinor, business)}
                        </p>
                        {customer.outstandingMinor > 0 && (
                          <p className="text-2xs tabular text-warning-600">
                            {formatMoneyShort(customer.outstandingMinor, business)} due
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Low stock alerts"
            subtitle="At or below the reorder level"
            action={
              <Link to="/inventory?filter=low_stock" className="lk-btn-ghost lk-btn-sm">
                View all
              </Link>
            }
          />
          <CardBody className="p-0">
            {isLoading ? (
              <ul className="divide-y divide-ink-100">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="h-3 w-32 animate-pulse rounded bg-ink-100" />
                    <div className="h-3 w-10 animate-pulse rounded bg-ink-100" />
                  </li>
                ))}
              </ul>
            ) : (data?.tables?.lowStockItems ?? []).length === 0 ? (
              <EmptyState compact icon={PackageX} title="Stock levels are healthy" description="Nothing needs restocking." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.tables.lowStockItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{item.name}</p>
                      <p className="truncate text-2xs text-ink-400">{item.sku}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusBadge status={item.status} label={item.status === 'out_of_stock' ? 'Out' : 'Low'} />
                      <p className="mt-1 text-2xs tabular text-ink-400">
                        {formatNumber(item.stockQuantity)} / {formatNumber(item.minStockLevel)} {item.unit}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function RangeFilter({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4 text-ink-400" aria-hidden="true" />
      <label htmlFor="dashboard-range" className="sr-only">
        Reporting period
      </label>
      <Select
        id="dashboard-range"
        className="h-9 w-auto py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {RANGE_PRESETS.filter((p) => p.key !== 'custom').map((preset) => (
          <option key={preset.key} value={preset.key}>
            {preset.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function RecentTransactions({ rows, loading, business }) {
  if (loading) {
    return (
      <div className="divide-y divide-ink-100" role="status" aria-label="Loading transactions">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            <div className="h-3 w-28 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-36 animate-pulse rounded bg-ink-100" />
            <div className="ml-auto h-3 w-20 animate-pulse rounded bg-ink-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon={Receipt}
        title="No transactions yet"
        description="Record your first sale and it will appear here."
        action={
          <Link to="/sales/new" className="lk-btn-primary">
            New sale
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="lk-table">
        <caption className="sr-only">Most recent invoices</caption>
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Customer</th>
            <th scope="col" className="text-right">
              Amount
            </th>
            <th scope="col">Issued</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link
                  to={`/invoices/${row.id}`}
                  className="font-mono text-xs font-medium text-brand-700 hover:underline"
                >
                  {row.invoiceNumber}
                </Link>
              </td>
              <td className="max-w-[180px] truncate">{row.customerName}</td>
              <td className="text-right font-medium tabular text-ink-900">
                {formatMoney(row.totalMinor, business)}
                {row.outstandingMinor > 0 && (
                  <span className="ml-1.5 text-2xs font-normal text-warning-600">
                    {formatMoneyShort(row.outstandingMinor, business)} due
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.issuedAt)}</td>
              <td>
                <StatusBadge status={row.status} label={INVOICE_STATUS_LABELS[row.status]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { clsx };
