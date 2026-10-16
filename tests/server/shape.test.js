/**
 * Response shape.
 *
 * The UI renders computed fields directly off list and detail responses
 * (`stockStatus`, `stockValueMinor`, `marginPercent`, `itemCount`,
 * `daysOverdue`, `outstandingMinor`). A regression here does not throw — the
 * page just quietly renders blanks or "undefined", which is far easier to miss
 * than an error and far more expensive to notice.
 *
 * These assertions exist because Mongoose 8 silently ignores
 * `.lean({ virtuals: true })`, so those fields must be applied by the schema
 * plugin instead.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, expectOk, login, seedCustomer, seedProducts, seedWorkspace } from '../setup/helpers.js';
import { app } from '../setup/server.setup.js';

const rs = (rupees) => rupees * 100;

describe('computed fields reach the client', () => {
  let ws;
  let auth;
  let product;
  let customer;

  beforeEach(async () => {
    ws = await seedWorkspace({ email: 'shape@test.dev', businessName: 'Shape Store' });
    auth = await login(app, ws.email, ws.password);
    ({ products: [product] } = await seedProducts(ws.businessId, ws.userId, [
      { name: 'Computed Widget', sku: 'CW-1', priceMinor: rs(2500), costMinor: rs(1500), stock: 10, minStock: 4 },
    ]));
    customer = await seedCustomer(ws.businessId, ws.userId);
  });

  it('includes product virtuals in list responses', async () => {
    const rows = expectOk(await api.get(app, '/api/products', auth.headers));
    const row = rows.find((p) => p.sku === 'CW-1');

    expect(row).toBeDefined();
    expect(row.stockStatus).toBe('in_stock');
    expect(row.stockValueMinor).toBe(rs(1500) * 10);
    expect(row.marginMinor).toBe(rs(1000));
    expect(row.marginPercent).toBe(40);
  });

  it('includes product virtuals in the detail response', async () => {
    const row = expectOk(await api.get(app, `/api/products/${product._id}`, auth.headers));
    expect(row.stockStatus).toBe('in_stock');
    expect(row.stockValueMinor).toBe(rs(15000));
    expect(row.marginPercent).toBe(40);
  });

  it('reflects a low-stock threshold in stockStatus', async () => {
    const created = expectOk(
      await api.post(app, '/api/products', auth.headers, {
        name: 'Nearly Gone',
        sku: 'NG-1',
        costPrice: '100.00',
        sellingPrice: '150.00',
        stockQuantity: '2',
        minStockLevel: '5',
        openingStockReason: 'Opening count',
      }),
      201
    );
    expect(created.stockStatus).toBe('low_stock');
    expect(created.stockValueMinor).toBe(rs(200));
  });

  it('includes sale and invoice virtuals on list and detail', async () => {
    const { sale, invoice } = expectOk(
      await api.post(app, '/api/sales', auth.headers, {
        customer: customer._id,
        lines: [{ product: product._id, quantity: 2 }],
        invoiceStatus: 'paid',
        payments: [{ amount: '5000', method: 'cash' }],
      }),
      201
    );

    // Invoice: daysOverdue and remaining balance.
    expect(invoice.daysOverdue).toBe(0);
    expect(invoice.remainingMinor ?? 0).toBe(0);

    const invoiceRow = expectOk(await api.get(app, `/api/invoices/${invoice._id}`, auth.headers));
    expect(invoiceRow.daysOverdue).toBe(0);
    expect(invoiceRow.outstandingMinor).toBe(0);

    const invoiceList = expectOk(await api.get(app, '/api/invoices', auth.headers));
    expect(invoiceList[0].daysOverdue).toBe(0);
    expect(invoiceList[0].outstandingMinor).toBe(0);

    // Sale: derived item counts.
    const saleRow = expectOk(await api.get(app, `/api/sales/${sale._id}`, auth.headers));
    expect(saleRow.itemCount).toBe(2);
    expect(saleRow.profitMinor ?? saleRow.grossProfitMinor).toBe(rs(2000));
  });

  it('includes customer balance virtuals', async () => {
    const created = expectOk(
      await api.post(app, '/api/sales', auth.headers, {
        customer: customer._id,
        lines: [{ product: product._id, quantity: 1 }],
        invoiceStatus: 'unpaid',
      }),
      201
    );
    expect(created.invoice.outstandingMinor).toBe(rs(2500));

    const row = expectOk(await api.get(app, `/api/customers/${customer._id}`, auth.headers));
    expect(row.outstandingMinor).toBe(rs(2500));
    expect(row.totalSalesMinor).toBe(rs(2500));
  });

  it('never leaks internal fields or the password hash', async () => {
    const me = expectOk(await api.get(app, '/api/auth/me', auth.headers));
    expect(me.user.passwordHash).toBeUndefined();
    expect(me.user.sessions).toBeUndefined();
    expect(JSON.stringify(me)).not.toMatch(/passwordHash|tokenHash/);
  });

  it('keeps the response envelope consistent', async () => {
    const res = await api.get(app, '/api/products', auth.headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Lists must carry pagination meta so the UI can render page controls.
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('total');
  });

  it('uses a uniform error envelope with a machine-readable code', async () => {
    const res = await api.get(app, '/api/products/000000000000000000000000', auth.headers);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'NOT_FOUND',
        message: expect.any(String),
        requestId: expect.any(String),
      }),
    });
    // Errors must never carry a stack trace to the client in production shape.
    expect(res.body.error).not.toHaveProperty('stack');
  });
});