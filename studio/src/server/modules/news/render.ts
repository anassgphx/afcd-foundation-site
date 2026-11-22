// News & Stories rendering: article pages (written into the site build) and the listing data for src/content.py.
// Every editor-supplied string is escaped; the body is a small safe subset: paragraphs, "## " subheadings,
// "> " quotes, "- " lists, **bold**, *italic*, [links](url) with allow-listed URLs.
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { media, pillars } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc, richText, type MediaRef, type ProjectCard } from '../pages/blocks.ts';
import { buildCtx } from '../pages/render.ts';

export const TYPE_LABEL: Record<string, string> = {
  programme_news: 'Programme news', participant_story: 'Participant story', call_for_applications: 'Call for applications', event_recap: 'Event recap',
};

export type ArticleSnapshot = {
  slug: string; title: string; excerpt: string; body: string; type: string; tags: string[]; authorName: string; authorRole: string;
  publishDate: string; featured: boolean; externalUrl: string; heroMediaId: string | null; galleryMediaIds: string[];
  pillarKeys: string[]; projectSlugs: string[]; seo: { title: string; description: string };
};

export const articleFile = (s: Pick<ArticleSnapshot, 'slug' | 'externalUrl'>) => (s.externalUrl ? null : `news-${s.slug}.html`);
export const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function articleBody(raw: string) {
  return String(raw ?? '').trim().split(/\n{2,}/).filter(Boolean).map((block) => {
    if (/^##\s+/.test(block)) return `<h2 class="!mt-12 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink-pure">${esc(block.replace(/^##\s+/, '').replace(/\n/g, ' '))}</h2>`;
    if (block.split('\n').every((l) => /^>\s?/.test(l))) {
      return `<blockquote class="!my-10 border-l-4 border-ink-pure pl-6 text-[24px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink-pure">${richText(block.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n')).replace(/^<p>|<\/p>$/g, '')}</blockquote>`;
    }
    return richText(block);
  }).join('\n');
}

export async function newsCtx(db: DB, snaps: ArticleSnapshot[], opts: { mediaPrefix?: string; projectOverride?: { projectId: string; revisionId: string | null } } = {}) {
  const ids = [...new Set(snaps.flatMap((s) => [s.heroMediaId, ...s.galleryMediaIds]).filter(Boolean) as string[])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const byId = new Map(rows.map((m) => [m.id, publicRef(m, opts.mediaPrefix ?? 'assets/media/') as MediaRef]));
  const pl = await db.select().from(pillars);
  const base = await buildCtx(db, [], { projectOverride: opts.projectOverride });
  return { media: (id: string | null | undefined) => (id ? byId.get(id) ?? null : null), pillars: pl, projects: base.projects as ProjectCard[] };
}
type NewsCtx = Awaited<ReturnType<typeof newsCtx>>;

function img(m: MediaRef | null, cls: string, sizes: string, caption: string, eager = false) {
  if (!m) return `<div class="ph ${cls}" style="--ph:#D4D4D4"><span class="ph-cap"><b>Photo</b> · ${esc(caption)}</span></div>`;
  return `<img src="${esc(m.src)}" srcset="${esc(m.srcset)}" sizes="${sizes}" width="${m.w}" height="${m.h}" alt="${esc(m.alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" class="${cls} object-cover" style="object-position:${m.fx}% ${m.fy}%">`;
}

/** Card data for the News & Stories listing in src/content.py (already escaped). */
export function listingEntry(s: ArticleSnapshot, ctx: NewsCtx, revisionId: string) {
  const p = ctx.pillars.find((x) => x.key === s.pillarKeys[0]);
  return {
    slug: s.slug, file: articleFile(s), url: s.externalUrl ? esc(s.externalUrl) : articleFile(s), external: !!s.externalUrl,
    title: esc(s.title), excerpt: esc(s.excerpt), type: TYPE_LABEL[s.type] ?? 'Programme news',
    pillar: esc(p?.name ?? ''), colour: p?.colour ?? '#D4D4D4', date: s.publishDate, dateLabel: dateLabel(s.publishDate),
    hero: ctx.media(s.heroMediaId), featured: s.featured, revision: revisionId,
    // Full story data for the site's article template (news_articles() in src/content.py). All strings are escaped;
    // bodyHtml is the story text converted by articleBody() (safe subset). The template must output
    // data-studio-article-rev="<revision>" so Studio can verify the published version.
    bodyHtml: articleBody(s.body),
    authorName: esc(s.authorName), authorRole: esc(s.authorRole), tags: s.tags.map(esc),
    readMinutes: Math.max(1, Math.round(s.body.split(/\s+/).filter(Boolean).length / 200)),
    seoTitle: esc(s.seo.title), seoDescription: esc(s.seo.description),
    pillars: s.pillarKeys.map((k) => ctx.pillars.find((x) => x.key === k)).filter(Boolean).map((x) => ({ key: x!.key, name: esc(x!.name), colour: x!.colour, file: x!.publicFile })),
    gallery: s.galleryMediaIds.map((id) => ctx.media(id)).filter(Boolean),
    projects: s.projectSlugs.map((sl) => ctx.projects.find((x) => x.slug === sl)).filter(Boolean).map((x) => ({ name: esc(x!.name), file: x!.file, category: esc(x!.category), summary: esc(x!.summary), hero: x!.hero })),
  };
}

const HOME_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/></svg>';
const ARR = '<span class="arr" aria-hidden="true">↗</span>';

/** Article page source in the build.mjs format. `others` are other live stories for "More stories". */
export function articleSource(s: ArticleSnapshot, ctx: NewsCtx, revisionId: string, others: ReturnType<typeof listingEntry>[]) {
  const line = (v: string) => v.replace(/[\r\n<>]+/g, ' ').trim();
  const typeLabel = TYPE_LABEL[s.type] ?? 'Programme news';
  const pls = s.pillarKeys.map((k) => ctx.pillars.find((p) => p.key === k)).filter(Boolean) as { key: string; name: string; colour: string; publicFile: string }[];
  const projects = s.projectSlugs.map((sl) => ctx.projects.find((p) => p.slug === sl)).filter(Boolean) as ProjectCard[];
  const gallery = s.galleryMediaIds.map((id) => ctx.media(id)).filter(Boolean) as MediaRef[];
  const words = s.body.split(/\s+/).filter(Boolean).length;
  const by = s.authorName ? `<span>By <b class="font-semibold text-ink-pure">${esc(s.authorName)}</b>${s.authorRole ? `, ${esc(s.authorRole)}` : ''}</span><span aria-hidden="true">·</span>` : '';
  const body = `
<article data-studio-article-rev="${revisionId}">
<section class="page-head phd">
  <div class="phd-glow" aria-hidden="true"></div>
  <div class="wrap relative pb-7 pt-4 lg:pb-9 lg:pt-5">
    <div class="phd-top">
      <nav aria-label="Breadcrumb" class="phd-crumbs"><ol><li><a href="index.html" class="phd-home" aria-label="Home">${HOME_ICO}</a></li><li class="phd-sep" aria-hidden="true">/</li><li><a href="news.html">News &amp; Stories</a></li><li class="phd-sep" aria-hidden="true">/</li><li aria-current="page" class="phd-cur">${esc(s.title.length > 40 ? s.title.slice(0, 40) + '…' : s.title)}</li></ol></nav>
      <span class="phd-rule" aria-hidden="true"></span>
      <span class="phd-label"><span class="tb-dot" aria-hidden="true"></span>${esc(typeLabel)}</span>
    </div>
    <div class="phd-body">
      <h1 class="sh-title sh-xl phd-title" style="max-width:22ch">${esc(s.title)}</h1>
      <div class="phd-aside"><p class="phd-lead">${esc(s.excerpt)}</p>
        <p class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-mid">${by}<time datetime="${esc(s.publishDate)}">${dateLabel(s.publishDate)}</time><span aria-hidden="true">·</span><span>${Math.max(1, Math.round(words / 200))} min read</span></p>
      </div>
    </div>
  </div>
  <div class="phd-hr" aria-hidden="true"></div>
</section>

<section class="pt-8 lg:pt-10"><div class="wrap">${img(ctx.media(s.heroMediaId), 'aspect-[16/9] w-full rounded-[28px] md:aspect-[21/9]', '(min-width:1024px) 90vw, 100vw', s.title, true)}</div></section>

<section class="py-12 lg:py-16">
  <div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    <div class="space-y-5 text-[17.5px] leading-[1.8] text-ink-dark lg:col-span-8">${articleBody(s.body)}</div>
    <aside class="lg:col-span-4"><div class="grid gap-3 lg:sticky lg:top-32">
      ${pls.length ? `<div class="rounded-[22px] border border-ink-light p-5"><p class="label text-ink-mid">Pillars</p><ul class="mt-3 grid gap-2">${pls.map((p) => `<li><a class="os-area" href="${esc(p.publicFile)}"><span class="os-area-dot" style="--c:${esc(p.colour)}" aria-hidden="true"></span><span class="flex-1">${esc(p.name)}</span><span class="os-area-arr" aria-hidden="true">↗</span></a></li>`).join('')}</ul></div>` : ''}
      ${s.tags.length ? `<div class="rounded-[22px] border border-ink-light p-5"><p class="label text-ink-mid">Topics</p><ul class="mt-3 flex flex-wrap gap-2">${s.tags.map((t) => `<li class="inline-flex min-h-[30px] items-center rounded-full bg-[#F6F6F6] px-3 text-[13px] font-medium">${esc(t)}</li>`).join('')}</ul></div>` : ''}
      <a href="news.html" class="link-arrow">All stories ${ARR}</a>
    </div></aside>
  </div>
</section>
${gallery.length ? `<section class="pb-12 lg:pb-16"><div class="wrap"><p class="label text-ink-mid">In pictures</p><ul class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${gallery.map((m) => `<li>${img(m, 'aspect-[4/3] w-full rounded-[22px]', '(min-width:1024px) 33vw, 50vw', 'Gallery')}</li>`).join('')}</ul></div></section>` : ''}
${projects.length ? `<section class="border-t border-ink-light py-12 lg:py-16"><div class="wrap"><h2 class="text-[28px] font-semibold tracking-[-0.04em] md:text-[36px]">Related projects</h2><ul class="nw-grid mt-8">${projects.map((x) => `<li>${x.file ? `<a href="${esc(x.file)}" class="nw-card group">` : '<div class="nw-card">'}<div class="relative">${img(x.hero, 'aspect-[16/10] w-full rounded-[20px]', '33vw', x.name)}<span class="nw-type">${esc(x.category)}</span></div><span class="mt-5 block px-2.5 text-[20px] font-semibold leading-[1.2] tracking-[-0.025em]">${esc(x.name)}</span>${x.summary ? `<span class="mt-2 block px-2.5 text-[14.5px] leading-relaxed text-ink-dark">${esc(x.summary)}</span>` : ''}${x.file ? `<span class="nw-read px-2.5">Explore project <span aria-hidden="true">↗</span></span></a>` : '</div>'}</li>`).join('')}</ul></div></section>` : ''}
${others.length ? `<section class="border-t border-ink-light py-12 lg:py-16"><div class="wrap"><div class="between flex flex-wrap items-end justify-between gap-4"><h2 class="text-[28px] font-semibold tracking-[-0.04em] md:text-[36px]">More stories</h2><a href="news.html" class="sh-link">All stories ${ARR}</a></div><ul class="nw-grid mt-8">${others.slice(0, 3).map((o) => `<li><a href="${o.url}"${o.external ? ' target="_blank" rel="noopener"' : ''} class="nw-card group"><div class="relative">${img(o.hero, 'aspect-[16/10] w-full rounded-[20px]', '33vw', o.title)}<span class="nw-type">${o.type}</span></div><span class="mt-5 flex items-center gap-2 px-2.5 text-[12.5px] text-ink-mid"><span class="pj-dot" style="--c:${o.colour}"></span>${o.pillar}<span aria-hidden="true">·</span><time datetime="${o.date}">${o.dateLabel}</time></span><span class="mt-3 block px-2.5 text-[20px] font-semibold leading-[1.2] tracking-[-0.025em]">${o.title}</span><span class="nw-read px-2.5">Read the story <span aria-hidden="true">↗</span></span></a></li>`).join('')}</ul></div></section>` : ''}
</article>`;
  return `---\ntitle: ${line(s.seo.title || s.title)} · AFCD Foundation\ndescription: ${line(s.seo.description || s.excerpt || s.title)}\nactive: news\nparent: News & Stories|news.html\n---\n<span id="top"></span>\n${body}\n`;
}
