/**
 * Sale detail — the record of one checkout, with its invoice, payments and stock
 * impact. Also the entry point for taking a payment, refunding or cancelling.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Download,
  Printer,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useApiMutation, useSale } from '@/hooks/useApi.js';
import { sales as salesApi } from '@/services/index.js';
import { useDownload } from '@/hooks/index.js';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataPoint,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from '@/components/ui/index.jsx';
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
} from '@/utils/format.js';

export default function SaleDetailPage() {
  const { id } = useParams();
  const { business, can } = useAuth();
  const navigate = useNavigate();
  const download = useDownload();

  const { data: sale, isLoading, error, refetch } = useSale(id);
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const payment = useApiMutation((body) => salesApi.addPayment(id, body), {
    successMessage: 'Payment recorded',
    onSuccess: () => {
      setPayOpen(false);
      refetch();
    },
  });

  const refund = useApiMutation((body) => salesApi.refund(id, body), {
    successMessage: 'Refund recorded',
    onSuccess: () => {
      setRefundOpen(false);
      refetch();
    },
  });

  const cancel = useApiMutation((body) => salesApi.cancel(id, body), {
    successMessage: 'Sale cancelled and stock reversed',
    onSuccess: () => {
      setCancelOpen(false);
      refetch();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="danger" title="Could not load this sale">
          {error.message}
        </Alert>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/sales')}>
          Back to sales
        </Button>
      </div>
    );
  }

  const invoice = sale.invoice;
  const outstanding = Math.max(0, (invoice?.totalMinor ?? 0) - (invoice?.paidMinor ?? 0) - (invoice?.writtenOffMinor ?? 0));
  const isCancelled = sale.status === 'cancelled';

  const printInvoice = async () => {
    try {
      const { blob, filename } = await import('@/services/index.js').then((m) => m.invoices.pdf(invoice._id));
      download(blob, filename);
    } catch (err) {
      payment.reset();
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales')} className="-ml-2 mb-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to sales
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-ink-900">{sale.reference}</h1>
            <StatusBadge
              status={isCancelled ? 'cancelled' : invoice?.status ?? 'unpaid'}
              label={isCancelled ? 'Cancelled' : INVOICE_STATUS_LABELS[invoice?.status]}
            />
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {formatDateTime(sale.soldAt)} · {sale.customerName}
            {sale.isWalkIn && ' (walk-in)'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {invoice && (
            <>
              <Button
                variant="secondary"
                onClick={() => window.open(`/api/invoices/${invoice._id}?format=print`, '_blank', 'noopener')}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print
              </Button>
              <Button variant="secondary" onClick={printInvoice}>
                <Download className="h-4 w-4" aria-hidden="true" />
                PDF
              </Button>
            </>
          )}
          {can('payment:write') && outstanding > 0 && !isCancelled && (
            <Button onClick={() => setPayOpen(true)}>
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Record payment
            </Button>
          )}
          {can('sale:refund') && sale.paidMinor > 0 && !isCancelled && (
            <Button variant="secondary" onClick={() => setRefundOpen(true)}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Refund
            </Button>
          )}
          {can('sale:write') && !isCancelled && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      </header>

      {isCancelled && (
        <Alert tone="warning" title="This sale was cancelled">
          {sale.cancellationReason} · {formatDateTime(sale.cancelledAt)}
          {sale.paidMinor === 0 ? ' Stock was returned to inventory.' : ''}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Items" subtitle={`${sale.itemCount} unit(s) across ${sale.lines.length} line(s)`} />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="lk-table">
                <caption className="sr-only">Items in this sale</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="text-right">
                      Qty
                    </th>
                    <th scope="col" className="text-right">
                      Price
                    </th>
                    <th scope="col" className="text-right">
                      Discount
                    </th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sale.lines.map((line) => (
                    <tr key={line._id}>
                      <td>
                        <span className="block text-sm font-medium text-ink-900">{line.name}</span>
                        <span className="block text-2xs text-ink-400">{line.sku}</span>
                        {line.returnedQuantity > 0 && (
                          <span className="mt-0.5 block text-2xs text-warning-600">
                            {formatNumber(line.returnedQuantity)} returned
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular">{formatNumber(line.quantity)}</td>
                      <td className="text-right tabular">{formatMoney(line.unitPriceMinor, business)}</td>
                      <td className="text-right tabular text-ink-500">
                        {line.discountMinor ? `-${formatMoney(line.discountMinor, business)}` : '--'}
                      </td>
                      <td className="text-right font-medium tabular text-ink-900">
                        {formatMoney(line.totalMinor, business)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="space-y-2 border-t border-ink-100 px-5 py-4 text-sm">
              <SummaryRow label="Subtotal" value={formatMoney(sale.grossMinor, business)} />
              {sale.totalDiscountMinor > 0 && (
                <SummaryRow label="Discount" value={`-${formatMoney(sale.totalDiscountMinor, business)}`} tone="warning" />
              )}
              <SummaryRow label="Net sales" value={formatMoney(sale.netSalesMinor, business)} />
              {sale.taxMinor > 0 && <SummaryRow label="Tax" value={formatMoney(sale.taxMinor, business)} />}
              <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{formatMoney(sale.totalMinor, business)}</dd>
              </div>
              <SummaryRow label="Paid" value={`-${formatMoney(sale.paidMinor, business)}`} tone="success" />
              {sale.refundedMinor > 0 && (
                <SummaryRow label="Refunded" value={`+${formatMoney(sale.refundedMinor, business)}`} tone="danger" />
              )}
              {outstanding > 0 && (
                <div className="flex items-center justify-between pt-1 font-semibold text-danger-600">
                  <dt>Balance due</dt>
                  <dd className="tabular">{formatMoney(outstanding, business)}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                <DataPoint label="Items" value={formatNumber(sale.itemCount)} />
                <DataPoint label="Lines" value={formatNumber(sale.lines.length)} />
                <DataPoint label="Cost of goods" value={formatMoney(sale.cogsMinor, business)} />
                <DataPoint
                  label="Gross profit"
                  value={formatMoney(sale.grossProfitMinor, business)}
                />
                <DataPoint label="Channel" value={sale.channel?.toUpperCase()} />
                <DataPoint label="Created by" value={sale.createdBy?.name ?? '--'} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payments" subtitle={`${sale.payments?.length ?? 0} recorded`} />
            <CardBody className="p-0">
              {(sale.payments ?? []).length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-ink-400">No payments recorded yet.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {sale.payments.map((payment) => (
                    <li key={payment._id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                        </p>
                        <p className="truncate text-2xs text-ink-400">
                          {formatDateTime(payment.paidAt)}
                          {payment.transactionReference ? ` · ${payment.transactionReference}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular text-ink-900">
                          {formatMoney(payment.amountMinor, business)}
                        </p>
                        <StatusBadge status={payment.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {invoice && (
            <Card>
              <CardHeader title="Invoice" />
              <CardBody>
                <dl className="grid grid-cols-2 gap-4">
                  <DataPoint label="Number" value={invoice.invoiceNumber} mono />
                  <DataPoint label="Status" value={INVOICE_STATUS_LABELS[invoice.status]} />
                  <DataPoint label="Issued" value={formatDate(invoice.issuedAt)} />
                  <DataPoint label="Due" value={invoice.dueDate ? formatDate(invoice.dueDate) : 'On receipt'} />
                </dl>
                <Link
                  to={`/invoices/${invoice._id}`}
                  className="mt-4 inline-block text-xs font-medium text-brand-700 hover:underline"
                >
                  Open invoice →
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        business={business}
        outstanding={outstanding}
        methods={business?.paymentMethods ?? ['cash']}
        loading={payment.isPending}
        error={payment.error?.message}
        onSubmit={(body) => payment.mutate(body)}
      />

      <RefundModal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        business={business}
        sale={sale}
        loading={refund.isPending}
        error={refund.error?.message}
        onSubmit={(body) => refund.mutate(body)}
      />

      <CancelModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        loading={cancel.isPending}
        error={cancel.error?.message}
        hasPayments={sale.paidMinor > 0}
        onSubmit={(body) => cancel.mutate(body)}
      />
    </div>
  );
}

function SummaryRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={`tabular ${
          tone === 'success' ? 'text-success-600' : tone === 'warning' ? 'text-warning-600' : tone === 'danger' ? 'text-danger-600' : 'text-ink-900'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function RecordPaymentModal({ open, onClose, business, outstanding, methods, loading, error, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(methods[0] ?? 'cash');
  const [reference, setReference] = useState('');

  const maxRupees = (outstanding / 100).toFixed(2);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a payment"
      description={`Outstanding balance ${formatMoney(outstanding, business)}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={() => onSubmit({ amount: amount || maxRupees, method, reference })}
          >
            Record payment
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="space-y-4">
        <Field
          label="Amount"
          htmlFor="pay-amount"
          required
          hint={`Maximum ${formatMoney(outstanding, business)} — a larger payment is rejected by the server.`}
        >
          <Input
            id="pay-amount"
            className="tabular"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={maxRupees}
            autoFocus
          />
        </Field>

        <Field label="Method" htmlFor="pay-method" required>
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Transaction reference" htmlFor="pay-ref" hint="Bank or wallet reference for reconciliation">
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="NEFT-12345" />
        </Field>
      </div>
    </Modal>
  );
}

function RefundModal({ open, onClose, business, sale, loading, error, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const [restock, setRestock] = useState(true);
  const [restockReason, setRestockReason] = useState('');
  const [lines, setLines] = useState({});

  const refundable = sale.totalMinor - sale.refundedMinor;
  const blocked = !reason.trim() || (restock && !restockReason.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refund this sale"
      description="A refund reduces revenue and may return stock to inventory."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={blocked}
            onClick={() =>
              onSubmit({
                amount: amount || String(refundable / 100),
                reason,
                method,
                restock,
                restockReason,
                lines: Object.entries(lines)
                  .filter(([, quantity]) => Number(quantity) > 0)
                  .map(([index, quantity]) => ({ line: Number(index), quantity: Number(quantity) })),
              })
            }
          >
            Refund {amount ? formatMoney(Math.round(Number(amount) * 100), business) : formatMoney(refundable, business)}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="space-y-4">
        <Field
          label="Amount"
          htmlFor="refund-amount"
          required
          hint={`Refundable ${formatMoney(refundable, business)}. Only ${formatMoney(sale.paidMinor, business)} was collected.`}
        >
          <Input
            id="refund-amount"
            className="tabular"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={(refundable / 100).toFixed(2)}
          />
        </Field>

        <Field label="Method" htmlFor="refund-method" required>
          <Select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['cash', 'bank_transfer', 'card', 'digital_wallet'].map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Reason" htmlFor="refund-reason" required>
          <Textarea
            id="refund-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being refunded?"
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={restock}
            onChange={(e) => setRestock(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
          />
          Return items to stock
        </label>

        {restock && (
          <>
            <Field label="Restock reason" htmlFor="restock-reason" required>
              <Input
                id="restock-reason"
                value={restockReason}
                onChange={(e) => setRestockReason(e.target.value)}
                placeholder="Returned in good condition"
              />
            </Field>

            <div>
              <p className="lk-label">Quantities to return</p>
              <ul className="space-y-2">
                {sale.lines.map((line, index) => (
                  <li key={line._id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2">
                    <span className="min-w-0 truncate text-sm text-ink-700">{line.name}</span>
                    <input
                      type="number"
                      min={0}
                      max={line.quantity - (line.returnedQuantity ?? 0)}
                      value={lines[index] ?? ''}
                      onChange={(e) => setLines({ ...lines, [index]: e.target.value })}
                      placeholder={String(line.quantity - (line.returnedQuantity ?? 0))}
                      className="lk-input h-8 w-20 py-1 text-right text-xs tabular"
                      aria-label={`Quantity of ${line.name} to return`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function CancelModal({ open, onClose, loading, error, hasPayments, onSubmit }) {
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [restockReason, setRestockReason] = useState('');

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => onSubmit({ reason, restock, restockReason })}
      title="Cancel this sale?"
      description={
        hasPayments
          ? 'Payments are still attached to this sale, so the server will refuse the cancellation. Refund them first.'
          : 'The invoice is cancelled and stock is returned to inventory.'
      }
      confirmLabel="Cancel sale"
      loading={loading}
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <Field label="Reason" htmlFor="cancel-reason" required>
        <Textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Entered by mistake"
        />
      </Field>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={restock}
          onChange={(e) => setRestock(e.target.checked)}
          className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
        />
        Return items to stock
      </label>
      {restock && (
        <Field label="Restock reason" htmlFor="cancel-restock" className="mt-3">
          <Input id="cancel-restock" value={restockReason} onChange={(e) => setRestockReason(e.target.value)} />
        </Field>
      )}
    </ConfirmDialog>
  );
}
