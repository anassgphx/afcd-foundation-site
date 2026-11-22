// The contact page's text is edited in Studio like the homepage's: data-sf markers in src/pages/contact.html, a draft,
// review, publishing through src/data/page-fields.json. It has no section layout. Uses the real page source.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { readFields, fieldSections } from '../src/server/modules/home/fields.ts';
import { applyFields, renderPage } from '../../lib/page-fields.mjs';

const SITE = resolve(__dirname, '../..');
const SOURCE = readFileSync(join(SITE, 'src/pages/contact.html'), 'utf8');
const BODY = SOURCE.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const API = '/page-text/contact.html';

describe('contact page: fields', () => {
  it('reads the contact page’s text, grouped by section, with today’s text as the default', () => {
    const f = readFields(SITE, 'contact.html');
    const get = (k: string) => f.find((x) => x.key === k);
    expect(get('head.title')).toMatchObject({ type: 'split', sectionId: 'section-1', default: { main: 'Let’s', soft: 'talk.' } });
    expect(get('reach.phone')).toMatchObject({ type: 'text', sectionId: 'reach', default: '+212 663 618 536', label: 'Phone number' });
    expect(get('reach.email1')!.default).toBe('contact@afcdteam.com');
    expect(get('message.to3.email')).toMatchObject({ type: 'text', default: 'akaya@afcdteam.com' });
    expect(get('message.office.text')!.default).toMatch(/^Roots in Ait Ourir/);
    expect(get('faq.link1')).toMatchObject({ type: 'link', default: { label: 'Get Involved', href: 'get-involved.html#volunteer' } });
    expect(get('faq.head.label')!.default).toBe('Questions');
    // the links that follow a number or address shown inside them are not separate fields
    expect(f.filter((x) => x.key === 'reach.phone')).toHaveLength(1);
    expect(fieldSections(SITE, 'contact.html').map((s) => s.label)).toEqual(['Page header', 'Contact details', 'Message and office', 'Questions', 'Privacy and accessibility']);
  });

  it('content.py writes the same marked contact page (every live publish re-runs it)', () => {
    const out = mkdtempSync(join(tmpdir(), 'contact-gen-'));
    try {
      execFileSync('python3', ['-I', 'src/content.py'], { cwd: SITE, env: { ...process.env, STUDIO_OUT: out }, stdio: 'pipe' });
      expect(readFileSync(join(out, 'contact.html'), 'utf8')).toBe(SOURCE);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it('builds exactly today’s markup until something is edited', () => {
    expect(renderPage(BODY, undefined)).toBe(BODY.replace(/ data-sf(?:-type)?="[^"]*"/g, ''));
  });

  it('a new phone number or email address also changes its link; text is escaped', () => {
    const out = applyFields(BODY, { 'reach.phone': '+212 600 000 001', 'reach.email1': 'hello@afcdteam.com', 'message.to1.email': 'press@afcdteam.com', 'head.lead': 'Write <to> us & more' });
    expect(out).toContain('<a href="tel:+212600000001" class="ct-q group">');
    expect(out).toContain('>+212 600 000 001</span>');
    expect(out).toContain('<a href="mailto:hello@afcdteam.com" class="ct-q group">');
    expect(out).toContain('href="mailto:press@afcdteam.com">press@afcdteam.com</a>');
    expect(out).toContain('<p class="phd-lead">Write &lt;to&gt; us &amp; more</p>');
    expect(out).toContain('<a href="mailto:akaya@afcdteam.com" class="ct-q group">');   // untouched card
    expect(out).not.toContain('data-sf');
  });
});

describe('contact page: review and publishing', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => { await h?.close(); });
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/contact.html'), SOURCE);
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), readFileSync(join(SITE, 'src/pages/index.html'), 'utf8'));
  });

  it('offers the contact fields, without a layout or section library', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { status, body } = await ed.get(API);
    expect(status).toBe(200);
    expect(body.page).toMatchObject({ file: 'contact.html', label: 'Contact page', layout: false });
    expect(body.catalog).toEqual([]);
    expect(body.layout.map((e: any) => e.id)).toEqual(['section-1', 'reach', 'message', 'faq', 'section-5']);
    expect(body.fields.some((f: any) => f.key === 'reach.phone')).toBe(true);
    expect(body.fields.some((f: any) => f.key.startsWith('hero.'))).toBe(false);
    const canvas = await ed.post(`${API}/canvas`, { values: { 'head.lead': 'Hello there' } });
    expect(canvas.body.html).toContain('data-block-id="reach"');
    expect(canvas.body.html).toContain('Hello there');
  });

  it('refuses a bad phone number, a bad address, markup and a layout', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.put(API, { 'reach.phone': 'call me' })).status).toBe(422);
    expect((await ed.put(API, { 'reach.email1': 'not-an-address' })).status).toBe(422);
    expect((await ed.put(API, { 'message.to2.email': 'x@y' })).status).toBe(422);
    expect((await ed.put(API, { 'faq.q1': '<b>Hi</b>' })).status).toBe(422);
    expect((await ed.put(API, { 'hero.1.kicker': 'Homepage text' })).status).toBe(422);   // not a contact page field
    const r = await ed.put(API, { values: { 'head.lead': 'Hi' }, layout: [{ kind: 'section', id: 'faq', hidden: true }] });
    expect(r.status).toBe(200);
    expect(r.body.layout).toBeNull();   // the contact page's sections stay as written
  });

  it('keeps the homepage and the contact page apart, and publishes both into page-fields.json after review', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const edits = { 'reach.phone': '+212 600 000 001', 'message.office.text': 'Our office address will be added here.' };
    expect((await ed.put(API, edits)).status).toBe(200);
    expect((await ed.get('/home')).body.content).toBeNull();
    expect((await admin.post(`${API}/publish`)).status).toBe(409);   // not approved yet
    expect((await ed.post(`${API}/transition`, { action: 'submit' })).status).toBe(200);

    // the approval queue and the dashboard name the contact page and link to its editor
    const q = await rev.get('/review-queue');
    const item = (q.body.items ?? q.body).find((x: any) => x.type === 'homepage');
    expect(item).toMatchObject({ label: 'Contact page', title: 'Contact page changes', href: '/studio/contact', api: API, status: 'in_review' });

    expect((await ed.post(`${API}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await rev.post(`${API}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`${API}/publish`)).status).toBe(403);
    const pub = await admin.post(`${API}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.file).toBe('contact.html');
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8'));
    expect(Object.keys(data.pages)).toEqual(['contact.html']);
    expect(data.pages['contact.html']).toMatchObject({ revision: pub.body.revisionId, fields: edits });
    expect(renderPage(BODY, data.pages['contact.html'])).toContain('href="tel:+212600000001"');

    // publishing the homepage afterwards keeps the contact page's live text in the same file
    expect((await ed.put('/home', { 'about.head.label': 'About the Foundation' })).status).toBe(200);
    await ed.post('/home/transition', { action: 'submit' }); await rev.post('/home/transition', { action: 'approve' });
    expect((await admin.post('/home/publish')).status).toBe(200);
    const both = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8'));
    expect(Object.keys(both.pages).sort()).toEqual(['contact.html', 'index.html']);
    expect(both.pages['contact.html'].revision).toBe(pub.body.revisionId);

    // the contact page goes back to its own text; the homepage edit stays live
    expect((await admin.post(`${API}/unpublish`)).status).toBe(200);
    expect(Object.keys(JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8')).pages)).toEqual(['index.html']);
    expect((await admin.post('/home/unpublish')).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'src/data/page-fields.json'))).toBe(false);
  });
});
