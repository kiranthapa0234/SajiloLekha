/**
 * Reports index — the catalogue of everything the product can compute.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, FileSpreadsheet, Info } from 'lucide-react';
import { useBusinessId, useAuth } from '@/context/AuthContext.jsx';
import { reports as reportsApi } from '@/services/index.js';
import { Alert, Card, CardBody, Spinner } from '@/components/ui/index.jsx';

const REPORT_META = {
  sales: { blurb: 'Revenue, discounts and profit by day.', tag: 'Sales' },
  'profit-loss': { blurb: 'Revenue minus COGS minus operating expenses.', tag: 'Accounting' },
  expenses: { blurb: 'Operating spend by category, method and day.', tag: 'Expenses' },
  inventory: { blurb: 'Closing stock valued at weighted average cost.', tag: 'Inventory' },
  'stock-movements': { blurb: 'Every stock movement, with who and why.', tag: 'Inventory' },
  'low-stock': { blurb: 'Products at or below their reorder level.', tag: 'Inventory' },
  customers: { blurb: 'Who buys what, and what they still owe.', tag: 'Customers' },
  collections: { blurb: 'Cash collected by method and day.', tag: 'Payments' },
  outstanding: { blurb: 'Who owes what, and how overdue it is.', tag: 'Receivables' },
  suppliers: { blurb: 'What you bought and what you still owe suppliers.', tag: 'Suppliers' },
};

export default function ReportsPage() {
  const { business } = useAuth();
  const businessId = useBusinessId();
  const navigate = useNavigate();

  const { data: reports, isLoading, error } = useQuery({
    queryKey: ['reports-catalog', businessId],
    queryFn: () => reportsApi.list(),
    enabled: Boolean(businessId),
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Reports</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Every figure is computed from your records. Each report states the formula behind its numbers.
        </p>
      </header>

      <Alert tone="info" title="How these reports are built">
        <span className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Reports use the accrual basis. Revenue is recognised when a sale is recorded, not when cash
            arrives; inventory purchases capitalise into stock and are expensed as cost of goods sold only
            when sold; tax collected is reported as a liability, never as income. Cash collected is shown
            separately and is never used to derive profit.
          </span>
        </span>
      </Alert>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      )}

      {error && <Alert tone="danger">{error.message}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(reports ?? []).map((report) => {
          const meta = REPORT_META[report.key] ?? { blurb: '', tag: '' };
          return (
            <button
              key={report.key}
              type="button"
              onClick={() => navigate(`/reports/${report.key}`)}
              className="lk-card lk-card-hover group flex flex-col items-start p-5 text-left"
            >
              <div className="mb-3 flex w-full items-start justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <BarChart3 className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="rounded-full bg-ink-100 px-2 py-0.5 text-2xs font-medium text-ink-500">
                  {meta.tag}
                </span>
              </div>
              <h2 className="text-sm font-semibold text-ink-900">{report.label}</h2>
              <p className="mt-1 flex-1 text-xs text-ink-500">{meta.blurb}</p>
              <span className="mt-4 flex items-center gap-1 text-xs font-medium text-brand-700">
                Open report
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardBody>
          <p className="flex items-start gap-2 text-xs text-ink-500">
            <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <span>
              Every report can be exported to CSV or PDF. Exports are generated from the same dataset you
              see on screen, so a downloaded file can never disagree with the view.
              {business?.currency ? ` Amounts are shown in ${business.currency}.` : ''}
            </span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
