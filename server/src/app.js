/**
 * Express application factory.
 *
 * Exported without calling `listen()` so tests (and the seeder) can mount the
 * app on an ephemeral port or drive it through Supertest.
 */
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import env from './config/env.js';
import { isAllowedOrigin } from './config/origins.js';
import { API_PREFIX } from './utils/helpers.js';
import apiRouter from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';
import { requestContext } from './middleware/auth.js';
import {
  additionalHeaders,
  csrfProtection,
  securityHeaders,
  uploadHandler,
} from './middleware/security.js';
import logger from './utils/logger.js';

export function createApp() {
  const app = express();

  // `req.ip` must reflect the real client only when we actually sit behind a
  // trusted proxy — otherwise the header is spoofable and rate limits are useless.
  app.set('trust proxy', env.security.trustProxy ? 1 : false);
  app.set('x-powered-by', false);
  app.set('query parser', 'simple');
  app.set('etag', 'strong');

  /* ------------------------------------------------------------ SECURITY -- */
  app.use(securityHeaders());
  app.use(additionalHeaders);
  app.use(
    cors({
      origin(origin, callback) {
        // Shared with the CSRF guard: see config/origins.js. The two must not
        // disagree, or requests get past CORS and are then blocked anyway.
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true, // required for the HttpOnly refresh cookie
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Business-Id', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Content-Disposition'],
      maxAge: 86400,
    })
  );

  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        // Never gzip a PDF or CSV export — they are already compact.
        const type = String(res.getHeader('Content-Type') ?? '');
        return /text|json|javascript|xml|svg/.test(type);
      },
    })
  );

  /* ----------------------------------------------------------- PARSERS --- */
  app.use(express.json({ limit: env.security.maxBodySize }));
  app.use(express.urlencoded({ extended: true, limit: env.security.maxBodySize }));
  app.use(cookieParser());
  app.use(requestContext);

  if (!env.isTest) {
    app.use(
      morgan(env.isProduction ? 'combined' : 'dev', {
        stream: { write: (line) => logger.debug(line.trim()) },
        skip: (req) => req.path === `${API_PREFIX}/health`,
      })
    );
  }

  app.use(csrfProtection);

  /* ------------------------------------------------------------ ROUTES --- */
  app.use('/uploads', uploadHandler);
  app.use(API_PREFIX, apiRouter);

  /* -------------------------------------------------- PRODUCTION SPA ----- */
  const clientDist = path.join(env.paths.root, 'client', 'dist');
  const hasBuild = fs.existsSync(path.join(clientDist, 'index.html'));

  if (hasBuild) {
    // Hashed build assets are immutable; index.html must never be cached.
    app.use(
      express.static(clientDist, {
        index: false,
        maxAge: '1y',
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else if (!env.isTest) {
    app.get('/', (_req, res) => {
      res.type('html').send(
        `<!doctype html><html><head><meta charset="utf-8"><title>SajiloLekha API</title>
        <style>body{font-family:ui-sans-serif,system-ui;padding:48px;color:#0f172a;background:#faf9ff}
        .c{max-width:640px;margin:0 auto;background:#fff;border:1px solid #ede9fe;border-radius:16px;padding:32px}
        h1{color:#7657E8;margin-top:0}a{color:#7657E8}</style></head>
        <body><div class="c"><h1>SajiloLekha API</h1>
        <p>The API is running. The client bundle has not been built yet.</p>
        <p>Run <code>npm run dev</code> for the Vite dev server, or <code>npm run build</code> to serve the
        production SPA from this process.</p>
        <p><a href="/api/health">/api/health</a></p></div></body></html>`
      );
    });
  }

  /* ------------------------------------------------------------ ERRORS --- */
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
