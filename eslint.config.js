import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Lint rules.
 *
 * Chosen for defects that actually matter in this codebase, not for style:
 *   - `no-unused-vars` catches imports left behind while refactoring.
 *   - `no-undef` catches referencing a model or helper that does not exist.
 *   - the react-hooks rules catch stale closures in the checkout screen, where
 *     a wrong dependency means charging the wrong amount.
 * Formatting is left to the editor; ESLint here reports problems, not taste.
 */
export default [
  {
    // NOTE: this object must contain ONLY `ignores`. In flat config an object
    // that also declares `rules` or `linterOptions` stops acting as a global
    // ignore, which would pull the build output in client/dist into the run.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'tests/.coverage/**',
      'tests/.tmp/**',
      'client/public/**',
    ],
  },

  {
    // The codebase deliberately uses `// eslint-disable-next-line
    // no-await-in-loop` where a sequential loop is the correct choice. That
    // rule is not enabled here, so flagging those directives as unused would
    // bury real findings under noise.
    linterOptions: { reportUnusedDisableDirectives: false },
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- server ---
  {
    files: ['server/**/*.js', 'shared/**/*.js', 'scripts/**/*.mjs', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
      'no-return-await': 'error',
      'require-atomic-updates': 'off',
      // A 500 must never leak internals; that is enforced by the error
      // middleware, not by throwing here.
      'no-throw-literal': 'error',
    },
  },

  // ---------------------------------------------------------------- client ---
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // The automatic JSX runtime is used, so React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Without these, core `no-unused-vars` reports every component and every
      // import referenced only inside JSX as unused.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',

      // The React Compiler lint cannot statically analyse React Hook Form's
      // imperative API (`watch`/`setValue`/`handleSubmit`) and reports
      // "Compilation Skipped: use of incompatible library" on every form.
      // That is a limitation of the compiler, not a defect in this code, and
      // the rule fires 7+ times with nothing actionable in any of them.
      'react-hooks/incompatible-library': 'off',

      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // -------------------------------------------------------- build configs ---
  // These run in Node at build time, not in the browser, so `process` is real.
  {
    files: ['client/vite.config.js', 'client/postcss.config.js', 'client/tailwind.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ----------------------------------------------------------------- tests ---
  {
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
    },
  },
];
