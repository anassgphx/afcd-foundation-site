// AFCD Apply, phase 3: public call pages, the applicant API (/apply/v1), drafts, private uploads and resume links.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, pngBytes, ORIGIN } from './helpers.ts';
import { applyDrafts, applyFiles, auditLog, users } from '../src/server/db/schema.ts';
import { setSender, saveMailSettings, type SendInput } from '../src/server/modules/inbox/mail.ts';
import { purgeExpiredDrafts } from '../src/server/modules/apply/applicant.ts';
import { filePath } from '../src/server/modules/apply/files.ts';
import { scriptJson } from '../src/server/modules/apply/render.ts';
import type { FormDef } from '../src/server/modules/apply/engine.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
afterEach(async () => { setSender(null); await h?.close(); h = undefined; });

const SITE = 'http://localhost:4321';
const DESC = 'Young people from Al Haouz join a twelve-week fellowship on climate action <b>with mentors</b>. Fellows meet every Saturday, plan a local project and present it to the commune.';
const callBody = (over: Record<string, unknown> = {}) => ({ title: 'Green Fellows 2099', slug: 'green-fellows-2099', summary: 'A fellowship.', description: DESC, eligibility: ['Aged 18 to 30'],
  opensLocal: '2026-01-01T09:00', closesLocal: '2099-02-15T23:59', contactEmail: 'apply@afcd.test',
  privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them 12 months after the call.', ...over });
const PDF = () => new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

/** A public API client: no cookies, the website's Origin, optional bearer token. */
function pub(app: NonNullable<typeof h>['app'], origin = SITE) {
  let token = '';
  const req = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await app.request(`/apply/v1${path}`, { method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) as any };
  };
  return { req, setToken: (t: string) => { token = t; }, get token() { return token; } };
}

async function openCall(over: Record<string, unknown> = {}, form?: (d: FormDef) => void) {
  const mgr = await client(h!.app, 'mgr@afcd.test'), rev = await client(h!.app, 'rev@afcd.test');
  const id = (await mgr.post('/apply/calls', callBody(over))).body.id as string;
  let f = (await mgr.post(`/apply/calls/${id}/form`, { template: 'fellowship' })).body.form;
  if (form) { const d = JSON.parse(JSON.stringify(f.definition)); form(d); const r = await mgr.put(`/apply/calls/${id}/form`, { definition: d, rev: f.rev }); expect(r.status).toBe(200); f = { ...f, rev: r.body.rev }; }
  expect((await mgr.post(`/apply/calls/${id}/form/publish`, { rev: f.rev })).status).toBe(200);
  await mgr.post(`/apply/calls/${id}/transition`, { action: 'submit' });
  await rev.post(`/apply/calls/${id}/transition`, { action: 'approve' });
  const s = await mgr.post(`/apply/calls/${id}/transition`, { action: 'schedule' });
  expect(s.body.status).toBe('open');                 // the opening time has passed: it opens straight away
  return { id, mgr, schedule: s.body };
}

describe('apply: public pages', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); });

  it('writes the page of an open call with its form, escaped, and keeps it in step with the call', async () => {
    const { id, mgr, schedule } = await openCall({}, (d) => { d.pages[0].fields[0].label.en = 'Name </script><script>alert(1)</script>'; });
    expect(schedule.site).toEqual({ refreshed: true, error: null });
    const file = join(h!.siteRoot, 'apply-green-fellows-2099.html');
    let html = readFileSync(file, 'utf8');
    expect(html).toContain(`data-studio-apply="${id}"`);
    expect(html).toContain('data-state="open"');
    expect(html).toContain('id="apply-data"');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).not.toContain('<b>with mentors</b>');
    expect(readFileSync(join(h!.siteRoot, 'src/pages/apply-green-fellows-2099.html'), 'utf8')).not.toMatch(/noindex/);
    expect((await mgr.get(`/apply/calls/${id}`)).body.page).toMatchObject({ expected: true, onSite: true, current: true, hasForm: true });
    // closing rebuilds the page: no form any more
    const close = await mgr.post(`/apply/calls/${id}/transition`, { action: 'close', reason: 'All places filled' });
    expect(close.body.site.refreshed).toBe(true);
    html = readFileSync(file, 'utf8');
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain('id="apply-data"');
    expect(readFileSync(join(h!.siteRoot, 'src/pages/apply-green-fellows-2099.html'), 'utf8')).toMatch(/noindex: true/);
    // an archived call leaves the site, language copies included
    mkdirSync(join(h!.siteRoot, 'fr'), { recursive: true }); writeFileSync(join(h!.siteRoot, 'fr/apply-green-fellows-2099.html'), 'old copy');
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'start_evaluation' });
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'complete' });
    expect(existsSync(file)).toBe(true);
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'archive' });
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(h!.siteRoot, 'fr/apply-green-fellows-2099.html'))).toBe(false);
    expect((await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.pages_refresh'))).length).toBeGreaterThan(2);
  });

  it('marks unlisted calls noindex, and never writes pages for calls that were not released', async () => {
    await openCall({ unlisted: true });
    expect(readFileSync(join(h!.siteRoot, 'src/pages/apply-green-fellows-2099.html'), 'utf8')).toMatch(/noindex: true/);
    const mgr = await client(h!.app, 'mgr@afcd.test');
    await mgr.post('/apply/calls', callBody({ slug: 'still-a-draft' }));
    await h!.app.request('/studio/api/apply/calls', { headers: { Cookie: mgr.cookie } });
    expect(readdirSync(h!.siteRoot).filter((f) => f.startsWith('apply-'))).toEqual(['apply-green-fellows-2099.html']);
  });

  it('escapes JSON so nothing can leave the script tag', () => {
    expect(scriptJson({ a: '</script><!-- & \u2028' })).toBe('{"a":"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u2028"}');
  });
});

describe('apply: applicant API', () => {
  let call: Awaited<ReturnType<typeof openCall>>;
  beforeEach(async () => {
    h = await makeApp(); await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer');
    call = await openCall();
  });

  it('serves only released calls, only to the website, without cookies', async () => {
    const p = pub(h!.app);
    const r = await p.req('GET', '/calls/green-fellows-2099');
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.body.call.state).toBe('open');
    expect(r.body.version.number).toBe(1);
    expect((await pub(h!.app, 'https://evil.example').req('GET', '/calls/green-fellows-2099')).status).toBe(403);
    const mgr = await client(h!.app, 'mgr@afcd.test');
    await mgr.post('/apply/calls', callBody({ slug: 'draft-call' }));
    expect((await p.req('GET', '/calls/draft-call')).status).toBe(404);
    expect((await p.req('GET', '/calls/..%2Fetc')).status).toBe(404);
    // a staff cookie opens nothing here, and the applicant API cannot reach Studio
    const res = await h!.app.request('/apply/v1/drafts/me', { headers: { Cookie: mgr.cookie, Origin: SITE } });
    expect(res.status).toBe(404);
    expect((await h!.app.request('/apply/v1/../studio/api/apply/calls', { headers: { Origin: SITE } })).status).not.toBe(200);
  });

  it('creates drafts, saves with optimistic concurrency and keeps only answers that fit the form', async () => {
    const p = pub(h!.app);
    expect((await p.req('POST', '/calls/green-fellows-2099/drafts', { website: 'spam' })).status).toBe(422);
    const d = await p.req('POST', '/calls/green-fellows-2099/drafts', { lang: 'fr' });
    expect(d.status).toBe(201);
    expect(d.body.token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const [row] = await h!.db.select().from(applyDrafts);
    expect(row.secretHash).not.toContain(d.body.token.split('.')[1]);
    p.setToken(d.body.token);
    const s1 = await p.req('PUT', '/drafts/me', { rev: 1, page: 'background', answers: { full_name: 'Test Applicant', age: '24', education: 'master', injected: 'x', city: { $ne: 1 }, consent_privacy: 'yes', education2: 1 } });
    expect(s1.status).toBe(200);
    expect(s1.body.answers).toEqual({ full_name: 'Test Applicant', age: 24, education: 'master' });
    expect((await p.req('PUT', '/drafts/me', { rev: 1, answers: {} })).status).toBe(409);   // another tab saved first
    expect((await p.req('PUT', '/drafts/me', { rev: 2, answers: { education: 'astronaut' } })).body.answers).toEqual({});
    const me = await p.req('GET', '/drafts/me');
    expect(me.body).toMatchObject({ rev: 3, lang: 'fr', page: null, version: { number: 1 } });
    p.setToken(`${d.body.token.split('.')[0]}.${'A'.repeat(43)}`);
    expect((await p.req('GET', '/drafts/me')).status).toBe(404);
    expect((await p.req('POST', '/drafts/me/submit')).status).toBe(404);
    p.setToken(d.body.token);
    const sub = await p.req('POST', '/drafts/me/submit', {});
    expect(sub.status).toBe(422);            // a submission key is required (idempotency)
    const incomplete = await p.req('POST', '/drafts/me/submit', { idempotencyKey: 'test-key-1234567890' });
    expect(incomplete.status).toBe(422);     // the server checks every answer: this draft is far from complete
    expect(incomplete.body.details.length).toBeGreaterThan(3);
  });

  it('checks uploads on the bytes, keeps them private and enforces per-question limits', async () => {
    const p = pub(h!.app);
    p.setToken((await p.req('POST', '/calls/green-fellows-2099/drafts', {})).body.token);
    const up = (name: string, bytes: Uint8Array, field = 'cv') => { const fd = new FormData(); fd.append('field', field); fd.append('file', new File([bytes as unknown as BlobPart], name)); return p.req('POST', '/drafts/me/files', fd); };
    const fake = await up('cv.pdf', new TextEncoder().encode('MZ\x90\x00 this is an exe'));
    expect(fake.status).toBe(422);
    const png = await up('cv.pdf', new Uint8Array(await pngBytes()));
    expect(png.body.error).toMatch(/accepts PDF/);
    const js = await up('cv.pdf', new TextEncoder().encode('%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n'));
    expect(js.status).toBe(422);
    expect((await up('x.pdf', PDF(), 'full_name')).status).toBe(422);    // not a file question
    const ok = await up('../../My CV <final>.PDF', PDF());
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ name: 'My CV final.pdf', mime: 'application/pdf', field: 'cv' });
    expect((await up('second.pdf', PDF())).body.error).toMatch(/at most 1 file/);
    const [f] = await h!.db.select().from(applyFiles);
    expect(existsSync(filePath(h!.cfg, f.storageKey))).toBe(true);
    expect(readdirSync(h!.siteRoot, { recursive: true }).some((x) => String(x).includes(f.storageKey))).toBe(false);   // never on the website
    // answers can only point at this draft's own files
    const s = await p.req('PUT', '/drafts/me', { rev: 1, answers: { cv: [{ id: ok.body.id, name: 'renamed.exe' }, { id: '00000000-0000-0000-0000-000000000000' }] } });
    expect(s.body.answers.cv).toEqual([{ id: ok.body.id, name: 'My CV final.pdf', bytes: PDF().byteLength, mime: 'application/pdf' }]);
    const other = pub(h!.app); other.setToken((await other.req('POST', '/calls/green-fellows-2099/drafts', {})).body.token);
    expect((await other.req('DELETE', `/drafts/me/files/${ok.body.id}`)).status).toBe(404);
    expect((await p.req('DELETE', `/drafts/me/files/${ok.body.id}`)).status).toBe(200);
    expect(existsSync(filePath(h!.cfg, f.storageKey))).toBe(false);
  });

  it('emails a single-use resume link that holds no answers', async () => {
    const sent: SendInput[] = [];
    setSender(async (_s, m) => { sent.push(m); return { messageId: `<fake-${sent.length}@example.org>` }; });
    const p = pub(h!.app);
    p.setToken((await p.req('POST', '/calls/green-fellows-2099/drafts', {})).body.token);
    await p.req('PUT', '/drafts/me', { rev: 1, answers: { full_name: 'Very Distinctive Answer 7731' } });
    expect((await p.req('POST', '/drafts/me/resume-link', { email: 'applicant@example.org' })).status).toBe(409);   // email not set up: says so
    const [mgrUser] = await h!.db.select().from(users).where(eq(users.email, 'mgr@afcd.test'));
    await saveMailSettings(h!.db, h!.cfg, { id: mgrUser.id, email: 'mgr@afcd.test' },
      { enabled: true, host: 'smtp.example.org', port: 587, security: 'starttls', user: '', fromName: 'AFCD', fromEmail: 'no-reply@example.org', replyTo: '' });
    expect((await p.req('POST', '/drafts/me/resume-link', { email: 'not-an-email' })).status).toBe(422);
    expect((await p.req('POST', '/drafts/me/resume-link', { email: 'applicant@example.org' })).status).toBe(200);
    expect(sent).toHaveLength(1);
    const mail = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html ?? ''}`;
    expect(mail).not.toContain('Very Distinctive Answer');
    const link = /apply-green-fellows-2099\.html#resume=([A-Za-z0-9_-]{43})/.exec(mail);
    expect(link).not.toBeNull();
    const old = p.token;
    const r = await pub(h!.app).req('POST', '/resume', { token: link![1] });
    expect(r.status).toBe(200);
    expect(r.body.draft.answers.full_name).toBe('Very Distinctive Answer 7731');
    expect((await pub(h!.app).req('POST', '/resume', { token: link![1] })).status).toBe(404);   // single use
    p.setToken(old);
    expect((await p.req('GET', '/drafts/me')).status).toBe(404);                                // the old secret stopped working
    p.setToken(r.body.token);
    expect((await p.req('GET', '/drafts/me')).status).toBe(200);
    await p.req('POST', '/drafts/me/resume-link', { email: 'applicant@example.org' });
    await p.req('POST', '/drafts/me/resume-link', { email: 'applicant@example.org' });
    expect((await p.req('POST', '/drafts/me/resume-link', { email: 'applicant@example.org' })).status).toBe(429);
    const audits = (await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.resume_link'))).map((a) => `${a.summary} ${JSON.stringify(a.meta)}`).join(' ');
    expect(audits).not.toContain('applicant@example.org');
  });

  it('refuses changes once the call closes, on server time', async () => {
    const p = pub(h!.app);
    p.setToken((await p.req('POST', '/calls/green-fellows-2099/drafts', {})).body.token);
    await call.mgr.post(`/apply/calls/${call.id}/transition`, { action: 'pause', reason: 'Fixing the terms' });
    expect((await p.req('PUT', '/drafts/me', { rev: 1, answers: {} })).body.error).toMatch(/paused/);
    expect((await pub(h!.app).req('POST', '/calls/green-fellows-2099/drafts', {})).status).toBe(409);
    await call.mgr.post(`/apply/calls/${call.id}/transition`, { action: 'close', reason: 'Done' });
    expect((await p.req('PUT', '/drafts/me', { rev: 1, answers: {} })).body.error).toMatch(/closed/);
    expect((await p.req('GET', '/drafts/me')).body.call.state).toBe('closed');
  });

  it('deletes expired drafts with their files', async () => {
    const p = pub(h!.app);
    p.setToken((await p.req('POST', '/calls/green-fellows-2099/drafts', {})).body.token);
    const fd = new FormData(); fd.append('field', 'cv'); fd.append('file', new File([PDF() as unknown as BlobPart], 'cv.pdf'));
    await p.req('POST', '/drafts/me/files', fd);
    const [f] = await h!.db.select().from(applyFiles);
    expect(await purgeExpiredDrafts(h!.db, h!.cfg)).toBe(0);
    expect(await purgeExpiredDrafts(h!.db, h!.cfg, new Date(Date.now() + 31 * 864e5))).toBe(1);
    expect(existsSync(filePath(h!.cfg, f.storageKey))).toBe(false);
    expect(await h!.db.select().from(applyFiles)).toEqual([]);
  });
});

describe('apply: opportunities link to calls', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'ed@afcd.test', 'content_editor'); });
  it('accepts the AFCD Apply method with a call, and links its page', async () => {
    const { id } = await openCall();
    const ed = await client(h!.app, 'ed@afcd.test');
    const opp = { title: 'Green Fellows', slug: 'green-fellows', type: 'call_for_applications', summary: 'A fellowship.', body: DESC, eligibility: ['Aged 18 to 30'], benefits: [], location: '', commitment: '',
      opensOn: null, deadline: null, applyUrl: '', applyEmail: '', pillarKey: null, projectSlug: null, heroMediaId: null, seoTitle: '', seoDescription: '' };
    expect((await ed.post('/opportunities', { ...opp, applyMethod: 'studio' })).status).toBe(422);
    const o = await ed.post('/opportunities', { ...opp, applyMethod: 'studio', applyCallId: id });
    expect(o.status).toBe(201);
    const { detailSource, oppCtx } = await import('../src/server/modules/opportunities/render.ts');
    const { toOpportunitySnapshot, loadOpportunity } = await import('../src/server/modules/opportunities/service.ts');
    const snap = toOpportunitySnapshot(await loadOpportunity(h!.db, o.body.id));
    const html = detailSource({ id: 'rev', snap }, await oppCtx(h!.db, [snap]));
    expect(html).toContain('href="apply-green-fellows-2099.html"');
  });
});
