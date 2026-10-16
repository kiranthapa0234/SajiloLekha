/**
 * Suppliers — contacts and what is owed to them.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useApiMutation, useSuppliers } from '@/hooks/useApi.js';
import { useListState } from '@/hooks/index.js';
import { suppliers as suppliersApi } from '@/services/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, Select } from '@/components/ui/index.jsx';
import { formatMoney, formatMoneyShort, formatNumber } from '@/utils/format.js';

export default function SuppliersPage() {
  const { business, can } = useAuth();
  const navigate = useNavigate();
  const [state, update] = useListState({ status: 'active' });
  const [createOpen, setCreateOpen] = useState(false);

  const params = useMemo(
    () => ({ page: state.page, limit: state.limit, search: state.search, status: state.status }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = useSuppliers(params);
  const summary = meta?.summary ?? {};

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Supplier',
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-900">{row.name}</span>
            <span className="block truncate text-2xs text-ink-400">
              {row.supplierCode || 'No code'} · {row.contactPerson || row.phone}
            </span>
          </div>
        ),
      },
      {
        key: 'purchaseCount',
        label: 'Purchases',
        align: 'right',
        sortable: true,
        render: (row) => formatNumber(row.purchaseCount ?? 0),
      },
      {
        key: 'totalPurchasedMinor',
        label: 'Bought from',
        align: 'right',
        sortable: true,
        render: (row) => <span className="tabular text-ink-900">{formatMoney(row.totalPurchasedMinor, business)}</span>,
      },
      {
        key: 'totalPaidMinor',
        label: 'Paid',
        align: 'right',
        render: (row) => <span className="tabular text-success-600">{formatMoney(row.totalPaidMinor, business)}</span>,
      },
      {
        key: 'outstandingMinor',
        label: 'Owed to them',
        align: 'right',
        render: (row) =>
          row.outstandingMinor > 0 ? (
            <span className="tabular font-medium text-warning-600">{formatMoney(row.outstandingMinor, business)}</span>
          ) : (
            <span className="text-ink-400">--</span>
          ),
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => (row.archivedAt ? 'Archived' : row.isActive ? 'Active' : 'Inactive'),
      },
    ],
    [business]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Suppliers</h1>
          <p className="mt-0.5 text-sm text-ink-500">Who you buy from, and what you owe them.</p>
        </div>
        <div className="flex gap-2">
          {can('purchase:read') && (
            <Button variant="secondary" onClick={() => navigate('/purchases')}>
              Purchases
            </Button>
          )}
          {can('supplier:write') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New supplier
            </Button>
          )}
        </div>
      </header>

      <section aria-label="Supplier summary" className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Suppliers" value={formatNumber(summary.suppliers ?? 0)} tone="brand" />
        <KpiCard label="Total purchased" value={formatMoneyShort(summary.lifetimePurchasedMinor ?? 0, business)} tone="neutral" />
        <KpiCard
          label="Outstanding payables"
          value={formatMoneyShort(summary.outstandingMinor ?? 0, business)}
          subtitle={`${formatNumber(summary.owing ?? 0)} supplier(s)`}
          tone={(summary.outstandingMinor ?? 0) > 0 ? 'warning' : 'success'}
        />
      </section>

      <Card>
        <TableToolbar
          search={state.search}
          onSearchChange={(search) => update({ search })}
          placeholder="Search by name, contact or code…"
        >
          <label htmlFor="supplier-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="supplier-status"
            className="h-9 w-auto py-1 text-sm"
            value={state.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value="active">Active</option>
            <option value="all">All</option>
            <option value="archived">Archived</option>
          </Select>
        </TableToolbar>

        <DataTable
          columns={columns}
          rows={data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          onRowClick={(row) => navigate(`/suppliers/${row._id}/edit`)}
          page={state.page}
          limit={state.limit}
          total={meta?.total ?? 0}
          onPageChange={(page, limit) => update({ page, limit })}
          empty={
            <EmptyState
              icon={Truck}
              title="No suppliers yet"
              description="Add the businesses you buy stock from to track purchases and payables."
              action={
                can('supplier:write') ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add a supplier
                  </Button>
                ) : null
              }
            />
          }
        />
      </Card>

      <QuickCreateSupplier
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refetch();
        }}
      />
    </div>
  );
}

/** Small inline form so a supplier can be added without leaving the list. */
function QuickCreateSupplier({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', contactPerson: '', email: '', address: '' });
  const [error, setError] = useState(null);

  const create = useApiMutation((payload) => suppliersApi.create(payload), {
    successMessage: 'Supplier created',
    onSuccess: () => {
      setForm({ name: '', phone: '', contactPerson: '', email: '', address: '' });
      onCreated();
    },
  });

  const submit = () => {
    setError(null);
    if (form.name.trim().length < 2) {
      setError('Supplier name is required');
      return;
    }
    if (!/^[+]?[\d\s\-()]{7,24}$/.test(form.phone.trim())) {
      setError('Enter a valid phone number');
      return;
    }
    create.mutate(form);
  };

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New supplier"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Create supplier
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {create.error && <Alert tone="danger" className="mb-4">{create.error.message}</Alert>}

      <div className="space-y-4">
        <Field label="Supplier name" htmlFor="sup-name" required>
          <Input id="sup-name" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Phone number" htmlFor="sup-phone" required>
          <Input id="sup-phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="9800000000" />
        </Field>
        <Field label="Contact person" htmlFor="sup-contact">
          <Input id="sup-contact" value={form.contactPerson} onChange={set('contactPerson')} />
        </Field>
        <Field label="Email" htmlFor="sup-email">
          <Input id="sup-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Address" htmlFor="sup-address">
          <Input id="sup-address" value={form.address} onChange={set('address')} />
        </Field>
      </div>
    </Modal>
  );
}
