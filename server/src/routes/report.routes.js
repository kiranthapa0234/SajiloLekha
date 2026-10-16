import { Router } from 'express';
import * as ctl from '../controllers/report.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { exportLimiter } from '../middleware/security.js';
import { reportQuerySchema, z } from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'report:read' }));

const reportKeySchema = z.object({
  key: z.enum([
    'sales',
    'profit-loss',
    'expenses',
    'inventory',
    'stock-movements',
    'low-stock',
    'customers',
    'collections',
    'outstanding',
    'suppliers',
  ]),
});

router.get('/', ctl.index);

/** CSV/PDF exports are CPU- and IO-heavy, so they get their own tighter bucket. */
router.get(
  '/:key/export',
  withBusiness({ permission: 'report:export' }),
  exportLimiter,
  validate(reportKeySchema, 'params'),
  validate(reportQuerySchema, 'query'),
  ctl.show
);

router.get(
  '/:key',
  validate(reportKeySchema, 'params'),
  validate(reportQuerySchema, 'query'),
  ctl.show
);

export default router;
