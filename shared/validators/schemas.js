import { z } from 'zod';
import {
  dateRangeBaseSchema,
  emailInput,
  idempotencyKey,
  moneyInput,
  optionalMoney,
  nameInput,
  objectId,
  objectIdOrNull,
  optionalDate,
  optionalEmail,
  optionalPhone,
  paginationSchema,
  passwordInput,
  percentInput,
  phoneInput,
  positiveMoneyInput,
  quantityInput,
  requiredShortText,
  shortText,
} from './primitives.js';
import {
  EXPENSE_CATEGORIES,
  MONEY_ACCOUNTS,
  MONEY_KINDS,
  PAYMENT_METHODS,
  ROLES,
  UNITS_OF_MEASURE,
} from '../constants.js';

/* ------------------------------------------------------------------ AUTH -- */

export const registerSchema = z.object({
  name: nameInput,
  email: emailInput,
  password: passwordInput,
  confirmPassword: z.string().optional(),
  phone: optionalPhone,
  businessName: z
    .string()
    .trim()
    .min(2, 'Business name is required')
    .max(120, 'Business name is too long'),
  businessCurrency: z.string().trim().max(8).default('NPR'),
  businessTimezone: z.string().trim().max(64).default('Asia/Kathmandu'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }).optional(),
});

export const loginSchema = z.object({
  email: emailInput,
  password: z.string().min(1, 'Password is required').max(128),
  businessId: objectIdOrNull.optional(),
  remember: z.coerce.boolean().default(false),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const logoutSchema = z.object({
  allDevices: z.coerce.boolean().default(false),
});

export const forgotPasswordSchema = z.object({ email: emailInput });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Reset token is required'),
  password: passwordInput,
  confirmPassword: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordInput,
    confirmPassword: z.string().optional(),
    revokeOtherSessions: z.coerce.boolean().default(true),
  })
  .refine((v) => !v.confirmPassword || v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  name: nameInput.optional(),
  phone: optionalPhone,
  avatarUrl: z.union([z.string().url().max(500), z.literal(''), z.null()]).optional(),
  locale: z.string().trim().max(16).optional(),
});

/* -------------------------------------------------------------- BUSINESS -- */

const settingsSchema = z.object({
  currency: z.string().trim().max(8),
  currencySymbol: z.string().trim().max(8),
  currencyDecimals: z.coerce.number().int().min(0).max(3),
  locale: z.string().trim().max(16),
  timezone: z.string().trim().max(64),
  taxEnabled: z.boolean(),
  taxRatePercent: z.coerce.number().min(0).max(100),
  taxInclusive: z.boolean(),
  taxLabel: shortText(24, 'Tax label'),
  invoicePrefix: z
    .string()
    .trim()
    .min(1, 'Invoice prefix is required')
    .max(10)
    .regex(/^[A-Za-z0-9\-/]+$/, 'Use letters, numbers, - or / only'),
  invoiceNumberPadding: z.coerce.number().int().min(0).max(10).default(5),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, 'Select at least one payment method'),
  invoiceDueDays: z.coerce.number().int().min(0).max(365),
  allowNegativeStock: z.boolean(),
  lowStockAlerts: z.boolean(),
  receiptFooter: shortText(300, 'Footer'),
  terms: shortText(2000, 'Terms'),
});

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  registrationNumber: z.string().trim().max(60).optional(),
  taxNumber: z.string().trim().max(60).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  website: z.union([z.string().url().max(200), z.literal(''), z.null()]).optional(),
  address: z
    .object({
      line1: shortText(160, 'Address'),
      line2: shortText(160, 'Address'),
      city: shortText(80, 'City'),
      state: shortText(80, 'State'),
      postalCode: shortText(20, 'Postal code'),
      country: shortText(80, 'Country'),
    })
    .partial()
    .optional(),
  logoUrl: z.union([z.string().url().max(500), z.literal(''), z.null()]).optional(),
  currency: z.string().trim().max(8).default('NPR'),
  timezone: z.string().trim().max(64).default('Asia/Kathmandu'),
  settings: settingsSchema.partial().optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'No changes supplied' }
);

export const inviteMemberSchema = z.object({
  email: emailInput,
  name: nameInput,
  role: z.enum(ROLES).default('staff'),
  phone: optionalPhone,
});

export const updateMemberSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  permissionOverrides: z
    .object({
      allow: z.array(z.string().max(60)).max(50).default([]),
      deny: z.array(z.string().max(60)).max(50).default([]),
    })
    .optional(),
});

export const switchBusinessSchema = z.object({ businessId: objectId });

/* --------------------------------------------------------------- PRODUCT -- */

export const productCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z
    .string()
    .trim()
    .max(24)
    .regex(/^[A-Za-z0-9\-_]*$/, 'Use letters, numbers, - or _ only')
    .optional(),
  description: shortText(300, 'Description'),
  parent: objectIdOrNull.optional(),
  color: z
    .string()
    .trim()
    .regex(/^#([a-f\d]{6})$/i, 'Use a hex colour like #7657E8')
    .optional(),
});

export const updateProductCategorySchema = productCategorySchema.partial();

export const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Product name is required').max(160),
    sku: z
      .string()
      .trim()
      .min(1, 'SKU is required')
      .max(64)
      .regex(/^[A-Za-z0-9._\-/]+$/, 'Use letters, numbers, . - _ or / only'),
    barcode: z
      .string()
      .trim()
      .max(64)
      .regex(/^[A-Za-z0-9-]*$/, 'Barcode may contain letters, numbers and - only')
      .optional()
      .or(z.literal('')),
    category: objectIdOrNull.optional(),
    description: shortText(1000, 'Description'),
    unit: z.enum(UNITS_OF_MEASURE).default('pcs'),
    costPrice: moneyInput,
    sellingPrice: moneyInput,
    taxPercent: percentInput.default(0),
    stockQuantity: nonNegativeNumber(0),
    minStockLevel: nonNegativeNumber(0),
    maxStockLevel: nonNegativeNumber(0).optional(),
    supplier: objectIdOrNull.optional(),
    imageUrl: z.union([z.string().url().max(500), z.literal(''), z.null()]).optional(),
    openingStockReason: shortText(280, 'Reason').optional(),
    isTrackable: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.stockQuantity > 0 && !v.openingStockReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['openingStockReason'],
        message: 'A reason is required when adding opening stock',
      });
    }
    if (v.maxStockLevel !== undefined && v.minStockLevel !== undefined && v.maxStockLevel > 0 && v.maxStockLevel < v.minStockLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxStockLevel'],
        message: 'Maximum stock must be at least the minimum level',
      });
    }
  });

export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._\-/]+$/, 'Use letters, numbers, . - _ or / only')
    .optional(),
  barcode: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9-]*$/, 'Invalid barcode')
    .optional()
    .or(z.literal('')),
  category: objectIdOrNull.optional(),
  description: shortText(1000, 'Description').optional(),
  unit: z.enum(UNITS_OF_MEASURE).optional(),
  costPrice: moneyInput.optional(),
  sellingPrice: moneyInput.optional(),
  taxPercent: percentInput.optional(),
  minStockLevel: nonNegativeNumber(0).optional(),
  maxStockLevel: nonNegativeNumber(0).optional(),
  supplier: objectIdOrNull.optional(),
  imageUrl: z.union([z.string().url().max(500), z.literal(''), z.null()]).optional(),
  isTrackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const productListSchema = paginationSchema.extend({
  category: objectIdOrNull.optional(),
  status: z.enum(['all', 'active', 'archived', 'in_stock', 'low_stock', 'out_of_stock']).default('all'),
  stockStatus: z.enum(['all', 'in_stock', 'low_stock', 'out_of_stock']).optional(),
  supplier: objectIdOrNull.optional(),
  includeArchived: z.coerce.boolean().default(false),
});

const stockAdjustmentBaseSchema = z.object({
  product: objectId,
  type: z.enum(['adjustment_in', 'adjustment_out', 'damage', 'recount', 'transfer']),
  quantity: z
    .union([z.string(), z.number()])
    .refine((v) => Number.isFinite(Number(v)), 'Enter a valid quantity')
    .refine((v) => Number(v) !== 0, 'Quantity cannot be zero'),
  reason: requiredShortText(280, 'Reason'),
  note: shortText(500, 'Note'),
  reference: shortText(80, 'Reference'),
  costPrice: moneyInput.optional(),
  occurredAt: optionalDate,
});

/** Quantity arrives as a string from the UI; normalise it once, server-side too. */
export const stockAdjustmentSchema = stockAdjustmentBaseSchema.transform((v) => ({
  ...v,
  quantity: Number(v.quantity),
}));

/**
 * Same payload for routes where the product id comes from the URL
 * (`POST /products/:id/stock`) rather than the body.
 */
export const stockAdjustmentPayloadSchema = stockAdjustmentBaseSchema
  .omit({ product: true })
  .transform((v) => ({ ...v, quantity: Number(v.quantity) }));

export const bulkStockAdjustmentSchema = z.object({
  items: z
    .array(stockAdjustmentBaseSchema.extend({ product: objectId.optional() }))
    .min(1, 'Add at least one adjustment')
    .max(100),
});

export const stockMovementQuerySchema = paginationSchema.extend({
  product: objectIdOrNull.optional(),
  type: z.enum([
    'opening',
    'purchase',
    'sale',
    'sale_return',
    'purchase_return',
    'adjustment_in',
    'adjustment_out',
    'damage',
    'transfer',
    'recount',
  ]).optional(),
  from: optionalDate,
  to: optionalDate,
});

/**
 * A non-negative number that a human may leave blank.
 *
 * `undefined` and `null` are part of the input union on purpose: without them a
 * blank field would fail the union before the transform ever ran, turning an
 * optional-with-default field into a de facto required one.
 */
function nonNegativeNumber(defaultValue = 0) {
  return z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => (v === '' || v === null || v === undefined ? defaultValue : Number(v)))
    .refine((v) => Number.isFinite(v), 'Enter a valid number')
    .refine((v) => v >= 0, 'Cannot be negative');
}

/* -------------------------------------------------------------- CUSTOMER -- */

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Customer name is required').max(160),
  phone: phoneInput,
  email: optionalEmail,
  customerCode: z
    .string()
    .trim()
    .max(24)
    .regex(/^[A-Za-z0-9._\-/]*$/, 'Use letters, numbers, . - _ or / only')
    .optional()
    .or(z.literal('')),
  address: shortText(300, 'Address'),
  notes: shortText(1000, 'Notes'),
  creditLimit: optionalMoney,
  openingBalance: optionalMoney,
  openingBalanceType: z.enum(['debit', 'credit']).default('debit'),
  openingBalanceReason: shortText(280, 'Reason'),
  isWalkIn: z.boolean().default(false),
  tags: z.array(z.string().trim().max(32)).max(10).default([]),
});

export const updateCustomerSchema = customerSchema
  .partial()
  .omit({ openingBalance: true })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const customerListSchema = paginationSchema.extend({
  status: z.enum(['all', 'active', 'archived', 'due', 'overdue']).default('all'),
  hasBalance: z.coerce.boolean().optional(),
});

export const customerStatementSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  format: z.enum(['json', 'pdf']).default('json'),
});

/* -------------------------------------------------------------- SUPPLIER -- */

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Supplier name is required').max(160),
  // Only the name is required. `z.string()` is required by default in Zod, so
  // these must be explicitly optional or a supplier with a name and nothing
  // else is rejected with "Required".
  contactPerson: z.string().trim().max(120).optional().or(z.literal('')),
  phone: optionalPhone,
  email: optionalEmail,
  address: shortText(300, 'Address'),
  taxNumber: z.string().trim().max(60).optional().or(z.literal('')),
  notes: shortText(1000, 'Notes'),
  openingBalance: optionalMoney,
  openingBalanceType: z.enum(['debit', 'credit']).default('credit'),
  openingBalanceReason: shortText(280, 'Reason'),
});

export const updateSupplierSchema = supplierSchema
  .partial()
  .omit({ openingBalance: true })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const supplierListSchema = paginationSchema.extend({
  status: z.enum(['all', 'active', 'archived', 'due']).default('all'),
});

/* ------------------------------------------------------------------ SALE -- */

const saleLineSchema = z.object({
  product: objectId,
  quantity: quantityInput,
  unitPrice: moneyInput.optional(),
  discountPercent: percentInput.default(0),
  discountAmount: moneyInput.optional(),
  note: shortText(280, 'Note'),
  /** Server resolves the authoritative product; these are display-only. */
  name: shortText(160, 'Product name').optional(),
});

export const createSaleSchema = z
  .object({
    customer: objectIdOrNull.optional(),
    customerName: z.string().trim().max(160).optional(),
    lines: z.array(saleLineSchema).min(1, 'Add at least one product').max(200),
    discountPercent: percentInput.default(0),
    discountAmount: moneyInput.optional(),
    taxPercent: percentInput.optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    payments: z
      .array(
        z.object({
          amount: positiveMoneyInput,
          method: z.enum(PAYMENT_METHODS),
          reference: shortText(80, 'Reference'),
          paidAt: optionalDate,
          note: shortText(280, 'Note'),
        })
      )
      .max(20)
      .default([]),
    invoiceStatus: z.enum(['unpaid', 'partial', 'paid']).default('paid'),
    dueDate: optionalDate,
    reference: shortText(80, 'Reference'),
    note: shortText(1000, 'Note'),
    channel: z.enum(['pos', 'online', 'manual']).default('pos'),
    soldAt: optionalDate,
    idempotencyKey,
  })
  .superRefine((v, ctx) => {
    if (v.invoiceStatus === 'paid' && v.payments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payments'],
        message: 'Add at least one payment or mark the invoice as unpaid',
      });
    }
    const discountBoth = v.discountAmount !== undefined && v.discountPercent > 0;
    if (discountBoth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountAmount'],
        message: 'Use either a percentage or a fixed amount, not both',
      });
    }
  });

export const updateSaleSchema = z.object({
  reference: shortText(80, 'Reference').optional(),
  note: shortText(1000, 'Note').optional(),
  dueDate: optionalDate,
  status: z.enum(['completed', 'cancelled']).optional(),
});

export const saleListSchema = paginationSchema.extend({
  status: z.enum([
    'all',
    'completed',
    'cancelled',
    'unpaid',
    'partial',
    'paid',
    'overdue',
  ]).default('all'),
  customer: objectIdOrNull.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  from: optionalDate,
  to: optionalDate,
  minTotal: moneyInput.optional(),
  maxTotal: moneyInput.optional(),
});

export const salePaymentSchema = z.object({
  amount: positiveMoneyInput,
  method: z.enum(PAYMENT_METHODS),
  reference: shortText(80, 'Reference'),
  paidAt: optionalDate,
  note: shortText(280, 'Note'),
  idempotencyKey,
});

export const refundSchema = z
  .object({
    amount: positiveMoneyInput,
    reason: requiredShortText(280, 'Reason'),
    method: z.enum(PAYMENT_METHODS).default('cash'),
    reference: shortText(80, 'Reference'),
    restock: z.boolean().default(true),
    restockReason: shortText(280, 'Reason'),
    lines: z
      .array(
        z.object({
          line: z.number().int().min(0),
          quantity: quantityInput,
        })
      )
      .max(200)
      .default([]),
    idempotencyKey,
  })
  .superRefine((v, ctx) => {
    if (v.restock && !v.restockReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restockReason'],
        message: 'A reason is required when returning stock',
      });
    }
  });

export const cancelSaleSchema = z.object({
  reason: requiredShortText(280, 'Reason'),
  restock: z.boolean().default(true),
  restockReason: shortText(280, 'Reason'),
});

/* -------------------------------------------------------------- PURCHASE -- */

const purchaseLineSchema = z.object({
  product: objectId,
  quantity: quantityInput,
  costPrice: moneyInput,
  sellingPrice: moneyInput.optional(),
  note: shortText(280, 'Note'),
});

export const createPurchaseSchema = z
  .object({
    supplier: objectIdOrNull.optional(),
    reference: shortText(80, 'Supplier invoice number'),
    purchasedAt: optionalDate,
    dueDate: optionalDate,
    lines: z.array(purchaseLineSchema).min(1, 'Add at least one product').max(200),
    taxPercent: percentInput.default(0),
    discountAmount: moneyInput.optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    payments: z
      .array(
        z.object({
          amount: positiveMoneyInput,
          method: z.enum(PAYMENT_METHODS),
          reference: shortText(80, 'Reference'),
          paidAt: optionalDate,
          note: shortText(280, 'Note'),
        })
      )
      .max(20)
      .default([]),
    note: shortText(1000, 'Note'),
    updateCostPrice: z.boolean().default(true),
    idempotencyKey,
  })
  .superRefine((v, ctx) => {
    const hasDiscount = v.discountAmount !== undefined;
    if (hasDiscount && v.taxPercent > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountAmount'],
        message: 'Discount and tax on a purchase cannot be combined — supply the net line total',
      });
    }
  });

export const purchaseListSchema = paginationSchema.extend({
  status: z.enum(['all', 'received', 'partial', 'paid', 'unpaid', 'cancelled']).default('all'),
  supplier: objectIdOrNull.optional(),
  from: optionalDate,
  to: optionalDate,
});

export const purchasePaymentSchema = salePaymentSchema.omit({ idempotencyKey: true });

/**
 * Stock going back to a supplier who refunded us.
 *
 * `refundAmount` is the money that came back, not a price: the supplier may
 * refund less than the goods were bought for. `purchase` is optional — without
 * it the whole refund lands in cash, which is the common case once the original
 * bill has already been settled.
 */
export const supplierReturnSchema = z.object({
  product: objectId,
  supplier: objectId,
  quantity: quantityInput,
  refundAmount: moneyInput,
  purchase: objectId.optional(),
  account: z.enum(MONEY_ACCOUNTS).default('cash'),
  reason: shortText(280, 'Reason'),
  reference: shortText(80, 'Credit note number'),
  note: shortText(1000, 'Note'),
});

/* --------------------------------------------------------------- EXPENSE -- */

const expenseBaseSchema = z.object({
  title: requiredShortText(160, 'Title'),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: positiveMoneyInput,
  spentAt: optionalDate,
  paymentMethod: z.enum(PAYMENT_METHODS),
  reference: shortText(80, 'Reference'),
  vendor: z.string().trim().max(160),
  notes: shortText(1000, 'Notes'),
  receiptUrl: z.union([z.string().url().max(500), z.literal(''), z.null()]).optional(),
  /** Expenses never affect stock; purchases do. */
  affectsInventory: z.boolean().default(false),
  recurring: z.boolean().default(false),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('none'),
});

export const expenseSchema = expenseBaseSchema.superRefine((v, ctx) => {
  if (v.affectsInventory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['affectsInventory'],
      message: 'Use the Purchases module to record inventory purchases',
    });
  }
});

export const updateExpenseSchema = expenseBaseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const expenseListSchema = paginationSchema.extend({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  from: optionalDate,
  to: optionalDate,
  minAmount: moneyInput.optional(),
  maxAmount: moneyInput.optional(),
});

/* --------------------------------------------------------------- PAYMENT -- */

export const paymentListSchema = paginationSchema.extend({
  status: z.enum(['all', 'valid', 'voided', 'refunded']).default('all'),
  method: z.enum(PAYMENT_METHODS).optional(),
  customer: objectIdOrNull.optional(),
  direction: z.enum(['all', 'inbound', 'outbound']).default('all'),
  from: optionalDate,
  to: optionalDate,
});

export const recordPaymentSchema = z
  .object({
    /** Exactly one of these identifies what is being settled. */
    sale: objectId.optional(),
    invoice: objectId.optional(),
    customer: objectIdOrNull.optional(),
    amount: positiveMoneyInput,
    method: z.enum(PAYMENT_METHODS),
    paidAt: optionalDate,
    transactionReference: shortText(80, 'Transaction reference'),
    notes: shortText(500, 'Notes'),
    idempotencyKey,
  })
  .superRefine((v, ctx) => {
    if (!v.sale && !v.invoice && !v.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invoice'],
        message: 'Link this payment to an invoice, a sale or a customer',
      });
    }
  });

export const voidPaymentSchema = z.object({
  reason: requiredShortText(280, 'Reason'),
});

/* --------------------------------------------------------------- INVOICE -- */

export const invoiceListSchema = paginationSchema.extend({
  status: z.enum([
    'all',
    'unpaid',
    'partial',
    'paid',
    'overdue',
    'cancelled',
  ]).default('all'),
  customer: objectIdOrNull.optional(),
  from: optionalDate,
  to: optionalDate,
  format: z.enum(['json', 'csv']).default('json'),
});

export const invoiceQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'pdf', 'print']).default('json'),
  copy: z.coerce.boolean().default(false),
  includePayments: z.coerce.boolean().default(true),
});

/* ---------------------------------------------------------------- REPORT -- */

export const reportQuerySchema = dateRangeBaseSchema
  .extend({
    format: z.enum(['json', 'csv', 'pdf']).default('json'),
    groupBy: z.enum(['day', 'week', 'month', 'quarter', 'year', 'weekday', 'none']).optional(),
    category: z.string().trim().max(32).optional(),
    customer: objectIdOrNull.optional(),
    supplier: objectIdOrNull.optional(),
    product: objectIdOrNull.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .transform((v) => {
    if (v.preset === 'all' || (!v.from && !v.to)) return { ...v, from: null, to: null };
    return v;
  })
  .refine((v) => !v.from || !v.to || v.from.getTime() <= v.to.getTime(), {
    message: 'Start date must be before end date',
    path: ['from'],
  });

/* --------------------------------------------------------------- DASHBOARD */

export const dashboardQuerySchema = dateRangeBaseSchema
  .extend({
    compare: z.coerce.boolean().default(true),
    limit: z.coerce.number().int().min(1).max(50).default(5),
  })
  .transform((v) => {
    if (v.preset === 'all' || (!v.from && !v.to)) return { ...v, from: null, to: null };
    return v;
  })
  .refine((v) => !v.from || !v.to || v.from.getTime() <= v.to.getTime(), {
    message: 'Start date must be before end date',
    path: ['from'],
  });

/* ------------------------------------------------------------------ AUDIT -- */

export const auditListSchema = paginationSchema.extend({
  action: z.string().trim().max(60).optional(),
  entity: z.string().trim().max(60).optional(),
  actor: objectIdOrNull.optional(),
  from: optionalDate,
  to: optionalDate,
});

/* -------------------------------------------------------------- MISC/API  -- */

export const idParamSchema = z.object({ id: objectId });

export const archiveQuerySchema = z.object({
  reason: shortText(280, 'Reason').optional(),
});

export const numericObjectId = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });

export const transferOwnershipSchema = z.object({
  confirm: z.literal('TRANSFER', { errorMap: () => ({ message: 'Type TRANSFER to confirm' }) }),
});

/* ----------------------------------------------------------------- MONEY -- */

/** Money amounts travel as human decimals and are converted once, server-side. */
/**
 * Money dates are accepted as a raw string and parsed by the service.
 *
 * `optionalDate` (a union wrapped in `.transform()`) proved unusable here:
 * through the validation middleware it rejected an absent key, an explicit
 * `null` and an unparseable string alike with "Path `occurredAt` is required",
 * while parsing cleanly in isolation. A plain nullable string with the
 * parsing done in one place is easier to reason about and to test.
 */
const moneyDate = z.union([z.string(), z.date()]).nullish();

export const moneyTransferSchema = z
  .object({
    from: z.enum(MONEY_ACCOUNTS),
    to: z.enum(MONEY_ACCOUNTS),
    amount: positiveMoneyInput,
    reason: requiredShortText(280, 'Reason'),
    occurredAt: moneyDate,
  })
  .refine((v) => v.from !== v.to, {
    path: ['to'],
    message: 'Choose two different accounts',
  });

export const moneyMovementSchema = z.object({
  account: z.enum(MONEY_ACCOUNTS),
  kind: z.enum(['opening', 'deposit', 'withdrawal']),
  amount: positiveMoneyInput,
  reason: requiredShortText(280, 'Reason'),
  occurredAt: moneyDate,
});

export const moneyListSchema = paginationSchema
  .extend({
    account: z.enum([...MONEY_ACCOUNTS, 'all']).default('all'),
    kind: z.enum([...MONEY_KINDS, 'all']).default('all'),
    from: optionalDate,
    to: optionalDate,
  })
  .transform((v) => ({
    ...v,
    account: v.account === 'all' ? undefined : v.account,
    kind: v.kind === 'all' ? undefined : v.kind,
  }));
