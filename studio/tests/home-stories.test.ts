// Participant stories (the testimonials carousel in the homepage's "Our impact" section) are one Studio field, a list:
// add, edit, delete and reorder; the slides, progress bars and "01 / NN" counter follow it. Uses the real page source.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { join, resolve } from 'node:path';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import { readFields } from '../src/server/modules/home/fields.ts';
import { applyFields, renderPage } from '../../lib/page-fields.mjs';
import { media } from '../src/server/db/schema.ts';

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
    expect(list[0]).toEqual({ quote: expect.stringMatching(/^It was a good experience/), name: 'Ikram Fatna Elfenn', role: 'Let’s Dialogue Bootcamp · February 2021', caption: '',
      image: { src: 'assets/img/hero-slide-2.webp', alt: 'AFCD team member smiling while working at a laptop', w: 2000, h: 1435, fx: 50, fy: 30 } });   // the page's own photo
    expect(list[1].image).toBeUndefined();
    expect(list.slice(1).every((s) => s.sample === true)).toBe(true);
    expect(readFields(SITE, 'index.html').some((x) => /^impact\.quote/.test(x.key))).toBe(false);   // replaced by the list (photos included)
  });

  it('builds exactly today’s carousel until the list is edited, first photo included', () => {
    const out = renderPage(BODY, undefined);
    expect(out).toBe(BODY.replace(/ data-sf(?:-type)?="[^"]*"/g, ''));
    expect(slides(out)[0]).toContain('<img class="tm-img" src="assets/img/hero-slide-2.webp" alt="AFCD team member smiling while working at a laptop" width="2000" height="1435" loading="lazy" decoding="async" style="object-position:50% 30%">');
  });

  it('markers nested inside an unedited field are removed from the output too', () => {
    const body = '<figure data-sf="x.list" data-sf-type="stories"><img class="tm-img" data-sf="x.photo" data-sf-type="image" src="a.webp" alt="A" width="1" height="1"><p data-sf="x.t">T</p></figure>';
    expect(applyFields(body, {})).toBe('<figure><img class="tm-img" src="a.webp" alt="A" width="1" height="1"><p>T</p></figure>');
    expect(applyFields(body, { 'x.t': 'New' })).toContain('<p>New</p>');
  });

  it('a story with a photo gets <img class="tm-img">, one without gets the placeholder; an edited list keeps slide 1’s photo', () => {
    const f = readFields(SITE, 'index.html').find((x) => x.key === 'impact.stories')!;
    const first = (f.default as any[])[0];
    const photo = { src: 'assets/media/abc-1600.webp', srcset: 'assets/media/abc-800.webp 800w, assets/media/abc-1600.webp 1600w', alt: 'Sara <speaking> at a workshop', w: 1600, h: 1067, fx: 40, fy: 25 };
    const out = renderPage(BODY, { fields: { 'impact.stories': [{ quote: 'New first.', name: 'Sara', role: '', caption: '', image: photo }, first, { quote: 'No photo.', name: 'Ali', role: '', caption: 'Bootcamp, 2022' }] } });
    const s = slides(out);
    expect(s[0]).toContain('<img class="tm-img" src="assets/media/abc-1600.webp" srcset="assets/media/abc-800.webp 800w, assets/media/abc-1600.webp 1600w" sizes="(min-width: 1024px) 58vw, 100vw" alt="Sara &lt;speaking&gt; at a workshop" width="1600" height="1067" loading="lazy" decoding="async" style="object-position:40% 25%">');
    expect(s[0]).not.toContain('class="ph ');
    expect(s[1]).toContain('<img class="tm-img" src="assets/img/hero-slide-2.webp" alt="AFCD team member smiling while working at a laptop" width="2000" height="1435" loading="lazy" decoding="async" style="object-position:50% 30%">');
    expect(s[2]).not.toContain('tm-img');
    expect(s[2]).toContain('<div class="ph is-dark absolute inset-0 rounded-none" style="--ph:#262626"><span class="ph-cap tm-cap"><b>Photo</b> · Bootcamp, 2022</span></div>');
    expect(out).not.toContain('data-sf');
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
  // the page's own photo of story 1 must exist in the site folder (review checks it)
  const sitePhoto = () => { mkdirSync(join(h.siteRoot, 'assets/img'), { recursive: true }); writeFileSync(join(h.siteRoot, 'assets/img/hero-slide-2.webp'), 'x'); };
  const real = (n: number) => Array.from({ length: n }, (_x, i) => ({ quote: `Real quote ${i + 1}`, name: `Person ${i + 1}`, role: 'Programme · 2024', caption: '' }));

  it('refuses an empty list, more than 8 stories, missing quotes or names, and markup', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.put('/home', { 'impact.stories': [] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': real(9) })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: '', name: 'A', role: '', caption: '' }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: 'Q', name: '', role: '', caption: '' }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: '<b>Q</b>', name: 'A', role: '', caption: '' }] })).status).toBe(422);
    expect((await ed.put('/home', { 'impact.stories': [{ quote: 'Q', name: 'A', role: '', caption: '', extra: 1 }] })).status).toBe(422);
    // a photo is a Media Library item or the page's own file under assets/img/, never any address
    const story = (image: unknown) => ({ 'impact.stories': [{ quote: 'Q', name: 'A', role: '', caption: '', image }] });
    expect((await ed.put('/home', story({ src: 'https://example.org/x.jpg', alt: 'A', w: 1, h: 1, fx: 50, fy: 50 }))).status).toBe(422);
    expect((await ed.put('/home', story({ src: 'assets/img/x.webp', alt: '', w: 1, h: 1, fx: 50, fy: 50 }))).status).toBe(422);
    expect((await ed.put('/home', story({ mediaId: 'not-a-uuid' }))).status).toBe(422);
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
    sitePhoto();
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

describe('participant stories: photos from the Media Library', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => { await h?.close(); });
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), SOURCE);
    mkdirSync(join(h.siteRoot, 'assets/img'), { recursive: true }); writeFileSync(join(h.siteRoot, 'assets/img/hero-slide-2.webp'), 'x');
  });

  it('needs alt text and confirmed rights before review, then publishes the photo with its alt text and focal point', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#557755' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new File([new Uint8Array(png)], 'story.png'));
    const up = await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } });
    expect(up.status).toBe(201);
    const id = ((await up.json()) as { id: string }).id;
    const f = (await ed.get('/home')).body.fields.find((x: any) => x.key === 'impact.stories');
    const list = [{ quote: 'With a photo.', name: 'Sara El Amrani', role: '', caption: '', image: { mediaId: id } }, f.default[0]];
    expect((await ed.put('/home', { 'impact.stories': list })).status).toBe(200);
    const home = (await ed.get('/home')).body;
    expect(home.media.map((m: any) => m.id)).toContain(id);   // the editor can show the thumbnail
    expect(home.problems.join(' ')).toMatch(/Add alt text/);
    expect(home.problems.join(' ')).toMatch(/Confirm usage rights/);
    expect((await ed.post('/home/transition', { action: 'submit' })).status).toBe(422);

    await h.db.update(media).set({ alt: 'Sara speaking at a workshop', rightsConfirmed: true, focalX: 40, focalY: 25 });
    expect((await ed.post('/home/transition', { action: 'submit' })).status).toBe(200);
    expect((await rev.post('/home/transition', { action: 'approve' })).status).toBe(200);
    expect((await admin.post('/home/publish')).status).toBe(200);
    const entry = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8')).pages['index.html'];
    const img = entry.fields['impact.stories'][0].image;
    expect(img).toMatchObject({ alt: 'Sara speaking at a workshop', fx: 40, fy: 25 });
    expect(img.src).toMatch(/^assets\/media\//);
    const s = slides(renderPage(BODY, entry));
    expect(s[0]).toContain(`<img class="tm-img" src="${img.src}"`);
    expect(s[0]).toContain('alt="Sara speaking at a workshop"');
    expect(s[0]).toContain('style="object-position:40% 25%"');
    expect(s[1]).toContain('src="assets/img/hero-slide-2.webp"');
  });
});
