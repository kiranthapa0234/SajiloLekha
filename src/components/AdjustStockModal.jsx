/**
 * Record a stock change.
 *
 * Stock only ever moves through a movement row with a reason attached, so this
 * is the one place an operator does it by hand. It is deliberately shared: the
 * Movements ledger opens it with no product chosen, while the Inventory list
 * opens it with the row's product already filled in.
 *
 * Inbound stock splits in two, because the distinction decides whether anyone
 * is owed money:
 *   - "Bought from a supplier" records a real Purchase. Stock rises, the
 *     supplier's debt is tracked, and the cost becomes the basis for COGS when
 *     the goods are sold. This is the same code path as the Purchases screen,
 *     so there is exactly one way money can enter stock.
 *   - "Stock correction" is the plain movement, for recounting or fixing a
 *     figure. No supplier, no cost, no money implied.
 * Without that split, stock added from Inventory silently had no supplier, and
 * there was no record of who to pay.
 *
 * Direction comes from the movement type, never from a minus sign on the
 * quantity. Both this form and the service reject a negative number, because
 * `Math.abs()` downstream would otherwise turn a typed `-9` on "Adjustment (+)"
 * into a silent `+9`.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';

import { useApiMutation } from '@/hooks/useApi.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { MONEY_ACCOUNTS, MONEY_ACCOUNT_LABELS } from '@shared/constants.js';
import { products as productsApi, purchases as purchasesApi, stock as stockApi } from '@/services/index.js';
import SupplierSelect from '@/components/SupplierSelect.jsx';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/index.jsx';
import { formatMoney, formatNumber } from '@/utils/format.js';

const MOVEMENT_TYPES = [
  { value: 'adjustment_in', label: 'Adjustment (+)' },
  { value: 'adjustment_out', label: 'Adjustment (−)' },
  { value: 'damage', label: 'Damaged / written off' },
  { value: 'recount', label: 'Stock recount (absolute)' },
];

/** Only an inbound adjustment can be a purchase; the rest have no supplier. */
const INBOUND_TYPES = new Set(['adjustment_in']);

/**
 * Movement types that can plausibly be goods going back to a supplier.
 * `recount` is deliberately excluded: a count is a measurement, not an event
 * with a counterpart, so it has no money attached to it either way.
 */
const OUTBOUND_TYPES = new Set(['adjustment_out', 'damage']);

const BLANK = { productId: '', productLabel: '', type: 'adjustment_in', quantity: '', reason: '', reference: '' };

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {Function} [props.onSaved]
 * @param {object} [props.product]  `{ _id, name, sku, stockQuantity, unit }` to preselect
 * @param {'in'|'out'} [props.defaultDirection]  pre-picks Adjustment (+) or (−)
 */
export default function AdjustStockModal({ open, onClose, onSaved, product, defaultDirection = 'in' }) {
  const { business } = useAuth();
  const businessId = useBusinessId();
  // Seeded once per mount. The parent passes a `key`, so opening the modal for
  // a different product remounts this with fresh values instead of syncing
  // state from props inside an effect.
  const [form, setForm] = useState(() => ({
    ...BLANK,
    productId: product?._id ?? '',
    productLabel: product ? `${product.name}${product.sku ? ` (${product.sku})` : ''}` : '',
    type: defaultDirection === 'out' ? 'adjustment_out' : 'adjustment_in',
  }));
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(() => !product);
  const [search, setSearch] = useState('');
  /** 'correction' is a plain movement; 'supplier' records a purchase or a return. */
  const [source, setSource] = useState('correction');
  const [supplier, setSupplier] = useState(null);
  // Seeded from the product's recorded cost so the common case is a keystroke
  // saved. Kept as a string because the field is free text; parsed on submit.
  const [unitCost, setUnitCost] = useState(() =>
    product?.costPriceMinor ? String(product.costPriceMinor / 100) : ''
  );
  // What the supplier handed back in total, and where it lands. Defaults to the
  // cost times the quantity, which is the usual case for a full refund.
  const [refundAmount, setRefundAmount] = useState('');
  const [refundAccount, setRefundAccount] = useState('cash');

  // Only needed when the operator has to choose a product themselves.
  const { data: results } = useQuery({
    queryKey: ['product-search', businessId, search],
    queryFn: () => productsApi.search(search, 10),
    enabled: open && picking && search.trim().length >= 2,
    staleTime: 15_000,
  });

  const saved = () => {
    onSaved?.();
    onClose();
  };

  const adjust = useApiMutation((payload) => stockApi.adjust(payload), {
    successMessage: 'Stock adjusted and recorded in the ledger',
    onSuccess: saved,
  });

  const buy = useApiMutation((payload) => purchasesApi.create(payload), {
    successMessage: 'Stock received and recorded as a purchase',
    onSuccess: saved,
  });

  const giveBack = useApiMutation((payload) => purchasesApi.returnToSupplier(payload), {
    successMessage: 'Stock returned and the refund recorded',
    onSuccess: saved,
  });

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const isPurchase = source === 'supplier' && INBOUND_TYPES.has(form.type);
  const isReturn = source === 'supplier' && OUTBOUND_TYPES.has(form.type);

  // Switching movement type must drop any supplier framing that no longer
  // applies, or a recount would be filed as a purchase or a return.
  const changeType = (event) => {
    const type = event.target.value;
    setForm({ ...form, type });
    if (!INBOUND_TYPES.has(type) && !OUTBOUND_TYPES.has(type)) setSource('correction');
  };

  const submit = () => {
    setError(null);
    if (!form.productId) {
      setError('Choose a product');
      return;
    }
    if (!Number(form.quantity)) {
      setError('Enter a non-zero quantity');
      return;
    }
    if (Number(form.quantity) < 0) {
      setError(
        form.type === 'recount'
          ? 'A counted figure cannot be negative. Enter the number of units actually on hand.'
          : 'Use a positive number and choose "Adjustment (−)" or "Damaged" to reduce stock.'
      );
      return;
    }

    if (isReturn) {
      if (!supplier) {
        setError('Choose the supplier who took the stock back, or switch to "Nothing comes back"');
        return;
      }
      const refund = Number(refundAmount);
      if (!Number.isFinite(refund) || refund < 0) {
        setError('Enter the refund the supplier gave you');
        return;
      }
      giveBack.mutate({
        product: form.productId,
        supplier: supplier._id,
        quantity: Number(form.quantity),
        refundAmount,
        account: refundAccount,
        reference: form.reference.trim() || undefined,
        reason: form.reason.trim() || undefined,
      });
      return;
    }

    if (isPurchase) {
      if (!supplier) {
        setError('Choose the supplier you bought this from, or switch to a stock correction');
        return;
      }
      const cost = Number(unitCost);
      if (!Number.isFinite(cost) || cost < 0) {
        setError('Enter what each unit cost');
        return;
      }
      buy.mutate({
        supplier: supplier._id,
        reference: form.reference.trim() || undefined,
        lines: [
          {
            product: form.productId,
            quantity: Number(form.quantity),
            costPrice: unitCost,
            note: form.reason.trim(),
          },
        ],
      });
      return;
    }

    if (form.reason.trim().length < 3) {
      setError('A reason is required — it is written into the permanent ledger');
      return;
    }
    adjust.mutate({
      product: form.productId,
      type: form.type,
      quantity: Number(form.quantity),
      reason: form.reason.trim(),
      reference: form.reference.trim() || undefined,
    });
  };

  /** What the typed number will actually do, mirroring the server's DIRECTION map. */
  const preview = useMemo(() => {
    const n = Number(form.quantity);
    if (!Number.isFinite(n) || n === 0) return null;
    if (form.type === 'recount') return { label: 'Sets stock to', value: formatNumber(n) };
    const signed = { adjustment_in: n, adjustment_out: -n, damage: -n }[form.type];
    if (signed === undefined) return null;
    return {
      label: 'Stock change',
      value: `${signed > 0 ? '+' : '−'}${formatNumber(Math.abs(signed))}`,
      tone: signed > 0 ? 'text-success-600' : 'text-danger-600',
    };
  }, [form.quantity, form.type]);

  /** Money this will create an obligation for, in minor units. */
  const owedMinor =
    isPurchase && supplier
      ? Math.round((Number(unitCost) || 0) * Number(form.quantity || 0) * 100)
      : 0;

  // Per-unit cost used to suggest a refund. The average cost is the honest
  // figure once several purchases have moved the price around.
  const costForRefund = ((product?.averageCostMinor ?? product?.costPriceMinor ?? 0) || 0) / 100;

  const busy = adjust.isPending || buy.isPending || giveBack.isPending;
  const failure = error ?? adjust.error?.message ?? buy.error?.message ?? giveBack.error?.message;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust stock"
      description="Stock only ever changes through a recorded movement, with a reason attached."
      size={isPurchase || isReturn ? 'lg' : 'md'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {isReturn ? 'Return stock' : isPurchase ? 'Receive stock' : 'Record adjustment'}
          </Button>
        </>
      }
    >
      {failure && (
        <Alert tone="danger" className="mb-4">
          {failure}
        </Alert>
      )}

      <div className="space-y-4">
        <Field label="Product" htmlFor="adj-product" required>
          {picking ? (
            <>
              <Input
                id="adj-product"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU or barcode…"
                autoComplete="off"
              />
              {search.trim().length >= 2 && (
                <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-ink-200 bg-white shadow-sm">
                  {(results ?? []).map((p) => (
                    <li key={p._id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50"
                        onClick={() => {
                          setForm({
                            ...form,
                            productId: p._id,
                            productLabel: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
                          });
                          setPicking(false);
                          setSearch('');
                        }}
                      >
                        <Package className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="shrink-0 text-2xs text-ink-400">
                          {p.sku} · {formatNumber(p.stockQuantity)} on hand
                        </span>
                      </button>
                    </li>
                  ))}
                  {(results ?? []).length === 0 && (
                    <li className="px-3 py-2 text-2xs text-ink-400">No product matches that search.</li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
                <Package className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                  {form.productLabel}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
                Change
              </Button>
            </div>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Movement type" htmlFor="adj-type" required>
            <Select id="adj-type" value={form.type} onChange={changeType}>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Quantity"
            htmlFor="adj-qty"
            required
            hint={form.type === 'recount' ? 'The counted figure, not a change.' : 'Use a positive number.'}
            error={
              Number(form.quantity) < 0
                ? 'Direction comes from the movement type, not a minus sign.'
                : undefined
            }
          >
            <Input
              id="adj-qty"
              className="tabular"
              inputMode="decimal"
              value={form.quantity}
              onChange={set('quantity')}
            />
          </Field>
        </div>

        {preview && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-2xs text-ink-600">
            <span className="font-medium">{preview.label}: </span>
            <span className={`tabular font-semibold ${preview.tone ?? 'text-ink-900'}`}>{preview.value}</span>
          </p>
        )}

        {/* The question this modal exists to answer: is anyone owed for this? */}
        {INBOUND_TYPES.has(form.type) && (
          <fieldset className="rounded-lg border border-ink-200 p-3">
            <legend className="px-1 text-2xs font-medium text-ink-500">Where did this stock come from?</legend>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="adj-source"
                  value="supplier"
                  checked={source === 'supplier'}
                  onChange={() => setSource('supplier')}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">Bought from a supplier</span>
                  <span className="block text-2xs text-ink-500">
                    Records a purchase. You will owe the supplier for this stock until you pay it.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="adj-source"
                  value="correction"
                  checked={source === 'correction'}
                  onChange={() => setSource('correction')}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">Stock correction</span>
                  <span className="block text-2xs text-ink-500">
                    A recount or a fix. No supplier and no money involved.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        )}

        {/* The mirror question: stock is leaving, so does money come back? */}
        {OUTBOUND_TYPES.has(form.type) && (
          <fieldset className="rounded-lg border border-ink-200 p-3">
            <legend className="px-1 text-2xs font-medium text-ink-500">
              Is any money coming back?
            </legend>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="adj-source"
                  value="supplier"
                  checked={source === 'supplier'}
                  onChange={() => setSource('supplier')}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">
                    The supplier took it back and refunded me
                  </span>
                  <span className="block text-2xs text-ink-500">
                    Stock goes down and the refund comes back into your account.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="adj-source"
                  value="correction"
                  checked={source === 'correction'}
                  onChange={() => setSource('correction')}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">Nothing comes back</span>
                  <span className="block text-2xs text-ink-500">
                    Lost, spoiled or miscounted. The stock goes down and no money moves.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        )}

        {isPurchase && (
          <>
            <SupplierSelect
              id="adj-supplier"
              label="Supplier"
              hint="Who you owe for this stock. They can be added here if this is their first delivery."
              required
              open={open}
              selected={supplier}
              onSelect={setSupplier}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Cost per unit"
                htmlFor="adj-cost"
                required
                hint={`What you pay each. ${product?.sellingPriceMinor ? `You sell at ${formatMoney(product.sellingPriceMinor, business)}.` : ''}`}
              >
                <Input
                  id="adj-cost"
                  className="tabular"
                  inputMode="decimal"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0.00"
                />
              </Field>

              <Field label="Supplier invoice number" htmlFor="adj-ref">
                <Input
                  id="adj-ref"
                  value={form.reference}
                  onChange={set('reference')}
                  placeholder="GRN-2024-118"
                />
              </Field>
            </div>

            {supplier && Number(form.quantity) > 0 && (
              <p className="rounded-lg bg-warning-50 px-3 py-2 text-2xs text-warning-800">
                <span className="font-medium">You will owe {supplier.name} </span>
                <span className="tabular font-semibold">{formatMoney(owedMinor, business)}</span>
                <span className="block">
                  Nothing is paid yet. Settle it from the Purchases list when you pay.
                </span>
              </p>
            )}
          </>
        )}

        {isReturn && (
          <>
            <SupplierSelect
              id="adj-supplier"
              label="Supplier taking it back"
              hint="Who refunded you. They can be added here if this is their first return."
              required
              open={open}
              selected={supplier}
              onSelect={setSupplier}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Refund received"
                htmlFor="adj-refund"
                required
                hint="What the supplier gave back, in total for these units."
              >
                <div className="flex items-start gap-2">
                  <Input
                    id="adj-refund"
                    className="tabular"
                    inputMode="decimal"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="0.00"
                  />
                  {/* A refund is usually the full cost of what went back, so
                      make that one click instead of arithmetic. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!(Number(form.quantity) > 0) || !costForRefund}
                    onClick={() => setRefundAmount((Number(form.quantity) * costForRefund).toFixed(2))}
                  >
                    At cost
                  </Button>
                </div>
              </Field>

              <Field label="Comes back into" htmlFor="adj-refund-account">
                <Select
                  id="adj-refund-account"
                  value={refundAccount}
                  onChange={(e) => setRefundAccount(e.target.value)}
                >
                  {MONEY_ACCOUNTS.map((a) => (
                    <option key={a} value={a}>
                      {MONEY_ACCOUNT_LABELS[a] ?? a}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Credit note number" htmlFor="adj-ref" className="sm:col-span-2">
                <Input
                  id="adj-ref"
                  value={form.reference}
                  onChange={set('reference')}
                  placeholder="CN-2024-007"
                />
              </Field>
            </div>

            {supplier && Number(form.quantity) > 0 && (
              <p className="rounded-lg bg-success-50 px-3 py-2 text-2xs text-success-800">
                <span className="font-medium">Comes back into {refundAccount} </span>
                <span className="tabular font-semibold">
                  {formatMoney(Math.round((Number(refundAmount) || 0) * 100), business)}
                </span>
                <span className="block">
                  If you still owe {supplier.name} for these goods, the refund cancels that amount
                  instead and no cash moves.
                </span>
              </p>
            )}
          </>
        )}

        {!isPurchase && (
          <Field label="Reason" htmlFor="adj-reason" required hint="Permanent. Recorded against your name.">
            <Textarea
              id="adj-reason"
              value={form.reason}
              onChange={set('reason')}
              placeholder="e.g. Counted 12 on the shelf"
            />
          </Field>
        )}

        {!isPurchase && (
          <Field label="Reference" htmlFor="adj-ref">
            <Input
              id="adj-ref"
              value={form.reference}
              onChange={set('reference')}
              placeholder="e.g. GRN-2024-118"
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}