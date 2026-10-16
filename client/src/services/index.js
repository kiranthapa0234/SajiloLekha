/**
 * Typed service layer.
 *
 * Components never call `http` directly; they call one of these functions.
 * That keeps URL shapes, parameter names and money encoding in one place, and
 * means a backend route can move without touching a component.
 */
import { del, download, get, getList, http, patch, post, put, restoreSession } from './http.js';

/* ---------------------------------------------------------------- AUTH -- */

export const auth = {
  register: (payload) => post('/auth/register', payload),
  login: (payload) => post('/auth/login', payload),
  logout: (allDevices = false) => post('/auth/logout', { allDevices }),
  me: (businessId) => get('/auth/me', { params: { businessId } }),
  /** Exchange the refresh cookie for a session, so a page reload is not a logout. */
  restore: () => restoreSession(),
  switchBusiness: (businessId) => post('/auth/switch-business', { businessId }),
  updateProfile: (payload) => patch('/auth/me', payload),
  changePassword: (payload) => post('/auth/me/password', payload),
  sessions: () => get('/auth/sessions'),
  revokeSessions: (exceptJti) => post('/auth/sessions/revoke', { exceptJti }),
  forgotPassword: (email) => post('/auth/forgot-password', { email }),
  resetPassword: (payload) => post('/auth/reset-password', payload),
};

/* ------------------------------------------------------------ BUSINESS -- */

export const businesses = {
  list: () => get('/business'),
  current: () => get('/business/current'),
  create: (payload) => post('/business', payload),
  update: (payload) => patch('/business', payload),
  stats: () => get('/business/stats'),
  members: () => get('/business/members'),
  inviteMember: (payload) => post('/business/members', payload),
  updateMember: (id, payload) => patch(`/business/members/${id}`, payload),
  removeMember: (id, reason) => del(`/business/members/${id}`, { body: { reason } }),
  upload: (file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return http
      .post('/business/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: onProgress })
      .then((r) => r.data.data);
  },
};

/* ----------------------------------------------------------- DASHBOARD -- */

export const dashboard = {
  summary: (params) => get('/dashboard/summary', { params }),
  stats: () => get('/dashboard/stats'),
  salesChart: (params) => get('/dashboard/sales-chart', { params }),
  paymentMethods: (params) => get('/dashboard/payment-methods', { params }),
  outstanding: () => get('/dashboard/outstanding'),
};

/* ------------------------------------------------------------ PRODUCTS -- */

export const products = {
  list: (params) => getList('/products', { params }),
  get: (id) => get(`/products/${id}`),
  create: (payload) => post('/products', payload),
  update: (id, payload) => patch(`/products/${id}`, payload),
  archive: (id, reason) => post(`/products/${id}/archive`, { reason }),
  restore: (id) => post(`/products/${id}/restore`, {}),
  adjustStock: (id, payload) => post(`/products/${id}/stock`, payload),
  search: (q, limit = 12) => get('/products/search', { params: { q, limit } }),
  alerts: (limit = 20) => get('/products/alerts', { params: { limit } }),
  movements: (params) => get('/products/movements', { params }),
};

export const categories = {
  list: () => get('/products/categories'),
  create: (payload) => post('/products/categories', payload),
  update: (id, payload) => patch(`/products/categories/${id}`, payload),
  archive: (id, archived = true) => patch(`/products/categories/${id}/archive`, { archived }),
};

export const stock = {
  adjust: (payload) => post('/stock/adjust', payload),
  bulkAdjust: (items) => post('/stock/bulk-adjust', { items }),
  history: (params) => get('/stock', { params }),
};

/* ------------------------------------------------------------ CUSTOMERS -- */

export const customers = {
  list: (params) => getList('/customers', { params }),
  get: (id) => get(`/customers/${id}`),
  create: (payload) => post('/customers', payload),
  update: (id, payload) => patch(`/customers/${id}`, payload),
  archive: (id, reason) => post(`/customers/${id}/archive`, { reason }),
  restore: (id) => post(`/customers/${id}/restore`, {}),
  walkIn: () => get('/customers/walk-in'),
  ledger: (id, params) => get(`/customers/${id}/ledger`, { params }),
  statement: (id, params) => get(`/customers/${id}/statement`, { params }),
  statementPdf: (id, params) => download(`/customers/${id}/statement`, { params: { ...params, format: 'pdf' } }),
};

/* ------------------------------------------------------------ SUPPLIERS -- */

export const suppliers = {
  list: (params) => getList('/suppliers', { params }),
  get: (id) => get(`/suppliers/${id}`),
  create: (payload) => post('/suppliers', payload),
  update: (id, payload) => patch(`/suppliers/${id}`, payload),
  archive: (id, reason) => post(`/suppliers/${id}/archive`, { reason }),
  restore: (id) => post(`/suppliers/${id}/restore`, {}),
  ledger: (id, params) => get(`/suppliers/${id}/ledger`, { params }),
};

/* ---------------------------------------------------------------- SALES -- */

export const sales = {
  list: (params) => getList('/sales', { params }),
  get: (id) => get(`/sales/${id}`),
  quote: (payload) => post('/sales/quote', payload),
  create: (payload) => post('/sales', payload),
  update: (id, payload) => patch(`/sales/${id}`, payload),
  cancel: (id, payload) => post(`/sales/${id}/cancel`, payload),
  refund: (id, payload) => post(`/sales/${id}/refund`, payload),
  addPayment: (id, payload) => post(`/sales/${id}/payments`, payload),
};

/* ------------------------------------------------------------ PURCHASES -- */

export const purchases = {
  list: (params) => getList('/purchases', { params }),
  get: (id) => get(`/purchases/${id}`),
  create: (payload) => post('/purchases', payload),
  cancel: (id, payload) => post(`/purchases/${id}/cancel`, payload),
  addPayment: (id, payload) => post(`/purchases/${id}/payments`, payload),
  returnToSupplier: (payload) => post('/purchases/returns', payload),
};

/* ------------------------------------------------------------- EXPENSES -- */

export const expenses = {
  list: (params) => getList('/expenses', { params }),
  get: (id) => get(`/expenses/${id}`),
  create: (payload) => post('/expenses', payload),
  update: (id, payload) => patch(`/expenses/${id}`, payload),
  void: (id, reason) => post(`/expenses/${id}/void`, { reason }),
  archive: (id) => post(`/expenses/${id}/archive`, {}),
  restore: (id) => post(`/expenses/${id}/restore`, {}),
  totals: (params) => get('/expenses/totals', { params }),
};

/* ------------------------------------------------------------- PAYMENTS -- */

export const payments = {
  list: (params) => getList('/payments', { params }),
  get: (id) => get(`/payments/${id}`),
  create: (payload) => post('/payments', payload),
  void: (id, reason) => post(`/payments/${id}/void`, { reason }),
  reconcile: (id, payload) => patch(`/payments/${id}/reconcile`, payload),
  methods: (params) => get('/payments/methods', { params }),
};

/* ------------------------------------------------------------- INVOICES -- */

export const invoices = {
  list: (params) => getList('/invoices', { params }),
  get: (id, params) => get(`/invoices/${id}`, { params }),
  pdf: (id, { copy = false } = {}) => download(`/invoices/${id}`, { params: { format: 'pdf', copy } }),
  csv: (id) => download(`/invoices/${id}`, { params: { format: 'csv' } }),
  exportCsv: (params) => download('/invoices', { params: { ...params, format: 'csv' } }),
  printUrl: (id, params = {}) => {
    const query = new URLSearchParams({ format: 'print', ...params });
    return `${http.defaults.baseURL}/invoices/${id}?${query.toString()}`;
  },
  cancel: (id, reason) => post(`/invoices/${id}/cancel`, { reason }),
  writeOff: (id, payload) => post(`/invoices/${id}/write-off`, payload),
};

/* -------------------------------------------------------------- REPORTS -- */

/* ---------------------------------------------------------------- MONEY -- */

/**
 * The workspace's own cash and bank position. Distinct from `payments`, which
 * record money owed against a document; these record money actually moving.
 */
export const money = {
  balances: () => get('/money/balances'),
  movements: (params) => get('/money/movements', { params }),
  transfer: (payload) => post('/money/transfer', payload),
  add: (payload) => post('/money/in', payload),
  remove: (payload) => post('/money/out', payload),
};

export const reports = {
  list: () => get('/reports'),
  run: (key, params) => get(`/reports/${key}`, { params }),
  export: (key, params) => download(`/reports/${key}/export`, { params: { ...params, format: 'csv' } }),
  exportPdf: (key, params) => download(`/reports/${key}/export`, { params: { ...params, format: 'pdf' } }),
};

/* --------------------------------------------------------------- SYSTEM -- */

export const system = {
  auditLogs: (params) => get('/system/logs', { params }),
  auditMeta: () => get('/system/logs/meta'),
  enums: () => get('/system/enums'),
  health: () => get('/system/health'),
};

export { put };
