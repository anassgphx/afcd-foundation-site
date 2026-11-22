import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client, projectInput } from './helpers.ts';
import { renderBlocks, richText, validateDoc, BLOCKS } from '../src/server/modules/pages/blocks.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });
const ctx = { media: () => null, projects: [], pageTitle: 'T' };

describe('block library', () => {
  it('every block renders its defaults without errors', () => {
    for (const b of BLOCKS) {
      const { doc, problems } = validateDoc({ version: 1, blocks: [{ id: 'abcdef', type: b.type, v: b.version, hidden: false, props: b.defaults }] });
      expect(problems, b.type).toEqual([]);
      if (b.group === 'Live') {
        // live sections disappear from the public page when there is nothing to show, and explain why in the editor
        expect(renderBlocks(doc, ctx), b.type).toBe('');
        expect(renderBlocks(doc, { ...ctx, editor: true }), b.type).toContain('stays hidden');
      } else expect(renderBlocks(doc, ctx).length, b.type).toBeGreaterThan(10);
    }
  });

  it('live sections show published records, filtered, and design presets wrap any block', () => {
    const sources = {
      today: '2026-11-22',
      stories: [{ title: 'Climate camp & more', url: 'news-climate-camp.html', type: 'Event recap', typeKey: 'event_recap', pillar: 'Environment and Climate', pillarKey: 'green-thumbs', colour: '#82E591', date: '2026-11-20', dateLabel: '20 November 2026', hero: null, excerpt: '' },
        { title: 'Leadership call', url: 'news-call.html', type: 'Call for applications', typeKey: 'call_for_applications', pillar: '', pillarKey: '', colour: '#ccc', date: '2026-11-10', dateLabel: '10 November 2026', hero: null, excerpt: '' }],
      events: [{ title: 'Past workshop', file: 'event-past.html', start: '2026-10-01', end: null, upcoming: false, kind: 'Workshop', where: 'Marrakech', time: '10:00', pillarKey: '', colour: '#ccc', poster: null },
        { title: 'Next workshop', file: 'event-next.html', start: '2027-01-10', end: null, upcoming: true, kind: 'Workshop', where: 'Ait Ourir', time: '10:00', pillarKey: '', colour: '#ccc', poster: null }],
      opportunities: [{ title: 'Open call', file: 'opportunity-open.html', type: 'Volunteering', typeKey: 'volunteering', state: 'open' as const, deadline: '2027-01-31', opensOn: null, location: '', pillarKey: '' },
        { title: 'Closed call', file: 'opportunity-closed.html', type: 'Job', typeKey: 'job', state: 'closed' as const, deadline: '2026-01-01', opensOn: null, location: '', pillarKey: '' }],
      partners: [{ name: 'Danish Youth Council', scope: 'International', scopeKey: 'international', logo: null, url: null }],
    };
    const one = (type: string, props: Record<string, unknown>, design?: unknown) => renderBlocks(validateDoc({ version: 1, blocks: [{ id: 'abcdef', type, v: 1, hidden: false, props: { ...BLOCKS.find((b) => b.type === type)!.defaults, ...props }, ...(design ? { design } : {}) }] }).doc, { ...ctx, sources });
    const stories = one('latest_stories', { kind: 'event_recap' });
    expect(stories).toContain('Climate camp &amp; more'); expect(stories).not.toContain('Leadership call');
    const ev = one('upcoming_events', {}); expect(ev).toContain('Next workshop'); expect(ev).not.toContain('Past workshop');
    const op = one('open_opportunities', {}); expect(op).toContain('Open call'); expect(op).not.toContain('Closed call');
    expect(one('partner_strip', { scope: 'national' })).toBe('');
    expect(one('partner_strip', {})).toContain('>DY<');   // initials: first two words
    const designed = one('upcoming_events', {}, { bg: 'soft', show: 'desktop', anchor: 'events' });
    expect(designed.startsWith('<div id="events" class="bg-[#F6F6F6] max-md:hidden">')).toBe(true);
    // only approved design presets are accepted (no free colours or CSS)
    expect(validateDoc({ version: 1, blocks: [{ id: 'abcdef', type: 'divider', v: 1, hidden: false, props: {}, design: { bg: 'red' } }] }).problems[0].message).toBe('The page layout is not valid.');
  });

  it('escapes HTML and blocks dangerous URLs in rich text and links', () => {
    const html = richText('<script>alert(1)</script> **bold** [x](javascript:alert(1)) [ok](about.html) [ext](https://example.org)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="about.html"');
    expect(html).toContain('href="https://example.org" target="_blank" rel="noopener"');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('rejects unsafe link fields and unknown block types', () => {
    const bad = validateDoc({ version: 1, blocks: [{ id: 'abcdef', type: 'cta', v: 1, hidden: false, props: { title: 'x', primaryUrl: 'javascript:alert(1)' } }] });
    expect(bad.problems.map((p) => p.message).join()).toMatch(/Use https/);
    const unknown = validateDoc({ version: 1, blocks: [{ id: 'abcdef', type: 'raw_html', v: 1, hidden: false, props: { html: '<b>' } }] });
    expect(unknown.problems[0].message).toMatch(/Unknown block/);
  });

  it('hidden blocks are left out of the public render', () => {
    const { doc } = validateDoc({ version: 1, blocks: [{ id: 'abcdef', type: 'quote', v: 1, hidden: true, props: { text: 'Secret draft quote' } }] });
    expect(renderBlocks(doc, ctx)).not.toContain('Secret draft quote');
    expect(renderBlocks(doc, { ...ctx, editor: true })).toContain('Secret draft quote');
  });
});

describe('pages API and publishing', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/about.html'), '---\ntitle: About\n---\n');   // an existing, template-managed page
  });

  it('protects existing site pages and reserved addresses', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.post('/pages', { title: 'About', slug: 'about' })).status).toBe(409);
    expect((await ed.post('/pages', { title: 'Project page', slug: 'project-x' })).status).toBe(409);
    expect((await ed.post('/pages', { title: 'Bad <b>', slug: 'bad' })).status).toBe(422);
  });

  it('builds, reviews, publishes and removes a page; project lists use live projects', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { status, body: page } = await ed.post('/pages', { title: 'Climate Week', slug: 'climate-week', template: 'campaign' });
    expect(status).toBe(201);
    const full = (await ed.get(`/pages/${page.id}`)).body;
    expect(full.doc.blocks[0].type).toBe('page_header');

    // canvas renders the unsaved document with selectable blocks
    const canvas = await ed.post('/pages/canvas', { title: 'Climate Week', doc: full.doc });
    expect(canvas.status).toBe(200);
    expect(canvas.body.html).toContain('data-block-id=');
    expect(canvas.body.html).toContain('<base href="/studio/site/">');

    // edit: inject markup in a quote, add the project list pointed at a pillar
    const doc = { ...full.doc, blocks: [...full.doc.blocks, { id: 'q1q1q1', type: 'quote', v: 1, hidden: false, props: { text: '<img src=x onerror=alert(1)>', name: 'A', role: '', tone: 'light', space: 'md' } }] };
    doc.blocks = doc.blocks.map((b: any) => (b.type === 'project_list' ? { ...b, props: { ...b.props, mode: 'pillar', pillar: 'green-thumbs' } } : b));
    const saved = await ed.put(`/pages/${page.id}`, { title: 'Climate Week', slug: 'climate-week', description: 'A week of climate action.', navSection: 'none', noindex: false, doc });
    expect(saved.status).toBe(200);

    expect((await ed.post(`/pages/${page.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await ed.put(`/pages/${page.id}`, { title: 'Climate Week', slug: 'climate-week', description: 'x', navSection: 'none', noindex: false, doc })).status).toBe(409);
    expect((await rev.post(`/pages/${page.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`/pages/${page.id}/publish`)).status).toBe(403);
    const pub = await admin.post(`/pages/${page.id}/publish`);
    expect(pub.status).toBe(200);

    const html = readFileSync(join(h.siteRoot, 'climate-week.html'), 'utf8');
    expect(html).toContain(`data-studio-page-rev="${pub.body.revisionId}"`);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Eco Citizen');                       // live project of that pillar, from the import
    expect(readFileSync(join(h.siteRoot, 'sitemap.xml'), 'utf8')).toContain('climate-week.html');
    const src = readFileSync(join(h.siteRoot, 'src/pages/climate-week.html'), 'utf8');
    expect(src).toMatch(/^---\ntitle: Climate Week · AFCD Foundation\ndescription: A week of climate action\.\nactive: none\n---/);

    // publishing a project refreshes project lists on live pages
    const { body: p } = await ed.post('/projects', projectInput());
    await ed.post(`/projects/${p.id}/transition`, { action: 'submit' });
    await rev.post(`/projects/${p.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/projects/${p.id}/publish`)).status).toBe(200);
    expect(readFileSync(join(h.siteRoot, 'climate-week.html'), 'utf8')).toContain('Green Schools');

    expect((await admin.post(`/pages/${page.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'climate-week.html'))).toBe(false);
    expect(existsSync(join(h.siteRoot, 'src/pages/climate-week.html'))).toBe(false);
  });

  it('will not submit a page with unfinished blocks or images without rights', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { body: page } = await ed.post('/pages', { title: 'Draft', slug: 'draft-page' });
    const doc = { version: 1, blocks: [{ id: 'aaaaaa', type: 'page_header', v: 1, hidden: false, props: { title: '' } }] };
    expect((await ed.put(`/pages/${page.id}`, { title: 'Draft', slug: 'draft-page', description: '', navSection: 'none', noindex: false, doc })).status).toBe(200);
    const r = await ed.post(`/pages/${page.id}/transition`, { action: 'submit' });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body.details)).toMatch(/Add a title|description/);
  });
});
