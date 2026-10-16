/**
 * API v1 router — one place that declares the whole surface.
 *
 * Middleware order per module:
 *   authenticate (JWT)  ->  withBusiness (membership)  ->  validate (Zod)  ->  controller
 *
 * `withBusiness` must always precede `validate`, because validation strips the
 * body and the tenancy context must come from the verified membership rather
 * than from anything the client sent.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/security.js';
import { rejectMongoOperators } from '../middleware/validate.js';
import * as systemController from '../controllers/audit.controller.js';

import authRoutes from './auth.routes.js';
import businessRoutes from './business.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import productRoutes, { stockRouter } from './product.routes.js';
import moneyRoutes from './money.routes.js';
import customerRoutes from './customer.routes.js';
import supplierRoutes from './supplier.routes.js';
import saleRoutes from './sale.routes.js';
import purchaseRoutes from './purchase.routes.js';
import expenseRoutes from './expense.routes.js';
import paymentRoutes from './payment.routes.js';
import invoiceRoutes from './invoice.routes.js';
import reportRoutes from './report.routes.js';
import auditRoutes from './audit.routes.js';

const router = Router();

/** Liveness probe - unauthenticated, before the rate limiter, so orchestrators
 *  (and load balancers) are never throttled or rejected. */
router.get('/health', systemController.health);

router.use(apiLimiter);

// Reject Mongo operator injection before anything reads a payload.
router.use(rejectMongoOperators);

// Public auth surface.
router.use('/auth', authRoutes);

// Everything below requires a valid access token.
router.use(authenticate);

router.use('/business', businessRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/products', productRoutes);
router.use('/stock', stockRouter);
router.use('/money', moneyRoutes);
router.use('/customers', customerRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/sales', saleRoutes);
router.use('/purchases', purchaseRoutes);
router.use('/expenses', expenseRoutes);
router.use('/payments', paymentRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/reports', reportRoutes);
router.use('/system', auditRoutes);

export default router;
