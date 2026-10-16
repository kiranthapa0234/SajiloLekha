/**
 * One definition of "which origins may talk to this API", shared by the CORS
 * layer and the CSRF guard.
 *
 * These two used to disagree. CORS accepted any localhost port in
 * development, while the CSRF guard matched `CLIENT_URL` exactly. When Vite
 * found port 5173 busy it moved to 5174, and every write then failed with
 * "Cross-origin request blocked" even though CORS had already said yes --
 * a confusing error for what is really a port change.
 */
import env from './env.js';

/** loopback, any scheme and any port -- the dev server's address is not fixed. */
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const configured = () => new Set([env.clientUrl, env.serverUrl].filter(Boolean));

/**
 * True when a browser origin is allowed to issue requests.
 *
 * An absent Origin (curl, server-to-server, native clients, same-origin form
 * posts) is allowed: the CSRF threat model is a *different* site forging a
 * request while the refresh cookie rides along, and that always sends Origin.
 *
 * Loopback is allowed in every non-production environment, not just
 * `development`: the dev server's port is assigned by whoever starts it, and a
 * test run has no reason to be treated differently from a developer's machine.
 * Production stays on the strict configured allowlist.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (configured().has(origin)) return true;
  return !env.isProduction && LOOPBACK.test(origin);
}

export { LOOPBACK };
export default { isAllowedOrigin };