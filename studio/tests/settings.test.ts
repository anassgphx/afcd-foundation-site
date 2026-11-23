// Settings Center: permissions, validation, secret masking, test-email outcomes, history/restore, publishing and the
// build hook (lib/site-settings.mjs). All data here is clearly fake and lives in a throwaway in-memory database.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, fakeRunner } from './helpers.ts';
import { auditLog, settingsRevisions } from '../src/server/db/schema.ts';
import { setSender } from '../src/server/modules/inbox/mail.ts';
import { setProbe } from '../src/server/modules/settings/email.ts';
import { DEFAULTS } from '../src/server/modules/settings/service.ts';
import { loadSiteSettings, applyPage, applyHead, applyOrg } from '../../lib/site-settings.mjs';
import type { BuildRunner } from '../src/server/modules/publish/service.ts';

type C = Awaited<ReturnType<typeof client>>;
let h: Awaited<ReturnType<typeof makeApp>>;
let users: Record<string, C>;
const SECRET = 'fake-smtp-secret-9f3k2';
const SMTP = { enabled: true, host: 'smtp.example.test', port: 587, security: 'starttls', user: 'mailer@example.test', password: SECRET, fromName: 'AFCD Foundation', fromEmail: 'mailer@example.test', replyTo: '' };
const CONTACT = { ...DEFAULTS.contact, social: { ...DEFAULTS.contact.social } };

/** Fake build plus what build.mjs does with src/data/site-settings.json: every page carries the settings revision. */
const runner = (opts: { skipMarker?: boolean } = {}): BuildRunner => {
  const base = fakeRunner();
  return async (cfg, mode) => {
    const out = await base(cfg, mode);
    const f = join(cfg.siteRoot, 'src/data/site-settings.json');
    if (mode.kind === 'live' && existsSync(f) && !opts.skipMarker) {
      const S = loadSiteSettings(f)!;
      for (const p of readdirSync(join(cfg.siteRoot, 'src/pages')).filter((x) => x.endsWith('.html')))
        writeFileSync(join(cfg.siteRoot, p), applyPage(`<meta name="studio-settings-rev" content="${S.revision}"><a href="tel:+212663618536">+212 663 618 536</a>`, S));
    }
    return out;
  };
};

async function setup(r?: BuildRunner) {
  h = await makeApp({ runner: r ?? runner() });
  writeFileSync(join(h.siteRoot, 'src/pages/contact.html'), '---\ntitle: Contact\n---\n<p>contact</p>');
  const roles = { super: 'super_admin', admin: 'website_admin', admin2: 'website_admin', admin3: 'website_admin', seo: 'seo_manager', rev: 'content_reviewer', ed: 'content_editor', ro: 'read_only' } as const;
  users = {};
  for (const [k, role] of Object.entries(roles)) { await addUser(h.db, `${k}@afcd.test`, role); users[k] = await client(h.app, `${k}@afcd.test`); }
}
afterEach(async () => { setSender(null); setProbe(null); await h?.close(); h = undefined as never; });

describe('settings permissions (server-side)', () => {
  beforeEach(() => setup());

  it('closes the Settings Center to roles without settings.read', async () => {
    for (const k of ['ed', 'ro']) {
      expect((await users[k].get('/settings')).status, k).toBe(403);
      expect((await users[k].put('/settings/contact', CONTACT)).status, k).toBe(403);
      expect((await users[k].get('/settings/history')).status, k).toBe(403);
    }
  });

  it('lets reviewers read but not change, and hides the email server from non-admins', async () => {
    const r = await users.rev.get('/settings');
    expect(r.status).toBe(200);
    expect(r.body.permissions).toEqual({ update: false, admin: false, publish: false });
    expect(r.body.email).toEqual({ ready: false });
    expect(r.body.categories).toHaveLength(15);
    expect((await users.rev.put('/settings/contact', CONTACT)).status).toBe(403);
    expect((await users.rev.post('/settings/publish')).status).toBe(403);
  });

  it('lets the SEO manager edit contact details but not admin-only fields, email, restore or publish', async () => {
    expect((await users.seo.put('/settings/contact', { ...CONTACT, phone: '+212 600 000 001' })).status).toBe(200);
    const g = await users.seo.put('/settings/general', { ...DEFAULTS.general, canonicalUrl: 'https://example.test/' });
    expect(g.status).toBe(422);
    expect(g.body.details[0].path).toBe('canonicalUrl');
    expect((await users.seo.put('/settings/general', { ...DEFAULTS.general, environment: 'production' })).status).toBe(422);
    expect((await users.seo.put('/settings/general', { ...DEFAULTS.general, siteName: 'AFCD Foundation (test)' })).status).toBe(200);
    for (const [m, p] of [['PUT', '/settings/email'], ['POST', '/settings/email/test'], ['POST', '/settings/email/diagnose'], ['GET', '/settings/diagnostics'], ['POST', '/settings/publish']] as const)
      expect((await users.seo.raw(m, p, m === 'GET' ? undefined : SMTP)).status, p).toBe(403);
    const [rev] = (await users.seo.get('/settings/history')).body;
    expect((await users.seo.post(`/settings/history/${rev.id}/restore`)).status).toBe(403);
    // admins may change the admin fields
    expect((await users.admin.put('/settings/general', { ...DEFAULTS.general, canonicalUrl: 'https://example.test/' })).status).toBe(200);
  });
});

describe('settings validation', () => {
  beforeEach(() => setup());
  const bad: [string, unknown, string][] = [
    ['contact', { ...CONTACT, phone: '0663 61 85 36' }, 'phone'],
    ['contact', { ...CONTACT, generalEmail: 'someone@gmail.test' }, 'generalEmail'],
    ['contact', { ...CONTACT, social: { ...CONTACT.social, facebook: 'https://evil.example.test/afcd' } }, 'social.facebook'],
    ['contact', { ...CONTACT, social: { ...CONTACT.social, linkedin: 'http://www.linkedin.com/company/afcd-foundation' } }, 'social.linkedin'],
    ['contact', { ...CONTACT, street: '1 Fake Street' }, ''],
    ['general', { ...DEFAULTS.general, siteName: 'AFCD <script>' }, 'siteName'],
    ['general', { ...DEFAULTS.general, canonicalUrl: 'http://afcdfoundation.com/' }, 'canonicalUrl'],
    ['branding', { ...DEFAULTS.branding, themeColor: '#FF0000' }, 'themeColor'],
    ['branding', { ...DEFAULTS.branding, logoMediaId: '00000000-0000-4000-8000-000000000000' }, 'logoMediaId'],
  ];
  it.each(bad)('rejects bad %s values (%#)', async (cat, body, path) => {
    const r = await users.admin.put(`/settings/${cat}`, body);
    expect(r.status).toBe(422);
    if (path) expect(r.body.details.map((d: { path: string }) => d.path)).toContain(path);
    expect((await h.db.select().from(settingsRevisions)).length).toBe(0);
  });
  it('rejects unknown categories', async () => {
    expect((await users.admin.put('/settings/backups', {})).status).toBe(404);
  });
});

describe('email & SMTP: secrets and test email', () => {
  let outcome: { ok: boolean; response?: string; error?: string };
  const sent: string[] = [];
  beforeEach(async () => {
    await setup(); outcome = { ok: true, response: '250 2.0.0 Ok: queued as FAKE123' }; sent.length = 0;
    setSender(async (s, m) => { if (!outcome.ok) throw new Error(outcome.error); sent.push(`${s.password}|${m.to}`); return { messageId: '<fake-1@example.test>', response: outcome.response }; });
  });

  it('never returns the password, and keeps it out of revisions and the audit log', async () => {
    const r = await users.admin.put('/settings/email', SMTP);
    expect(r.status).toBe(200);
    expect(r.body.email.hasPassword).toBe(true);
    const everything = JSON.stringify([r.body, (await users.admin.get('/settings')).body, (await users.admin.get('/settings/history?category=email')).body,
      await h.db.select().from(settingsRevisions), await h.db.select().from(auditLog)]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('passwordBox');
    expect(readFileSync(join(h.cfg.dataDir, 'mail-settings.json'), 'utf8')).not.toContain(SECRET);
    const [rev] = await h.db.select().from(settingsRevisions).where(eq(settingsRevisions.category, 'email'));
    expect(rev.changed).toContain('password');
    expect(rev.values).toMatchObject({ host: 'smtp.example.test', passwordSet: true });
    // keeping the password: omit it; the revision then records no password change
    await users.admin.put('/settings/email', { ...SMTP, password: undefined, fromName: 'AFCD Test' });
    const revs = await h.db.select().from(settingsRevisions).where(eq(settingsRevisions.category, 'email'));
    expect(revs).toHaveLength(2);
    expect(revs.find((x) => x.values.fromName === 'AFCD Test')!.changed).toEqual(['fromName']);
  });

  it('reports the server’s answer, rate-limits, and records failures', async () => {
    const off = await users.admin.post('/settings/email/test');
    expect(off.body).toMatchObject({ ok: false, stage: 'settings' });
    await users.admin2.put('/settings/email', SMTP);
    const ok = await users.admin2.post('/settings/email/test');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, to: 'admin2@afcd.test', host: 'smtp.example.test', response: '250 2.0.0 Ok: queued as FAKE123' });
    expect(sent).toEqual([`${SECRET}|admin2@afcd.test`]);
    expect((await users.admin2.post('/settings/email/test')).status).toBe(429);   // 30 s between tests
    outcome = { ok: false, error: `535 5.7.8 Authentication failed for ${SECRET}` };
    const bad = await users.admin3.post('/settings/email/test');
    expect(bad.status).toBe(200);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.stage).toBe('server');
    expect(bad.body.message).toContain('535 5.7.8');
    expect(bad.body.message).not.toContain(SECRET);
    const actions = (await h.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain('settings.email_test');
    expect(actions.filter((a) => a === 'settings.email_test_failed')).toHaveLength(2);
    expect(JSON.stringify(await h.db.select().from(auditLog))).not.toContain(SECRET);
    const sum = (await users.admin.get('/settings')).body.summary;
    expect(sum.lastTest.ok).toBe(false);
    expect(sum.email).toBe('ready');
  });

  it('runs real-shaped connection checks and says what failed', async () => {
    await users.admin.put('/settings/email', SMTP);
    setProbe({ dns: async () => ['192.0.2.10'], tcp: async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); } });
    const d = (await users.admin.post('/settings/email/diagnose')).body;
    const by = Object.fromEntries(d.checks.map((c: { id: string; ok: boolean | null; detail: string }) => [c.id, c]));
    expect(by.dns.ok).toBe(true);
    expect(by.tcp.ok).toBe(false);
    expect(by.tcp.detail).toContain('ECONNREFUSED');
    expect(by.password.ok).toBe(true);
  });
});

describe('settings history and restore', () => {
  beforeEach(() => setup());

  it('records each change, skips no-op saves and restores as a new revision', async () => {
    await users.admin.put('/settings/contact', { ...CONTACT, phone: '+212 600 000 001' });
    await users.admin.put('/settings/contact', { ...CONTACT, phone: '+212 600 000 002' });
    expect((await users.admin.put('/settings/contact', { ...CONTACT, phone: '+212 600 000 002' })).body.changed).toEqual([]);
    const list = (await users.admin.get('/settings/history?category=contact')).body;
    expect(list).toHaveLength(2);
    const first = list[1];
    const restored = await users.admin.post(`/settings/history/${first.id}/restore`);
    expect(restored.status).toBe(200);
    const after = (await users.admin.get('/settings/history?category=contact')).body;
    expect(after).toHaveLength(3);
    expect(after[0].restoredFrom).toBe(first.id);
    expect((await users.admin.get('/settings')).body.site.categories.contact.draft.phone).toBe('+212 600 000 001');
    expect((await h.db.select().from(auditLog)).some((a) => a.action === 'settings.restore')).toBe(true);
  });

  it('restores email values but never a password', async () => {
    await users.admin.put('/settings/email', { ...SMTP, enabled: false, password: undefined, user: '' });
    await users.admin.put('/settings/email', { ...SMTP, enabled: false, user: '', host: 'smtp2.example.test', password: undefined });
    const [newest, older] = (await users.admin.get('/settings/history?category=email')).body;
    void newest;
    expect((await users.admin.post(`/settings/history/${older.id}/restore`)).status).toBe(200);
    expect((await users.admin.get('/settings')).body.email.host).toBe('smtp.example.test');
    expect((await users.seo.get('/settings/history')).body.every((r: { category: string }) => r.category !== 'email')).toBe(true);
    expect((await users.seo.get(`/settings/history/${older.id}`)).status).toBe(404);
  });
});

describe('publishing website settings', () => {
  it('writes site-settings.json, rebuilds, verifies every page and records it', async () => {
    await setup();
    await users.admin.put('/settings/contact', { ...CONTACT, phone: '+212 600 000 003', social: { ...CONTACT.social, instagram: '' } });
    expect((await users.admin.get('/settings')).body.summary.unpublished).toBe(2);
    const r = await users.admin.post('/settings/publish');
    expect(r.status).toBe(200);
    const file = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/site-settings.json'), 'utf8'));
    expect(file.revision).toBe(r.body.revision);
    expect(file.contact).toMatchObject({ phone: '+212 600 000 003', tel: '+212600000003', generalEmail: 'contact@afcdteam.com' });
    expect(JSON.stringify(file)).not.toMatch(/street|cnss|tax|representative/i);
    const page = readFileSync(join(h.siteRoot, 'contact.html'), 'utf8');
    expect(page).toContain('tel:+212600000003');
    expect(page).toContain('+212 600 000 003');
    const s = (await users.admin.get('/settings')).body;
    expect(s.summary.unpublished).toBe(0);
    expect(s.site.categories.contact.published.phone).toBe('+212 600 000 003');
    expect((await h.db.select().from(auditLog)).some((a) => a.action === 'settings.publish')).toBe(true);
  });

  it('leaves everything unpublished when the build does not apply the settings', async () => {
    await setup(runner({ skipMarker: true }));
    await users.admin.put('/settings/contact', { ...CONTACT, phone: '+212 600 000 004' });
    const r = await users.admin.post('/settings/publish');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/do not carry the new settings/);
    const s = (await users.admin.get('/settings')).body;
    expect(s.site.categories.contact.published).toBeNull();
    expect(existsSync(join(h.siteRoot, 'src/data/site-settings.json'))).toBe(false);   // restored: never published
  });
});

describe('build hook (lib/site-settings.mjs)', () => {
  const file = (over: Record<string, unknown> = {}) => {
    const p = join(process.env.TMPDIR ?? '/tmp', `site-settings-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify({ version: 1, revision: 'rev-1', site: { name: 'AFCD Foundation', canonicalUrl: 'https://afcdfoundation.com/', environment: 'preview' },
      contact: { phone: '+212 600 000 005', tel: '+212600000005', generalEmail: 'akaya@afcdteam.com', boardEmail: 'contact@afcdteam.com', social: { ...CONTACT.social, instagram: '' } },
      brand: { themeColor: '#FFFFFF', logo: null, logoLight: null, favicon: null, socialImage: null }, ...over }));
    return p;
  };
  it('applies contact details, swaps emails, hides removed profiles and leaves JSON-LD to applyOrg', () => {
    const S = loadSiteSettings(file())!;
    const html = '<a href="tel:+212663618536">+212 663 618 536</a><a href="mailto:contact@afcdteam.com">contact@afcdteam.com</a><a href="mailto:akaya@afcdteam.com">x</a>'
      + '<a class="s" href="https://www.instagram.com/afcd.foundation" aria-label="Instagram"><svg></svg></a><script type="application/ld+json">{"email":"contact@afcdteam.com"}</script>';
    const out = applyPage(html, S);
    expect(out).toContain('href="tel:+212600000005">+212 600 000 005<');
    expect(out).toContain('href="mailto:akaya@afcdteam.com">akaya@afcdteam.com<');
    expect(out).toContain('href="mailto:contact@afcdteam.com">x<');
    expect(out).not.toContain('instagram');
    expect(out).toContain('{"email":"contact@afcdteam.com"}');
    expect(applyHead('<meta name="theme-color" content="#000000">', S)).toBe('<meta name="theme-color" content="#FFFFFF">');
    expect(applyOrg({ name: 'AFCD Foundation', email: 'contact@afcdteam.com' }, S, 'https://afcdfoundation.com/')).toMatchObject({ email: 'akaya@afcdteam.com', telephone: '+212600000005', sameAs: [CONTACT.social.facebook, CONTACT.social.linkedin] });
  });
  it('drops anything that does not pass: private emails, odd URLs, unsafe image paths', () => {
    const S = loadSiteSettings(file({ contact: { phone: '<b>', tel: 'x', generalEmail: 'person@gmail.test', boardEmail: 'akaya@afcdteam.com', social: { facebook: 'javascript:alert(1)' } },
      brand: { themeColor: '#123456', logo: { src: '../../etc/passwd', w: 1, h: 1 } }, site: { canonicalUrl: 'http://x.test/', name: '<x>' } }))!;
    expect(S.general).toBeNull(); expect(S.phone).toBeNull(); expect(S.tel).toBeNull();
    expect(S.social.facebook).toBe(CONTACT.social.facebook);
    expect(S.themeColor).toBeNull(); expect(S.logo).toBeNull(); expect(S.canonicalUrl).toBeNull(); expect(S.name).toBeNull();
    expect(loadSiteSettings('/nonexistent/site-settings.json')).toBeNull();
  });
});
