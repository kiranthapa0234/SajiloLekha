/**
 * Workspace settings: identity, tax, invoicing and accounting policy.
 *
 * The accounting basis is stated in plain language because it changes what
 * "net profit" means. Switching it is a significant decision, so it is called
 * out rather than buried in a dropdown.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Save } from 'lucide-react';
import { updateBusinessSchema } from '@shared/validators/index.js';
import { PAYMENT_METHOD_LABELS, SUPPORTED_CURRENCIES, currencyMeta } from '@shared/constants.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useApiMutation } from '@/hooks/useApi.js';
import { businesses as businessesApi } from '@/services/index.js';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Spinner, Textarea } from '@/components/ui/index.jsx';

export default function SettingsPage() {
  const { business, refreshWorkspaces, can } = useAuth();

  const {
    register: bind,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(updateBusinessSchema),
    mode: 'onTouched',
    defaultValues: {},
  });

  useEffect(() => {
    if (!business) return;
    reset({
      name: business.name ?? '',
      legalName: business.legalName ?? '',
      registrationNumber: business.registrationNumber ?? '',
      taxNumber: business.taxNumber ?? '',
      email: business.email ?? '',
      phone: business.phone ?? '',
      address: {
        line1: business.address?.line1 ?? '',
        line2: business.address?.line2 ?? '',
        city: business.address?.city ?? '',
        state: business.address?.state ?? '',
        postalCode: business.address?.postalCode ?? '',
        country: business.address?.country ?? '',
      },
      settings: {
        currency: business.currency ?? 'NPR',
        currencySymbol: business.currencySymbol ?? 'Rs.',
        timezone: business.timezone ?? 'Asia/Kathmandu',
        locale: business.locale ?? 'en-NP',
        taxEnabled: business.taxEnabled ?? false,
        taxRatePercent: String(business.taxRatePercent ?? 0),
        taxLabel: business.taxLabel ?? 'VAT',
        invoicePrefix: business.invoicePrefix ?? 'INV',
        invoiceDueDays: String(business.invoiceDueDays ?? 0),
        allowNegativeStock: business.allowNegativeStock ?? false,
        lowStockAlerts: business.lowStockAlerts ?? true,
        maxDiscountPercent: String(business.maxDiscountPercent ?? 20),
        receiptFooter: business.receiptFooter ?? '',
        terms: business.terms ?? '',
      },
    });
  }, [business, reset]);

  const save = useApiMutation((values) => businessesApi.update(values), {
    successMessage: 'Settings saved',
    onSuccess: async () => {
      await refreshWorkspaces();
      window.dispatchEvent(new CustomEvent('lekhapana:session'));
    },
  });

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      for (const [field, message] of Object.entries(error.fields ?? {})) setError(field, { message });
    }
  };

  const currency = watch('settings')?.currency ?? 'NPR';
  const meta = currencyMeta(currency);
  const taxEnabled = watch('settings')?.taxEnabled;

  const readOnly = !can('settings:write');

  if (!business) {
    return (
      <div className="flex justify-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Workspace settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          How {business.name} appears on invoices, and how its books are calculated.
        </p>
      </header>

      {readOnly && (
        <Alert tone="info">You can view these settings but only an administrator can change them.</Alert>
      )}
      {save.error && <Alert tone="danger" title="Could not save">{save.error.message}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Business identity" subtitle="Printed on every invoice" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="set-name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="set-name" disabled={readOnly} {...bind('name')} />
            </Field>

            <Field label="Legal name" htmlFor="set-legal" error={errors.legalName?.message}>
              <Input id="set-legal" disabled={readOnly} {...bind('legalName')} />
            </Field>

            <Field label="Registration number" htmlFor="set-reg" error={errors.registrationNumber?.message}>
              <Input id="set-reg" disabled={readOnly} {...bind('registrationNumber')} />
            </Field>

            <Field label="Business email" htmlFor="set-email" error={errors.email?.message}>
              <Input id="set-email" type="email" disabled={readOnly} {...bind('email')} />
            </Field>

            <Field label="Phone" htmlFor="set-phone" error={errors.phone?.message}>
              <Input id="set-phone" type="tel" disabled={readOnly} {...bind('phone')} />
            </Field>

            <Field label="Address" htmlFor="set-addr1" error={errors.address?.line1?.message} className="sm:col-span-2">
              <Input id="set-addr1" placeholder="Street" disabled={readOnly} {...bind('address.line1')} />
            </Field>

            <Field label="City" htmlFor="set-city" error={errors.address?.city?.message}>
              <Input id="set-city" disabled={readOnly} {...bind('address.city')} />
            </Field>

            <Field label="Postal code" htmlFor="set-postal" error={errors.address?.postalCode?.message}>
              <Input id="set-postal" disabled={readOnly} {...bind('address.postalCode')} />
            </Field>

            <Field label="Tax / VAT number" htmlFor="set-tax" error={errors.taxNumber?.message}>
              <Input id="set-tax" disabled={readOnly} {...bind('taxNumber')} />
            </Field>

            <Field label="Logo URL" htmlFor="set-logo" error={errors.logoUrl?.message}>
              <Input id="set-logo" type="url" placeholder="https://…" disabled={readOnly} {...bind('logoUrl')} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Currency & region" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Currency"
              htmlFor="set-currency"
              hint={`Symbol ${meta.symbol}, ${meta.decimals} decimal places`}
              error={errors.settings?.currency?.message}
            >
              <select
                id="set-currency"
                className="lk-input"
                disabled={readOnly}
                onChange={(e) => {
                  const chosen = currencyMeta(e.target.value);
                  setValue('settings.currency', e.target.value, { shouldDirty: true });
                  setValue('settings.currencySymbol', chosen.symbol, { shouldDirty: true });
                  setValue('settings.locale', chosen.locale, { shouldDirty: true });
                }}
                {...bind('settings.currency')}
              >
                {SUPPORTED_CURRENCIES.filter((c) => c.code !== 'NPR_rupee').map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Time zone" htmlFor="set-tz" error={errors.settings?.timezone?.message}>
              <Input id="set-tz" disabled={readOnly} {...bind('settings.timezone')} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tax" subtitle="Tax collected is a liability, never income" />
          <CardBody className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                id="set-tax-enabled"
                type="checkbox"
                disabled={readOnly}
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                {...bind('settings.taxEnabled')}
              />
              Charge tax on sales
            </label>

            {taxEnabled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tax rate (%)" htmlFor="set-tax-rate" error={errors.settings?.taxRatePercent?.message}>
                  <Input
                    id="set-tax-rate"
                    inputMode="decimal"
                    className="tabular"
                    disabled={readOnly}
                    {...bind('settings.taxRatePercent')}
                  />
                </Field>
                <Field label="Tax label" htmlFor="set-tax-label" error={errors.settings?.taxLabel?.message}>
                  <Input id="set-tax-label" disabled={readOnly} {...bind('settings.taxLabel')} />
                </Field>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Invoicing" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice prefix" htmlFor="set-prefix" error={errors.settings?.invoicePrefix?.message}>
              <Input id="set-prefix" disabled={readOnly} {...bind('settings.invoicePrefix')} />
            </Field>

            <Field
              label="Payment terms (days)"
              htmlFor="set-terms"
              hint="0 means payable on receipt — such invoices never become overdue."
              error={errors.settings?.invoiceDueDays?.message}
            >
              <Input
                id="set-terms"
                inputMode="numeric"
                className="tabular"
                disabled={readOnly}
                {...bind('settings.invoiceDueDays')}
              />
            </Field>

            <Field label="Receipt footer" htmlFor="set-footer" error={errors.settings?.receiptFooter?.message} className="sm:col-span-2">
              <Input id="set-footer" disabled={readOnly} {...bind('settings.receiptFooter')} />
            </Field>

            <Field label="Terms and conditions" htmlFor="set-terms-text" error={errors.settings?.terms?.message} className="sm:col-span-2">
              <Textarea id="set-terms-text" disabled={readOnly} {...bind('settings.terms')} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Stock policy" />
          <CardBody className="space-y-4">
            <label className="flex items-start gap-2 text-sm text-ink-700">
              <input
                id="set-negative"
                type="checkbox"
                disabled={readOnly}
                className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                {...bind('settings.allowNegativeStock')}
              />
              <span>
                Allow stock to go negative
                <span className="mt-0.5 block text-2xs text-ink-500">
                  Off by default. Leaving it off means a sale can never sell stock you do not have.
                </span>
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                id="set-lowstock"
                type="checkbox"
                disabled={readOnly}
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                {...bind('settings.lowStockAlerts')}
              />
              Show low-stock alerts
            </label>

            <Field
              label="Maximum discount (%)"
              htmlFor="set-max-disc"
              hint="Applies to every role unless a member is granted a specific override."
              error={errors.settings?.maxDiscountPercent?.message}
            >
              <Input
                id="set-max-disc"
                inputMode="decimal"
                className="tabular"
                disabled={readOnly}
                {...bind('settings.maxDiscountPercent')}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Accounting basis" />
          <CardBody>
            <Alert tone="info" title="Accrual (recommended)">
              <span className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Revenue is recorded when a sale happens, regardless of when cash arrives. Stock purchases
                  capitalise into inventory and become an expense only when the stock is sold. This is the only
                  basis under which net profit is meaningful when you sell on credit.
                </span>
              </span>
            </Alert>
            <p className="mt-3 text-2xs text-ink-400">
              Cash collected is reported separately and is never used to calculate profit.
              Payment methods enabled for this workspace:{' '}
              {(business.paymentMethods ?? []).map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(', ')}.
            </p>
          </CardBody>
        </Card>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={isSubmitting || save.isPending} disabled={!isDirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save settings
            </Button>
            {isDirty && <span className="text-xs text-ink-400">Unsaved changes.</span>}
          </div>
        )}
      </form>
    </div>
  );
}
