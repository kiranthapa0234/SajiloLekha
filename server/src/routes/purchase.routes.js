import { Router } from 'express';
import * as ctl from '../controllers/purchase.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import {
  createPurchaseSchema,
  idParamSchema,
  purchaseListSchema,
  purchasePaymentSchema,
  supplierReturnSchema,
  z,
} from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'purchase:read' }));

const cancelSchema = z.object({
  reason: z.string().trim().max(280).optional(),
  restock: z.coerce.boolean().default(false),
});

router.get('/', validate(purchaseListSchema, 'query'), ctl.list);
router.post('/', withBusiness({ permission: 'purchase:write' }), validate(createPurchaseSchema), ctl.create);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.post('/:id/cancel', withBusiness({ permission: 'purchase:write' }), validate(idParamSchema, 'params'), validate(cancelSchema), ctl.cancel);
router.post('/:id/payments', withBusiness({ permission: 'payment:write' }), validate(idParamSchema, 'params'), validate(purchasePaymentSchema), ctl.addPayment);

// Stock going back to a supplier who refunded us. Its own resource rather than a
// sub-path of a purchase, because the common case is returning goods against a
// bill that has already been settled — there is no purchase to hang it off.
router.post('/returns', withBusiness({ permission: 'purchase:write' }), validate(supplierReturnSchema), ctl.returnToSupplier);

export default router;
