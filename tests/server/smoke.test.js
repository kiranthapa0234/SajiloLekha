/**
 * Smoke test: prove the app boots, registers, logs in, and serves a real
 * (empty-but-computed) dashboard. If this fails, nothing else matters.
 */
import { describe, expect, it } from 'vitest';
import { api, expectOk, login, registerViaApi, seedWorkspace } from '../setup/helpers.js';
import { app } from '../setup/server.setup.js';

describe('smoke: application boots and serves', () => {
  it('answers the health probe', async () => {
    const res = await api.get(app, '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('up');
    expect(res.body.data.transactions).toBe(true);
  });

  it('answers 404 for an unknown public route and 401 for an unknown protected one', async () => {
    // The public auth surface can confirm that a path does not exist.
    const publicRes = await api.get(app, '/api/auth/does-not-exist');
    expect(publicRes.status).toBe(404);
    expect(publicRes.body.success).toBe(false);
    expect(publicRes.body.error.code).toBe('NOT_FOUND');

    // Protected paths return 401 first, so route existence is not disclosed.
    const protectedRes = await api.get(app, '/api/does-not-exist');
    expect(protectedRes.status).toBe(401);
    expect(protectedRes.body.error.code).toBe('UNAUTHORIZED');
  });

  it('blocks Mongo operator injection at the boundary', async () => {
    const reg = await registerViaApi(app, {
      name: 'Injection Probe',
      email: `inject-${Date.now()}@test.dev`,
      password: 'Sup3rSecret!',
      businessName: 'Probe Store',
    });
    const headers = { Authorization: `Bearer ${reg.body.data.accessToken}` };

    const res = await api.post(app, '/api/customers', headers, {
      name: 'Attacker',
      phone: '9800000000',
      $where: 'this.passwordHash != null',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not accepted from clients/);
  });

  it('refuses unauthenticated access to tenant data', async () => {
    const res = await api.get(app, '/api/dashboard/summary');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('registers a user with a business, then returns a live dashboard', async () => {
    const reg = await registerViaApi(app, {
      name: 'Smoke Owner',
      email: `smoke-${Date.now()}@test.dev`,
      password: 'Sup3rSecret!',
      businessName: 'Sunrise Store',
      businessCurrency: 'NPR',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.business.name).toBe('Sunrise Store');
    expect(reg.body.data.membership.role).toBe('owner');
    expect(reg.body.data.accessToken).toBeTruthy();

    const headers = { Authorization: `Bearer ${reg.body.data.accessToken}` };
    const dash = await api.get(app, '/api/dashboard/summary?preset=today', headers);
    const data = expectOk(dash);

    // Figures are computed, not faked: a brand-new workspace is all zeros.
    expect(data.kpis.todaySales.valueMinor).toBe(0);
    expect(data.kpis.totalOrders.value).toBe(0);
    expect(data.kpis.netProfit.valueMinor).toBe(0);
    expect(data.kpis.outstanding.valueMinor).toBe(0);
    expect(data.kpis.totalExpenses.valueMinor).toBe(0);
    expect(data.kpis.lowStock.value).toBe(0);
    expect(data.charts.salesOverview.series.length).toBeGreaterThan(0);
    expect(data.charts.paymentMethods.items).toEqual([]);
    expect(data.tables.recentTransactions).toEqual([]);
  });

  it('logs in with seeded credentials and rejects a wrong password', async () => {
    const { email, password } = await seedWorkspace({ email: `smoke-${Date.now()}@test.dev` });

    const ok = await login(app, email, password);
    expect(ok.body.user.email).toBe(email);

    const bad = await api.post(app, '/api/auth/login', {}, { email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    // The message must not reveal whether the account exists.
    expect(bad.body.error.message).toBe('Incorrect email or password');
  });

  it('answers the aggregation endpoints on an empty workspace', async () => {
    // Regression: `/api/expenses/totals` read the `$facet` result as if it were
    // the facet document instead of the array Mongo actually returns, so every
    // facet was undefined and the endpoint answered 500. The Expenses screen
    // calls this on mount, so a brand-new workspace could not open it at all.
    const ws = await seedWorkspace({ email: `aggr-${Date.now()}@test.dev` });
    const auth = await login(app, ws.email, ws.password, ws.businessId);
    const headers = auth.headers;

    const totals = await api.get(app, '/api/expenses/totals', headers);
    expect(totals.status).toBe(200);
    expect(totals.body.data).toMatchObject({
      daily: expect.any(Array),
      monthly: expect.any(Array),
      yearly: expect.any(Array),
      totals: expect.objectContaining({ totalMinor: expect.any(Number) }),
    });

    // And once a record exists, the figures are real rather than merely present.
    await expectOk(
      await api.post(app, '/api/expenses', headers, {
        title: 'Shop rent',
        category: 'rent',
        amount: '4500',
        vendor: 'Landlord',
        spentAt: '2026-03-05T00:00:00.000Z',
        paymentMethod: 'cash',
      }),
      201
    );

    const after = await api.get(app, '/api/expenses/totals', headers);
    expect(after.status).toBe(200);
    expect(after.body.data.totals.totalMinor).toBe(450000);
    expect(after.body.data.totals.count).toBe(1);
    expect(after.body.data.monthly).toHaveLength(1);
    expect(after.body.data.monthly[0]).toMatchObject({ month: '2026-03', totalMinor: 450000, count: 1 });
  });
});
