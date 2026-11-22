// Page rendering: render context (live projects, media), page source for the site build, and the live editor canvas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, pillars, projects, projectRevisions } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc, renderBlocks, validateDoc, type Doc, type MediaRef, type ProjectCard, type RenderCtx } from './blocks.ts';
import { loadSources, type Pending } from './dynamic.ts';

export type PageSnapshot = { slug: string; title: string; description: string; navSection: string; noindex: boolean; doc: Doc };

/** Media ids referenced by a page document (any prop named mediaId, at any depth). */
export function docMediaIds(doc: { blocks: unknown[] }): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'mediaId' && typeof x === 'string') out.add(x); else walk(x); }
  };
  walk(doc.blocks);
  return [...out];
}

/** Everything blocks need to render: images by id and the projects that are live on the site right now. */
export async function buildCtx(db: DB, docs: { blocks: unknown[] }[], opts: { editor?: boolean; mediaPrefix?: string; projectOverride?: { projectId: string; revisionId: string | null }; pending?: Pending } = {}): Promise<Omit<RenderCtx, 'pageTitle'>> {
  const pl = await db.select().from(pillars);
  const liveProjects = await db.select({ id: projects.id, rev: projects.publishedRevisionId }).from(projects).where(isNotNull(projects.publishedRevisionId));
  const map = new Map(liveProjects.map((r) => [r.id, r.rev as string]));
  const o = opts.projectOverride;   // a project being published/unpublished right now
  if (o) { if (o.revisionId) map.set(o.projectId, o.revisionId); else map.delete(o.projectId); }
  const revs = map.size ? await db.select().from(projectRevisions).where(inArray(projectRevisions.id, [...map.values()])) : [];
  const snaps = revs.map((r) => r.snapshot as any).sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(b.name));
  const ids = [...new Set([...docs.flatMap(docMediaIds), ...snaps.map((s) => s.detail?.hero?.id).filter(Boolean)])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const byId = new Map(rows.map((m) => [m.id, publicRef(m, opts.mediaPrefix ?? 'assets/media/') as MediaRef]));
  const cards: ProjectCard[] = snaps.map((s) => {
    const p = pl.find((x) => x.key === s.pillar);
    return { name: s.name, slug: s.slug, pillar: p?.name ?? '', pillars: s.pillars ?? [s.pillar], category: s.category, summary: s.summary, file: s.file, hero: s.detail?.hero?.id ? byId.get(s.detail.hero.id) ?? null : null, colour: p?.colour ?? '#D4D4D4' };
  });
  const sources = await loadSources(db, opts.pending, opts.mediaPrefix ?? 'assets/media/');
  return { media: (id) => (id ? byId.get(id) ?? null : null), projects: cards, sources, editor: opts.editor };
}

/** Page source in the format build.mjs expects (front matter + body). Titles were validated to contain no markup. */
export function pageSource(s: PageSnapshot, ctx: Omit<RenderCtx, 'pageTitle'>, revisionId: string) {
  const line = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();
  const { doc } = validateDoc(s.doc);
  const body = renderBlocks(doc, { ...ctx, pageTitle: s.title, editor: false });
  return `---\ntitle: ${line(s.title)} · AFCD Foundation\ndescription: ${line(s.description || s.title)}\nactive: ${s.navSection}\n${s.noindex ? 'noindex: true\n' : ''}---\n<span id="top"></span>\n<div data-studio-page-rev="${revisionId}">\n${body}\n</div>\n`;
}

const NAV = ['home', 'about', 'pillars', 'projects', 'news', 'partners', 'contact', 'involved', 'none'];

/** Canvas HTML is an iframe srcdoc. <base> makes it render right, but Chrome's preloader fetches early resources
 *  against the parent page (/studio/…) before it sees <base>; absolute site paths avoid those 404s. */
export const siteUrls = (html: string) => html
  .replace(/(\s(?:src|href|poster)=["'])assets\//g, '$1/studio/site/assets/')
  .replace(/(\ssrcset=")([^"]*)"/g, (_m, a: string, v: string) => `${a}${v.replace(/(^|,\s*)assets\//g, '$1/studio/site/assets/')}"`)
  .replace(/url\((['"]?)assets\//g, 'url($1/studio/site/assets/');

/** Live canvas for the builder: the real partials and CSS around the editor-mode render. Served as iframe srcdoc. */
export function canvasHtml(cfg: Config, s: PageSnapshot, ctx: Omit<RenderCtx, 'pageTitle'>) {
  const part = (n: string) => readFileSync(resolve(cfg.siteRoot, 'src/partials', `${n}.html`), 'utf8');
  const active = NAV.includes(s.navSection) ? s.navSection : 'none';
  const mark = (h: string) => h.replace(/\{\{cur:([a-z]+)\}\}/g, (_m, k) => (k === active ? 'is-current' : '')).replace(/\{\{aria:([a-z]+)\}\}/g, (_m, k) => (k === active ? ' aria-current="page"' : ''));
  const head = part('head').replace('{{title}}', esc(s.title)).replace('{{description}}', esc(s.description))
    .replace('<head>', '<head>\n<base href="/studio/site/">')
    .replace('</head>', `<style>
[data-block-id]{position:relative;cursor:pointer;transition:outline-color .15s}
[data-block-id]:hover{outline:2px dashed rgba(37,99,235,.55);outline-offset:-2px}
[data-block-id].is-selected{outline:2px solid #2563EB;outline-offset:-2px}
[data-block-id][data-hidden]{opacity:.35}
[data-block-id] a,[data-block-id] summary{pointer-events:none}
.rv-ready [data-reveal],.js .reveal.pre{opacity:1!important;transform:none!important}
</style>\n</head>`);
  const body = renderBlocks(validateDoc(s.doc).doc, { ...ctx, pageTitle: s.title, editor: true });
  return [head.trimEnd(), '<body class="font-sans">', mark(part('header')).trimEnd(),
    `<main id="main" data-page="${active}">${body || '<div class="wrap py-24 text-center text-ink-mid">Add a block from the library to start this page.</div>'}</main>`,
    mark(part('footer')).trimEnd(), '</body></html>'].join('\n').replace(/^[\s\S]*$/, siteUrls);
}
