import { Router } from 'express';
import * as ctl from '../controllers/product.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import {
  bulkStockAdjustmentSchema,
  idParamSchema,
  productCategorySchema,
  productListSchema,
  productSchema,
  stockAdjustmentPayloadSchema,
  stockAdjustmentSchema,
  stockMovementQuerySchema,
  updateProductCategorySchema,
  updateProductSchema,
} from '../../../shared/validators/index.js';

const router = Router();

// Business membership is verified for every route below. The `business` query
// param in list schemas is intentionally ignored by controllers: the business
// always comes from the verified membership.
router.use(withBusiness());

/* ------------------------------------------------------------ CATEGORIES -- */
router.get('/categories', ctl.listCategories);
router.post('/categories', validate(productCategorySchema), ctl.createCategory);
router.patch('/categories/:id', validate(idParamSchema), validate(updateProductCategorySchema), ctl.updateCategory);
router.patch('/categories/:id/archive', validate(idParamSchema), ctl.archiveCategory);

/* -------------------------------------------------------- CHECKOUT SEARCH -- */
router.get('/search', ctl.search);
router.get('/alerts', ctl.alerts);

/* ------------------------------------------------------------- MOVEMENTS -- */
router.get('/movements', validate(stockMovementQuerySchema, 'query'), ctl.movementHistory);

/* -------------------------------------------------------------- PRODUCTS -- */
router.get('/', validate(productListSchema, 'query'), ctl.list);
router.post('/', validate(productSchema), ctl.create);
router.get('/:id', validate(idParamSchema, 'params'), ctl.get);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateProductSchema), ctl.update);
router.post('/:id/archive', validate(idParamSchema, 'params'), ctl.archive);
router.post('/:id/restore', validate(idParamSchema, 'params'), ctl.restore);
// The product id is in the URL here, so the body schema omits it.
router.post('/:id/stock', validate(idParamSchema, 'params'), validate(stockAdjustmentPayloadSchema), ctl.adjustStock);

export { router as productRouter };
export const stockRouter = Router();
stockRouter.use(withBusiness({ permission: 'stock:adjust' }));
stockRouter.post('/adjust', validate(stockAdjustmentSchema), ctl.adjustStock);
stockRouter.post('/bulk-adjust', validate(bulkStockAdjustmentSchema), ctl.bulkAdjustStock);
stockRouter.get('/', validate(stockMovementQuerySchema, 'query'), ctl.movementHistory);

export default router;
