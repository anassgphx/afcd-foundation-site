// Test harness: in-memory PostgreSQL (PGlite), a temporary site folder and a fake build runner.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../src/server/config.ts';
import { openDb } from '../src/server/db/client.ts';
import { createApp } from '../src/server/app.ts';
import { users } from '../src/server/db/schema.ts';
import { hashPassword } from '../src/server/auth/session.ts';
import { seed } from '../src/server/seed.ts';
import type { BuildRunner } from '../src/server/modules/publish/service.ts';
import type { Role } from '../src/server/rbac.ts';

export const ORIGIN = 'http://localhost:4400';
export const PW = 'correct horse battery staple';

export const STRATEGY = {
  pillars: [
    { key: 'youth-empowerment', number: '01', name: 'Youth Empowerment', description: 'Youth', colour: '#FFB2B9', file: 'youth-empowerment.html' },
    { key: 'green-thumbs', number: '03', name: 'Environment and Climate', description: 'Env', colour: '#82E591', file: 'environment-climate.html' },
  ],
  objectives: [
    { ref: 'SO-01', title: 'Youth leadership', description: 'd', pillars: ['youth-empowerment'] },
    { ref: 'SO-03', title: 'Climate action', description: 'd', pillars: ['green-thumbs'] },
  ],
};

/** Fake of content.py + build.mjs: writes projects.html and one page per project from the exported JSON. */
export function fakeRunner(opts: { fail?: () => boolean } = {}): BuildRunner {
  return async (cfg, mode) => {
    if (opts.fail?.()) throw new Error('build exploded');
    const dataFile = mode.kind === 'live' ? resolve(cfg.siteRoot, 'src/data/projects.json') : mode.dataFile;
    const out = mode.kind === 'live' ? cfg.siteRoot : mode.outDir;
    const data = JSON.parse(readFileSync(dataFile, 'utf8')) as { projects: any[] };
    writeFileSync(join(out, 'projects.html'), data.projects.map((p) => `<li>${p.name}</li>`).join('\n'));
    const newsFile = mode.kind === 'live' ? join(cfg.siteRoot, 'src/data/news.json') : mode.newsFile;
    if (newsFile && existsSync(newsFile)) writeFileSync(join(out, 'news.html'), (JSON.parse(readFileSync(newsFile, 'utf8')).articles as any[]).map((a) => `<li><a href="${a.url}">${a.title}</a></li>`).join('\n'));
    const partnersFile = mode.kind === 'live' ? join(cfg.siteRoot, 'src/data/partners.json') : mode.partnersFile;
    if (partnersFile && existsSync(partnersFile)) writeFileSync(join(out, 'partners.html'), (JSON.parse(readFileSync(partnersFile, 'utf8')).partners as any[]).map((p) => `<li data-studio-partner-rev="${p.revision}"><span>${p.name}</span></li>`).join('\n'));
    // Stand-in for content.py's pillar pages (src/data/pillars.json): hub + one page per pillar with its escaped texts.
    const pillarsFile = mode.kind === 'live' ? join(cfg.siteRoot, 'src/data/pillars.json') : mode.pillarsFile;
    if (pillarsFile && existsSync(pillarsFile)) {
      const pls = JSON.parse(readFileSync(pillarsFile, 'utf8')).pillars as any[];
      writeFileSync(join(out, 'pillars.html'), pls.map((p) => `<li style="--c:${p.colour}"><a href="${p.file}">${p.name}</a><p>${p.summary}</p></li>`).join('\n'));
      for (const p of pls) writeFileSync(join(out, p.file), `<h1>${p.name}</h1><p>${p.summary}</p><p>${p.intro}</p>${p.image ? `<img src="${p.image.src}">` : ''}`);
    }
    // Stand-in for the events templates: listing + one page per event with the revision marker.
    const eventsFile = mode.kind === 'live' ? join(cfg.siteRoot, 'src/data/events.json') : mode.eventsFile;
    if (eventsFile && existsSync(eventsFile)) {
      const evs = JSON.parse(readFileSync(eventsFile, 'utf8')).events as any[];
      writeFileSync(join(out, 'events.html'), evs.map((e) => `<li data-when="${e.upcoming ? 'upcoming' : 'past'}"><a class="ev-link">${e.title}</a></li>`).join('\n'));
      for (const e of evs) writeFileSync(join(out, `event-${e.slug}.html`), `<section id="event" data-studio-event-rev="${e.revision}"><h1>${e.title}</h1>${e.bodyHtml}</section>`);
    }
    // Stand-in for build.mjs: every page source becomes a root page and a sitemap entry.
    const pagesDir = mode.kind === 'live' ? join(cfg.siteRoot, 'src/pages') : mode.pagesDir;
    const files = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith('.html')) : [];
    for (const f of files) writeFileSync(join(out, f), readFileSync(join(pagesDir, f), 'utf8').replace(/^---[\s\S]*?---\n/, ''));
    // Stand-in for build.mjs's page fields (src/data/page-fields.json): revision marker on each page it lists, markers removed.
    const fieldsFile = mode.kind === 'live' ? join(cfg.siteRoot, 'src/data/page-fields.json') : mode.fieldsFile;
    const fieldPages = fieldsFile && existsSync(fieldsFile) ? JSON.parse(readFileSync(fieldsFile, 'utf8')).pages ?? {} : {};
    for (const file of ['index.html', 'contact.html']) {
      if (!existsSync(join(out, file))) continue;
      let html = readFileSync(join(out, file), 'utf8').replace(/\sdata-sf(?:-type)?="[^"]*"/g, '');
      const f = fieldPages[file];
      if (f) html = `<meta name="studio-fields-rev" content="${f.revision}">` + (file === 'index.html' ? html.replace('>Old title<', `>${f.fields['hero.1.kicker'] ?? 'Old title'}<`) : html);
      writeFileSync(join(out, file), html);
    }
    // Stand-in for build.mjs's SEO overrides (src/data/seo.json): title and revision marker.
    const seoFile = join(cfg.siteRoot, 'src/data/seo.json');
    if (mode.kind === 'live' && existsSync(seoFile)) {
      const seo = JSON.parse(readFileSync(seoFile, 'utf8')).pages as Record<string, { title?: string; revision: string }>;
      for (const [f, o] of Object.entries(seo)) if (existsSync(join(out, f))) writeFileSync(join(out, f), `<title>${o.title ?? ''}</title><meta name="studio-seo-rev" content="${o.revision}">` + readFileSync(join(out, f), 'utf8'));
    }
    // Stand-in for build.mjs's structured data (src/data/schema.json): revision marker on index.html, JSON-LD per page.
    const schemaFile = join(cfg.siteRoot, 'src/data/schema.json');
    if (mode.kind === 'live' && existsSync(schemaFile)) {
      const sc = JSON.parse(readFileSync(schemaFile, 'utf8')) as { revision: string; pages: Record<string, unknown[]> };
      if (existsSync(join(out, 'index.html'))) writeFileSync(join(out, 'index.html'), `<meta name="studio-schema-rev" content="${sc.revision}">` + readFileSync(join(out, 'index.html'), 'utf8'));
      for (const [f, objs] of Object.entries(sc.pages)) if (existsSync(join(out, f))) writeFileSync(join(out, f), readFileSync(join(out, f), 'utf8') + objs.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join(''));
    }
    writeFileSync(join(out, 'sitemap.xml'), `<urlset>${files.map((f) => `<loc>${f}</loc>`).join('')}</urlset>`);
    if (mode.kind === 'preview' && mode.only === 'pages') return 'fake page preview ok';
    for (const p of data.projects) if (p.file) writeFileSync(join(out, p.file), `<section data-studio-rev="${p.detail.revision}"><h1>${p.name}</h1><p>${p.detail.lede}</p></section>`);
    return 'fake build ok';
  };
}

export async function makeApp(opts: { runner?: BuildRunner; partners?: { scope: string; names: string[] }[]; googleHttp?: typeof fetch; cfg?: Partial<Parameters<typeof loadConfig>[0]> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'studio-test-'));
  const siteRoot = join(root, 'site');
  mkdirSync(join(siteRoot, 'src/data'), { recursive: true });
  mkdirSync(join(siteRoot, 'src/pages'), { recursive: true });
  mkdirSync(join(siteRoot, 'assets'), { recursive: true });
  mkdirSync(join(siteRoot, 'src/partials'), { recursive: true });
  writeFileSync(join(siteRoot, 'src/partials/head.html'), '<!doctype html>\n<html>\n<head>\n<title>{{title}}</title>\n<meta name="description" content="{{description}}">\n</head>\n');
  writeFileSync(join(siteRoot, 'src/partials/header.html'), '<header><a class="{{cur:about}}"{{aria:about}}>About</a></header>');
  writeFileSync(join(siteRoot, 'src/partials/footer.html'), '<footer></footer>');
  writeFileSync(join(siteRoot, 'src/data/projects.json'), JSON.stringify({ projects: [
    { slug: 'eco-citizen', file: 'project-eco-citizen.html', name: 'Eco Citizen', pillar: 'green-thumbs', category: 'Environment', summary: 'Awareness.',
      detail: { lede: 'Awareness.', facts: [['Pillar', 'Environment and Climate'], ['Location', 'Ait Ourir']], rows: [['Context', 'Waste.']], photo: 'Eco Citizen' } },
  ] }));
  const cfg = loadConfig({ siteRoot, dataDir: join(root, 'data'), mediaDir: join(root, 'data/media'), previewDir: join(root, 'preview'), origin: ORIGIN, secureCookies: false,
    googleClientId: '', googleClientSecret: '', encryptionKey: '', ...opts.cfg });
  const { db, close } = await openDb(cfg, { memory: true });
  await seed(db, cfg, { strategy: STRATEGY, partners: opts.partners ?? [] });
  const { app, runJobs } = createApp(db, cfg, { runner: opts.runner ?? fakeRunner(), googleHttp: opts.googleHttp });
  return { app, db, cfg, close, siteRoot, runJobs };
}

export async function addUser(db: Awaited<ReturnType<typeof makeApp>>['db'], email: string, role: Role) {
  await db.insert(users).values({ email, name: email.split('@')[0], role, passwordHash: await hashPassword(PW) });
}

/** A signed-in client: keeps the session cookie and sends the CSRF token like the admin app does. */
export async function client(app: Awaited<ReturnType<typeof makeApp>>['app'], email: string) {
  const login = await app.request('/studio/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password: PW }) });
  if (login.status !== 200) throw new Error(`login failed ${login.status}`);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const me = await (await app.request('/studio/api/me', { headers: { Cookie: cookie } })).json();
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await app.request(`/studio/api${path}`, {
      method, headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': me.csrf, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  return { cookie, csrf: me.csrf as string, get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b), put: (p: string, b: unknown) => call('PUT', p, b), raw: call };
}

export const pngBytes = () => sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 160, b: 90 } } }).png().toBuffer();

export const projectInput = (over: Record<string, unknown> = {}) => ({
  name: 'Green Schools', slug: 'green-schools', category: 'Climate Action', summary: 'Schools act on climate.',
  context: 'Schools asked for support.', approach: '', activities: 'Workshops.', results: '', location: 'Marrakech', years: '2026',
  extraFacts: [], hasDetailPage: true, photoCaption: '', heroMediaId: null, galleryMediaIds: [],
  pillarKeys: ['green-thumbs', 'youth-empowerment'], primaryPillarKey: 'green-thumbs', objectiveRefs: ['SO-03'],
  seoTitle: '', seoDescription: '', sort: 50, reference: '', ...over,
});
