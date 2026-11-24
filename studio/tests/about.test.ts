import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { makeApp, addUser, client, fakeRunner, pngBytes, ORIGIN } from './helpers.ts';
import { aboutPages, aboutPageRevisions, auditLog, objectives } from '../src/server/db/schema.ts';
import { ABOUT_KEYS, importAbout, readSiteAbout } from '../src/server/modules/about/service.ts';
import { loadConfig } from '../src/server/config.ts';

// The real website checkout: its content.py holds the built-in About texts that Studio imports once.
const REPO = resolve(import.meta.dirname, '../..');
const SITE = readSiteAbout({ siteRoot: REPO } as ReturnType<typeof loadConfig>);

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); h = undefined as never; });
async function setup() {
  h = await makeApp({ runner: fakeRunner() });
  await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer');
  await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'ro@afcd.test', 'read_only');
  return { ed: await client(h.app, 'ed@afcd.test'), rev: await client(h.app, 'rev@afcd.test'), admin: await client(h.app, 'admin@afcd.test'), ro: await client(h.app, 'ro@afcd.test') };
}
const json = (f: string) => JSON.parse(readFileSync(join(h.siteRoot, f), 'utf8'));

async function approve(c: Awaited<ReturnType<typeof setup>>, key: string) {
  expect((await c.ed.post(`/about/${key}/transition`, { action: 'submit' })).status).toBe(200);
  expect((await c.rev.post(`/about/${key}/transition`, { action: 'approve' })).status).toBe(200);
}

describe('about pages', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); });

  it('imports the real text of the five pages once, as published revision 1, inventing nothing', async () => {
    expect(Object.keys(SITE).sort()).toEqual([...ABOUT_KEYS].sort());
    expect(SITE['our-story'].intro).toMatch(/^Founded in 2007 by a group of passionate young people/);
    expect((SITE['our-story'].principles as any[]).map((p) => p.title)).toContain('Transparent & Accountable');
    expect(SITE.team.people).toEqual([]);                                                        // no invented people
    expect((await c.ed.post('/about/import')).status).toBe(403);
    expect(await importAbout(h.db, h.cfg, null, SITE)).toEqual({ imported: 5, skipped: 0 });
    expect(await importAbout(h.db, h.cfg, null, SITE)).toEqual({ imported: 0, skipped: 5 });
    const list = (await c.ro.get('/about/records')).body;
    expect(list.map((r: any) => [r.key, r.status, r.imported])).toEqual(ABOUT_KEYS.map((k) => [k, 'published', true]));
    // Strategy reuses the objective records (the test site has SO-01 and SO-03), not the literal list
    const s = (await c.ed.get('/about/strategy')).body;
    expect(s.content.objectives).toEqual([{ ref: 'SO-01', title: 'Youth leadership', text: 'd' }, { ref: 'SO-03', title: 'Climate action', text: 'd' }]);
    expect(s.context.objectives).toEqual([{ ref: 'SO-01', pillarKeys: ['youth-empowerment'] }, { ref: 'SO-03', pillarKeys: ['green-thumbs'] }]);
    expect((await h.db.select().from(aboutPageRevisions)).map((r) => r.reason)).toEqual(Array(5).fill('imported'));
  });

  it('runs draft → review → approved → published with roles, audit and plain-text export', async () => {
    await importAbout(h.db, h.cfg, null, SITE);
    const { body: p } = await c.ed.get('/about/our-story');
    // the test site has two of the four pillars: a focus area may only link to an existing one
    const areas = p.content.areas.map((a: any) => ({ ...a, pillar: ['youth-empowerment', 'green-thumbs'].includes(a.pillar) ? a.pillar : '' }));
    const content = { ...p.content, areas, hero: { ...p.content.hero, title: 'Young volunteers & “Ait Ourir”' } };
    expect((await c.ro.put('/about/our-story', { content })).status).toBe(403);
    expect((await c.ed.put('/about/our-story', { content: { ...content, intro: 'Hi <script>' } })).status).toBe(422);
    expect((await c.ed.put('/about/our-story', { content: { ...content, extra: 1 } })).status).toBe(422);
    expect((await c.ed.put('/about/our-story', { content })).status).toBe(200);
    // the live page is untouched until publishing
    expect(existsSync(join(h.siteRoot, 'src/data/about.json'))).toBe(false);

    expect((await c.ed.post('/about/our-story/transition', { action: 'submit' })).status).toBe(200);
    expect((await c.ed.put('/about/our-story', { content })).status).toBe(409);                  // locked in review
    expect((await c.ed.post('/about/our-story/transition', { action: 'approve' })).status).toBe(403);
    expect((await c.rev.post('/about/our-story/transition', { action: 'request_changes' })).status).toBe(422);
    expect((await c.rev.post('/about/our-story/transition', { action: 'approve' })).status).toBe(200);
    expect((await c.rev.post('/about/our-story/publish')).status).toBe(403);
    const q = (await c.admin.get('/review-queue')).body.find((x: any) => x.type === 'about');
    expect(q).toMatchObject({ title: 'Our Story', status: 'approved', canPublish: true });

    const pub = await c.admin.post('/about/our-story/publish');
    expect(pub.status).toBe(200); expect(pub.body.file).toBe('our-story.html');
    const data = json('src/data/about.json');
    expect(Object.keys(data.pages).sort()).toEqual([...ABOUT_KEYS].sort());                    // the other pages stay on revision 1
    expect(data.pages['our-story']).toMatchObject({ revision: pub.body.revisionId, hero: { title: 'Young volunteers & “Ait Ourir”' }, image: null });   // plain text
    expect(JSON.stringify(data)).not.toContain('Imported from');                                // provenance stays internal
    expect(readFileSync(join(h.siteRoot, 'our-story.html'), 'utf8')).toContain(`data-studio-rev="${pub.body.revisionId}"`);
    const id = (await h.db.select().from(aboutPages).where(eq(aboutPages.key, 'our-story')))[0].id;
    const actions = (await h.db.select().from(auditLog).where(and(eq(auditLog.entityType, 'about_page'), eq(auditLog.entityId, id)))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['about.import', 'about.update', 'about.submit', 'about.approve', 'about.publish']));

    const revs = (await c.ed.get('/about/our-story')).body.history.revisions;
    const first = revs.find((r: any) => r.number === 1);
    expect((await c.ed.post(`/about/our-story/revisions/${first.id}/restore`)).status).toBe(200);
    expect((await c.ed.get('/about/our-story')).body.content.hero.title).toBe('It started with young volunteers');
  });

  it('publishes the strategy page’s objective wording to the objective records, keeping their pillars', async () => {
    await importAbout(h.db, h.cfg, null, SITE);
    const { body: s } = await c.ed.get('/about/strategy');
    const drop = { ...s.content, objectives: s.content.objectives.slice(0, 1) };
    expect((await c.ed.put('/about/strategy', { content: drop })).status).toBe(422);             // each objective exactly once
    const renamed = { ...s.content, objectives: [{ ...s.content.objectives[0], title: 'Youth leadership & civic life' }, s.content.objectives[1]] };
    expect((await c.ed.put('/about/strategy', { content: renamed })).status).toBe(200);
    expect((await h.db.select().from(objectives).where(eq(objectives.ref, 'SO-01')))[0].title).toBe('Youth leadership');   // not before publishing
    await approve(c, 'strategy');
    expect((await c.admin.post('/about/strategy/publish')).status).toBe(200);
    expect((await h.db.select().from(objectives).where(eq(objectives.ref, 'SO-01')))[0].title).toBe('Youth leadership & civic life');
    expect(json('src/data/about.json').pages.strategy.objectives[0]).toEqual({ ref: 'SO-01', title: 'Youth leadership & civic life', text: 'd', pillars: ['youth-empowerment'] });
  });

  it('rolls the objective records back when the build fails', async () => {
    await h.close();
    let fail = false;
    h = await makeApp({ runner: fakeRunner({ fail: () => fail }) });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    c = { ...c, ed: await client(h.app, 'ed@afcd.test'), rev: await client(h.app, 'rev@afcd.test'), admin: await client(h.app, 'admin@afcd.test') };
    await importAbout(h.db, h.cfg, null, SITE);
    const { body: s } = await c.ed.get('/about/strategy');
    await c.ed.put('/about/strategy', { content: { ...s.content, objectives: [{ ...s.content.objectives[0], title: 'Changed' }, s.content.objectives[1]] } });
    await approve(c, 'strategy');
    fail = true;
    expect((await c.admin.post('/about/strategy/publish')).status).toBe(409);
    expect((await h.db.select().from(objectives).where(eq(objectives.ref, 'SO-01')))[0].title).toBe('Youth leadership');
    expect((await c.admin.get('/about/strategy')).body.status).toBe('approved');
  });

  it('team: people need a name and role, never a legal-representative label or a private email; portraits need alt text and rights', async () => {
    await importAbout(h.db, h.cfg, null, SITE);
    const { body: t } = await c.ed.get('/about/team');
    const fd = new FormData(); fd.append('file', new File([await pngBytes()], 'portrait.png', { type: 'image/png' }));
    const img = await (await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: c.ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.ed.csrf } })).json();
    const person = { name: 'Test Person (fake)', role: 'Programme coordinator', group: 'executive', bio: '', mediaId: img.id };
    expect((await c.ed.put('/about/team', { content: { ...t.content, people: [{ ...person, group: 'founders' }] } })).status).toBe(422);
    const bad = [{ ...person, role: 'Legal representative' }, { ...person, name: '', bio: 'Write to someone@example.com' }];
    expect((await c.ed.put('/about/team', { content: { ...t.content, people: bad } })).status).toBe(200);   // drafts may be incomplete
    const blocked = await c.ed.post('/about/team/transition', { action: 'submit' });
    expect(blocked.status).toBe(422);
    const msg = JSON.stringify(blocked.body.details);
    expect(msg).toMatch(/legal representative is not shown/); expect(msg).toMatch(/Person 2: add a name/); expect(msg).toMatch(/someone@example.com is not public/);
    expect(msg).toMatch(/alt text/); expect(msg).toMatch(/Confirm AFCD may use/);
    await h.app.request(`/studio/api/media/${img.id}`, { method: 'PATCH', headers: { Cookie: c.ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.ed.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: 'Portrait of a test person', rightsConfirmed: true }) });
    expect((await c.ed.put('/about/team', { content: { ...t.content, people: [person, { ...person, name: 'Second Test (fake)', bio: 'Write to contact@afcdteam.com' }] } })).status).toBe(200);
    await approve(c, 'team');
    expect((await c.admin.post('/about/team/publish')).status).toBe(200);
    const team = json('src/data/about.json').pages.team;
    expect(team.people[0]).toMatchObject({ name: 'Test Person (fake)', group: 'executive', image: { alt: 'Portrait of a test person', src: expect.stringMatching(/^assets\/media\//) } });
    expect(existsSync(join(h.siteRoot, team.people[0].image.src))).toBe(true);
  });

  it('saves section settings: visibility, order and headings, validated', async () => {
    await importAbout(h.db, h.cfg, null, SITE);
    const { body: p } = await c.ed.get('/about/partners');
    const sections = { models: { show: false }, how: { show: true, title: 'How we start', soft: '', label: 'First steps' } };
    expect((await c.ed.put('/about/partners', { content: { ...p.content, sections: { Bad: { show: true } } } })).status).toBe(422);
    expect((await c.ed.put('/about/partners', { content: { ...p.content, sections: { how: { title: 'x <b>' } } } })).status).toBe(422);
    expect((await c.ed.put('/about/partners', { content: { ...p.content, sections: { how: { colour: 'red' } } } })).status).toBe(422);
    expect((await c.ed.put('/about/partners', { content: { ...p.content, sections, order: ['how', 'directory', 'models'] } })).status).toBe(200);
    const saved = (await c.ed.get('/about/partners')).body.content;
    expect(saved.order).toEqual(['how', 'directory', 'models']);
    expect(saved.sections.how).toMatchObject({ show: true, title: 'How we start', soft: '', label: 'First steps' });
    expect(saved.sections.models).toEqual({ show: false });
  });

  it('builds a preview without touching the live site', async () => {
    await importAbout(h.db, h.cfg, null, SITE);
    const { body: p } = await c.ed.get('/about/mission-vision');
    await c.ed.put('/about/mission-vision', { content: { ...p.content, vision: 'Preview only' } });
    const r = await c.ed.post('/about/mission-vision/preview');
    expect(r.status).toBe(200); expect(r.body.url).toMatch(/^\/studio\/preview\/[0-9a-f]{32}\/mission-vision\.html$/);
    expect(existsSync(join(h.siteRoot, 'src/data/about.json'))).toBe(false);
  });
});

describe('about pages in the real generator (src/content.py)', () => {
  it('renders Studio content, escaped, and falls back to the built-in text without about.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'about-gen-'));
    const file = join(dir, 'about.json');
    const team = { ...SITE.team, people: [{ name: 'Test <Person> & Co (fake)', role: 'Coordinator', group: 'board', bio: '', mediaId: null, image: null }], revision: 'rev-team-1' };
    const strategy = { ...SITE.strategy, objectives: (SITE.strategy.objectives as any[]).map((o, i) => (i === 0 ? { ...o, title: 'Renamed & “quoted”' } : o)), revision: 'rev-str-1' };
    const partners = { ...SITE.partners, revision: 'rev-pt-1', order: ['how', 'directory'], sections: { models: { show: false }, how: { show: true, label: 'First steps', title: 'How we start', soft: '' } } };
    writeFileSync(file, JSON.stringify({ version: 1, pages: { team, strategy, partners } }));
    execFileSync('python3', ['-I', 'src/content.py'], { cwd: REPO, env: { ...process.env, STUDIO_ABOUT_JSON: file, STUDIO_OUT: dir }, stdio: 'pipe' });
    const teamHtml = readFileSync(join(dir, 'team.html'), 'utf8');
    expect(teamHtml).toContain('Test &lt;Person&gt; &amp; Co (fake)'); expect(teamHtml).toContain('data-studio-rev="rev-team-1"');
    expect(teamHtml).toContain('id="board"'); expect(teamHtml).not.toContain('Team profiles are not published yet');
    expect(readFileSync(join(dir, 'strategy.html'), 'utf8')).toContain('Renamed &amp; “quoted”');
    // sections: hidden ones are gone (menu too), the order and the headings follow Studio, numbers run 01, 02…
    const pt = readFileSync(join(dir, 'partners.html'), 'utf8');
    expect(pt).not.toContain('id="models"'); expect(pt).not.toContain('>Ways to partner<');
    expect(pt.indexOf('id="how"')).toBeLessThan(pt.indexOf('id="directory"'));
    expect(pt).toMatch(/<span class="sh-num">01<\/span><span class="sh-label">First steps<\/span>/);
    expect(pt).toContain('How we start'); expect(pt).not.toContain('to shared results.');
    expect(pt).toMatch(/class="pl-tab">How it starts<\/a><a href="#directory" class="pl-tab">Directory/);
    // Our Story was not in the file: built-in text, no revision marker
    const story = readFileSync(join(dir, 'our-story.html'), 'utf8');
    expect(story).toContain('Community-Rooted Leadership'); expect(story).not.toContain('data-studio-rev');
    // no horizontal overflow traps: every About page keeps the shared sticky menu and numbered sections
    for (const f of ['our-story.html', 'mission-vision.html', 'strategy.html', 'team.html', 'partners.html']) expect(readFileSync(join(dir, f), 'utf8')).toContain('data-pl-tabs');
  });
});
