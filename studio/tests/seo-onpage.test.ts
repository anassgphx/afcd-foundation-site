// On-page SEO checklist (modules/seo/onpage.ts): keyphrase matching, robots.txt, readability, the checks on built
// pages, the score and its cap, and the API (focus keyphrase, manual reviews that reopen when the page text changes).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { flesch, match, norm, robotsAccess, pageChecklist, MANUAL, GROUPS } from '../src/server/modules/seo/onpage.ts';
import { runBuildAudit, RULES } from '../src/server/modules/seo/engine.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const words = (n: number, w = 'community') => Array.from({ length: n }, (_, i) => (i % 9 === 8 ? `${w}.` : w)).join(' ');
const page = (file: string, o: { title: string; desc: string; h1: string; body: string; head?: string }) =>
  `<!doctype html><html lang="en"><head><title>${o.title}</title><meta name="description" content="${o.desc}"><meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<link rel="canonical" href="https://afcdfoundation.com/${file === 'index.html' ? '' : file}"><meta name="robots" content="index, follow">` +
  `<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i">${o.head ?? ''}</head>` +
  `<body><header><a href="index.html">Home</a><a href="youth.html">Youth</a></header><main><h1>${o.h1}</h1>${o.body}</main></body></html>`;

function site(root: string, robots = 'User-agent: *\nAllow: /\n') {
  writeFileSync(join(root, 'robots.txt'), robots);
  writeFileSync(join(root, 'sitemap.xml'), '<urlset><url><loc>https://afcdfoundation.com/</loc></url><url><loc>https://afcdfoundation.com/youth.html</loc></url><url><loc>https://afcdfoundation.com/news-the-2024-call-for-young-leaders.html</loc></url></urlset>');
  writeFileSync(join(root, 'index.html'), page('index.html', { title: 'AFCD Foundation · Community development in Morocco', desc: 'AFCD Foundation supports young people, women and communities in Morocco through training, projects and partnerships.', h1: 'Community development in Morocco',
    body: `<p>AFCD works for community development in Morocco with young people and women. ${words(320)}</p><h2>Our pillars</h2><p>${words(60)}</p><h2>Our projects</h2><p><a href="youth.html">Youth leadership programme</a></p>`,
    head: '<script type="application/ld+json">{"@type":"NGO"}</script>' }));
  writeFileSync(join(root, 'youth.html'), page('youth.html', { title: 'Youth leadership programme · AFCD Foundation', desc: 'Short.', h1: 'Youth leadership programme',
    body: `<p>${words(40)}</p><p><a href="index.html">click here</a></p><img src="assets/x.jpg" alt="Young people at a workshop" width="10" height="10">`, head: '<script src="assets/app.js"></script>' }));
  writeFileSync(join(root, 'news-the-2024-call-for-young-leaders.html'), page('news-the-2024-call-for-young-leaders.html', { title: 'The 2024 call for young leaders · News · AFCD Foundation', desc: 'A call for applications for young leaders in Ait Ourir, open to people aged 18 to 30 who want to lead local projects.', h1: 'The 2024 call for young leaders',
    body: `<p>${words(80)}</p><p><a href="index.html">AFCD Foundation homepage</a></p>` }));
}

describe('on-page helpers', () => {
  it('matches a keyphrase as a phrase, by its words, or not at all (accents and punctuation ignored)', () => {
    expect(norm('Women’s Empowerment — Aït Ourir')).toBe('women s empowerment ait ourir');
    expect(match('Training for youth leadership in Morocco', 'youth leadership')).toBe('full');
    expect(match('Leadership training for youth', 'youth leadership')).toBe('partial');
    expect(match('Leadership training', 'youth leadership')).toBe('none');
    expect(match('Mission, Vision & Values · AFCD Foundation', 'mission, vision and values')).toBe('full');   // “&” is “and”
    expect(match('Youth Empowerment & Civic Engagement', 'youth empowerment and civic engagement')).toBe('full');
  });

  it('reads robots.txt like search engines: the specific group wins over *', () => {
    const r = robotsAccess('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nUser-agent: OAI-SearchBot\nDisallow: /\n', ['Googlebot', 'OAI-SearchBot', 'PerplexityBot']);
    expect(r).toEqual({ Googlebot: true, 'OAI-SearchBot': false, PerplexityBot: true });
    expect(robotsAccess('User-agent: *\nDisallow: /\n', ['Googlebot']).Googlebot).toBe(false);
    expect(robotsAccess('', ['Googlebot']).Googlebot).toBe(true);
  });

  it('scores readability between 0 and 100, and only with enough text', () => {
    const easy = flesch(Array(12).fill('The cat sat on the mat. We went out to play in the park.').join(' '))!;
    const hard = flesch(Array(8).fill('Institutional capacity strengthening necessitates comprehensive multidimensional organizational transformation initiatives encompassing governance and accountability.').join(' '))!;
    expect(easy).toBeGreaterThan(80); expect(hard).toBeLessThan(20); expect(hard).toBeGreaterThanOrEqual(0);
    expect(flesch('Too short.')).toBeNull();
  });
});

describe('on-page checklist of a built page', () => {
  const dir = join(process.env.TMPDIR ?? '/tmp', `seo-onpage-${Date.now()}`);
  const ctx = (robots?: string) => { site(dir, robots); const a = runBuildAudit(dir); return { audit: a, root: dir, robots: robots ?? 'User-agent: *\nAllow: /\n', focusOf: new Map<string, string[]>(), reviewers: new Map<string, string>() }; };
  beforeEach(async () => { const { mkdirSync, rmSync } = await import('node:fs'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); });
  const by = (r: ReturnType<typeof pageChecklist>) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

  it('covers every page-level audit rule and every group of the checklist', () => {
    const c = ctx(); const p = c.audit.pages.find((x) => x.file === 'youth.html')!;
    const r = pageChecklist(c, p, { keyphrase: 'youth leadership', intent: '', manual: {} });
    expect(new Set(r.checks.map((x) => x.group))).toEqual(new Set(GROUPS.map(([g]) => g)));
    const covered = new Set(r.checks.flatMap((x) => x.codes ?? []));
    const pageRules = Object.keys(RULES).filter((k) => !['tech.sitemap-ghost', 'site.preview-build', 'perf.img-size', 'schema.org-missing', 'schema.article-suggest', 'tech.lang-missing'].includes(k));
    // rules that apply to this page are all mapped to a check (image size and some schema rules only appear on pages that have them)
    expect(pageRules.filter((k) => !covered.has(k))).toEqual([]);
  });

  it('runs keyword checks only with a keyphrase, and finds it in the title, H1, text and address', () => {
    const c = ctx(); const p = c.audit.pages.find((x) => x.file === 'index.html')!;
    const none = by(pageChecklist(c, p, { keyphrase: '', intent: '', manual: {} }));
    expect(none['kw.set'].status).toBe('fail'); expect(none['title.kw'].status).toBe('na');
    const r = pageChecklist(c, p, { keyphrase: 'community development in Morocco', intent: 'informational', manual: {} }); const x = by(r);
    expect(x['title.kw'].status).toBe('pass'); expect(x['h1.kw'].status).toBe('pass'); expect(x['body.first'].status).toBe('pass');
    expect(x['body.count'].status).toBe('pass'); expect(x['meta.kw'].status).toBe('warn');   // words present, not the phrase
    expect(x['sc.type'].status).toBe('pass');   // NGO markup on the homepage
    expect(r.cap).toBeNull();
  });

  it('flags the problems a person would fix: short description, vague link text, old image format, blocking script, long dated address', () => {
    const c = ctx();
    const y = by(pageChecklist(c, c.audit.pages.find((x) => x.file === 'youth.html')!, { keyphrase: 'youth leadership', intent: '', manual: {} }));
    expect(y['meta.length'].status).toBe('warn'); expect(y['l.anchors'].detail).toContain('click here');
    expect(y['i.format'].status).toBe('warn'); expect(y['sp.blocking'].status).toBe('warn'); expect(y['m.viewport'].status).toBe('pass');
    const n = by(pageChecklist(c, c.audit.pages.find((x) => x.file.startsWith('news-'))!, { keyphrase: '', intent: '', manual: {} }));
    expect(n['url.date'].status).toBe('warn'); expect(n['url.filler'].detail).toContain('the'); expect(n['url.length'].status).toBe('warn');   // 7 words
  });

  it('caps the content score when the page never uses its keyphrase, and says why', () => {
    const c = ctx(); const p = c.audit.pages.find((x) => x.file === 'index.html')!;
    const r = pageChecklist(c, p, { keyphrase: 'climate action Marrakech', intent: '', manual: {} });
    expect(r.scores.content).toBeLessThanOrEqual(40); expect(r.cap).toMatch(/not optimised/);
    expect(r.score).toBe(Math.round((r.scores.content! + r.scores.technical!) / 2));
  });

  it('reports AI crawlers blocked by robots.txt, and search engines blocked as a failure', () => {
    const c = ctx('User-agent: *\nAllow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n');
    const x = by(pageChecklist(c, c.audit.pages.find((p) => p.file === 'index.html')!, { keyphrase: '', intent: '', manual: {} }));
    expect(x['c.ai'].status).toBe('warn'); expect(x['c.ai'].detail).toContain('PerplexityBot'); expect(x['c.robots'].status).toBe('pass');
  });
});

describe('on-page API', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'seo@afcd.test', 'seo_manager'); await addUser(h.db, 'viewer@afcd.test', 'content_reviewer'); site(h.siteRoot); });

  it('lists every page, saves a focus keyphrase, warns about competing pages, and records manual reviews', async () => {
    const seo = await client(h.app, 'seo@afcd.test'), viewer = await client(h.app, 'viewer@afcd.test');
    const list = (await seo.get('/seo/onpage')).body;
    expect(list.pages.map((p: any) => p.file)).toEqual(expect.arrayContaining(['index.html', 'youth.html']));
    expect(list.summary.withKeyphrase).toBe(0);
    expect((await seo.put('/seo/onpage/index.html', { keyphrase: '<b>x</b>' })).status).toBe(422);
    expect((await seo.put('/seo/onpage/missing.html', { keyphrase: 'x' })).status).toBe(404);
    expect((await viewer.put('/seo/onpage/index.html', { keyphrase: 'x' })).status).toBe(403);
    const v = (await seo.put('/seo/onpage/index.html', { keyphrase: 'community development in Morocco', intent: 'informational' })).body;
    expect(v.keyphrase).toBe('community development in Morocco'); expect(v.checks.find((c: any) => c.id === 'title.kw').status).toBe('pass');
    const y = (await seo.put('/seo/onpage/youth.html', { keyphrase: 'Community development in Morocco' })).body;
    expect(y.checks.find((c: any) => c.id === 'kw.unique').detail).toContain('index.html');
    expect((await seo.get('/seo/onpage')).body.summary.withKeyphrase).toBe(2);

    // manual review: ticked with the reviewer's name, reopened when the page text changes
    const r = (await seo.post('/seo/onpage/index.html/review', { id: MANUAL[1].id, done: true })).body;
    const done = r.checks.find((c: any) => c.id === MANUAL[1].id);
    expect(done.status).toBe('done'); expect(done.reviewedBy).toBeTruthy();
    expect((await seo.post('/seo/onpage/index.html/review', { id: 'manual.nope', done: true })).status).toBe(422);
    writeFileSync(join(h.siteRoot, 'index.html'), page('index.html', { title: 'AFCD Foundation · Community development in Morocco', desc: 'x'.repeat(90), h1: 'Community development in Morocco', body: `<p>New text about community development in Morocco. ${words(150)}</p>` }));
    const again = (await seo.get('/seo/onpage/index.html')).body.checks.find((c: any) => c.id === MANUAL[1].id);
    expect(again.status).toBe('todo'); expect(again.changed).toBe(true);
  });
});
