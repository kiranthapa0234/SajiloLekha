import { Router } from 'express';
import * as ctl from '../controllers/invoice.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, invoiceListSchema, invoiceQuerySchema, z } from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'invoice:read' }));

const cancelSchema = z.object({ reason: z.string().trim().max(280).optional() }).default({});
const writeOffSchema = z.object({
  amount: z.union([z.string(), z.number()]).refine((v) => Number(String(v).replace(/[^\d.-]/g, '')) > 0, 'Enter a valid amount'),
  reason: z.string().trim().max(280).optional(),
});

router.get('/', validate(invoiceListSchema, 'query'), ctl.list);
router.get('/reconcile', withBusiness({ permission: 'invoice:cancel' }), ctl.reconcile);
router.get('/:id', validate(idParamSchema, 'params'), validate(invoiceQuerySchema, 'query'), ctl.download);
router.post('/:id/cancel', withBusiness({ permission: 'invoice:cancel' }), validate(idParamSchema, 'params'), validate(cancelSchema), ctl.cancel);
router.post('/:id/write-off', withBusiness({ permission: 'invoice:cancel' }), validate(idParamSchema, 'params'), validate(writeOffSchema), ctl.writeOff);

export default router;
