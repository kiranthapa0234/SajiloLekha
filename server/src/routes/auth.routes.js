import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/security.js';
import { notFound } from '../middleware/error.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  switchBusinessSchema,
  updateProfileSchema,
  z,
} from '../../../shared/validators/index.js';

/* ------------------------------------------------------- PUBLIC ROUTES -- */

const router = Router();

const tokenSchema = z.object({ token: z.string().min(10) });
const revokeSchema = z.object({ exceptJti: z.string().max(64).optional() }).default({});

router.post('/register', authLimiter, validate(registerSchema), auth.register);
router.post('/login', authLimiter, validate(loginSchema), auth.login);
router.post('/refresh', authLimiter, validate(refreshSchema), auth.refresh);
router.post('/logout', validate(logoutSchema), auth.logout);

router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), auth.resetPassword);
router.post('/verify-email', validate(tokenSchema), auth.verifyEmail);

/* -------------------------------------------------- AUTHENTICATED ROUTES -- */

// `authenticate` is applied per route rather than via `router.use(...)`.
// A blanket `use` would also capture unknown public paths and answer 401 for
// them, hiding a truthful 404. Per-route keeps the two concerns separate.
const priv = (...handlers) => [authenticate, ...handlers];

router.get('/me', priv(auth.me));
router.patch('/me', priv(validate(updateProfileSchema), auth.updateProfile));
router.post('/me/password', priv(validate(changePasswordSchema), auth.changeMyPassword));
router.post('/switch-business', priv(validate(switchBusinessSchema), auth.switchBusiness));
router.get('/sessions', priv(auth.sessions));
router.post('/sessions/revoke', priv(validate(revokeSchema), auth.revokeSessions));

// Anything under /api/auth that matched nothing above genuinely does not exist,
// and revealing that exposes nothing.
router.use(notFound);

export default router;
