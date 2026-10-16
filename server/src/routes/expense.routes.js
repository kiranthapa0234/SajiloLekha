import { Router } from 'express';
import * as ctl from '../controllers/expense.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { expenseListSchema, expenseSchema, idParamSchema, updateExpenseSchema, z } from '../../../shared/validators/index.js';

const router = Router();
router.use(withBusiness({ permission: 'expense:read' }));

const reasonSchema = z.object({ reason: z.string().trim().max(280).optional() }).default({});

router.get('/', validate(expenseListSchema, 'query'), ctl.list);
router.post('/', withBusiness({ permission: 'expense:write' }), validate(expenseSchema), ctl.create);
router.get('/totals', ctl.totals);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.patch('/:id', withBusiness({ permission: 'expense:write' }), validate(idParamSchema, 'params'), validate(updateExpenseSchema), ctl.update);
router.post('/:id/void', withBusiness({ permission: 'expense:write' }), validate(idParamSchema, 'params'), validate(reasonSchema), ctl.voidExpense);
router.post('/:id/archive', withBusiness({ permission: 'expense:write' }), validate(idParamSchema, 'params'), ctl.archive);
router.post('/:id/restore', withBusiness({ permission: 'expense:write' }), validate(idParamSchema, 'params'), ctl.restore);

export default router;
