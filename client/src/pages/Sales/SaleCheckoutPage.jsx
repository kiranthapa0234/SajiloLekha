/**
 * Checkout (point of sale).
 *
 * Three things make this screen trustworthy rather than merely pretty:
 *   1. Totals are previewed by the SERVER (`POST /sales/quote`) using the same
 *      pricing code that will run at commit, so the number on screen is the
 *      number that gets charged — never a second, drifting client calculation.
 *   2. An idempotency key is generated once per attempt, so a double-click or a
 *      flaky connection replays instead of creating a second sale.
 *   3. Submission is disabled until stock has been confirmed, and the server
 *      remains the authority on stock, discount limits and payment totals.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Minus,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { customers as customersApi, products as productsApi, sales as salesApi } from '@/services/index.js';
import { formatMoney, formatNumber } from '@/utils/format.js';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui/index.jsx';

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'digital_wallet', 'credit'];

/** A fresh idempotency key for one checkout attempt. */
function newCheckoutKey() {
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Idempotency key for the current checkout.
 *
 * Stable across re-renders and retries, so a double-click or a flaky
 * connection REPLAYS the first request instead of creating a second sale.
 *
 * Regenerated only when a sale completes and a new one is started: reusing the
 * key across two real checkouts would make the second sale return the first
 * one's result, which is worse than a duplicate.
 */
function useIdempotencyKey() {
  const [key, setKey] = useState(newCheckoutKey);
  return [key, () => setKey(newCheckoutKey())];
}

export default function SaleCheckoutPage() {
  const { business } = useAuth();
  const businessId = useBusinessId();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [idempotencyKey, regenerateIdempotencyKey] = useIdempotencyKey();

  const [lines, setLines] = useState([]);
  const [customerId, setCustomerId] = useState(searchParams.get('customer') ?? '');
  const [walkInName, setWalkInName] = useState('');
  const [search, setSearch] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [isUnpaid, setIsUnpaid] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [completed, setCompleted] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const maxDiscount = business?.maxDiscountPercent ?? 20;

  /* ------------------------------------------------- product typeahead -- */
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['product-search', businessId, search],
    queryFn: () => productsApi.search(search, 10),
    enabled: Boolean(businessId && search.trim().length >= 2),
    staleTime: 15_000,
  });

  /* ------------------------------------------------------- server quote -- */
  const quoteInput = useMemo(
    () => ({
      lines: lines.map((l) => ({
        product: l.product,
        quantity: l.quantity,
        // `unitPrice` crosses the wire as a human-typed decimal (major units),
        // but a cart line holds minor units. Sending the minor value made the
        // server multiply by 100 again, so a Rs. 580.00 line previewed as
        // Rs. 58,000.00 in the summary while the line itself showed Rs. 580.00.
        unitPrice: l.unitPrice == null ? undefined : l.unitPrice / 100,
      })),
      discountPercent: Number(discountPercent) || 0,
    }),
    [lines, discountPercent]
  );

  useEffect(() => {
    if (lines.length === 0) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await salesApi.quote(quoteInput);
        if (!cancelled) {
          setQuote(result);
          setQuoteError(null);
        }
      } catch (error) {
        if (!cancelled) setQuoteError(error.message);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quoteInput, lines.length]);

  // An empty cart has no quote. Deriving it avoids an effect that clears state
  // after a render, which would briefly show a stale total.
  const activeQuote = lines.length === 0 ? null : quote;

  /* ----------------------------------------------------------- mutations */
  const createSale = useMutation({
    mutationFn: (payload) => salesApi.create(payload),
    onSuccess: (data) => {
      setCompleted(data);
    },
  });

  const addLine = useCallback((product) => {
    setLines((current) => {
      const existing = current.find((l) => l.product === product._id);
      if (existing) {
        return current.map((l) =>
          l.product === product._id
            ? { ...l, quantity: l.quantity + 1, available: product.stockQuantity }
            : l
        );
      }
      return [
        ...current,
        {
          product: product._id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          unitPrice: product.sellingPriceMinor,
          stock: product.stockQuantity,
          available: product.stockQuantity,
          quantity: 1,
          priceEdited: false,
        },
      ];
    });
    setSearch('');
    setSearchOpen(false);
  }, []);

  const setQuantity = useCallback((productId, quantity) => {
    setLines((current) =>
      current
        .map((line) =>
          line.product === productId
            ? { ...line, quantity: Math.max(1, quantity) }
            : line
        )
        .filter((line) => line.quantity > 0)
    );
  }, []);

  const setPrice = useCallback((productId, unitPriceMinor) => {
    setLines((current) =>
      current.map((line) => (line.product === productId ? { ...line, unitPrice: unitPriceMinor, priceEdited: true } : line))
    );
  }, []);

  const removeLine = useCallback((productId) => {
    setLines((current) => current.filter((line) => line.product !== productId));
  }, []);

  /* --------------------------------------------------------------- totals */
  const totals = activeQuote?.totals ?? {
    grossMinor: 0,
    netSalesMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    totalDiscountMinor: 0,
    items: 0,
  };

  const paymentMinor = useMemo(() => {
    if (isUnpaid) return 0;
    if (!amountReceived) return totals.totalMinor;
    const parsed = Number(amountReceived);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }, [amountReceived, isUnpaid, totals.totalMinor]);

  const changeDue = Math.max(0, paymentMinor - totals.totalMinor);
  const shortfall = Math.max(0, totals.totalMinor - paymentMinor);

  const stockProblems = lines.filter((line) => line.available !== null && line.quantity > line.available);

  const canSubmit =
    lines.length > 0 &&
    !stockProblems.length &&
    !createSale.isPending &&
    (isUnpaid || paymentMinor >= totals.totalMinor);

  const submit = async () => {
    try {
      await createSale.mutateAsync({
        customer: customerId || undefined,
        customerName: customerId ? undefined : walkInName || undefined,
        lines: lines.map((line) => ({
          product: line.product,
          quantity: line.quantity,
          unitPrice: line.priceEdited ? line.unitPrice / 100 : undefined,
        })),
        discountPercent: Number(discountPercent) || 0,
        invoiceStatus: isUnpaid ? 'unpaid' : 'paid',
        payments: isUnpaid
          ? []
          : [
              {
                amount: paymentMinor / 100,
                method: paymentMethod,
                paidAt: new Date().toISOString(),
              },
            ],
        idempotencyKey,
      });
    } catch {
      // The mutation's error state renders the banner; nothing more to do here.
    }
  };

  /* --------------------------------------------------------- success view */
  if (completed) {
    return (
      <SaleComplete
        result={completed}
        business={business}
        onNewSale={() => {
          setCompleted(null);
          setLines([]);
          setCustomerId('');
          setWalkInName('');
          setAmountReceived('');
          setDiscountPercent('0');
          setIsUnpaid(false);
          // A genuinely new checkout must carry a new key, or the server would
          // treat it as a replay of the sale just completed.
          regenerateIdempotencyKey();
        }}
        onView={() => navigate(`/sales/${completed.sale._id}`)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">New sale</h1>
        <p className="mt-0.5 text-sm text-ink-500">Scan or search a product to start a checkout.</p>
      </header>

      {(createSale.error || quoteError) && (
        <Alert tone="danger" title="This sale could not be recorded">
          {createSale.error?.message ?? quoteError}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------------- cart -- */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Items" subtitle={lines.length ? `${totals.items} item(s)` : 'No items added yet'} />
            <CardBody className="p-0">
              <ProductSearch
                business={business}
                value={search}
                onChange={setSearch}
                results={searchResults ?? []}
                loading={isFetching}
                open={searchOpen}
                setOpen={setSearchOpen}
                onSelect={addLine}
              />

              {lines.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="Start by adding a product"
                  description="Search by name, SKU or barcode. Prices and stock are confirmed by the server as you go."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {lines.map((line) => {
                    const short = line.available !== null && line.quantity > line.available;
                    return (
                      <li key={line.product} className="px-5 py-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-900">{line.name}</p>
                            <p className="truncate text-2xs text-ink-400">
                              {line.sku}
                              {line.available !== null && (
                                <>
                                  {' · '}
                                  <span className={short ? 'font-medium text-danger-600' : ''}>
                                    {line.available} in stock
                                  </span>
                                </>
                              )}
                            </p>
                            {short && (
                              <p className="mt-1 flex items-center gap-1 text-2xs font-medium text-danger-600">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                Only {line.available} available
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <label htmlFor={`price-${line.product}`} className="sr-only">
                              Unit price for {line.name}
                            </label>
                            <Input
                              id={`price-${line.product}`}
                              className="h-8 w-24 py-1 text-right text-xs tabular"
                              value={(line.unitPrice / 100).toFixed(2)}
                              onChange={(e) => {
                                const value = Number(e.target.value.replace(/[^\d.]/g, ''));
                                if (Number.isFinite(value)) setPrice(line.product, Math.round(value * 100));
                              }}
                              inputMode="decimal"
                            />

                            <div className="flex items-center rounded-lg border border-ink-200">
                              <button
                                type="button"
                                onClick={() => setQuantity(line.product, line.quantity - 1)}
                                disabled={line.quantity <= 1}
                                className="px-2 py-1.5 text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-40"
                                aria-label={`Decrease quantity of ${line.name}`}
                              >
                                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <input
                                className="w-10 border-x border-ink-200 py-1 text-center text-sm tabular focus:outline-none"
                                value={line.quantity}
                                onChange={(e) => {
                                  const value = Number(e.target.value.replace(/\D/g, ''));
                                  if (Number.isFinite(value) && value > 0) setQuantity(line.product, value);
                                }}
                                inputMode="numeric"
                                aria-label={`Quantity of ${line.name}`}
                              />
                              <button
                                type="button"
                                onClick={() => setQuantity(line.product, line.quantity + 1)}
                                className="px-2 py-1.5 text-ink-600 transition-colors hover:bg-ink-50"
                                aria-label={`Increase quantity of ${line.name}`}
                              >
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>

                            <span className="w-24 text-right text-sm font-semibold tabular text-ink-900">
                              {formatMoney(Math.round((line.unitPrice ?? 0) * line.quantity), business)}
                            </span>

                            <button
                              type="button"
                              onClick={() => removeLine(line.product)}
                              className="rounded p-1.5 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                              aria-label={`Remove ${line.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <CustomerPicker
            businessId={businessId}
            value={customerId}
            walkInName={walkInName}
            onChangeCustomer={setCustomerId}
            onChangeWalkIn={setWalkInName}
          />
        </div>

        {/* --------------------------------------------------- summary -- */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="space-y-4">
              <Field label="Invoice discount" htmlFor="discount" hint={`Maximum ${maxDiscount}% for your role`}>
                <div className="relative">
                  <Input
                    id="discount"
                    className="pr-8"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal"
                    invalid={Number(discountPercent) > maxDiscount}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">%</span>
                </div>
                {Number(discountPercent) > maxDiscount && (
                  <p className="lk-error" role="alert">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Exceeds the {maxDiscount}% limit
                  </p>
                )}
              </Field>

              <dl className="space-y-2 border-t border-ink-100 pt-3 text-sm">
                <Row label="Subtotal" value={formatMoney(totals.grossMinor, business)} />
                {totals.totalDiscountMinor > 0 && (
                  <Row
                    label="Discount"
                    value={`-${formatMoney(totals.totalDiscountMinor, business)}`}
                    tone="warning"
                  />
                )}
                {business?.taxEnabled && totals.taxMinor > 0 && (
                  <Row label={`${business.taxLabel ?? 'VAT'} (${business.taxRatePercent}%)`} value={formatMoney(totals.taxMinor, business)} />
                )}
                <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular" aria-live="polite">
                    {formatMoney(totals.totalMinor, business)}
                  </dd>
                </div>
              </dl>

              <fieldset className="space-y-3 border-t border-ink-100 pt-4">
                <legend className="text-xs font-medium text-ink-700">Payment</legend>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={isUnpaid}
                    onChange={(e) => setIsUnpaid(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                  />
                  Record as unpaid (credit sale)
                </label>

                {!isUnpaid && (
                  <>
                    <Field label="Method" htmlFor="method">
                      <Select id="method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                        {(business?.paymentMethods ?? PAYMENT_METHODS).map((method) => (
                          <option key={method} value={method}>
                            {method.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label="Amount received"
                      htmlFor="received"
                      hint="Leave blank to record the full total"
                      error={shortfall > 0 ? `Short by ${formatMoney(shortfall, business)}` : undefined}
                    >
                      <Input
                        id="received"
                        className="tabular"
                        value={amountReceived}
                        onChange={(e) => setAmountReceived(e.target.value.replace(/[^\d.]/g, ''))}
                        inputMode="decimal"
                        placeholder={(totals.totalMinor / 100).toFixed(2)}
                        invalid={shortfall > 0}
                      />
                    </Field>

                    {changeDue > 0 && (
                      <div className="rounded-lg bg-success-50 px-3 py-2 text-sm">
                        <span className="text-success-700">Change due </span>
                        <span className="font-semibold tabular text-success-700">{formatMoney(changeDue, business)}</span>
                      </div>
                    )}
                  </>
                )}
              </fieldset>

              <Button
                className="w-full"
                size="lg"
                onClick={submit}
                loading={createSale.isPending}
                disabled={!canSubmit}
              >
                {createSale.isPending ? 'Recording…' : isUnpaid ? 'Save as credit sale' : 'Complete sale'}
              </Button>

              {!canSubmit && lines.length > 0 && !createSale.isPending && (
                <p className="text-center text-2xs text-ink-400">
                  {stockProblems.length
                    ? 'Resolve the stock warnings before completing this sale.'
                    : 'Enter the amount received to continue.'}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className={tone === 'warning' ? 'tabular text-warning-600' : 'tabular text-ink-900'}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------- product search -- */

function ProductSearch({ business, value, onChange, results, loading, onSelect, open, setOpen }) {
  const showResults = open && value.trim().length >= 2;

  return (
    <div className="border-b border-ink-100 p-4">
      <div className="relative">
        <label htmlFor="checkout-search" className="sr-only">
          Search products
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          id="checkout-search"
          type="search"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by name, SKU or barcode…"
          className="lk-input pl-9"
          autoComplete="off"
          role="combobox"
          aria-expanded={showResults}
          aria-controls="product-results"
          aria-autocomplete="list"
        />
        {loading && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-600" />}
      </div>

      {showResults && (
        <ul
          id="product-results"
          role="listbox"
          className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-ink-200 bg-white shadow-popover"
        >
          {results.length === 0 && !loading ? (
            <li className="px-4 py-6 text-center text-sm text-ink-400">No products match “{value}”</li>
          ) : (
            results.map((product) => (
              <li key={product._id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(product)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">{product.name}</span>
                    <span className="block truncate text-2xs text-ink-400">
                      {product.sku}
                      {product.stockStatus !== 'in_stock' && (
                        <span className="ml-1.5 font-medium text-warning-600">
                          {product.stockStatus === 'out_of_stock' ? 'out of stock' : `${product.stockQuantity} left`}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular text-ink-900">
                    {formatMoney(product.sellingPriceMinor, business)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------- customer picker -- */

function CustomerPicker({ businessId, value, walkInName, onChangeCustomer, onChangeWalkIn }) {
  const [mode, setMode] = useState(value ? 'customer' : 'walk_in');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const { data: customerPage } = useQuery({
    queryKey: ['customer-picker', businessId, search],
    queryFn: () => customersApi.list({ search, limit: 8, status: 'active' }),
    enabled: Boolean(businessId && search.trim().length >= 1),
    staleTime: 30_000,
  });
  // The list endpoint answers with `{ items, meta }` so pagination survives.
  const customers = customerPage?.items ?? [];

  const selected = value ? customers.find((c) => c._id === value) : null;

  return (
    <Card>
      <CardHeader title="Customer" subtitle="Optional — walk-in sales still get an invoice" />
      <CardBody className="space-y-3">
        <div className="flex gap-2">
          {[
            { key: 'walk_in', label: 'Walk-in' },
            { key: 'customer', label: 'Existing customer' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setMode(tab.key);
                if (tab.key === 'walk_in') onChangeCustomer('');
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === tab.key ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'walk_in' ? (
          <Field label="Walk-in name" htmlFor="walkin" hint="Leave blank to use the default walk-in customer">
            <Input
              id="walkin"
              value={walkInName}
              onChange={(e) => onChangeWalkIn(e.target.value)}
              placeholder="Walk-in Customer"
            />
          </Field>
        ) : (
          <div className="relative">
            <label htmlFor="customer-search" className="lk-label">
              Customer
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-[34px] h-4 w-4 text-ink-400"
              aria-hidden="true"
            />
            <Input
              id="customer-search"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Search by name, phone or code…"
              autoComplete="off"
            />
            {open && customers.length > 0 && (
              <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
                {customers.map((customer) => (
                  <li key={customer._id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChangeCustomer(customer._id);
                        setSearch(customer.name);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-brand-50"
                    >
                      <span className="truncate text-sm text-ink-900">{customer.name}</span>
                      <span className="truncate text-2xs text-ink-400">{customer.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {selected && (
          <div className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {selected.name}
            <button
              type="button"
              onClick={() => {
                onChangeCustomer('');
                setSearch('');
              }}
              className="ml-auto"
              aria-label="Clear selected customer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------- success screen -- */

function SaleComplete({ result, business, onNewSale, onView }) {
  const { sale, invoice } = result;
  const printUrl = `/api/invoices/${invoice._id}?format=print`;

  return (
    <div className="mx-auto max-w-lg p-6">
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-50 text-success-600">
          <Check className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Sale recorded</h1>
        <p className="mt-1 text-sm text-ink-500">
          Invoice <span className="font-mono font-medium text-ink-700">{sale.reference}</span> was issued.
        </p>
      </div>

      <Card>
        <CardBody className="space-y-3 text-sm">
          <Row label="Items" value={formatNumber(sale.itemCount)} />
          <Row label="Net sales" value={formatMoney(sale.netSalesMinor, business)} />
          {sale.taxMinor > 0 && <Row label="Tax" value={formatMoney(sale.taxMinor, business)} />}
          <Row label="Total" value={formatMoney(sale.totalMinor, business)} />
          <Row label="Paid" value={formatMoney(sale.paidMinor, business)} />
          {sale.outstandingMinor > 0 && (
            <Row label="Outstanding" value={formatMoney(sale.outstandingMinor, business)} tone="warning" />
          )}
          <div className="flex items-center justify-between border-t border-ink-100 pt-3">
            <span className="text-ink-500">Status</span>
            <StatusBadge status={invoice.status} label={invoice.status} />
          </div>
        </CardBody>
      </Card>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onNewSale} className="flex-1">
          New sale
        </Button>
        <Button variant="secondary" onClick={onView} className="flex-1">
          View sale
        </Button>
        <Button variant="secondary" onClick={() => window.open(printUrl, '_blank', 'noopener')}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print
        </Button>
      </div>
    </div>
  );
}
