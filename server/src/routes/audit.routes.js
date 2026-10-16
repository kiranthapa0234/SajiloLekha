import { Router } from 'express';
import * as ctl from '../controllers/audit.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { auditListSchema } from '../../../shared/validators/index.js';

const router = Router();

// Reference metadata + health are readable by any authenticated user.
router.get('/enums', withBusiness({ required: false }), ctl.enums);
router.get('/health', ctl.health);

// The audit trail itself is owner/admin only.
router.get('/logs', withBusiness({ permission: 'audit:read' }), validate(auditListSchema, 'query'), ctl.list);
router.get('/logs/meta', withBusiness({ permission: 'audit:read' }), ctl.meta);

export default router;
