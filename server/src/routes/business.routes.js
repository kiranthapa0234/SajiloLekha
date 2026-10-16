import { Router } from 'express';
import * as ctl from '../controllers/business.controller.js';
import { withBusiness } from '../middleware/business.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/security.js';
import {
  createBusinessSchema,
  inviteMemberSchema,
  updateBusinessSchema,
  updateMemberSchema,
  z,
} from '../../../shared/validators/index.js';

const router = Router();

const memberIdSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
const archiveSchema = z.object({ reason: z.string().trim().max(280).optional() }).default({});

// ---- Workspace list / create (no business context yet) ------------------
router.get('/', ctl.list);
router.post('/', validate(createBusinessSchema), ctl.create);

// ---- Everything below operates inside one verified workspace -------------
router.use(withBusiness({ attachAudit: true }));

router.get('/current', ctl.current);
router.patch('/', validate(updateBusinessSchema), ctl.update);
router.get('/stats', ctl.stats);

// Members
router.get('/members', ctl.listMembers);
router.post('/members', validate(inviteMemberSchema), ctl.inviteMember);
router.patch('/members/:id', validate(memberIdSchema), validate(updateMemberSchema), ctl.updateMember);
router.delete('/members/:id', validate(memberIdSchema), validate(archiveSchema), ctl.removeMember);

// Attachments
router.post('/uploads', upload.single('file'), ctl.uploadFile);

export default router;
