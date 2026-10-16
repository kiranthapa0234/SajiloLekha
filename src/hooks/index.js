/**
 * Small, focused hooks used across the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { products } from '@/services/index.js';
import { useBusinessId } from '@/context/AuthContext.jsx';

export { useStockAlerts } from './useApi.js';

/**
 * Keep list state (page, search, sort, filters) in the URL.
 *
 * This makes every list shareable and survives a refresh, which matters a lot
 * for a cashier who reloads mid-task.
 */
export function useListState(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const next = { page: 1, limit: 25, search: '', sort: '', order: 'desc', ...defaults };
    for (const key of Object.keys(next)) {
      const raw = searchParams.get(key);
      if (raw !== null && raw !== '') {
        next[key] = key === 'page' || key === 'limit' ? Number(raw) || next[key] : raw;
      }
    }
    return next;
  }, [searchParams, defaults]);

  const update = useCallback(
    (patch) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === '' || value === null || value === undefined) params.delete(key);
            else params.set(key, String(value));
          }
          // Any change other than paging returns to the first page, otherwise a
          // filter can leave the user stranded on an empty page 7.
          if (!('page' in patch)) params.set('page', '1');
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  return [state, update, reset];
}

/** Persist simple UI preferences (table density, date range preset). */
export function useLocalPreference(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(`lekhapana:${key}`);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(`lekhapana:${key}`, JSON.stringify(value));
    } catch {
      /* private mode / quota exceeded: preferences are non-essential */
    }
  }, [key, value]);

  return [value, setValue];
}

/** Debounce a rapidly-changing value (search inputs). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Close a popover on outside click and Escape. */
export function useDismissable(isOpen, onDismiss) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onDismiss();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onDismiss]);

  return ref;
}

/**
 * Product typeahead for the checkout screen.
 * Disabled below three characters so a two-letter query does not pull the
 * whole catalogue on every keystroke.
 */
export function useProductSearch(term, limit = 12) {
  const businessId = useBusinessId();
  const query = (term ?? '').trim();

  const { data, isFetching } = useQuery({
    queryKey: ['product-search', businessId, query],
    queryFn: () => products.search(query, limit),
    enabled: Boolean(businessId && query.length >= 2),
    staleTime: 15_000,
  });

  return { products: data ?? [], isFetching };
}

/** Trigger a browser download for a Blob returned by the services layer. */
export function useDownload() {
  return useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke on the next tick so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);
}

/** Range presets shared by the dashboard, reports and every date filter. */
export const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];

export function useDateRange(initial = { preset: 'month', from: '', to: '' }) {
  const [range, setRange] = useState(initial);

  const params = useMemo(() => {
    if (range.preset === 'custom') {
      const query = { preset: 'custom' };
      if (range.from) query.from = range.from;
      if (range.to) query.to = range.to;
      return query;
    }
    return { preset: range.preset ?? 'month' };
  }, [range]);

  return { range, setRange, params };
}
