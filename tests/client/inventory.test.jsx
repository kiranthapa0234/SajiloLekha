/**
 * Inventory empty state.
 *
 * The "Add product" action used to be suppressed whenever a search term was
 * present, so the most common way to reach an empty list -- typing something
 * that matches nothing -- produced a dead end with no way to create a product
 * and no way to clear the filter.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import InventoryPage from '@client/pages/Inventory/InventoryPage.jsx';
import { makeAuth, mockServices, renderWithProviders, restoreServices, service } from './utils.jsx';

/**
 * `GET /products` answers with the rows in `data` and the pagination envelope in
 * `meta`, which is where the inventory stat cards get their figures. The service
 * layer resolves to `{ items, meta }`; mocking a bare array here hid that
 * contract and let the KPI cards render zero in a test suite that was green.
 */
function productPage(rows) {
  return {
    items: rows,
    meta: {
      page: 1,
      limit: 25,
      total: rows.length,
      summary: {
        costValueMinor: 5406213,
        retailValueMinor: 5988000,
        totalUnits: 188,
        lowStock: 3,
        outOfStock: 2,
        potentialProfitMinor: 581787,
      },
    },
  };
}

function setup(rows = [], supplierRows = []) {
  return mockServices({
    'products.list': vi.fn().mockResolvedValue(productPage(rows)),
    'products.alerts': vi.fn().mockResolvedValue([]),
    'categories.list': vi.fn().mockResolvedValue([]),
    'suppliers.list': vi.fn().mockResolvedValue({ items: supplierRows, meta: { total: supplierRows.length } }),
    'purchases.create': vi.fn().mockResolvedValue({ purchase: { _id: 'pur-1' } }),
    'purchases.returnToSupplier': vi.fn().mockResolvedValue({ cashBackMinor: 20000 }),
    'stock.adjust': vi.fn().mockResolvedValue({ movement: { _id: 'mov-1' } }),
  });
}

function render() {
  return renderWithProviders(<InventoryPage />, { route: '/inventory', auth: makeAuth() });
}

const SUPPLIER = { _id: '507f1f77bcf86cd799439099', name: 'Blue Ridge Wholesale', phone: '9800000000' };

describe('Inventory empty state and stock actions', () => {
  beforeEach(() => restoreServices());
  // Vitest globals are off here, so RTL's automatic cleanup never registers and
  // each render would otherwise stack on the previous one.
  afterEach(() => cleanup());

  it('offers "Add product" when there are no products at all', async () => {
    setup([]);
    render();

    expect(await screen.findByText('No products yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument();
    expect(screen.getByText(/add your first product/i)).toBeInTheDocument();
  });

  it('still offers "Add product" when a search hides everything', async () => {
    setup([]);
    const { user } = render();

    await screen.findByText('No products yet');
    const search = screen.getByPlaceholderText(/search/i);
    await user.type(search, 'zzzz');

    expect(await screen.findByText(/no products match your filters/i)).toBeInTheDocument();

    // The regression: this button vanished whenever a search was active.
    expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument();
  });

  it('offers a way to clear filters when they are the reason the list is empty', async () => {
    setup([]);
    const { user } = render();

    await screen.findByText('No products yet');
    await user.type(screen.getByPlaceholderText(/search/i), 'zzzz');

    expect(await screen.findByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('offers a per-row "Add stock" action that preselects the product', async () => {
    setup([
      {
        _id: '507f1f77bcf86cd799439055',
        name: 'Blue Widget',
        sku: 'BW-1',
        unit: 'pcs',
        stockQuantity: 25,
        minStockLevel: 3,
        stockStatus: 'in_stock',
        costPriceMinor: 10000,
        sellingPriceMinor: 25000,
      },
    ]);
    const { user } = render();

    // DataTable renders each row twice (table for desktop, list for mobile),
    // so the same action legitimately appears more than once.
    const addStock = await screen.findAllByRole('button', { name: /add stock/i });
    await user.click(addStock[0]);

    // The product is already chosen: no raw id to copy from the list.
    expect(await screen.findByText(/Blue Widget \(BW-1\)/)).toBeInTheDocument();

    // And the form is ready to record a change.
    expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record adjustment/i })).toBeInTheDocument();
  });

  it('shows the real stock figures in the KPI cards', async () => {
    // Regression: every stat read `meta.summary`, but the service layer was
    // discarding the pagination envelope, so `meta` was always undefined and the
    // screen showed Stock value Rs.0, Retail value Rs.0, Low stock 0,
    // Out of stock 0 — with real stock sitting in the table underneath.
    setup([
      {
        _id: '507f1f77bcf86cd799439055',
        name: 'Blue Widget',
        sku: 'BW-1',
        unit: 'pcs',
        stockQuantity: 25,
        minStockLevel: 3,
        stockStatus: 'in_stock',
        costPriceMinor: 10000,
        sellingPriceMinor: 25000,
      },
    ]);
    render();

    // DataTable renders the rows twice (desktop table + mobile list).
    await screen.findAllByText('Blue Widget');

    // 5406213 minor = Rs. 54,062.13
    expect(screen.getByText('Rs. 54,062.13')).toBeInTheDocument();
    expect(screen.getByText('Rs. 59,880')).toBeInTheDocument();
    expect(screen.getByText(/Potential profit Rs\. 5,817\.87/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // low stock
    expect(screen.getByText('2')).toBeInTheDocument(); // out of stock
  });

  it('pre-picks a decrease when the Remove action is used', async () => {
    setup([
      {
        _id: '507f1f77bcf86cd799439055',
        name: 'Blue Widget',
        sku: 'BW-1',
        unit: 'pcs',
        stockQuantity: 25,
        minStockLevel: 3,
        stockStatus: 'in_stock',
        costPriceMinor: 10000,
        sellingPriceMinor: 25000,
      },
    ]);
    const { user } = render();

    const remove = await screen.findAllByRole('button', { name: /^remove$/i });
    await user.click(remove[0]);

    expect(await screen.findByLabelText(/movement type/i)).toHaveValue('adjustment_out');
  });

  describe('adding stock has to say who it came from', () => {
    const ROW = {
      _id: '507f1f77bcf86cd799439055',
      name: 'Blue Widget',
      sku: 'BW-1',
      unit: 'pcs',
      stockQuantity: 25,
      minStockLevel: 3,
      stockStatus: 'in_stock',
      costPriceMinor: 10000,
      sellingPriceMinor: 25000,
    };

    /** Open the modal on the "Add stock" row action. */
    async function openAddStock(rows = [ROW], supplierRows = []) {
      setup(rows, supplierRows);
      const { user } = render();
      const addStock = await screen.findAllByRole('button', { name: /add stock/i });
      await user.click(addStock[0]);
      await screen.findByText(/Blue Widget \(BW-1\)/);
      return { user };
    }

    /** Switch to the purchase framing and attach a supplier. */
    async function chooseSupplier(user) {
      await user.click(screen.getByRole('radio', { name: /bought from a supplier/i }));
      await user.type(screen.getByLabelText(/^supplier/i, { selector: '#adj-supplier' }), 'Blue');
      await user.click(await screen.findByRole('button', { name: /Blue Ridge Wholesale/ }));
    }

    it('asks whether the stock was bought, and says why it matters', async () => {
      await openAddStock();

      expect(await screen.findByText(/where did this stock come from/i)).toBeInTheDocument();
      expect(screen.getByText(/bought from a supplier/i)).toBeInTheDocument();
      expect(screen.getByText(/you will owe the supplier/i)).toBeInTheDocument();
      expect(screen.getByText(/stock correction/i)).toBeInTheDocument();
      // The default is a plain correction, so nothing looks like a purchase yet.
      expect(screen.queryByLabelText(/^supplier/i, { selector: '#adj-supplier' })).not.toBeInTheDocument();
    });

    it('records a purchase — supplier and cost — when the stock was bought', async () => {
      const { user } = await openAddStock([ROW], [SUPPLIER]);
      await chooseSupplier(user);

      // Cost is prefilled from the product's recorded cost, so the operator only
      // overrides it when the supplier has changed the price.
      expect(screen.getByLabelText(/cost per unit/i)).toHaveValue('100');
      expect(screen.getByRole('button', { name: /receive stock/i })).toBeInTheDocument();

      await user.type(screen.getByLabelText(/quantity/i), '10');
      await user.click(screen.getByRole('button', { name: /receive stock/i }));

      const create = service('purchases.create');
      await waitFor(() => expect(create).toHaveBeenCalled());
      // Stock rises through the purchase path, so the debt is not forgotten.
      expect(create.mock.calls[0][0].supplier).toBe(SUPPLIER._id);
      expect(create.mock.calls[0][0].lines).toEqual([
        expect.objectContaining({ product: ROW._id, quantity: 10, costPrice: '100' }),
      ]);
      // A plain adjustment must not also fire.
      expect(service('stock.adjust')).not.toHaveBeenCalled();
    });

    it('refuses to receive stock with no supplier, since that is the original bug', async () => {
      const { user } = await openAddStock();

      await user.click(screen.getByRole('radio', { name: /bought from a supplier/i }));
      await user.type(screen.getByLabelText(/quantity/i), '5');
      await user.click(screen.getByRole('button', { name: /receive stock/i }));

      expect(await screen.findByText(/choose the supplier you bought this from/i)).toBeInTheDocument();
      expect(service('purchases.create')).not.toHaveBeenCalled();
    });

    it('carries the chosen supplier across to a return when the movement turns outbound', async () => {
      const { user } = await openAddStock([ROW], [SUPPLIER]);
      await chooseSupplier(user);

      await user.selectOptions(screen.getByLabelText(/movement type/i), 'damage');

      // The inbound question is gone. But the supplier the operator already
      // chose is not silently thrown away — reducing stock against a supplier
      // is plausible, so the outbound question appears and it is a return.
      expect(screen.queryByText(/where did this stock come from/i)).not.toBeInTheDocument();
      expect(await screen.findByText(/is any money coming back/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /return stock/i })).toBeInTheDocument();
    });

    it('reverts to a plain adjustment when the supplier is cleared', async () => {
      const { user } = await openAddStock([ROW], [SUPPLIER]);
      await chooseSupplier(user);
      await user.selectOptions(screen.getByLabelText(/movement type/i), 'damage');

      await user.click(screen.getByRole('radio', { name: /nothing comes back/i }));

      expect(screen.getByRole('button', { name: /record adjustment/i })).toBeInTheDocument();
    });

    describe('taking stock back when the supplier refunds you', () => {
      /** Open the modal with the Remove action, which pre-picks Adjustment (−). */
      async function openRemove() {
        const { user } = await openAddStock([ROW], [SUPPLIER]);
        const remove = await screen.findAllByRole('button', { name: /^remove$/i });
        await user.click(remove[0]);
        await screen.findByLabelText(/movement type/i);
        return user;
      }

      it('asks whether money is coming back, and what the default means', async () => {
        await openRemove();

        expect(await screen.findByText(/is any money coming back/i)).toBeInTheDocument();
        expect(screen.getByText(/supplier took it back and refunded me/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing comes back/i)).toBeInTheDocument();
        // Nothing looks like a return until the operator says so.
        expect(screen.queryByLabelText(/^supplier/i, { selector: '#adj-supplier' })).not.toBeInTheDocument();
      });

      it('sends a supplier return, not a plain adjustment', async () => {
        const user = await openRemove();
        await user.click(screen.getByRole('radio', { name: /supplier took it back and refunded me/i }));
        await user.type(screen.getByLabelText(/^supplier/i, { selector: '#adj-supplier' }), 'Blue');
        await user.click(await screen.findByRole('button', { name: /Blue Ridge Wholesale/ }));

        await user.type(screen.getByLabelText(/quantity/i), '2');
        // "At cost" is the usual refund, so the common case is one click.
        await user.click(screen.getByRole('button', { name: /at cost/i }));
        expect(screen.getByLabelText(/refund received/i)).toHaveValue('200.00'); // 2 x Rs.100

        await user.click(screen.getByRole('button', { name: /return stock/i }));

        const giveBack = service('purchases.returnToSupplier');
        await waitFor(() => expect(giveBack).toHaveBeenCalled());
        expect(giveBack.mock.calls[0][0]).toMatchObject({
          product: ROW._id,
          supplier: SUPPLIER._id,
          quantity: 2,
          refundAmount: '200.00',
        });
        // Stock falling on its own would leave the money gone.
        expect(service('stock.adjust')).not.toHaveBeenCalled();
      });

      it('refuses the return without a supplier', async () => {
        const user = await openRemove();
        await user.click(screen.getByRole('radio', { name: /supplier took it back and refunded me/i }));
        await user.type(screen.getByLabelText(/quantity/i), '2');
        await user.click(screen.getByRole('button', { name: /return stock/i }));

        expect(await screen.findByText(/choose the supplier who took the stock back/i)).toBeInTheDocument();
        expect(service('purchases.returnToSupplier')).not.toHaveBeenCalled();
      });

      it('leaves a recount alone — a count is not a return', async () => {
        const user = await openRemove();
        await user.selectOptions(screen.getByLabelText(/movement type/i), 'recount');

        expect(screen.queryByText(/is any money coming back/i)).not.toBeInTheDocument();
      });
    });
  });

  it('hides the create action from a role that cannot write products', async () => {
    setup([]);
    renderWithProviders(<InventoryPage />, {
      route: '/inventory',
      auth: makeAuth({ can: () => false, isOwner: false, isAdmin: false }),
    });

    expect(await screen.findByText('No products yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add product/i })).not.toBeInTheDocument();
    // The copy should say why there is nothing here, rather than go blank.
    expect(screen.getByText(/added by an owner or manager/i)).toBeInTheDocument();
  });
});