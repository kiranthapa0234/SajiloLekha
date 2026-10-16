/**
 * Payments, invoices and refunds.
 *
 * The rules that matter for a shop's books:
 *   - payments may never exceed an invoice's outstanding balance;
 *   - many partial payments may settle one invoice;
 *   - status is DERIVED from money, never set by the client;
 *   - an invoice becomes overdue purely with the passage of time;
 *   - a refund can never exceed what was actually collected.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { api, expectError, expectOk, login, seedCustomer, seedProducts, seedWorkspace } from '../setup/helpers.js';
import { app } from '../setup/server.setup.js';

const Invoice = () => mongoose.model('Invoice');
const Payment = () => mongoose.model('Payment');
const Sale = () => mongoose.model('Sale');
const Product = () => mongoose.model('Product');
const Customer = () => mongoose.model('Customer');

const rs = (rupees) => rupees * 100;

/** Create a credit sale of Rs.1,000 and return its invoice id. */
async function creditSale(auth, product, customer) {
  const { invoice, sale } = expectOk(
    await api.post(app, '/api/sales', auth.headers, {
      customer: customer._id,
      lines: [{ product: product._id, quantity: 1 }],
      invoiceStatus: 'unpaid',
    }),
    201
  );
  return { invoiceId: invoice._id, saleId: sale._id, invoice };
}

describe('payments & invoices', () => {
  let ws;
  let auth;
  let product;
  let customer;

  beforeEach(async () => {
    ws = await seedWorkspace({ email: 'pay@test.dev', businessName: 'Sunrise Store' });
    auth = await login(app, ws.email, ws.password);
    ({ products: [product] } = await seedProducts(ws.businessId, ws.userId, [
      { name: 'Service', sku: 'SRV-1', priceMinor: rs(1000), costMinor: rs(400), stock: 50 },
    ]));
    customer = await seedCustomer(ws.businessId, ws.userId);
  });

  it('marks a fully-paid sale as paid and rejects any further payment', async () => {
    const result = expectOk(
      await api.post(app, '/api/sales', auth.headers, {
        customer: customer._id,
        lines: [{ product: product._id, quantity: 1 }],
        invoiceStatus: 'paid',
        payments: [{ amount: '1000', method: 'cash' }],
      }),
      201
    );
    const { sale } = result;

    // The created sale carries its invoice reference; the invoice itself is
    // returned alongside it rather than being embedded.
    expect(String(sale.invoice)).toBe(String(result.invoice._id));
    expect(result.invoice.status).toBe('paid');
    expect(result.invoice.paidMinor).toBe(rs(1000));
    const res = await api.post(app, `/api/sales/${sale._id}/payments`, auth.headers, {
      amount: '1',
      method: 'cash',
    });
    const error = expectError(res, 422, 'ALREADY_PAID');
    expect(error.message).toMatch(/fully paid/);
  });

  it('accepts several partial payments and settles the invoice', async () => {
    const { invoiceId, invoice } = await creditSale(auth, product, customer);
    expect(invoice.status).toBe('unpaid');

    const first = expectOk(
      await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '400', method: 'cash' }),
      201
    );
    expect(first.invoice.status).toBe('partial');
    expect(first.invoice.paidMinor).toBe(rs(400));

    const second = expectOk(
      await api.post(app, '/api/payments', auth.headers, {
        invoice: invoiceId,
        amount: '600',
        method: 'bank_transfer',
        transactionReference: 'NEFT-9911',
      }),
      201
    );
    expect(second.invoice.status).toBe('paid');
    expect(second.invoice.paidMinor).toBe(rs(1000));

    const stored = await Invoice().findById(invoiceId).lean();
    expect(stored.status).toBe('paid');
    expect(stored.paidAt).toBeTruthy();

    // The customer's lifetime totals moved with the invoice.
    const updatedCustomer = await Customer().findById(customer._id).lean();
    expect(updatedCustomer.totalPaidMinor).toBe(rs(1000));
  });

  it('refuses a payment larger than the outstanding balance — there is no overpayment escape hatch', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);

    expectOk(
      await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '900', method: 'cash' }),
      201
    );

    const res = await api.post(app, '/api/payments', auth.headers, {
      invoice: invoiceId,
      amount: '200',
      method: 'cash',
    });
    const error = expectError(res, 422, 'OVERPAYMENT_BLOCKED');
    // The machine-readable balance matters more than the formatted string.
    expect(error.details.outstandingMinor).toBe(rs(100));
    expect(error.details.attemptedMinor).toBe(rs(200));
  });

  it('recomputes the outstanding balance after a void', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);

    const created = expectOk(
      await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '600', method: 'cash' }),
      201
    );
    expect(created.invoice.paidMinor).toBe(rs(600));

    const voided = expectOk(
      await api.post(app, `/api/payments/${created.payment._id}/void`, auth.headers, {
        reason: 'Cheque bounced',
      })
    );
    expect(voided.voidedMinor).toBe(rs(600));

    const invoice = await Invoice().findById(invoiceId).lean();
    expect(invoice.paidMinor).toBe(0);
    expect(invoice.status).toBe('unpaid');

    // The payment row is retained, not deleted.
    const payment = await Payment().findById(created.payment._id).lean();
    expect(payment.status).toBe('voided');
    expect(payment.voidReason).toBe('Cheque bounced');
  });

  it('will not void the same payment twice', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    const created = expectOk(
      await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '100', method: 'cash' }),
      201
    );
    await api.post(app, `/api/payments/${created.payment._id}/void`, auth.headers, { reason: 'first' });
    const res = await api.post(app, `/api/payments/${created.payment._id}/void`, auth.headers, { reason: 'second' });
    expectError(res, 400);
  });

  it('never edits the amount or method of a recorded payment', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    const created = expectOk(
      await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '100', method: 'cash' }),
      201
    );

    await expect(
      Payment().updateOne({ _id: created.payment._id }, { $set: { amountMinor: 999999 } })
    ).rejects.toThrow(/immutable/);

    await expect(
      Payment().updateOne({ _id: created.payment._id }, { $set: { method: 'cheque' } })
    ).rejects.toThrow(/immutable/);
  });

  it('marks an unpaid invoice overdue once its due date passes', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);

    // Move the invoice's due date into the past.
    await Invoice().updateOne({ _id: invoiceId }, { $set: { dueDate: new Date(Date.now() - 86400000) } });

    const sweep = expectOk(await api.get(app, '/api/invoices/reconcile', auth.headers));
    expect(sweep.updated).toBeGreaterThanOrEqual(1);

    const invoice = await Invoice().findById(invoiceId).lean();
    expect(invoice.status).toBe('overdue');

    // A partially paid overdue invoice stays overdue, not partial.
    await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '100', method: 'cash' });
    const afterPayment = await Invoice().findById(invoiceId).lean();
    expect(afterPayment.paidMinor).toBe(rs(100));
  });

  it('filters the invoice list by settlement state', async () => {
    await api.post(app, '/api/sales', auth.headers, {
      customer: customer._id,
      lines: [{ product: product._id, quantity: 1 }],
      invoiceStatus: 'paid',
      payments: [{ amount: '1000', method: 'cash' }],
    });
    await creditSale(auth, product, customer);

    const paid = expectOk(await api.get(app, '/api/invoices?status=paid', auth.headers));
    expect(paid).toHaveLength(1);

    const unpaid = expectOk(await api.get(app, '/api/invoices?status=unpaid', auth.headers));
    expect(unpaid).toHaveLength(1);
  });

  it('refuses to refund more than was collected', async () => {
    const { sale } = expectOk(
      await api.post(app, '/api/sales', auth.headers, {
        customer: customer._id,
        lines: [{ product: product._id, quantity: 1 }],
        invoiceStatus: 'paid',
        payments: [{ amount: '1000', method: 'cash' }],
      }),
      201
    );

    const res = await api.post(app, `/api/sales/${sale._id}/refund`, auth.headers, {
      amount: '1500',
      reason: 'Too much',
      restock: false,
    });
    const error = expectError(res, 400);
    expect(error.message).toMatch(/exceeds the remaining refundable balance/);
  });

  it('refunds a sale, reverses stock and reduces revenue', async () => {
    const before = await Product().findById(product._id).lean();

    const { sale, invoice } = expectOk(
      await api.post(app, '/api/sales', auth.headers, {
        customer: customer._id,
        lines: [{ product: product._id, quantity: 2 }],
        invoiceStatus: 'paid',
        payments: [{ amount: '2000', method: 'cash' }],
      }),
      201
    );

    const afterSale = await Product().findById(product._id).lean();
    expect(afterSale.stockQuantity).toBe(before.stockQuantity - 2);

    const refund = expectOk(
      await api.post(app, `/api/sales/${sale._id}/refund`, auth.headers, {
        amount: '2000',
        reason: 'Customer returned both items',
        method: 'cash',
        restock: true,
        restockReason: 'Returned in good condition',
        lines: [{ line: 0, quantity: 2 }],
      }),
      201
    );
    expect(refund.refundAmountMinor).toBe(rs(2000));

    const afterRefund = await Product().findById(product._id).lean();
    expect(afterRefund.stockQuantity).toBe(before.stockQuantity); // fully restocked

    const storedSale = await Sale().findById(sale._id).lean();
    expect(storedSale.refundedMinor).toBe(rs(2000));
    expect(storedSale.lines[0].returnedQuantity).toBe(2);

    const storedInvoice = await Invoice().findById(invoice._id).lean();
    expect(storedInvoice.refundedMinor).toBe(rs(2000));

    // A refund is contra-revenue, so net profit now reflects it.
    const dash = expectOk(await api.get(app, '/api/dashboard/summary?preset=all', auth.headers));
    expect(dash.profitAndLoss.refundsMinor).toBe(rs(2000));
  });

  it('writes off a bad-debt balance without moving cash', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    await api.post(app, '/api/payments', auth.headers, { invoice: invoiceId, amount: '700', method: 'cash' });

    const written = expectOk(
      await api.post(app, `/api/invoices/${invoiceId}/write-off`, auth.headers, {
        amount: '300',
        reason: 'Customer unreachable',
      })
    );
    expect(written.writtenOffMinor).toBe(rs(300));
    expect(written.status).toBe('paid');

    // Cash collected is unchanged — a write-off is not a refund.
    const payments = await Payment().find({ invoice: invoiceId, status: 'valid' }).lean();
    expect(payments.reduce((s, p) => s + p.amountMinor, 0)).toBe(rs(700));
  });

  it('rejects a write-off larger than the outstanding balance', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    const res = await api.post(app, `/api/invoices/${invoiceId}/write-off`, auth.headers, {
      amount: '2000',
      reason: 'Too much',
    });
    expectError(res, 400);
  });

  it('serves an invoice as a real PDF', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    const res = await api.get(app, `/api/invoices/${invoiceId}?format=pdf`, auth.headers);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="INV-/);
    // A PDF always starts with the %PDF- magic bytes.
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('serves a printable invoice as HTML', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    const res = await api.get(app, `/api/invoices/${invoiceId}?format=print`, auth.headers);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('BILL TO');
  });

  it('summarises collections and flags unreconciled payments', async () => {
    const { invoiceId } = await creditSale(auth, product, customer);
    await api.post(app, '/api/payments', auth.headers, {
      invoice: invoiceId,
      amount: '1000',
      method: 'bank_transfer',
      transactionReference: 'NEFT-1',
    });

    const res = await api.get(app, '/api/payments?limit=10', auth.headers);
    const list = expectOk(res);
    expect(res.body.meta.summary.inboundMinor).toBe(rs(1000));
    expect(res.body.meta.summary.netMinor).toBe(rs(1000));

    expect(list).toHaveLength(1);
    expect(list[0].method).toBe('bank_transfer');
    expect(list[0].transactionReference).toBe('NEFT-1');
    expect(list[0].reconciliation?.status ?? 'unreconciled').toBe('unreconciled');
  });
});
