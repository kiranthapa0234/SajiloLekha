/**
 * Session state.
 *
 * The access token lives in memory (never localStorage, where XSS could read
 * it); the refresh token is an HttpOnly cookie. On mount the app calls `/auth/me`
 * to restore a session from that cookie alone.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setAccessToken, setUnauthenticatedHandler } from '@/services/http.js';
import { auth, businesses } from '@/services/index.js';

/**
 * The context object itself is exported so tests can supply a session without
 * booting the provider and its `/auth/me` round-trip.
 */
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [membership, setMembership] = useState(null);
  /** 'loading' | 'authenticated' | 'anonymous' */
  const [status, setStatus] = useState('loading');
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  /**
   * The refresh must happen exactly once per page load.
   *
   * React StrictMode double-invokes effects in development. Two refreshes means
   * the second presents a token the first already rotated, which the server
   * treats as reuse and answers by revoking every session for that user. That
   * is correct server behaviour and a client bug, so the fix belongs here: the
   * ref survives the StrictMode remount and both invocations await one promise.
   */
  const bootstrapRef = useRef(null);

  useEffect(() => () => { mounted.current = false; }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setBusiness(null);
    setMembership(null);
    setWorkspaces([]);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthenticatedHandler(clearSession);
  }, [clearSession]);

  /** Apply an auth payload (login, register, refresh, workspace switch). */
  const applySession = useCallback(
    (payload) => {
      // `/auth/me` carries no access token -- it is a profile lookup, not a
      // token exchange. The live token is the one the silent refresh just
      // obtained, so a payload without one must leave it alone. Clearing it
      // here signed the user out on every page reload while the UI still
      // showed them as signed in.
      if (payload.accessToken) setAccessToken(payload.accessToken);
      setUser(payload.user ?? null);
      setBusiness(payload.business ?? null);
      setMembership(payload.membership ?? null);
      if (Array.isArray(payload.businesses)) setWorkspaces(payload.businesses);
      setStatus('authenticated');
    },
    []
  );

  // The http layer dispatches this after a silent refresh so the shell stays in sync.
  useEffect(() => {
    const onSession = (event) => {
      if (!mounted.current) return;
      const detail = event.detail ?? {};
      if (detail.user) setUser(detail.user);
      if (detail.business) setBusiness(detail.business);
      if (detail.membership) setMembership(detail.membership);
    };
    window.addEventListener('lekhapana:session', onSession);
    return () => window.removeEventListener('lekhapana:session', onSession);
  }, []);

  // Restore the session from the HttpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // One refresh per page load, shared across a StrictMode remount.
        if (!bootstrapRef.current) {
          bootstrapRef.current = (async () => {
            // The access token only ever lived in memory, so a reload starts
            // with none. The cookie must be exchanged explicitly before
            // /auth/me can succeed; calling it on its own always 401s.
            const restored = await auth.restore();
            return restored ? auth.me() : null;
          })();
        }
        const payload = await bootstrapRef.current;
        if (cancelled) return;
        if (!payload) {
          setStatus('anonymous');
          return;
        }
        applySession(payload);
      } catch {
        // A 401 simply means "not signed in"; anything else is still anonymous
        // here because there is nothing useful to render without a session.
        // The promise is left in place on purpose: retrying would mean a second
        // refresh, which reuse detection would punish.
        if (!cancelled) setStatus('anonymous');
      }
    })();
    return () => { cancelled = true; };
  }, [applySession]);

  const login = useCallback(
    async (credentials) => {
      const payload = await auth.login(credentials);
      applySession(payload);
      return payload.business;
    },
    [applySession]
  );

  const register = useCallback(
    async (payload) => {
      const result = await auth.register(payload);
      applySession(result);
      return result.business;
    },
    [applySession]
  );

  const logout = useCallback(
    async ({ allDevices = false } = {}) => {
      try {
        await auth.logout(allDevices);
      } finally {
        clearSession();
      }
    },
    [clearSession]
  );

  const switchBusiness = useCallback(
    async (businessId) => {
      const payload = await auth.switchBusiness(businessId);
      applySession(payload);
      // Every cached query belongs to the previous workspace.
      queryClient.clear();
      return payload.business;
    },
    [applySession, queryClient]
  );

  const refreshWorkspaces = useCallback(async () => {
    const list = await businesses.list();
    setWorkspaces(list);
    return list;
  }, []);

  const updateProfile = useCallback(
    async (payload) => {
      const updated = await auth.updateProfile(payload);
      setUser(updated);
      return updated;
    },
    []
  );

  /**
   * Capability check mirroring the server matrix. The server remains the real
   * gate; this only decides what to render.
   */
  const can = useCallback(
    (permission) => {
      if (!membership?.permissions) return false;
      if (permission === 'business:manage') return membership.role === 'owner';
      return membership.permissions.includes(permission);
    },
    [membership]
  );

  const isOwner = membership?.role === 'owner';
  const isAdmin = isOwner || membership?.role === 'admin';

  const value = useMemo(
    () => ({
      user,
      business,
      workspaces,
      membership,
      status,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      isOwner,
      isAdmin,
      can,
      login,
      register,
      logout,
      switchBusiness,
      refreshWorkspaces,
      updateProfile,
    }),
    [
      user, business, workspaces, membership, status, isOwner, isAdmin, can,
      login, register, logout, switchBusiness, refreshWorkspaces, updateProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * The active business id, for services that need it as a request option.
 * `null` while anonymous, so callers never send a stale workspace.
 */
export function useBusinessId() {
  const { business } = useAuth();
  return business?.id ?? null;
}
