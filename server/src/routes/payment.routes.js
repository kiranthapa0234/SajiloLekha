import { Router } from 'express';
import * as ctl from '../controllers/payment.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  paymentListSchema,
  recordPaymentSchema,
  voidPaymentSchema,
  z,
} from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'payment:read' }));

const reconcileSchema = z.object({
  status: z.enum(['unreconciled', 'reconciled', 'mismatch']),
  bankReference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(280).optional(),
});

router.get('/', validate(paymentListSchema, 'query'), ctl.list);
router.post('/', withBusiness({ permission: 'payment:write' }), validate(recordPaymentSchema), ctl.create);
router.get('/methods', ctl.methods);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.post('/:id/void', withBusiness({ permission: 'payment:write' }), validate(idParamSchema, 'params'), validate(voidPaymentSchema), ctl.voidPayment);
router.patch('/:id/reconcile', withBusiness({ permission: 'payment:write' }), validate(idParamSchema, 'params'), validate(reconcileSchema), ctl.reconcile);

export default router;
