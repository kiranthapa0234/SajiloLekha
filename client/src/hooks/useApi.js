/**
 * Shared data hooks.
 *
 * Query keys are namespaced by the active business id, which makes it
 * impossible for React Query to serve one workspace's cached data while another
 * is selected.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useBusinessId } from '@/context/AuthContext.jsx';
import { ApiError } from '@/services/http.js';
import * as api from '@/services/index.js';

export const keys = {
  dashboard: (biz, params) => ['dashboard', biz, params],
  products: (biz, params) => ['products', biz, params],
  product: (biz, id) => ['product', biz, id],
  categories: (biz) => ['categories', biz],
  movements: (biz, params) => ['movements', biz, params],
  customers: (biz, params) => ['customers', biz, params],
  customer: (biz, id) => ['customer', biz, id],
  suppliers: (biz, params) => ['suppliers', biz, params],
  supplier: (biz, id) => ['supplier', biz, id],
  sales: (biz, params) => ['sales', biz, params],
  sale: (biz, id) => ['sale', biz, id],
  purchases: (biz, params) => ['purchases', biz, params],
  expenses: (biz, params) => ['expenses', biz, params],
  payments: (biz, params) => ['payments', biz, params],
  invoices: (biz, params) => ['invoices', biz, params],
  invoice: (biz, id) => ['invoice', biz, id],
  report: (biz, key, params) => ['report', biz, key, params],
  stockAlerts: (biz) => ['stock-alerts', biz],
};

/** Drop every cached list that a financial write could have changed. */
export function useInvalidateFinancial(businessId) {
  const queryClient = useQueryClient();
  return (extraKeys = []) => {
    const invalidate = ['dashboard', 'sales', 'sale', 'payments', 'invoices', 'invoice', 'expenses', 'customers', 'customer', 'suppliers', 'purchases', 'products', 'product', 'movements', 'stock-alerts', 'report'];
    for (const key of [...invalidate, ...extraKeys]) {
      queryClient.invalidateQueries({ queryKey: [key, businessId] });
    }
  };
}

/**
 * Turn an ApiError into a toast. A 4xx is the user's problem to fix, so it is
 * shown as a message rather than an error banner; a 5xx gets a retry hint.
 */
export function useToast() {
  return {
    success: (message) => toast.success(message),
    error: (error, fallback = 'Something went wrong') => {
      const message = error instanceof ApiError ? error.message : error?.message ?? fallback;
      toast.error(message, { duration: error instanceof ApiError && error.status >= 500 ? 6000 : 4000 });
    },
    promise: async (promise, { loading, success, error: onError }) => {
      const id = toast.loading(loading);
      try {
        const result = await promise;
        toast.success(success, { id });
        return result;
      } catch (error) {
        toast.error(error?.message ?? onError ?? 'Something went wrong', { id });
        throw error;
      }
    },
  };
}

/* ------------------------------------------------------------ DASHBOARD -- */

export function useDashboardSummary(params) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.dashboard(businessId, params),
    queryFn: () => api.dashboard.summary(params),
    enabled: Boolean(businessId),
  });
}

export function useDashboardSalesChart(params) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: ['sales-chart', businessId, params],
    queryFn: () => api.dashboard.salesChart(params),
    enabled: Boolean(businessId),
  });
}

/* ------------------------------------------------------------- INVENTORY - */

export function useStockAlerts(limit = 20) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.stockAlerts(businessId),
    queryFn: () => api.products.alerts(limit),
    enabled: Boolean(businessId),
    // The sidebar badge should stay fresh, so poll gently.
    refetchInterval: 120_000,
  });
}

/**
 * A paginated query, presented the way screens expect to read it.
 *
 * The service returns `{ items, meta }` so the pagination envelope survives the
 * trip. This flattens that back into `{ data, meta }` on the query result, which
 * is what every page already destructures — so no screen has to know the wire
 * shape. Without the envelope, `meta.total` and `meta.summary` were undefined
 * and every stat card rendered zero.
 */
export function usePaginated(buildQuery) {
  const query = useQuery(buildQuery());
  return {
    ...query,
    data: query.data?.items ?? [],
    meta: query.data?.meta ?? null,
  };
}

export function useProducts(params) {
  const businessId = useBusinessId();
  return usePaginated(() => ({
    queryKey: keys.products(businessId, params),
    queryFn: () => api.products.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));
}

export function useProduct(id) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.product(businessId, id),
    queryFn: () => api.products.get(id),
    enabled: Boolean(businessId && id),
  });
}

export function useCategories() {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.categories(businessId),
    queryFn: () => api.categories.list(),
    enabled: Boolean(businessId),
    staleTime: 10 * 60_000,
  });
}

export function useStockMovements(params) {
  const businessId = useBusinessId();
  return usePaginated(() => ({
    queryKey: keys.movements(businessId, params),
    queryFn: () => api.stock.history(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));
}

/* -------------------------------------------------------------- CUSTOMERS */

export function useCustomers(params) {
  const businessId = useBusinessId();
  return usePaginated(() => ({
    queryKey: keys.customers(businessId, params),
    queryFn: () => api.customers.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));
}

export function useCustomer(id) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.customer(businessId, id),
    queryFn: () => api.customers.get(id),
    enabled: Boolean(businessId && id),
  });
}

export function useCustomerStatement(id, params) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: ['statement', businessId, id, params],
    queryFn: () => api.customers.statement(id, params),
    enabled: Boolean(businessId && id && params),
  });
}

/* -------------------------------------------------------------- SUPPLIERS */

export function useSuppliers(params) {
  const businessId = useBusinessId();
  return usePaginated(() => ({
    queryKey: keys.suppliers(businessId, params),
    queryFn: () => api.suppliers.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));
}

/* ------------------------------------------------------------------ SALES */

export function useSales(params) {
  const businessId = useBusinessId();
  return usePaginated(() => ({
    queryKey: keys.sales(businessId, params),
    queryFn: () => api.sales.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));
}

export function useSale(id) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.sale(businessId, id),
    queryFn: () => api.sales.get(id),
    enabled: Boolean(businessId && id),
  });
}

/* --------------------------------------------------------------- EXPENSES */

export function useExpenses(params) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.expenses(businessId, params),
    queryFn: () => api.expenses.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  });
}

/* --------------------------------------------------------------- PAYMENTS */

export function usePayments(params) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.payments(businessId, params),
    queryFn: () => api.payments.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  });
}

/* --------------------------------------------------------------- INVOICES */

export function useInvoices(params) {
  const businessId = useBusinessId();
  return usePaginated(() => ({
    queryKey: keys.invoices(businessId, params),
    queryFn: () => api.invoices.list(params),
    enabled: Boolean(businessId),
    placeholderData: (previous) => previous,
  }));
}

export function useInvoice(id) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.invoice(businessId, id),
    queryFn: () => api.invoices.get(id),
    enabled: Boolean(businessId && id),
  });
}

/* --------------------------------------------------------------- REPORTS */

export function useReport(key, params) {
  const businessId = useBusinessId();
  return useQuery({
    queryKey: keys.report(businessId, key, params),
    queryFn: () => api.reports.run(key, params),
    enabled: Boolean(businessId && key && params),
    placeholderData: (previous) => previous,
  });
}

/* --------------------------------------------------------------- MUTATION */

/**
 * Generic mutation wrapper: invalidates the right caches and surfaces a toast.
 * Keeps every screen from re-implementing the same five lines.
 */
export function useApiMutation(mutationFn, { invalidate = [], successMessage, onSuccess } = {}) {
  const businessId = useBusinessId();
  const invalidateAll = useInvalidateFinancial(businessId);
  const { success, error } = useToast();

  return useMutation({
    mutationFn,
    onSuccess: (data, variables, context) => {
      invalidateAll(invalidate);
      if (successMessage) success(typeof successMessage === 'function' ? successMessage(data, variables) : successMessage);
      onSuccess?.(data, variables, context);
    },
    onError: (mutationError) => error(mutationError),
  });
}
