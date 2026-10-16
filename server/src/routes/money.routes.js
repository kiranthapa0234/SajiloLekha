/**
 * Money routes -- the workspace's own cash and bank position.
 *
 * Kept separate from the payments routes on purpose: a payment records money
 * owed or received against a document, while these record money physically
 * moving between (and out of) the business's own accounts.
 */
import { Router } from 'express';
import * as ctl from '../controllers/money.controller.js';
import { validate } from '../middleware/validate.js';
import { withBusiness } from '../middleware/business.js';
import { moneyListSchema, moneyMovementSchema, moneyTransferSchema } from '../../../shared/validators/index.js';

const router = Router();

router.use(withBusiness({ permission: 'report:read' }));

router.get('/balances', ctl.balances);
router.get('/movements', validate(moneyListSchema, 'query'), ctl.movements);

// Writing to the ledger is a privileged act; it needs the same permission as
// adjusting stock, because both are manual corrections to the books.
router.post('/transfer', withBusiness({ permission: 'stock:adjust' }), validate(moneyTransferSchema), ctl.move);
router.post('/in', withBusiness({ permission: 'stock:adjust' }), validate(moneyMovementSchema), ctl.add);
router.post('/out', withBusiness({ permission: 'stock:adjust' }), validate(moneyMovementSchema), ctl.remove);

export default router;
