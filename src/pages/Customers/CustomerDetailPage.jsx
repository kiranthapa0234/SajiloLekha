/**
 * Customer detail: balance, invoices, payments and a downloadable statement.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Wallet } from 'lucide-react';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { useApiMutation, useCustomer, useCustomerStatement } from '@/hooks/useApi.js';
import { useDateRange, useDownload } from '@/hooks/index.js';
import { customers as customersApi, payments as paymentsApi } from '@/services/index.js';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataPoint,
  Field,
  Input,
  Modal,
  Spinner,
  StatusBadge,
} from '@/components/ui/index.jsx';
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
} from '@/utils/format.js';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const { business, can } = useAuth();
  const businessId = useBusinessId();
  const navigate = useNavigate();
  const download = useDownload();
  const { range } = useDateRange({ preset: 'all' });
  const [payOpen, setPayOpen] = useState(false);

  const { data: customer, isLoading, error } = useCustomer(id);
  const { data: statement, isLoading: statementLoading } = useCustomerStatement(id, range.preset === 'custom' ? { from: range.from, to: range.to } : { preset: 'all' });

  const pay = useApiMutation((body) => paymentsApi.create(body), { successMessage: 'Payment recorded' });

  const exportPdf = async () => {
    try {
      const { blob, filename } = await customersApi.statementPdf(id, range.preset === 'custom' ? { from: range.from, to: range.to } : {});
      download(blob, filename);
    } catch {
      /* surfaced by the global toast in the service layer */
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-6">
        <Alert tone="danger" title="Could not load this customer">{error?.message}</Alert>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/customers')}>
          Back to customers
        </Button>
      </div>
    );
  }

  const outstanding = Math.max(0, customer.outstandingMinor ?? 0);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/customers')} className="-ml-2 mb-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to customers
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">{customer.name}</h1>
            {customer.isWalkIn && <StatusBadge status="pending" label="Walk-in" />}
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {[customer.customerCode, customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact details'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {can('payment:write') && outstanding > 0 && (
            <Button onClick={() => setPayOpen(true)}>
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Record payment
            </Button>
          )}
          {can('customer:write') && (
            <Button variant="secondary" onClick={() => navigate(`/customers/${id}/edit`)}>
              Edit
            </Button>
          )}
          <Button variant="secondary" onClick={exportPdf}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Statement PDF
          </Button>
        </div>
      </header>

      {outstanding > 0 && (
        <Alert tone="warning" title="Outstanding balance">
          {formatMoney(outstanding, business)} is owed across{' '}
          {formatNumber(customer.invoices?.filter((i) => ['unpaid', 'partial', 'overdue'].includes(i.status)).length ?? 0)}{' '}
          invoice(s).
        </Alert>
      )}

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <DataPoint label="Lifetime sales" value={formatMoney(customer.totalSalesMinor, business)} />
            <DataPoint label="Total paid" value={formatMoney(customer.totalPaidMinor, business)} />
            <DataPoint label="Refunded" value={formatMoney(customer.totalRefundedMinor, business)} />
            <DataPoint label="Outstanding" value={formatMoney(outstanding, business)} />
            <DataPoint label="Invoices" value={formatNumber(customer.invoiceCount)} />
            <DataPoint
              label="Credit limit"
              value={customer.creditLimitMinor ? formatMoney(customer.creditLimitMinor, business) : 'No limit'}
            />
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Invoices" subtitle={`${customer.invoices?.length ?? 0} most recent`} />
          <CardBody className="p-0">
            {(customer.invoices ?? []).length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-400">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {customer.invoices.map((invoice) => (
                  <li key={invoice._id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        to={`/invoices/${invoice._id}`}
                        className="font-mono text-xs font-medium text-brand-700 hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                      <p className="text-2xs text-ink-400">{formatDate(invoice.issuedAt)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium tabular text-ink-900">{formatMoney(invoice.totalMinor, business)}</p>
                      <StatusBadge status={invoice.status} label={INVOICE_STATUS_LABELS[invoice.status]} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payments" subtitle={`${customer.payments?.length ?? 0} most recent`} />
          <CardBody className="p-0">
            {(customer.payments ?? []).length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-400">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {customer.payments.map((payment) => (
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

      <Card>
        <CardHeader
          title="Statement"
          subtitle="Opening balance, every movement, closing balance"
          action={
            <Button variant="secondary" size="sm" onClick={exportPdf}>
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Download
            </Button>
          }
        />
        <CardBody className="p-0">
          {statementLoading ? (
            <div className="px-5 py-10 text-center">
              <Spinner className="mx-auto h-5 w-5 text-brand-600" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 border-b border-ink-100 px-5 py-4 sm:grid-cols-4">
                <DataPoint label="Opening" value={formatMoney(statement?.openingBalanceMinor, business)} />
                <DataPoint label="Billed" value={formatMoney(statement?.billedMinor, business)} />
                <DataPoint label="Collected" value={formatMoney(statement?.collectedMinor, business)} />
                <DataPoint label="Closing" value={formatMoney(statement?.closingBalanceMinor, business)} />
              </div>

              {(statement?.entries ?? []).length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-400">No movements in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="lk-table">
                    <caption className="sr-only">Statement movements</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Description</th>
                        <th scope="col" className="text-right">
                          Debit
                        </th>
                        <th scope="col" className="text-right">
                          Credit
                        </th>
                        <th scope="col" className="text-right">
                          Balance
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.entries.map((entry, index) => (
                        <tr key={`${entry.reference}-${index}`}>
                          <td className="whitespace-nowrap text-xs">{formatDate(entry.date)}</td>
                          <td className="font-mono text-xs">{entry.reference}</td>
                          <td className="max-w-[240px] truncate text-xs text-ink-500">{entry.description}</td>
                          <td className="text-right tabular">{entry.debitMinor ? formatMoney(entry.debitMinor, business) : '--'}</td>
                          <td className="text-right tabular text-success-600">
                            {entry.creditMinor ? formatMoney(entry.creditMinor, business) : '--'}
                          </td>
                          <td className="text-right font-medium tabular">{formatMoney(entry.balanceMinor, business)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        business={business}
        customer={customer}
        onSubmit={(body) => pay.mutate({ ...body, customer: id })}
      />

      <span className="sr-only">Workspace {businessId}</span>
    </div>
  );
}

/**
 * Collect money against a customer's open invoices.
 *
 * The invoice selector only lists invoices that still owe money, so a payment
 * can never be pointed at a settled document.
 */
function RecordPaymentModal({ open, onClose, business, customer, onSubmit }) {
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');

  const openInvoices = (customer.invoices ?? []).filter((i) =>
    ['unpaid', 'partial', 'overdue'].includes(i.status)
  );
  const selected = openInvoices.find((i) => i._id === invoiceId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a payment"
      description={`${customer.name} owes ${formatMoney(customer.outstandingMinor, business)}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!invoiceId}
            onClick={() =>
              onSubmit({
                invoice: invoiceId,
                amount: amount || String(((selected?.totalMinor ?? 0) - (selected?.paidMinor ?? 0)) / 100),
                method,
                transactionReference: reference,
              })
            }
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Apply to invoice" htmlFor="stmt-invoice" required>
          <select id="stmt-invoice" className="lk-input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">Select an open invoice…</option>
            {openInvoices.map((invoice) => (
              <option key={invoice._id} value={invoice._id}>
                {invoice.invoiceNumber} — {formatMoney(invoice.totalMinor - invoice.paidMinor, business)} due
              </option>
            ))}
          </select>
        </Field>

        <Field label="Amount" htmlFor="stmt-amount" hint="Leave blank for the full outstanding amount of this invoice">
          <Input id="stmt-amount" className="tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>

        <Field label="Method" htmlFor="stmt-method" required>
          <select id="stmt-method" className="lk-input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {(business?.paymentMethods ?? ['cash']).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Transaction reference" htmlFor="stmt-ref">
          <Input id="stmt-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
