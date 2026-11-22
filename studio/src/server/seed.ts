// Idempotent import of the existing public content into AFCD Studio.
// Source of truth for the import is the live site itself: src/content.py (pillars, objectives) and src/data/projects.json (projects).
// Running it again never duplicates records: pillars by key, objectives by ref, projects by slug.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DB } from './db/client.ts';
import type { Config } from './config.ts';
import { pillars, objectives, objectivePillars, projects, projectPillars, projectObjectives, projectRevisions, articles, articlePillars, articleRevisions } from './db/schema.ts';
import { loadArticle, toArticleSnapshot } from './modules/news/service.ts';
import { loadProject, toSnapshot } from './modules/projects/service.ts';
import { audit } from './audit.ts';
import { importPartners } from './modules/partners/import.ts';
import { importPillars } from './modules/pillars/service.ts';

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

type SiteData = {
  news?: { pillar: string; date: string; title: string; excerpt: string; type: string }[];
  pillars: { key: string; number: string; name: string; description: string; colour: string; file: string }[];
  objectives: { ref: string; title: string; description: string; pillars: string[] }[];
};

/** Reads canonical pillar and objective records from the generator, so the Studio never re-types official text. */
export function readSiteStrategy(cfg: Config): SiteData {
  const py = `
import sys, json; sys.path.insert(0, 'src'); import content as c
print(json.dumps({
  'pillars': [dict(key=k, number=n, name=t, description=d, colour=c.PILLAR_TONE[k], file=c.PILLAR_FILE[k]) for k, n, t, d, _r in c.PILLARS],
  'objectives': [dict(ref=r, title=t, description=d, pillars=[s for _n, s in l]) for r, t, d, l in c.OBJECTIVES],
  'news': [dict(pillar=n[0], date=n[1], title=n[3], excerpt=n[4], type=c.NEWS_TYPES[i]) for i, n in enumerate(c.NEWS)],
}))`;
  return JSON.parse(execFileSync('python3', ['-I', '-c', py], { cwd: cfg.siteRoot, encoding: 'utf8' }));
}

export async function seed(db: DB, cfg: Config, opts: { strategy?: SiteData; projectsFile?: string; partners?: { scope: string; names: string[] }[]; pillarContent?: Parameters<typeof importPillars>[3] } = {}) {
  const site = opts.strategy ?? readSiteStrategy(cfg);
  const report = { pillars: 0, objectives: 0, projects: 0, skipped: 0 };

  for (const [i, p] of site.pillars.entries()) {
    const r = await db.insert(pillars).values({ key: p.key, number: p.number, name: p.name, description: p.description, colour: p.colour, publicFile: p.file, sort: i })
      .onConflictDoNothing().returning();
    report.pillars += r.length;
  }
  const pl = await db.select().from(pillars);
  for (const [i, o] of site.objectives.entries()) {
    const [row] = await db.insert(objectives).values({ ref: o.ref, title: o.title, description: o.description, sort: i }).onConflictDoNothing().returning();
    if (!row) continue;
    report.objectives++;
    const links = pl.filter((x) => o.pillars.includes(x.key));
    if (links.length) await db.insert(objectivePillars).values(links.map((x) => ({ objectiveId: row.id, pillarId: x.id })));
  }

  const file = opts.projectsFile ?? resolve(cfg.siteRoot, 'src/data/projects.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as { projects: Array<Record<string, any>> };
  const objs = await db.select().from(objectives);
  for (const [i, src] of data.projects.entries()) {
    const exists = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, src.slug));
    if (exists.length) { report.skipped++; continue; }
    const d = (src.detail ?? {}) as { lede?: string; facts?: [string, string][]; rows?: [string, string][]; photo?: string; objectives?: string[] };
    const fact = (k: string) => unescape(d.facts?.find((f) => f[0] === k)?.[1] ?? '');
    const row = (k: string) => unescape(d.rows?.find((r) => r[0] === k)?.[1] ?? '');
    await db.transaction(async (tx) => {
      const [p] = await tx.insert(projects).values({
        slug: src.slug, name: unescape(src.name), category: unescape(src.category ?? ''), summary: unescape(src.summary || d.lede || ''),
        location: fact('Location'), years: fact('Years'),
        extraFacts: (d.facts ?? []).filter((f) => !['Pillar', 'Category', 'Location', 'Years'].includes(f[0])).map(([label, value]) => ({ label: unescape(label), value: unescape(value) })),
        context: row('Context'), approach: row('Approach'), activities: row('Activities'), results: row('Results'),
        hasDetailPage: !!(src.file && src.detail && Object.keys(src.detail).length), photoCaption: unescape(d.photo ?? ''),
        sort: src.sort ?? (i + 1) * 10, status: 'published',
      }).returning();
      const keys: string[] = src.pillars ?? [src.pillar];
      for (const k of keys) {
        const pillar = pl.find((x) => x.key === k);
        if (pillar) await tx.insert(projectPillars).values({ projectId: p.id, pillarId: pillar.id, isPrimary: k === src.pillar });
      }
      for (const ref of d.objectives ?? []) {
        const o = objs.find((x) => x.ref === ref);
        if (o) await tx.insert(projectObjectives).values({ projectId: p.id, objectiveId: o.id });
      }
      // The imported state is what is live today: record it as revision 1 and mark it published.
      const snap = toSnapshot(await loadProject(tx as unknown as DB, p.id));
      const [rev] = await tx.insert(projectRevisions).values({ projectId: p.id, number: 1, snapshot: snap as unknown as Record<string, unknown>, reason: 'imported' }).returning();
      await tx.update(projects).set({ publishedRevisionId: rev.id, publishedAt: new Date() }).where(eq(projects.id, p.id));
      await audit(tx, null, 'project.import', { type: 'project', id: p.id }, `Imported “${p.name}” from the current website`);
    });
    report.projects++;
  }
  // Legacy stories: they live on the old blog, so they are imported as published links (no body text here).
  const TYPE_KEY: Record<string, 'participant_story' | 'call_for_applications' | 'programme_news'> = { 'Participant story': 'participant_story', 'Call for applications': 'call_for_applications', 'Programme news': 'programme_news' };
  (report as Record<string, number>).news = 0;
  for (const [i, n] of (site.news ?? []).entries()) {
    const slug = n.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    if ((await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, slug))).length) continue;
    const pillar = pl.find((x) => x.name === unescape(n.pillar));
    await db.transaction(async (tx) => {
      const [a] = await tx.insert(articles).values({ slug, title: unescape(n.title), excerpt: unescape(n.excerpt), type: TYPE_KEY[n.type] ?? 'programme_news', publishDate: n.date, featured: i === 0, externalUrl: 'https://afcdfoundation.org/blog/', status: 'published' }).returning();
      if (pillar) await tx.insert(articlePillars).values({ articleId: a.id, pillarId: pillar.id, isPrimary: true });
      const snap = toArticleSnapshot(await loadArticle(tx as unknown as DB, a.id));
      const [rev] = await tx.insert(articleRevisions).values({ articleId: a.id, number: 1, snapshot: snap as unknown as Record<string, unknown>, reason: 'imported' }).returning();
      await tx.update(articles).set({ publishedRevisionId: rev.id, publishedAt: new Date() }).where(eq(articles.id, a.id));
      await audit(tx, null, 'news.import', { type: 'article', id: a.id }, `Imported story “${a.title}” (links to the old blog)`);
    });
    (report as Record<string, number>).news++;
  }
  (report as Record<string, number>).partners = (await importPartners(db, cfg, null, opts.partners ?? (opts.strategy ? [] : undefined))).imported;   // with injected strategy data (tests) the site is not read
  (report as Record<string, number>).pillarContent = (await importPillars(db, cfg, null, opts.pillarContent ?? (opts.strategy ? [] : undefined))).imported;   // tests inject it or skip it
  return report;
}
