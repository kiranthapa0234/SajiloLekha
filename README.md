# SajiloLekha

Business management and accounting for a single physical shop: sales, inventory,
customers, suppliers, expenses, payments and invoices, with the accounting
definitions written down instead of hidden.

The distinguishing goal is **honesty about the numbers**. Every figure on the
dashboard states the formula behind it, stock can only move through a recorded
ledger entry, and a workspace can never see another workspace's books.

---

## Contents

- [Quick start](#quick-start)
- [The accounting rules](#the-accounting-rules)
- [Tenant isolation](#tenant-isolation)
- [Money](#money)
- [Stock](#stock)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)

---

## Quick start

### Requirements

| | |
|---|---|
| Node | 20+ (developed on 24) |
| MongoDB | **A replica set is required** — see below |

Transactions are not optional in this system. A standalone `mongod` cannot run
them, and rather than pretending its multi-document writes are atomic, the code
detects this and falls back to compensating rollbacks (slower, and less
strict). For a real deployment use MongoDB Atlas, or a local replica set:

```bash
# macOS / Linux
mongod --replSet rs0 --dbpath ./.mongo-data
# then, once:
mongosh --eval 'rs.initiate()'
```

### Install and run

```bash
git clone <repo> lekhapana && cd lekhapana
npm install

# Lifecycle scripts for native modules are blocked by default in npm >= 10.
npm install-scripts approve argon2 esbuild   # argon2id hashing, esbuild

cp .env.example .env
# Open .env and replace the three JWT secrets. Generate each with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run seed      # creates a workspace with ~45 days of realistic activity
npm run dev       # API on :4000, app on :5173
```

Open <http://localhost:5173> and sign in with the credentials the seed prints
(`owner@lekhapana.test` / `ChangeMe!2024` by default).

Every figure on that dashboard is computed by a MongoDB aggregation over the
records the seed just wrote. Nothing is hard-coded or faked.

### If you have no MongoDB installed

```bash
npm run dev:memory
```

That boots a throwaway MongoDB **replica set** in memory, seeds it, and starts
the API and the web app against it in one command — no install step. The
replica set is not optional: the accounting code opens real transactions, so a
standalone `mongod` would be rejected.

The data is deleted when you stop the command. It is for evaluating the app and
writing code, not for work you need to keep; use `npm run dev` against a real
database for that.

### Seeding

| Command | What it does |
|---|---|
| `npm run seed` | Seeds an empty database, exits |
| `npm run seed:reset` | Drops the seeded workspace and rebuilds it (asks first) |
| `npm run dev:memory` | Throwaway in-memory database, seeded, then starts the app |

The seed writes a realistic 45-day history: two workspaces (so tenant isolation
is observable), 12 products, customers, suppliers, 100 sales, 100 invoices, 91
payments, purchases, expenses and ~200 stock movements. It then reconciles
everything and refuses to report success if any invoice status, sale total or
stock balance disagrees with the ledger.

Accounts and password come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in
`.env`, and the seed prints whatever it used.

### Other commands

| Command | What it does |
|---|---|
| `npm run dev` | API and Vite dev server together |
| `npm run dev:memory` | Same, against a temporary in-memory database |
| `npm run build` | Production client build into `client/dist` |
| `npm start` | API only (serves `client/dist` if present) |
| `npm test` | Full suite: 176 tests across API and client |
| `npm run test:server` | API suite only |
| `npm run test:client` | Component suite only |
| `npm run coverage` | Tests with a V8 coverage report |
| `npm run lint` | ESLint across the monorepo |

---

## The accounting rules

Most accounting bugs are not arithmetic bugs, they are *definition* bugs. These
are the definitions this system commits to, implemented once in
[`shared/accounting.js`](shared/accounting.js) and asserted in
[`tests/server/accounting.test.js`](tests/server/accounting.test.js).

### Accrual, not cash

| Concept | Recognised | Never used for |
|---|---|---|
| Revenue | When the sale is recorded | When cash arrives |
| Cost of goods sold | When stock is sold | When stock was bought |
| Operating expenses | When incurred | — |
| Tax collected | A **liability**, not income | — |

**Profit is never derived from cash collected.** An unpaid sale of Rs. 1,000
costing Rs. 600 is Rs. 400 of revenue and Rs. 400 of profit, with Rs. 0
collected. Cash collected is reported separately and labelled as a cash metric.

```
revenueMinor    = netSales - refunds
grossProfit     = revenue - costOfGoodsSold
netProfit       = grossProfit - operatingExpenses
```

### Purchases are not expenses

Receiving stock capitalises it into inventory. It becomes an expense only when
that stock is sold, at the cost recorded at the time of purchase. Recording a
supplier payment as an expense would double-count it against the profit that
eventually appears when the goods sell.

### Stock has one door in, and it asks who you owe

Adding stock from the Inventory list asks **"where did this stock come from?"**:

- **Bought from a supplier** records a real `Purchase` — the supplier is
  attached, the unit cost is stored, stock rises, and the amount stays owed
  until it is paid from the Purchases list. The cost also becomes the COGS
  basis when the goods are sold.
- **Stock correction** is the plain `StockMovement`, for recounts and fixes.
  No supplier, no cost, no money implied.

This split matters because a bare `adjustment_in` raises stock without saying
who supplied it, which leaves real money owed with nobody recorded as owing it.
Stock that arrives on a truck is a purchase; stock that does not match the
shelf is a correction.

Both entries go through the same service methods as the Purchases screen, so
there is exactly one code path that can turn money into inventory. Switching the
movement type to a write-off or recount clears the purchase framing
automatically, because nothing is being bought.

### Invoice status is derived, never set

`unpaid → partial → paid`, with `overdue` applied by the passage of time, and
`cancelled` as a terminal state:

```js
deriveInvoiceStatus({ totalMinor, paidMinor, writtenOffMinor, dueDate, now })
```

The client cannot declare an invoice paid. A payment against an invoice
changes the numbers, and the status follows. An invoice due "on receipt"
(`invoiceDueDays === 0`) gets **no** due date at all, because a due date equal
to the sale timestamp would mark it overdue a millisecond later.

### Payments can never exceed the outstanding balance

A payment above the balance is rejected with `OVERPAYMENT_BLOCKED` and the
exact figure that would have been acceptable. There is no overpayment escape
hatch and no way to round a balance away. A write-off is the explicit,
reasoned alternative for bad debt, and it never moves cash.

---

## Tenant isolation

This is the property most worth testing carefully, because a regression passes
every other suite in the project while silently leaking one business's books to
another.

**Rules, enforced server-side:**

1. A business id is *never* taken from a request body. It comes from the
   authenticated membership ([`server/src/services/tenant.service.js`](server/src/services/tenant.service.js)).
2. Every query and update is scoped by that id. A cross-tenant read returns
   **404, not 403** — a 403 would confirm the document exists.
3. Switching workspace goes through `POST /auth/switch-business`, which checks
   an *active* membership and issues a new token.
4. A suspended or removed member cannot resolve a workspace at all.

[`tests/server/tenancy.test.js`](tests/server/tenancy.test.js) is deliberately
adversarial: every assertion attempts a real cross-tenant read or write and
requires it to fail, including a client-supplied `?businessId=`, a forged
`X-Business-Id` header, and a sale line pointing at another workspace's
product.

### Related defences

- **Auth**: argon2id with a pepper; a 15-minute JWT plus an opaque refresh token
  in an HttpOnly cookie, stored hashed, with rotation and reuse detection. The
  access token lives in memory only, so XSS cannot read it.
- **Operator injection**: Mongoose's `sanitizeFilter` is deliberately disabled
  (in 8.24 it wraps range operators in `$eq`, breaking every date filter).
  `rejectMongoOperators` replaces it at the HTTP boundary, rejecting `$`-prefixed
  and dotted keys with a 400.
- **Rate limiting**: backed by MongoDB so a limit means the same thing across
  every instance behind a load balancer.

---

## Money

Every amount is an **integer in the currency's minor unit** (paisa). No floats
are stored, summed or compared anywhere.

```js
toMinorUnits('1,250.50', 2)  // 125050
fromMinorUnits(125050, 2)     // 1250.5
```

`shared/money.js` is integer-only and tested against the inputs a Nepali
cashier actually types: `1,250`, `1,250.50`, `Rs. 1,250.50`, `12,34,567.89`
(lakh-crore grouping), and a European `1.234,56`. `0.1 + 0.2` cannot occur
because no float is ever created.

Amounts cross the wire as integers and are parsed once, on the server, with the
same shared code the tests cover.

### Cash and bank

An amount being *owed* and an amount being *held* are different things. Customer
and supplier `openingBalance` fields are the former. The workspace's own money
is the latter, and it lives in its own append-only ledger
(`server/src/models/MoneyMovement.js`).

Two accounts, because that is what a shop actually has: **Cash** and **Bank**.
Card, wallet and cheque settlements count against the bank, because that is
where the money lands once the provider pays out. `credit` is deliberately
excluded — nothing moves until the customer pays, so a credit sale can never
inflate the balance.

**Balance is never stored.** It is an aggregation over the ledger:

```js
sum(in) - sum(out)  per account
```

This is the important part. A stored running total can quietly disagree with
the movements that produced it, and once it does there is no way to tell which
number is lying. A ledger can always be re-summed, and the test suite
re-derives the balance from the rows alone to prove it.

Money enters the ledger from one place, `recordForPayment`, called wherever a
payment is created. That covers every existing flow at once:

| Event | Effect |
|---|---|
| Invoice or standalone receipt | **in**, to cash or bank by method |
| Sale on credit | nothing — no payment, no movement |
| Purchase paid | **out** |
| Refund | **out** |
| Payment voided | its movement is marked voided |
| Sale cancelled | its receipts' movements are marked voided |
| Transfer cash ↔ bank | two rows sharing a `transferGroup`; the total never changes |

Movements are never deleted, only voided — the same rule as stock. A
correction is a new, opposing movement, so the history stays auditable.

### Stock leaving, and the money that might come back

Reducing stock is not automatically a money event. A recount is a measurement, and
damaged goods that nobody reimburses cost you the stock and nothing else. But when
a **supplier takes goods back and hands the money over**, it is a money event, and
before this existed the cash simply disappeared: stock fell, the till stayed where
it was, and the books showed a settled purchase for goods the business no longer
had.

The Add stock form asks the question whenever stock leaves:

- **The supplier took it back and refunded me** → `POST /api/purchases/returns`.
  One transaction writes the `purchase_return` stock movement and the money.
- **Nothing comes back** → a plain `StockMovement`. Spoilage, theft, miscount.

Where the refund lands depends on whether the money is already gone:

```js
debtCredit = min(refundMinor, purchase.outstanding)  // cancels what is owed
cashBack   = refundMinor - debtCredit               // real money into Cash/Bank
```

So a return against an **unpaid** bill reduces the debt and invents no cash,
while a return against an **already-paid** bill puts the money back in the
account. Crediting cash in the first case would record money the business never
received.

The refund is credited against the purchase only when it is supplied, is for the
same supplier, and actually covers that product — otherwise a return could settle
an unrelated bill.

### The balance cannot go negative

Every outbound movement in the system — paying a supplier, a standalone
money-out, a refund — passes through `recordForPayment`, so that is where the
rule is enforced. There is no path that spends money without passing it:

```js
if (direction === 'out') await assertFunds(businessId, account, amountMinor, session);
```

This matters more than it looks. Because balance is `sum(in) - sum(out)`, an
outbound row larger than the account's balance does not borrow — it simply makes
the reported figure wrong. And because movements are voided rather than deleted,
that wrong number is then permanent: there is nothing to delete it.

The check is **per account**, not against the combined total. A payment recorded
against cash must be covered by cash, whatever the bank happens to hold; otherwise
the cash ledger goes negative and the bank looks healthy. The error names the
shortfall and points at the account that *does* hold the money, so the fix
(transfer first, or pay by the other method) is obvious:

```
Not enough cash to cover this. You have 800.80 in cash, this is 1200.00 —
1199.20 short. Your bank holds 5000.00, so transfer from bank first or pay by bank.
```

An account that is **already** negative is a separate case — the books are wrong
upstream, and "you have -6,436,384.20" is not a sentence. That reports the
overdraft and tells the operator to record a real opening balance on the
Accountant screen.

A refused payment leaves nothing behind: no purchase, no payment row, no movement,
because the whole thing runs in one transaction.

The Purchase form and the Pay-supplier modal both show the account balance and
warn *before* submitting, so an unaffordable amount is caught while it is being
typed rather than after a round trip. The server still checks regardless — the
client warning is a courtesy, not the control.

---

## Stock

Stock moves only through a recorded `StockMovement`, enforced at the schema
level rather than by convention:

- `stockQuantity` may only be written by the stock service, which always bumps
  `stockVersion` (its optimistic-concurrency token) and writes the matching
  ledger row. A raw write is rejected.
- Every movement records a **reason** and the source document.
- `quantityAfter` must equal `quantityBefore + quantity` — enforced on write.
- Movements are **append-only**. A correction is a new, opposing movement.
- Stock cannot go negative unless the workspace explicitly opts in.

The same **idempotency key** protects a double-clicked checkout: a replay
returns the original sale instead of creating a second one.

---

## Architecture

```
client/          React 18 + Vite + Tailwind + Recharts
  src/
    components/  Design system, DataTable, charts, app shell
    context/     Session state
    hooks/       Data hooks, list state, download
    layouts/     (see components/AppLayout.jsx)
    pages/       One folder per module
    services/    Typed API layer
    utils/       Formatting

server/          Express 5 + Mongoose 8
  src/
    config/      Env parsing, database
    models/      14 schemas + shared plugins
    controllers/ Thin HTTP adapters
    services/    All business logic
    middleware/  Auth, tenancy, validation, security, errors
    validators -> re-exports shared/validators
    scripts/     Seed

shared/          Used verbatim by BOTH sides
  money.js         Integer money
  accounting.js    Invoice totals, P&L, status
  constants.js     Roles, permissions, enums
  validators/      Zod schemas
```

### The shared layer is the point

`shared/validators` is imported by the server's middleware *and* by the client's
`zodResolver`. The form cannot accept something the API will reject, and the
validation message on screen is byte-identical to the one the server would have
produced. `shared/money.js` and `shared/accounting.js` mean the invoice printed
by the server and the total shown in the browser are computed by the same code.

### Request flow

```
request
  → securityHeaders / rateLimit / rejectMongoOperators
  → authenticate          (JWT → user)
  → withBusiness          (membership → ctx.businessId, permission check)
  → validate              (Zod, shared schema)
  → controller            (thin)
  → service               (all logic, inside a transaction)
  → model + Mongoose plugins (tenancy, soft delete, immutability guards)
  → response envelope     { success, data, meta }
```

Controllers contain no business logic; services do not touch `req`/`res`.

---

## Project layout

```
lekhapana/
├── client/
│   ├── index.html
│   ├── vite.config.js          @, @shared aliases; dev proxy to :4000
│   ├── tailwind.config.js      brand #7657E8 palette
│   └── src/
│       ├── components/         ui/, charts/, DataTable, AppLayout
│       ├── context/AuthContext.jsx
│       ├── hooks/              useApi.js, index.js
│       ├── pages/              Dashboard, Sales, Inventory, Customers,
│       │                       Suppliers, Expenses, Payments, Invoices,
│       │                       Reports, Settings, Auth
│       ├── services/           http.js, index.js
│       ├── utils/format.js
│       ├── App.jsx  main.jsx  index.css
├── server/
│   └── src/
│       ├── config/  models/  controllers/  routes/
│       ├── middleware/  services/  scripts/
│       ├── app.js  server.js
├── shared/
│   ├── money.js  accounting.js  constants.js
│   ├── validators/  index.js
│   └── index.js
├── tests/
│   ├── setup/                  global, server and client harnesses
│   ├── server/                 API integration suites
│   └── client/                 React Testing Library suites
├── .env.example
├── eslint.config.js
├── vitest.config.js
└── package.json                npm workspaces
```

---

## Testing

```bash
npm test              # everything: 174 tests
npm run test:server   # API, against a real in-memory MongoDB replica set
npm run test:client   # components, in jsdom
npm run coverage
```

The API suite runs against a **real MongoDB replica set** (`mongodb-memory-server`),
not a mock, because the behaviour under test — transactions, unique indexes,
`$expr` field-to-field comparisons, aggregation pipelines — is precisely what a
mock would not reproduce. The harness asserts transaction support at boot and
fails loudly rather than silently testing the fallback path.

| Suite | Covers |
|---|---|
| `money` | Integer parsing, rounding, overflow, locale separators |
| `accounting` | Line maths, invoice totals, P&L, status derivation |
| `tenancy` | Adversarial cross-tenant reads and writes |
| `sales` | Checkout, stock ledger, snapshots, idempotency, refunds |
| `payments` | Balances, partial payment, overpayment, void, PDF/HTML |
| `smoke` | Boot, envelopes, auth, 404/401 behaviour |
| `shape` | Computed fields actually reach the client |
| `format` | Money and date formatting on the client |
| `dashboard` | Loading / empty / error / success, a11y landmarks |
| `components` | DataTable, Modal, ConfirmDialog keyboard + focus behaviour |

### Notes on the client suite

Components are tested through their rendered output, by role and accessible name
rather than by test id. If a button cannot be found by its accessible name, that
is a real accessibility problem, and the test is right to fail.

---

## Configuration

Every variable, its default, and what it does is documented in
[`.env.example`](.env.example) — that file is generated to match
`server/src/config/env.js` exactly.

The essentials:

| Variable | Notes |
|---|---|
| `MONGODB_URI` | **Must point at a replica set** for real transactions |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_PEPPER` | 32+ random chars each, generated independently. The server refuses to boot in production while these are the dev placeholders |
| `JWT_PEPPER` | Rotating it invalidates every stored password hash |
| `COOKIE_SECURE` | Set `true` behind HTTPS |
| `TRUST_PROXY` | Only behind a proxy you control, or a client can spoof its IP and evade rate limits |
| `MONGO_AUTO_INDEX` | `false` in production; build indexes deliberately |

---

## API reference

All responses share one envelope:

```jsonc
// success
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 25, "total": 148 } }

// failure
{ "success": false, "error": { "code": "OVERPAYMENT_BLOCKED", "message": "…", "requestId": "…" } }
```

`error.code` is stable and machine-readable; `message` is for people.

`error.details` is **either** an array of `{ field, message }` (validation
failures) **or** an object of figures (domain refusals such as
`INSUFFICIENT_STOCK`, `INSUFFICIENT_FUNDS`, `STOCK_VERSION_CONFLICT`). Consumers
must branch on the type; assuming an array makes the error constructor itself
throw, which replaces the server's explanation with a JavaScript error.

### The `meta` envelope must survive the client

List endpoints put the rows in `data` and everything else — `total`, and the
`summary` the stat cards are built from — in `meta`:

```jsonc
{ "success": true, "data": [ /* rows */ ],
  "meta": { "page": 1, "limit": 25, "total": 6,
            "summary": { "costValueMinor": 5406213, "lowStock": 0, "outOfStock": 2 } } }
```

On the client, `get()` returns just `data` for the many single-object callers,
while `getList()` returns `{ items, meta }` and `usePaginated()` flattens that
into the `{ data, meta }` a page destructures. The split matters: a helper that
returns `data` alone **silently discards the envelope**, and since every stat card
reads `meta.summary` the result is not an error but a screen full of confident
zeros — stock value, retail value, and every other total reading `Rs. 0` while
real rows sit in the table underneath. There is a test on the inventory KPIs
specifically to keep that from coming back.

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Creates the user **and** the first workspace |
| `POST` | `/api/auth/login` | — | Sets the refresh cookie |
| `POST` | `/api/auth/refresh` | — | Rotates the refresh token; reuse is detected |
| `GET` | `/api/auth/me` | — | Restores a session from the cookie alone |
| `POST` | `/api/auth/switch-business` | member | Re-checks membership |
| `GET` | `/api/dashboard/summary` | `dashboard:read` | All KPIs, charts and tables |
| `GET` | `/api/products` | `product:read` | Search, category and stock filters |
| `POST` | `/api/products/:id/stock` | `stock:adjust` | Reason required |
| `POST` | `/api/purchases` | `purchase:write` | Stock in, debt tracked |
| `POST` | `/api/purchases/:id/payments` | `payment:write` | Settles a supplier bill |
| `POST` | `/api/purchases/returns` | `purchase:write` | Goods back; refund cancels debt or returns cash |
| `POST` | `/api/sales/quote` | `sale:read` | Prices a cart with the *same* code that will commit |
| `POST` | `/api/sales` | `sale:write` | Idempotent |
| `POST` | `/api/sales/:id/cancel` | `sale:write` | Reverses stock, voids the invoice |
| `POST` | `/api/sales/:id/refund` | `sale:refund` | Optional restock |
| `POST` | `/api/payments` | `payment:write` | Rejects overpayment |
| `GET` | `/api/invoices/:id?format=pdf` | `invoice:read` | Server-rendered PDF |
| `GET` | `/api/invoices/:id?format=print` | `invoice:read` | Printable HTML |
| `GET` | `/api/money/balances` | `report:read` | Cash, bank and total, derived from the ledger |
| `GET` | `/api/money/movements` | `report:read` | The ledger, filterable by account and kind |
| `POST` | `/api/money/transfer` | `stock:adjust` | Cash ↔ bank; refuses to overdraw |
| `POST` | `/api/money/in` \| `/out` | `stock:adjust` | Add or take out money |
| `GET` | `/api/reports/:key` | `report:read` | `sales`, `profit-loss`, `inventory`, … |
| `GET` | `/api/reports/:key/export?format=csv\|pdf` | `report:export` | |
| `GET` | `/api/health` | — | Unauthenticated, before the rate limiter |

Pagination, sorting and filtering use the same query-string names everywhere
(`page`, `limit`, `search`, `sort`, `order`, plus per-module filters).

---

## Design decisions

**Why the quote endpoint?** The checkout screen asks the server to price the
cart using the same service that will run at commit. A second, client-side
calculation would drift, and a drifted total is worse than a slow one.

**Why snapshot price, cost and description onto the sale?** Renaming a product
or changing its price must never rewrite a past invoice. The sale carries its
own copy of every commercial fact.

**Why is a failed sale fully rolled back?** Insufficient stock aborts the whole
checkout: no sale, no invoice, no payment, no stock movement. The test asserts
all four are absent.

**Why apply virtuals in a schema plugin?** Mongoose 8.24 silently ignores
`.lean({ virtuals: true })`. Before this was fixed, `stockStatus`,
`stockValueMinor` and `marginPercent` were missing from every list response —
the page rendered, with blanks. `tests/server/shape.test.js` now guards it.

**Why one walk-in customer per workspace?** Every walk-in shares a bucket
record, created with an atomic upsert so two tills checking out simultaneously
cannot collide on the unique customer-code index. The name typed at the counter
is still snapshotted onto the sale and the invoice.

**Why does `npm run lint` matter here?** The rule set was chosen for defects
rather than taste, and it paid for itself: four `no-undef` runtime crashes, a
`const` reassignment that would have turned a 401 into a 500, a dead rate-limit
store, and an idempotency key that was never regenerated between checkouts.

---

## Known limitations

Stated plainly rather than left to be discovered.

- **No email delivery.** Password reset and member invitations generate a token
  and return it in development; a transport must be wired in for production.
- **Single currency per workspace.** A workspace cannot hold books in two
  currencies. Changing it later re-denominates nothing and is therefore not
  exposed in the UI.
- **No purchase-order workflow.** Purchases record goods received; there is no
  "order from supplier" document to convert into a purchase.
- **Reports are computed synchronously.** A multi-year range on a large dataset
  will be slow; the seed's 45 days is instant. Pre-aggregation would be the
  next step.
- **Offline support is not implemented.** The client assumes connectivity; a
  failed request surfaces an error with a retry.
- **No soft-delete retention policy.** Records are soft-deleted and kept, but no
  job purges them.
- **Password reset tokens are stored hashed but not single-use until consumed**;
  they are not yet auto-expiring by sweep.

---

## Licence

MIT
