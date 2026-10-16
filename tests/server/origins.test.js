/**
 * Origin handling: the CORS layer and the CSRF guard must agree.
 *
 * They used to disagree -- CORS allowed any loopback port in development while
 * the CSRF guard matched CLIENT_URL exactly. When Vite moved off port 5173
 * because the port was busy, every write failed with "Cross-origin request
 * blocked" even though CORS had already approved the request.
 */
import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '@server/config/origins.js';

describe('isAllowedOrigin', () => {
  it('accepts the configured client and server URLs', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:4000')).toBe(true);
  });

  it('accepts any loopback port outside production, because the dev server moves', () => {
    // This is the regression: Vite picks the next free port when 5173 is taken.
    expect(isAllowedOrigin('http://localhost:5174')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5273')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5174')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:5174')).toBe(true);
  });

  it('treats a request with no Origin as allowed', () => {
    // curl, server-to-server, native clients, same-origin form posts.
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('rejects a genuinely foreign origin', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
    // Look-alike host must not slip through on a substring match.
    expect(isAllowedOrigin('http://localhost.evil.com:5173')).toBe(false);
    expect(isAllowedOrigin('http://notlocalhost:5173')).toBe(false);
  });
});