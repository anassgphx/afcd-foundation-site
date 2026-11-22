import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { composeSections } from '../../lib/page-fields.mjs';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const HOME = `---\ntitle: Home\ndescription: Home.\nactive: home\n---\n<!-- hero -->\n<section id="hero"><p data-sf="hero.1.kicker">Kicker</p></section>\n\n<!-- about -->\n<section id="who-we-are"><h2>Who</h2><section class="inner"></section></section>\n\n<section id="impact"><h2>Impact</h2></section>\n`;
const cta = (id: string) => ({ kind: 'block', id, type: 'cta', v: 1, hidden: false, props: { kicker: 'Join us', title: 'Volunteer with AFCD', text: 'Give time in Ait Ourir.', primaryText: 'Get involved', primaryUrl: 'get-involved.html', secondaryText: '', secondaryUrl: '' } });

describe('section composition (shared with build.mjs)', () => {
  const body = HOME.split('---\n')[2];
  it('keeps the page exactly as written without a layout, and handles nested sections', () => {
    expect(composeSections(body, null)).toBe(body);
  });
  it('reorders, hides, inserts, and keeps unknown sections at their source position', () => {
    const out = composeSections(body, [{ section: 'impact' }, { block: 'b1', html: '<section id="x">Block</section>' }, { section: 'hero', hidden: true }]);
    expect(out.indexOf('id="impact"')).toBeLessThan(out.indexOf('Block'));
    expect(out).not.toContain('id="hero"');
    expect(out).toContain('id="who-we-are"');   // not in the layout: stays (after hero's place, i.e. first)
  });
});

describe('homepage sections', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'ed2@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), HOME);
  });

  it('lists the page sections and the section library', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { body } = await ed.get('/home');
    expect(body.layout).toEqual([{ kind: 'section', id: 'hero', hidden: false }, { kind: 'section', id: 'who-we-are', hidden: false }, { kind: 'section', id: 'impact', hidden: false }]);
    expect(body.catalog.map((b: any) => b.type)).toContain('cta');
    expect(body.catalog.map((b: any) => b.type)).not.toContain('page_header');
    expect(body.fields.find((f: any) => f.key === 'hero.1.kicker').sectionId).toBe('hero');
  });

  it('refuses unknown section types, unknown sections and duplicates', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const s = (layout: unknown[]) => ed.put('/home', { values: {}, layout });
    expect((await s([{ kind: 'block', id: 'abcdef12', type: 'script', v: 1, hidden: false, props: {} }])).status).toBe(422);
    expect((await s([{ kind: 'section', id: 'nope', hidden: false }])).status).toBe(422);
    expect((await s([cta('abcdef12'), cta('abcdef12')])).status).toBe(422);
  });

  it('renders the live canvas with the working copy, marked for selection', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const r = await ed.post('/home/canvas', { values: { 'hero.1.kicker': 'Canvas kicker' }, layout: [{ kind: 'section', id: 'hero', hidden: false }, cta('abcdef12'), { kind: 'section', id: 'impact', hidden: true }, { kind: 'section', id: 'who-we-are', hidden: false }] });
    expect(r.status).toBe(200);
    expect(r.body.html).toContain('<div data-block-id="hero">');
    expect(r.body.html).toContain('Canvas kicker');
    expect(r.body.html).toContain('Volunteer with AFCD');
    expect(r.body.html).toContain('<div data-block-id="impact" data-hidden="1">');
    expect(r.body.html).not.toContain('<script');
  });

  it('adds a section, saves, reviews, publishes and composes the live page; refuses stale saves', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), ed2 = await client(h.app, 'ed2@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const layout = [{ kind: 'section', id: 'hero', hidden: false }, cta('abcdef12'), { kind: 'section', id: 'who-we-are', hidden: false }, { kind: 'section', id: 'impact', hidden: true }];
    const first = await ed.put('/home', { values: {}, layout, baseUpdatedAt: null });
    expect(first.status).toBe(200);
    const second = await ed2.put('/home', { values: { 'hero.1.kicker': 'Other' }, layout, baseUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(second.status).toBe(409);   // someone saved after this editor opened the page
    expect((await ed.put('/home', { values: {}, layout, baseUpdatedAt: first.body.updatedAt })).status).toBe(200);
    expect((await ed.post('/home/transition', { action: 'submit' })).status).toBe(200);
    expect((await rev.post('/home/transition', { action: 'approve' })).status).toBe(200);
    const pub = await admin.post('/home/publish');
    expect(pub.status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8')).pages['index.html'];
    expect(entry.layout.map((x: any) => x.section ?? `block:${x.block}`)).toEqual(['hero', 'block:abcdef12', 'who-we-are', 'impact']);
    expect(entry.layout.find((x: any) => x.block).html).toContain('Volunteer with AFCD');
    expect(entry.layout.find((x: any) => x.section === 'impact').hidden).toBe(true);
    // restoring an older revision creates a new draft and leaves the live version alone
    const hist = (await ed.get('/home')).body.history.revisions;
    expect((await ed.post(`/home/revisions/${hist[hist.length - 1].id}/restore`)).status).toBe(200);
    const after = (await ed.get('/home')).body;
    expect(after.content.status).toBe('draft');
    expect(after.content.publishedRevisionId).toBe(pub.body.revisionId);
  });
});
