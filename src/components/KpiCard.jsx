/**
 * KPI card.
 *
 * Every card states the formula behind its number. A finance tool that shows
 * "Net profit Rs. 6,240" without saying how it was derived is asking the user
 * to trust it; naming the formula makes it checkable.
 */
import { clsx } from 'clsx';
import { Info } from 'lucide-react';
import { formatMoney, formatNumber, formatPercent } from '@/utils/format.js';
import { Card, Skeleton } from '@/components/ui/index.jsx';

const TONES = {
  brand: { icon: 'bg-brand-50 text-brand-600', value: 'text-ink-900' },
  success: { icon: 'bg-success-50 text-success-600', value: 'text-success-700' },
  warning: { icon: 'bg-warning-50 text-warning-600', value: 'text-warning-700' },
  danger: { icon: 'bg-danger-50 text-danger-600', value: 'text-danger-700' },
  neutral: { icon: 'bg-ink-100 text-ink-600', value: 'text-ink-900' },
};

export function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone = 'brand',
  changePercent,
  changeLabel = 'vs previous',
  formula,
  loading,
  footer,
  sparkline,
}) {
  if (loading) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-full" />
        {/* A skeleton is visually silent; without this a screen reader would
            hear nothing at all while the figure is being fetched. */}
        <span className="sr-only">Loading {label}…</span>
      </Card>
    );
  }

  const palette = TONES[tone] ?? TONES.brand;
  const hasChange = changePercent !== null && changePercent !== undefined;

  return (
    <Card className="flex flex-col justify-between p-5 lk-card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
            {label}
            {formula && (
              <span className="group relative">
                <Info
                  className="h-3 w-3 cursor-help text-ink-300 transition-colors group-hover:text-brand-600"
                  aria-hidden="true"
                />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-ink-900 px-2.5 py-1.5 text-2xs font-normal leading-relaxed text-white opacity-0 shadow-popover transition-opacity group-hover:opacity-100"
                >
                  {formula}
                </span>
              </span>
            )}
          </p>
          <p className={clsx('mt-2 text-2xl font-semibold tabular tracking-tight', palette.value)}>{value}</p>
        </div>

        {Icon && (
          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', palette.icon)} aria-hidden="true">
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {hasChange && (
            <p
              className={clsx(
                'flex items-center gap-1 text-2xs font-medium tabular',
                changePercent > 0 ? 'text-success-600' : changePercent < 0 ? 'text-danger-600' : 'text-ink-400'
              )}
            >
              <span aria-hidden="true">{changePercent > 0 ? '▲' : changePercent < 0 ? '▼' : '—'}</span>
              {formatPercent(Math.abs(changePercent))}
              <span className="font-normal text-ink-400">{changeLabel}</span>
            </p>
          )}
          {subtitle && <p className="truncate text-2xs text-ink-400">{subtitle}</p>}
          {footer}
        </div>
        {sparkline}
      </div>
    </Card>
  );
}

/** Compact numeric variant used for counts (orders, low-stock items). */
export function CountCard({ label, value, icon: Icon, tone = 'brand', hint, loading }) {
  return (
    <Card className="flex items-center gap-4 p-5 lk-card-hover">
      {Icon && (
        <span
          className={clsx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            TONES[tone].icon
          )}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-6 w-16" />
        ) : (
          <p className="text-xl font-semibold tabular text-ink-900">{value}</p>
        )}
        {hint && <p className="mt-0.5 truncate text-2xs text-ink-400">{hint}</p>}
      </div>
    </Card>
  );
}

export { formatMoney, formatNumber };
