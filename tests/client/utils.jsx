/**
 * Client test utilities.
 *
 * The services layer is mocked at its public surface (`@/services/index.js`)
 * rather than at the HTTP layer. That keeps component tests focused on "given
 * this API response, does the screen say the right thing" — the behaviour a
 * user can actually observe — instead of re-testing axios and the refresh
 * interceptor, which have their own coverage.
 */
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

import * as services from '@/services/index.js';
import { AuthContext } from '@/context/AuthContext.jsx';

/**
 * A business object shaped exactly like `GET /auth/me` returns it, so
 * formatting in components runs against real values rather than stubs.
 */
export function makeBusiness(overrides = {}) {
  return {
    id: '507f1f77bcf86cd799439011',
    name: 'Sunrise Store',
    legalName: 'Sunrise Store Pvt. Ltd.',
    email: 'owner@lekhapana.test',
    phone: '9800000000',
    taxNumber: '601234567',
    address: { line1: 'New Road', city: 'Kathmandu', state: 'Bagmati', postalCode: '44600', country: 'Nepal' },
    currency: 'NPR',
    currencySymbol: 'Rs.',
    currencyDecimals: 2,
    locale: 'en-NP',
    timezone: 'Asia/Kathmandu',
    taxEnabled: true,
    taxRatePercent: 13,
    taxLabel: 'VAT',
    invoicePrefix: 'INV',
    invoiceDueDays: 14,
    allowNegativeStock: false,
    lowStockAlerts: true,
    maxDiscountPercent: 20,
    paymentMethods: ['cash', 'bank_transfer', 'card', 'digital_wallet', 'credit'],
    ...overrides,
  };
}

export function makeUser(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439022',
    name: 'Aarav Sharma',
    email: 'owner@lekhapana.test',
    phone: '9800000000',
    emailVerified: true,
    ...overrides,
  };
}

/** A QueryClient that never retries, so failures surface immediately. */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Stand-in for `useAuth()`. Defaults to a signed-in owner with every
 * permission, which is the common case; override per test to check what a
 * restricted role sees.
 */
export function makeAuth(overrides = {}) {
  const business = makeBusiness();
  return {
    user: makeUser(),
    business,
    workspaces: [{ id: business.id, name: business.name, role: 'owner' }],
    membership: { role: 'owner', status: 'active', permissions: ['*'] },
    status: 'authenticated',
    isAuthenticated: true,
    isLoading: false,
    isOwner: true,
    isAdmin: true,
    can: () => true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    switchBusiness: vi.fn(),
    refreshWorkspaces: vi.fn(),
    updateProfile: vi.fn(),
    ...overrides,
  };
}

/**
 * Wrap a subject in the providers every page assumes are present.
 *
 * Pass `path` when the page reads `useParams` (detail screens). It is the route
 * *pattern* (`/invoices/:id`) while `route` is the concrete URL the browser sits
 * on (`/invoices/507f…`); the subject is then rendered through a real <Route> so
 * `useParams` resolves exactly as it does in the app.
 */
export function renderWithProviders(ui, { route = '/', path, auth, queryClient } = {}) {
  const client = queryClient ?? makeQueryClient();
  const authValue = auth ?? makeAuth();

  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter initialEntries={[route]}>
            {path ? (
              <Routes>
                <Route path={path} element={children} />
              </Routes>
            ) : (
              children
            )}
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  }

  return { user: userEvent.setup(), queryClient: client, auth: authValue, ...render(ui, { wrapper: Wrapper }) };
}

/**
 * Replace individual service functions with `vi.fn()`.
 *
 * Paths may be dotted (`'dashboard.summary'`) because the services layer groups
 * calls by resource. Anything not listed keeps its real implementation, so an
 * unmocked call fails loudly rather than silently resolving `undefined`.
 */
export function mockServices(overrides) {
  const mocked = {};

  for (const [path, impl] of Object.entries(overrides)) {
    const fn = typeof impl === 'function' ? vi.fn(impl) : vi.fn().mockResolvedValue(impl);

    const segments = path.split('.');
    const leaf = segments.pop();
    const owner = segments.reduce((node, key) => node[key], services);

    mocked[leaf] = fn;
    vi.spyOn(owner, leaf).mockImplementation(fn);
  }

  return mocked;
}

/** Resolve a dotted path to the live service function, for assertions. */
export function service(path) {
  const segments = path.split('.');
  const leaf = segments.pop();
  return segments.reduce((node, key) => node[key], services)[leaf];
}

export function restoreServices() {
  vi.restoreAllMocks();
}

/** A dashboard summary shaped like the real aggregation response. */
export function makeDashboardSummary(overrides = {}) {
  return {
    range: { preset: 'today', from: '2026-08-14T00:00:00.000Z', to: '2026-08-14T23:59:59.999Z', label: 'Today' },
    kpis: {
      todaySales: { valueMinor: 2458000, orders: 6, changePercent: 12.5, formula: 'Sales completed today' },
      totalOrders: { value: 148, itemsSold: 312, changePercent: 4.2, formula: 'All completed sales' },
      netProfit: { valueMinor: 940500, marginPercent: 38.3, changePercent: -2.1, formula: 'Revenue - COGS - expenses' },
      outstanding: { valueMinor: 620000, overdueCount: 3, formula: 'Billed but not collected' },
      totalExpenses: { valueMinor: 410000, count: 18, changePercent: 3.0, formula: 'Operating expenses' },
      lowStock: { value: 5, outOfStockCount: 1, formula: 'At or below reorder level' },
    },
    charts: {
      salesOverview: {
        series: [
          { date: '2026-08-10', label: 'Mon', revenueMinor: 1200000, profitMinor: 400000, orders: 5 },
          { date: '2026-08-11', label: 'Tue', revenueMinor: 1800000, profitMinor: 700000, orders: 8 },
        ],
        totals: { revenueMinor: 3000000, profitMinor: 1100000, orders: 13 },
      },
      paymentMethods: {
        items: [
          { method: 'cash', count: 9, totalMinor: 1800000 },
          { method: 'card', count: 3, totalMinor: 900000 },
        ],
        totalMinor: 2700000,
      },
    },
    profitAndLoss: {
      revenueMinor: 3000000,
      cogsMinor: 1900000,
      grossProfitMinor: 1100000,
      operatingExpensesMinor: 410000,
      netProfitMinor: 690000,
      basis: 'accrual',
      metrics: { grossMarginPercent: 36.7, netMarginPercent: 23, orders: 13 },
    },
    tables: {
      recentTransactions: [
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-00042',
          customerName: 'Sita Gurung',
          totalMinor: 125000,
          outstandingMinor: 0,
          issuedAt: '2026-08-14T11:20:00.000Z',
          status: 'paid',
        },
        {
          id: 'inv-2',
          invoiceNumber: 'INV-2026-00041',
          customerName: 'Bikash Thapa',
          totalMinor: 300000,
          outstandingMinor: 150000,
          issuedAt: '2026-08-14T10:05:00.000Z',
          status: 'partial',
        },
      ],
      topProducts: [{ id: 'p-1', name: 'Cotton T-shirt', unitsSold: 42, revenueMinor: 630000 }],
      recentCustomers: [
        {
          id: 'c-1',
          name: 'Sita Gurung',
          invoiceCount: 7,
          totalSalesMinor: 450000,
          outstandingMinor: 0,
          lastTransactionAt: '2026-08-14T11:20:00.000Z',
        },
      ],
      lowStockItems: [
        {
          id: 'p-9',
          name: 'Wool socks',
          sku: 'WS-095',
          stockQuantity: 2,
          minStockLevel: 10,
          unit: 'pair',
          status: 'low_stock',
        },
      ],
    },
    ...overrides,
  };
}