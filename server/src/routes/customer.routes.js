import { Router } from 'express';
import * as ctl from '../controllers/customer.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import {
  customerListSchema,
  customerSchema,
  customerStatementSchema,
  idParamSchema,
  updateCustomerSchema,
} from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'customer:read' }));

router.get('/', validate(customerListSchema, 'query'), ctl.list);
router.post('/', withBusiness({ permission: 'customer:write' }), validate(customerSchema), ctl.create);
router.get('/walk-in', ctl.walkIn);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.patch('/:id', withBusiness({ permission: 'customer:write' }), validate(idParamSchema, 'params'), validate(updateCustomerSchema), ctl.update);
router.post('/:id/archive', withBusiness({ permission: 'customer:write' }), validate(idParamSchema, 'params'), ctl.archive);
router.post('/:id/restore', withBusiness({ permission: 'customer:write' }), validate(idParamSchema, 'params'), ctl.restore);
router.get('/:id/ledger', validate(idParamSchema, 'params'), ctl.ledger);
router.get('/:id/statement', validate(idParamSchema, 'params'), validate(customerStatementSchema, 'query'), ctl.statement);

export default router;
