import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { makeApp, addUser, client, fakeRunner, pngBytes, ORIGIN } from './helpers.ts';
import { auditLog, pillars, pillarRevisions, publishJobs, redirects } from '../src/server/db/schema.ts';
import { importPillars, readSitePillars, contentFromSite, type PillarSnapshot } from '../src/server/modules/pillars/service.ts';
import { pillarEntries } from '../src/server/modules/pillars/render.ts';
import { loadConfig } from '../src/server/config.ts';

// The real website checkout this Studio belongs to: its content.py is the source of the imported pillar content.
const REPO = resolve(import.meta.dirname, '../..');
const SITE_PILLARS = readSitePillars({ siteRoot: REPO } as ReturnType<typeof loadConfig>);

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

async function setup(runner = fakeRunner()) {
  h = await makeApp({ runner });
  await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  return { ed: await client(h.app, 'ed@afcd.test'), rev: await client(h.app, 'rev@afcd.test'), admin: await client(h.app, 'admin@afcd.test') };
}
const editable = (p: any) => { const { key: _k, number: _n, publicFile: _f, ...c } = p.content; return c; };

describe('pillars', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); });

  it('imports the real content of the current pages once, as published revision 1, without inventing anything', async () => {
    expect((await c.ed.post('/pillars/import')).status).toBe(403);
    expect((await c.admin.post('/pillars/import')).status).toBe(409);   // the test site has no generator to read from
    expect(SITE_PILLARS.map((s) => s.name)).toEqual(['Youth Empowerment', 'Women’s Empowerment', 'Environment and Climate', 'Digital Inclusion and Innovation']);
    // the test site has two of the four pillar rows (helpers STRATEGY): only those are filled, once
    expect(await importPillars(h.db, h.cfg, null, SITE_PILLARS)).toEqual({ imported: 2, skipped: 2 });
    expect(await importPillars(h.db, h.cfg, null, SITE_PILLARS)).toEqual({ imported: 0, skipped: 4 });
    const revs = await h.db.select().from(pillarRevisions);
    expect(revs.map((r) => [r.number, r.reason])).toEqual([[1, 'imported'], [1, 'imported']]);
    const env = revs.map((r) => r.snapshot as unknown as PillarSnapshot).find((x) => x.key === 'green-thumbs')!;
    expect(env).toMatchObject({ name: 'Environment and Climate', short: 'Environment', brand: 'Green Thumbs', colour: '#82E591', mediaId: null, publicFile: 'environment-climate.html' });
    expect(env.steps).toHaveLength(4); expect(env.principles).toEqual(['Community-led', 'Sustainable practices', 'Climate resilience']);
  });

  it('runs draft → review → approved → published, with roles, audit entries and escaping', async () => {
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const list = (await c.ed.get('/pillars/records')).body;
    const youth = list.find((p: any) => p.key === 'youth-empowerment');
    expect(youth).toMatchObject({ imported: true, status: 'published', draftName: 'Youth Empowerment', short: 'Youth' });
    expect(youth.summary).toBe(SITE_PILLARS[0].summary);

    const { body: p } = await c.ed.get(`/pillars/${youth.id}`);
    expect(p.content.highlights).toEqual(['Leadership Lab 2.0', 'Youth First Academy', 'Let’s Dialogue']);
    expect(p.content.approachTitle).toBe('From learning'); expect(p.content.approachSoft).toBe('to leading.');

    // validation: one of the four colours, plain text, fixed key/number/file
    expect((await c.ed.put(`/pillars/${p.id}`, { ...editable(p), colour: '#123456' })).status).toBe(422);
    expect((await c.ed.put(`/pillars/${p.id}`, { ...editable(p), name: 'Youth <b>' })).status).toBe(422);
    expect((await c.ed.put(`/pillars/${p.id}`, { ...editable(p), key: 'youth' })).status).toBe(422);
    expect((await c.rev.put(`/pillars/${p.id}`, { ...editable(p), name: 'Youth' })).status).toBe(403);

    const draft = { ...editable(p), name: 'Youth & Leadership', summary: 'Young people “lead” change.', colour: '#82E591' };
    expect((await c.ed.put(`/pillars/${p.id}`, draft)).status).toBe(200);
    // the draft does not leak: the live name other modules read is unchanged until publishing
    expect((await h.db.select().from(pillars).where(eq(pillars.id, p.id)))[0].name).toBe('Youth Empowerment');

    expect((await c.ed.post(`/pillars/${p.id}/publish`)).status).toBe(403);
    expect((await c.ed.post(`/pillars/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await c.ed.put(`/pillars/${p.id}`, draft)).status).toBe(409);                     // locked while in review
    expect((await c.ed.post(`/pillars/${p.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await c.rev.post(`/pillars/${p.id}/transition`, { action: 'request_changes' })).status).toBe(422);   // needs a comment
    expect((await c.rev.post(`/pillars/${p.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await c.rev.post(`/pillars/${p.id}/publish`)).status).toBe(403);

    const queue = (await c.admin.get('/review-queue')).body;
    expect(queue.find((q: any) => q.type === 'pillar')).toMatchObject({ status: 'approved', canPublish: true, href: `/studio/pillars/${p.id}` });

    const pub = await c.admin.post(`/pillars/${p.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.file).toBe('youth-empowerment.html');
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8'));
    expect(data.pillars.map((x: any) => x.key)).toEqual(['youth-empowerment', 'green-thumbs']);
    expect(data.pillars[0]).toMatchObject({ name: 'Youth &amp; Leadership', summary: 'Young people “lead” change.', colour: '#82E591', file: 'youth-empowerment.html', revision: pub.body.revisionId });
    expect(data.pillars[0].approach.title).toBe('From learning <span class="text-white/45">to leading.</span>');
    expect(JSON.stringify(data)).not.toContain('Imported from');                              // provenance stays internal
    expect(readFileSync(join(h.siteRoot, 'youth-empowerment.html'), 'utf8')).toContain('<h1>Youth &amp; Leadership</h1>');

    const [row] = await h.db.select().from(pillars).where(eq(pillars.id, p.id));
    expect(row).toMatchObject({ status: 'published', publishedRevisionId: pub.body.revisionId, name: 'Youth & Leadership', colour: '#82E591', description: 'Young people “lead” change.' });
    const actions = (await h.db.select().from(auditLog).where(and(eq(auditLog.entityType, 'pillar'), eq(auditLog.entityId, p.id)))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['pillar.import', 'pillar.update', 'pillar.submit', 'pillar.approve', 'pillar.publish']));

    // restore revision 1 into the draft
    const revs = await h.db.select().from(pillarRevisions).where(eq(pillarRevisions.pillarId, p.id));
    const first = revs.find((x) => x.number === 1)!;
    expect((await c.ed.post(`/pillars/${p.id}/revisions/${first.id}/restore`)).status).toBe(200);
    expect((await c.ed.get(`/pillars/${p.id}`)).body.content.name).toBe('Youth Empowerment');
  });

  it('keeps each pillar’s own objectives: none imported, title required, at most 6, exported as plain text', async () => {
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const id = (await c.ed.get('/pillars/records')).body[0].id;
    const { body: p } = await c.ed.get(`/pillars/${id}`);
    expect(p.content.objectives).toEqual([]);                                                  // nothing invented on import
    const seven = Array.from({ length: 7 }, (_, i) => ({ title: `Objective ${i + 1}`, text: '' }));
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), objectives: seven })).status).toBe(422);
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), objectives: [{ title: 'A <b>', text: '' }] })).status).toBe(422);
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), objectives: [{ title: '', text: 'No title yet' }] })).status).toBe(200);   // drafts may be incomplete
    const blocked = await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' });
    expect(blocked.status).toBe(422); expect(JSON.stringify(blocked.body.details)).toMatch(/objective a title/);
    const objectives = [{ title: 'Youth & civic life', text: 'Lead “local” initiatives.' }, { title: 'Second objective', text: '' }];
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), objectives })).status).toBe(200);
    expect((await c.ed.get(`/pillars/${id}`)).body.content.objectives).toEqual(objectives);
    await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' }); await c.rev.post(`/pillars/${id}/transition`, { action: 'approve' });
    expect((await c.admin.post(`/pillars/${id}/publish`)).status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8')).pillars.find((x: any) => x.key === 'youth-empowerment');
    expect(entry.objectives).toEqual(objectives);                                               // content.py escapes these itself
    const other = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8')).pillars.find((x: any) => x.key === 'green-thumbs');
    expect(other.objectives).toEqual([]);                                                       // a pillar imported before objectives existed
  });

  it('lets editors change every page text and add their own activities and groups; empty keeps the site wording', async () => {
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const id = (await c.ed.get('/pillars/records')).body[0].id;
    const { body: p } = await c.ed.get(`/pillars/${id}`);
    expect(p.content.page.howTitle).toBe('');                                                   // imported pillars start with the site's wording
    expect(p.content.extraActivities).toEqual([]);
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), page: { ...p.content.page, howTitle: 'How <b>' } })).status).toBe(422);
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), page: { ...p.content.page, unknownText: 'x' } })).status).toBe(422);
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), extraActivities: Array(7).fill('Something') })).status).toBe(422);
    const page = { ...p.content.page, howTitle: 'Learning & leading', howSoft: 'together.', ctaTitle: 'Join “the” lab.' };
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), page, extraActivities: ['Hackathons & meetups'], extraGroups: ['University students'] })).status).toBe(200);
    expect((await c.ed.get(`/pillars/${id}`)).body.content.page.ctaTitle).toBe('Join “the” lab.');
    await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' }); await c.rev.post(`/pillars/${id}/transition`, { action: 'approve' });
    expect((await c.admin.post(`/pillars/${id}/publish`)).status).toBe(200);
    const all = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8')).pillars;
    const entry = all.find((x: any) => x.key === 'youth-empowerment');
    expect(entry.page).toEqual({ howTitle: 'Learning &amp; leading', howSoft: 'together.', ctaTitle: 'Join “the” lab.' });   // escaped; empty texts left out
    expect(entry.extraActivities).toEqual(['Hackathons &amp; meetups']);
    expect(entry.extraGroups).toEqual(['University students']);
    expect(all.find((x: any) => x.key === 'green-thumbs').page).toEqual({});                   // untouched pillars keep the site wording
    expect(entry.workItems).toEqual([]); expect(entry.audience).toEqual([]);                   // not edited: the picks above are used
  });

  it('saves How we work’s own cards (icon and text) and groups, in order, and checks them', async () => {
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const id = (await c.ed.get('/pillars/records')).body[0].id;
    const { body: p } = await c.ed.get(`/pillars/${id}`);
    expect(p.content.workItems).toEqual([]); expect(p.content.audience).toEqual([]);
    for (const bad of [{ workItems: [{ icon: 1, text: ' ' }] }, { workItems: [{ icon: -1, text: 'x' }] }, { workItems: [{ icon: 1, text: 'x', extra: 1 }] },
      { workItems: Array(11).fill({ icon: 1, text: 'x' }) }, { audience: [''] }, { audience: ['<b>x</b>'] }, { audience: Array(11).fill('x') }])
      expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), ...bad })).status).toBe(422);
    const workItems = [{ icon: 3, text: 'Clean-ups & tree planting' }, { icon: 0, text: 'Training' }];
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), workItems, audience: ['Students', 'Schools & clubs'], activities: [], extraActivities: [], groups: [], extraGroups: [] })).status).toBe(200);
    const { body: q } = await c.ed.get(`/pillars/${id}`);
    expect(q.content.workItems).toEqual(workItems); expect(q.content.audience).toEqual(['Students', 'Schools & clubs']);
    await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' }); await c.rev.post(`/pillars/${id}/transition`, { action: 'approve' });
    expect((await c.admin.post(`/pillars/${id}/publish`)).status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8')).pillars.find((x: any) => x.key === 'youth-empowerment');
    expect(entry.workItems).toEqual([{ icon: 3, text: 'Clean-ups &amp; tree planting' }, { icon: 0, text: 'Training' }]);
    expect(entry.audience).toEqual(['Students', 'Schools &amp; clubs']);
    expect(entry.activities).toEqual([]); expect(entry.groups).toEqual([]);
  });

  it('blocks a photo without alt text or confirmed rights', async () => {
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const id = (await c.ed.get('/pillars/records')).body[0].id;
    const fd = new FormData(); fd.append('file', new File([await pngBytes()], 'youth.png', { type: 'image/png' }));
    const img = await (await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: c.ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.ed.csrf } })).json();
    const { body: p } = await c.ed.get(`/pillars/${id}`);
    expect((await c.ed.put(`/pillars/${id}`, { ...editable(p), mediaId: img.id })).status).toBe(200);
    const blocked = await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body.details)).toMatch(/alt text/);
    expect(JSON.stringify(blocked.body.details)).toMatch(/Confirm AFCD may use/);
    await h.app.request(`/studio/api/media/${img.id}`, { method: 'PATCH', headers: { Cookie: c.ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.ed.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: 'Young people at a workshop', rightsConfirmed: true }) });
    expect((await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await c.rev.post(`/pillars/${id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await c.admin.post(`/pillars/${id}/publish`)).status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8')).pillars.find((x: any) => x.image);
    expect(entry.image).toMatchObject({ alt: 'Young people at a workshop', src: expect.stringMatching(/^assets\/media\/[0-9a-f]{24}-\d+\.webp$/) });
    expect(existsSync(join(h.siteRoot, entry.image.src))).toBe(true);                         // the photo is copied to the site
  });
});

describe('adding, ordering and removing pillars', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); await importPillars(h.db, h.cfg, null, SITE_PILLARS); });
  const fill = { short: 'Health', summary: 'Better health for young people.', intro: 'Health and well-being in communities.', approachTitle: 'Healthy', approachSoft: 'together.',
    view: 'We work with local health actors.', principles: ['Community-led'], steps: [{ title: 'Learn', text: 'Health education sessions.' }] };

  it('adds a pillar as a draft, offers it to other content only once live, and publishes its own page', async () => {
    expect((await c.rev.post('/pillars', { name: 'Health', key: 'health' })).status).toBe(403);
    expect((await c.ed.post('/pillars', { name: 'Projects', key: 'projects' })).status).toBe(409);            // reserved page name
    expect((await c.ed.post('/pillars', { name: 'Youth', key: 'youth-empowerment' })).status).toBe(409);      // taken
    expect((await c.ed.post('/pillars', { name: 'Bad', key: 'Bad Key' })).status).toBe(422);
    const { status, body } = await c.ed.post('/pillars', { name: 'Health and Well-being', key: 'health' });
    expect(status).toBe(201);
    expect((await c.ed.get('/pillars')).body.map((p: any) => p.key)).not.toContain('health');                  // not linkable yet
    const { body: p } = await c.ed.get(`/pillars/${body.id}`);
    expect(p).toMatchObject({ key: 'health', publicFile: 'health.html', number: '03', status: 'draft' });
    expect(['#A8DDFB', '#FBE38A']).toContain(p.content.colour);                                                // a colour not in use yet
    const notReady = await c.ed.post(`/pillars/${p.id}/transition`, { action: 'submit' });
    expect(notReady.status).toBe(422);
    expect(JSON.stringify(notReady.body.details)).toMatch(/summary/);
    expect((await c.ed.put(`/pillars/${p.id}`, { ...editable(p), ...fill })).status).toBe(200);
    expect((await c.ed.post(`/pillars/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await c.rev.post(`/pillars/${p.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await c.admin.post(`/pillars/${p.id}/publish`)).status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8'));
    expect(data.pillars.map((x: any) => [x.number, x.key, x.file])).toEqual([['01', 'youth-empowerment', 'youth-empowerment.html'], ['02', 'green-thumbs', 'environment-climate.html'], ['03', 'health', 'health.html']]);
    expect(readFileSync(join(h.siteRoot, 'health.html'), 'utf8')).toContain('<h1>Health and Well-being</h1>');
    expect((await c.ed.get('/pillars')).body.map((p: any) => p.key)).toContain('health');                      // now linkable
  });

  it('reorders the pillars (numbers follow), for publishers only', async () => {
    const list = (await c.ed.get('/pillars/records')).body;
    const ids = list.map((x: any) => x.id).reverse();
    expect((await c.ed.post('/pillars/order', { ids })).status).toBe(403);
    expect((await c.admin.post('/pillars/order', { ids: ids.slice(1) })).status).toBe(422);
    expect((await c.admin.post('/pillars/order', { ids })).status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8'));
    expect(data.pillars.map((x: any) => [x.number, x.key])).toEqual([['01', 'green-thumbs'], ['02', 'youth-empowerment']]);
    expect((await c.ed.get('/pillars/records')).body.map((x: any) => x.key)).toEqual(['green-thumbs', 'youth-empowerment']);
  });

  it('deletes drafts, blocks removing a pillar still in use, and removes a live one through review with a redirect', async () => {
    const draft = (await c.ed.post('/pillars', { name: 'Draft only', key: 'draft-only' })).body;
    expect((await c.ed.raw('DELETE', `/pillars/${draft.id}`)).status).toBe(200);
    expect((await h.db.select().from(pillars).where(eq(pillars.id, draft.id))).length).toBe(0);

    // green-thumbs is used by the Eco Citizen project and objective SO-03
    const env = (await c.ed.get('/pillars/records')).body.find((x: any) => x.key === 'green-thumbs');
    const blocked = await c.ed.post(`/pillars/${env.id}/transition`, { action: 'request_removal' });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body.details)).toMatch(/Eco Citizen/);
    expect((await c.ed.raw('DELETE', `/pillars/${env.id}`)).status).toBe(409);                               // live: removal goes through review

    // a new pillar, published, then removed
    const { body: n } = await c.ed.post('/pillars', { name: 'Health', key: 'health' });
    const { body: p } = await c.ed.get(`/pillars/${n.id}`);
    await c.ed.put(`/pillars/${n.id}`, { ...editable(p), ...fill });
    await c.ed.post(`/pillars/${n.id}/transition`, { action: 'submit' }); await c.rev.post(`/pillars/${n.id}/transition`, { action: 'approve' });
    expect((await c.admin.post(`/pillars/${n.id}/publish`)).status).toBe(200);
    expect((await c.ed.post(`/pillars/${n.id}/transition`, { action: 'request_removal' })).status).toBe(200);
    expect((await c.ed.post(`/pillars/${n.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await c.rev.post(`/pillars/${n.id}/transition`, { action: 'approve' })).status).toBe(200);
    const rm = await c.admin.post(`/pillars/${n.id}/publish`);
    expect(rm.status).toBe(200); expect(rm.body.removed).toBe(true);
    expect(readFileSync(join(h.siteRoot, 'health.html'), 'utf8')).toContain('<!-- studio-redirect -->');
    expect(readFileSync(join(h.siteRoot, 'pillars.html'), 'utf8')).not.toContain('health.html');
    expect(JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8')).pillars).toHaveLength(2);
    expect((await h.db.select().from(redirects).where(eq(redirects.source, 'health.html')))[0]).toMatchObject({ destination: 'pillars.html', status: 'active' });
    expect((await h.db.select().from(pillars).where(eq(pillars.id, n.id))).length).toBe(0);
    expect((await h.db.select().from(auditLog).where(eq(auditLog.action, 'pillar.remove'))).length).toBe(1);
    expect((await c.ed.post('/pillars', { name: 'Health again', key: 'health' })).status).toBe(409);         // the old address is a redirect now
  });
});

describe('pillar delivery failures', () => {
  it('leaves the live site and the live pillar names alone when the build fails', async () => {
    let fail = false;
    const c = await setup(fakeRunner({ fail: () => fail }));
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const id = (await c.ed.get('/pillars/records')).body[0].id;
    const { body: p } = await c.ed.get(`/pillars/${id}`);
    await c.ed.put(`/pillars/${id}`, { ...editable(p), name: 'Renamed pillar' });
    await c.ed.post(`/pillars/${id}/transition`, { action: 'submit' }); await c.rev.post(`/pillars/${id}/transition`, { action: 'approve' });
    fail = true;
    expect((await c.admin.post(`/pillars/${id}/publish`)).status).toBe(409);
    const [row] = await h.db.select().from(pillars).where(eq(pillars.id, id));
    expect(row).toMatchObject({ status: 'approved', name: 'Youth Empowerment' });
    expect((await h.db.select().from(publishJobs).where(eq(publishJobs.entityId, id)))[0].status).toBe('failed');
  });
});

// ---------------------------------------------------------------- the real generator
/** Runs the site's real generator (src/content.py) and build (build.mjs, with French and Arabic) into `dir`. */
function realBuild(dir: string, pillarsJson: string) {
  const pagesDir = join(dir, 'pages'), outDir = join(dir, 'site');
  mkdirSync(pagesDir, { recursive: true }); mkdirSync(join(outDir, 'assets'), { recursive: true });
  copyFileSync(join(REPO, 'assets/main.js'), join(outDir, 'assets/main.js'));   // makes build.mjs build fr/ and ar/ too
  // the other generated pages come from the checkout's own sources; Studio-made pages (src/pages only) are copied as they are
  for (const f of readdirSync(join(REPO, 'src/pages'))) copyFileSync(join(REPO, 'src/pages', f), join(pagesDir, f));
  const env = { ...process.env, STUDIO_OUT: pagesDir, PAGES_DIR: pagesDir, OUT_DIR: outDir, STUDIO_PILLARS_JSON: pillarsJson };
  execFileSync('python3', ['-I', 'src/content.py'], { cwd: REPO, env, stdio: 'ignore' });
  execFileSync('node', ['build.mjs'], { cwd: REPO, env, stdio: 'ignore' });
  return outDir;
}
const PILLAR_PAGES = ['pillars.html', 'youth-empowerment.html', 'womens-empowerment.html', 'environment-climate.html', 'digital-inclusion.html'];

describe('pillar pages through the real generator', () => {
  it('are byte-identical to today with the imported content, and change only after an edit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-pillars-real-'));
    // Studio's export of the imported content, built exactly like Publisher.writePillars does
    const live = SITE_PILLARS.map((s, i) => {
      const { provenance: _p, ...c } = contentFromSite(s);
      const number = String(i + 1).padStart(2, '0');
      const publicFile = { 'youth-empowerment': 'youth-empowerment.html', 'women-empowerment': 'womens-empowerment.html', 'green-thumbs': 'environment-climate.html', 'digital-empowerment': 'digital-inclusion.html' }[s.key]!;
      return { id: `rev-${i}`, sort: i, snap: { key: s.key, number, publicFile, ...c } as PillarSnapshot };
    });
    const write = async (file: string, items: typeof live) => { writeFileSync(file, JSON.stringify({ version: 1, source: 'AFCD Studio', pillars: await pillarEntries(h.db, items) }, null, 2)); return file; };
    h = await makeApp();
    const before = realBuild(join(root, 'without'), join(root, 'none.json'));                 // no pillars.json: today's site
    const same = realBuild(join(root, 'imported'), await write(join(root, 'imported.json'), live));
    const files = readdirSync(before, { recursive: true }).map(String).filter((f) => f.endsWith('.html')).sort();
    const en = files.filter((f) => !f.includes('/'));                                          // every English page has its French and Arabic version
    expect(en.length).toBeGreaterThan(10);
    for (const f of en) for (const l of ['fr/', 'ar/']) expect(files).toContain(l + f);
    for (const f of PILLAR_PAGES) for (const l of ['', 'fr/', 'ar/']) expect(files).toContain(l + f);
    const changed = files.filter((f) => !readFileSync(join(before, f)).equals(readFileSync(join(same, f))));
    expect(changed).toEqual([]);                                                               // every page, byte for byte
    // the page sources too (compared with the generator's own text, not the checkout: Studio may have published edits there)
    for (const f of PILLAR_PAGES) expect(readFileSync(join(root, 'imported/pages', f), 'utf8')).toBe(readFileSync(join(root, 'without/pages', f), 'utf8'));

    // an edit reaches the pillar page, the hub and the pages that name the pillar, and nothing else
    const edited = live.map((x) => (x.snap.key === 'digital-empowerment' ? { ...x, snap: { ...x.snap, name: 'Digital & AI', intro: 'Edited intro.' } } : x));
    const after = realBuild(join(root, 'edited'), await write(join(root, 'edited.json'), edited));
    const diff = files.filter((f) => !f.includes('/') && !readFileSync(join(before, f)).equals(readFileSync(join(after, f))));
    expect(diff).toEqual(expect.arrayContaining(['digital-inclusion.html', 'pillars.html']));
    const page = readFileSync(join(after, 'digital-inclusion.html'), 'utf8');
    expect(page).toContain('Digital &amp; AI'); expect(page).toContain('Edited intro.');
    expect(readFileSync(join(after, 'youth-empowerment.html'), 'utf8')).toContain('Digital &amp; AI');   // "Other pillars" cards

    // How we work's own lists replace the picked ones, in order; an empty one hides its column
    const lists = live.map((x) => (x.snap.key === 'green-thumbs' ? { ...x, snap: { ...x.snap, workItems: [{ icon: 5, text: 'Card B & C' }, { icon: 2, text: 'Card A' }], audience: [], activities: [], extraActivities: [], groups: [], extraGroups: [] } } : x));
    const gt = readFileSync(join(realBuild(join(root, 'lists'), await write(join(root, 'lists.json'), lists)), 'environment-climate.html'), 'utf8');
    const how = gt.slice(gt.indexOf('id="how-we-work"'), gt.indexOf('id="projects"'));
    expect(how).toContain('plx-work plx-work-1'); expect(how).not.toContain('Who we work with');
    expect(how).not.toContain('plx-step'); expect(how).not.toContain('How this pillar');          // the numbered steps are gone
    expect(how.indexOf('Card B &amp; C')).toBeLessThan(how.indexOf('Card A'));
    expect((how.match(/class="plx-act"/g) ?? []).length).toBe(2);

    // a fifth pillar added in Studio gets its own page, and the count follows everywhere
    const fifth = { id: 'rev-new', sort: 10, snap: { ...live[3].snap, key: 'health-wellbeing', publicFile: 'health-wellbeing.html', name: 'Health and Well-being', short: 'Health', summary: 'A new pillar summary.', intro: 'A new pillar.', highlights: [] } };
    const five = realBuild(join(root, 'five'), await write(join(root, 'five.json'), [...live, fifth]));
    const newPage = readFileSync(join(five, 'health-wellbeing.html'), 'utf8');
    expect(newPage).toContain('Pillar 05 / 05');
    expect(existsSync(join(five, 'fr/health-wellbeing.html'))).toBe(true);
    const hub = readFileSync(join(five, 'pillars.html'), 'utf8');
    expect(hub).toContain('Five pillars.'); expect(hub).toContain('href="health-wellbeing.html"');
    expect(hub).toContain('Digital Inclusion and Innovation and Health and Well-being: the five pillars');
    expect(readFileSync(join(five, 'youth-empowerment.html'), 'utf8')).toContain('Pillar 01 / 05');
    expect(readFileSync(join(five, 'sitemap.xml'), 'utf8')).toContain('health-wellbeing.html');
  }, 180_000);
});
