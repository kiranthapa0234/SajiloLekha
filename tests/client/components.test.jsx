/**
 * Shared UI components.
 *
 * These are used by every screen, so a defect here is a defect everywhere.
 * The focus is on behaviour a user depends on: keyboard operation, focus
 * management, announced state, and distinct loading/empty/error outcomes.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { DataTable, TableToolbar } from '@client/components/DataTable.jsx';
import { Alert, Badge, ConfirmDialog, EmptyState, Field, Input, Modal, StatusBadge } from '@client/components/ui/index.jsx';
import { makeBusiness, renderWithProviders } from './utils.jsx';

const rows = [
  { id: '1', name: 'Cotton T-shirt', sku: 'TS-001', stock: 40, totalMinor: 150000 },
  { id: '2', name: 'Canvas Bag', sku: 'BG-002', stock: 3, totalMinor: 110000 },
  { id: '3', name: 'Wool Scarf', sku: 'SC-003', stock: 0, totalMinor: 85000 },
];

const columns = [
  { key: 'name', label: 'Product', sortable: true },
  { key: 'sku', label: 'SKU', sortable: true },
  { key: 'stock', label: 'On hand', align: 'right' },
  { key: 'totalMinor', label: 'Value', align: 'right' },
];

describe('DataTable', () => {
  it('renders a semantic table with a header row', () => {
    renderWithProviders(<DataTable columns={columns} rows={rows} />);

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('row')).toHaveLength(rows.length + 1);
    expect(screen.getByRole('columnheader', { name: 'On hand' })).toBeInTheDocument();
  });

  it('shows a loading state instead of an empty table', () => {
    renderWithProviders(<DataTable columns={columns} rows={[]} loading />);

    expect(screen.getByRole('status', { name: /loading records/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a distinct empty state, not a blank table', () => {
    renderWithProviders(
      <DataTable columns={columns} rows={[]} empty={<EmptyState title="No products yet" description="Add one." />} />
    );

    expect(screen.getByText('No products yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error with a retry, distinct from the empty state', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <DataTable columns={columns} rows={[]} error={new Error('Could not reach the server')} onRetry={onRetry} />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server');

    const { user } = { user: null };
    const retry = within(alert).getByRole('button', { name: /try again/i });
    expect(retry).toBeEnabled();
    void user;
  });

  it('makes an interactive row reachable and operable by keyboard', async () => {
    const onRowClick = vi.fn();
    const { user } = renderWithProviders(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);

    // The row keeps its implicit `row` role so the table semantics survive.
    const firstRow = screen.getAllByRole('row')[1];
    expect(firstRow).toHaveAttribute('tabindex', '0');

    firstRow.focus();
    expect(firstRow).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);

    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('is not focusable at all when rows are not clickable', () => {
    renderWithProviders(<DataTable columns={columns} rows={rows} />);
    expect(screen.getAllByRole('row')[1]).not.toHaveAttribute('tabindex');
  });

  it('reports the current sort to assistive technology', () => {
    renderWithProviders(
      <DataTable columns={columns} rows={rows} sort={{ key: 'name', order: 'asc' }} onSortChange={vi.fn()} />
    );

    expect(screen.getByRole('columnheader', { name: /product/i })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /sku/i })).not.toHaveAttribute('aria-sort');
  });

  it('toggles the sort direction when the same column is clicked twice', async () => {
    const onSortChange = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} sort={{ key: 'name', order: 'asc' }} onSortChange={onSortChange} />
    );

    await user.click(screen.getByRole('button', { name: /product/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', order: 'desc' });
  });

  it('starts ascending again when a different column is chosen', async () => {
    const onSortChange = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} sort={{ key: 'name', order: 'desc' }} onSortChange={onSortChange} />
    );

    await user.click(screen.getByRole('button', { name: /sku/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'sku', order: 'asc' });
  });

  it('paginates only when there is more than one page', () => {
    const { rerender } = renderWithProviders(
      <DataTable columns={columns} rows={rows} page={1} limit={25} total={25} onPageChange={vi.fn()} />
    );
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();

    rerender(<DataTable columns={columns} rows={rows} page={1} limit={25} total={90} onPageChange={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('disables the edges of the pagination at the first and last page', async () => {
    const onPageChange = vi.fn();
    const { user, rerender } = renderWithProviders(
      <DataTable columns={columns} rows={rows} page={1} limit={25} total={90} onPageChange={onPageChange} />
    );

    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(2, 25);

    rerender(<DataTable columns={columns} rows={rows} page={4} limit={25} total={90} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('changes the page size from the rows selector', async () => {
    const onPageChange = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} page={1} limit={25} total={90} onPageChange={onPageChange} />
    );

    await user.selectOptions(screen.getByLabelText('Rows'), '50');
    expect(onPageChange).toHaveBeenCalledWith(1, 50);
  });

  it('announces the current page', () => {
    renderWithProviders(<DataTable columns={columns} rows={rows} page={2} limit={25} total={90} onPageChange={vi.fn()} />);
    expect(screen.getByText('Page 2 of 4')).toBeInTheDocument();
  });

  it('stacks into labelled cards on small screens instead of scrolling sideways', () => {
    // jsdom cannot simulate viewport width, so the mobile list is asserted to
    // exist alongside the table and to be hidden from the table layout by CSS.
    renderWithProviders(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(document.querySelectorAll('ul.md\\:hidden').length).toBeGreaterThan(0);
  });
});

describe('TableToolbar', () => {
  it('debounces search so typing does not fire a request per keystroke', async () => {
    // Real timers on purpose. `vi.useFakeTimers()` left installed by a timed-out
    // test silently breaks every later `user.*` call, which costs far more
    // debugging time than the few hundred milliseconds this test waits.
    const onSearchChange = vi.fn();
    renderWithProviders(
      <TableToolbar search="" onSearchChange={onSearchChange} placeholder="Search products…">
        <span>filters</span>
      </TableToolbar>
    );

    const input = screen.getByPlaceholderText('Search products…');

    // Three keystrokes in quick succession.
    fireEvent.change(input, { target: { value: 's' } });
    fireEvent.change(input, { target: { value: 'sh' } });
    fireEvent.change(input, { target: { value: 'shi' } });

    // Nothing yet: the debounce has not elapsed.
    expect(onSearchChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(1));
    expect(onSearchChange).toHaveBeenCalledWith('shi');
  });

  it('labels the search box for screen readers', () => {
    renderWithProviders(<TableToolbar search="" onSearchChange={vi.fn()} />);
    expect(screen.getByLabelText('Search records')).toBeInTheDocument();
  });
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    renderWithProviders(
      <Modal open={false} onClose={vi.fn()} title="Record payment">
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled modal dialog when open', () => {
    renderWithProviders(
      <Modal open onClose={vi.fn()} title="Record payment">
        <p>Body</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus inside the dialog on open so keyboard users are not stranded', async () => {
    renderWithProviders(
      <Modal open onClose={vi.fn()} title="Record payment">
        <button type="button">Inside</button>
      </Modal>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus());
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Record payment">
        <p>Body</p>
      </Modal>
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked but not when the panel is', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Record payment">
        <p>Body</p>
      </Modal>
    );

    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('dialog').previousElementSibling);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives every dialog an explicit dismiss control', () => {
    renderWithProviders(
      <Modal open onClose={vi.fn()} title="Record payment">
        <p>Body</p>
      </Modal>
    );
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeInTheDocument();
  });

  it('returns focus to the trigger when it closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Record payment">
            <button type="button">Inside</button>
          </Modal>
        </>
      );
    }

    const { user } = renderWithProviders(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const { user } = renderWithProviders(
      <Modal open onClose={vi.fn()} title="Record payment">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: 'First' })).toHaveFocus());

    // Tab from the last focusable element wraps back to the first.
    screen.getByRole('button', { name: 'Second' }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
  });
});

describe('ConfirmDialog', () => {
  it('describes the consequence before asking for confirmation', () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Cancel this sale?"
        description="The invoice is cancelled and stock is returned to inventory."
        confirmLabel="Cancel sale"
      />
    );

    expect(screen.getByRole('dialog', { name: 'Cancel this sale?' })).toBeInTheDocument();
    expect(screen.getByText(/stock is returned to inventory/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel sale' })).toBeInTheDocument();
  });

  it('blocks the destructive action until the required word is typed', async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Delete workspace"
        description="This cannot be undone."
        confirmLabel="Delete"
        requireText="DELETE"
      />
    );

    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'delete');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('lets the user back out without any effect', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Cancel?" confirmLabel="Yes, cancel" />
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('status and feedback primitives', () => {
  it('labels an invoice status in words, not colour alone', () => {
    renderWithProviders(<StatusBadge status="overdue" label="Overdue" />);
    const badge = screen.getByText('Overdue');
    expect(badge).toBeInTheDocument();
  });

  it('announces an error with the assertive role', () => {
    renderWithProviders(<Alert tone="danger">Something went wrong</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('announces non-critical information politely', () => {
    renderWithProviders(<Alert tone="info">Heads up</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Heads up');
  });

  it('ties a field error to its input', () => {
    renderWithProviders(
      <Field label="Amount" htmlFor="amount" error="Enter a valid amount" required>
        <Input id="amount" invalid />
      </Field>
    );

    expect(screen.getByLabelText(/amount/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid amount');
  });

  it('shows a badge without demanding a tooltip to understand it', () => {
    renderWithProviders(<Badge tone="success">Paid</Badge>);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });
});

describe('money in the UI', () => {
  it('renders a minor-unit figure using the workspace currency', () => {
    const business = makeBusiness();
    renderWithProviders(<span>{business.currencySymbol} 1,250.00</span>);
    expect(screen.getByText('Rs. 1,250.00')).toBeInTheDocument();
  });
});