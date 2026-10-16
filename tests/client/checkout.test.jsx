/**
 * Sale checkout pricing.
 *
 * Regression: a cart line priced Rs. 580.00 previewed a Subtotal of
 * Rs. 58,000.00. The line rendered from the product's minor-unit price, while
 * the summary came from the server quote -- and the client sent `unitPrice` in
 * MINOR units even though the wire contract is a human-typed decimal in MAJOR
 * units, so the server scaled it a second time.
 *
 * These tests assert the request the client actually makes, because that is
 * where the bug lived. The server was always correct.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import SaleCheckoutPage from '@client/pages/Sales/SaleCheckoutPage.jsx';
import { makeAuth, mockServices, renderWithProviders, restoreServices } from './utils.jsx';

const PRODUCT_ID = '507f1f77bcf86cd799439055';

const product = {
  _id: PRODUCT_ID,
  id: PRODUCT_ID,
  name: 'Horlics',
  sku: 'TS-002',
  unit: 'pcs',
  /** Rs. 580.00 expressed in minor units -- what the API returns. */
  sellingPriceMinor: 58000,
  costPriceMinor: 50000,
  stockQuantity: 12000,
  minStockLevel: 5,
  taxPercent: 0,
  price: 580,
};

/** The quote the server builds from a correctly-priced cart. */
function quoteFor(unitPriceMinor) {
  return {
    lines: [
      {
        product: PRODUCT_ID,
        name: 'Horlics',
        sku: 'TS-002',
        unit: 'pcs',
        quantity: 1,
        unitPriceMinor,
        discountPercent: 0,
        discountMinor: 0,
        taxPercent: 0,
        grossMinor: unitPriceMinor,
        netMinor: unitPriceMinor,
        taxMinor: 0,
        totalMinor: unitPriceMinor,
        available: 12000,
      },
    ],
    totals: {
      grossMinor: unitPriceMinor,
      totalDiscountMinor: 0,
      netSalesMinor: unitPriceMinor,
      taxMinor: 0,
      totalMinor: unitPriceMinor,
      cogsMinor: 50000,
      items: 1,
    },
  };
}

function setup() {
  return mockServices({
    'sales.quote': vi.fn().mockResolvedValue(quoteFor(58000)),
    'products.search': vi.fn().mockResolvedValue([product]),
    'customers.list': vi.fn().mockResolvedValue([]),
    'sales.create': vi.fn().mockResolvedValue({ id: 'sale-1' }),
  });
}

/** Type into the typeahead and add the single result to the cart. */
async function addProductToCart(user) {
  const box = await screen.findByPlaceholderText(/search by name, sku or barcode/i);
  await user.type(box, 'hor');
  const hit = await screen.findByText('Horlics');
  await user.click(hit);
}

describe('Sale checkout pricing', () => {
  beforeEach(() => restoreServices());

  it('requests the quote using MAJOR units, not minor', async () => {
    const mocks = setup();
    const { user } = renderWithProviders(<SaleCheckoutPage />, {
      route: '/sales/new',
      auth: makeAuth(),
    });

    await addProductToCart(user);

    await waitFor(() => expect(mocks.quote).toHaveBeenCalled(), { timeout: 5000 });

    const sent = mocks.quote.mock.calls.at(-1)[0].lines[0];

    // The product is Rs. 580.00. Sending 58000 would make the server store
    // 5,800,000 minor units and quote Rs. 58,000.00.
    expect(sent.unitPrice).toBe(580);
    expect(sent.unitPrice).not.toBe(58000);
  });

  it('shows a subtotal equal to the line price, never 100x it', async () => {
    setup();
    const { user } = renderWithProviders(<SaleCheckoutPage />, {
      route: '/sales/new',
      auth: makeAuth(),
    });

    await addProductToCart(user);

    await waitFor(() => expect(screen.getAllByText('Rs. 580.00').length).toBeGreaterThan(0), {
      timeout: 5000,
    });

    // The exact regression figure must never be rendered.
    expect(screen.queryByText('Rs. 58,000.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/58,000/)).not.toBeInTheDocument();
  });
});