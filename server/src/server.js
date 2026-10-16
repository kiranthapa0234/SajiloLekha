/**
 * Process entry point: connect, listen, and shut down cleanly.
 */
import env from './config/env.js';
import { createApp } from './app.js';
import { connect, disconnect, supportsTransactions } from './config/database.js';
import logger from './utils/logger.js';
import { reconcileStatuses } from './services/invoice.service.js';
import Business from './models/Business.js';

async function bootstrap() {
  await connect();

  const transactions = await supportsTransactions();
  logger.info('Startup configuration', {
    env: env.nodeEnv,
    port: env.port,
    transactions,
    auth: { algorithm: 'argon2id', accessTtl: env.auth.accessTtl, refreshTtl: env.auth.refreshTtl },
  });

  // Overnight, invoices can become overdue purely because time passed. Re-derive
  // their status so the dashboard and reports never show stale settlement state.
  const overdueSweep = setInterval(async () => {
    try {
      const businesses = await Business.find({ deletedAt: null }).select('_id').lean();
      let total = 0;
      for (const b of businesses) {
        // eslint-disable-next-line no-await-in-loop
        const r = await reconcileStatuses(b._id);
        total += r.updated;
      }
      if (total > 0) logger.info('Invoice overdue sweep', { updated: total });
    } catch (err) {
      logger.error('Invoice sweep failed', { error: err.message });
    }
  }, 60 * 60 * 1000);
  overdueSweep.unref();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`SajiloLekha API listening on http://localhost:${env.port}${env.isProduction ? '' : ` (client: ${env.clientUrl})`}`);
  });

  server.headersTimeout = 65_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 61_000;

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    clearInterval(overdueSweep);
    server.close(async () => {
      await disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    // Force exit if sockets refuse to drain.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: reason?.message ?? String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — exiting', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  return server;
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
