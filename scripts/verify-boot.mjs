/**
 * Boot check.
 *
 * Confirms the server module loads, `createApp()` builds without throwing, the
 * HTTP listener accepts connections, and the health endpoint answers. This is
 * the last mile a unit or integration test does not cover: everything else
 * tests the app through supertest and never touches a real socket.
 *
 * Run once, then delete:  node scripts/verify-boot.mjs
 */
import { spawn } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replset = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const uri = replset.getUri();

const child = spawn(process.execPath, ['server/src/server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: '4123',
    MONGODB_URI: uri,
    MONGODB_USE_TRANSACTIONS: 'true',
    JWT_ACCESS_SECRET: 'boot_check_access_secret_at_least_32_chars_long',
    JWT_REFRESH_SECRET: 'boot_check_refresh_secret_at_least_32_chars_long',
    JWT_PEPPER: 'boot_check_pepper_value_at_least_32_chars_long',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (c) => { output += c; process.stdout.write(c); });
child.stderr.on('data', (c) => { output += c; process.stderr.write(c); });

const failures = [];
const ok = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

let health = null;

const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try {
    const res = await fetch('http://127.0.0.1:4123/api/health');
    health = { status: res.status, body: await res.json() };
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}

console.log('\nboot checks:');

ok('process is still alive', child.exitCode === null, child.exitCode ? `exited ${child.exitCode}` : '');
ok('GET /api/health answers', health !== null, 'no response within 30s');

if (health) {
  ok('health reports 200', health.status === 200, `got ${health.status}`);
  ok('health reports the database up', health.body?.data?.database === 'up', JSON.stringify(health.body?.data));
  ok(
    'health confirms transaction support',
    health.body?.data?.transactions === true,
    `transactions=${health.body?.data?.transactions}`
  );
}

// The tenant boundary must hold on a real socket, not just via supertest.
const res = await fetch('http://127.0.0.1:4123/api/products');
const unauth = { status: res.status, body: await res.json() };
ok('protected route rejects anonymous access', unauth.status === 401, `got ${unauth.status}`);
ok('error envelope is well formed', unauth.body?.success === false && typeof unauth.body?.error?.code === 'string');

child.kill();
await replset.stop();

if (failures.length) {
  console.error(`\n${failures.length} boot check(s) failed:\n  - ${failures.join('\n  - ')}`);
  console.error('\n--- server output ---\n' + output);
  process.exit(1);
}

console.log('\nserver boots, serves and enforces auth on a real socket.');
process.exit(0);