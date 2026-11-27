// Settings Center, second part: templates, notifications, domain checks, backups, live facts and their permissions.
// Clearly fake data in a throwaway in-memory database; DNS and SMTP are replaced with fakes (no network).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { auditLog, formSubmissions, sessions, settingsRevisions, users as usersT } from '../src/server/db/schema.ts';
import { setSender, type SendInput } from '../src/server/modules/inbox/mail.ts';
import { setDnsProbe, resetGuard } from '../src/server/modules/settings/dns.ts';
import { flush, cancelPending } from '../src/server/modules/settings/notify.ts';

type C = Awaited<ReturnType<typeof client>>;
let h: Awaited<ReturnType<typeof makeApp>>;
let u: Record<string, C>;
let sent: SendInput[] = [];
const SMTP = { enabled: true, host: 'smtp.example.test', port: 587, security: 'starttls', user: '', fromName: 'AFCD Foundation', fromEmail: 'mailer@example.test', replyTo: '' };
const message = (over: Record<string, unknown> = {}) => h.app.request('/forms/v1/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4321', 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200)}` },
  body: JSON.stringify({ topic: 'Volunteering', name: 'Fake Person', email: 'fake.person@example.test', phone: '', org: '', message: 'Fake test message.', consent: true, website: '', t: 9000, ...over }) });

beforeEach(async () => {
  h = await makeApp(); sent = []; resetGuard();
  setSender(async (_s, m) => { sent.push(m); return { messageId: `<fake-${sent.length}@example.test>`, response: '250 OK fake' }; });
  const roles = { admin: 'website_admin', seo: 'seo_manager', rev: 'content_reviewer', ed: 'content_editor', ro: 'read_only' } as const;
  u = {};
  for (const [k, role] of Object.entries(roles)) { await addUser(h.db, `${k}@afcd.test`, role); u[k] = await client(h.app, `${k}@afcd.test`); }
});
afterEach(async () => { setSender(null); setDnsProbe(null); cancelPending(); await h?.close(); h = undefined as never; });

describe('permissions on the new sections', () => {
  it('keeps security, backups, maintenance and notifications for administrators', async () => {
    for (const p of ['/settings/facts/security', '/settings/backups', '/settings/facts/maintenance', '/settings/notifications', '/settings/diagnostics'])
      expect((await u.seo.get(p)).status, p).toBe(403);
    expect((await u.seo.raw('POST', '/settings/backups', {})).status).toBe(403);
    for (const p of ['/settings/facts/seo', '/settings/facts/localization', '/settings/facts/media', '/settings/facts/performance', '/settings/domain', '/settings/templates'])
      expect((await u.rev.get(p)).status, p).toBe(200);
    expect((await u.rev.post('/settings/domain/check')).status).toBe(403);   // running checks needs settings.update
    expect((await u.rev.put('/settings/templates', { templates: [] })).status).toBe(403);
    for (const p of ['/settings/templates', '/settings/facts/seo']) expect((await u.ed.get(p)).status, p).toBe(403);
    expect((await u.admin.get('/settings/facts/security')).status).toBe(200);
  });
});

describe('email templates', () => {
  it('refuses unknown variables and fills known ones for a real message', async () => {
    const bad = await u.seo.put('/settings/templates', { templates: [{ name: 'Leak', subject: 'Hi', body: 'Your email is {{contact_email}}' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.details[0]).toMatchObject({ path: 'templates.0.body' });
    const ok = await u.seo.put('/settings/templates', { templates: [{ name: 'Volunteering', subject: 'Re: {{topic}}', body: 'Dear {{ contact_first_name }},\nThanks from {{organization}}.\n{{sender_name}}' }] });
    expect(ok.status).toBe(200);
    const [tpl] = ok.body.templates;
    expect(tpl.id).toBeTruthy();
    expect((await h.db.select().from(settingsRevisions).where(eq(settingsRevisions.category, 'templates')))).toHaveLength(1);
    expect((await message()).status).toBe(200);
    const [m] = await h.db.select().from(formSubmissions);
    expect((await u.seo.post(`/inbox/messages/${m.id}/template/${tpl.id}`)).status).toBe(403);   // composer needs forms.manage
    const r = await u.admin.post(`/inbox/messages/${m.id}/template/${tpl.id}`);
    expect(r.body).toEqual({ subject: 'Re: Volunteering', body: 'Dear Fake,\nThanks from AFCD Foundation.\nadmin', heading: '', preheader: '', button: null, details: null });
    const pv = await u.rev.post('/settings/templates/preview', { subject: '{{topic}}', body: '{{nope}}' });
    expect(pv.body).toMatchObject({ subject: 'Volunteering', unknown: ['nope'] });
  });
});

describe('new-message notifications', () => {
  const ids = async () => Object.fromEntries((await h.db.select().from(usersT)).map((x) => [x.email.split('@')[0], x.id]));
  it('needs email sending and eligible recipients', async () => {
    const id = await ids();
    expect((await u.admin.put('/settings/notifications', { newMessages: { enabled: true, recipients: [id.admin], intervalMinutes: 60 } })).status).toBe(422);   // SMTP off
    await u.admin.put('/settings/email', SMTP);
    const ro = await u.admin.put('/settings/notifications', { newMessages: { enabled: true, recipients: [id.ro], intervalMinutes: 60 } });
    expect(ro.status).toBe(422);   // read_only cannot read the Inbox
    expect((await u.admin.put('/settings/notifications', { newMessages: { enabled: true, recipients: [id.admin], intervalMinutes: 60 } })).status).toBe(200);
  });

  it('sends counts and topics only, skips spam, and waits for the interval', async () => {
    const id = await ids();
    await u.admin.put('/settings/email', SMTP);
    await u.admin.put('/settings/notifications', { newMessages: { enabled: true, recipients: [id.admin], intervalMinutes: 60 } });
    await message(); await message({ topic: 'Partnership', name: 'Another Fake', email: 'another.fake@example.test', message: 'Secret fake text' }); await message({ website: 'spam-bot' });
    const r1 = await flush(h.db, h.cfg);
    expect(r1).toMatchObject({ sent: true, total: 2, recipients: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('admin@afcd.test');
    expect(sent[0].text).toContain('Volunteering: 1');
    expect(sent[0].text).toContain('Partnership: 1');
    for (const pii of ['Fake Person', 'fake.person@example.test', 'Another Fake', 'Secret fake text']) expect(sent[0].text + sent[0].subject).not.toContain(pii);
    await message();
    expect((await flush(h.db, h.cfg)).reason).toBe('interval');
    expect((await flush(h.db, h.cfg, new Date(Date.now() + 61 * 60_000))).total).toBe(1);
    expect((await h.db.select().from(auditLog)).filter((a) => a.action === 'settings.notification_sent')).toHaveLength(2);
  });

  it('does nothing while switched off', async () => {
    await message();
    expect((await flush(h.db, h.cfg)).reason).toBe('off');
    expect(sent).toHaveLength(0);
  });
});

describe('domain & DNS checks', () => {
  it('reports real-shaped results, flags missing records and stores the last check', async () => {
    setDnsProbe({
      a: async () => ['192.0.2.1'], aaaa: async () => { throw Object.assign(new Error('x'), { code: 'ENODATA' }); }, cname: async () => [],
      mx: async () => [{ exchange: 'mx.example.test', priority: 10 }],
      txt: async (host) => (host.startsWith('_dmarc.') ? [] : [['v=spf1 include:example.test ~all']]),
      https: async () => ({ status: 301, location: 'https://www.afcdfoundation.com/', ms: 42 }),
    });
    expect((await u.rev.get('/settings/domain')).body.last).toBeNull();
    const r = await u.seo.post('/settings/domain/check');
    expect(r.status).toBe(200);
    const web = r.body.groups.find((g: { id: string }) => g.id === 'website');
    expect(web.title).toBe('afcdfoundation.com');
    expect(web.checks.find((c: { id: string }) => c.id === 'https')).toMatchObject({ ok: true, detail: expect.stringContaining('301') });
    const mail = r.body.groups.find((g: { id: string }) => g.id === 'mail:afcdteam.com');
    expect(mail.checks.find((c: { id: string }) => c.id === 'spf').ok).toBe(true);
    expect(mail.checks.find((c: { id: string }) => c.id === 'dmarc').ok).toBe(false);
    expect((await u.seo.post('/settings/domain/check')).status).toBe(429);
    expect((await u.rev.get('/settings/domain')).body.last.checkedBy).toBe('seo@afcd.test');
    expect((await u.admin.get('/settings')).body.badges.domain).toBe('problem');
  });
});

describe('backups', () => {
  it('backs up the running database, lists, refuses too often, and deletes only its own files', async () => {
    const r = await u.admin.post('/settings/backups');
    expect(r.status).toBe(200);
    expect(r.body.name).toMatch(/^studio-db-\d{8}-\d{6}\.tar\.gz$/);
    expect(r.body.bytes).toBeGreaterThan(1000);
    expect(existsSync(join(h.cfg.dataDir, 'backups', r.body.name))).toBe(true);
    const list = (await u.admin.get('/settings/backups')).body;
    expect(list.supported).toBe(true);
    expect(list.backups[0]).toMatchObject({ name: r.body.name, kind: 'studio' });
    expect((await u.admin.post('/settings/backups')).status).toBe(429);
    expect((await u.admin.raw('DELETE', '/settings/backups/..%2Fpg')).status).toBe(404);
    expect((await u.admin.raw('DELETE', `/settings/backups/${r.body.name}`)).status).toBe(200);
    expect(readdirSync(join(h.cfg.dataDir, 'backups'))).toHaveLength(0);
    expect((await h.db.select().from(auditLog)).map((a) => a.action)).toEqual(expect.arrayContaining(['settings.backup_created', 'settings.backup_deleted']));
  });
});

describe('live facts', () => {
  it('reads the real state and says when something is unknown', async () => {
    const seo = (await u.rev.get('/settings/facts/seo')).body;
    expect(seo.indexing).toBe('unknown');   // the test site has no robots.txt
    expect(seo.analytics.connected).toBe(false);
    expect(seo.searchConsole.configured).toBe(false);
    const media = (await u.rev.get('/settings/facts/media')).body;
    expect(media).toMatchObject({ total: 0, missingAlt: 0, maxUploadMb: 15 });
    const loc = (await u.rev.get('/settings/facts/localization')).body;
    expect(loc.languages.map((l: { lang: string }) => l.lang)).toEqual(['fr', 'ar']);
    const perf = (await u.rev.get('/settings/facts/performance')).body;
    expect(perf.builds.medianMs).toBeNull();
    const sec = (await u.admin.get('/settings/facts/security')).body;
    expect(sec.roles.find((r: { id: string }) => r.id === 'website_admin').users).toBe(1);
    expect(sec.transport.https).toBe(false);
  });

  it('signs out only the caller’s other sessions', async () => {
    const second = await client(h.app, 'admin@afcd.test');   // another browser
    void second;
    const before = (await h.db.select().from(sessions)).length;
    const r = await u.admin.post('/settings/security/sign-out-others');
    expect(r.body.signedOut).toBe(1);
    expect((await h.db.select().from(sessions)).length).toBe(before - 1);
    expect((await u.admin.get('/settings')).status).toBe(200);   // this session still works
    expect((await second.get('/settings')).status).toBe(401);
  });
});
