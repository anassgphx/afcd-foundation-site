// The Get Involved page is edited in Studio like the homepage: data-sf markers that src/content.py writes into
// src/pages/get-involved.html, a draft, review and publishing through src/data/page-fields.json. Its own sections can be
// shown, hidden and reordered (no sections from the block library). Uses the real page source.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { readFields, siteSections } from '../src/server/modules/home/fields.ts';
import { applyFields, renderPage } from '../../lib/page-fields.mjs';

const SITE = resolve(__dirname, '../..');
const FILE = 'get-involved.html';
const SOURCE = readFileSync(join(SITE, 'src/pages', FILE), 'utf8');
const BODY = SOURCE.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const API = `/page-text/${FILE}`;
const unmarked = (h: string) => h.replace(/ data-sf(?:-type|-section)?="[^"]*"/g, '');
const ids = (html: string) => [...html.matchAll(/<section\b[^>]*?(?:\sid="([^"]+)")?[^>]*>/g)].map((m) => m[1] ?? 'none');

describe('Get Involved page: fields', () => {
  const f = readFields(SITE, FILE);
  const get = (k: string) => f.find((x) => x.key === k);

  it('reads every text and link, with today’s wording as the default', () => {
    expect(get('head.title')).toMatchObject({ type: 'split', sectionId: 'header', default: { main: 'Let’s create change', soft: 'together.' } });
    expect(get('head.kicker')).toMatchObject({ type: 'tail', default: 'Get Involved' });
    expect(get('paths.volunteer.title')).toMatchObject({ type: 'text', section: 'paths.volunteer', sectionId: 'paths', default: 'Volunteer' });
    expect(get('paths.programs.item1')!.default).toBe('Leadership and entrepreneurship tracks');
    expect(get('paths.alumni.step3')!.default).toBe('Mentor, meet and take part');
    expect(get('paths.volunteer.who')).toMatchObject({ type: 'tail', default: 'Students, professionals and community members who want to help locally.' });
    expect(get('paths.partner.cta')).toMatchObject({ type: 'link', default: { label: 'Start a partnership', href: 'contact.html?topic=Partnership#message' } });
    expect(get('paths.whofor')).toMatchObject({ section: 'paths', default: 'Who it’s for:' });
    expect(get('how.head.num')!.default).toBe('01');
    expect(get('how.title')!.default).toEqual({ main: 'Three steps', soft: 'to take part.' });
    expect(get('how.step2.title')!.default).toBe('Get in touch');
    expect(get('calls.link')).toMatchObject({ type: 'href', sectionId: 'calls', default: 'news.html' });
    expect(get('calls.button')).toMatchObject({ type: 'label', default: 'See News & Stories' });
    expect(get('calls.text')!.default).toBe('Calls for youth and women’s programmes are published on News & Stories and in our newsletter.');
    expect(get('closing.cta2')).toMatchObject({ type: 'link', sectionId: 'closing', default: { label: 'About AFCD', href: 'about.html' } });
    expect(get('closing.way3.link')!.default).toBe('get-involved.html#partner');
    expect(get('closing.way1.text')!.default).toBe('Give time to activities in Ait Ourir and beyond.');
  });

  it('a repeated text is one field, and the step showing the pillar count stays with the Pillars module', () => {
    expect(f.filter((x) => x.key === 'paths.volunteer.title')).toHaveLength(1);   // the tab and the panel heading
    expect(f.filter((x) => x.key === 'paths.do')).toHaveLength(1);                // the same label in every panel
    expect(get('paths.partner.step1')).toBeDefined();
    expect(get('paths.partner.step2')).toBeUndefined();
    expect(BODY).toMatch(/<span>We explore fit with our [a-z]+ pillars together<\/span>/);
  });

  it('lists the page’s five sections, including the two written without an id', () => {
    expect(siteSections(SITE, FILE)).toEqual([
      { id: 'header', label: 'Page header' }, { id: 'paths', label: 'Ways to take part' }, { id: 'how', label: 'How it works' },
      { id: 'calls', label: 'Open calls' }, { id: 'closing', label: 'Closing call to action' }]);
  });

  it('content.py writes the same marked page (every live publish re-runs it)', () => {
    const out = mkdtempSync(join(tmpdir(), 'gi-gen-'));
    try {
      execFileSync('python3', ['-I', 'src/content.py'], { cwd: SITE, env: { ...process.env, STUDIO_OUT: out }, stdio: 'pipe' });
      expect(readFileSync(join(out, FILE), 'utf8')).toBe(SOURCE);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it('builds exactly today’s markup until something is edited', () => {
    const built = renderPage(BODY, undefined);
    expect(built).toBe(unmarked(BODY));
    expect(built).not.toContain('data-sf');
    expect(built).toContain('<section class="page-head phd">');
    expect(built).toContain('<section class="cta-wrap py-10 lg:py-14">');
  });

  it('applies edits: labels, arrows and the space after “Who it’s for:” stay; text is escaped', () => {
    const out = applyFields(BODY, {
      'paths.volunteer.title': 'Give your time', 'paths.whofor': 'For:', 'paths.volunteer.who': 'Anyone <with> time & energy.',
      'paths.volunteer.cta': { label: 'Sign up', href: 'contact.html?topic=Volunteering#message' }, 'calls.link': 'events.html', 'calls.button': 'See the calls',
      'calls.kicker': 'Now open', 'closing.way2.link': 'projects.html', 'head.kicker': 'Join us',
    });
    expect(out.match(/>Give your time</g)).toHaveLength(2);   // the tab and the panel heading
    expect(out.match(/<b class="font-semibold text-black">For:<\/b>/g)).toHaveLength(4);
    expect(out).toContain('<b class="font-semibold text-black">For:</b> Anyone &lt;with&gt; time &amp; energy.</p>');
    expect(out).toContain('<b class="font-semibold text-black">For:</b> Past participants of AFCD programmes.</p>');
    expect(out).toContain('<a href="contact.html?topic=Volunteering#message" class="btn-dark btn-cta min-h-[50px] px-7">Sign up <span class="arr" aria-hidden="true">↗</span></a>');
    expect(out).toContain('<a href="events.html" class="gi-calls group">');
    expect(out).toContain('>See the calls <span class="arr" aria-hidden="true">↗</span></span>');
    expect(out).toContain('<span class="tb-dot" aria-hidden="true"></span>Now open</span>');
    expect(out).toContain('<span class="phd-label"><span class="tb-dot" aria-hidden="true"></span>Join us</span>');
    expect(out).toContain('<a href="projects.html" class="cta-way">');
    expect(out).toContain('<a href="get-involved.html#volunteer" class="cta-way">');   // untouched way
    expect(out).not.toContain('data-sf=');
  });

  it('shows, hides and reorders sections; the page header’s #top anchor moves with it', () => {
    const out = renderPage(BODY, { fields: {}, layout: [{ section: 'closing' }, { section: 'header' }, { section: 'paths' }, { section: 'calls', hidden: true }, { section: 'how' }] });
    expect(ids(out)).toEqual(['none', 'none', 'paths', 'how']);
    expect(out.indexOf('cta-wrap')).toBeLessThan(out.indexOf('page-head'));
    expect(out.indexOf('<span id="top">')).toBeLessThan(out.indexOf('page-head'));
    expect(out).not.toContain('gi-calls');
    expect(out).not.toContain('data-sf');
  });
});

describe('Get Involved page: review and publishing', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => { await h?.close(); });
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages', FILE), SOURCE);
  });

  it('opens in the visual editor with its sections and fields, but no section library', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { status, body } = await ed.get(API);
    expect(status).toBe(200);
    expect(body.page).toMatchObject({ file: FILE, label: 'Get Involved page', layout: true, blocks: false, href: '/studio/get-involved' });
    expect(body.catalog).toEqual([]);
    expect(body.layout).toEqual(['header', 'paths', 'how', 'calls', 'closing'].map((id) => ({ kind: 'section', id, hidden: false })));
    expect(body.fields.some((f: any) => f.key === 'calls.link')).toBe(true);
    const canvas = await ed.post(`${API}/canvas`, { values: { 'head.lead': 'Hello there' }, layout: body.layout.map((e: any) => (e.id === 'how' ? { ...e, hidden: true } : e)) });
    expect(canvas.status).toBe(200);
    expect(canvas.body.html).toContain('data-block-id="closing"');
    expect(canvas.body.html).toContain('<div data-block-id="how" data-hidden="1">');
    expect(canvas.body.html).toContain('Hello there');
  });

  it('refuses markup, bad links, other pages’ fields and library sections', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.put(API, { 'paths.volunteer.title': '<b>Hi</b>' })).status).toBe(422);
    expect((await ed.put(API, { 'calls.link': 'javascript:alert(1)' })).status).toBe(422);
    expect((await ed.put(API, { 'paths.alumni.cta': { label: 'Join', href: 'contact.html?topic=<x>' } })).status).toBe(422);
    expect((await ed.put(API, { 'how.step1.title': '' })).status).toBe(422);
    expect((await ed.put(API, { 'reach.phone': '+212 600 000 001' })).status).toBe(422);   // a contact page field
    const block = { kind: 'block', id: 'abc123def', type: 'cta_band', v: 1, hidden: false, props: {} };
    const r = await ed.put(API, { values: {}, layout: [{ kind: 'section', id: 'header', hidden: false }, block] });
    expect(r.status).toBe(422);
    expect(r.body.error ?? r.body.message).toMatch(/new sections cannot be added/);
  });

  it('an edit and a reordered layout go through review into page-fields.json and the built page', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const edits = { 'paths.volunteer.text': 'Give time to activities across Al Haouz.', 'calls.link': 'events.html' };
    const layout = ['header', 'how', 'paths', 'calls', 'closing'].map((id) => ({ kind: 'section', id, hidden: id === 'calls' }));
    const saved = await ed.put(API, { values: edits, layout });
    expect(saved.status).toBe(200);
    expect(saved.body.layout).toEqual(layout);
    expect((await ed.get('/home')).body.content).toBeNull();   // the homepage is separate
    expect((await ed.post(`${API}/transition`, { action: 'submit' })).status).toBe(200);

    const q = await rev.get('/review-queue');
    const item = (q.body.items ?? q.body).find((x: any) => x.type === 'homepage');
    expect(item).toMatchObject({ label: 'Get Involved page', title: 'Get Involved page changes', href: '/studio/get-involved', api: API, status: 'in_review' });

    expect((await rev.post(`${API}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`${API}/publish`)).status).toBe(403);
    const pub = await admin.post(`${API}/publish`);
    expect(pub.status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8'));
    expect(Object.keys(data.pages)).toEqual([FILE]);
    expect(data.pages[FILE]).toMatchObject({ revision: pub.body.revisionId, fields: edits,
      layout: [{ section: 'header' }, { section: 'how' }, { section: 'paths' }, { section: 'calls', hidden: true }, { section: 'closing' }] });
    const built = renderPage(BODY, data.pages[FILE]);
    expect(built).toContain('>Give time to activities across Al Haouz.</p>');
    expect(built).not.toContain('gi-calls');
    expect(ids(built)).toEqual(['none', 'how', 'paths', 'none']);
    expect(readFileSync(join(h.siteRoot, FILE), 'utf8')).toContain(`<meta name="studio-fields-rev" content="${pub.body.revisionId}">`);

    // back to the page as written; the edits stay as a draft
    expect((await admin.post(`${API}/unpublish`)).status).toBe(200);
    expect((await ed.get(API)).body.content).toMatchObject({ status: 'draft', publishedRevisionId: null });
  });
});
