import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@shared': path.join(root, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // The SPA imports shared schemas straight from the repo root.
    fs: { allow: [root] },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
        // The refresh cookie is HttpOnly; the dev proxy must pass it through.
        cookieDomainRewrite: '',
      },
      '/uploads': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Split the heavy, rarely-changing dependencies so a UI change does not
    // invalidate the whole cache.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          query: ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },
});
