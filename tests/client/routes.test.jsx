/**
 * Every screen mounts.
 *
 * This exists because of a specific failure: a refactor used `<SupplierSelect>`
 * in the Purchases form without importing it. `eslint` and `vite build` both
 * passed — Rollup treats an unresolved JSX name as a global, and the lint config
 * does not resolve JSX identifiers — so the mistake shipped. It only surfaced
 * when a user opened Purchases and got a permanently blank screen:
 * `ReferenceError: SupplierSelect is not defined`.
 *
 * Nothing else in the suite rendered that page, so no test noticed. Rendering
 * each route is cheap and catches the whole family: missing imports, illegal
 * hook calls, bad module-level code, undefined context wiring.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';

import AccountantPage from '@client/pages/Accountant/AccountantPage.jsx';
import CustomerDetailPage from '@client/pages/Customers/CustomerDetailPage.jsx';
import CustomersPage from '@client/pages/Customers/CustomersPage.jsx';
import DashboardPage from '@client/pages/Dashboard/DashboardPage.jsx';
import ExpensesPage from '@client/pages/Expenses/ExpensesPage.jsx';
import InventoryPage from '@client/pages/Inventory/InventoryPage.jsx';
import InvoiceDetailPage from '@client/pages/Invoices/InvoiceDetailPage.jsx';
import InvoicesPage from '@client/pages/Invoices/InvoicesPage.jsx';
import PaymentsPage from '@client/pages/Payments/PaymentsPage.jsx';
import ProductFormPage from '@client/pages/Inventory/ProductFormPage.jsx';
import PurchasesPage from '@client/pages/Purchases/PurchasesPage.jsx';
import ReportsPage from '@client/pages/Reports/ReportsPage.jsx';
import SalesListPage from '@client/pages/Sales/SalesListPage.jsx';
import SettingsPage from '@client/pages/Settings/SettingsPage.jsx';
import StockMovementsPage from '@client/pages/Inventory/StockMovementsPage.jsx';
import SuppliersPage from '@client/pages/Suppliers/SuppliersPage.jsx';
import { makeAuth, mockServices, renderWithProviders, restoreServices } from './utils.jsx';

/**
 * Every service the pages above touch. Unlisted ones are left real, so an
 * unexpected call fails loudly rather than resolving `undefined` and hiding a
 * real error.
 */
function mockEverything() {
  const empty = vi.fn().mockResolvedValue([]);
  const paged = vi.fn().mockResolvedValue({ items: [], total: 0, summary: {} });
  return mockServices({
    'dashboard.summary': vi.fn().mockResolvedValue(null),
    'dashboard.stats': vi.fn().mockResolvedValue(null),
    'dashboard.salesChart': vi.fn().mockResolvedValue(null),
    'dashboard.paymentMethods': vi.fn().mockResolvedValue(null),
    'dashboard.outstanding': vi.fn().mockResolvedValue(null),
    'products.list': empty,
    'products.search': empty,
    'products.alerts': empty,
    'products.movements': paged,
    'products.get': vi.fn().mockResolvedValue(null),
    'categories.list': empty,
    'suppliers.list': empty,
    'suppliers.get': vi.fn().mockResolvedValue(null),
    'customers.list': empty,
    'customers.get': vi.fn().mockResolvedValue(null),
    'stock.history': paged,
    'money.balances': vi.fn().mockResolvedValue(null),
    'money.movements': paged,
    'reports.list': empty,
    'reports.run': vi.fn().mockResolvedValue(null),
    'purchases.list': paged,
    'sales.list': paged,
    'invoices.list': paged,
    'payments.list': paged,
    'expenses.list': paged,
    // Real shape: daily/monthly/yearly/	otals.\n    'expenses.totals': vi.fn().mockResolvedValue({ daily: [], monthly: [], yearly: [], totals: { totalMinor: 0, count: 0 } }),
  });
}

/**
 * Route paths for the detail pages. These read `useParams`, so they have to be
 * rendered through a real <Route> rather than bare.
 */
const ID = '507f1f77bcf86cd799439033';

const CASES = [
  ['Dashboard', DashboardPage, '/', '/'],
  ['Sales', SalesListPage, '/sales', '/sales'],
  ['Inventory', InventoryPage, '/inventory', '/inventory'],
  ['Stock movements', StockMovementsPage, '/inventory/movements', '/inventory/movements'],
  ['Add product', ProductFormPage, '/inventory/new', '/inventory/new'],
  ['Customers', CustomersPage, '/customers', '/customers'],
  ['Customer detail', CustomerDetailPage, `/customers/${ID}`, '/customers/:id'],
  ['Suppliers', SuppliersPage, '/suppliers', '/suppliers'],
  ['Purchases', PurchasesPage, '/purchases', '/purchases'],
  ['Expenses', ExpensesPage, '/expenses', '/expenses'],
  ['Payments', PaymentsPage, '/payments', '/payments'],
  ['Invoices', InvoicesPage, '/invoices', '/invoices'],
  ['Invoice detail', InvoiceDetailPage, `/invoices/${ID}`, '/invoices/:id'],
  ['Accountant', AccountantPage, '/accountant', '/accountant'],
  ['Reports', ReportsPage, '/reports', '/reports'],
  ['Settings', SettingsPage, '/settings', '/settings'],
];

describe('every screen mounts', () => {
  afterEach(() => {
    cleanup();
    restoreServices();
  });

  for (const [name, Component, route, path] of CASES) {
    it(`renders ${name}`, async () => {
      mockEverything();
      renderWithProviders(<Component />, { route, path, auth: makeAuth() });

      // A blank <main> is the exact symptom of a render-time ReferenceError, so
      // assert on rendered output rather than merely "did not throw".
      await waitFor(() => {
        expect(document.body.textContent.trim().length).toBeGreaterThan(0);
      });
      expect(document.body.textContent.trim(), `${name} rendered nothing`).not.toBe('');
    });
  }
});