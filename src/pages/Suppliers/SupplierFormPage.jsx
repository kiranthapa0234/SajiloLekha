/**
 * Supplier create / edit.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save } from 'lucide-react';
import { supplierSchema, updateSupplierSchema } from '@shared/validators/index.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { useApiMutation } from '@/hooks/useApi.js';
import { suppliers as suppliersApi } from '@/services/index.js';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Spinner, Textarea } from '@/components/ui/index.jsx';

export default function SupplierFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { businessId } = useBusinessId();
  const navigate = useNavigate();
  const { business } = useAuth();

  const { data: existing, isLoading } = useQuery({
    queryKey: ['supplier', businessId, id],
    queryFn: () => suppliersApi.get(id),
    enabled: Boolean(businessId && id),
  });

  const {
    register: bind,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(isEdit ? updateSupplierSchema : supplierSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      contactPerson: '',
      address: '',
      taxNumber: '',
      notes: '',
      openingBalance: '',
      openingBalanceType: 'credit',
      openingBalanceReason: '',
    },
  });

  useEffect(() => {
    if (!existing || !isEdit) return;
    reset({
      name: existing.name ?? '',
      phone: existing.phone ?? '',
      email: existing.email ?? '',
      contactPerson: existing.contactPerson ?? '',
      address: existing.address ?? '',
      taxNumber: existing.taxNumber ?? '',
      notes: existing.notes ?? '',
    });
  }, [existing, isEdit, reset]);

  const save = useApiMutation(
    (values) => (isEdit ? suppliersApi.update(id, values) : suppliersApi.create(values)),
    {
      successMessage: isEdit ? 'Supplier updated' : 'Supplier created',
      onSuccess: () => navigate('/suppliers'),
    }
  );

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      for (const [field, message] of Object.entries(error.fields ?? {})) setError(field, { message });
    }
  };

  if (isEdit && isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header>
        <Button variant="ghost" size="sm" onClick={() => navigate('/suppliers')} className="-ml-2 mb-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to suppliers
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          {isEdit ? `Edit ${existing?.name ?? 'supplier'}` : 'New supplier'}
        </h1>
      </header>

      {save.error && <Alert tone="danger" title="Could not save">{save.error.message}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Contact" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="name" placeholder="Bharat Distributors" invalid={Boolean(errors.name)} {...bind('name')} />
            </Field>
            <Field label="Phone number" htmlFor="phone" required error={errors.phone?.message}>
              <Input id="phone" type="tel" placeholder="9800000000" invalid={Boolean(errors.phone)} {...bind('phone')} />
            </Field>
            <Field label="Contact person" htmlFor="contactPerson" error={errors.contactPerson?.message}>
              <Input id="contactPerson" placeholder="Ramesh Shrestha" {...bind('contactPerson')} />
            </Field>
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input id="email" type="email" {...bind('email')} />
            </Field>
            <Field label="Tax / VAT number" htmlFor="taxNumber" error={errors.taxNumber?.message}>
              <Input id="taxNumber" {...bind('taxNumber')} />
            </Field>
            <Field label="Address" htmlFor="address" error={errors.address?.message} className="sm:col-span-2">
              <Textarea id="address" rows={2} {...bind('address')} />
            </Field>
            <Field label="Notes" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
              <Textarea id="notes" {...bind('notes')} />
            </Field>
          </CardBody>
        </Card>

        {!isEdit && (
          <Card>
            <CardHeader title="Opening balance" subtitle="What you already owed this supplier" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" htmlFor="openingBalance" error={errors.openingBalance?.message}>
                <Input id="openingBalance" inputMode="decimal" className="tabular" placeholder="0.00" {...bind('openingBalance')} />
              </Field>
              <Field label="Direction" htmlFor="openingBalanceType">
                <select id="openingBalanceType" className="lk-input" {...bind('openingBalanceType')}>
                  <option value="credit">You owe them</option>
                  <option value="debit">They owe you</option>
                </select>
              </Field>
              <Field label="Reason" htmlFor="openingBalanceReason" error={errors.openingBalanceReason?.message} className="sm:col-span-2">
                <Input id="openingBalanceReason" placeholder="e.g. Carried over from the previous system" {...bind('openingBalanceReason')} />
              </Field>
            </CardBody>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={isSubmitting || save.isPending}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {isEdit ? 'Save changes' : 'Create supplier'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/suppliers')}>
            Cancel
          </Button>
          {isDirty && <span className="text-xs text-ink-400">Unsaved changes.</span>}
        </div>
      </form>

      <span className="sr-only">
        Currency: {business?.currency} · workspace {businessId}
      </span>
    </div>
  );
}
