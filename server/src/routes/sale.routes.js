import { Router } from 'express';
import * as ctl from '../controllers/sale.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import {
  cancelSaleSchema,
  createSaleSchema,
  idParamSchema,
  refundSchema,
  saleListSchema,
  salePaymentSchema,
  updateSaleSchema,
} from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'sale:read' }));

/** Price a cart without committing (pure preview). */
router.post('/quote', ctl.quote);

router.get('/', validate(saleListSchema, 'query'), ctl.list);
router.post('/', withBusiness({ permission: 'sale:write' }), validate(createSaleSchema), ctl.create);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.patch('/:id', withBusiness({ permission: 'sale:write' }), validate(idParamSchema, 'params'), validate(updateSaleSchema), ctl.update);

router.post(
  '/:id/payments',
  withBusiness({ permission: 'payment:write' }),
  validate(idParamSchema, 'params'),
  validate(salePaymentSchema),
  ctl.addPayment
);

router.post(
  '/:id/refund',
  withBusiness({ permission: 'sale:refund' }),
  validate(idParamSchema, 'params'),
  validate(refundSchema),
  ctl.refund
);

router.post(
  '/:id/cancel',
  withBusiness({ permission: 'sale:write' }),
  validate(idParamSchema, 'params'),
  validate(cancelSaleSchema),
  ctl.cancel
);

export default router;
