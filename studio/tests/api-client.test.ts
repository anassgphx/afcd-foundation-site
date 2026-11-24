// Admin API client: recovers from a sign-in that changed in another tab (src/admin/api.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setCsrf } from '../src/admin/api.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** A fake Studio: writes need `token`; /me says who is signed in now. */
function fakeServer(token: string, me: unknown) {
  const calls: { path: string; csrf?: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>; calls.push({ path: url, csrf: h['X-CSRF-Token'] });
    if (url === '/studio/api/me') return me ? json(200, me) : json(401, { error: 'Sign in' });
    return h['X-CSRF-Token'] === token ? json(200, { ok: true }) : json(403, { error: 'Invalid or missing CSRF token.' });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('api client and a changed sign-in', () => {
  it('carries on with the fresh token when the same person signed in again', async () => {
    setCsrf('old', 'u1');
    const calls = fakeServer('new', { user: { id: 'u1', name: 'Admin' }, csrf: 'new' });
    await expect(api('/x', { method: 'POST', json: {} })).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.csrf ?? c.path)).toEqual(['old', '/studio/api/me', 'new']);
  });
  it('never acts for a different person: asks to reload instead', async () => {
    setCsrf('old', 'u1');
    const calls = fakeServer('other', { user: { id: 'u2', name: 'ikram101' }, csrf: 'other' });
    await expect(api('/x', { method: 'POST', json: {} })).rejects.toThrow(/signed in as ikram101.*Reload/);
    expect(calls.filter((c) => c.csrf === 'other')).toHaveLength(0);
  });
  it('asks to sign in again when the session ended', async () => {
    setCsrf('old', 'u1');
    fakeServer('x', null);
    await expect(api('/x', { method: 'POST', json: {} })).rejects.toThrow(/session ended/);
  });
});
