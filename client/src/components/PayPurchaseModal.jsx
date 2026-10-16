/**
 * Settle what is owed on a purchase.
 *
 * A purchase recorded without payment is a debt to the supplier, and until
 * this screen existed there was no way to discharge it after the fact. The
 * amount defaults to the full outstanding balance, because that is the common
 * case, but it accepts a part payment.
 *
 * The server refuses to let the till go negative (see `assertFunds`), so this
 * screen shows the account balance up front and flags an unaffordable amount
 * before the round trip. It is the same check, just early: the operator learns
 * the payment is too big while they are still editing, not from an error toast
 * afterwards.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';

import { PAYMENT_METHOD_ACCOUNT, PAYMENT_METHOD_LABELS } from '@shared/constants.js';
import { useApiMutation, useToast } from '@/hooks/useApi.js';
import { useBusinessId } from '@/context/AuthContext.jsx';
import { money as moneyApi, purchases as purchasesApi } from '@/services/index.js';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/index.jsx';
import { formatMoney } from '@/utils/format.js';

export default function PayPurchaseModal({ open, onClose, onPaid, purchase, business }) {
  const toast = useToast();
  const businessId = useBusinessId();
  const outstanding = purchase?.outstandingMinor ?? 0;

  const [amount, setAmount] = useState(() => (outstanding / 100).toFixed(2));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: balances } = useQuery({
    queryKey: ['money-balances', businessId],
    queryFn: () => moneyApi.balances(),
    enabled: Boolean(open && businessId),
    staleTime: 10_000,
  });

  const account = PAYMENT_METHOD_ACCOUNT[method];
  const availableMinor = account ? (balances?.accounts?.[account]?.totalMinor ?? 0) : null;
  const amountMinor = Math.round((Number(amount) || 0) * 100);
  const shortfall = availableMinor !== null ? amountMinor - availableMinor : 0;
  const unaffordable = availableMinor !== null && amountMinor > 0 && shortfall > 0;

  // One message, used for the live warning and for the submit-time guard.
  // Mirrors the server's wording so the operator sees the same explanation
  // whether they hit the block here or on submit.
  const shortMessage = useMemo(() => {
    if (!unaffordable) return '';
    if (availableMinor < 0) {
      return (
        `${account} is already overdrawn by ${formatMoney(Math.abs(availableMinor), business)}. ` +
        'Set the real opening balance on the Accountant screen before paying anything out.'
      );
    }
    return (
      `Not enough ${account}. You have ${formatMoney(availableMinor, business)}, ` +
      `this is ${formatMoney(amountMinor, business)} — ${formatMoney(shortfall, business)} short.`
    );
  }, [unaffordable, account, availableMinor, amountMinor, shortfall, business]);

  const pay = useApiMutation(
    (payload) => purchasesApi.addPayment(purchase._id, payload),
    {
      successMessage: 'Payment recorded',
      onSuccess: () => {
        toast.success('Supplier balance reduced');
        onPaid?.();
        onClose();
      },
    }
  );

  const run = () => {
    setError('');
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    if (Math.round(value * 100) > outstanding) {
      setError(`That is more than the ${formatMoney(outstanding, business)} still owed`);
      return;
    }
    if (shortMessage) {
      setError(shortMessage);
      return;
    }
    pay.mutate({
      amount: value,
      method,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pay supplier"
      description={
        purchase
          ? `${purchase.reference}${purchase.supplierName ? ` · ${purchase.supplierName}` : ''}`
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} loading={pay.isPending} disabled={outstanding <= 0}>
            Record payment
          </Button>
        </>
      }
    >
      {(error || pay.error) && (
        <Alert tone="danger" className="mb-4">
          {error ?? pay.error.message}
        </Alert>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
          <span className="text-ink-600">Still owed</span>
          <span className="tabular font-semibold text-ink-900">{formatMoney(outstanding, business)}</span>
        </div>

        <Field
          label="Amount to pay"
          htmlFor="pay-amount"
          required
          hint={outstanding > 0 ? 'Less than the full amount leaves a balance.' : undefined}
        >
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-ink-400" aria-hidden="true" />
            <Input
              id="pay-amount"
              className="tabular"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            />
            {outstanding > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAmount((outstanding / 100).toFixed(2))}
              >
                Full amount
              </Button>
            )}
          </div>
        </Field>

        <Field label="Method" htmlFor="pay-method" required>
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {(business?.paymentMethods ?? ['cash']).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </Select>
        </Field>

        {/* Say what the account holds before it is spent, so an impossible
            payment is obvious rather than a surprise rejection. */}
        {account && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-2xs text-ink-600">
            <span className="capitalize">{account}</span> holds{' '}
            <span className="tabular font-semibold text-ink-900">
              {availableMinor === null ? '…' : formatMoney(availableMinor, business)}
            </span>
          </p>
        )}

        {shortMessage && (
          <Alert tone="danger" data-testid="insufficient-funds">
            {shortMessage}
          </Alert>
        )}

        <Field label="Reference" htmlFor="pay-ref" hint="Cheque or transfer number.">
          <Input
            id="pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. CHQ-4471"
          />
        </Field>

        <Field label="Note" htmlFor="pay-note">
          <Textarea
            id="pay-note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
    </Modal>
  );
}
