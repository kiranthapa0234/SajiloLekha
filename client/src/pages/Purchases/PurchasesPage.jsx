/**
 * Purchases — goods received from suppliers.
 *
 * A purchase is NOT an expense: it capitalises into inventory and only reaches
 * the profit & loss statement later, as cost of goods sold, when the stock is
 * sold. The page says so explicitly, because mixing the two is the most common
 * way a small business's books stop agreeing with reality.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Banknote, Info, Plus, Truck } from 'lucide-react';
import { PAYMENT_METHOD_ACCOUNT, UNITS_OF_MEASURE } from '@shared/constants.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { useApiMutation, usePaginated } from '@/hooks/useApi.js';
import { useListState } from '@/hooks/index.js';
import { purchases as purchasesApi, products as productsApi, money as moneyApi } from '@/services/index.js';
import { DataTable, TableToolbar } from '@/components/DataTable.jsx';
import { KpiCard } from '@/components/KpiCard.jsx';
import PayPurchaseModal from '@/components/PayPurchaseModal.jsx';
import SupplierSelect from '@/components/SupplierSelect.jsx';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui/index.jsx';
import { formatDate, formatMoney, formatMoneyShort, formatNumber } from '@/utils/format.js';

export default function PurchasesPage() {
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const navigate = useNavigate();
  const [state, update] = useListState({ status: 'all' });
  const [createOpen, setCreateOpen] = useState(false);
  /** The purchase whose debt is being settled, or null. */
  const [paying, setPaying] = useState(null);

  const params = useMemo(
    () => ({ page: state.page, limit: state.limit, search: state.search, status: state.status }),
    [state]
  );

  const { data, meta, isLoading, error, refetch } = usePaginated(() => ({
    queryKey: ['purchases', businessId, params],
    queryFn: () => purchasesApi.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));

  const summary = meta?.summary ?? {};

  const columns = useMemo(
    () => [
      {
        key: 'reference',
        label: 'Reference',
        render: (row) => <span className="font-mono text-xs font-medium text-ink-900">{row.reference}</span>,
      },
      {
        key: 'supplierName',
        label: 'Supplier',
        render: (row) => row.supplierName || row.supplier?.name || 'No supplier',
      },
      {
        key: 'lines',
        label: 'Items',
        align: 'right',
        render: (row) =>
          `${formatNumber(row.lines?.length ?? 0)} (${formatNumber(
            (row.lines ?? []).reduce((s, l) => s + (l.quantity ?? 0), 0)
          )} units)`,
      },
      {
        key: 'netMinor',
        label: 'Net',
        align: 'right',
        render: (row) => <span className="tabular text-ink-700">{formatMoney(row.netMinor, business)}</span>,
      },
      {
        key: 'totalMinor',
        label: 'Total',
        align: 'right',
        render: (row) => <span className="tabular font-medium text-ink-900">{formatMoney(row.totalMinor, business)}</span>,
      },
      {
        key: 'outstandingMinor',
        label: 'Owed',
        align: 'right',
        render: (row) =>
          row.outstandingMinor > 0 ? (
            <span className="tabular font-medium text-warning-600">{formatMoney(row.outstandingMinor, business)}</span>
          ) : (
            <span className="text-ink-400">--</span>
          ),
      },
      {
        key: 'purchasedAt',
        label: 'Received',
        render: (row) => <span className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.purchasedAt)}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
      // Settling a debt to a supplier is the follow-up action to receiving
      // stock, so it belongs on the row rather than behind a detail page.
      ...(can('payment:write')
        ? [
            {
              key: 'actions',
              label: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (row) =>
                row.outstandingMinor > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPaying(row);
                    }}
                  >
                    <Banknote className="h-4 w-4" aria-hidden="true" />
                    Pay
                  </Button>
                ) : (
                  <span className="text-2xs text-ink-400">Settled</span>
                ),
            },
          ]
        : []),
    ],
    [business, can]
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Purchases</h1>
          <p className="mt-0.5 text-sm text-ink-500">Goods received from suppliers, and what is still owed.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/suppliers')}>
            Suppliers
          </Button>
          {can('purchase:write') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Receive stock
            </Button>
          )}
        </div>
      </header>

      <Alert tone="info" title="Purchases are not expenses">
        <span className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Stock bought here is added to inventory at its cost. It becomes an expense (cost of goods sold)
            only when it is sold — so profit is not distorted by when you happened to pay the supplier.
          </span>
        </span>
      </Alert>

      <section aria-label="Purchase summary" className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total purchased" value={formatMoneyShort(summary.totalMinor ?? 0, business)} tone="brand" />
        <KpiCard label="Paid" value={formatMoneyShort(summary.paidMinor ?? 0, business)} tone="success" />
        <KpiCard
          label="Outstanding payables"
          value={formatMoneyShort(summary.outstandingMinor ?? 0, business)}
          subtitle={`${formatNumber(summary.count ?? 0)} purchase(s)`}
          tone={(summary.outstandingMinor ?? 0) > 0 ? 'warning' : 'success'}
        />
      </section>

      <Card>
        <TableToolbar
          search={state.search}
          onSearchChange={(search) => update({ search })}
          placeholder="Search by reference or supplier…"
        >
          <label htmlFor="purchase-status" className="sr-only">
            Filter by status
          </label>
          <Select
            id="purchase-status"
            className="h-9 w-auto py-1 text-sm"
            value={state.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value="all">All purchases</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Part paid</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </TableToolbar>

        <DataTable
          columns={columns}
          rows={data ?? []}
          loading={isLoading}
          error={error}
          onRetry={refetch}
          empty={
            <EmptyState
              icon={Truck}
              title="No purchases recorded"
              description="Receiving stock here updates your inventory and supplier balances automatically."
              action={
                can('purchase:write') ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                    Receive stock
                  </Button>
                ) : null
              }
            />
          }
        />
      </Card>

      <ReceiveStockModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refetch();
        }}
      />

      <PayPurchaseModal
        key={paying ? paying._id : 'no-purchase'}
        open={Boolean(paying)}
        purchase={paying}
        business={business}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          refetch();
        }}
      />
    </div>
  );
}

/** Receive stock against a supplier invoice. */
function ReceiveStockModal({ open, onClose, onCreated }) {
  const { business } = useAuth();
  const businessId = useBusinessId();
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [costPrice, setCostPrice] = useState('');
  const [lines, setLines] = useState([]);
  const [payNow, setPayNow] = useState(false);
  // Stock often arrives for something not yet catalogued, so the purchase form
  // can create the product in place rather than sending the user elsewhere and
  // losing what they had typed.
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [draft, setDraft] = useState({ name: '', sku: '', unit: 'pcs', costPrice: '', sellingPrice: '' });
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');

  // A supplier is often new at the moment their first stock arrives, so the
  // purchase form can add one in place instead of sending the user to another
  // screen and losing the basket they had built.
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const { data: balances } = useQuery({
    queryKey: ['money-balances', businessId],
    queryFn: () => moneyApi.balances(),
    enabled: Boolean(businessId && open),
    staleTime: 10_000,
  });

  const { data: products, isFetching } = useQuery({
    queryKey: ['product-search', businessId, productId],
    queryFn: () => productsApi.search(productId, 10),
    enabled: Boolean(businessId && open && productId.trim().length >= 2),
  });

  const create = useApiMutation((payload) => purchasesApi.create(payload), {
    successMessage: 'Stock received and inventory updated',
    onSuccess: () => {
      setLines([]);
      setReference('');
      setPayNow(false);
      setPayAmount('');
      onCreated();
    },
  });

  const newProduct = useApiMutation((payload) => productsApi.create(payload), {
    successMessage: 'Product added to your inventory',
  });

  const addLine = (product) => {
    const qty = Number(quantity) || 1;
    const cost = Number(costPrice) || product.costPriceMinor / 100;
    // A line with no cost would silently understate what the stock cost, so
    // fall back to the product's recorded cost rather than zero.
    setLines([...lines, { product: product._id, name: product.name, quantity: qty, costPrice: cost }]);
    setProductId('');
    setQuantity('1');
    setCostPrice('');
  };

  const startNewProduct = () => {    // Seed the draft from what was typed, so the common case is one click.
    setDraft((d) => ({
      ...d,
      name: d.name || productId.trim(),
      sku: d.sku || productId.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 24),
      costPrice: d.costPrice || costPrice,
      sellingPrice: d.sellingPrice || '',
    }));
    setCreatingProduct(true);
  };

  const cancelNewProduct = () => {
    setCreatingProduct(false);
    setDraft({ name: '', sku: '', unit: 'pcs', costPrice: '', sellingPrice: '' });
  };

  const saveNewProduct = async () => {
    try {
      const product = await productsApi.create({
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        unit: draft.unit,
        costPrice: Number(draft.costPrice) || 0,
        sellingPrice: Number(draft.sellingPrice) || 0,
        // Stock comes from this purchase, not an opening count, so the product
        // is created empty and the purchase below is what adds the quantity.
        stockQuantity: 0,
        trackStock: true,
      });
      addLine({ ...product, costPriceMinor: Math.round((Number(draft.costPrice) || 0) * 100) });
      cancelNewProduct();
    } catch {
      // The mutation's error state renders inside the form.
    }
  };

  const total = lines.reduce((s, l) => s + l.costPrice * l.quantity, 0);
  const totalMinor = Math.round(total * 100);
  const paidMinor = payNow ? Math.round((Number(payAmount) || 0) * 100) : 0;
  const remainingMinor = Math.max(0, totalMinor - paidMinor);

  // The server refuses an outbound movement the account cannot cover, so warn
  // here first rather than letting the whole purchase fail on a payment the
  // operator could have spotted while typing it.
  const payAccount = PAYMENT_METHOD_ACCOUNT[payMethod] ?? null;
  const payAvailable = payAccount ? (balances?.accounts?.[payAccount]?.totalMinor ?? 0) : null;
  const payShort = payAvailable !== null && paidMinor > 0 && paidMinor > payAvailable;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive stock"
      description="Adds stock to inventory at the cost you record here."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={lines.length === 0}
            onClick={() =>
              create.mutate({
                supplier: supplierId || undefined,
                reference: reference || undefined,
                lines,
                payments: payNow && Number(payAmount) > 0
                  ? [{ amount: payAmount, method: payMethod }]
                  : [],
              })
            }
          >
            Receive {lines.length > 0 ? formatMoney(totalMinor, business) : 'stock'}
          </Button>
        </>
      }
    >
      {create.error && <Alert tone="danger" className="mb-4">{create.error.message}</Alert>}

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SupplierSelect
            id="pur-supplier"
            label="Supplier"
            hint="Optional, but it links the stock and the debt to someone."
            open={open}
            selected={selectedSupplier}
            onSelect={(s) => {
              setSelectedSupplier(s);
              setSupplierId(s?._id ?? '');
            }}
          />

          <Field label="Supplier invoice number" htmlFor="pur-ref">
            <Input id="pur-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="GRN-2024-118" />
          </Field>
        </div>

        <div className="rounded-lg border border-ink-200 p-3">
          <p className="lk-label">Add a product</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative">
              <Field label="Product" htmlFor="pur-product">
                <Input id="pur-product" value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Search name or SKU…" />
              </Field>
              {isFetching && <Spinner className="absolute right-3 top-[30px] h-3.5 w-3.5 text-brand-600" />}
              {(products ?? []).length > 0 && !creatingProduct && (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
                  {products.map((product) => (
                    <li key={product._id}>
                      <button
                        type="button"
                        onClick={() => addLine(product)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-brand-50"
                      >
                        <span className="truncate">{product.name}</span>
                        <span className="truncate text-2xs text-ink-400">{product.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!creatingProduct && (products ?? []).length === 0 && productId.trim().length >= 2 && !isFetching && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
                  <li>
                    <button
                      type="button"
                      onClick={startNewProduct}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-brand-50"
                    >
                      <Plus className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        Create <strong className="font-medium text-ink-900">{productId.trim()}</strong> as a
                        new product
                      </span>
                    </button>
                  </li>
                </ul>
              )}
            </div>

            <Field label="Quantity" htmlFor="pur-qty">
              <Input id="pur-qty" className="tabular" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ''))} />
            </Field>

            <Field label="Unit cost" htmlFor="pur-cost" hint="What you paid each, before the product is picked.">
              <Input id="pur-cost" className="tabular" inputMode="decimal" value={costPrice} onChange={(e) => setCostPrice(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
            </Field>
          </div>

          <p className="mt-1 text-2xs text-ink-500">
            Search for the product above and click it to add this line. You can change the rate and
            quantity afterwards. If it is not in your inventory yet, search for it and choose
            &ldquo;create as a new product&rdquo;.
          </p>

          {creatingProduct && (
            <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
              <p className="lk-label">New product</p>
              {newProduct.error && (
                <Alert tone="danger" className="mb-3">
                  {newProduct.error.message}
                </Alert>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Product name" htmlFor="np-name" required className="sm:col-span-2">
                  <Input id="np-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label="SKU" htmlFor="np-sku" required hint="Unique in this workspace">
                  <Input id="np-sku" className="font-mono text-xs" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
                </Field>
                <Field label="Unit" htmlFor="np-unit">
                  <Select id="np-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                    {UNITS_OF_MEASURE.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Purchase cost" htmlFor="np-cost" required hint="What you pay each.">
                  <Input
                    id="np-cost"
                    className="tabular"
                    inputMode="decimal"
                    value={draft.costPrice}
                    onChange={(e) => setDraft({ ...draft, costPrice: e.target.value.replace(/[^\d.]/g, '') })}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Selling price" htmlFor="np-price" hint="What you will charge.">
                  <Input
                    id="np-price"
                    className="tabular"
                    inputMode="decimal"
                    value={draft.sellingPrice}
                    onChange={(e) => setDraft({ ...draft, sellingPrice: e.target.value.replace(/[^\d.]/g, '') })}
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={cancelNewProduct}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={newProduct.isPending}
                  disabled={draft.name.trim().length < 2 || draft.sku.trim().length < 1 || !draft.costPrice}
                  onClick={saveNewProduct}
                >
                  Create and add
                </Button>
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <ul className="mt-3 space-y-2 border-t border-ink-100 pt-3">
              <li className="text-2xs text-ink-500">
                Adjust the rate and quantity here — the total updates as you type.
              </li>
              {lines.map((line, index) => (
                <li
                  key={`${line.product}-${index}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{line.name}</span>

                  <label className="flex items-center gap-1 text-2xs text-ink-500">
                    <span>Qty</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(line.quantity)}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^\d.]/g, '');
                        setLines(
                          lines.map((l, i) =>
                            i === index ? { ...l, quantity: Number(value) || 0 } : l
                          )
                        );
                      }}
                      aria-label={`Quantity for ${line.name}`}
                      className="tabular h-8 w-16 rounded-md border border-ink-200 px-2 text-sm"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-2xs text-ink-500">
                    <span>Rate</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(line.costPrice)}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^\d.]/g, '');
                        setLines(
                          lines.map((l, i) => (i === index ? { ...l, costPrice: Number(value) || 0 } : l))
                        );
                      }}
                      aria-label={`Unit cost for ${line.name}`}
                      className="tabular h-8 w-24 rounded-md border border-ink-200 px-2 text-sm"
                    />
                  </label>

                  <span className="tabular w-24 text-right font-medium text-ink-900">
                    {formatMoney(Math.round(line.costPrice * line.quantity * 100), business)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((_, i) => i !== index))}
                    className="text-xs text-danger-600 hover:underline"
                    aria-label={`Remove ${line.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-ink-200 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={payNow}
              onChange={(e) => {
                setPayNow(e.target.checked);
                // Default to settling the whole bill; the operator can part-pay.
                if (e.target.checked) setPayAmount((totalMinor / 100).toFixed(2));
              }}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
            />
            Pay the supplier now
          </label>

          {payNow && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Amount paid" htmlFor="pur-pay" hint="Less than the total leaves a balance owed.">
                <div className="flex items-start gap-2">
                  <Input
                    id="pur-pay"
                    className="tabular"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder={(totalMinor / 100).toFixed(2)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setPayAmount((totalMinor / 100).toFixed(2))}
                  >
                    Full amount
                  </Button>
                </div>
              </Field>
              <Field label="Method" htmlFor="pur-paymethod">
                <select id="pur-paymethod" className="lk-input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  {(business?.paymentMethods ?? ['cash']).map((m) => (
                    <option key={m} value={m}>
                      {m.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </Field>

              {/* The server will not let the till go negative, so show what the
                  account holds and flag an amount it cannot cover. */}
              <div className="sm:col-span-2 space-y-2">
                <p className="text-2xs text-ink-500">
                  <span className="capitalize">{payAccount}</span> holds{' '}
                  <strong className="tabular text-ink-700">
                    {payAvailable === null ? '…' : formatMoney(payAvailable, business)}
                  </strong>
                </p>
                {payShort && (
                  <Alert tone="danger">
                    {payAvailable < 0
                      ? `${payAccount} is already overdrawn by ${formatMoney(Math.abs(payAvailable), business)}. ` +
                        'Set the real opening balance on the Accountant screen first.'
                      : `Not enough ${payAccount}. You have ${formatMoney(payAvailable, business)}, this is ` +
                        `${formatMoney(paidMinor, business)} — ${formatMoney(paidMinor - payAvailable, business)} short. ` +
                        'Record it unpaid and settle later, or move money first.'}
                  </Alert>
                )}
              </div>
            </div>
          )}

          {/* Say plainly what this purchase will do to the books, so "unpaid"
              is a decision rather than a setting nobody noticed. */}
          <p className="mt-3 text-2xs text-ink-500">
            Purchase total <strong className="tabular">{formatMoney(totalMinor, business)}</strong>
            {' · '}
            {payNow ? (
              <>
                paying <strong className="tabular">{formatMoney(paidMinor, business)}</strong>
                {remainingMinor > 0
                  ? ` now, leaving ${formatMoney(remainingMinor, business)} owed to the supplier`
                  : ' now — nothing left owing'}
              </>
            ) : (
              <>nothing paid — the whole amount will be owed to the supplier</>
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}
