/**
 * Routes.
 *
 * Access control is enforced on three independent layers:
 *   1. this map (no route the user cannot use is even mounted),
 *   2. `RequirePermission` (guards against a stale client bundle),
 *   3. the server, which is the real boundary and re-checks every request.
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { AppLayout } from '@/components/AppLayout.jsx';
import { AuthLayout } from '@/components/AuthLayout.jsx';
import { Button, EmptyState, Spinner } from '@/components/ui/index.jsx';

// Route-level code splitting: the dashboard is the landing view, so it ships first.
const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage.jsx'));
const AccountantPage = lazy(() => import('@/pages/Accountant/AccountantPage.jsx'));

const LoginPage = lazy(() => import('@/pages/Auth/LoginPage.jsx'));
const RegisterPage = lazy(() => import('@/pages/Auth/RegisterPage.jsx'));
const ForgotPasswordPage = lazy(() => import('@/pages/Auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('@/pages/Auth/ResetPasswordPage.jsx'));

const SalesListPage = lazy(() => import('@/pages/Sales/SalesListPage.jsx'));
const SaleCheckoutPage = lazy(() => import('@/pages/Sales/SaleCheckoutPage.jsx'));
const SaleDetailPage = lazy(() => import('@/pages/Sales/SaleDetailPage.jsx'));

const InventoryPage = lazy(() => import('@/pages/Inventory/InventoryPage.jsx'));
const ProductFormPage = lazy(() => import('@/pages/Inventory/ProductFormPage.jsx'));
const StockMovementsPage = lazy(() => import('@/pages/Inventory/StockMovementsPage.jsx'));

const CustomersPage = lazy(() => import('@/pages/Customers/CustomersPage.jsx'));
const CustomerFormPage = lazy(() => import('@/pages/Customers/CustomerFormPage.jsx'));
const CustomerDetailPage = lazy(() => import('@/pages/Customers/CustomerDetailPage.jsx'));

const SuppliersPage = lazy(() => import('@/pages/Suppliers/SuppliersPage.jsx'));
const SupplierFormPage = lazy(() => import('@/pages/Suppliers/SupplierFormPage.jsx'));
const PurchasesPage = lazy(() => import('@/pages/Purchases/PurchasesPage.jsx'));

const ExpensesPage = lazy(() => import('@/pages/Expenses/ExpensesPage.jsx'));
const PaymentsPage = lazy(() => import('@/pages/Payments/PaymentsPage.jsx'));
const InvoicesPage = lazy(() => import('@/pages/Invoices/InvoicesPage.jsx'));
const InvoiceDetailPage = lazy(() => import('@/pages/Invoices/InvoiceDetailPage.jsx'));
const ReportsPage = lazy(() => import('@/pages/Reports/ReportsPage.jsx'));
const ReportDetailPage = lazy(() => import('@/pages/Reports/ReportDetailPage.jsx'));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage.jsx'));
const ProfilePage = lazy(() => import('@/pages/Settings/ProfilePage.jsx'));
const TeamPage = lazy(() => import('@/pages/Settings/TeamPage.jsx'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage.jsx'));

function RouteFallback() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading page">
      <Spinner className="h-6 w-6 text-brand-600" />
    </div>
  );
}

/** Sends anonymous visitors to login, remembering where they were headed. */
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">
            L
          </span>
          <Spinner className="h-5 w-5 text-brand-600" />
          <span className="text-sm text-ink-500">Loading your workspace…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return children;
}

/** Keeps a signed-in user away from the login/register screens. */
function RequireAnonymous({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <RouteFallback />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

/** Hides a route the user's role cannot use, with an explanation rather than a dead end. */
function RequirePermission({ permission, children }) {
  const { can } = useAuth();
  if (can(permission)) return children;

  return (
    <div className="mx-auto max-w-lg p-6">
      <EmptyState
        title="You do not have access to this area"
        description="Ask an administrator to grant you permission, or contact your workspace owner."
        action={
          <Button variant="secondary" onClick={() => window.history.back()}>
            Go back
          </Button>
        }
      />
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ------------------------------------------------------ public */}
        <Route
          element={
            <RequireAnonymous>
              <AuthLayout />
            </RequireAnonymous>
          }
        >
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        {/* -------------------------------------------------- protected */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />

          <Route
            path="accountant"
            element={
              <RequirePermission permission="report:read">
                <AccountantPage />
              </RequirePermission>
            }
          />

          <Route
            path="sales"
            element={
              <RequirePermission permission="sale:read">
                <SalesListPage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/new"
            element={
              <RequirePermission permission="sale:write">
                <SaleCheckoutPage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/:id"
            element={
              <RequirePermission permission="sale:read">
                <SaleDetailPage />
              </RequirePermission>
            }
          />

          <Route
            path="inventory"
            element={
              <RequirePermission permission="product:read">
                <InventoryPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/new"
            element={
              <RequirePermission permission="product:write">
                <ProductFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/:id/edit"
            element={
              <RequirePermission permission="product:write">
                <ProductFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/movements"
            element={
              <RequirePermission permission="product:read">
                <StockMovementsPage />
              </RequirePermission>
            }
          />

          <Route
            path="customers"
            element={
              <RequirePermission permission="customer:read">
                <CustomersPage />
              </RequirePermission>
            }
          />
          <Route
            path="customers/new"
            element={
              <RequirePermission permission="customer:write">
                <CustomerFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="customers/:id"
            element={
              <RequirePermission permission="customer:read">
                <CustomerDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="customers/:id/edit"
            element={
              <RequirePermission permission="customer:write">
                <CustomerFormPage />
              </RequirePermission>
            }
          />

          <Route
            path="suppliers"
            element={
              <RequirePermission permission="supplier:read">
                <SuppliersPage />
              </RequirePermission>
            }
          />
          <Route
            path="suppliers/new"
            element={
              <RequirePermission permission="supplier:write">
                <SupplierFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="suppliers/:id/edit"
            element={
              <RequirePermission permission="supplier:write">
                <SupplierFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchases"
            element={
              <RequirePermission permission="purchase:read">
                <PurchasesPage />
              </RequirePermission>
            }
          />

          <Route
            path="expenses"
            element={
              <RequirePermission permission="expense:read">
                <ExpensesPage />
              </RequirePermission>
            }
          />

          <Route
            path="payments"
            element={
              <RequirePermission permission="payment:read">
                <PaymentsPage />
              </RequirePermission>
            }
          />

          <Route
            path="invoices"
            element={
              <RequirePermission permission="invoice:read">
                <InvoicesPage />
              </RequirePermission>
            }
          />
          <Route
            path="invoices/:id"
            element={
              <RequirePermission permission="invoice:read">
                <InvoiceDetailPage />
              </RequirePermission>
            }
          />

          <Route
            path="reports"
            element={
              <RequirePermission permission="report:read">
                <ReportsPage />
              </RequirePermission>
            }
          />
          <Route
            path="reports/:key"
            element={
              <RequirePermission permission="report:read">
                <ReportDetailPage />
              </RequirePermission>
            }
          />

          <Route
            path="settings"
            element={
              <RequirePermission permission="settings:read">
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="settings/profile"
            element={
              <RequirePermission permission="settings:read">
                <ProfilePage />
              </RequirePermission>
            }
          />
          <Route
            path="settings/team"
            element={
              <RequirePermission permission="member:manage">
                <TeamPage />
              </RequirePermission>
            }
          />
        </Route>

        <Route
          path="/login"
          element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />}
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
