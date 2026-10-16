/**
 * The money ledger: the workspace's own cash and bank position.
 *
 * Balance is derived by aggregation over the ledger rather than stored, so
 * these tests assert both the arithmetic and the invariants that make the
 * figure trustworthy: a credit sale moves nothing, a paid purchase reduces the
 * balance, a transfer never changes the total, and voiding a payment takes the
 * money back out.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { api, expectOk, login, seedProducts, seedWorkspace } from '../setup/helpers.js';
import { app } from '../setup/server.setup.js';

const Payment = () => mongoose.model('Payment');

const rs = (rupees) => rupees * 100;

describe('money balances', () => {
  let ws;
  let auth;
  let widget;

  beforeEach(async () => {
    ws = await seedWorkspace({ businessName: `Money Co ${Math.random().toString(36).slice(2, 7)}` });
    auth = await login(app, ws.email, ws.password, ws.businessId);
    ({ products: [widget] } = await seedProducts(ws.businessId, ws.userId, [
      { name: 'Ledger Widget', sku: `LW-${Math.random().toString(36).slice(2, 8)}`, stock: 100, costMinor: rs(20), priceMinor: rs(30) },
    ]));
  });

  const balances = async () => (await api.get(app, '/api/money/balances', auth.headers)).body.data;

  const open = (account, amount, reason) =>
    api.post(app, '/api/money/in', auth.headers, { account, kind: 'opening', amount, reason });

  it('starts at zero and only changes when the books say so', async () => {
    expect((await balances()).totalMinor).toBe(0);

    expectOk(await open('cash', 500, 'Cash in the till on day one'), 201);

    const b = await balances();
    expect(b.accounts.cash.totalMinor).toBe(rs(500));
    expect(b.accounts.bank.totalMinor).toBe(0);
    expect(b.totalMinor).toBe(rs(500));
  });

  it('adds a paid sale to the account its method settles into', async () => {
    expectOk(await open('bank', 1000, 'Bank balance to start'), 201);

    expectOk(
      await api.post(
        app,
        '/api/sales',
        auth.headers,
        { lines: [{ product: widget._id, quantity: 4 }], payments: [{ amount: 120, method: 'cash' }], invoiceStatus: 'paid' }
      ),
      201
    );

    const b = await balances();
    expect(b.accounts.cash.totalMinor).toBe(rs(120));
    expect(b.accounts.bank.totalMinor).toBe(rs(1000));
  });

  it('cuts the balance when a purchase is paid', async () => {
    expectOk(await open('bank', 1000, 'Bank balance to start'), 201);

    expectOk(
      await api.post(
        app,
        '/api/purchases',
        auth.headers,
        { lines: [{ product: widget._id, quantity: 10, costPrice: 20 }], payments: [{ amount: 200, method: 'bank_transfer' }] }
      ),
      201
    );

    expect((await balances()).accounts.bank.totalMinor).toBe(rs(800));
  });

  it('moves no money for a credit sale', async () => {
    expectOk(
      await api.post(
        app,
        '/api/sales',
        auth.headers,
        { lines: [{ product: widget._id, quantity: 3 }], invoiceStatus: 'unpaid' }
      ),
      201
    );
    expect((await balances()).totalMinor).toBe(0);
  });

  it('never changes the total when money moves between cash and bank', async () => {
    expectOk(await open('cash', 800, 'Cash in the till'), 201);
    const before = (await balances()).totalMinor;

    expectOk(
      await api.post(app, '/api/money/transfer', auth.headers, { from: 'cash', to: 'bank', amount: 300, reason: 'Cash into the bank' }),
      201
    );

    const b = await balances();
    expect(b.accounts.cash.totalMinor).toBe(rs(500));
    expect(b.accounts.bank.totalMinor).toBe(rs(300));
    expect(b.totalMinor).toBe(before);
  });

  it('refuses to take out more than the account holds', async () => {
    expectOk(await open('cash', 100, 'Cash in the till'), 201);

    const res = await api.post(
      app,
      '/api/money/out',
      auth.headers,
      { account: 'cash', kind: 'withdrawal', amount: 500, reason: 'More than we hold' }
    );
    expect(res.status).toBe(422);
    expect((await balances()).accounts.cash.totalMinor).toBe(rs(100));
  });

  it('takes the money back out when a receipt is voided', async () => {
    expectOk(await open('cash', 1000, 'Cash in the till'), 201);
    const sale = expectOk(
      await api.post(
        app,
        '/api/sales',
        auth.headers,
        { lines: [{ product: widget._id, quantity: 3 }], payments: [{ amount: 90, method: 'cash' }], invoiceStatus: 'paid' }
      ),
      201
    );
    expect((await balances()).accounts.cash.totalMinor).toBe(rs(1090));

    const receipt = await Payment().findOne({ sale: sale.sale._id, status: 'valid' }).lean();
    expectOk(
      await api.post(app, `/api/payments/${receipt._id}/void`, auth.headers, { reason: 'Keyed in twice' }),
      200
    );

    expect((await balances()).accounts.cash.totalMinor).toBe(rs(1000));
  });

  it('keeps one workspace out of another workspace balance', async () => {
    const other = await seedWorkspace({ businessName: 'Other Co', email: 'other@test.dev' });
    const otherAuth = await login(app, other.email, other.password, other.businessId);

    expectOk(await open('cash', 750, 'Money in one workspace'), 201);

    const theirs = (await api.get(app, '/api/money/balances', otherAuth.headers)).body.data;
    expect(theirs.totalMinor).toBe(0);
  });

  it('can re-derive the balance from the ledger rows alone', async () => {
    expectOk(await open('cash', 400, 'Opening float'), 201);
    expectOk(
      await api.post(app, '/api/money/transfer', auth.headers, { from: 'cash', to: 'bank', amount: 150, reason: 'Cash to bank' }),
      201
    );

    const rows = (await api.get(app, '/api/money/movements?limit=50', auth.headers)).body.data;
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.reason).toBeTruthy();

    const derived = rows.reduce((sum, m) => sum + (m.direction === 'in' ? m.amountMinor : -m.amountMinor), 0);
    expect(derived).toBe((await balances()).totalMinor);
  });

  it('lets a supplier debt be paid off later, and cuts the balance only then', async () => {
    // Regression: an unpaid purchase had no way to be settled afterwards, so
    // from the operator's side the debt was permanent.
    expectOk(await open('cash', 5000, 'Cash in the till'), 201);

    const created = expectOk(
      await api.post(
        app,
        '/api/purchases',
        auth.headers,
        { lines: [{ product: widget._id, quantity: 10, costPrice: 20 }] }
      ),
      201
    );
    const purchase = created.purchase;

    const owed = async () => {
      const res = await api.get(app, `/api/purchases/${purchase._id}`, auth.headers);
      return res.body.data.outstandingMinor;
    };

    expect(await owed()).toBe(rs(200));
    // Nothing has been paid, so no money has left the till.
    expect((await balances()).accounts.cash.totalMinor).toBe(rs(5000));

    expectOk(
      await api.post(app, `/api/purchases/${purchase._id}/payments`, auth.headers, { amount: 100, method: 'cash' }),
      201
    );
    expect(await owed()).toBe(rs(100));
    expect((await balances()).accounts.cash.totalMinor).toBe(rs(4900));

    const settled = await api.post(
      app,
      `/api/purchases/${purchase._id}/payments`,
      auth.headers,
      { amount: 100, method: 'cash' }
    );
    // The response carries the purchase as it now stands, so the screen can
    // show what is left without another request.
    expect(settled.body.data.purchase.outstandingMinor).toBe(0);
    expect(await owed()).toBe(0);
    expect((await balances()).accounts.cash.totalMinor).toBe(rs(4800));
  });

  it('refuses to pay a supplier more than is owed', async () => {
    const created = expectOk(
      await api.post(
        app,
        '/api/purchases',
        auth.headers,
        { lines: [{ product: widget._id, quantity: 2, costPrice: 20 }] }
      ),
      201
    );

    const over = await api.post(
      app,
      `/api/purchases/${created.purchase._id}/payments`,
      auth.headers,
      { amount: 500, method: 'cash' }
    );
    expect(over.status).toBeGreaterThanOrEqual(400);
  });

  describe('returning stock to a supplier who refunded us', () => {
    let ws;
    let auth;
    let widget;
    let supplier;

    beforeEach(async () => {
      // The outer beforeEach already claimed `owner@test.dev`, so this workspace
      // needs its own identity or the users collection rejects the duplicate.
      ws = await seedWorkspace({
        email: `returns-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        businessName: 'Returns Co',
      });
      auth = await login(app, ws.email, ws.password, ws.businessId);
      ({ products: [widget] } = await seedProducts(ws.businessId, ws.userId, [
        { name: 'Returnable Widget', sku: `RW-${Math.random().toString(36).slice(2, 8)}`, stock: 100, costMinor: rs(20), priceMinor: rs(30) },
      ]));
      supplier = expectOk(
        await api.post(app, '/api/suppliers', auth.headers, { name: 'Refund Depot' }),
        201
      );
    });

    const balances = async () => (await api.get(app, '/api/money/balances', auth.headers)).body.data;
    const stockNow = async () => {
      const r = await api.get(app, `/api/products/${widget._id}`, auth.headers);
      return r.body.data.stockQuantity;
    };
    /** List endpoints answer with a bare array when no pagination is asked for. */
    const movements = async () => {
      const d = (await api.get(app, '/api/money/movements', auth.headers)).body.data;
      return Array.isArray(d) ? d : (d.items ?? []);
    };

    /** Buy `qty` at cost 20, optionally paying. */
    async function buy(qty, payments = []) {
      return expectOk(
        await api.post(app, '/api/purchases', auth.headers, {
          supplier: supplier._id,
          lines: [{ product: widget._id, quantity: qty, costPrice: 20 }],
          payments,
        }),
        201
      );
    }

    const giveBack = (payload) =>
      api.post(app, '/api/purchases/returns', auth.headers, {
        product: widget._id,
        supplier: supplier._id,
        ...payload,
      });

    it('puts the money back in the account when the purchase was already paid', async () => {
      // The reported gap: stock for goods you paid for went away and the cash
      // did not come back, so the books showed a settled purchase for stock the
      // business no longer had.
      expectOk(await api.post(app, '/api/money/in', auth.headers, {
        account: 'cash', kind: 'opening', amount: '5000', reason: 'Cash in the till',
      }), 201);

      await buy(10, [{ amount: 200, method: 'cash' }]);
      expect((await balances()).accounts.cash.totalMinor).toBe(rs(5000) - rs(200));
      // The product was seeded with 100 on hand, so 10 more makes 110.
      expect(await stockNow()).toBe(110);

      const res = expectOk(await giveBack({ quantity: 3, refundAmount: 60, account: 'cash' }), 201);

      expect(res.cashBackMinor).toBe(rs(60));
      expect(res.debtCreditMinor).toBe(0);
      // Stock down, money back.
      expect(await stockNow()).toBe(107);
      expect((await balances()).accounts.cash.totalMinor).toBe(rs(5000) - rs(200) + rs(60));

      const refund = (await movements()).find((m) => m.kind === 'supplier_refund');
      expect(refund).toBeTruthy();
      expect(refund.direction).toBe('in');
      expect(refund.amountMinor).toBe(rs(60));
    });

    it('cancels the debt instead of inventing cash when the purchase was unpaid', async () => {
      // Nothing was ever paid, so a refund must reduce what is owed. Crediting
      // the till here would be money the business never received.
      await buy(10);
      expect((await balances()).totalMinor).toBe(0);

      const purchase = (await api.get(app, '/api/purchases?limit=1', auth.headers)).body.data[0];
      expect(purchase.outstandingMinor).toBe(rs(200));

      const res = expectOk(
        await giveBack({ quantity: 3, refundAmount: 60, purchase: purchase._id }),
        201
      );

      expect(res.debtCreditMinor).toBe(rs(60));
      expect(res.cashBackMinor).toBe(0);
      // No money was created.
      expect((await balances()).totalMinor).toBe(0);

      const after = (await api.get(app, `/api/purchases/${purchase._id}`, auth.headers)).body.data;
      expect(after.totalMinor).toBe(rs(140));
      expect(after.outstandingMinor).toBe(rs(140));
    });

    it('splits the refund when the bill is partly settled', async () => {
      expectOk(await api.post(app, '/api/money/in', auth.headers, {
        account: 'cash', kind: 'opening', amount: '1000', reason: 'Cash in the till',
      }), 201);
      // Paid half of a Rs.200 bill, so Rs.100 is still owed.
      const made = await buy(10, [{ amount: 100, method: 'cash' }]);
      expect((await api.get(app, `/api/purchases/${made.purchase._id}`, auth.headers)).body.data.outstandingMinor).toBe(rs(100));

      // Rs.60 back against Rs.100 still owed: the debt absorbs all of it and no
      // cash moves, because the supplier never handed any over.
      const res = expectOk(
        await giveBack({ quantity: 3, refundAmount: 60, purchase: made.purchase._id }),
        201
      );
      expect(res.debtCreditMinor).toBe(rs(60));
      expect(res.cashBackMinor).toBe(0);
      expect((await balances()).accounts.cash.totalMinor).toBe(rs(900));
    });

    it('cancels the debt first and returns the rest as cash', async () => {
      expectOk(await api.post(app, '/api/money/in', auth.headers, {
        account: 'bank', kind: 'opening', amount: '1000', reason: 'Banked',
      }), 201);
      expectOk(await api.post(app, '/api/money/in', auth.headers, {
        account: 'cash', kind: 'opening', amount: '1000', reason: 'Cash in the till',
      }), 201);
      // Rs.200 bill, Rs.40 already paid, so Rs.160 is still owed.
      const made = await buy(10, [{ amount: 40, method: 'cash' }]);
      expect((await api.get(app, `/api/purchases/${made.purchase._id}`, auth.headers)).body.data.outstandingMinor).toBe(rs(160));

      // Rs.200 back: Rs.160 clears the debt, the remaining Rs.40 is real cash.
      const res = expectOk(
        await giveBack({ quantity: 5, refundAmount: 200, purchase: made.purchase._id, account: 'bank' }),
        201
      );
      expect(res.debtCreditMinor).toBe(rs(160));
      expect(res.cashBackMinor).toBe(rs(40));

      const after = (await api.get(app, `/api/purchases/${made.purchase._id}`, auth.headers)).body.data;
      expect(after.outstandingMinor).toBe(0);
      expect((await balances()).accounts.bank.totalMinor).toBe(rs(1040));
    });

    it('refuses to return more units than are on hand', async () => {
      const res = await giveBack({ quantity: 500, refundAmount: 100 });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    });

    it('refuses to credit a purchase belonging to a different supplier', async () => {
      const other = expectOk(await api.post(app, '/api/suppliers', auth.headers, { name: 'Someone Else' }), 201);
      const made = await buy(2);

      const res = await giveBack({ quantity: 1, refundAmount: 20, purchase: made.purchase._id, supplier: other._id });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses a return with no supplier or no quantity', async () => {
      expect((await giveBack({ refundAmount: 10 })).status).toBe(422);
      expect((await giveBack({ quantity: 1 })).status).toBe(422);
      expect((await giveBack({ quantity: 1, refundAmount: 10, supplier: 'nope' })).status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('the balance can never go negative', () => {
    /** A purchase left unpaid, so the till is empty and the debt is real. */
    async function buyOnCredit(costPrice, quantity) {
      const created = expectOk(
        await api.post(
          app,
          '/api/purchases',
          auth.headers,
          { lines: [{ product: widget._id, quantity, costPrice }] }
        ),
        201
      );
      return created.purchase;
    }

    it('refuses to pay a supplier from a till that does not hold the money', async () => {
      // The reported problem: paying for stock drove the balance below zero
      // instead of complaining. Balance is sum(in) - sum(out), so an oversized
      // outbound row does not borrow, it just makes the figure wrong -- and
      // movements are voided rather than deleted, so it stays wrong.
      const purchase = await buyOnCredit(100, 5); // Rs.500 owed, Rs.0 in the till

      const res = await api.post(app, `/api/purchases/${purchase._id}/payments`, auth.headers, {
        amount: 500,
        method: 'cash',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
      expect(res.body.error.message).toMatch(/not enough cash/i);
    });

    it('refuses to pay at purchase time when the money is not there', async () => {
      expectOk(await open('cash', 100, 'A little cash'), 201);

      const res = await api.post(app, '/api/purchases', auth.headers, {
        lines: [{ product: widget._id, quantity: 10, costPrice: 50 }], // Rs.500
        payments: [{ amount: 500, method: 'cash' }],
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');

      // Nothing partial is left behind: no stock added, no debt, no movement.
      expect((await balances()).totalMinor).toBe(rs(100));
      const purchases = await api.get(app, '/api/purchases', auth.headers);
      // No query params, so the list endpoint answers with the rows themselves.
      expect(purchases.body.data).toEqual([]);
    });

    it('leaves the balance and the debt untouched when it refuses', async () => {
      const purchase = await buyOnCredit(100, 5);
      const before = await balances();

      await api.post(app, `/api/purchases/${purchase._id}/payments`, auth.headers, {
        amount: 500,
        method: 'cash',
      });

      // The debt is still owed in full, so a later, affordable payment still works.
      const detail = await api.get(app, `/api/purchases/${purchase._id}`, auth.headers);
      expect(detail.body.data.outstandingMinor).toBe(rs(500));
      expect(detail.body.data.paidMinor).toBe(0);
      expect((await balances()).totalMinor).toBe(before.totalMinor);
    });

    it('names the shortfall and points at the account that does hold the money', async () => {
      // Cash is empty and the bank is full. Paying by cash must still fail:
      // the cash ledger is the one that would go negative.
      expectOk(await open('bank', 5000, 'Banked money'), 201);
      const purchase = await buyOnCredit(100, 5);

      const res = await api.post(app, `/api/purchases/${purchase._id}/payments`, auth.headers, {
        amount: 500,
        method: 'cash',
      });

      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
      expect(res.body.error.details).toMatchObject({
        account: 'cash',
        availableMinor: 0,
        requestedMinor: rs(500),
        shortfallMinor: rs(500),
        otherAccount: 'bank',
        otherAvailableMinor: rs(5000),
      });
      // The message has to be actionable, not just a code.
      expect(res.body.error.message).toMatch(/500\.00/);
      expect(res.body.error.message).toMatch(/bank/i);

      // Paying by bank works, because the bank is the account being debited.
      expectOk(
        await api.post(app, `/api/purchases/${purchase._id}/payments`, auth.headers, {
          amount: 500,
          method: 'bank_transfer',
        }),
        201
      );
      expect((await balances()).accounts.bank.totalMinor).toBe(rs(4500));
    });

    it('says the account is overdrawn, rather than "you have -6,000"', async () => {
      // A workspace that paid suppliers before an opening balance was recorded is
      // already negative -- the guard stops new ones but cannot rewrite history.
      // Reporting "you have -6,436,384.20" is nonsense; the honest message is
      // that the position has to be corrected first.
      const MoneyMovement = mongoose.model('MoneyMovement');
      await MoneyMovement.create({
        business: ws.businessId,
        account: 'cash',
        direction: 'out',
        amountMinor: rs(900),
        kind: 'purchase',
        reason: 'Legacy payment recorded before the overdraft guard existed',
        related: { type: 'Manual' },
        occurredAt: new Date(),
      });

      const purchase = await buyOnCredit(100, 5); // Rs.500 owed

      const res = await api.post(app, `/api/purchases/${purchase._id}/payments`, auth.headers, {
        amount: 500,
        method: 'cash',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
      expect(res.body.error.details.overdrawn).toBe(true);
      expect(res.body.error.details.availableMinor).toBe(rs(-900));
      expect(res.body.error.message).toMatch(/already overdrawn/i);
      expect(res.body.error.message).toMatch(/opening balance/i);
      // It must not claim the operator has a negative amount of money.
      expect(res.body.error.message).not.toMatch(/you have -\d/);
    });

    it('still accepts a sale payment, because money arriving cannot overdraw', async () => {
      // The guard is on the way out only. A customer paying in cash into an
      // empty till is the normal case, and must not be blocked.
      expectOk(
        await api.post(
          app,
          '/api/sales',
          auth.headers,
          { lines: [{ product: widget._id, quantity: 2 }], payments: [{ amount: 60, method: 'cash' }], invoiceStatus: 'paid' }
        ),
        201
      );
      expect((await balances()).accounts.cash.totalMinor).toBe(rs(60));
    });
  });
});
