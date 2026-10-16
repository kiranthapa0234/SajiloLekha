/**
 * Move money between the till and the bank, or add/take money outright.
 *
 * A transfer writes two ledger rows that share a group id, so the pair is
 * always identifiable and the total never changes. Adding or taking money out
 * changes the total, and is deliberately a separate, explicit act.
 */
import { useState } from 'react';
import { ArrowLeftRight, Landmark, Wallet } from 'lucide-react';

import { MONEY_ACCOUNT_LABELS } from '@shared/constants.js';
import { useApiMutation, useToast } from '@/hooks/useApi.js';
import { money as moneyApi } from '@/services/index.js';
import { Alert, Button, Field, Input, Modal, Select } from '@/components/ui/index.jsx';
import { formatMoney } from '@/utils/format.js';

const ACCOUNTS = ['cash', 'bank'];
const TABS = [
  { value: 'transfer', label: 'Between cash and bank' },
  { value: 'add', label: 'Add money' },
  { value: 'withdraw', label: 'Take money out' },
];

export default function MoveMoneyModal({ open, onClose, onSaved, balances, business }) {
  const toast = useToast();
  const [tab, setTab] = useState('transfer');
  const [from, setFrom] = useState('cash');
  const [to, setTo] = useState('bank');
  const [account, setAccount] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = useApiMutation(
    (payload) => {
      if (payload.__add) return moneyApi.add(payload);
      if (payload.__out) return moneyApi.remove(payload);
      return moneyApi.transfer(payload);
    },
    {
      successMessage: 'Recorded in the money ledger',
      onSuccess: () => {
        toast.success('Balance updated');
        onSaved?.();
        onClose();
      },
    }
  );

  const available = (name) => balances?.accounts?.[name]?.totalMinor ?? 0;

  const run = () => {
    setError('');
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    if (reason.trim().length < 3) {
      setError('A reason is required — it is written into the permanent ledger');
      return;
    }
    if (tab === 'transfer' && from === to) {
      setError('Choose two different accounts');
      return;
    }
    const base = { amount: value, reason: reason.trim() };
    if (tab === 'transfer') {
      if (value * 100 > available(from)) {
        setError(`Not enough ${MONEY_ACCOUNT_LABELS[from].toLowerCase()} to move that much`);
        return;
      }
      submit.mutate({ ...base, from, to });
      return;
    }
    if (tab === 'withdraw') {
      if (value * 100 > available(account)) {
        setError(`Not enough ${MONEY_ACCOUNT_LABELS[account].toLowerCase()} to take that much out`);
        return;
      }
      submit.mutate({ ...base, account, kind: 'withdrawal', __out: true });
      return;
    }
    submit.mutate({ ...base, account, kind: 'deposit', __add: true });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move money"
      description="Balances are derived from the ledger, so every movement is recorded with a reason."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} loading={submit.isPending}>
            Record
          </Button>
        </>
      }
    >
      {(error || submit.error) && (
        <Alert tone="danger" className="mb-4">
          {error ?? submit.error.message}
        </Alert>
      )}

      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`flex-1 rounded-md px-2 py-1.5 text-2xs font-medium transition-colors ${
                tab === t.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'transfer' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <Field label="From" htmlFor="mv-from">
                <Select id="mv-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {ACCOUNTS.map((a) => (
                    <option key={a} value={a}>
                      {MONEY_ACCOUNT_LABELS[a]}
                    </option>
                  ))}
                </Select>
              </Field>
              <ArrowLeftRight className="mx-auto mb-2 hidden h-4 w-4 text-ink-400 sm:block" aria-hidden="true" />
              <Field label="To" htmlFor="mv-to">
                <Select id="mv-to" value={to} onChange={(e) => setTo(e.target.value)}>
                  {ACCOUNTS.map((a) => (
                    <option key={a} value={a}>
                      {MONEY_ACCOUNT_LABELS[a]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="text-2xs text-ink-500">
              {MONEY_ACCOUNT_LABELS[from]}: <strong className="tabular">{formatMoney(available(from), business)}</strong>
              {' · '}
              {MONEY_ACCOUNT_LABELS[to]}: <strong className="tabular">{formatMoney(available(to), business)}</strong>
            </p>
          </>
        ) : (
          <Field label="Account" htmlFor="mv-account">
            <Select id="mv-account" value={account} onChange={(e) => setAccount(e.target.value)}>
              {ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {MONEY_ACCOUNT_LABELS[a]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Amount"
          htmlFor="mv-amount"
          required
          hint={tab === 'add' ? 'Money coming in from outside the business.' : undefined}
        >
          <div className="flex items-center gap-2">
            {tab === 'add' ? (
              <Wallet className="h-4 w-4 text-ink-400" aria-hidden="true" />
            ) : tab === 'withdraw' ? (
              <Wallet className="h-4 w-4 text-ink-400" aria-hidden="true" />
            ) : (
              <Landmark className="h-4 w-4 text-ink-400" aria-hidden="true" />
            )}
            <Input
              id="mv-amount"
              className="tabular"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
            />
          </div>
        </Field>

        <Field label="Reason" htmlFor="mv-reason" required hint="Permanent. Recorded against your name.">
          <Input
            id="mv-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tab === 'transfer' ? 'Cash into the bank' : tab === 'add' ? 'Owner capital' : 'Personal withdrawal'}
          />
        </Field>
      </div>
    </Modal>
  );
}
