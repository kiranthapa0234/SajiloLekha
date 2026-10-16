/**
 * Import integrity.
 *
 * Vite and Vitest resolve imports through a transform that does NOT fail on a
 * missing named export. A controller can therefore import a function the
 * service never exports, the entire 174-test suite stays green, and the
 * production server dies at import time with:
 *
 *   SyntaxError: The requested module '...' does not provide an export named 'x'
 *
 * This suite closes that gap by comparing every named import in `server/src`
 * against what the target module actually exports, following `export *`
 * re-export chains.
 */
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_SRC = path.resolve(fileURLToPath(new URL('../../server/src', import.meta.url)));

/** Recursively list every .js file under a directory. */
async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsFiles(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /import\s+\{([^}]+)\}\s+from\s+'(\.[^']+)'/g;
const STAR_REEXPORT_RE = /export\s+\*\s+from\s+'(\.[^']+)'/g;

/**
 * Is `exported` available from `target`, following `export * from` chains?
 * `shared/validators/index.js` re-exports every schema, so a plain text search
 * on the direct file would report ~40 false positives.
 */
async function provides(target, exported, seen = new Set()) {
  if (seen.has(target)) return false;
  seen.add(target);

  let source;
  try {
    source = await readFile(target, 'utf8');
  } catch {
    return false;
  }

  const declared = new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\s+${exported}\\b|const\\s+${exported}\\b|` +
      `let\\s+${exported}\\b|class\\s+${exported}\\b)|export\\s*\\{[^}]*\\b${exported}\\b`
  );
  if (declared.test(source)) return true;

  for (const match of source.matchAll(STAR_REEXPORT_RE)) {
    // eslint-disable-next-line no-await-in-loop
    if (await provides(path.resolve(path.dirname(target), match[1]), exported, seen)) return true;
  }
  return false;
}

describe('server imports', () => {
  it('every named import resolves to a real export', async () => {
    const files = await jsFiles(SERVER_SRC);
    expect(files.length).toBeGreaterThan(20);

    const problems = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const match of source.matchAll(IMPORT_RE)) {
        const [, names, specifier] = match;
        const target = path.resolve(path.dirname(file), specifier);

        if (!existsSync(target)) {
          problems.push(`${path.relative(SERVER_SRC, file)}: cannot resolve '${specifier}'`);
          continue;
        }

        for (const raw of names.split(',')) {
          const cleaned = raw.trim();
          if (!cleaned) continue;
          // `a as b` imports `a` under the local name `b`.
          const exported = cleaned.split(/\s+as\s+/)[0].trim();
          if (!exported) continue;

          // eslint-disable-next-line no-await-in-loop
          if (!(await provides(target, exported))) {
            problems.push(
              `${path.relative(SERVER_SRC, file)}: '${exported}' is not exported by ${specifier}`
            );
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('the entry point can actually be imported', async () => {
    // The definitive check: let Node's own ESM linker load the app, exactly as
    // `node server/src/server.js` would. This catches anything the text scan
    // above might miss, such as a default-only export.
    process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/lekhapana';
    const app = await import('../../server/src/app.js');
    expect(typeof app.createApp).toBe('function');
  });
});