/**
 * Multi-tenancy: the single most important property of this system.
 *
 * Every assertion here attempts a real cross-tenant read/write and expects it to
 * fail. A regression that trusts a client-supplied businessId would pass every
 * other suite in the project while silently leaking one business's books to
 * another, so these tests are deliberately adversarial.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { api, expectError, expectOk, login, seedCustomer, seedProducts, seedWorkspace } from '../setup/helpers.js';
import { app } from '../setup/server.setup.js';

const Customer = () => mongoose.model('Customer');
const Product = () => mongoose.model('Product');

describe('tenant isolation', () => {
  let alpha;
  let beta;
  let alphaAuth;
  let betaAuth;
  let betaProduct;
  let alphaCustomer;

  beforeEach(async () => {
    alpha = await seedWorkspace({ email: 'alpha@test.dev', businessName: 'Alpha Traders' });
    beta = await seedWorkspace({ email: 'beta@test.dev', businessName: 'Beta Supplies' });

    alphaAuth = await login(app, alpha.email, alpha.password);
    betaAuth = await login(app, beta.email, beta.password);

    await seedProducts(alpha.businessId, alpha.userId, [
      { name: 'Alpha Widget', sku: 'ALP-1', priceMinor: 15000, costMinor: 9000, stock: 40 },
    ]);
    ({ products: [betaProduct] } = await seedProducts(beta.businessId, beta.userId, [
      { name: 'Beta Gadget', sku: 'BET-1', priceMinor: 25000, costMinor: 18000, stock: 12 },
    ]));
    alphaCustomer = await seedCustomer(alpha.businessId, alpha.userId, { name: 'Alpha Only Customer' });
  });

  it('scopes the product list to the caller’s own business', async () => {
    const asAlpha = expectOk(await api.get(app, '/api/products', alphaAuth.headers));
    expect(asAlpha).toHaveLength(1);
    expect(asAlpha[0].name).toBe('Alpha Widget');

    const asBeta = expectOk(await api.get(app, '/api/products', betaAuth.headers));
    expect(asBeta).toHaveLength(1);
    expect(asBeta[0].name).toBe('Beta Gadget');
  });

  it('returns 404 — not 403 — when reading another business’s document by id', async () => {
    // 404 avoids confirming that the id exists in a workspace the caller cannot see.
    const res = await api.get(app, `/api/products/${betaProduct._id}`, alphaAuth.headers);
    expectError(res, 404, 'NOT_FOUND');
  });

  it('refuses to update another business’s product', async () => {
    const res = await api.patch(
      app,
      `/api/products/${betaProduct._id}`,
      alphaAuth.headers,
      { name: 'Hijacked', sellingPrice: '1' }
    );
    expectError(res, 404);

    const untouched = await Product().findById(betaProduct._id).lean();
    expect(untouched.name).toBe('Beta Gadget');
  });

  it('refuses to adjust stock on another business’s product', async () => {
    const res = await api.post(
      app,
      `/api/products/${betaProduct._id}/stock`,
      alphaAuth.headers,
      { type: 'adjustment_out', quantity: 5, reason: 'tampering attempt' }
    );
    expect([400, 404]).toContain(res.status);
    const untouched = await Product().findById(betaProduct._id).lean();
    expect(untouched.stockQuantity).toBe(12);
  });

  it('ignores a client-supplied businessId and keeps the caller’s own scope', async () => {
    // `businessId` is not part of productListSchema, so validation strips it.
    const res = await api.get(app, `/api/products?businessId=${beta.businessId}`, alphaAuth.headers);
    const items = expectOk(res);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Alpha Widget');
  });

  it('refuses to switch the X-Business-Id header to a business the user does not belong to', async () => {
    const res = await api.get(app, '/api/products', {
      Authorization: `Bearer ${alphaAuth.token}`,
      'X-Business-Id': beta.businessId,
    });
    const error = expectError(res, 403, 'FORBIDDEN');
    // The denial must not confirm whether the other business exists or its name.
    expect(error.message).not.toContain(beta.businessName);
    expect(error.message).toBe('You do not have access to this business');
  });

  it('will not let a sale line reference a product from another business', async () => {
    const res = await api.post(app, '/api/sales', alphaAuth.headers, {
      customer: alphaCustomer._id,
      lines: [{ product: betaProduct._id, quantity: 1 }],
      invoiceStatus: 'paid',
      payments: [{ amount: '250', method: 'cash' }],
    });
    const error = expectError(res, 404);
    expect(error.message).toMatch(/Product not found/);

    // And beta's stock is untouched.
    const untouched = await Product().findById(betaProduct._id).lean();
    expect(untouched.stockQuantity).toBe(12);
  });

  it('will not let a payment be recorded against another business’s invoice', async () => {
    const sale = expectOk(
      await api.post(app, '/api/sales', betaAuth.headers, {
        customerName: 'Beta Walk-in',
        lines: [{ product: betaProduct._id, quantity: 1 }],
        invoiceStatus: 'unpaid',
      }),
      201
    );

    const res = await api.post(app, '/api/payments', alphaAuth.headers, {
      invoice: sale.invoice._id,
      amount: '100',
      method: 'cash',
    });
    expectError(res, 404);
  });

  it('keeps dashboard figures scoped — Alpha sees no Beta revenue', async () => {
    const sale = expectOk(
      await api.post(app, '/api/sales', betaAuth.headers, {
        customerName: 'Beta Walk-in',
        lines: [{ product: betaProduct._id, quantity: 3 }],
        invoiceStatus: 'paid',
        payments: [{ amount: '750', method: 'cash' }],
      }),
      201
    );
    expect(sale.sale.status).toBe('completed');

    const betaDash = expectOk(await api.get(app, '/api/dashboard/summary?preset=all', betaAuth.headers));
    expect(betaDash.kpis.totalOrders.value).toBe(1);
    expect(betaDash.kpis.todaySales.valueMinor).toBe(75000); // 3 x Rs.250 = Rs.750

    const alphaDash = expectOk(await api.get(app, '/api/dashboard/summary?preset=all', alphaAuth.headers));
    expect(alphaDash.kpis.totalOrders.value).toBe(0);
    expect(alphaDash.kpis.todaySales.valueMinor).toBe(0);
    expect(alphaDash.tables.recentTransactions).toHaveLength(0);
  });

  it('allows a user who belongs to two businesses to switch between them', async () => {
    // Give the alpha user membership in beta's workspace too.
    const BusinessMembership = mongoose.model('BusinessMembership');
    await BusinessMembership.create([
      { user: alpha.userId, business: beta.businessId, role: 'staff', status: 'active' },
    ]);

    const res = await api.post(app, '/api/auth/switch-business', alphaAuth.headers, {
      businessId: beta.businessId,
    });
    const data = expectOk(res);
    expect(data.business.id).toBe(String(beta.businessId));
    expect(data.membership.role).toBe('staff');

    const betaHeaders = { Authorization: `Bearer ${data.accessToken}` };
    const items = expectOk(await api.get(app, '/api/products', betaHeaders));
    expect(items[0].name).toBe('Beta Gadget');
  });

  it('blocks a suspended member from resolving their workspace', async () => {
    const BusinessMembership = mongoose.model('BusinessMembership');
    await BusinessMembership.updateOne(
      { user: alpha.userId, business: alpha.businessId },
      { $set: { status: 'suspended' } }
    );

    const res = await api.get(app, '/api/dashboard/summary', alphaAuth.headers);
    expectError(res, 403);
  });

  it('does not list customers from another business', async () => {
    const betaCustomers = await Customer().find({ business: beta.businessId }).lean();
    expect(betaCustomers).toHaveLength(0);

    const res = await api.get(app, `/api/customers/${alphaCustomer._id}`, betaAuth.headers);
    expectError(res, 404);
  });
});
