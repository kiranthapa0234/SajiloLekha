/**
 * Throwaway harness: boots a real MongoDB replica set and runs the seed script
 * against it as a child process, so the seed is verified end to end rather than
 * merely type-checked.
 *
 *   node scripts/verify-seed.mjs
 */
import { spawn } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replset = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});

const uri = replset.getUri();
console.log(`mongodb ready: ${uri.replace(/\/\/.*@/, '//')}`);

const child = spawn(process.execPath, ['server/src/scripts/seed.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    MONGODB_URI: uri,
    JWT_SECRET: 'seed-verification-secret-not-used-in-tests',
    JWT_REFRESH_SECRET: 'seed-verification-refresh-secret-not-used',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

const code = await new Promise((resolve) => {
  child.on('exit', resolve);
  setTimeout(() => child.kill(), 180_000);
});

if (code !== 0) {
  await replset.stop();
  console.error(`\nseed exited with code ${code}`);
  process.exit(code ?? 1);
}

console.log(`\nseed completed successfully (exit ${code})`);

// ---------------------------------------------------------------- audit --
// The seed's whole claim is that dashboard figures are COMPUTED from the
// records it just wrote. Prove it rather than assert it.
const mongoose = (await import('mongoose')).default;
process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = 'verify-secret-not-used';
process.env.JWT_REFRESH_SECRET = 'verify-refresh-secret-not-used';
const { connect, disconnect } = await import('../server/src/config/database.js');

// The seed ran in a child process, so register the models here too.
for (const name of ['Invoice', 'Sale', 'Payment', 'Product', 'StockMovement', 'Customer', 'Expense']) {
  await import(`../server/src/models/${name}.js`);
}

await connect();

const Invoice = mongoose.model('Invoice');
const Sale = mongoose.model('Sale');
const Payment = mongoose.model('Payment');
const Product = mongoose.model('Product');

const statuses = await Invoice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
console.log('\ninvoice status breakdown:');
for (const row of statuses) console.log(`  ${String(row._id).padEnd(10)} ${row.count}`);

// Every invoice's stored status must match what the shared rule derives.
const { deriveInvoiceStatus } = await import('../shared/accounting.js');
const invoices = await Invoice.find({}).lean();
const mismatched = invoices.filter(
  (inv) =>
    inv.status !== 'cancelled' &&
    deriveInvoiceStatus({
      totalMinor: inv.totalMinor,
      paidMinor: inv.paidMinor,
      writtenOffMinor: inv.writtenOffMinor ?? 0,
      refundedMinor: inv.refundedMinor ?? 0,
      dueDate: inv.dueDate,
      status: inv.status,
    }) !== inv.status
);
console.log(`\ninvoice status mismatches: ${mismatched.length}`);
if (mismatched.length) {
  console.log('  e.g.', mismatched.slice(0, 3).map((m) => `${m.invoiceNumber} stored=${m.status}`));
}

// Sale money must reconcile: net + tax === total, and cogs + profit === net.
const sales = await Sale.find({}).lean();
const bad = sales.filter(
  (s) =>
    s.netSalesMinor + s.taxMinor !== s.totalMinor ||
    s.cogsMinor + s.grossProfitMinor !== s.netSalesMinor - (s.refundMinor ?? 0)
);
console.log(`sale arithmetic mismatches: ${bad.length}`);
if (bad.length) console.log('  e.g.', bad.slice(0, 3).map((s) => s.reference));

// Stock movements must balance: after === before + delta, for every row.
const StockMovement = mongoose.model('StockMovement');
const movements = await StockMovement.find({}).lean();
const brokenLedger = movements.filter((m) => m.quantityAfter !== m.quantityBefore + m.quantity);
console.log(`stock ledger mismatches: ${brokenLedger.length}`);

// Payments must never exceed what was billed on their invoice.
// Refunds are stored as payments too, so net collection is what matters:
// an invoice is over-collected only when (sum of amounts - sum of refunds)
// exceeds its total.
const overpaid = await Payment.aggregate([
  { $match: { invoice: { $ne: null }, status: 'valid' } },
  {
    $group: {
      _id: '$invoice',
      gross: { $sum: '$amountMinor' },
      refunded: { $sum: '$refundedMinor' },
    },
  },
  { $lookup: { from: 'invoices', localField: '_id', foreignField: '_id', as: 'inv' } },
  { $unwind: '$inv' },
  {
    $match: {
      $expr: { $gt: [{ $subtract: ['$gross', '$refunded'] }, { $add: ['$inv.totalMinor', '$inv.writtenOffMinor'] }] },
    },
  },
  { $project: { number: '$inv.invoiceNumber', gross: 1, refunded: 1, total: '$inv.totalMinor', paid: '$inv.paidMinor' } },
]);
console.log(`overpaid invoices: ${overpaid.length}`);
for (const row of overpaid.slice(0, 5)) {
  console.log(`  ${row.number}: gross=${row.gross} refunds=${row.refunded} total=${row.total} invoicePaid=${row.paid}`);
}

const [products, stockUnits] = await Promise.all([
  Product.countDocuments({}),
  Product.aggregate([{ $group: { _id: null, total: { $sum: '$stockQuantity' } } }]),
]);
console.log(`products: ${products}, units on hand: ${stockUnits[0]?.total ?? 0}`);

await disconnect();
await replset.stop();
process.exit(0);