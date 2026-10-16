/**
 * Pick a supplier, or make one on the spot.
 *
 * A supplier is usually unknown at the exact moment their first stock lands:
 * the goods are on the counter and the invoice is still in a pocket. Forcing a
 * detour to the Suppliers screen to type a name before recording the purchase
 * is how purchases end up filed without a supplier, which silently loses the
 * "who do I owe" half of the transaction. So this field always offers to create
 * one inline, and only the name is required.
 *
 * Shared by the Purchases form and the Inventory add-stock modal so both behave
 * identically.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Truck } from 'lucide-react';

import { useApiMutation } from '@/hooks/useApi.js';
import { useBusinessId } from '@/context/AuthContext.jsx';
import { suppliers as suppliersApi } from '@/services/index.js';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui/index.jsx';

const EMPTY_DRAFT = { name: '', phone: '', contactPerson: '', email: '' };

/**
 * @param {object} props
 * @param {string} props.id                id for the search input
 * @param {string} [props.label]
 * @param {string} [props.hint]
 * @param {boolean} [props.required]
 * @param {string} [props.className]
 * @param {string} [props.value]           selected supplier id
 * @param {Function} [props.onChange]      called with the new id ('' when cleared)
 * @param {object} [props.selected]        the selected supplier, for the chip
 * @param {Function} [props.onSelect]       called with the full supplier object
 * @param {boolean} [props.open]            gates the search query while the host modal is open
 */
export default function SupplierSelect({
  id,
  label = 'Supplier',
  hint,
  required = false,
  className,
  selected = null,
  onSelect,
  open = true,
}) {
  const businessId = useBusinessId();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const { data, isFetching } = useQuery({
    queryKey: ['supplier-search', businessId, search],
    queryFn: () => suppliersApi.list({ search, limit: 8, status: 'active' }),
    enabled: Boolean(businessId && open && search.trim().length >= 2 && !selected),
  });
  // The list endpoint answers with `{ items, meta }` so pagination survives.
  const results = data?.items ?? [];

  const create = useApiMutation((payload) => suppliersApi.create(payload), {
    successMessage: 'Supplier added',
  });

  const pick = (supplier) => {
    onSelect?.(supplier);
    setSearch('');
    setCreating(false);
  };

  const startCreate = () => {
    // Seed from what was typed, so the common case is a click and Confirm.
    setDraft((d) => ({ ...d, name: d.name || search.trim() }));
    setCreating(true);
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraft(EMPTY_DRAFT);
  };

  const save = async () => {
    try {
      const supplier = await suppliersApi.create({
        name: draft.name.trim(),
        phone: draft.phone.trim() || undefined,
        contactPerson: draft.contactPerson.trim() || undefined,
        email: draft.email.trim() || undefined,
      });
      pick(supplier);
      cancelCreate();
    } catch {
      // The mutation's error state renders below.
    }
  };

  const clear = () => {
    onSelect?.(null);
    setSearch('');
  };

  return (
    <>
      <Field label={label} htmlFor={id} hint={hint} required={required} className={className}>
        {selected ? (
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
              <Truck className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                {selected.name}
              </span>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={clear}>
              Change
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Input
              id={id}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or add a supplier…"
              autoComplete="off"
            />
            {isFetching && <Spinner className="absolute right-3 top-[30px] h-3.5 w-3.5 text-brand-600" />}

            {!creating && (results ?? []).length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
                {(results ?? []).map((s) => (
                  <li key={s._id}>
                    <button
                      type="button"
                      onClick={() => pick(s)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-brand-50"
                    >
                      <span className="min-w-0 truncate">{s.name}</span>
                      {s.phone && <span className="shrink-0 text-2xs text-ink-400">{s.phone}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!creating && (results ?? []).length === 0 && search.trim().length >= 2 && !isFetching && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
                <li>
                  <button
                    type="button"
                    onClick={startCreate}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-brand-50"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      Add <strong className="font-medium text-ink-900">{search.trim()}</strong> as a new
                      supplier
                    </span>
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}
      </Field>

      {creating && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
          <p className="lk-label">New supplier</p>
          {create.error && (
            <Alert tone="danger" className="mb-3">
              {create.error.message}
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier name" htmlFor={`${id}-name`} required className="sm:col-span-2">
              <Input
                id={`${id}-name`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field
              label="Phone number"
              htmlFor={`${id}-phone`}
              hint="Optional, but handy for chasing deliveries."
            >
              <Input
                id={`${id}-phone`}
                type="tel"
                inputMode="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="9800000000"
              />
            </Field>
            <Field label="Contact person" htmlFor={`${id}-contact`}>
              <Input
                id={`${id}-contact`}
                value={draft.contactPerson}
                onChange={(e) => setDraft({ ...draft, contactPerson: e.target.value })}
                placeholder="Ramesh Shrestha"
              />
            </Field>
            <Field label="Email" htmlFor={`${id}-email`} className="sm:col-span-2">
              <Input
                id={`${id}-email`}
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="orders@example.com"
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={cancelCreate}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={create.isPending}
              disabled={draft.name.trim().length < 2}
              onClick={save}
            >
              Add supplier
            </Button>
          </div>
        </div>
      )}
    </>
  );
}