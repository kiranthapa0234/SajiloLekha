/**
 * Chart building blocks.
 *
 * All charts share one visual language: no chart junk, a single highlighted
 * series, tooltips that match the rest of the UI, and colours drawn from the
 * brand palette. Recharts is configured once here rather than per page.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PAYMENT_METHOD_LABELS } from '@shared/constants.js';
import { formatMoneyShort, formatNumber } from '@/utils/format.js';

/** Purple-led categorical ramp, ordered by prominence. */
export const CHART_COLORS = ['#7657E8', '#A78BFA', '#DDD6FE', '#4E34A0', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9'];

const axisProps = {
  stroke: '#94A3B8',
  tick: { fill: '#94A3B8', fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

function ChartTooltip({ active, payload, label, business, moneyKeys = [] }) {
  if (!active || !payload?.length) return null;

  const entry = payload.find((p) => p.dataKey === 'revenueMinor') ?? payload[0];

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-popover">
      {label && <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>}
      <ul className="space-y-1">
        {payload
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p) => (
            <li key={p.dataKey} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-ink-600">
                <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.fill }} aria-hidden="true" />
                {p.name}
              </span>
              <span className="font-semibold tabular text-ink-900">
                {moneyKeys.includes(p.dataKey) ? formatMoneyShort(p.value, business) : formatNumber(p.value)}
              </span>
            </li>
          ))}
      </ul>
      {entry?.payload?.orders !== undefined && (
        <p className="mt-1.5 border-t border-ink-100 pt-1.5 text-2xs text-ink-500">
          {formatNumber(entry.payload.orders)} orders
        </p>
      )}
    </div>
  );
}

function ChartFrame({ height = 280, children, empty, emptyLabel = 'No data for this period' }) {
  if (empty) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-ink-200 text-sm text-ink-400"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }
  return (
    <div style={{ height }} role="img" aria-label="Chart">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Sales vs profit — the dashboard's headline visual.
 * Bars are revenue, the lighter bars are profit, exactly as in the reference.
 */
export function SalesOverviewChart({ data = [], business, height = 280, compact = false }) {
  const isEmpty = data.every((d) => !d.revenueMinor && !d.profitMinor);

  return (
    <ChartFrame height={height} empty={isEmpty}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
        <XAxis dataKey={compact ? 'label' : 'date'} {...axisProps} tickFormatter={compact ? undefined : (v) => v?.slice(5)} />
        <YAxis {...axisProps} tickFormatter={(v) => formatNumber(v / 1000)} width={44} />
        <Tooltip
          cursor={{ fill: 'rgba(118, 87, 232, 0.06)' }}
          content={<ChartTooltip business={business} moneyKeys={['revenueMinor', 'profitMinor']} />}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: '#64748B' }}
        />
        <Bar dataKey="revenueMinor" name="Sales" fill="#7657E8" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="profitMinor" name="Profit" fill="#C4B5FD" radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ChartFrame>
  );
}

/** Revenue against expenses, as a line pair. */
export function CashFlowChart({ data = [], business, height = 260 }) {
  const isEmpty = data.every((d) => !d.revenueMinor && !d.expensesMinor);
  return (
    <ChartFrame height={height} empty={isEmpty}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => formatNumber(v / 1000)} width={44} />
        <Tooltip content={<ChartTooltip business={business} moneyKeys={['revenueMinor', 'expensesMinor']} />} />
        <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#64748B' }} />
        <Line type="monotone" dataKey="revenueMinor" name="Revenue" stroke="#7657E8" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="expensesMinor" name="Expenses" stroke="#F59E0B" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="netProfitMinor" name="Net profit" stroke="#10B981" strokeWidth={2} dot={false} strokeDasharray="4 3" />
      </LineChart>
    </ChartFrame>
  );
}

/**
 * Payment methods doughnut.
 * The total is printed in the middle so the chart answers "how much?" at a
 * glance without a tooltip.
 */
export function PaymentMethodsChart({ items = [], business, height = 260 }) {
  const data = items.map((item) => ({
    ...item,
    label: PAYMENT_METHOD_LABELS[item.method] ?? item.method,
  }));
  const total = data.reduce((sum, d) => sum + d.totalMinor, 0);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-ink-200 text-sm text-ink-400"
        style={{ height }}
      >
        No payments recorded yet
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }} role="img" aria-label="Payment methods">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            content={
              <ChartTooltip
                business={business}
                moneyKeys={['totalMinor']}
              />
            }
          />
          <Pie
            data={data}
            dataKey="totalMinor"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius="62%"
            outerRadius="86%"
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((entry, index) => (
              <Cell key={entry.method ?? index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xs font-medium uppercase tracking-wider text-ink-400">Total sales</span>
        <span className="text-base font-semibold tabular text-ink-900">{formatMoneyShort(total, business)}</span>
      </div>
    </div>
  );
}

/**
 * Horizontal bars for top products and category breakdowns.
 *
 * `valueKey` is the figure shown as the headline number; `rankKey` is what the
 * bar length is scaled against. They differ when a list is ranked by one
 * measure but valued by another — e.g. top products ranked by units sold while
 * still reporting what each earned. Defaults to the same key.
 */
export function RankedBars({ items = [], business, valueKey = 'revenueMinor', rankKey, emptyLabel = 'No data yet' }) {
  if (!items.length) {
    return <p className="py-8 text-center text-sm text-ink-400">{emptyLabel}</p>;
  }

  const scaleKey = rankKey ?? valueKey;
  const max = Math.max(...items.map((i) => Math.abs(i[scaleKey] ?? 0)), 1);

  return (
    <ul className="space-y-3.5">
      {items.map((item, index) => (
        <li key={item.product ?? item.id ?? item.name ?? index}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-ink-700">{item.name}</span>
            <span className="shrink-0 text-sm font-medium tabular text-ink-900">
              {formatMoneyShort(item[valueKey], business)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${Math.max(4, (Math.abs(item[scaleKey] ?? 0) / max) * 100)}%` }}
              />
            </div>
            {item.unitsSold !== undefined && (
              <span className="shrink-0 text-2xs tabular text-ink-400">
                {formatNumber(item.unitsSold)} sold
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Compact sparkline used inside KPI cards. */
export function Sparkline({ data = [], dataKey = 'revenueMinor', height = 36 }) {
  if (!data.length) return null;
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Line type="monotone" dataKey={dataKey} stroke="#7657E8" strokeWidth={1.75} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
