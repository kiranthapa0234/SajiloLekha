/**
 * HTTP client.
 *
 * Design notes
 *  - The access token lives in memory only. The refresh token is an HttpOnly
 *    cookie the browser never exposes to JavaScript, so an XSS cannot steal a
 *    long-lived credential.
 *  - A 401 triggers ONE refresh attempt, and concurrent 401s share that single
 *    attempt rather than stampeding the endpoint.
 *  - Errors are normalised into `ApiError` so every caller can rely on
 *    `error.code`, `error.fields` and `error.status`.
 */
import axios from 'axios';
import { toMinorUnits } from '@shared/money.js';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

let accessToken = null;
let onUnauthenticated = null;
let refreshPromise = null;

export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.code = code ?? 'NETWORK_ERROR';
    this.details = details ?? null;
    this.requestId = requestId ?? null;
    /**
     * Field-level validation messages, keyed by field path.
     *
     * `details` is not always a list. Validation failures send an array of
     * `{ field, message }`, but the domain refusals — INSUFFICIENT_STOCK,
     * INSUFFICIENT_FUNDS, STOCK_VERSION_CONFLICT — send an object of figures.
     * Assuming an array made the constructor itself throw on those, so the user
     * saw "details.filter is not a function" instead of the sentence the server
     * had written for them.
     */
    const list = Array.isArray(details) ? details : [];
    this.fields = Object.fromEntries(list.filter((d) => d?.field).map((d) => [d.field, d.message]));
  }

  get isNetworkError() {
    return this.status === 0;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  /** True for the "no changes were written" family: 409 / 422. */
  get isConflict() {
    return this.status === 409 || this.status === 422;
  }

  /** Field errors keyed by path, for React Hook Form's `setError`. */
  get fieldErrors() {
    return this.fields;
  }
}

export function setAccessToken(token) {
  accessToken = token ?? null;
}

export function getAccessToken() {
  return accessToken;
}

export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = handler;
}

export const http = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // required for the HttpOnly refresh cookie
  timeout: 30_000,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Send the active workspace so the server can verify membership for it.
  if (config.businessId) {
    config.headers['X-Business-Id'] = config.businessId;
    delete config.businessId;
  }
  return config;
});

/**
 * Exchange the refresh cookie for a new access token.
 * Concurrent callers share one in-flight request, which is what stops a page
 * with six parallel queries from firing six refreshes.
 */
async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .then((response) => {
        const { accessToken: token, ...rest } = response.data?.data ?? {};
        accessToken = token ?? null;
        if (rest?.user) {
          window.dispatchEvent(new CustomEvent('lekhapana:session', { detail: rest }));
        }
        return rest;
      })
      .catch((error) => {
        accessToken = null;
        if (error?.response?.status === 401 && onUnauthenticated) onUnauthenticated();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error ?? {};

    // One transparent refresh-and-retry.
    const isAuthRoute = String(config?.url ?? '').includes('/auth/');
    if (response?.status === 401 && !config?._retried && !isAuthRoute && accessToken) {
      config._retried = true;
      try {
        await refreshAccessToken();
        return http.request(config);
      } catch {
        /* fall through to the normalised error below */
      }
    }

    if (response) {
      const payload = response.data;
      throw new ApiError(payload?.error?.message || 'Something went wrong. Please try again.', {
        status: response.status,
        code: payload?.error?.code,
        details: payload?.error?.details,
        requestId: payload?.error?.requestId,
      });
    }

    throw new ApiError(
      error?.code === 'ECONNABORTED'
        ? 'The request timed out. Check your connection and try again.'
        : 'Cannot reach the server. Check your connection and try again.',
      { status: 0, code: 'NETWORK_ERROR' }
    );
  }
);

/* ------------------------------------------------------------ REQUESTS -- */

function unwrap(response) {
  return response.data?.data;
}

/**
 * For list endpoints: the rows *and* the `meta` envelope.
 *
 * List endpoints answer with `{ data: [...], meta: { page, total, summary } }`.
 * The plain `get` helper returns only `data`, which silently discarded the meta
 * — so every page that reads `meta.total` or `meta.summary` rendered zeros: the
 * inventory KPIs, and the counts on customers, expenses, invoices, payments,
 * purchases, sales and the movement ledger.
 *
 * Kept separate from `get` so the many single-object callers are unaffected.
 * Accepts either shape of `data` because endpoints that paginate return the rows
 * directly, while some return `{ items }` inside the payload.
 */
export async function getList(url, { params, businessId, signal } = {}) {
  const response = await http.get(url, { params, signal, businessId });
  const payload = response.data?.data;
  return {
    items: Array.isArray(payload) ? payload : (payload?.items ?? []),
    meta: response.data?.meta ?? null,
  };
}

/**
 * Serialise money for the wire.
 * Values are already in minor units in most places; when a form hands us a
 * decimal string it is converted here with the exact integer parser.
 */
function encodeMoney(value, decimals = 2) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return toMinorUnits(value, decimals);
}

export async function get(url, { params, businessId, signal } = {}) {
  return unwrap(await http.get(url, { params, signal, businessId }));
}

export async function post(url, body, { params, businessId } = {}) {
  return unwrap(await http.post(url, body, { params, businessId }));
}

export async function patch(url, body, { params, businessId } = {}) {
  return unwrap(await http.patch(url, body, { params, businessId }));
}

export async function put(url, body, { params, businessId } = {}) {
  return unwrap(await http.put(url, body, { params, businessId }));
}

export async function del(url, { params, body, businessId } = {}) {
  return unwrap(await http.delete(url, { params, data: body, businessId }));
}

/** Fetch raw bytes (PDF/CSV) and hand back a Blob plus the server filename. */
export async function download(url, { params, businessId } = {}) {
  const response = await http.get(url, { params, businessId, responseType: 'blob' });
  const disposition = response.headers['content-disposition'] ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'download';
  return { blob: response.data, filename };
}

/**
 * Rebuild the session from the HttpOnly refresh cookie after a page load.
 *
 * The access token lives in memory only, so a browser refresh starts with
 * `accessToken = null`. The 401 interceptor deliberately skips `/auth/*` routes
 * and requires an existing token, so it cannot recover this case on its own --
 * without this explicit call the user is signed out on every reload.
 *
 * Returns the session payload, or null when there is no usable cookie.
 */
export async function restoreSession() {
  try {
    return await refreshAccessToken();
  } catch {
    // No cookie, expired, or revoked: the app is simply anonymous.
    return null;
  }
}

export { encodeMoney, BASE_URL };
