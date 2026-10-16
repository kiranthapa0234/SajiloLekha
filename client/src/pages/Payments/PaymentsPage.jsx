/**
 * Payments — the money ledger.
 *
 * Everything that has been collected or paid out, with reconciliation status.
 * Payments are never edited: a mistake is voided and re-entered, which keeps the
 * trail provable.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Receipt, Undo2 } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@shared/constants.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { useApiMutation, usePaginated } from '@/hooks/useApi.js';
import { useDateRange, useListState } from '@/hooks/index.js';
import { payments as paymentsApi } from '@/services/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { PaymentMethodsChart } from '@/components/charts/index.jsx';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Select,
  StatusBadge,
  Textarea,
} from '@/components/ui/index.jsx';
import { formatDate, formatMoney, formatMoneyShort, formatNumber } from '@/utils/format.js';

export default function PaymentsPage() {
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const [state, update] = useListState({ status: 'valid' });
  const { range, params: rangeParams } = useDateRange({ preset: 'month' });
  const [voiding, setVoiding] = useState(null);

  const queryParams = useMemo(
    () => ({
      page: state.page,
      limit: state.limit,
      search: state.search,
      status: state.status,
      direction: state.direction ?? 'all',
      method: state.method || undefined,
      from: rangeParams.from,
      to: rangeParams.to,
    }),
    [state, rangeParams]
  );

  const { data, meta, isLoading, error, refetch } = usePaginated(() => ({
    queryKey: ['payments', businessId, queryParams],
    queryFn: () => paymentsApi.list(queryParams),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));

  const { data: methods } = useQuery({
    queryKey: ['payment-methods', businessId, rangeParams],
    queryFn: () => paymentsApi.methods(rangeParams),
    enabled: Boolean(businessId),
  });

  const voidPayment = useApiMutation((id) => paymentsApi.void(id, voiding?.reason ?? 'No reason supplied'), {
    successMessage: 'Payment voided and balances recalculated',
    onSuccess: () => {
      setVoiding(null);
      refetch();
    },
  });

  const reconcile = useApiMutation(
    ({ id, status }) => paymentsApi.reconcile(id, { status }),
    { successMessage: 'Payment reconciled', onSuccess: refetch }
  );

  const columns = useMemo(
    () => [
      {
        key: 'reference',
        label: 'Reference',
        render: (row) => <span className="font-mono text-xs font-medium text-ink-900">{row.reference}</span>,
      },
      {
        key: 'customer',
        label: 'Counterparty',
        render: (row) => row.customer?.name ?? row.supplier?.name ?? '--',
      },
      {
        key: 'invoice',
        label: 'Invoice',
        render: (row) =>
          row.invoice ? (
            <span className="font-mono text-xs text-brand-700">{row.invoice.invoiceNumber}</span>
          ) : (
            <span className="text-ink-400">Standalone</span>
          ),
      },
      {
        key: 'method',
        label: 'Method',
        render: (row) => PAYMENT_METHOD_LABELS[row.method] ?? row.method,
      },
      {
        key: 'transactionReference',
        label: 'Transaction ref',
        render: (row) => (
          <span className="font-mono text-xs text-ink-500">{row.transactionReference || '--'}</span>
        ),
      },
      {
        key: 'paidAt',
        label: 'Date',
        sortable: true,
        render: (row) => <span className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.paidAt)}</span>,
      },
      {
        key: 'amountMinor',
        label: 'Amount',
        align: 'right',
        sortable: true,
        render: (row) => (
          <span
            className={`tabular font-medium ${row.direction === 'outbound' ? 'text-danger-600' : 'text-success-600'}`}
          >
            {row.direction === 'outbound' ? '-' : ''}
            {formatMoney(row.amountMinor, business)}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={row.status} />
            <span className="text-2xs text-ink-400">{row.reconciliation?.status ?? 'unreconciled'}</span>
          </div>
        ),
      },
      {
        key: 'actions',
        label: '',
        align: 'right',
        hideOnMobile: true,
        render: (row) =>
          row.status === 'valid' && can('payment:write') ? (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  reconcile.mutate({ id: row._id, status: row.reconciliation?.status === 'reconciled' ? 'unreconciled' : 'reconciled' });
                }}
                className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700"
                aria-label={row.reconciliation?.status === 'reconciled' ? 'Mark unreconciled' : 'Mark reconciled'}
                title={row.reconciliation?.status === 'reconciled' ? 'Mark unreconciled' : 'Mark reconciled'}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setVoiding(row);
                }}
                className="rounded p-1.5 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                aria-label={`Void payment ${row.reference}`}
                title="Void payment"
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null,
      },
    ],
    [business, can, reconcile]
  );

  const summary = meta?.summary ?? {};

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Payments</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Money in and out, with the balance each one settled.
        </p>
      </header>

      <section aria-label="Payment summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Collected"
          value={formatMoneyShort(summary.inboundMinor ?? 0, business)}
          subtitle={`${formatNumber(summary.inboundCount ?? 0)} payment(s)`}
          tone="success"
        />
        <KpiCard
          label="Paid out"
          value={formatMoneyShort(summary.outboundMinor ?? 0, business)}
          subtitle={`${formatNumber(summary.outboundCount ?? 0)} payment(s)`}
          tone="danger"
        />
        <KpiCard
          label="Net cash"
          value={formatMoneyShort(summary.netMinor ?? 0, business)}
          formula="Collected minus paid out. A cash measure, not profit."
          tone={(summary.netMinor ?? 0) >= 0 ? 'brand' : 'danger'}
        />
        <KpiCard
          label="Count"
          value={formatNumber((data ?? []).length)}
          subtitle="On this page"
          tone="neutral"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <TableToolbar
            search={state.search}
            onSearchChange={(search) => update({ search })}
            placeholder="Search by reference, invoice or customer…"
          >
            <label htmlFor="payment-status" className="sr-only">
              Filter by status
            </label>
            <Select
              id="payment-status"
              className="h-9 w-auto py-1 text-sm"
              value={state.status}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="valid">Valid</option>
              <option value="voided">Voided</option>
              <option value="all">All</option>
            </Select>

            <label htmlFor="payment-direction" className="sr-only">
              Filter by direction
            </label>
            <Select
              id="payment-direction"
              className="h-9 w-auto py-1 text-sm"
              value={state.direction ?? 'all'}
              onChange={(e) => update({ direction: e.target.value })}
            >
              <option value="all">In and out</option>
              <option value="inbound">Collected only</option>
              <option value="outbound">Paid out only</option>
            </Select>

            <Select
              className="h-9 w-auto py-1 text-sm"
              value={range.preset}
              onChange={(e) => range.setRange({ preset: e.target.value })}
              aria-label="Reporting period"
            >
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
              <option value="all">All time</option>
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
                icon={Receipt}
                title="No payments in this period"
                description="Payments are created automatically when you record a sale, or manually against an open invoice."
              />
            }
          />
        </Card>

        <Card>
          <div className="lk-card-header">
            <div>
              <h2 className="lk-card-title">By method</h2>
              <p className="lk-card-subtitle">Collected in the selected period</p>
            </div>
          </div>
          <div className="lk-card-body">
            <PaymentMethodsChart items={methods?.items ?? []} business={business} />
          </div>
        </Card>
      </div>

      <VoidPaymentDialog
        payment={voiding}
        loading={voidPayment.isPending}
        error={voidPayment.error?.message}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => voidPayment.mutate({ id: voiding._id, reason })}
      />
    </div>
  );
}

function VoidPaymentDialog({ payment, loading, error, onClose, onConfirm }) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={Boolean(payment)}
      onClose={onClose}
      title="Void this payment?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} onClick={() => onConfirm(reason)}>
            Void payment
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <p className="mb-4 text-sm text-ink-600">
        The payment row is kept for audit, but its money no longer counts. Any invoice it settled will
        become outstanding again, and customer or supplier balances are reversed.
      </p>
      <Field label="Reason" htmlFor="void-payment-reason" required>
        <Textarea
          id="void-payment-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Entered against the wrong invoice"
        />
      </Field>
    </Modal>
  );
}
