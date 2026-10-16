/**
 * The accountant view.
 *
 * One screen that answers "where is the money, and what happened to it":
 * the cash/bank position derived from the ledger, the movements behind it, and
 * the trading figures those movements came from. Every figure is an
 * aggregation -- nothing on this page is a stored running total that could
 * drift away from the records that produced it.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Landmark, Wallet } from 'lucide-react';

import { MONEY_ACCOUNT_LABELS, MONEY_KIND_LABELS } from '@shared/constants.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { money as moneyApi } from '@/services/index.js';
import { DataTable } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import MoveMoneyModal from '@/components/MoveMoneyModal.jsx';
import { Button, Card, CardBody, CardHeader, EmptyState, Select } from '@/components/ui/index.jsx';
import { formatDateTime, formatMoney } from '@/utils/format.js';

export default function AccountantPage() {
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState('all');
  const [moving, setMoving] = useState(false);

  const balances = useQuery({
    queryKey: ['money', 'balances', businessId],
    queryFn: () => moneyApi.balances(),
    enabled: Boolean(businessId),
  });

  const movements = useQuery({
    queryKey: ['money', 'movements', businessId, account],
    queryFn: () => moneyApi.movements({ account, limit: 50 }),
    enabled: Boolean(businessId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['money'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const b = balances.data;
  const columns = useMemo(
    () => [
      {
        key: 'occurredAt',
        label: 'When',
        render: (row) => <span className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(row.occurredAt)}</span>,
      },
      {
        key: 'reason',
        label: 'Reason',
        render: (row) => (
          <div className="min-w-0">
            <span className="block truncate text-sm text-ink-900">{row.reason}</span>
            <span className="block truncate text-2xs text-ink-400">{MONEY_KIND_LABELS[row.kind] ?? row.kind}</span>
          </div>
        ),
      },
      {
        key: 'account',
        label: 'Account',
        render: (row) => MONEY_ACCOUNT_LABELS[row.account] ?? row.account,
      },
      {
        key: 'amountMinor',
        label: 'Change',
        align: 'right',
        render: (row) => (
          <span
            className={`font-medium tabular ${
              row.direction === 'in' ? 'text-success-600' : 'text-danger-600'
            }`}
          >
            {row.direction === 'in' ? '+' : '−'}
            {formatMoney(row.amountMinor, business, { showSymbol: false })}
          </span>
        ),
      },
    ],
    [business]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Accountant</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Where the money is, and every movement that put it there.
          </p>
        </div>
        {can('stock:adjust') && (
          <Button onClick={() => setMoving(true)}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            Move money
          </Button>
        )}
      </header>

      <section aria-label="Balances" className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total balance"
          value={formatMoney(b?.totalMinor ?? 0, business)}
          subtitle="Cash and bank, combined"
          tone="brand"
        />
        <KpiCard
          label={MONEY_ACCOUNT_LABELS.cash}
          value={formatMoney(b?.accounts?.cash?.totalMinor ?? 0, business)}
          subtitle={`In ${formatMoney(b?.accounts?.cash?.inMinor ?? 0, business, { showSymbol: false })} · out ${formatMoney(b?.accounts?.cash?.outMinor ?? 0, business, { showSymbol: false })}`}
          tone="success"
        />
        <KpiCard
          label={MONEY_ACCOUNT_LABELS.bank}
          value={formatMoney(b?.accounts?.bank?.totalMinor ?? 0, business)}
          subtitle={`In ${formatMoney(b?.accounts?.bank?.inMinor ?? 0, business, { showSymbol: false })} · out ${formatMoney(b?.accounts?.bank?.outMinor ?? 0, business, { showSymbol: false })}`}
          tone="neutral"
        />
      </section>

      <Card>
        <CardHeader
          title="Money in and out"
          subtitle="Append-only. A correction is a new movement, never an edit."
        />
        <CardBody>
          <div className="mb-4 flex items-center gap-2">
            <label htmlFor="mv-account-filter" className="sr-only">
              Filter by account
            </label>
            <Select
              id="mv-account-filter"
              className="h-9 w-auto py-1 text-sm"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="all">All accounts</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </Select>
          </div>

          <DataTable
            columns={columns}
            rows={movements.data ?? []}
            loading={movements.isLoading}
            error={movements.error}
            onRetry={movements.refetch}
            empty={
              <EmptyState
                icon={Wallet}
                title="No money has moved yet"
                description={
                  can('stock:adjust')
                    ? 'Record an opening balance so the figures start from where you really are.'
                    : 'Movements appear here once money is received or paid.'
                }
                action={
                  can('stock:adjust') ? (
                    <Button onClick={() => setMoving(true)}>
                      <Landmark className="h-4 w-4" aria-hidden="true" />
                      Add an opening balance
                    </Button>
                  ) : null
                }
              />
            }
          />
        </CardBody>
      </Card>

      <MoveMoneyModal
        key={moving ? 'move-open' : 'move-closed'}
        open={moving}
        balances={b}
        business={business}
        onClose={() => setMoving(false)}
        onSaved={refresh}
      />
    </div>
  );
}
