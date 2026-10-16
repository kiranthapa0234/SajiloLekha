/**
 * Data table.
 *
 * A single implementation backs every list in the product so that density,
 * keyboard behaviour, mobile fallbacks and pagination stay consistent.
 *
 * Responsive strategy: below `md`, each row becomes a stacked card (label/value
 * pairs) instead of a horizontally scrolling table, because horizontal scroll
 * hides data rather than presenting it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { EmptyState, ErrorState, Select, TableSkeleton } from './ui/index.jsx';

/**
 * @param {object} props
 * @param {Array<{key:string,label:string,align?:'left'|'right'|'center',width?:string,className?:string,render?:Function,sortable?:boolean}>} props.columns
 * @param {Array<object>} props.rows
 * @param {boolean} props.loading
 * @param {object} props.error
 */
export function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  empty,
  getRowId = (row, index) => row.id ?? row._id ?? index,
  onRowClick,
  sort,
  onSortChange,
  page = 1,
  limit = 25,
  total = 0,
  onPageChange,
  pageSizeOptions = [10, 25, 50, 100],
  stickyHeader = true,
  className,
  rowKey,
}) {
  const interactive = typeof onRowClick === 'function';

  const handleSort = useCallback(
    (key) => {
      if (!onSortChange) return;
      const direction = sort?.key === key && sort?.order === 'asc' ? 'desc' : 'asc';
      onSortChange({ key, order: direction });
    },
    [onSortChange, sort]
  );

  const handleKeyDown = useCallback(
    (event, row) => {
      if (!interactive) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onRowClick(row);
      }
    },
    [interactive, onRowClick]
  );

  if (loading) return <TableSkeleton rows={Math.min(8, Math.max(3, limit))} columns={columns.length} />;

  if (error) return <ErrorState error={error} onRetry={onRetry} compact />;

  if (!rows?.length) {
    return empty ?? <EmptyState title="Nothing here yet" description="Records will appear here once they exist." compact />;
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className={className}>
      {/* ---------------- desktop ---------------- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="lk-table">
          <thead className={clsx(stickyHeader && 'sticky top-0 z-10 bg-white')}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    sort?.key === column.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className="inline-flex items-center gap-1 rounded hover:text-ink-800 focus-visible:ring-2 focus-visible:ring-brand-600"
                    >
                      {column.label}
                      <ChevronsUpDown
                        className={clsx('h-3 w-3', sort?.key === column.key ? 'text-brand-600' : 'text-ink-300')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey ? rowKey(row) : getRowId(row, index)}
                onClick={interactive ? () => onRowClick(row) : undefined}
                onKeyDown={interactive ? (e) => handleKeyDown(e, row) : undefined}
                tabIndex={interactive ? 0 : undefined}
                // The row deliberately keeps its implicit `row` role: overriding
                // it with `role="button"` strips the table / rowheader / cell
                // relationships a screen reader relies on to read the table.
                // Keyboard reachability comes from tabIndex plus Enter/Space,
                // and the first column's link stays the primary affordance.
                aria-label={interactive ? `Open ${String(row[columns[0]?.key] ?? 'record')}` : undefined}
                className={clsx(interactive && 'cursor-pointer focus-visible:bg-brand-50/60')}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx(
                      column.align === 'right' && 'text-right tabular',
                      column.align === 'center' && 'text-center',
                      column.className
                    )}
                  >
                    {column.render ? column.render(row, index) : row[column.key] ?? '--'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- mobile: stacked cards ---------------- */}
      <ul className="divide-y divide-ink-100 md:hidden">
        {rows.map((row, index) => (
          <li key={rowKey ? rowKey(row) : getRowId(row, index)}>
            <div
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onRowClick(row) : undefined}
              onKeyDown={interactive ? (e) => handleKeyDown(e, row) : undefined}
              className={clsx('space-y-2 px-4 py-3.5', interactive && 'cursor-pointer active:bg-brand-50/50')}
            >
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="flex items-baseline justify-between gap-3">
                    <span className="text-2xs font-medium uppercase tracking-wider text-ink-400">
                      {column.label}
                    </span>
                    <span className={clsx('text-right text-sm text-ink-900', column.align === 'right' && 'tabular')}>
                      {column.render ? column.render(row, index) : row[column.key] ?? '--'}
                    </span>
                  </div>
                ))}
            </div>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-3"
          aria-label="Pagination"
        >
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <label htmlFor="page-size">Rows</label>
            <Select
              id="page-size"
              className="h-8 w-auto py-1 text-xs"
              value={limit}
              onChange={(e) => onPageChange?.(1, Number(e.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>

          <p className="text-xs text-ink-500" aria-live="polite">
            Page {page} of {totalPages}
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPageChange?.(page - 1, limit)}
              disabled={page <= 1}
              className="lk-btn-secondary lk-btn-sm disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => onPageChange?.(page + 1, limit)}
              disabled={page >= totalPages}
              className="lk-btn-secondary lk-btn-sm disabled:opacity-40"
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

/**
 * Search + filter toolbar shared by every list page.
 * The search box is debounced so typing does not fire a request per keystroke.
 */
export function TableToolbar({ search, onSearchChange, children, className, placeholder = 'Search…' }) {
  const [value, setValue] = useState(search ?? '');
  const [lastSearch, setLastSearch] = useState(search ?? '');
  const timer = useRef(null);

  // Re-sync when the parent resets the filters (for example "clear all").
  // Adjusting during render rather than in an effect avoids a second render
  // pass in which the input briefly shows the stale term.
  if ((search ?? '') !== lastSearch) {
    setLastSearch(search ?? '');
    setValue(search ?? '');
  }

  const handleChange = (event) => {
    const next = event.target.value;
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchChange?.(next), 300);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={clsx('flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3', className)}>
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <label htmlFor="table-search" className="sr-only">
          Search records
        </label>
        <input
          id="table-search"
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className="lk-input h-9 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
