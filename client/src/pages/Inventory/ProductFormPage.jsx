/**
 * Product create / edit.
 *
 * Validation uses the shared `productSchema` / `updateProductSchema`, so the
 * server's rules (SKU charset, barcode format, the opening-stock reason rule)
 * are the same ones the user sees inline.
 *
 * Stock is NOT editable here. It moves only through a recorded StockMovement,
 * which is why the quantity field disappears entirely in edit mode.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Info, Save } from 'lucide-react';
import { productSchema, updateProductSchema } from '@shared/validators/index.js';
import { UNITS_OF_MEASURE } from '@shared/constants.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useProduct, useApiMutation } from '@/hooks/useApi.js';
import { products as productsApi } from '@/services/index.js';
import { formatMoney } from '@/utils/format.js';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataPoint,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/index.jsx';
import CategorySelect from '@/components/CategorySelect.jsx';
import { useToast } from '@/hooks/useApi.js';

export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { business } = useAuth();

  const { data: existing, isLoading } = useProduct(id);
  const toast = useToast();
  const schema = isEdit ? updateProductSchema : productSchema;

  const {
    register: bind,
    handleSubmit,
    reset,
    watch,
    setError,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      sku: '',
      barcode: '',
      category: '',
      description: '',
      unit: 'pcs',
      costPrice: '',
      sellingPrice: '',
      taxPercent: '0',
      stockQuantity: '0',
      minStockLevel: '0',
      openingStockReason: '',
      isTrackable: true,
      isActive: true,
    },
  });

  useEffect(() => {
    if (!existing || !isEdit) return;
    reset({
      name: existing.name ?? '',
      sku: existing.sku ?? '',
      barcode: existing.barcode ?? '',
      category: existing.category?._id ?? '',
      description: existing.description ?? '',
      unit: existing.unit ?? 'pcs',
      costPrice: ((existing.costPriceMinor ?? 0) / 100).toFixed(2),
      sellingPrice: ((existing.sellingPriceMinor ?? 0) / 100).toFixed(2),
      taxPercent: String(existing.taxPercent ?? 0),
      minStockLevel: String(existing.minStockLevel ?? 0),
      isTrackable: existing.isTrackable ?? true,
      isActive: existing.isActive ?? true,
    });
  }, [existing, isEdit, reset]);

  const save = useApiMutation(
    (values) => (isEdit ? productsApi.update(id, values) : productsApi.create(values)),
    {
      successMessage: isEdit ? 'Product updated' : 'Product created',
      onSuccess: (product) => navigate(product?._id ? `/inventory/${product._id}/edit` : '/inventory'),
    }
  );

  const onSubmit = async (values) => {
    try {
      await save.mutateAsync(values);
    } catch (error) {
      for (const [field, message] of Object.entries(error.fields ?? {})) {
        setError(field, { message });
      }
      if (!error.fields) toast.error(error.message ?? 'The product could not be saved');
    }
  };

  const cost = Number(watch('costPrice') || 0);
  const price = Number(watch('sellingPrice') || 0);
  const margin = price - cost;
  const marginPercent = price > 0 ? (margin / price) * 100 : 0;

  if (isEdit && isLoading) {
    return <div className="p-6 text-sm text-ink-500">Loading product…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <Button variant="ghost" size="sm" onClick={() => navigate('/inventory')} className="-ml-2 mb-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to inventory
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          {isEdit ? `Edit ${existing?.name ?? 'product'}` : 'New product'}
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {isEdit
            ? 'Stock changes are recorded separately so every movement has a reason.'
            : 'Set the opening details. Stock can only change through a recorded movement.'}
        </p>
      </header>

      {save.error && <Alert tone="danger" title="Could not save">{save.error.message}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Details" subtitle="How this product appears on invoices" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="name" placeholder="e.g. Cotton T-shirt" invalid={Boolean(errors.name)} {...bind('name')} />
            </Field>

            <Field label="SKU" htmlFor="sku" required error={errors.sku?.message} hint="Unique within this workspace">
              <Input
                id="sku"
                placeholder="TS-001"
                className="uppercase"
                invalid={Boolean(errors.sku)}
                {...bind('sku')}
              />
            </Field>

            <Field label="Barcode" htmlFor="barcode" error={errors.barcode?.message} hint="Letters, numbers and hyphens">
              <Input id="barcode" placeholder="9801234567890" invalid={Boolean(errors.barcode)} {...bind('barcode')} />
            </Field>

            <Field label="Unit of measure" htmlFor="unit" error={errors.unit?.message}>
              <Select id="unit" {...bind('unit')}>
                {UNITS_OF_MEASURE.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Category" htmlFor="category" error={errors.category?.message}>
              <CategorySelect
                id="category"
                value={watch('category')}
                onChange={(value) => setValue('category', value, { shouldDirty: true })}
              />
            </Field>

            <Field label="Description" htmlFor="description" error={errors.description?.message} className="sm:col-span-2">
              <Textarea
                id="description"
                placeholder="Snapshotted onto every invoice, so keep it useful."
                {...bind('description')}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Pricing" subtitle="Stored as integer minor units to avoid rounding drift" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Purchase cost" htmlFor="costPrice" required error={errors.costPrice?.message}>
              <Input
                id="costPrice"
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
                invalid={Boolean(errors.costPrice)}
                {...bind('costPrice')}
              />
            </Field>

            <Field label="Selling price" htmlFor="sellingPrice" required error={errors.sellingPrice?.message}>
              <Input
                id="sellingPrice"
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
                invalid={Boolean(errors.sellingPrice)}
                {...bind('sellingPrice')}
              />
            </Field>

            <Field label="Tax %" htmlFor="taxPercent" error={errors.taxPercent?.message}>
              <Input
                id="taxPercent"
                inputMode="decimal"
                className="tabular"
                {...bind('taxPercent')}
              />
            </Field>

            {price > 0 && (
              <div className="sm:col-span-3">
                <Alert tone={margin >= 0 ? 'success' : 'warning'} className="flex items-center gap-2">
                  <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Margin {formatMoney(Math.round(margin * 100), business)} per unit ({marginPercent.toFixed(1)}%)
                    {margin < 0 && ' — this product sells below cost.'}
                  </span>
                </Alert>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Stock"
            subtitle={isEdit ? 'Read-only here — use a stock adjustment to change it' : 'Opening quantity'}
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {isEdit ? (
              <div className="sm:col-span-2">
                <Alert tone="info">
                  Stock is currently{' '}
                  <strong className="tabular">
                    {existing?.stockQuantity} {existing?.unit}
                  </strong>
                  . Change it from the inventory list with a recorded reason — every adjustment is
                  written to the movement ledger for audit.
                </Alert>
              </div>
            ) : (
              <>
                <Field
                  label="Opening stock"
                  htmlFor="stockQuantity"
                  error={errors.stockQuantity?.message}
                  hint="Leave at 0 if the product has no stock yet"
                >
                  <Input id="stockQuantity" inputMode="decimal" className="tabular" {...bind('stockQuantity')} />
                </Field>

                <Field
                  label="Reason for opening stock"
                  htmlFor="openingStockReason"
                  required={Number(watch('stockQuantity') || 0) > 0}
                  error={errors.openingStockReason?.message}
                  hint="Only for stock you already had. Bought stock is recorded on the Purchases screen, so its cost is tracked properly."
                >
                  <Input
                    id="openingStockReason"
                    placeholder="e.g. Opening inventory count"
                    {...bind('openingStockReason')}
                  />
                </Field>
              </>
            )}

            <Field label="Minimum stock level" htmlFor="minStockLevel" error={errors.minStockLevel?.message} hint="Below this, the product is flagged as low">
              <Input id="minStockLevel" inputMode="decimal" className="tabular" {...bind('minStockLevel')} />
            </Field>

            <Field label="Track stock" htmlFor="isTrackable" hint="Turn off for services you do not hold">
              <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-ink-700">
                <input
                  id="isTrackable"
                  type="checkbox"
                  className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                  {...bind('isTrackable')}
                />
                Track quantity for this product
              </label>
            </Field>
          </CardBody>
        </Card>

        {isEdit && existing && (
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <DataPoint label="On hand" value={`${existing.stockQuantity} ${existing.unit}`} />
                <DataPoint label="Stock value" value={formatMoney(existing.stockValueMinor, business)} />
                <DataPoint label="Margin" value={`${existing.marginPercent}%`} />
                <DataPoint label="Status" value={existing.stockStatus?.replace(/_/g, ' ')} />
              </dl>
            </CardBody>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={isSubmitting || save.isPending} disabled={!isDirty && isEdit}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory')}>
            Cancel
          </Button>
          {isDirty && <span className="text-xs text-ink-400">You have unsaved changes.</span>}
        </div>
      </form>
    </div>
  );
}
