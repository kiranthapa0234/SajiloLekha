/**
 * Test helpers: build realistic workspaces with real documents and drive the API
 * through Supertest exactly as the SPA would.
 */
import supertest from 'supertest';
import mongoose from 'mongoose';
import { hashPassword } from '../../server/src/services/password.service.js';

export { supertest };

export const oid = () => new mongoose.Types.ObjectId().toString();

/** Create a user + business + membership directly (faster than going through the API). */
export async function seedWorkspace({
  email = 'owner@test.dev',
  password = 'Sup3rSecret!',
  name = 'Test Owner',
  businessName = 'Sunrise Store',
  currency = 'NPR',
  settings = {},
} = {}) {
  const User = mongoose.model('User');
  const Business = mongoose.model('Business');
  const BusinessMembership = mongoose.model('BusinessMembership');

  const [user] = await User.create([
    { name, email, passwordHash: await hashPassword(password), emailVerified: true },
  ]);

  const [business] = await Business.create([
    {
      name: businessName,
      email,
      settings: { currency, currencySymbol: 'Rs.', currencyDecimals: 2, ...settings },
      createdBy: user._id,
    },
  ]);

  const [membership] = await BusinessMembership.create([
    { user: user._id, business: business._id, role: 'owner', status: 'active' },
  ]);

  await user.updateOne({ $set: { lastActiveBusiness: business._id } });

  return { user, business, membership, password, email: user.email, userId: user._id, businessId: business._id };
}

/** Log in over HTTP and return the auth headers for subsequent calls. */
export async function login(app, email, password = 'Sup3rSecret!', businessId) {
  const res = await supertest(app).post('/api/auth/login').send({ email, password, businessId });
  if (res.status !== 200) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.data.accessToken,
    headers: { Authorization: `Bearer ${res.body.data.accessToken}`, 'X-Business-Id': res.body.data.business?.id },
    body: res.body.data,
    cookies: res.headers['set-cookie'],
  };
}

export async function registerViaApi(app, payload) {
  return supertest(app).post('/api/auth/register').send(payload);
}

/** Seed a catalogue: categories + products with known costs and prices. */
export async function seedProducts(businessId, userId, products = []) {
  const Product = mongoose.model('Product');
  const ProductCategory = mongoose.model('ProductCategory');

  const [category] = await ProductCategory.create([
    { business: businessId, name: 'General', color: '#7657E8', createdBy: userId },
  ]);

  const docs = products.map((p) => ({
    business: businessId,
    category: category._id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    unit: p.unit ?? 'pcs',
    costPriceMinor: p.costMinor ?? 10000,
    sellingPriceMinor: p.priceMinor ?? 15000,
    averageCostMinor: p.costMinor ?? 10000,
    stockQuantity: p.stock ?? 50,
    minStockLevel: p.minStock ?? 5,
    isTrackable: p.isTrackable ?? true,
    createdBy: userId,
  }));

  const created = await Product.insertMany(docs);
  return { category, products: created };
}

export async function seedCustomer(businessId, userId, overrides = {}) {
  const Customer = mongoose.model('Customer');
  const [customer] = await Customer.create([
    {
      business: businessId,
      name: 'Aarav Sharma',
      phone: '9800000001',
      customerCode: 'CUST-0001',
      ...overrides,
      createdBy: userId,
    },
  ]);
  return customer;
}

export async function seedExpense(businessId, userId, overrides = {}) {
  const Expense = mongoose.model('Expense');
  const [expense] = await Expense.create([
    {
      business: businessId,
      title: 'Shop rent',
      category: 'rent',
      amountMinor: 2500000,
      paymentMethod: 'cash',
      spentAt: new Date(),
      ...overrides,
      createdBy: userId,
    },
  ]);
  return expense;
}

/**
 * Reference monetary conversions used throughout the assertions.
 * For NPR: 1 rupee = 100 paisa = 100 minor units.
 */
export const RUPEE = (rupees) => Math.round(rupees * 100);

const withHeaders = (req, headers) => (headers ? req.set(headers) : req);

export const api = {
  get: (app, url, headers) => withHeaders(supertest(app).get(url), headers),
  post: (app, url, headers, body) => withHeaders(supertest(app).post(url), headers).send(body ?? {}),
  patch: (app, url, headers, body) => withHeaders(supertest(app).patch(url), headers).send(body ?? {}),
  put: (app, url, headers, body) => withHeaders(supertest(app).put(url), headers).send(body ?? {}),
  del: (app, url, headers, body) =>
    body ? withHeaders(supertest(app).delete(url), headers).send(body) : withHeaders(supertest(app).delete(url), headers),
};

/** Assert the standard failure envelope. */
export function expectError(res, status, code) {
  if (res.status !== status) {
    throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  if (res.body.success !== false) throw new Error('Expected success:false envelope');
  if (code && res.body.error.code !== code) {
    throw new Error(`Expected code ${code}, got ${res.body.error.code}: ${res.body.error.message}`);
  }
  return res.body.error;
}

export function expectOk(res, status = 200) {
  if (res.status !== status) {
    throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  if (res.body.success !== true) throw new Error('Expected success:true envelope');
  return res.body.data;
}
