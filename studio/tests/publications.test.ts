// Publications: PDF checks, validation, the review workflow, publishing (pages, PDF copy, sitemap) and removal.
// Every document here is a clearly fake test file built in memory.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import { auditLog, projectRevisions, projects, publications } from '../src/server/db/schema.ts';
import { documentsDir, pdfProblem } from '../src/server/modules/publications/documents.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

/** A tiny, valid-looking PDF; `extra` goes into the document structure (outside any stream). */
const fakePdf = (extra = '', streamBody = 'BT (FAKE TEST DOCUMENT) Tj ET') => new Uint8Array(Buffer.from(
  `%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R${extra}>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n` +
  `3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>> endobj\n4 0 obj <</Length ${streamBody.length}>>\nstream\n${streamBody}\nendstream\nendobj\n` +
  `trailer <</Root 1 0 R>>\n%%EOF\n`, 'latin1'));

async function upload(app: typeof h.app, c: Awaited<ReturnType<typeof client>>, bytes: Uint8Array, name = 'fake-test-report.pdf') {
  const fd = new FormData(); fd.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' }));
  const res = await app.request('/studio/api/documents', { method: 'POST', body: fd, headers: { Cookie: c.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.csrf } });
  return { status: res.status, body: await res.json() as any };
}

const pub = (over: Record<string, unknown> = {}) => ({
  title: 'FAKE TEST Report on <nothing> & more'.replace('<nothing>', 'nothing'), slug: 'fake-test-report', type: 'report', summary: 'A fake document used only by the automated tests.',
  abstract: 'This is a **fake** abstract.\n\nIt exists only in the test suite.', publishedOn: '2026-06-30', authors: ['Test Author One'], organisation: '', language: 'en',
  pillarKeys: ['green-thumbs'], projectSlugs: [], coverMediaId: null, documentId: null, externalUrl: '', seoTitle: '', seoDescription: '', ...over,
});

describe('PDF checks', () => {
  it('accepts a plain PDF and refuses anything else', () => {
    expect(pdfProblem(fakePdf())).toBeNull();
    expect(pdfProblem(new Uint8Array())).toMatch(/empty/);
    expect(pdfProblem(new Uint8Array(Buffer.from('<html><script>alert(1)</script></html>')))).toMatch(/not a PDF/);
    expect(pdfProblem(fakePdf().subarray(0, 120))).toMatch(/incomplete/);
    expect(pdfProblem(fakePdf(), 100)).toMatch(/larger than/);
    expect(pdfProblem(fakePdf('/OpenAction <</S/JavaScript/JS(app.alert(1))>>'))).toMatch(/active content/);
    expect(pdfProblem(fakePdf('/Names <</EmbeddedFiles 9 0 R>>'))).toMatch(/active content/);
    // binary stream data may contain any bytes, so names inside a stream are not mistaken for active content
    expect(pdfProblem(fakePdf('', 'BT (/JavaScript /JS) Tj ET'))).toBeNull();
  });
});

describe('publications', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer');
    await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'ro@afcd.test', 'read_only');
  });

  it('validates input and readiness', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.post('/publications', pub({ slug: 'Bad Slug' }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ title: '<script>x</script>' }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ externalUrl: 'javascript:alert(1)' }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ externalUrl: 'http://insecure.example.org/doc' }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ publishedOn: '2026-02-31x' }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ type: 'novel' }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ pillarKeys: ['no-such-pillar'] }))).status).toBe(422);
    expect((await ed.post('/publications', pub({ documentId: '00000000-0000-4000-8000-000000000000' }))).status).toBe(422);
    const { body } = await ed.post('/publications', pub({ summary: '', publishedOn: null, authors: [], organisation: '' }));
    const r = await ed.post(`/publications/${body.id}/transition`, { action: 'submit' });
    expect(r.status).toBe(422);
    expect(r.body.details.map((d: { message: string }) => d.message)).toEqual([
      'Add a short summary for the list and search results.', 'Add the publication date shown on the document.',
      'Add the authors or the organisation that produced it.', 'Upload the PDF or add a link to where the document can be read.']);
    expect((await ed.post('/publications', pub({ slug: body.slug }))).status).toBe(409);   // address already used
    const ro = await client(h.app, 'ro@afcd.test');
    expect((await ro.post('/publications', pub({ slug: 'other' }))).status).toBe(403);
    expect((await ro.get('/publications')).status).toBe(200);
  });

  it('checks uploads on the bytes and serves the file to signed-in users only', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test');
    expect((await upload(h.app, ed, new Uint8Array(Buffer.from('not a pdf')), 'renamed.pdf')).status).toBe(422);
    expect((await upload(h.app, ed, fakePdf('/AA <</O <</S/Launch/F(cmd.exe)>>>>'))).status).toBe(422);
    expect((await upload(h.app, rev, fakePdf())).status).toBe(403);   // reviewers do not upload
    const up = await upload(h.app, ed, fakePdf(), '../../etc/fake "test".pdf');
    expect(up.status).toBe(201);
    expect(up.body.originalName).not.toMatch(/[/"]/);
    const stored = readdirSync(documentsDir(h.cfg));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{24}\.pdf$/);
    const dl = await h.app.request(`/studio/api/documents/${up.body.id}/file`, { headers: { Cookie: rev.cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(fakePdf());
    expect((await h.app.request(`/studio/api/documents/${up.body.id}/file`)).status).toBe(401);
    const [a] = await h.db.select().from(auditLog).where(eq(auditLog.action, 'document.upload'));
    expect(a.entityId).toBe(up.body.id);
  });

  it('reviews, publishes the pages and the PDF, lists it in the sitemap, then removes everything', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const up = await upload(h.app, ed, fakePdf());
    const { status, body: p } = await ed.post('/publications', pub({ documentId: up.body.id }));
    expect(status).toBe(201);
    expect((await ed.post(`/publications/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await rev.get('/review-queue')).body.some((x: { type: string; id: string; canApprove: boolean }) => x.type === 'publication' && x.id === p.id && x.canApprove)).toBe(true);
    expect((await ed.put(`/publications/${p.id}`, pub({ documentId: up.body.id }))).status).toBe(409);   // read-only while in review
    expect((await ed.post(`/publications/${p.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await rev.post(`/publications/${p.id}/transition`, { action: 'request_changes' })).status).toBe(422);   // needs a comment
    expect((await rev.post(`/publications/${p.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`/publications/${p.id}/publish`)).status).toBe(403);
    expect((await rev.post(`/publications/${p.id}/publish`)).status).toBe(403);
    const res = await admin.post(`/publications/${p.id}/publish`);
    expect(res.status).toBe(200);

    const page = readFileSync(join(h.siteRoot, 'publication-fake-test-report.html'), 'utf8');
    expect(page).toContain(`data-studio-publication-rev="${res.body.revisionId}"`);
    expect(page).toContain('FAKE TEST Report on nothing &amp; more');
    expect(page).toContain('<strong>fake</strong>');
    expect(page).toContain(`href="assets/documents/${readdirSync(documentsDir(h.cfg))[0]}" download="fake-test-report.pdf"`);
    expect(page).toContain('Test Author One');
    expect(page).toContain('href="environment-climate.html"');
    const copied = readdirSync(join(h.siteRoot, 'assets/documents'));
    expect(copied).toEqual(readdirSync(documentsDir(h.cfg)));
    expect(new Uint8Array(readFileSync(join(h.siteRoot, 'assets/documents', copied[0])))).toEqual(fakePdf());
    const listing = readFileSync(join(h.siteRoot, 'publications.html'), 'utf8');
    expect(listing).toContain(`data-studio-publication="${res.body.revisionId}"`);
    expect(listing).not.toContain('name="pf-t" id="pf-t-report"');   // one type only: no type filter
    const src = readFileSync(join(h.siteRoot, 'src/pages/publication-fake-test-report.html'), 'utf8');
    expect(src).toMatch(/^---\ntitle: FAKE TEST Report on nothing & more · Publications · AFCD Foundation\n/);
    expect(src).not.toContain('noindex');
    const sitemap = readFileSync(join(h.siteRoot, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('publication-fake-test-report.html');
    expect(sitemap).toContain('publications.html');
    const [row] = await h.db.select().from(publications).where(eq(publications.id, p.id));
    expect(row.status).toBe('published');
    expect((await h.db.select().from(auditLog).where(eq(auditLog.action, 'publication.publish'))).length).toBe(1);

    // stand-ins for the French and Arabic copies build.mjs writes next to the English page
    for (const l of ['fr', 'ar']) { mkdirSync(join(h.siteRoot, l), { recursive: true }); writeFileSync(join(h.siteRoot, l, 'publication-fake-test-report.html'), 'fake copy'); writeFileSync(join(h.siteRoot, l, 'publications.html'), 'fake copy'); }
    expect((await admin.post(`/publications/${p.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'publication-fake-test-report.html'))).toBe(false);
    for (const l of ['fr', 'ar']) expect(readdirSync(join(h.siteRoot, l))).toEqual([]);   // language copies go too
    expect(existsSync(join(h.siteRoot, 'publications.html'))).toBe(false);   // nothing live: no empty listing
    expect(existsSync(join(h.siteRoot, 'src/pages/publications.html'))).toBe(false);
    expect(readdirSync(join(h.siteRoot, 'assets/documents'))).toEqual([]);   // its PDF leaves the site too
    expect(readdirSync(documentsDir(h.cfg))).toHaveLength(1);   // Studio keeps its copy
    const [after] = await h.db.select().from(publications).where(eq(publications.id, p.id));
    expect(after.status).toBe('draft');
  });

  it('lists a published paper under its project ("outputs" in the project data) and drops it when unpublished', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const up = await upload(h.app, ed, fakePdf());
    const { body: p } = await ed.post('/publications', pub({ documentId: up.body.id, type: 'policy_brief', projectSlugs: ['eco-citizen'] }));
    await ed.post(`/publications/${p.id}/transition`, { action: 'submit' });
    await rev.post(`/publications/${p.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/publications/${p.id}/publish`)).status).toBe(200);
    const data = () => JSON.parse(readFileSync(join(h.siteRoot, 'src/data/projects.json'), 'utf8')).projects.find((x: { slug: string }) => x.slug === 'eco-citizen');
    expect(data().detail.outputs).toEqual([{ title: 'FAKE TEST Report on nothing &amp; more', type: 'Policy brief', file: 'publication-fake-test-report.html', year: '2026', slug: 'fake-test-report', pdf: expect.stringMatching(/^assets\/documents\/[0-9a-f]{24}\.pdf$/) }]);   // pdf: the direct download
    expect((await admin.post(`/publications/${p.id}/unpublish`)).status).toBe(200);
    expect(data().detail.outputs).toBeUndefined();
  });

  it('shows publications linked to an activity under it (live ones only) and in the project’s Publications', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    // the live Eco Citizen page has an activity that links this paper and one that isn't published
    const [proj] = await h.db.select().from(projects).where(eq(projects.slug, 'eco-citizen'));
    const [r] = await h.db.select().from(projectRevisions).where(eq(projectRevisions.id, proj.publishedRevisionId!));
    const snap = structuredClone(r.snapshot) as any; snap.detail.activities = [{ title: 'Regional forum', publications: ['fake-test-report', 'not-published-yet'] }, { title: 'Workshop' }];
    await h.db.update(projectRevisions).set({ snapshot: snap }).where(eq(projectRevisions.id, r.id));
    const up = await upload(h.app, ed, fakePdf());
    const { body: p } = await ed.post('/publications', pub({ documentId: up.body.id }));   // not listing the project itself
    await ed.post(`/publications/${p.id}/transition`, { action: 'submit' });
    await rev.post(`/publications/${p.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/publications/${p.id}/publish`)).status).toBe(200);
    const d = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/projects.json'), 'utf8')).projects.find((x: { slug: string }) => x.slug === 'eco-citizen').detail;
    const ref = { title: 'FAKE TEST Report on nothing &amp; more', type: 'Report', file: 'publication-fake-test-report.html', year: '2026', slug: 'fake-test-report', pdf: expect.stringMatching(/^assets\/documents\/[0-9a-f]{24}\.pdf$/) };
    expect(d.activities[0].publications).toEqual([ref]);
    expect(d.activities[1].publications).toBeUndefined();
    expect(d.outputs).toEqual([ref]);
  });

  it('does not let the author approve their own submission (except a super admin)', async () => {
    const admin = await client(h.app, 'admin@afcd.test');
    const { body: p } = await admin.post('/publications', pub({ externalUrl: 'https://example.org/fake-test-report' }));
    expect((await admin.post(`/publications/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    const r = await admin.post(`/publications/${p.id}/transition`, { action: 'approve' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Someone other than the author/);
  });

  it('fails safely when the PDF is missing at publish time', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const up = await upload(h.app, ed, fakePdf());
    const { body: p } = await ed.post('/publications', pub({ documentId: up.body.id }));
    await ed.post(`/publications/${p.id}/transition`, { action: 'submit' }); await rev.post(`/publications/${p.id}/transition`, { action: 'approve' });
    for (const f of readdirSync(documentsDir(h.cfg))) rmSync(join(documentsDir(h.cfg), f));
    const r = await admin.post(`/publications/${p.id}/publish`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Missing PDF/);
    expect(existsSync(join(h.siteRoot, 'publication-fake-test-report.html'))).toBe(false);
    const [row] = await h.db.select().from(publications).where(eq(publications.id, p.id));
    expect(row.status).toBe('approved');
  });

  it('lists several publications newest first with type and pillar filters', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const live = async (over: Record<string, unknown>) => {
      const { body: p } = await ed.post('/publications', pub({ externalUrl: 'https://example.org/fake', ...over }));
      await ed.post(`/publications/${p.id}/transition`, { action: 'submit' }); await rev.post(`/publications/${p.id}/transition`, { action: 'approve' });
      expect((await admin.post(`/publications/${p.id}/publish`)).status).toBe(200);
    };
    await live({ slug: 'fake-test-study', title: 'FAKE TEST Study', type: 'study', publishedOn: '2025-01-10', pillarKeys: ['youth-empowerment'] });
    await live({ slug: 'fake-test-guide', title: 'FAKE TEST Guide', type: 'guide', publishedOn: '2026-03-01', pillarKeys: ['green-thumbs'] });
    const listing = readFileSync(join(h.siteRoot, 'publications.html'), 'utf8');
    expect(listing.indexOf('FAKE TEST Guide')).toBeLessThan(listing.indexOf('FAKE TEST Study'));
    expect(listing).toContain('id="pf-t-study"'); expect(listing).toContain('id="pf-t-guide"');
    expect(listing).toContain('id="pf-p-green-thumbs"'); expect(listing).toContain('id="pf-p-youth-empowerment"');
    expect(listing).toContain('.pub-browse:has(#pf-t-study:checked) .pub-item:not([data-type="study"]){display:none}');
    // a study about green thumbs does not exist, so that combination shows the "no match" message
    expect(listing).toContain('.pub-browse:has(#pf-t-study:checked):has(#pf-p-green-thumbs:checked) .pub-none{display:block}');
    expect(listing).not.toContain('#pf-t-guide:checked):has(#pf-p-green-thumbs:checked)');
    const page = readFileSync(join(h.siteRoot, 'publication-fake-test-guide.html'), 'utf8');
    expect(page).toContain('href="https://example.org/fake" target="_blank" rel="noopener"');
    expect(page).not.toContain('download=');
  });

  it('previews a draft with its PDF served by Studio, without touching the site', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const up = await upload(h.app, ed, fakePdf());
    const { body: p } = await ed.post('/publications', pub({ documentId: up.body.id }));
    const r = await ed.post(`/publications/${p.id}/preview`);
    expect(r.status).toBe(200);
    const html = await (await h.app.request(r.body.url, { headers: { Cookie: ed.cookie } })).text();
    expect(html).toContain('data-studio-publication-rev="preview"');
    const key = readdirSync(documentsDir(h.cfg))[0];
    const pdf = await h.app.request(r.body.url.replace(/[^/]+$/, `assets/documents/${key}`), { headers: { Cookie: ed.cookie } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(existsSync(join(h.siteRoot, 'publication-fake-test-report.html'))).toBe(false);
    expect(existsSync(join(h.siteRoot, 'assets/documents'))).toBe(false);
  });
});
