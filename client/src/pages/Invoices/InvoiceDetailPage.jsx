/**
 * Invoice detail — the document as the customer sees it, plus settlement tools.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Download, Printer, Wallet } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useApiMutation, useInvoice } from '@/hooks/useApi.js';
import { useDownload } from '@/hooks/index.js';
import { invoices as invoicesApi, payments as paymentsApi } from '@/services/index.js';
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

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { business, can } = useAuth();
  const navigate = useNavigate();
  const download = useDownload();
  const { data: invoice, isLoading, error, refetch } = useInvoice(id);

  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [writeOffOpen, setWriteOffOpen] = useState(false);

  const pay = useApiMutation((body) => paymentsApi.create({ invoice: id, ...body }), {
    successMessage: 'Payment recorded',
    onSuccess: () => {
      setPayOpen(false);
      refetch();
    },
  });

  const cancel = useApiMutation((body) => invoicesApi.cancel(id, body.reason), {
    successMessage: 'Invoice cancelled',
    onSuccess: () => {
      setCancelOpen(false);
      refetch();
    },
  });

  const writeOff = useApiMutation((body) => invoicesApi.writeOff(id, body), {
    successMessage: 'Balance written off',
    onSuccess: () => {
      setWriteOffOpen(false);
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

  if (error || !invoice) {
    return (
      <div className="p-6">
        <Alert tone="danger" title="Could not load this invoice">{error?.message}</Alert>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/invoices')}>
          Back to invoices
        </Button>
      </div>
    );
  }

  const outstanding = Math.max(0, invoice.totalMinor - invoice.paidMinor - (invoice.writtenOffMinor ?? 0));
  const isCancelled = invoice.status === 'cancelled';

  const downloadPdf = async () => {
    try {
      const { blob, filename } = await invoicesApi.pdf(id);
      download(blob, filename);
    } catch {
      /* the service layer surfaces failures */
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')} className="-ml-2 mb-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to invoices
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-ink-900">{invoice.invoiceNumber}</h1>
            <StatusBadge status={invoice.status} label={INVOICE_STATUS_LABELS[invoice.status]} />
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            Issued {formatDate(invoice.issuedAt)} ·{' '}
            {invoice.dueDate ? `due ${formatDate(invoice.dueDate)}` : 'payable on receipt'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => window.open(`/api/invoices/${id}?format=print`, '_blank', 'noopener')}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </Button>
          <Button variant="secondary" onClick={downloadPdf}>
            <Download className="h-4 w-4" aria-hidden="true" />
            PDF
          </Button>
          {can('payment:write') && outstanding > 0 && !isCancelled && (
            <Button onClick={() => setPayOpen(true)}>
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Record payment
            </Button>
          )}
          {can('invoice:cancel') && outstanding > 0 && !isCancelled && (
            <Button variant="secondary" onClick={() => setWriteOffOpen(true)}>
              Write off
            </Button>
          )}
          {can('invoice:cancel') && !isCancelled && invoice.paidMinor === 0 && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      </header>

      {isCancelled && (
        <Alert tone="warning" title="Invoice cancelled">
          {invoice.cancellationReason}
          {invoice.cancelledAt ? ` · ${formatDateTime(invoice.cancelledAt)}` : ''}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Billed to" />
          <CardBody>
            <p className="text-sm font-semibold text-ink-900">{invoice.customerName}</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {[invoice.customerPhone, invoice.customerAddress].filter(Boolean).join(' · ') || 'Walk-in customer'}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              Issued by {invoice.businessSnapshot?.name ?? business?.name}
              {invoice.businessSnapshot?.taxNumber ? ` · VAT ${invoice.businessSnapshot.taxNumber}` : ''}
            </p>
          </CardBody>

          <div className="border-t border-ink-100">
            <table className="lk-table">
              <caption className="sr-only">Invoice lines</caption>
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
                    {invoice.taxLabel || 'Tax'}
                  </th>
                  <th scope="col" className="text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line._id}>
                    <td>
                      <span className="block text-sm font-medium text-ink-900">{line.name}</span>
                      <span className="block text-2xs text-ink-400">{line.sku}</span>
                    </td>
                    <td className="text-right tabular">{formatNumber(line.quantity)}</td>
                    <td className="text-right tabular">{formatMoney(line.unitPriceMinor, business)}</td>
                    <td className="text-right tabular text-ink-500">
                      {line.discountMinor ? `-${formatMoney(line.discountMinor, business)}` : '--'}
                    </td>
                    <td className="text-right tabular text-ink-500">
                      {line.taxMinor ? formatMoney(line.taxMinor, business) : '--'}
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
            <Row label="Subtotal" value={formatMoney(invoice.grossMinor, business)} />
            {invoice.totalDiscountMinor > 0 && (
              <Row label="Discount" value={`-${formatMoney(invoice.totalDiscountMinor, business)}`} tone="warning" />
            )}
            <Row label="Net sales" value={formatMoney(invoice.netSalesMinor, business)} />
            {invoice.taxMinor > 0 && (
              <Row label={`${invoice.taxLabel} (${invoice.taxPercent}%)`} value={formatMoney(invoice.taxMinor, business)} />
            )}
            <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatMoney(invoice.totalMinor, business)}</dd>
            </div>
            <Row label="Paid" value={`-${formatMoney(invoice.paidMinor, business)}`} tone="success" />
            {invoice.refundedMinor > 0 && (
              <Row label="Refunded" value={`+${formatMoney(invoice.refundedMinor, business)}`} tone="danger" />
            )}
            {invoice.writtenOffMinor > 0 && (
              <Row label="Written off" value={`+${formatMoney(invoice.writtenOffMinor, business)}`} />
            )}
            {outstanding > 0 && (
              <div className="flex items-center justify-between pt-1 font-semibold text-danger-600">
                <dt>Balance due</dt>
                <dd className="tabular">{formatMoney(outstanding, business)}</dd>
              </div>
            )}
          </dl>

          {(invoice.note || invoice.terms || invoice.footer) && (
            <div className="space-y-2 border-t border-ink-100 px-5 py-4 text-xs text-ink-500">
              {invoice.note && (
                <p>
                  <strong className="text-ink-700">Notes:</strong> {invoice.note}
                </p>
              )}
              {invoice.terms && (
                <p>
                  <strong className="text-ink-700">Terms:</strong> {invoice.terms}
                </p>
              )}
              {invoice.footer && <p className="text-center text-ink-400">{invoice.footer}</p>}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Settlement" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                <DataPoint label="Total" value={formatMoney(invoice.totalMinor, business)} />
                <DataPoint label="Paid" value={formatMoney(invoice.paidMinor, business)} />
                <DataPoint label="Outstanding" value={formatMoney(outstanding, business)} />
                <DataPoint
                  label="Days overdue"
                  value={invoice.daysOverdue > 0 ? invoice.daysOverdue : '--'}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment trail" subtitle={`${invoice.payments?.length ?? 0} recorded`} />
            <CardBody className="p-0">
              {(invoice.payments ?? []).length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-400">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {invoice.payments.map((payment) => (
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
                      <p className="shrink-0 text-sm font-semibold tabular text-ink-900">
                        {formatMoney(payment.amountMinor, business)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        business={business}
        outstanding={outstanding}
        loading={pay.isPending}
        error={pay.error?.message}
        onSubmit={(body) => pay.mutate(body)}
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate({ reason: cancelReason })}
        title="Cancel this invoice?"
        description="The invoice is kept for audit and excluded from revenue. The related sale is not changed."
        confirmLabel="Cancel invoice"
        loading={cancel.isPending}
      >
        {cancel.error && <Alert tone="danger" className="mb-4">{cancel.error.message}</Alert>}
        <Field label="Reason" htmlFor="invoice-cancel-reason" required>
          <Textarea
            id="invoice-cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="e.g. Raised in error"
          />
        </Field>
      </ConfirmDialog>

      <WriteOffModal
        open={writeOffOpen}
        onClose={() => setWriteOffOpen(false)}
        business={business}
        outstanding={outstanding}
        loading={writeOff.isPending}
        error={writeOff.error?.message}
        onSubmit={(body) => writeOff.mutate(body)}
      />
    </div>
  );
}

function Row({ label, value, tone }) {
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

function RecordPaymentModal({ open, onClose, business, outstanding, loading, error, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const max = (outstanding / 100).toFixed(2);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a payment"
      description={`Outstanding ${formatMoney(outstanding, business)}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={() => onSubmit({ amount: amount || max, method, transactionReference: reference })}>
            Record payment
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="space-y-4">
        <Field label="Amount" htmlFor="inv-pay-amount" hint={`Maximum ${formatMoney(outstanding, business)}`} required>
          <Input
            id="inv-pay-amount"
            className="tabular"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={max}
          />
        </Field>
        <Field label="Method" htmlFor="inv-pay-method" required>
          <select id="inv-pay-method" className="lk-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {(business?.paymentMethods ?? ['cash'])
              .filter((m) => m !== 'credit')
              .map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m] ?? m}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Transaction reference" htmlFor="inv-pay-ref">
          <Input id="inv-pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function WriteOffModal({ open, onClose, business, outstanding, loading, error, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Write off the balance"
      description="Reduce the receivable without moving cash. Use for bad debt."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading}
            disabled={!reason.trim()}
            onClick={() => onSubmit({ amount: amount || String(outstanding / 100), reason })}
          >
            Write off
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="space-y-4">
        <Field label="Amount" htmlFor="wo-amount" hint={`Outstanding ${formatMoney(outstanding, business)}`}>
          <Input
            id="wo-amount"
            className="tabular"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={(outstanding / 100).toFixed(2)}
          />
        </Field>
        <Field label="Reason" htmlFor="wo-reason" required>
          <Textarea id="wo-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer relocated" />
        </Field>
      </div>
    </Modal>
  );
}
