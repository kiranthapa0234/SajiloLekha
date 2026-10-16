import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  // The client addresses its own tree as `@/...`.
  '@': path.join(__dirname, 'client', 'src'),
  // Domain code shared verbatim by both sides.
  '@shared': path.join(__dirname, 'shared'),
  '@client': path.join(__dirname, 'client', 'src'),
  '@server': path.join(__dirname, 'server', 'src'),
};

/**
 * One Vitest run, two projects.
 *
 * They are separate projects rather than one config with a shared setup file
 * because they need genuinely different environments: the API suite needs a
 * live MongoDB replica set in Node, while the component suite needs jsdom.
 * Loading the server harness into a jsdom test would boot a database for no
 * reason and, worse, make component tests depend on infrastructure they never
 * use.
 *
 * Inline projects inherit the root config's plugins and globals, so neither is
 * repeated here.
 */
export default defineConfig({
  plugins: [react()],

  test: {
    globals: true,

    projects: [
      {
        resolve: { alias },
        test: {
          name: 'server',
          environment: 'node',
          root: __dirname,
          include: ['tests/server/**/*.test.js'],
          setupFiles: ['./tests/setup/server.setup.js'],
          globalSetup: ['./tests/setup/global.setup.js'],

          // Applied inside every worker process. The Mongo URI itself is handed
          // over at runtime by global.setup.js because it is not known until
          // the in-memory server has started.
          env: {
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            JWT_ACCESS_SECRET: 'test_access_secret_that_is_at_least_32_chars_long',
            JWT_REFRESH_SECRET: 'test_refresh_secret_that_is_at_least_32_chars_long',
            JWT_PEPPER: 'test_pepper_value_that_is_at_least_32_chars_long',
            RATE_LIMIT_MAX: '1000000',
            AUTH_RATE_LIMIT_MAX: '1000000',
            COOKIE_SECURE: 'false',
            MONGODB_USE_TRANSACTIONS: 'true',
            UPLOAD_DIR: './tests/.tmp/uploads',
          },

          // Serialised on purpose: every suite shares one in-memory database,
          // so running files in parallel would let one suite observe another's
          // documents and make failures depend on scheduling.
          fileParallelism: false,
          isolate: true,

          testTimeout: 30_000,
          hookTimeout: 90_000,
          teardownTimeout: 30_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'client',
          environment: 'jsdom',
          root: __dirname,
          include: ['tests/client/**/*.test.{js,jsx}'],
          setupFiles: ['./tests/setup/client.setup.js'],

          env: {
            NODE_ENV: 'test',
            VITE_API_URL: '/api',
          },

          // Component tests are pure and fast, so they run in parallel.
          isolate: true,

          testTimeout: 15_000,
          hookTimeout: 15_000,
        },
      },
    ],

    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './tests/.coverage',
      include: ['server/src/**/*.js', 'client/src/**/*.{js,jsx}', 'shared/**/*.js'],
      exclude: ['**/node_modules/**', '**/*.config.js', 'tests/**', '**/server.js'],
    },
  },
});