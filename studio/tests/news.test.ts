import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { articleBody } from '../src/server/modules/news/render.ts';
import { articles, publishJobs } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const BODY = 'Twenty young people met in Ait Ourir for three days of workshops on climate action and local leadership.\n\n## What happened\n\nThey mapped waste points, interviewed residents and drafted **three proposals** for the commune.\n\n> We learned that change starts with listening.\n\n- Mapping\n- Interviews\n- Proposals';
const story = (over: Record<string, unknown> = {}) => ({
  title: 'Climate camp in Ait Ourir', slug: 'climate-camp', excerpt: 'Three days of workshops on climate action.', body: BODY, type: 'event_recap',
  tags: ['Climate', 'Youth'], authorName: 'AFCD team', authorRole: '', publishDate: '2026-11-20', featured: false, externalUrl: '',
  heroMediaId: null, galleryMediaIds: [], pillarKeys: ['green-thumbs'], projectSlugs: ['eco-citizen'], seoTitle: '', seoDescription: '', ...over,
});

describe('article body format', () => {
  it('supports subheadings, quotes and lists and escapes everything else', () => {
    const html = articleBody(BODY + '\n\n<script>alert(1)</script> [bad](javascript:alert(1))');
    expect(html).toContain('<h2');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<ul class="list-disc');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });
});

describe('news workflow', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('writes, reviews, publishes, refreshes the listing and removes a story', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { status, body: a } = await ed.post('/news', story());
    expect(status).toBe(201);
    expect((await ed.post(`/news/${a.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await rev.post(`/news/${a.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`/news/${a.id}/publish`)).status).toBe(403);
    const pub = await admin.post(`/news/${a.id}/publish`);
    expect(pub.status).toBe(200);
    const page = readFileSync(join(h.siteRoot, 'news-climate-camp.html'), 'utf8');
    expect(page).toContain(`data-studio-article-rev="${pub.body.revisionId}"`);
    expect(page).toContain('Eco Citizen');                                     // related project card
    expect(page).toContain('<a href="news.html">News &amp; Stories</a>');                // breadcrumb
    expect(readFileSync(join(h.siteRoot, 'news.html'), 'utf8')).toContain('news-climate-camp.html');
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/news.json'), 'utf8'));
    expect(data.articles[0]).toMatchObject({ slug: 'climate-camp', type: 'Event recap', pillar: 'Environment and Climate' });

    expect((await admin.post(`/news/${a.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'news-climate-camp.html'))).toBe(false);
  });

  it('escapes titles and blocks markup in plain fields', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.post('/news', story({ title: 'Bad <script>' }))).status).toBe(422);
    expect((await ed.post('/news', story({ externalUrl: 'javascript:alert(1)' }))).status).toBe(422);
  });

  it('refuses to submit a story that is too short or has no pillar', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { body: a } = await ed.post('/news', story({ body: 'Too short.', pillarKeys: [] }));
    const r = await ed.post(`/news/${a.id}/transition`, { action: 'submit' });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body.details)).toMatch(/at least 30 words/);
    expect(JSON.stringify(r.body.details)).toMatch(/pillar/);
  });

  it('schedules a story and the scheduler publishes it when due', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: a } = await ed.post('/news', story({ slug: 'later' }));
    await ed.post(`/news/${a.id}/transition`, { action: 'submit' });
    await rev.post(`/news/${a.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/news/${a.id}/transition`, { action: 'schedule', at: new Date(Date.now() - 1000).toISOString() })).status).toBe(422);
    expect((await ed.post(`/news/${a.id}/transition`, { action: 'schedule', at: new Date(Date.now() + 3600e3).toISOString() })).status).toBe(403);
    expect((await admin.post(`/news/${a.id}/transition`, { action: 'schedule', at: new Date(Date.now() + 3600e3).toISOString() })).body.status).toBe('scheduled');
    expect((await ed.put(`/news/${a.id}`, story({ slug: 'later' }))).status).toBe(409);       // locked while scheduled

    const { createApp } = await import('../src/server/app.ts');
    const pub = createApp(h.db, h.cfg, { runner: (await import('./helpers.ts')).fakeRunner() }).publisher;
    expect(await pub.runScheduled(new Date())).toEqual([]);                                    // not due yet
    const res = await pub.runScheduled(new Date(Date.now() + 2 * 3600e3));
    expect(res).toEqual([{ id: a.id, ok: true }]);
    const [row] = await h.db.select().from(articles).where(eq(articles.id, a.id));
    expect(row.status).toBe('published'); expect(row.scheduledAt).toBeNull();
    expect(existsSync(join(h.siteRoot, 'news-later.html'))).toBe(true);
    const jobs = await h.db.select().from(publishJobs).where(eq(publishJobs.entityId, a.id));
    expect(jobs[0].kind).toBe('publish_article_scheduled');
  });
});
