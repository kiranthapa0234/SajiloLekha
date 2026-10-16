/**
 * Customer create / edit.
 * The opening balance requires a reason — an unexplained balance is how books
 * quietly stop agreeing with reality.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save } from 'lucide-react';
import { customerSchema, updateCustomerSchema } from '@shared/validators/index.js';
import { useCustomer, useApiMutation } from '@/hooks/useApi.js';
import { customers as customersApi } from '@/services/index.js';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Textarea } from '@/components/ui/index.jsx';

export default function CustomerFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { data: existing, isLoading } = useCustomer(id);

  const {
    register: bind,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(isEdit ? updateCustomerSchema : customerSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      customerCode: '',
      address: '',
      notes: '',
      creditLimit: '',
      openingBalance: '',
      openingBalanceType: 'debit',
      openingBalanceReason: '',
      isWalkIn: false,
    },
  });

  useEffect(() => {
    if (!existing || !isEdit) return;
    reset({
      name: existing.name ?? '',
      phone: existing.phone ?? '',
      email: existing.email ?? '',
      customerCode: existing.customerCode ?? '',
      address: existing.address ?? '',
      notes: existing.notes ?? '',
      creditLimit: existing.creditLimitMinor ? (existing.creditLimitMinor / 100).toFixed(2) : '',
      isWalkIn: existing.isWalkIn ?? false,
    });
  }, [existing, isEdit, reset]);

  const save = useApiMutation(
    (values) => (isEdit ? customersApi.update(id, values) : customersApi.create(values)),
    {
      successMessage: isEdit ? 'Customer updated' : 'Customer created',
      onSuccess: (customer) => navigate(customer?._id ? `/customers/${customer._id}` : '/customers'),
    }
  );

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      for (const [field, message] of Object.entries(error.fields ?? {})) {
        setError(field, { message });
      }
    }
  };

  const openingBalance = Number(watch('openingBalance') || 0);

  if (isEdit && isLoading) return <div className="p-6 text-sm text-ink-500">Loading customer…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header>
        <Button variant="ghost" size="sm" onClick={() => navigate('/customers')} className="-ml-2 mb-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to customers
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          {isEdit ? `Edit ${existing?.name ?? 'customer'}` : 'New customer'}
        </h1>
      </header>

      {save.error && <Alert tone="danger" title="Could not save">{save.error.message}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Contact" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="name" placeholder="Aarav Sharma" invalid={Boolean(errors.name)} {...bind('name')} />
            </Field>

            <Field label="Phone number" htmlFor="phone" required error={errors.phone?.message}>
              <Input id="phone" type="tel" placeholder="9800000000" invalid={Boolean(errors.phone)} {...bind('phone')} />
            </Field>

            <Field label="Email" htmlFor="email" error={errors.email?.message} hint="Optional">
              <Input id="email" type="email" placeholder="aarav@example.com" {...bind('email')} />
            </Field>

            <Field
              label="Customer code"
              htmlFor="customerCode"
              error={errors.customerCode?.message}
              hint="Unique within this workspace"
            >
              <Input id="customerCode" className="uppercase" placeholder="CUST-0001" {...bind('customerCode')} />
            </Field>

            <Field label="Address" htmlFor="address" error={errors.address?.message} className="sm:col-span-2">
              <Textarea id="address" placeholder="Street, city" rows={2} {...bind('address')} />
            </Field>

            {!isEdit && (
              <div className="sm:col-span-2">
                <Checkbox label="This is a walk-in customer" {...bind('isWalkIn')} />
                <p className="lk-hint">
                  Walk-in customers are excluded from the customer list totals but still receive invoices.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Account" subtitle="Credit and opening balance" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Credit limit"
              htmlFor="creditLimit"
              error={errors.creditLimit?.message}
              hint="Leave at 0 for no limit. Extra credit sales are flagged, not blocked."
            >
              <Input id="creditLimit" inputMode="decimal" className="tabular" placeholder="0.00" {...bind('creditLimit')} />
            </Field>

            {!isEdit && (
              <>
                <Field label="Opening balance" htmlFor="openingBalance" error={errors.openingBalance?.message}>
                  <Input id="openingBalance" inputMode="decimal" className="tabular" placeholder="0.00" {...bind('openingBalance')} />
                </Field>

                <Field label="Opening balance is" htmlFor="openingBalanceType">
                  <select id="openingBalanceType" className="lk-input" {...bind('openingBalanceType')}>
                    <option value="debit">Owed to you (debit)</option>
                    <option value="credit">You owe them (credit)</option>
                  </select>
                </Field>

                {openingBalance > 0 && (
                  <Field
                    label="Reason for the opening balance"
                    htmlFor="openingBalanceReason"
                    required
                    error={errors.openingBalanceReason?.message}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="openingBalanceReason"
                      placeholder="e.g. Migrated from the previous system"
                      {...bind('openingBalanceReason')}
                    />
                  </Field>
                )}
              </>
            )}

            <Field label="Notes" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
              <Textarea id="notes" placeholder="Anything worth remembering about this customer" {...bind('notes')} />
            </Field>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={isSubmitting || save.isPending}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {isEdit ? 'Save changes' : 'Create customer'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/customers')}>
            Cancel
          </Button>
          {isDirty && <span className="text-xs text-ink-400">Unsaved changes.</span>}
        </div>
      </form>
    </div>
  );
}
