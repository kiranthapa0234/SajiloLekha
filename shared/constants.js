/**
 * Roles, permissions and business-level configuration defaults.
 * Shared by client (UI gating) and server (authorisation — the real gate).
 */

export const ROLES = /** @type {const} */ (['owner', 'admin', 'manager', 'staff']);

export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Administrator',
  manager: 'Manager',
  staff: 'Staff',
};

/** Ordered by authority, highest first. */
const ROLE_RANK = { owner: 4, admin: 3, manager: 2, staff: 1 };

export function roleRank(role) {
  return ROLE_RANK[role] ?? 0;
}

export function isAtLeast(role, minRole) {
  return roleRank(role) >= roleRank(minRole);
}

export const PERMISSIONS = /** @type {const} */ ([
  'dashboard:read',
  'sale:read',
  'sale:write',
  'sale:refund',
  'product:read',
  'product:write',
  'stock:adjust',
  'customer:read',
  'customer:write',
  'supplier:read',
  'supplier:write',
  'purchase:read',
  'purchase:write',
  'expense:read',
  'expense:write',
  'payment:read',
  'payment:write',
  'invoice:read',
  'invoice:cancel',
  'report:read',
  'report:export',
  'settings:read',
  'settings:write',
  'business:manage',
  'member:manage',
  'audit:read',
]);

/** Per-role capability matrix. Owner implicitly holds every permission. */
const ROLE_PERMISSIONS = {
  owner: new Set(PERMISSIONS),
  admin: new Set(
    PERMISSIONS.filter(
      (p) => !['business:manage'].includes(p) // business transfer/deletion stays owner-only
    )
  ),
  manager: new Set([
    'dashboard:read',
    'sale:read',
    'sale:write',
    'sale:refund',
    'product:read',
    'product:write',
    'stock:adjust',
    'customer:read',
    'customer:write',
    'supplier:read',
    'purchase:read',
    'purchase:write',
    'expense:read',
    'expense:write',
    'payment:read',
    'payment:write',
    'invoice:read',
    'report:read',
    'report:export',
    'settings:read',
  ]),
  staff: new Set([
    'dashboard:read',
    'sale:read',
    'sale:write',
    'product:read',
    'customer:read',
    'customer:write',
    'expense:read',
    'expense:write',
    'payment:read',
    'invoice:read',
  ]),
};

/** Optional per-member overrides, e.g. a cashier who may not issue refunds. */
export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

export function roleHasPermission(role, permission, overrides = null) {
  if (role === 'owner') return true;
  if (overrides && typeof overrides === 'object') {
    if (overrides.allow?.includes(permission)) return true;
    if (overrides.deny?.includes(permission)) return false;
  }
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function roleHasEveryPermission(role, permissions, overrides = null) {
  return permissions.every((p) => roleHasPermission(role, p, overrides));
}

export function roleHasSomePermission(role, permissions, overrides = null) {
  return permissions.some((p) => roleHasPermission(role, p, overrides));
}

export const PAYMENT_METHODS = /** @type {const} */ ([
  'cash',
  'bank_transfer',
  'card',
  'digital_wallet',
  'cheque',
  'credit',
]);

/* --------------------------------------------------------------- MONEY -- */

/**
 * The two pockets a business actually holds money in.
 *
 * Card, wallet and cheque settlements are counted against the bank because
 * that is where the money lands once the provider pays out. `credit` is
 * deliberately absent: nothing moves until the customer actually pays, so a
 * credit sale is a receivable, never a cash movement.
 */
export const MONEY_ACCOUNTS = /** @type {const} */ (['cash', 'bank']);

export const MONEY_ACCOUNT_LABELS = {
  cash: 'Cash',
  bank: 'Bank',
};

/** Which account a payment method settles into. */
export const PAYMENT_METHOD_ACCOUNT = {
  cash: 'cash',
  bank_transfer: 'bank',
  card: 'bank',
  digital_wallet: 'bank',
  cheque: 'bank',
};

/** Why money moved. Drives the accountant screen's grouping. */
export const MONEY_KINDS = /** @type {const} */ ([
  'opening',
  'sale',
  'purchase',
  'expense',
  'refund',
  'supplier_payment',
  'supplier_refund',
  'deposit',
  'withdrawal',
  'transfer_in',
  'transfer_out',
]);

export const MONEY_KIND_LABELS = {
  opening: 'Opening balance',
  sale: 'Sale received',
  purchase: 'Purchase paid',
  expense: 'Expense paid',
  refund: 'Refund',
  supplier_payment: 'Supplier payment',
  supplier_refund: 'Supplier refund received',
  deposit: 'Money added',
  withdrawal: 'Money taken out',
  transfer_in: 'Moved in',
  transfer_out: 'Moved out',
};

export const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  digital_wallet: 'Digital wallet',
  cheque: 'Cheque',
  credit: 'On credit',
};

/** Methods that actually move money in the bank/hand. "credit" never does. */
export const SETTLEMENT_METHODS = PAYMENT_METHODS.filter((m) => m !== 'credit');

export const INVOICE_STATUSES = /** @type {const} */ ([
  'unpaid',
  'partial',
  'paid',
  'overdue',
  'cancelled',
]);

export const STOCK_MOVEMENT_TYPES = /** @type {const} */ ([
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
]);

export const STOCK_MOVEMENT_LABELS = {
  opening: 'Opening stock',
  purchase: 'Purchase received',
  sale: 'Sold',
  sale_return: 'Sales return',
  purchase_return: 'Purchase return',
  adjustment_in: 'Adjustment (+)',
  adjustment_out: 'Adjustment (\u2212)',
  damage: 'Damaged / written off',
  transfer: 'Transfer',
  recount: 'Stock recount',
};

export const EXPENSE_CATEGORIES = /** @type {const} */ ([
  'rent',
  'utilities',
  'salary',
  'supplies',
  'marketing',
  'travel',
  'maintenance',
  'taxes',
  'fees',
  'internet',
  'transport',
  'other',
]);

export const UNITS_OF_MEASURE = /** @type {const} */ ([
  'pcs',
  'kg',
  'g',
  'litre',
  'ml',
  'metre',
  'cm',
  'ft',
  'box',
  'pack',
  'dozen',
  'pair',
  'set',
  'bag',
  'roll',
  'hour',
  'service',
]);

export const SUPPORTED_CURRENCIES = [
  { code: 'NPR', symbol: 'Rs.', name: 'Nepalese Rupee', decimals: 2, locale: 'en-NP' },
  { code: 'INR', symbol: '\u20b9', name: 'Indian Rupee', decimals: 2, locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2, locale: 'en-US' },
  { code: 'GBP', symbol: '\u00a3', name: 'British Pound', decimals: 2, locale: 'en-GB' },
  { code: 'EUR', symbol: '\u20ac', name: 'Euro', decimals: 2, locale: 'en-DE' },
  { code: 'AED', symbol: 'AED ', name: 'UAE Dirham', decimals: 2, locale: 'en-AE' },
  { code: 'NPR_rupee', symbol: 'Rs.', name: 'Nepalese Rupee', decimals: 2, locale: 'en-NP' },
];

export function currencyMeta(code) {
  return (
    SUPPORTED_CURRENCIES.find((c) => c.code === code) || {
      code: code || 'NPR',
      symbol: 'Rs.',
      name: code || 'NPR',
      decimals: 2,
      locale: 'en-NP',
    }
  );
}

export const DEFAULT_BUSINESS_SETTINGS = {
  currency: 'NPR',
  currencySymbol: 'Rs.',
  currencyDecimals: 2,
  locale: 'en-NP',
  timezone: 'Asia/Kathmandu',
  taxEnabled: false,
  taxRatePercent: 0,
  taxInclusive: false,
  taxLabel: 'VAT',
  invoicePrefix: 'INV',
  nextInvoiceNumber: 1,
  paymentMethods: ['cash', 'bank_transfer', 'card', 'digital_wallet', 'credit'],
  invoiceDueDays: 0,
  allowNegativeStock: false,
  requirePaymentReason: false,
  lowStockAlerts: true,
  receiptFooter: 'Thank you for your business.',
  terms: '',
};
