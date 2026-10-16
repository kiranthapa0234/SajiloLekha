/**
 * Checkout, stock and inventory integrity.
 *
 * The rules under test are the ones that keep a shop's books true: stock can
 * never go negative without permission, every movement is recorded with a
 * reason, historical invoices survive later product edits, and a double-clicked
 * checkout is a replay rather than a second sale.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { api, expectError, expectOk, login, seedCustomer, seedProducts, seedWorkspace } from '../setup/helpers.js';
import { app } from '../setup/server.setup.js';

const Product = () => mongoose.model('Product');
const Customer = () => mongoose.model('Customer');
const StockMovement = () => mongoose.model('StockMovement');
const Sale = () => mongoose.model('Sale');
const Invoice = () => mongoose.model('Invoice');
const Payment = () => mongoose.model('Payment');

const rs = (rupees) => rupees * 100;

async function sell(auth, lines, extra = {}) {
  return expectOk(
    await api.post(app, '/api/sales', auth.headers, {
      lines,
      invoiceStatus: 'unpaid',
      ...extra,
    }),
    201
  );
}

describe('sales & stock', () => {
  let ws;
  let auth;
  let widget;
  let gadget;
  let customer;

  beforeEach(async () => {
    ws = await seedWorkspace({ email: 'pos@test.dev', businessName: 'Sunrise Store' });
    auth = await login(app, ws.email, ws.password);
    ({ products: [widget, gadget] } = await seedProducts(ws.businessId, ws.userId, [
      { name: 'Cotton T-shirt', sku: 'TS-001', priceMinor: rs(1500), costMinor: rs(900), stock: 40, minStock: 5 },
      { name: 'Canvas Bag', sku: 'BG-002', priceMinor: rs(2200), costMinor: rs(1300), stock: 3, minStock: 5 },
    ]));
    customer = await seedCustomer(ws.businessId, ws.userId);
  });

  it('records a sale, issues an invoice and issues stock atomically', async () => {
    const { sale, invoice } = await sell(auth, [{ product: widget._id, quantity: 4 }], {
      customer: customer._id,
      invoiceStatus: 'paid',
      payments: [{ amount: '6000', method: 'cash' }],
    });

    expect(sale.reference).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(invoice.invoiceNumber).toBe(sale.reference);
    expect(invoice.status).toBe('paid');
    expect(invoice.totalMinor).toBe(rs(6000));

    const after = await Product().findById(widget._id).lean();
    expect(after.stockQuantity).toBe(36); // 40 - 4

    const movements = await StockMovement().find({ product: widget._id }).sort({ createdAt: 1 }).lean();
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(-4);
    expect(movements[0].quantityBefore).toBe(40);
    expect(movingsArithmetic(movements[0])).toBe(true);
    expect(movements[0].relatedDocument.type).toBe('Sale');
    expect(movements[0].reason).toContain(sale.reference);
  });

  it('leaves no partial state when stock is insufficient', async () => {
    // Only 3 in stock; ask for 5. Nothing at all should be written.
    const before = await Product().countDocuments({});
    const res = await api.post(app, '/api/sales', auth.headers, {
      lines: [{ product: gadget._id, quantity: 5 }],
      invoiceStatus: 'paid',
      payments: [{ amount: '11000', method: 'cash' }],
    });
    const error = expectError(res, 422, 'INSUFFICIENT_STOCK');
    expect(error.message).toContain('Canvas Bag');

    expect(await Sale().countDocuments({})).toBe(0);
    expect(await Invoice().countDocuments({})).toBe(0);
    expect(await Payment().countDocuments({})).toBe(0);
    expect(await Product().countDocuments({})).toBe(before);

    const unchanged = await Product().findById(gadget._id).lean();
    expect(unchanged.stockQuantity).toBe(3);
    expect(unchanged.stockVersion).toBe(0);
  });

  it('snapshots price, cost and description so later product edits cannot rewrite history', async () => {
    const { sale, invoice } = await sell(auth, [{ product: widget._id, quantity: 2 }]);

    // Reprice and rename the product afterwards.
    expectOk(
      await api.patch(app, `/api/products/${widget._id}`, auth.headers, {
        name: 'Cotton T-shirt (DISCONTINUED)',
        sellingPrice: '9900',
        costPrice: '1',
      })
    );

    const stored = await Invoice().findById(invoice._id).lean();
    expect(stored.lines[0].name).toBe('Cotton T-shirt');
    expect(stored.lines[0].unitPriceMinor).toBe(rs(1500));
    expect(stored.lines[0].netMinor).toBe(rs(3000));
    expect(stored.totalMinor).toBe(rs(3000));

    const storedSale = await Sale().findById(sale._id).lean();
    expect(storedSale.lines[0].unitCostMinor).toBe(rs(900));
    expect(storedSale.cogsMinor).toBe(rs(1800));
    expect(storedSale.grossProfitMinor).toBe(rs(1200));
  });

  it('refuses to sell more than the business allows and blocks an over-discount', async () => {
    const maxDiscount = await mongoose.model('Business').findById(ws.businessId).lean();
    expect(maxDiscount.settings.maxDiscountPercent).toBe(20);

    const res = await api.post(app, '/api/sales', auth.headers, {
      lines: [{ product: widget._id, quantity: 1, unitPrice: '10' }],
      invoiceStatus: 'paid',
      payments: [{ amount: '10', method: 'cash' }],
    });
    const error = expectError(res, 403);
    expect(error.message).toMatch(/exceeds the 20% limit/);
  });

  it('treats a repeated idempotency key as a replay, not a second sale', async () => {
    const key = 'checkout-abc-123';
    const payload = {
      lines: [{ product: widget._id, quantity: 1 }],
      invoiceStatus: 'paid',
      payments: [{ amount: '1500', method: 'cash' }],
      idempotencyKey: key,
    };

    const first = expectOk(await api.post(app, '/api/sales', auth.headers, payload), 201);
    const second = expectOk(await api.post(app, '/api/sales', auth.headers, payload), 201);

    expect(second.replayed).toBe(true);
    expect(String(second.sale._id)).toBe(String(first.sale._id));
    expect(await Sale().countDocuments({})).toBe(1);

    const product = await Product().findById(widget._id).lean();
    expect(product.stockQuantity).toBe(39); // issued exactly once
  });

  it('accepts the product id in the body, not only the path', async () => {
    // Regression: both `POST /products/:id/stock` and `POST /stock/adjust`
    // reach the same handler, which read only `req.params.id`. The body form
    // therefore looked up `undefined` and answered 404 "Product not found",
    // so the Movements screen could not record anything.
    const res = expectOk(
      await api.post(app, '/api/stock/adjust', auth.headers, {
        product: widget._id,
        type: 'adjustment_in',
        quantity: 12,
        reason: 'Restock from the Movements screen',
      }),
      201
    );

    expect(res.movement.quantity).toBe(12);
    expect(res.product.stockQuantity).toBe(52);
  });

  it('refuses a negative quantity instead of silently inverting the change', async () => {
    // Regression: `Math.abs()` in the stock service discarded the sign, so an
    // operator who typed -9 on "Adjustment (+)" had +9 recorded against their
    // stock. Failing loudly is the only safe behaviour.
    const before = await Product().findById(widget._id).lean();

    const res = await api.post(app, `/api/products/${widget._id}/stock`, auth.headers, {
      type: 'adjustment_in',
      quantity: -9,
      reason: 'Operator typed a minus sign',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/positive number|minus sign/i);

    // Stock and the ledger must both be untouched.
    const after = await Product().findById(widget._id).lean();
    expect(after.stockQuantity).toBe(before.stockQuantity);
    expect(await StockMovement().countDocuments({ product: widget._id, reason: 'Operator typed a minus sign' })).toBe(0);
  });

  it('rejects a negative counted figure on a recount', async () => {
    const res = await api.post(app, `/api/products/${widget._id}/stock`, auth.headers, {
      type: 'recount',
      quantity: -5,
      reason: 'Counted fewer than nothing',
    });
    expect(res.status).toBe(400);
  });

  it('ranks top products by units sold, not by revenue', async () => {
    // Regression: revenue sorting put a single high-value sale above a staple
    // bought hundreds of times, so "Top products" led with an item that had
    // only ever been sold once. This reproduces the reported case — one phone
    // at Rs.85,000 outsold a t-shirt at Rs.15,000 across ten units — which is
    // only possible to rank correctly if quantity, not money, is the measure.
    const phone = expectOk(
      await api.post(app, '/api/products', auth.headers, {
        name: 'Flagship Phone',
        sku: 'PH-001',
        costPrice: '70000',
        sellingPrice: '85000',
        stockQuantity: 1,
        openingStockReason: 'Opening stock',
        isTrackable: true,
      }),
      201
    );

    await sell(auth, [{ product: phone._id, quantity: 1 }]);
    await sell(auth, [{ product: widget._id, quantity: 4 }]);
    await sell(auth, [{ product: widget._id, quantity: 6 }]);

    const { tables } = expectOk(await api.get(app, '/api/dashboard/summary', auth.headers));
    const top = tables.topProducts;

    expect(top[0].sku).toBe('TS-001');
    expect(top[0].unitsSold).toBe(10);
    expect(top[1].sku).toBe('PH-001');
    expect(top[1].unitsSold).toBe(1);

    // The ranking really is driven by quantity: revenue ranks the opposite way.
    expect(top[0].revenueMinor).toBe(rs(15000));
    expect(top[1].revenueMinor).toBe(rs(85000));
    expect(top[1].revenueMinor).toBeGreaterThan(top[0].revenueMinor);
  });

  it('records a manual stock adjustment with a reason and an audit trail', async () => {
    const res = expectOk(
      await api.post(app, `/api/products/${widget._id}/stock`, auth.headers, {
        type: 'adjustment_out',
        quantity: 3,
        reason: 'Damaged in transit',
        reference: 'GRN-88',
      }),
      201
    );

    expect(res.product.stockQuantity).toBe(37);
    expect(res.movement.quantity).toBe(-3);
    expect(res.movement.reason).toBe('Damaged in transit');

    const movements = await StockMovement().find({ product: widget._id }).lean();
    expect(movements).toHaveLength(1);
  });

  it('refuses a stock change with no reason', async () => {
    const res = await api.post(app, `/api/products/${widget._id}/stock`, auth.headers, {
      type: 'adjustment_in',
      quantity: 5,
    });
    expectError(res, 422, 'VALIDATION_ERROR');
    expect((await Product().findById(widget._id).lean()).stockQuantity).toBe(40);
  });

  it('never writes stock without a ledger entry, and never edits a ledger entry', async () => {
    // The schema blocks a raw stock write: only the stock service may move
    // stock, because only it writes the matching StockMovement row.
    await expect(
      Product().updateOne({ _id: widget._id }, { $set: { stockQuantity: 999 } })
    ).rejects.toThrow(/only be changed through the stock service/);

    await expect(
      Product().updateOne({ _id: widget._id }, { $set: { stockQuantity: -5 } })
    ).rejects.toThrow(/only be changed through the stock service/);

    const untouched = await Product().findById(widget._id).lean();
    expect(untouched.stockQuantity).toBe(40);

    // A movement row is append-only.
    await sell(auth, [{ product: widget._id, quantity: 1 }]);
    const movement = await StockMovement().findOne({ product: widget._id }).lean();
    await expect(StockMovement().updateOne({ _id: movement._id }, { $set: { quantity: 1 } })).rejects.toThrow(/immutable/);
  });

  it('rejects a stock change that would drive the ledger out of arithmetic balance', async () => {
    await sell(auth, [{ product: widget._id, quantity: 2 }]);
    const movement = await StockMovement().findOne({ product: widget._id }).lean();
    // quantityAfter must always equal quantityBefore + quantity.
    await expect(
      StockMovement().create({
        business: ws.businessId,
        product: widget._id,
        quantity: -1,
        quantityBefore: 999,
        // 999 + (-1) is 998, so this row is deliberately inconsistent.
        quantityAfter: 500,
        type: 'adjustment_out',
        reason: 'tampered arithmetic',
        relatedDocument: { type: 'Adjustment', id: widget._id },
        performedBy: ws.userId,
      })
    ).rejects.toThrow(/arithmetic is inconsistent/);
    expect(movement).toBeTruthy();
  });

  it('supports a stock recount that sets an absolute figure', async () => {
    const res = expectOk(
      await api.post(app, `/api/products/${widget._id}/stock`, auth.headers, {
        type: 'recount',
        quantity: 37,
        reason: 'Month-end physical count',
      }),
      201
    );
    expect(res.product.stockQuantity).toBe(37);
    expect(res.movement.quantity).toBe(-3); // 40 -> 37
  });

  it('rejects a recount that matches the current figure', async () => {
    const res = await api.post(app, `/api/products/${widget._id}/stock`, auth.headers, {
      type: 'recount',
      quantity: 40,
      reason: 'Physical count',
    });
    expectError(res, 400);
  });

  it('cancels a sale, reverses its stock and voids its invoice', async () => {
    const { sale, invoice } = await sell(auth, [{ product: widget._id, quantity: 5 }]);

    const res = expectOk(
      await api.post(app, `/api/sales/${sale._id}/cancel`, auth.headers, {
        reason: 'Customer changed their mind',
        restock: true,
      })
    );
    expect(res.status).toBe('cancelled');

    const product = await Product().findById(widget._id).lean();
    expect(product.stockQuantity).toBe(40); // fully reversed

    const cancelledInvoice = await Invoice().findById(invoice._id).lean();
    expect(cancelledInvoice.status).toBe('cancelled');
  });

  it('will not cancel a sale while money is still collected', async () => {
    const { sale } = await sell(auth, [{ product: widget._id, quantity: 1 }], {
      invoiceStatus: 'paid',
      payments: [{ amount: '1500', method: 'cash' }],
    });

    const res = await api.post(app, `/api/sales/${sale._id}/cancel`, auth.headers, {
      reason: 'Changed mind',
      restock: true,
    });
    const error = expectError(res, 422, 'PAYMENTS_PRESENT');
    expect(error.message).toMatch(/still collected/);
  });

  it('searches products by name, SKU and barcode', async () => {
    await api.patch(app, `/api/products/${widget._id}`, auth.headers, { barcode: '9801234567890' });

    for (const term of ['T-shirt', 'TS-001', '9801234567890']) {
      const found = expectOk(await api.get(app, `/api/products?search=${encodeURIComponent(term)}`, auth.headers));
      expect(found, `search "${term}"`).toHaveLength(1);
      expect(found[0].sku).toBe('TS-001');
    }
  });

  it('filters by stock status', async () => {
    const low = expectOk(await api.get(app, '/api/products?status=low_stock', auth.headers));
    expect(low.map((p) => p.sku)).toEqual(['BG-002']);

    const out = expectOk(await api.get(app, '/api/products?status=out_of_stock', auth.headers));
    expect(out).toHaveLength(0);
  });

  it('prices a cart through the quote endpoint exactly as checkout will', async () => {
    const quote = expectOk(
      await api.post(app, '/api/sales/quote', auth.headers, {
        lines: [
          { product: widget._id, quantity: 2 },
          { product: gadget._id, quantity: 1 },
        ],
      })
    );

    expect(quote.totals.netSalesMinor).toBe(rs(1500 * 2 + 2200));
    expect(quote.totals.cogsMinor).toBe(rs(900 * 2 + 1300));
    expect(quote.totals.grossProfitMinor).toBe(quote.totals.netSalesMinor - quote.totals.cogsMinor);

    const { sale } = await sell(auth, [
      { product: widget._id, quantity: 2 },
      { product: gadget._id, quantity: 1 },
    ]);
    expect(sale.netSalesMinor).toBe(quote.totals.netSalesMinor);
    expect(sale.totalMinor).toBe(quote.totals.totalMinor);
  });

  it('requires a real customer id for credit sales and rejects an unknown one', async () => {
    const res = await api.post(app, '/api/sales', auth.headers, {
      customer: '000000000000000000000000',
      lines: [{ product: widget._id, quantity: 1 }],
      invoiceStatus: 'unpaid',
    });
    expectError(res, 404);
  });

  it('supports a walk-in sale without a permanent customer record', async () => {
    const { sale } = await sell(auth, [{ product: widget._id, quantity: 1 }], { customerName: 'Walk-in' });
    expect(sale.isWalkIn).toBe(true);
    expect(sale.customerName).toBe('Walk-in');
  });

  it('reuses one walk-in bucket for every walk-in sale', async () => {
    // Walk-in names vary from till to till, but they must all land in a single
    // canonical customer so lifetime totals stay coherent.
    for (const name of ['Walk-in Customer', 'Counter sale', 'Walk-in Customer']) {
      await sell(auth, [{ product: widget._id, quantity: 1 }], { customerName: name });
    }

    const walkIns = await Customer().find({ business: ws.businessId, isWalkIn: true }).lean();
    expect(walkIns).toHaveLength(1);

    const sales = await Sale().find({ business: ws.businessId, isWalkIn: true }).lean();
    expect(sales).toHaveLength(3);
    // Each invoice still shows the name that was typed at the counter.
    expect(sales.map((s) => s.customerName).sort()).toEqual(['Counter sale', 'Walk-in Customer', 'Walk-in Customer']);
  });

  it('survives simultaneous walk-in checkouts', async () => {
    // Two tills selling to walk-in customers at the same instant must not race
    // on the unique customer-code index.
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        api.post(app, '/api/sales', auth.headers, {
          customerName: `Walk-in ${i % 2}`,
          lines: [{ product: widget._id, quantity: 1 }],
          invoiceStatus: 'paid',
          payments: [{ amount: '1500', method: 'cash' }],
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    expect(succeeded.length).toBeGreaterThanOrEqual(3);

    const walkIns = await Customer().find({ business: ws.businessId, isWalkIn: true }).lean();
    expect(walkIns).toHaveLength(1);
  });

  it('returns the created product from the create endpoint', async () => {
    // Regression: the post-insert re-read ran outside the transaction session,
    // so it could not see its own uncommitted write and returned null.
    const created = expectOk(
      await api.post(app, '/api/products', auth.headers, {
        name: 'Created Via API',
        sku: 'API-1',
        costPrice: '10.00',
        sellingPrice: '25.00',
        stockQuantity: '5',
        openingStockReason: 'Opening count',
      }),
      201
    );

    expect(created).toBeTruthy();
    expect(created.name).toBe('Created Via API');
    expect(created._id).toBeTruthy();
    expect(created.sellingPriceMinor).toBe(rs(25));
    expect(created.stockQuantity).toBe(5);
    // Computed fields are present, so the list and detail views agree.
    expect(created.stockStatus).toBe('in_stock');
    expect(created.stockValueMinor).toBe(rs(50));
  });
});

/** A ledger row must always satisfy after === before + delta. */
function movingsArithmetic(movement) {
  return movement.quantityAfter === movement.quantityBefore + movement.quantity;
}
