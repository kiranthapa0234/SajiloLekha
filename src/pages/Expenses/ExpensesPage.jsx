/**
 * Expenses — operating costs only.
 *
 * The form deliberately refuses to record an inventory purchase here: stock
 * belongs in the Purchases module so it capitalises instead of expensing.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, Plus, Wallet } from 'lucide-react';
import { expenseSchema, updateExpenseSchema } from '@shared/validators/index.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHOD_LABELS } from '@shared/constants.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { useApiMutation, usePaginated } from '@/hooks/useApi.js';
import { useDateRange, useListState } from '@/hooks/index.js';
import { expenses as expensesApi } from '@/services/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { RankedBars } from '@/components/charts/index.jsx';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
  Textarea,
} from '@/components/ui/index.jsx';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, humanise, toDateInput } from '@/utils/format.js';

export default function ExpensesPage() {
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const [state, update] = useListState({ status: 'all' });
  const { range, params: rangeParams } = useDateRange({ preset: 'month' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [voiding, setVoiding] = useState(null);

  const queryParams = useMemo(
    () => ({
      page: state.page,
      limit: state.limit,
      search: state.search,
      category: state.category || undefined,
      from: rangeParams.from,
      to: rangeParams.to,
    }),
    [state, rangeParams]
  );

  const { data, meta, isLoading, error, refetch } = usePaginated(() => ({
    queryKey: ['expenses', businessId, queryParams],
    queryFn: () => expensesApi.list(queryParams),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));

  const { data: totals } = useQuery({
    queryKey: ['expense-totals', businessId, rangeParams],
    queryFn: () => expensesApi.totals(rangeParams),
    enabled: Boolean(businessId),
  });

  const voidExpense = useApiMutation((id) => expensesApi.void(id, voiding?.reason ?? 'No reason supplied'), {
    successMessage: 'Expense voided and excluded from reports',
    onSuccess: () => {
      setVoiding(null);
      refetch();
    },
  });

  const columns = useMemo(
    () => [
      {
        key: 'title',
        label: 'Expense',
        render: (row) => (
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-900">{row.title}</span>
            <span className="block truncate text-2xs text-ink-400">
              {row.vendor ? `${row.vendor} · ` : ''}
              {row.reference || 'No reference'}
            </span>
          </div>
        ),
      },
      {
        key: 'category',
        label: 'Category',
        render: (row) => humanise(row.category),
      },
      {
        key: 'spentAt',
        label: 'Date',
        sortable: true,
        render: (row) => <span className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.spentAt)}</span>,
      },
      {
        key: 'paymentMethod',
        label: 'Method',
        render: (row) => PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
      },
      {
        key: 'amountMinor',
        label: 'Amount',
        align: 'right',
        sortable: true,
        render: (row) => <span className="tabular font-medium text-ink-900">{formatMoney(row.amountMinor, business)}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [business]
  );

  const monthTotal = totals?.monthly?.find((m) => m.month === new Date().toISOString().slice(0, 7))?.totalMinor ?? 0;
  const dayTotal = totals?.daily?.at(-1)?.totalMinor ?? 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Expenses</h1>
          <p className="mt-0.5 text-sm text-ink-500">Operating costs that reduce profit.</p>
        </div>
        {can('expense:write') && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Record expense
          </Button>
        )}
      </header>

      <section aria-label="Expense summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Today" value={formatMoneyShort(dayTotal, business)} tone="neutral" />
        <KpiCard label="This month" value={formatMoneyShort(monthTotal, business)} tone="warning" />
        <KpiCard
          label="In selected range"
          value={formatMoneyShort(meta?.summary?.totalMinor ?? 0, business)}
          subtitle={`${formatNumber(meta?.summary?.count ?? 0)} expense(s)`}
          tone="brand"
        />
        <KpiCard
          label="Categories"
          value={formatNumber(totals?.monthly?.length ?? 0)}
          subtitle="Months with recorded spend"
          tone="neutral"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <TableToolbar
            search={state.search}
            onSearchChange={(search) => update({ search })}
            placeholder="Search by title, vendor or reference…"
          >
            <label htmlFor="expense-category" className="sr-only">
              Filter by category
            </label>
            <Select
              id="expense-category"
              className="h-9 w-auto py-1 text-sm"
              value={state.category ?? ''}
              onChange={(e) => update({ category: e.target.value })}
            >
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {humanise(category)}
                </option>
              ))}
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
            onRowClick={(row) => {
              if (can('expense:write') && row.status === 'recorded') {
                setEditing(row);
                setFormOpen(true);
              }
            }}
            page={state.page}
            limit={state.limit}
            total={meta?.total ?? 0}
            onPageChange={(page, limit) => update({ page, limit })}
            empty={
              <EmptyState
                icon={Wallet}
                title="No expenses recorded"
                description="Rent, utilities, salaries and other operating costs appear here and flow into net profit."
                action={
                  can('expense:write') ? (
                    <Button onClick={() => setFormOpen(true)}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Record an expense
                    </Button>
                  ) : null
                }
              />
            }
          />
        </Card>

        <Card>
          <div className="lk-card-header">
            <div>
              <h2 className="lk-card-title">By month</h2>
              <p className="lk-card-subtitle">Where the money went</p>
            </div>
          </div>
          <div className="lk-card-body">
            <RankedBars
              items={(totals?.monthly ?? []).map((m) => ({ name: m.month, totalMinor: m.totalMinor }))}
              business={business}
              valueKey="totalMinor"
              emptyLabel="No expenses yet"
            />
          </div>
        </Card>
      </div>

      <ExpenseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        expense={editing}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          refetch();
        }}
        onVoid={can('expense:write') ? (row) => setVoiding(row) : undefined}
      />

      <VoidExpenseDialog
        expense={voiding}
        loading={voidExpense.isPending}
        error={voidExpense.error?.message}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => voidExpense.mutate({ ...voiding, reason })}
      />
    </div>
  );
}

function ExpenseFormModal({ open, onClose, expense, onSaved, onVoid }) {
  const { business } = useAuth();
  const isEdit = Boolean(expense);

  const {
    register: bind,
    reset,
    watch,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(isEdit ? updateExpenseSchema : expenseSchema),
    mode: 'onTouched',
    defaultValues: {
      title: '',
      category: 'other',
      amount: '',
      spentAt: toDateInput(new Date()),
      paymentMethod: 'cash',
      vendor: '',
      reference: '',
      notes: '',
      recurring: false,
    },
  });

  const spentAt = watch('spentAt');

  useMemo(() => {
    if (!isEdit || !expense) return;
    reset({
      title: expense.title ?? '',
      category: expense.category ?? 'other',
      amount: ((expense.amountMinor ?? 0) / 100).toFixed(2),
      spentAt: toDateInput(expense.spentAt),
      paymentMethod: expense.paymentMethod ?? 'cash',
      vendor: expense.vendor ?? '',
      reference: expense.reference ?? '',
      notes: expense.notes ?? '',
      recurring: expense.recurring ?? false,
    });
  }, [expense, isEdit, reset]);

  const save = useApiMutation(
    (values) => (isEdit ? expensesApi.update(expense._id, values) : expensesApi.create(values)),
    { successMessage: isEdit ? 'Expense updated' : 'Expense recorded', onSuccess: onSaved }
  );

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      for (const [field, message] of Object.entries(error.fields ?? {})) setError(field, { message });
    }
  };

  const amountRupees = Number(watch('amount') || 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit expense' : 'Record an expense'}
      description="Operating costs only — stock purchases belong in the Purchases module."
      footer={
        <>
          {isEdit && onVoid && (
            <Button variant="danger" className="mr-auto" onClick={() => onVoid(expense)}>
              <Ban className="h-4 w-4" aria-hidden="true" />
              Void
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" loading={isSubmitting || save.isPending}>
            {isEdit ? 'Save changes' : 'Record expense'}
          </Button>
        </>
      }
    >
      {save.error && <Alert tone="danger" className="mb-4">{save.error.message}</Alert>}

      <form id="expense-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Title" htmlFor="exp-title" required error={errors.title?.message}>
          <Input id="exp-title" placeholder="Monthly shop rent" invalid={Boolean(errors.title)} {...bind('title')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" htmlFor="exp-amount" required error={errors.amount?.message}>
            <Input
              id="exp-amount"
              inputMode="decimal"
              className="tabular"
              placeholder="0.00"
              invalid={Boolean(errors.amount)}
              {...bind('amount')}
            />
          </Field>

          <Field label="Category" htmlFor="exp-category" required error={errors.category?.message}>
            <select id="exp-category" className="lk-input" {...bind('category')}>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {humanise(category)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date" htmlFor="exp-date" required error={errors.spentAt?.message}>
            <Input id="exp-date" type="date" value={spentAt ?? ''} onChange={(e) => setValue('spentAt', e.target.value)} />
          </Field>

          <Field label="Payment method" htmlFor="exp-method" required error={errors.paymentMethod?.message}>
            <select id="exp-method" className="lk-input" {...bind('paymentMethod')}>
              {Object.entries(PAYMENT_METHOD_LABELS)
                .filter(([key]) => key !== 'credit')
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>

          <Field label="Vendor" htmlFor="exp-vendor" error={errors.vendor?.message}>
            <Input id="exp-vendor" placeholder="Landlord" {...bind('vendor')} />
          </Field>

          <Field label="Reference" htmlFor="exp-ref" error={errors.reference?.message}>
            <Input id="exp-ref" placeholder="INV-2024-08" {...bind('reference')} />
          </Field>
        </div>

        <Field label="Notes" htmlFor="exp-notes" error={errors.notes?.message}>
          <Textarea id="exp-notes" {...bind('notes')} />
        </Field>

        <Checkbox label="Recurring expense" {...bind('recurring')} />

        {amountRupees > 0 && (
          <p className="text-xs text-ink-500">
            This will reduce net profit by{' '}
            <span className="font-medium tabular text-ink-900">
              {formatMoney(Math.round(amountRupees * 100), business)}
            </span>
            .
          </p>
        )}
      </form>
    </Modal>
  );
}

function VoidExpenseDialog({ expense, loading, error, onClose, onConfirm }) {
  const [reason, setReason] = useState('');

  return (
    <ConfirmDialog
      open={Boolean(expense)}
      onClose={onClose}
      onConfirm={() => onConfirm(reason)}
      title="Void this expense?"
      description="The record is kept for audit but excluded from every report and from net profit."
      confirmLabel="Void expense"
      loading={loading}
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <Field label="Reason" htmlFor="void-reason" required>
        <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate entry" />
      </Field>
    </ConfirmDialog>
  );
}
