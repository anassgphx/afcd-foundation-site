// Studio accounts: forgot password by email (same answer for unknown addresses, one-use expiring links, rate limit),
// changing your own password, administrators setting a password or emailing a link. No real email is sent.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN, PW } from './helpers.ts';
import { passwordResets, sessions, users } from '../src/server/db/schema.ts';
import { saveMailSettings, setSender, type SendInput } from '../src/server/modules/inbox/mail.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
let sent: SendInput[] = [];
afterEach(async () => { setSender(null); await h?.close(); h = undefined; });
const NEW = 'a brand new long password';
const pub = async (path: string, body: unknown) => { const r = await h!.app.request(`/studio/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) as any }; };
const login = async (email: string, password: string) => (await h!.app.request('/studio/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) })).status;
const tokenFrom = (m: SendInput) => decodeURIComponent(/reset=([A-Za-z0-9_%-]+)/.exec(m.text)![1]);
const flush = () => new Promise((r) => setTimeout(r, 50));

describe('accounts', () => {
  beforeEach(async () => {
    sent = [];
    setSender(async (_s, m) => { sent.push(m); return { messageId: `<fake-${sent.length}@example.org>` }; });
    h = await makeApp();
    await addUser(h.db, 'admin@afcd.test', 'super_admin');
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    await addUser(h.db, 'web@afcd.test', 'website_admin');
  });
  const mailOn = async () => {
    const [u] = await h!.db.select().from(users).where(eq(users.email, 'admin@afcd.test'));
    await saveMailSettings(h!.db, h!.cfg, { id: u.id, email: u.email }, { enabled: true, host: 'smtp.example.org', port: 587, security: 'starttls', user: '', fromName: 'AFCD', fromEmail: 'no-reply@example.org', replyTo: '' });
  };

  it('emails a one-use link that sets a new password and signs the account out everywhere', async () => {
    expect((await h!.app.request('/studio/api/public-config')).status).toBe(200);
    expect((await (await h!.app.request('/studio/api/public-config')).json()).passwordReset).toBe(false);
    await mailOn();
    expect((await (await h!.app.request('/studio/api/public-config')).json()).passwordReset).toBe(true);
    const ed = await client(h!.app, 'ed@afcd.test');
    expect((await pub('/auth/forgot', { email: 'ED@afcd.test' })).body).toEqual({ ok: true });
    expect((await pub('/auth/forgot', { email: 'nobody@afcd.test' })).body).toEqual({ ok: true });   // same answer
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ed@afcd.test');
    const token = tokenFrom(sent[0]);
    expect((await h!.db.select().from(passwordResets)).every((r) => r.tokenHash !== token)).toBe(true);   // only the hash is stored
    expect((await pub('/auth/reset/check', { token })).body).toEqual({ ok: true, email: 'ed@afcd.test' });
    expect((await pub('/auth/reset', { token, password: 'short' })).status).toBe(422);
    expect((await pub('/auth/reset', { token, password: NEW })).status).toBe(200);
    expect((await ed.get('/me')).status).toBe(401);                       // signed out everywhere
    expect(await login('ed@afcd.test', PW)).toBe(401);
    expect(await login('ed@afcd.test', NEW)).toBe(200);
    expect((await pub('/auth/reset', { token, password: 'another long password' })).status).toBe(409);   // used once
    expect((await pub('/auth/reset/check', { token })).body).toEqual({ ok: false });
  });

  it('sends nothing for unknown or deactivated accounts, or without email set up, and limits requests', async () => {
    await pub('/auth/forgot', { email: 'ed@afcd.test' });
    await flush();
    expect(sent).toHaveLength(0);                                          // email not set up yet
    await mailOn();
    await h!.db.update(users).set({ active: false }).where(eq(users.email, 'web@afcd.test'));
    await pub('/auth/forgot', { email: 'web@afcd.test' });
    for (let i = 0; i < 4; i++) await pub('/auth/forgot', { email: 'admin@afcd.test' });
    await flush();
    expect(sent.map((m) => m.to)).toEqual(['admin@afcd.test', 'admin@afcd.test', 'admin@afcd.test']);   // 3 per hour per address; nothing for the deactivated one
    expect((await pub('/auth/forgot', { email: 'not an email' })).status).toBe(422);
  });

  it('expired links do not work', async () => {
    await mailOn();
    await pub('/auth/forgot', { email: 'ed@afcd.test' });
    await flush();
    await h!.db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await pub('/auth/reset', { token: tokenFrom(sent[0]), password: NEW })).status).toBe(409);
  });

  it('lets you change your own password with the current one, keeping this session', async () => {
    const ed = await client(h!.app, 'ed@afcd.test');
    const other = await client(h!.app, 'ed@afcd.test');
    expect((await ed.post('/me/password', { current: 'wrong password!!', password: NEW })).status).toBe(422);
    expect((await ed.post('/me/password', { current: PW, password: PW })).status).toBe(422);
    expect((await ed.post('/me/password', { current: PW, password: NEW })).status).toBe(200);
    expect((await ed.get('/me')).status).toBe(200);
    expect((await other.get('/me')).status).toBe(401);
    expect(await login('ed@afcd.test', NEW)).toBe(200);
  });

  it('lets administrators set a password or email a link, and nobody else', async () => {
    const admin = await client(h!.app, 'admin@afcd.test');
    const web = await client(h!.app, 'web@afcd.test');
    const ed = await client(h!.app, 'ed@afcd.test');
    const id = (email: string) => h!.db.select().from(users).where(eq(users.email, email)).then((r) => r[0].id);
    const edId = await id('ed@afcd.test'), adminId = await id('admin@afcd.test');
    expect((await web.post(`/users/${edId}/password`, { password: NEW })).status).toBe(403);   // website admins cannot manage users
    expect((await ed.post(`/users/${adminId}/password`, { password: NEW })).status).toBe(403);
    expect((await admin.post(`/users/${adminId}/password`, { password: NEW })).status).toBe(409);   // own password: from the account menu
    expect((await admin.post(`/users/${edId}/password`, { password: 'short' })).status).toBe(422);
    expect((await admin.post(`/users/${edId}/password`, { password: NEW })).status).toBe(200);
    expect((await ed.get('/me')).status).toBe(401);
    expect(await login('ed@afcd.test', NEW)).toBe(200);
    expect((await admin.post(`/users/${edId}/password-link`)).status).toBe(409);   // email not set up
    await mailOn();
    expect((await admin.post(`/users/${edId}/password-link`)).body).toMatchObject({ ok: true, email: 'ed@afcd.test' });
    expect(sent[0].subject).toBe('Choose your AFCD Studio password');
    expect((await pub('/auth/reset', { token: tokenFrom(sent[0]), password: 'yet another long password' })).status).toBe(200);
    expect((await h!.db.select().from(sessions).where(eq(sessions.userId, edId)))).toHaveLength(0);
    // name and email can be corrected; emails stay unique
    expect((await admin.raw('PATCH', `/users/${edId}`, { name: 'Edith Editor', email: 'edith@afcd.test' })).status).toBe(200);
    expect((await admin.raw('PATCH', `/users/${edId}`, { email: 'admin@afcd.test' })).status).toBe(409);
  });
});
