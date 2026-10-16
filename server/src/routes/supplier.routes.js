import { Router } from 'express';
import * as ctl from '../controllers/supplier.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, supplierListSchema, supplierSchema, updateSupplierSchema } from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'supplier:read' }));

router.get('/', validate(supplierListSchema, 'query'), ctl.list);
router.post('/', withBusiness({ permission: 'supplier:write' }), validate(supplierSchema), ctl.create);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.patch('/:id', withBusiness({ permission: 'supplier:write' }), validate(idParamSchema, 'params'), validate(updateSupplierSchema), ctl.update);
router.post('/:id/archive', withBusiness({ permission: 'supplier:write' }), validate(idParamSchema, 'params'), ctl.archive);
router.post('/:id/restore', withBusiness({ permission: 'supplier:write' }), validate(idParamSchema, 'params'), ctl.restore);
router.get('/:id/ledger', validate(idParamSchema, 'params'), ctl.ledger);

export default router;
