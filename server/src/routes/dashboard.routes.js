import { Router } from 'express';
import * as ctl from '../controllers/dashboard.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { dashboardQuerySchema } from '../../../shared/validators/index.js';

const router = Router();

// Every dashboard read requires membership; `dashboard:read` is granted to all
// roles but the check still happens server-side.
router.use(withBusiness({ permission: 'dashboard:read' }));

router.get('/summary', validate(dashboardQuerySchema, 'query'), ctl.summary);
router.get('/stats', ctl.stats);
router.get('/sales-chart', validate(dashboardQuerySchema, 'query'), ctl.salesChart);
router.get('/payment-methods', validate(dashboardQuerySchema, 'query'), ctl.methods);
router.get('/outstanding', ctl.outstanding);

export default router;
