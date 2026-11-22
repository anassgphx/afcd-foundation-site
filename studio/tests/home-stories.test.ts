// Participant stories (the testimonials carousel in the homepage's "Our impact" section) are one Studio field, a list:
// add, edit, delete and reorder; the slides, progress bars and "01 / NN" counter follow it. Uses the real page source.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { readFields } from '../src/server/modules/home/fields.ts';
import { renderPage } from '../../lib/page-fields.mjs';

const SITE = resolve(__dirname, '../..');
const SOURCE = readFileSync(join(SITE, 'src/pages/index.html'), 'utf8');
const BODY = SOURCE.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const figure = (html: string) => html.slice(html.indexOf('<figure class="im-photo tm '), html.indexOf('</figure>', html.indexOf('<figure class="im-photo tm ')));
const slides = (html: string) => figure(html).match(/<article class="tm-slide[\s\S]*?<\/article>/g) ?? [];

describe('participant stories: field and build output', () => {
  it('reads the stories written in the page, with the samples marked', () => {
    const f = readFields(SITE, 'index.html').find((x) => x.key === 'impact.stories')!;
    expect(f).toMatchObject({ type: 'stories', sectionId: 'impact', label: 'Participant stories' });
    const list = f.default as any[];
    expect(list[0]).toEqual({ quote: expect.stringMatching(/^It was a good experience/), name: 'Ikram Fatna Elfenn', role: 'Let’s Dialogue Bootcamp · February 2021', caption: 'Leadership Lab 2.0 participants, 2023' });
    expect(list.slice(1).every((s) => s.sample === true)).toBe(true);
    expect(readFields(SITE, 'index.html').some((x) => /^impact\.quote/.test(x.key))).toBe(false);   // replaced by the list
  });

  it('builds exactly today’s carousel until the list is edited', () => {
    expect(renderPage(BODY, undefined)).toBe(BODY.replace(/ data-sf(?:-type)?="[^"]*"/g, ''));
  });

  it('one slide per story, in order, with matching bars, counter and labels; text escaped', () => {
    const stories = [
      { quote: 'AFCD gave me <confidence> & friends.', name: 'Sara El Amrani', role: 'Leadership Lab 2.0 · 2023', caption: '' },
      { quote: 'I learned to lead a team.', name: 'Youssef', role: '', caption: 'Bootcamp, 2022' },
      { quote: 'Q3', name: 'Amina Ait Ali', role: 'Eco Citizen', caption: '' },
      { quote: 'Q4', name: 'Hamza B', role: 'Bootcamp', caption: '' },
    ];
    const out = renderPage(BODY, { fields: { 'impact.stories': stories } });
    const s = slides(out);
    expect(s).toHaveLength(4);
    expect(s[0]).toMatch(/^<article class="tm-slide is-on" role="group" aria-roledescription="slide" aria-label="1 of 4">/);
    expect(s[3]).toMatch(/^<article class="tm-slide" role="group" aria-roledescription="slide" aria-label="4 of 4" aria-hidden="true" inert>/);
    expect(s[0]).toContain('<blockquote class="tm-quote">AFCD gave me &lt;confidence&gt; &amp; friends.</blockquote>');
    expect(s[0]).toContain('data-tm-initials>SA</span>');
    expect(s[0]).toContain('<span class="block font-medium">Sara El Amrani</span><span class="block text-white/65">Leadership Lab 2.0 · 2023</span>');
    expect(s[0]).not.toContain('ph-cap');   // no photo note: no caption on the placeholder
    expect(s[1]).toContain('<span class="ph-cap tm-cap"><b>Photo</b> · Bootcamp, 2022</span>');
    expect(s[1]).toContain('data-tm-initials>Y</span>');
    expect(figure(out)).not.toContain('tm-sample');
    expect(figure(out).match(/data-tm-go="\d"/g)).toEqual(['data-tm-go="0"', 'data-tm-go="1"', 'data-tm-go="2"', 'data-tm-go="3"']);
    expect(figure(out)).toContain('<b data-tm-cur>01</b> / 04</span>');
    expect(out).not.toContain('data-sf');
  });

  it('a single story builds one slide and one bar (assets/main.js then hides the controls)', () => {
    const out = renderPage(BODY, { fields: { 'impact.stories': [{ quote: 'Only one', name: 'Ikram Fatna Elfenn', role: '', caption: '' }] } });
    expect(slides(out)).toHaveLength(1);
    expect(figure(out)).toContain('<b data-tm-cur>01</b> / 01</span>');
  });
});

describe('participant stories: editing, review and publishing', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => { await h?.close(); });
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), SOURCE);
  });
  const real = (n: number) => Array.from({ length: n }, (_x, i) => ({ quote: `Real quote ${i + 1}`, name: `Person ${i + 1}`, role: 'Programme · 2024', caption: '' }));

  it('refuses an empty list, more than 8 stories, missing quotes or names, and markup', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.put('/home', { 'impact.stories': [] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': real(9) })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: '', name: 'A', role: '', caption: '' }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: 'Q', name: '', role: '', caption: '' }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: '<b>Q</b>', name: 'A', role: '', caption: '' }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: 'Q', name: 'A', role: '', caption: '', extra: 1 }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': real(8) })).status).toBe(200);
  });

  it('cannot be sent for review while a sample story remains', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const f = (await ed.get('/home')).body.fields.find((x: any) => x.key === 'impact.stories');
    const reordered = [f.default[1], f.default[0]];   // a sample moved to the front, still a sample
    expect((await ed.put('/home', { 'impact.stories': reordered })).status).toBe(200);
    const sub = await ed.post('/home/transition', { action: 'submit' });
    expect(sub.status).toBe(422);
    expect(JSON.stringify(sub.body)).toContain('Story 1 is still a sample');
  });

  it('edit, add, delete and reorder go through review, then publish into page-fields.json', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const f = (await ed.get('/home')).body.fields.find((x: any) => x.key === 'impact.stories');
    // keep the real story, delete both samples, add two new ones, and put a new one first
    const list = [{ quote: 'New story first.', name: 'Sara El Amrani', role: 'Leadership Lab 2.0 · 2023', caption: '' }, f.default[0], { quote: 'Another.', name: 'Youssef', role: '', caption: '' }];
    expect((await ed.put('/home', { 'impact.stories': list })).status).toBe(200);
    expect((await ed.post('/home/transition', { action: 'submit' })).status).toBe(200);
    expect((await rev.post('/home/transition', { action: 'approve' })).status).toBe(200);
    const pub = await admin.post('/home/publish');
    expect(pub.status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8')).pages['index.html'];
    expect(entry.fields['impact.stories']).toEqual(list);
    const s = slides(renderPage(BODY, entry));
    expect(s.map((x) => x.match(/class="block font-medium">([^<]*)</)![1])).toEqual(['Sara El Amrani', 'Ikram Fatna Elfenn', 'Youssef']);
  });
});
