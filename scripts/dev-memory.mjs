/**
 * One-command development, with no MongoDB installation required.
 *
 *   npm run dev:memory
 *
 * Boots a throwaway MongoDB replica set in memory, seeds it with realistic
 * data, then starts the API and the Vite dev server against it. Everything
 * behaves exactly as it does against a real database - including transactions,
 * which is why the suite requires a replica set in the first place.
 *
 * THE DATA DISAPPEARS when you stop this command. It is for evaluating the app
 * and writing code, not for work you care about keeping. For that, install
 * MongoDB properly (see README) and use `npm run dev`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// `fileURLToPath`, not `new URL(...).pathname`: the latter is percent-encoded,
// which silently turns "content kiran" into "content%20kiran" and yields a
// working directory that does not exist.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = process.env.PORT || '4000';
const SKIP_SEED = process.argv.includes('--no-seed');

const children = new Set();
let shuttingDown = false;

/** Forward a signal to every child so Ctrl+C stops the whole tree. */
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/**
 * Start a child process and track it for shutdown.
 *
 * `keepGoingOnExit` is for the seed, which is EXPECTED to exit: treating its
 * normal completion as a failure would tear down the API and web app that have
 * not even started yet.
 */
function run(command, args, env = {}, { keepGoingOnExit = false, cwd = ROOT } = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    // `shell: true` is deliberately avoided: on Windows it re-quotes the argv
    // through cmd.exe and mangles paths that contain spaces. The npm entry
    // point is resolved explicitly instead.
    shell: false,
    env: { ...process.env, ...env },
  });
  children.add(child);

  // A failed spawn emits `error` and never emits `exit`, so anything awaiting
  // the child must be able to settle on both.
  let settle;
  const done = new Promise((resolve) => {
    settle = resolve;
  });

  child.on('error', (error) => {
    console.error(`\n  Could not start "${command}": ${error.message}\n`);
    settle(1);
    shutdown(1);
  });
  child.on('exit', (code) => {
    children.delete(child);
    settle(code ?? 0);
    if (!shuttingDown && !keepGoingOnExit) shutdown(code ?? 0);
  });

  child.done = done;
  return child;
}

/**
 * Workspace binaries, invoked through `node` directly.
 *
 * Shelling out to `npm` is avoided: on Windows `npm` is a .cmd shim, which
 * Node refuses to exec without a shell (EINVAL), and `shell: true` re-quotes
 * the argv through cmd.exe, mangling the repository path, which contains a
 * space. Running the tool's own JS entry point sidesteps both problems.
 */
function resolveBin(packageName, binName) {
  const manifest = path.join(ROOT, 'node_modules', packageName, 'package.json');
  try {
    const { bin } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const relative = typeof bin === 'string' ? bin : bin?.[binName];
    if (relative) return path.join(ROOT, 'node_modules', packageName, relative);
  } catch {
    /* fall through to the bare command name */
  }
  return binName;
}

console.log('\n  SajiloLekha - starting an in-memory database\n');

const replset = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const uri = replset.getUri();

const env = {
  MONGODB_URI: uri,
  MONGODB_USE_TRANSACTIONS: 'true',
  MONGO_AUTO_INDEX: 'true',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
};

console.log(`  database:  ${uri.replace(/\/\/.*@/, '//')}`);
console.log('  note:      this data is temporary and is lost on exit\n');

// Seed in a child so the seed gets the same env plumbing as everything else.
if (!SKIP_SEED) {
  console.log('  seeding-\n');
  const seed = run(process.execPath, ['server/src/scripts/seed.js'], env, { keepGoingOnExit: true });
  const seedCode = await seed.done;
  if (seedCode !== 0) {
    console.error('\n  The seed failed, so there is no data to look at. Stopping.\n');
    await replset.stop();
    process.exit(seedCode);
  }
  if (shuttingDown) process.exit(0);
}

console.log('\n  starting the API and the web app-\n');

// The API, with the same --watch the workspace `dev` script uses.
run(process.execPath, ['--watch', '--watch-preserve-output', 'server/src/server.js'], env);

// The Vite dev server, resolved from the package so no shell is involved.
// It must run from client/: Vite resolves index.html and the config relative
// to its cwd, and from the repo root it serves a bare 404.
const vite = resolveBin('vite', 'vite');
run(process.execPath, [vite], { ...env, FORCE_COLOR: '1' }, { cwd: path.join(ROOT, 'client') });

console.log(`
  Ready when you see the Vite banner.

    app   http://localhost:5173
    api   http://localhost:${API_PORT}/api/health

  Sign in with the credentials the seed printed above.
  Press Ctrl+C to stop. The database is deleted on exit.
`);

await new Promise(() => {});