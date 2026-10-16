/**
 * Auth controller -— registration, login, session refresh, logout, profile.
 *
 * Responses carry a short-lived `accessToken` for the Authorization header plus
 * an HttpOnly refresh cookie. The SPA never has to read the refresh token.
 */
import { AppError, asyncHandler } from '../utils/errors.js';
import { sendCreated, sendOk } from '../utils/response.js';
import env from '../config/env.js';
import {
  changePassword,
  changeProfile,
  clearRefreshCookie,
  issueSession,
  listSessions,
  loginUser,
  pickMembership,
  registerUser,
  requestPasswordReset,
  resetPassword as resetPasswordWithToken,
  revokeAllSessions,
  revokeSession,
  rotateSession as refreshSession,
  setRefreshCookie,
  signAccessToken,
  verifyEmail as verifyEmailToken,
} from '../services/auth.service.js';
import { listAccessibleBusinesses } from '../services/tenant.service.js';
import { permissionsForRole } from '../../../shared/constants.js';

/** Shape the SPA uses to bootstrap (and later refresh) its session. */
export function buildAuthPayload(user, membership, business) {
  return {
    user: typeof user.toSafeJSON === 'function' ? user.toSafeJSON() : user,
    business: business
      ? {
          id: business._id ?? business.id,
          name: business.name,
          legalName: business.legalName ?? '',
          logoUrl: business.logoUrl ?? null,
          currency: business.settings?.currency ?? 'NPR',
          currencySymbol: business.settings?.currencySymbol ?? 'Rs.',
          currencyDecimals: business.settings?.currencyDecimals ?? 2,
          locale: business.settings?.locale ?? 'en-NP',
          timezone: business.settings?.timezone ?? 'Asia/Kathmandu',
          taxEnabled: business.settings?.taxEnabled ?? false,
          taxRatePercent: business.settings?.taxRatePercent ?? 0,
          taxInclusive: business.settings?.taxInclusive ?? false,
          taxLabel: business.settings?.taxLabel ?? 'VAT',
          invoicePrefix: business.settings?.invoicePrefix ?? 'INV',
          invoiceDueDays: business.settings?.invoiceDueDays ?? 0,
          paymentMethods: business.settings?.paymentMethods ?? ['cash'],
          maxDiscountPercent: business.settings?.maxDiscountPercent ?? 20,
          allowNegativeStock: business.settings?.allowNegativeStock ?? false,
          lowStockAlerts: business.settings?.lowStockAlerts ?? true,
          accounting: business.settings?.accounting ?? { basis: 'accrual', purchaseAsExpense: false },
          receiptFooter: business.settings?.receiptFooter ?? '',
          terms: business.settings?.terms ?? '',
          address: business.address ?? {},
          phone: business.phone ?? '',
          email: business.email ?? '',
          taxNumber: business.taxNumber ?? '',
          registrationNumber: business.registrationNumber ?? '',
          plan: business.subscription?.plan ?? 'free',
          createdAt: business.createdAt,
        }
      : null,
    membership: membership
      ? {
          role: membership.role,
          permissions: permissionsForRole(membership.role),
          joinedAt: membership.joinedAt,
          ownRecordsOnly: Boolean(membership.scope?.ownRecordsOnly),
        }
      : null,
  };
}

const ctx = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] ?? null });

function readRefreshToken(req) {
  return req.cookies?.[env.cookies.refreshName] ?? req.body?.refreshToken ?? null;
}

export const register = asyncHandler(async (req, res) => {
  const { user, business } = await registerUser(req.body, ctx(req));
  const membership = { role: 'owner', joinedAt: new Date() };

  const { token: refreshToken } = await issueSession(user, ctx(req));
  setRefreshCookie(res, refreshToken);

  const accessToken = signAccessToken(user, { business: business._id, role: 'owner' });
  return sendCreated(res, { ...buildAuthPayload(user, membership, business), accessToken });
});

export const login = asyncHandler(async (req, res) => {
  const { user, membership } = await loginUser(req.body, ctx(req));
  const { token: refreshToken } = await issueSession(user, ctx(req));
  setRefreshCookie(res, refreshToken);

  const accessToken = signAccessToken(user, membership);
  return sendOk(res, { ...buildAuthPayload(user, membership, membership?.business), accessToken });
});

export const refresh = asyncHandler(async (req, res) => {
  const { user, refreshToken, membership } = await refreshSession(readRefreshToken(req), ctx(req));
  setRefreshCookie(res, refreshToken);
  const accessToken = signAccessToken(user, membership);
  return sendOk(res, { ...buildAuthPayload(user, membership, membership?.business), accessToken });
});

export const logout = asyncHandler(async (req, res) => {
  if (req.body?.allDevices && req.user) {
    await revokeAllSessions(req.user._id);
  } else {
    await revokeSession(readRefreshToken(req));
  }
  clearRefreshCookie(res);
  return sendOk(res, { loggedOut: true });
});

export const me = asyncHandler(async (req, res) => {
  const requested = req.query.businessId ?? req.headers['x-business-id'] ?? null;
  const membership = await pickMembership(req.user, requested);
  const [businesses, activeSessions] = await Promise.all([
    listAccessibleBusinesses(req.user._id),
    listSessions(req.user._id),
  ]);
  return sendOk(res, { ...buildAuthPayload(req.user, membership, membership?.business), businesses, activeSessions });
});

export const switchBusiness = asyncHandler(async (req, res) => {
  const membership = await pickMembership(req.user, req.body.businessId);
  if (!membership) throw AppError.forbidden('You do not have access to this business');

  // Persist the choice so subsequent requests without an explicit
  // X-Business-Id header resolve to the workspace the user actually chose.
  req.user.lastActiveBusiness = membership.business._id;
  await req.user.save();

  const accessToken = signAccessToken(req.user, membership);
  return sendOk(res, { ...buildAuthPayload(req.user, membership, membership.business), accessToken });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await changeProfile(req.user, req.body);
  return sendOk(res, user.toSafeJSON());
});

export const changeMyPassword = asyncHandler(async (req, res) => {
  await changePassword(req.user._id, req.body, ctx(req));
  clearRefreshCookie(res);
  return sendOk(res, { changed: true, message: 'Password updated. Please sign in again.' });
});

export const sessions = asyncHandler(async (req, res) => {
  return sendOk(res, await listSessions(req.user._id));
});

export const revokeSessions = asyncHandler(async (req, res) => {
  await revokeAllSessions(req.user._id, req.body?.exceptJti);
  clearRefreshCookie(res);
  return sendOk(res, { revoked: true });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset(req.body.email);
  return sendOk(res, {
    sent: true,
    message: 'If an account exists for that email, a reset link has been sent.',
    // Exposed outside production so the flow is testable without an SMTP server.
    ...(result.token ? { devToken: result.token } : {}),
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await resetPasswordWithToken(req.body, ctx(req));
  clearRefreshCookie(res);
  return sendOk(res, { reset: true, message: 'Password reset. You can now sign in.' });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await verifyEmailToken(req.body.token);
  return sendOk(res, { verified: true });
});
