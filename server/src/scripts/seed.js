/**
 * Development seed.
 *
 * Creates a realistic workspace so the dashboard shows something meaningful on
 * first run. Everything is real records written through the real services, so
 * every figure the dashboard reports is genuinely computed from the database —
 * nothing here fabricates a display value.
 *
 *   npm run seed           # create if absent
 *   npm run seed:reset     # wipe this workspace's data and rebuild
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import mongoose from 'mongoose';

import env from '../config/env.js';
import { connect, disconnect } from '../config/database.js';
import User from '../models/User.js';
import Business from '../models/Business.js';
import BusinessMembership from '../models/BusinessMembership.js';
import Product from '../models/Product.js';
import ProductCategory from '../models/ProductCategory.js';
import StockMovement from '../models/StockMovement.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Expense from '../models/Expense.js';
import Sale from '../models/Sale.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Purchase from '../models/Purchase.js';

import { hashPassword } from '../services/password.service.js';
import { createSale, refundSale } from '../services/sale.service.js';
import { recordInvoicePayment } from '../services/payment.service.js';
import { createPurchase } from '../services/purchase.service.js';
import { createExpense } from '../services/expense.service.js';
import { createCustomer } from '../services/customer.service.js';
import { createSupplier } from '../services/supplier.service.js';
import { createProduct } from '../services/product.service.js';
import { createMoneyContext } from '../services/money.context.js';
import { reconcileStatuses } from '../services/invoice.service.js';

const RESET = process.argv.includes('--reset');
const DAYS = Number(process.env.SEED_DAYS ?? 45);

/** Deterministic pseudo-random so repeated seeds produce comparable data. */
function makeRandom(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = makeRandom(Number(process.env.SEED_RANDOM_SEED ?? 20260814));

const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

const daysAgo = (days, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, between(0, 59), between(0, 59), 0);
  return date;
};

const CATALOGUE = [
  { name: 'Cotton T-shirt', sku: 'TS-001', category: 'Apparel', cost: 900, price: 1500, stock: 120, min: 20, unit: 'pcs' },
  { name: 'Denim jeans', sku: 'JN-014', category: 'Apparel', cost: 2400, price: 3800, stock: 64, min: 15, unit: 'pcs' },
  { name: 'Woolen scarf', sku: 'SC-007', category: 'Apparel', cost: 450, price: 850, stock: 8, min: 20, unit: 'pcs' },
  { name: 'Canvas tote bag', sku: 'BG-021', category: 'Accessories', cost: 600, price: 1100, stock: 95, min: 25, unit: 'pcs' },
  { name: 'Leather wallet', sku: 'WL-032', category: 'Accessories', cost: 1100, price: 1900, stock: 42, min: 12, unit: 'pcs' },
  { name: 'Running shoes', sku: 'SH-050', category: 'Footwear', cost: 3200, price: 5200, stock: 37, min: 10, unit: 'pair' },
  { name: 'Cotton socks (3-pack)', sku: 'SK-062', category: 'Apparel', cost: 250, price: 550, stock: 5, min: 30, unit: 'pack' },
  { name: 'Raincoat', sku: 'RC-073', category: 'Apparel', cost: 1800, price: 2900, stock: 0, min: 8, unit: 'pcs' },
  { name: 'Beanie (winter)', sku: 'BN-084', category: 'Accessories', cost: 320, price: 650, stock: 54, min: 18, unit: 'pcs' },
  { name: 'Wool socks', sku: 'WS-095', category: 'Apparel', cost: 420, price: 780, stock: 31, min: 15, unit: 'pair' },
  { name: 'Gift wrapping', sku: 'GW-101', category: 'Services', cost: 40, price: 120, stock: 500, min: 50, unit: 'pcs', isTrackable: false },
  { name: 'Alteration service', sku: 'AL-110', category: 'Services', cost: 0, price: 500, stock: 0, min: 0, unit: 'service', isTrackable: false },
];

const CUSTOMERS = [
  { name: 'Aarav Sharma', phone: '9800000001', creditLimit: 25000 },
  { name: 'Sita Gurung', phone: '9800000002', creditLimit: 15000 },
  { name: 'Bikash Thapa', phone: '9800000003', creditLimit: 40000 },
  { name: 'Maya Rai', phone: '9800000004' },
  { name: 'Rajesh Karki', phone: '9800000005', creditLimit: 80000 },
  { name: 'Prativa Adhikari', phone: '9800000006' },
  { name: 'Nabin Lama', phone: '9800000007', creditLimit: 30000 },
  { name: 'Sunita Magar', phone: '9800000008' },
];

const SUPPLIERS = [
  { name: 'Bharat Distributors', contactPerson: 'Ramesh Shrestha', phone: '9811111111', paymentTermsDays: 30 },
  { name: 'Himalaya Textiles', contactPerson: 'Sita Basnet', phone: '9811111112', paymentTermsDays: 15 },
  { name: 'Everest Footwear', contactPerson: 'Bikash Gurung', phone: '9811111113', paymentTermsDays: 45 },
];

const EXPENSES = [
  { title: 'Monthly shop rent', category: 'rent', amount: 45000, method: 'bank_transfer' },
  { title: 'Electricity bill', category: 'utilities', amount: 8500, method: 'cash' },
  { title: 'Staff salary', category: 'salary', amount: 120000, method: 'bank_transfer' },
  { title: 'Packaging materials', category: 'supplies', amount: 6200, method: 'cash' },
  { title: 'Shop signage', category: 'marketing', amount: 15000, method: 'card' },
  { title: 'Internet and phone', category: 'internet', amount: 3200, method: 'digital_wallet' },
  { title: 'Delivery fuel', category: 'transport', amount: 2800, method: 'cash' },
  { title: 'Shop maintenance', category: 'maintenance', amount: 4500, method: 'cash' },
  { title: 'Local licence fee', category: 'fees', amount: 7500, method: 'cash' },
  { title: 'Cleaning supplies', category: 'supplies', amount: 1800, method: 'cash' },
];

const METHODS = ['cash', 'bank_transfer', 'card', 'digital_wallet'];

/** Tenant-scoped context, shaped exactly like `req.ctx`. */
const contextFor = (user, business) => ({
  user,
  userId: user._id,
  business,
  businessId: business._id,
  membership: { role: 'owner' },
  role: 'owner',
  permissions: [],
  ip: '127.0.0.1',
  userAgent: 'lekhapana-seed',
});

async function wipe(userId, businessId) {
  const scoped = {
    User: { _id: userId },
    Business: { _id: businessId },
    BusinessMembership: { business: businessId },
    Product: { business: businessId },
    ProductCategory: { business: businessId },
    StockMovement: { business: businessId },
    Customer: { business: businessId },
    Supplier: { business: businessId },
    Expense: { business: businessId },
    Sale: { business: businessId },
    Invoice: { business: businessId },
    Payment: { business: businessId },
    Purchase: { business: businessId },
  };

  for (const [model, filter] of Object.entries(scoped)) {
    // eslint-disable-next-line no-await-in-loop
    await mongoose.model(model).deleteMany(filter);
  }
  console.log(`  wiped ${Object.keys(scoped).length} collections`);
}

async function seed() {
  console.log(`\nSajiloLekha seed — ${env.nodeEnv} -> ${env.mongo.uri}\n`);

  await connect();

  const email = env.seed.adminEmail.toLowerCase();
  const existingUser = await User.findByEmail(email, true);

  let user = existingUser;
  let business = existingUser ? await Business.findOne({ createdBy: existingUser._id }) : null;

  if (existingUser && business && !RESET) {
    console.log(`Workspace "${business.name}" already exists.`);
    console.log(`Re-run with --reset to rebuild it, or sign in at ${env.clientUrl}`);
    console.log(`  email:    ${email}`);
    console.log(`  password: ${env.seed.adminPassword}\n`);
    await disconnect();
    return;
  }

  if (existingUser && business && RESET) {
    console.log('Resetting existing workspace…');
    await wipe(existingUser._id, business._id);
    user = existingUser;
  } else if (!user) {
    console.log('Creating owner and workspace…');
    user = await User.create({
      name: env.seed.adminName,
      email,
      passwordHash: await hashPassword(env.seed.adminPassword),
      emailVerified: true,
    });
    business = await Business.create({
      name: 'Sunrise Store',
      legalName: 'Sunrise Store Pvt. Ltd.',
      email,
      phone: '9800000000',
      address: { line1: 'New Road', city: 'Kathmandu', state: 'Bagmati', postalCode: '44600', country: 'Nepal' },
      taxNumber: '601234567',
      settings: {
        currency: env.business.currency,
        currencySymbol: env.business.currencySymbol,
        timezone: env.business.timezone,
        locale: env.business.locale,
        invoicePrefix: 'INV',
        invoiceDueDays: 14,
        taxEnabled: true,
        taxRatePercent: 13,
        taxLabel: 'VAT',
        maxDiscountPercent: 20,
        receiptFooter: 'Thank you for shopping with us. Goods once sold are not returnable after 7 days.',
        terms: 'Payment due within 14 days. Late balances accrue no interest unless agreed in writing.',
      },
      createdBy: user._id,
    });
    await BusinessMembership.create({
      user: user._id,
      business: business._id,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });
  }

  // Re-read so `settings` merges (a reset keeps the document we just wiped).
  business = await Business.findById(business._id);
  await user.updateOne({ $set: { lastActiveBusiness: business._id } });

  const ctx = contextFor(user, business);
  const money = createMoneyContext(business);

  console.log('\nCreating catalogue…');
  const categories = {};
  for (const name of [...new Set(CATALOGUE.map((p) => p.category))]) {
    const [category] = await ProductCategory.create([{ business: business._id, name, createdBy: user._id }]);
    categories[name] = category;
  }

  const products = [];
  for (const item of CATALOGUE) {
    // eslint-disable-next-line no-await-in-loop
    const product = await createProduct(ctx, {
      name: item.name,
      sku: item.sku,
      category: categories[item.category]._id,
      unit: item.unit,
      costPrice: item.cost.toFixed(2),
      sellingPrice: item.price.toFixed(2),
      taxPercent: business.settings.taxEnabled ? business.settings.taxRatePercent : 0,
      stockQuantity: String(item.stock),
      minStockLevel: String(item.min),
      isTrackable: item.isTrackable ?? true,
      openingStockReason: 'Opening inventory count',
    });
    // `createProduct` returns a lean document with virtuals, so the seed can
    // read live stock and pricing straight off it.
    products.push(product);
  }
  console.log(`  ${products.length} products across ${Object.keys(categories).length} categories`);

  console.log('Creating suppliers and customers…');
  const suppliers = [];
  for (const supplier of SUPPLIERS) {
    // eslint-disable-next-line no-await-in-loop
    suppliers.push(await createSupplier(ctx, supplier));
  }
  const customers = [];
  for (const customer of CUSTOMERS) {
    // eslint-disable-next-line no-await-in-loop
    customers.push(await createCustomer(ctx, customer));
  }
  console.log(`  ${suppliers.length} suppliers, ${customers.length} customers`);

  console.log('Recording purchases…');
  for (let i = 0; i < 3; i += 1) {
    const lines = [];
    for (let n = 0; n < between(2, 4); n += 1) {
      const product = pick(products);
      if (lines.some((l) => String(l.product) === String(product._id))) continue;
      lines.push({
        product: product._id,
        quantity: between(10, 40),
        costPrice: money.toDecimal(product.averageCostMinor ?? product.costPriceMinor),
      });
    }
    if (lines.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    await createPurchase(ctx, {
      supplier: suppliers[i]._id,
      reference: `GRN-${new Date().getFullYear()}-${100 + i}`,
      purchasedAt: daysAgo(DAYS - 5 - i * 4, 11),
      lines,
      payments: i === 0 ? [] : [{ amount: (lines.reduce((s, l) => s + l.costPrice * l.quantity, 0) / 2).toFixed(2), method: 'bank_transfer' }],
    });
  }
  console.log(`  ${await Purchase.countDocuments({ business: business._id })} purchases recorded`);

  console.log('Recording expenses…');
  for (let day = DAYS; day >= 0; day -= 1) {
    // Expenses land a few times a week.
    if (random() > 0.28) continue;
    const template = pick(EXPENSES);
    // eslint-disable-next-line no-await-in-loop
    await createExpense(ctx, {
      ...template,
      amount: template.amount.toFixed(2),
      paymentMethod: template.method,
      spentAt: daysAgo(day, 17),
      vendor: random() > 0.5 ? pick(SUPPLIERS).name : '',
    });
  }
  console.log(`  ${await Expense.countDocuments({ business: business._id })} expenses recorded`);

  console.log(`Recording ${DAYS} days of sales…`);
  let saleCount = 0;
  let unpaidCount = 0;

  // Services (gift wrapping, alterations) have no tracked quantity, so they
  // cannot appear on a sale line. Filtering here keeps the seed honest about
  // what the API accepts rather than papering over rejected sales.
  const trackable = products.filter((p) => p.isTrackable !== false);

  for (let day = DAYS; day >= 0; day -= 1) {
    // Weekends are busier.
    const weekday = new Date(Date.now() - day * 86400000).getDay();
    const base = weekday === 0 || weekday === 6 ? 4 : 3;
    const salesToday = base + between(0, 3);

    for (let n = 0; n < salesToday; n += 1) {
      const useCustomer = random() > 0.28;
      const customer = useCustomer ? pick(customers) : null;
      const lineCount = between(1, 4);
      const lines = [];
      const seen = new Set();

      for (let l = 0; l < lineCount; l += 1) {
        const product = pick(trackable);
        if (seen.has(String(product._id))) continue;
        seen.add(String(product._id));
        const available = product.stockQuantity ?? 0;
        if (available <= 1) continue;
        const quantity = Math.min(between(1, 3), available);
        const line = { product: product._id, quantity };
        // Occasional small discount.
        if (random() > 0.85) line.discountPercent = pick([5, 10]);
        lines.push(line);
      }
      if (lines.length === 0) continue;

      const soldAt = daysAgo(day, between(9, 19));

      // Most sales settle at the counter; the rest become receivables.
      const settles = random() > 0.22;
      const method = pick(METHODS);

      try {
        // The invoice is created unpaid and then settled for its EXACT total.
        // Re-deriving the total here would duplicate the pricing rules and could
        // drift by a paisa, which the server would reject as an overpayment.
        // eslint-disable-next-line no-await-in-loop
        const { invoice } = await createSale(ctx, {
          customer: customer?._id,
          customerName: customer ? undefined : pick(['Walk-in Customer', 'Counter sale', '']),
          lines,
          invoiceStatus: 'unpaid',
          discountPercent: random() > 0.9 ? pick([5, 10]) : 0,
          channel: 'pos',
          soldAt,
          note: '',
        });
        saleCount += 1;
        if (!settles) unpaidCount += 1;

        if (settles) {
          // Settle the whole invoice for exactly what was billed.
          // eslint-disable-next-line no-await-in-loop
          await recordInvoicePayment(ctx, {
            invoiceId: invoice._id,
            amount: money.toDecimal(invoice.totalMinor),
            method,
            paidAt: soldAt,
          });
        }

        // Some credit invoices get a part payment a few days later.
        if (!settles && random() > 0.55) {
          const outstanding = invoice.totalMinor;
          // eslint-disable-next-line no-await-in-loop
          await recordInvoicePayment(ctx, {
            invoiceId: invoice._id,
            amount: money.toDecimal(Math.round(outstanding * (0.3 + random() * 0.4))),
            method: pick(METHODS),
            paidAt: daysAgo(Math.max(0, day - between(3, 12)), 12),
            notes: 'Part payment',
          }).catch(() => null);
        }
      } catch (error) {
        // Out of stock for this product today: skip rather than fail the seed.
        if (error?.code !== 'INSUFFICIENT_STOCK') {
          console.warn(`  ! skipped a sale: ${error.message}`);
        }
      }
    }
  }
  console.log(`  ${saleCount} sales, ${unpaidCount} left unpaid`);

  console.log('Adding a refund and a cancellation…');
  const refundable = await Sale.findOne({
    business: business._id,
    status: 'completed',
    paidMinor: { $gt: 0 },
    refundedMinor: 0,
  });
  if (refundable) {
    try {
      await refundSale(ctx, refundable._id, {
        amount: money.toDecimal(Math.round(refundable.totalMinor / 2)),
        reason: 'Customer returned one item',
        method: 'cash',
        restock: false,
      });
      console.log('  1 refund recorded');
    } catch {
      console.log('  refund skipped');
    }
  }

  console.log('Finalising invoice statuses…');
  const sweep = await reconcileStatuses(business._id);

  const counts = {
    Products: await Product.countDocuments({ business: business._id }),
    Categories: await ProductCategory.countDocuments({ business: business._id }),
    Customers: await Customer.countDocuments({ business: business._id }),
    Suppliers: await Supplier.countDocuments({ business: business._id }),
    Sales: await Sale.countDocuments({ business: business._id }),
    Invoices: await Invoice.countDocuments({ business: business._id }),
    Payments: await Payment.countDocuments({ business: business._id }),
    Purchases: await Purchase.countDocuments({ business: business._id }),
    Expenses: await Expense.countDocuments({ business: business._id }),
    Movements: await StockMovement.countDocuments({ business: business._id }),
  };

  console.log('\nSeed complete.\n');
  console.log('  Sign in at', env.clientUrl);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${env.seed.adminPassword}\n`);
  console.log('  Records created:');
  for (const [label, count] of Object.entries(counts)) {
    console.log(`    ${label.padEnd(12)} ${count}`);
  }
  console.log(`\n  ${sweep.updated} invoice(s) marked overdue by the date sweep.`);
  console.log('  Every dashboard figure is computed from these records.\n');

  await disconnect();
}

/** Interactive guard so a reset never happens by accident. */
async function confirmReset() {
  if (!RESET || !process.stdin.isTTY) return true;
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\nThis deletes all data in "${env.mongo.uri}". Type the database name to confirm: `
  );
  rl.close();
  const expected = new URL(env.mongo.uri).pathname.replace(/^\//, '');
  return answer.trim() === expected;
}

confirmReset()
  .then((ok) => {
    if (!ok) {
      console.log('\nCancelled.\n');
      process.exit(0);
    }
    return seed();
  })
  .catch(async (error) => {
    console.error('\nSeed failed:', error.message);
    if (error.stack && env.nodeEnv !== 'production') console.error(error.stack);
    await disconnect().catch(() => {});
    process.exit(1);
  });
