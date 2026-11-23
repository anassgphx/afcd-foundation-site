import { describe, it, expect, afterEach } from 'vitest';
import { makeApp, fakeRunner } from './helpers.ts';
import { createApp } from '../src/server/app.ts';
import { users } from '../src/server/db/schema.ts';
import { hashPassword, isLocalOrigin } from '../src/server/auth/session.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const login = (app: ReturnType<typeof createApp>['app'], origin: string, password: string) =>
  app.request('/studio/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: 'local@afcd.local', password }) });

describe('local-only passwords', () => {
  it('knows which addresses are this computer', () => {
    expect(isLocalOrigin('http://localhost:4400')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:4400')).toBe(true);
    expect(isLocalOrigin('https://studio.afcdfoundation.com')).toBe(false);
    expect(isLocalOrigin('not a url')).toBe(false);
  });

  it('lets a short password sign in locally, and refuses it on a real address', async () => {
    h = await makeApp();
    await h.db.insert(users).values({ email: 'local@afcd.local', name: 'Local admin', role: 'super_admin', passwordHash: await hashPassword('123456'), localOnlyPassword: true });
    expect((await login(h.app, h.cfg.origin, '123456')).status).toBe(200);
    expect((await login(h.app, h.cfg.origin, '654321')).status).toBe(401);
    const online = createApp(h.db, { ...h.cfg, origin: 'https://studio.afcdfoundation.com', secureCookies: true }, { runner: fakeRunner() }).app;
    const r = await login(online, 'https://studio.afcdfoundation.com', '123456');
    expect(r.status).toBe(403);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
});
