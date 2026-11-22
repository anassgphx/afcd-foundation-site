// Homepage output for build.mjs (page-fields.json entry) and the editor canvas. Both use lib/page-fields.mjs, the code
// build.mjs runs, so the canvas shows what will be published.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { applyFields, composeSections, type LayoutItem } from '../../../../../lib/page-fields.mjs';
import { esc, renderBlocks } from '../pages/blocks.ts';
import { buildCtx } from '../pages/render.ts';
import { inArray } from 'drizzle-orm';
import { media } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { pageBody } from './fields.ts';
import { layoutBlocks, type LayoutEntry } from './layout.ts';

/** Layout as build.mjs reads it: sections by id, blocks as HTML from the registry (hidden blocks left out). */
export async function exportLayout(db: DB, layout: LayoutEntry[] | null, opts: { mediaPrefix?: string; projectOverride?: { projectId: string; revisionId: string | null }; pending?: import('../pages/dynamic.ts').Pending } = {}) {
  if (!layout) return undefined;
  const blocks = layoutBlocks(layout);
  const ctx = await buildCtx(db, [{ blocks }], opts);
  return layout.flatMap((e): LayoutItem[] => {
    if (e.kind === 'section') return [{ section: e.id, ...(e.hidden ? { hidden: true } : {}) }];
    if (e.hidden) return [];
    const html = renderBlocks({ version: 1, blocks: [{ id: e.id, type: e.type, v: e.v, hidden: false, props: e.props, ...(e.design ? { design: e.design } : {}) }] }, { ...ctx, pageTitle: 'Home' });
    return html ? [{ block: e.id, html }] : [];
  });
}

const CANVAS_CSS = `<style>
[data-block-id]{position:relative;cursor:pointer}
[data-block-id]:hover{outline:2px dashed rgba(37,99,235,.55);outline-offset:-2px}
[data-block-id].is-selected{outline:2px solid #2563EB;outline-offset:-2px}
[data-block-id][data-hidden]{opacity:.3;filter:grayscale(1)}
[data-block-id][data-hidden]::before{content:"Hidden";position:absolute;z-index:5;top:12px;left:12px;padding:4px 10px;border-radius:999px;background:#111;color:#fff;font:600 11px/1.4 system-ui}
[data-block-id] a,[data-block-id] summary,[data-block-id] button{pointer-events:none}
[data-reveal],.reveal{opacity:1!important;transform:none!important}
.hx-slide:not(.is-on),.hx-copy[hidden]{display:none}
*,*::before,*::after{transition:none!important;animation:none!important}
html{scroll-behavior:auto!important}
[data-sf]{cursor:text;border-radius:4px}
img[data-sf],[data-sf] img{cursor:pointer}
[data-sf]:hover{outline:1.5px solid rgba(37,99,235,.7);outline-offset:3px}
.sx-bar{position:absolute;z-index:60;top:10px;right:10px;display:flex;align-items:center;gap:2px;padding:4px;border-radius:10px;background:#111;box-shadow:0 8px 24px -8px rgba(0,0,0,.45);font:500 12px/1 system-ui,sans-serif;color:#fff;cursor:default}
.sx-name{padding:0 8px 0 6px;white-space:nowrap;opacity:.85}
[data-block-id] .sx-bar .sx-btn{pointer-events:auto!important;min-width:28px;height:28px;padding:0 6px;border:0;border-radius:7px;background:transparent;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer}
.sx-btn:hover{background:rgba(255,255,255,.16)}
.sx-btn.sx-danger:hover{background:#b91c1c}
.sx-btn[aria-disabled]{opacity:.35;cursor:not-allowed}
.sx-btn[aria-disabled]:hover{background:transparent}
[data-sf].sf-on{outline:2px solid #2563EB;outline-offset:3px;background-color:rgba(37,99,235,.06)}
</style>`;

/** Field values for lib/page-fields.mjs: chosen photos ({ mediaId }) become { src, srcset, w, h, alt, fx, fy }. */
export async function resolveFieldValues(db: DB, values: Record<string, unknown>) {
  const ids = Object.values(values).flatMap((v) => (v && typeof v === 'object' && 'mediaId' in v ? [(v as { mediaId: string }).mediaId] : []));
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v && typeof v === 'object' && 'mediaId' in v) {
      const m = rows.find((r) => r.id === (v as { mediaId: string }).mediaId); if (!m) continue;
      const ref = publicRef(m, 'assets/media/');
      out[k] = { src: ref.src, srcset: ref.srcset, w: ref.w, h: ref.h, alt: m.alt, fx: m.focalX, fy: m.focalY };
    } else out[k] = v;
  }
  return out;
}

/** The whole homepage, with the working copy applied, marked for selection. No scripts run in the canvas. */
export async function homeCanvas(db: DB, cfg: Config, file: string, values: Record<string, unknown>, layout: LayoutEntry[]) {
  const part = (n: string) => readFileSync(resolve(cfg.siteRoot, 'src/partials', `${n}.html`), 'utf8');
  const mark = (h: string) => h.replace(/\{\{cur:([a-z]+)\}\}/g, (_m, k) => (k === 'home' ? 'is-current' : '')).replace(/\{\{aria:([a-z]+)\}\}/g, (_m, k) => (k === 'home' ? ' aria-current="page"' : ''));
  const head = part('head').replace('{{title}}', 'Homepage · AFCD Studio').replace('{{description}}', '')
    .replace('<head>', '<head>\n<base href="/studio/site/">').replace('</head>', `${CANVAS_CSS}\n</head>`);
  const blocks = layoutBlocks(layout);
  const ctx = await buildCtx(db, [{ blocks }], { editor: true });
  const blockHtml = new Map(blocks.map((b) => [b.id, renderBlocks({ version: 1, blocks: [{ ...b, hidden: false }] }, { ...ctx, pageTitle: 'Home', editor: true })
    .replace(/^<div data-block-id="[^"]+"(?: data-hidden="1")?>|<\/div>$/g, '')]));
  const items: LayoutItem[] = layout.map((e) => (e.kind === 'section' ? { section: e.id, hidden: e.hidden } : { block: e.id, html: blockHtml.get(e.id) ?? '', hidden: e.hidden }));
  const body = composeSections(applyFields(pageBody(cfg.siteRoot, file), await resolveFieldValues(db, values), { mark: true }), items,
    (id, html, kind) => `<div data-block-id="${esc(id)}"${kind.startsWith('hidden') ? ' data-hidden="1"' : ''}>${html}</div>`);
  // every image loads at once: lazy loading inside a scaled, scrolled iframe can leave sections empty
  return [head.trimEnd(), '<body class="font-sans">', mark(part('header')).trimEnd(), `<main id="main" data-page="home">${body}</main>`, mark(part('footer')).trimEnd(), '</body></html>'].join('\n')
    .replace(/\sloading="lazy"/g, ' loading="eager"');
}
