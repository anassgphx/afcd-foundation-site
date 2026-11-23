import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client, pngBytes, ORIGIN } from './helpers.ts';
import { articleBody, bodyMediaIds, type BodyMedia } from '../src/server/modules/news/render.ts';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const ref = (id: string) => ({ src: `assets/media/${id}-960.webp`, srcset: `assets/media/${id}-960.webp 960w`, w: 960, h: 640, alt: `Alt ${id.slice(0, 4)}`, fx: 30, fy: 70, caption: 'Saved caption', credit: 'Test credit' });
const mediaOf: BodyMedia = (id) => ([A, B, C].includes(id) ? ref(id) : null);

describe('photos inside the story text', () => {
  it('renders one photo per line with its size, caption and credit', () => {
    const html = articleBody(`Intro paragraph.\n\n![Our <b>team</b>](media:${A} "left")\n\nMore text.`, mediaOf);
    expect(html).toContain('<figure class="st-fig st-left">');
    expect(html).toContain('alt="Alt 1111"');
    expect(html).toContain('object-position:30% 70%');
    expect(html).toContain('Our &lt;b&gt;team&lt;/b&gt; <span>Photo: Test credit</span>');
    expect(html.indexOf('Intro')).toBeLessThan(html.indexOf('st-fig'));
    expect(html.indexOf('st-fig')).toBeLessThan(html.indexOf('More text'));
  });

  it('uses the library caption when none is written, and full width by default', () => {
    const html = articleBody(`![](media:${A})`, mediaOf);
    expect(html).toContain('st-fig st-full');
    expect(html).toContain('<figcaption>Saved caption <span>Photo: Test credit</span></figcaption>');
  });

  it('puts two or three photos on one line side by side', () => {
    expect(articleBody(`![](media:${A}) ![](media:${B})`, mediaOf)).toContain('<div class="st-row st-n2">');
    expect(articleBody(`![](media:${A}) ![](media:${B}) ![](media:${C})`, mediaOf)).toContain('<div class="st-row st-n3">');
  });

  it('separates photo lines from text even without blank lines, and drops stray or unknown tokens', () => {
    const html = articleBody(`Line one\n![x](media:${A})\nLine two with ![y](media:${B}) inside\n\n![z](media:44444444-4444-4444-8444-444444444444)`, mediaOf);
    expect(html.match(/<figure/g)?.length).toBe(1);
    expect(html).toContain('Line two with  inside'.replace('  ', ' ').slice(0, 13));
    expect(html).not.toContain('media:');
    expect(articleBody(`![x](media:${A})`)).toBe('');           // other modules (events, opportunities) show no photos
  });

  it('lists the photos a story uses', () => {
    expect(bodyMediaIds(`![](media:${A}) ![](media:${B})\n\n![](media:${A} "center")`)).toEqual([A, B]);
  });
});

describe('stories with photos in the text', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  afterEach(async () => { await h?.close(); });
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'admin@afcd.test', 'website_admin'); });

  it('checks the photos before review and copies them when publishing', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const fd = new FormData(); fd.append('file', new File([new Uint8Array(await pngBytes())], 'test-inline.png'));
    const img = await (await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } })).json();
    const words = 'Twenty young people met for three days of workshops on climate action and local leadership in their commune, mapping waste points and interviewing residents about change.';
    const body = `${words}\n\n![Workshop day](media:${img.id} "center")\n\n${words}`;
    const base = { title: 'Photo story', slug: 'photo-story', excerpt: 'A test story with a photo.', body, type: 'event_recap', tags: [], authorName: '', authorRole: '', publishDate: '2026-11-20', featured: false, externalUrl: '', heroMediaId: null, galleryMediaIds: [], pillarKeys: ['green-thumbs'], projectSlugs: [], seoTitle: '', seoDescription: '' };

    expect((await ed.post('/news', { ...base, body: `![](media:${'5'.repeat(8)}-5555-4555-8555-555555555555)` })).status).toBe(422);   // not in the library
    const { body: a } = await ed.post('/news', base);
    const got = (await ed.get(`/news/${a.id}`)).body;
    expect(got.media.map((m: { id: string }) => m.id)).toContain(img.id);
    expect(got.problems.join(' ')).toMatch(/alt text to “test-inline\.png”/);

    await ed.raw('PATCH', `/media/${img.id}`, { alt: 'Test image', rightsConfirmed: true });
    expect((await ed.get(`/news/${a.id}`)).body.problems).toEqual([]);
    const lib = (await ed.get('/media/library')).body.items.find((m: { id: string }) => m.id === img.id);
    expect(lib.usedOn).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'Story', where: 'In the story text' })]));

    await ed.post(`/news/${a.id}/transition`, { action: 'submit' });
    await admin.post(`/news/${a.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/news/${a.id}/publish`)).status).toBe(200);
    const page = readFileSync(join(h.siteRoot, 'news-photo-story.html'), 'utf8');
    expect(page).toContain('st-fig st-center');
    expect(page).toContain('Workshop day');
    expect(existsSync(join(h.siteRoot, 'assets/media', `${img.storageKey}-480.webp`))).toBe(true);
    expect((await ed.raw('DELETE', `/media/${img.id}`)).status).not.toBe(200);     // in use: cannot be deleted
  });
});
