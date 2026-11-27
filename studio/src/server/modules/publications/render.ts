// Public pages for publications, written by Studio into src/pages and built by build.mjs with the site's partials
// (so they get the header, footer, SEO tags, sitemap entry and the French/Arabic copies like every other page).
// publications.html lists every live publication with type and pillar filters; publication-<slug>.html has the cover,
// summary, details and the download button. Every editor-supplied string is escaped; the abstract uses the safe text
// subset of News & Stories. The filters need no script: radio buttons and :has() rules hide what does not match, and
// without :has() support everything simply stays visible.
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { documents, media, pillars } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc, type MediaRef, type ProjectCard } from '../pages/blocks.ts';
import { buildCtx } from '../pages/render.ts';
import { articleBody, dateLabel } from '../news/render.ts';
import { LANG_LABEL, TYPE_LABEL, type PublicationSnapshot } from './service.ts';
import { documentFile, sizeLabel, type DocumentRow } from './documents.ts';

export const publicationFile = (slug: string) => `publication-${slug}.html`;
export const PUBLIC_DOC_DIR = 'assets/documents';
export type LivePub = { id: string; snap: PublicationSnapshot };
const ARR = '<span class="arr" aria-hidden="true">↗</span>';
const HOME_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/></svg>';
const DOC_ICO = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
const line = (v: string) => v.replace(/[\r\n<>]+/g, ' ').trim();
/** '<title> · Publications · AFCD Foundation', shortened step by step (section, then site name) to stay within the 70
 *  characters search results show without cutting; the publication's own title is never cut. */
export function fitTitle(t: string, section = 'Publications') {
  return [`${t} · ${section} · AFCD Foundation`, `${t} · AFCD Foundation`].find((x) => x.length <= 70) ?? t;
}
const ident = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]/g, '');
const byDate = (a: LivePub, b: LivePub) => (b.snap.publishedOn ?? '').localeCompare(a.snap.publishedOn ?? '') || a.snap.title.localeCompare(b.snap.title);

export async function pubCtx(db: DB, snaps: PublicationSnapshot[], opts: { projectOverride?: { projectId: string; revisionId: string | null } } = {}) {
  const mids = [...new Set(snaps.map((s) => s.coverMediaId).filter(Boolean) as string[])];
  const dids = [...new Set(snaps.map((s) => s.documentId).filter(Boolean) as string[])];
  const mrows = mids.length ? await db.select().from(media).where(inArray(media.id, mids)) : [];
  const drows = dids.length ? await db.select().from(documents).where(inArray(documents.id, dids)) : [];
  const byId = new Map(mrows.map((m) => [m.id, publicRef(m, 'assets/media/') as MediaRef]));
  const docs = new Map(drows.map((d) => [d.id, d]));
  return { media: (id: string | null) => (id ? byId.get(id) ?? null : null), doc: (id: string | null) => (id ? docs.get(id) ?? null : null),
    pillars: await db.select().from(pillars), projects: (await buildCtx(db, [], { projectOverride: opts.projectOverride })).projects as ProjectCard[] };
}
type Ctx = Awaited<ReturnType<typeof pubCtx>>;

function header(crumbs: [string, string][], label: string, title: string, lead: string) {
  return `<section class="page-head phd">
  <div class="phd-glow" aria-hidden="true"></div>
  <div class="wrap relative pb-7 pt-4 lg:pb-9 lg:pt-5">
    <div class="phd-top">
      <nav aria-label="Breadcrumb" class="phd-crumbs"><ol><li><a href="index.html" class="phd-home" aria-label="Home">${HOME_ICO}</a></li>${crumbs.map(([n, h], i) => `<li class="phd-sep" aria-hidden="true">/</li><li${i === crumbs.length - 1 ? ' aria-current="page" class="phd-cur"' : ''}>${i === crumbs.length - 1 ? n : `<a href="${h}">${n}</a>`}</li>`).join('')}</ol></nav>
      <span class="phd-rule" aria-hidden="true"></span>
      <span class="phd-label"><span class="tb-dot" aria-hidden="true"></span>${label}</span>
    </div>
    <div class="phd-body">
      <h1 class="sh-title sh-xl phd-title" style="max-width:22ch">${title}</h1>
      <div class="phd-aside"><p class="phd-lead">${lead}</p></div>
    </div>
  </div>
  <div class="phd-hr" aria-hidden="true"></div>
</section>`;
}

/** Page-local styles (the site stylesheet stays untouched; text in a style element is never sent for translation). */
const CSS = `.pub-grid{display:grid;gap:44px 24px;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr))}
.pub-card{position:relative;display:flex;flex-direction:column;height:100%}
.pub-card h3 a::after{content:"";position:absolute;inset:0;border-radius:20px}
.pub-card h3 a:focus-visible{outline:none}.pub-card:has(h3 a:focus-visible){outline:2px solid #000;outline-offset:6px;border-radius:20px}
.pub-cover{position:relative;aspect-ratio:1/1;overflow:hidden;border-radius:20px;background:#F5F5F4;display:flex;align-items:center;justify-content:center;color:#8A8A8A;transition:transform .35s cubic-bezier(.2,.7,.2,1),box-shadow .35s ease}
.pub-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pub-cover::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);pointer-events:none}
.pub-card:hover .pub-cover{transform:translateY(-4px);box-shadow:0 24px 40px -28px rgba(0,0,0,.45)}
.pub-body{display:flex;flex:1;flex-direction:column;padding:20px 4px 0}
.pub-kind{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#44403C}
.pub-kind i{width:8px;height:8px;border-radius:9999px;background:#0A0A0A}
.pub-kind time{font-weight:500;letter-spacing:.04em;text-transform:none;color:#78716C}
.pub-body h3{margin-top:12px;font-size:21px;font-weight:600;line-height:1.2;letter-spacing:-.03em;color:#0A0A0A}
.pub-card:hover h3{text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:4px}
.pub-body .pub-sum{margin-top:10px;font-size:15px;line-height:1.6;color:#57534E;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pub-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-top:auto;padding-top:22px}
.pub-foot::before{content:"";flex-basis:100%;height:1px;margin-bottom:4px;background:#E7E5E4}
.pub-meta{font-size:13px;font-weight:500;color:#57534E}
.pub-btn{display:inline-flex;align-items:center;gap:10px;height:42px;padding:0 7px 0 18px;border-radius:9999px;background:#0A0A0A;color:#fff;font-size:13.5px;font-weight:600}
.pub-btn span{display:grid;place-items:center;width:28px;height:28px;border-radius:9999px;background:#fff;color:#0A0A0A;font-size:12px;transition:transform .3s cubic-bezier(.2,.7,.2,1)}
.pub-card:hover .pub-btn span{transform:rotate(45deg)}
.pub-filters{display:flex;flex-wrap:wrap;gap:18px 32px;border:0;margin:0;padding:0}
.pub-filters fieldset{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border:0;margin:0;padding:0;min-width:0}
.pub-filters legend{float:left;margin-right:6px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--mid,#6F6F6F)}
.pub-chip{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:1px solid #E2E2E2;border-radius:9999px;font-size:13.5px;font-weight:500;cursor:pointer;user-select:none}
.pub-filters input:checked+.pub-chip{background:#000;border-color:#000;color:#fff}
.pub-filters input:focus-visible+.pub-chip{outline:2px solid #000;outline-offset:2px}
.pub-none{display:none}
.pub-split3{display:grid;gap:40px}@media(min-width:1024px){.pub-split3{grid-template-columns:minmax(0,4fr) minmax(0,5fr) minmax(0,3fr);gap:40px}.pub-stick{position:sticky;top:8rem}}@media(min-width:1280px){.pub-split3{gap:48px}}
.pub-dl-cover{display:block;width:100%;height:auto;border-radius:24px;background:#F6F6F6;box-shadow:0 1px 2px rgba(8,8,8,.06),0 12px 32px -12px rgba(8,8,8,.18)}`;

const meta = (s: PublicationSnapshot, d: DocumentRow | null) => [d ? `PDF · ${sizeLabel(d.bytes)}` : s.externalUrl ? 'Online' : '', LANG_LABEL[s.language] ?? ''].filter(Boolean).join(' · ');

function card(p: LivePub, ctx: Ctx) {
  const s = p.snap; const cover = ctx.media(s.coverMediaId);
  return `
      <li class="pub-item" data-type="${s.type}" data-pillars="${s.pillarKeys.map(ident).join(' ')}" data-studio-publication="${p.id}">
        <article class="pub-card">
          <div class="pub-cover">${cover ? `<img src="${esc(cover.src)}" srcset="${esc(cover.srcset)}" sizes="(min-width:1024px) 30vw, (min-width:640px) 45vw, 100vw" width="${cover.w}" height="${cover.h}" alt="" loading="lazy" decoding="async" style="object-position:${cover.fx}% ${cover.fy}%">` : DOC_ICO}</div>
          <div class="pub-body">
            <p class="pub-kind"><i aria-hidden="true"></i>${TYPE_LABEL[s.type]}${s.publishedOn ? `<time datetime="${s.publishedOn}">${dateLabel(s.publishedOn)}</time>` : ''}</p>
            <h3><a href="${publicationFile(s.slug)}">${esc(s.title)}</a></h3>
            ${s.summary ? `<p class="pub-sum">${esc(s.summary)}</p>` : ''}
            <div class="pub-foot"><p class="pub-meta">${meta(s, ctx.doc(s.documentId))}</p><span class="pub-btn" aria-hidden="true">Read &amp; download <span>↗</span></span></div>
          </div>
        </article>
      </li>`;
}

/** Filter rules: each checked radio hides the items that do not match; a message shows for combinations with no match. */
function filterCss(live: LivePub[], types: string[], pillarKeys: string[]) {
  const out: string[] = [];
  for (const t of types) out.push(`.pub-browse:has(#pf-t-${t}:checked) .pub-item:not([data-type="${t}"]){display:none}`);
  for (const k of pillarKeys) out.push(`.pub-browse:has(#pf-p-${k}:checked) .pub-item:not([data-pillars~="${k}"]){display:none}`);
  for (const t of ['all', ...types]) for (const k of ['all', ...pillarKeys]) {
    if (t === 'all' && k === 'all') continue;
    const any = live.some((p) => (t === 'all' || p.snap.type === t) && (k === 'all' || p.snap.pillarKeys.map(ident).includes(k)));
    if (!any) out.push(`.pub-browse:has(#pf-t-${t}:checked):has(#pf-p-${k}:checked) .pub-none{display:block}`);
  }
  return out.join('\n');
}

/** The listing page: newest first, with filters for type and pillar when there is more than one of either. */
export function listingSource(live: LivePub[], ctx: Ctx) {
  const items = [...live].sort(byDate);
  const types = Object.keys(TYPE_LABEL).filter((t) => items.some((p) => p.snap.type === t));
  const pls = ctx.pillars.filter((pl) => items.some((p) => p.snap.pillarKeys.includes(pl.key))).sort((a, b) => a.sort - b.sort);
  const pkeys = pls.map((p) => ident(p.key));
  const radio = (group: 't' | 'p', value: string, label: string, checked = false) =>
    `<input type="radio" class="sr-only" name="pf-${group}" id="pf-${group}-${value}" value="${value}"${checked ? ' checked' : ''}><label class="pub-chip" for="pf-${group}-${value}">${label}</label>`;
  // a filter only appears when it can actually narrow the list
  const showTypes = types.length > 1;
  const showPillars = pls.length > 1 || (pls.length === 1 && items.some((p) => !p.snap.pillarKeys.includes(pls[0].key)));
  const filters = showTypes || showPillars ? `
    <div class="pub-filters mt-8" role="group" aria-label="Filter publications">
      ${showTypes ? `<fieldset><legend>Type</legend>${radio('t', 'all', 'All', true)}${types.map((t) => radio('t', t, TYPE_LABEL[t])).join('')}</fieldset>` : `<input type="radio" class="sr-only" name="pf-t" id="pf-t-all" value="all" checked aria-hidden="true" tabindex="-1">`}
      ${showPillars ? `<fieldset><legend>Pillar</legend>${radio('p', 'all', 'All', true)}${pls.map((p) => radio('p', ident(p.key), esc(p.name))).join('')}</fieldset>` : `<input type="radio" class="sr-only" name="pf-p" id="pf-p-all" value="all" checked aria-hidden="true" tabindex="-1">`}
    </div>` : '';
  const body = header([['Publications', 'publications.html']], 'Publications',
    'Reports, studies <span class="text-ink-mid">and resources.</span>',
    'Reports, studies, policy briefs and guides from AFCD Foundation’s work. Open one to read the summary and download the document.') + `
<section class="pb-14 pt-8 lg:pb-16 lg:pt-10">
  <div class="wrap pub-browse">
    <style>${CSS}
${filterCss(items, showTypes ? types : [], showPillars ? pkeys : [])}</style>
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="label text-ink-mid">Library</p><h2 class="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[40px]">All <span class="text-ink-mid">publications.</span></h2></div><p class="text-[14px] text-ink-mid">${items.length} ${items.length === 1 ? 'publication' : 'publications'}</p></div>${filters}
    <ul class="pub-grid mt-8">${items.map((p) => card(p, ctx)).join('')}
    </ul>
    <p class="pub-none mt-8 rounded-[24px] border border-dashed border-ink-light p-6 text-[15px] text-ink-dark" role="status">No publications match these filters.</p>
  </div>
</section>`;
  return `---\ntitle: AFCD Foundation publications: reports and resources\ndescription: Reports, studies, policy briefs and guides published by AFCD Foundation, to read and download.\nactive: none\n---\n<span id="top"></span>\n<div data-studio-publications="${live.map((p) => p.id).sort().join(',')}">\n${body}\n</div>\n`;
}

export function detailSource(p: LivePub, ctx: Ctx) {
  const s = p.snap;
  const cover = ctx.media(s.coverMediaId);
  const doc = ctx.doc(s.documentId);
  const pls = s.pillarKeys.map((k) => ctx.pillars.find((x) => x.key === k)).filter(Boolean) as Ctx['pillars'];
  const projects = s.projectSlugs.map((x) => ctx.projects.find((pr) => pr.slug === x)).filter((x): x is ProjectCard => !!x?.file);
  const facts: [string, string][] = [['Type', TYPE_LABEL[s.type]]];
  if (s.publishedOn) facts.push(['Published', dateLabel(s.publishedOn)]);
  if (s.authors.length) facts.push([s.authors.length === 1 ? 'Author' : 'Authors', s.authors.map(esc).join(', ')]);
  if (s.organisation) facts.push(['Organisation', esc(s.organisation)]);
  facts.push(['Language', LANG_LABEL[s.language] ?? s.language]);
  if (doc) facts.push(['File', `PDF, ${sizeLabel(doc.bytes)}`]);
  if (pls.length) facts.push([pls.length === 1 ? 'Pillar' : 'Pillars', pls.map((x) => `<a class="evd-fact-link" href="${esc(x.publicFile)}">${esc(x.name)}</a>`).join(', ')]);
  if (projects.length) facts.push([projects.length === 1 ? 'Project' : 'Projects', projects.map((x) => `<a class="evd-fact-link" href="${esc(x.file!)}">${esc(x.name)}</a>`).join(', ')]);
  const download = doc ? `<a href="${PUBLIC_DOC_DIR}/${documentFile(doc)}" download="${esc(s.slug)}.pdf" type="application/pdf" class="btn-dark btn-cta mt-5 min-h-[50px] w-full justify-center px-6" data-studio-document="${doc.storageKey}">Download PDF ${ARR}</a>` : '';
  const online = s.externalUrl ? (doc
    ? `<p class="mt-4 text-center"><a href="${esc(s.externalUrl)}" target="_blank" rel="noopener" class="link-arrow">Read online ${ARR}</a></p>`
    : `<a href="${esc(s.externalUrl)}" target="_blank" rel="noopener" class="btn-dark btn-cta mt-5 min-h-[50px] w-full justify-center px-6">Read online ${ARR}</a>`) : '';
  const abstract = s.abstract.trim() ? `<h2 class="text-[24px] font-semibold tracking-[-0.03em] md:text-[28px]">About this publication</h2>
      <div class="mt-5 space-y-5 text-[17px] leading-[1.8] text-ink-dark">${articleBody(s.abstract)}</div>` : '';
  // the cover is shown whole (not cropped), beside the text; the details card no longer repeats it
  const coverImg = cover ? `<img src="${esc(cover.src)}" srcset="${esc(cover.srcset)}" sizes="(min-width:1024px) 38vw, 100vw" width="${cover.w}" height="${cover.h}" alt="${esc(cover.alt)}" loading="eager" decoding="async" class="pub-dl-cover">` : '';
  const aside = `<div class="rounded-[28px] border border-ink-light p-6">
      <div class="flex flex-wrap items-center gap-2"><span class="ev-kind">${TYPE_LABEL[s.type]}</span>${pls.map((x) => `<span class="ev-pillar"><span class="pj-dot" style="--c:${esc(x.colour)}"></span>${esc(x.name)}</span>`).join('')}</div>
      <dl class="evd-facts mt-5">${facts.map(([a, b]) => `<div class="evd-fact"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>
      ${download}${online}
    </div>`;
  const year = s.publishedOn ? ` · ${s.publishedOn.slice(0, 4)}` : '';
  const short = s.title.length > 40 ? s.title.slice(0, 40) + '…' : s.title;
  const body = header([['Publications', 'publications.html'], [esc(short), publicationFile(s.slug)]], `${TYPE_LABEL[s.type]}${year}`, esc(s.title), esc(s.summary)) + `
<section class="py-12 lg:py-16">
  <style>${CSS}</style>
  ${coverImg && abstract
    // split in three: the cover, the text, the details card (stacked on small screens)
    ? `<div class="wrap pub-split3">
    <div><div class="pub-stick">${coverImg}</div></div>
    <div>${abstract}</div>
    <aside><div class="pub-stick">${aside}</div></aside>
  </div>`
    : `<div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    ${coverImg
      ? `<div class="lg:col-span-5"><div class="lg:sticky lg:top-32">${coverImg}</div></div>
    <aside class="lg:col-span-4">${aside}</aside>`
      : abstract ? `<div class="lg:col-span-8">${abstract}</div>
    <aside class="lg:col-span-4"><div class="lg:sticky lg:top-32">${aside}</div></aside>` : `<aside class="lg:col-span-5">${aside}</aside>`}
  </div>`}
</section>
<section class="border-t border-ink-light py-10"><div class="wrap flex flex-wrap gap-x-6 gap-y-3"><a href="publications.html" class="link-arrow">All publications ${ARR}</a>${projects[0] ? `<a href="${esc(projects[0].file!)}" class="link-arrow">${esc(projects[0].name)} ${ARR}</a>` : ''}</div></section>`;
  return `---\ntitle: ${fitTitle(line(s.seoTitle || s.title))}\ndescription: ${line(s.seoDescription || s.summary || s.title)}\nactive: none\nparent: Publications|publications.html\n---\n<span id="top"></span>\n<article data-studio-publication-rev="${p.id}">\n${body}\n</article>\n`;
}

/** Public files each live publication needs: cover image ids and PDF rows. */
export function pubAssets(live: LivePub[], ctx: Ctx) {
  return { mediaIds: live.map((p) => p.snap.coverMediaId).filter(Boolean) as string[], docs: live.map((p) => ctx.doc(p.snap.documentId)).filter(Boolean) as DocumentRow[] };
}
