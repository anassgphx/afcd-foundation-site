// The numbered section headers of the homepage (pill number, label, thin rule, right-hand caption or link) are Studio
// fields: same data-sf markers, same review and publishing as the rest of the homepage. Uses the real page source.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { readFields } from '../src/server/modules/home/fields.ts';
import { applyFields, renderPage } from '../../lib/page-fields.mjs';

const SITE = resolve(__dirname, '../..');
const SOURCE = readFileSync(join(SITE, 'src/pages/index.html'), 'utf8');
const BODY = SOURCE.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const HEAD = / data-sf="[a-z]+\.head\.[a-z]+"(?: data-sf-type="link")?/g;

// What the homepage shows today, header by header (section id, field prefix, number, label, caption or link).
const HEADERS = [
  ['who-we-are', 'about', '01', 'About AFCD Foundation', { meta: 'Who we are' }],
  ['purpose', 'purpose', '02', 'Our Purpose', { meta: 'Mission · Vision · Values' }],
  ['pillars', 'pillars', '03', 'Our Pillars', { link: { label: 'All pillars', href: 'pillars.html' } }],
  ['projects', 'projects', '04', 'Featured Projects', { link: { label: 'All projects', href: 'projects.html' } }],
  ['impact', 'impact', '05', 'Our Impact', { meta: 'Since 2007' }],
  ['news', 'news', '06', 'News & Stories', { link: { label: 'All stories', href: 'news.html' } }],
  ['events', 'events', '07', 'Upcoming Events', { link: { label: 'All events', href: 'events.html' } }],
  ['partners', 'partners', '08', 'Our Partners', { link: { label: 'All partners', href: 'partners.html' } }],
  ['get-involved', 'involved', '09', 'Get Involved', {}],
] as const;

describe('homepage section headers: fields', () => {
  it('every numbered header on the homepage is marked, in its own section, with today’s text as the default', () => {
    expect(BODY.match(/<div class="sh-top[^"]*">/g)?.length).toBe(HEADERS.length);
    const fields = readFields(SITE, 'index.html');
    for (const [sectionId, p, num, label, right] of HEADERS) {
      const own = fields.filter((f) => f.key.startsWith(`${p}.head.`));
      expect(own.map((f) => [f.key, f.sectionId, f.default])).toEqual([
        [`${p}.head.num`, sectionId, num],
        [`${p}.head.label`, sectionId, label],
        ...('meta' in right ? [[`${p}.head.meta`, sectionId, right.meta]] : []),
        ...('link' in right ? [[`${p}.head.link`, sectionId, right.link]] : []),
      ]);
      expect(own.find((f) => f.key.endsWith('.num'))!.label).toBe('Header · number');
      // the header comes first in its section's inspector
      expect(fields.find((f) => f.sectionId === sectionId)!.key).toBe(`${p}.head.num`);
    }
  });

  it('builds exactly today’s markup until something is edited', () => {
    expect(renderPage(BODY, undefined)).toBe(applyFields(BODY.replace(HEAD, ''), {}));
    expect(renderPage(BODY, undefined)).toContain('<div class="sh-top"><span class="sh-num">01</span><span class="sh-label">About AFCD Foundation</span><span class="sh-rule" aria-hidden="true"></span><span class="sh-meta">Who we are</span></div>');
  });

  it('applies edited text, escaped, and keeps the rule and the link arrow', () => {
    const out = renderPage(BODY, { fields: { 'about.head.num': '1', 'about.head.label': 'About us & our <team>', 'about.head.meta': 'Since 2007', 'pillars.head.link': { label: 'Every pillar', href: 'pillars.html#youth' } } });
    expect(out).toContain('<div class="sh-top"><span class="sh-num">1</span><span class="sh-label">About us &amp; our &lt;team&gt;</span><span class="sh-rule" aria-hidden="true"></span><span class="sh-meta">Since 2007</span></div>');
    expect(out).toContain('<a href="pillars.html#youth" class="sh-link">Every pillar <span class="arr" aria-hidden="true">↗</span></a>');
    expect(out).toContain('<span class="sh-num">02</span><span class="sh-label">Our Purpose</span>');   // others untouched
    expect(out).not.toContain('data-sf');
  });
});

describe('homepage section headers: review and publishing', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => { await h?.close(); });
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), SOURCE);
  });

  it('the Homepage editor offers the header fields', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { body } = await ed.get('/home');
    expect(body.fields.filter((f: any) => f.key.startsWith('about.head.')).map((f: any) => [f.key, f.type, f.default])).toEqual([
      ['about.head.num', 'text', '01'], ['about.head.label', 'text', 'About AFCD Foundation'], ['about.head.meta', 'text', 'Who we are'],
    ]);
  });

  it('refuses markup, empty text and over-long text', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.put('/home', { 'about.head.num': '12345' })).status).toBe(422);
    expect((await ed.put('/home', { 'about.head.label': '' })).status).toBe(422);
    expect((await ed.put('/home', { 'about.head.label': 'x'.repeat(61) })).status).toBe(422);
    expect((await ed.put('/home', { 'about.head.meta': '<b>Who</b>' })).status).toBe(422);
    expect((await ed.put('/home', { 'pillars.head.link': { label: 'All', href: 'javascript:alert(1)' } })).status).toBe(422);
    expect((await ed.put('/home', { 'involved.head.meta': 'Join' })).status).toBe(422);   // that header has no caption
  });

  it('goes through review before it is published, then back to the page’s own text', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const edits = { 'about.head.num': '1', 'about.head.label': 'About the Foundation', 'about.head.meta': 'Our story', 'news.head.link': { label: 'Every story', href: 'news.html' } };
    expect((await ed.put('/home', edits)).status).toBe(200);
    expect((await admin.post('/home/publish')).status).not.toBe(200);   // not approved yet
    expect((await ed.post('/home/transition', { action: 'submit' })).status).toBe(200);
    expect((await ed.post('/home/transition', { action: 'approve' })).status).toBe(403);
    expect((await rev.post('/home/transition', { action: 'approve' })).status).toBe(200);
    const pub = await admin.post('/home/publish');
    expect(pub.status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8')).pages['index.html'];
    expect(entry).toMatchObject({ revision: pub.body.revisionId, fields: edits });
    const out = renderPage(BODY, entry);
    expect(out).toContain('<span class="sh-num">1</span><span class="sh-label">About the Foundation</span><span class="sh-rule" aria-hidden="true"></span><span class="sh-meta">Our story</span>');
    expect(out).toContain('class="sh-link">Every story <span class="arr"');

    // a reset field is dropped from the stored values, so that header goes back to the page's own text
    expect((await ed.put('/home', { ...edits, 'about.head.label': null })).status).toBe(200);
    expect((await ed.get('/home')).body.content.values).not.toHaveProperty('about.head.label');
    expect((await admin.post('/home/unpublish')).status).toBe(200);
  });
});
