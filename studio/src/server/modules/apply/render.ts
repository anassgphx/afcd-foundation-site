// Public page of an AFCD Apply call: src/pages/apply-<slug>.html, built by build.mjs with the site's partials (header,
// footer, SEO tags, sitemap, fr/ar copies). Written for released calls only (open, paused, closed, under evaluation,
// completed); drafts, calls in review and scheduled calls never get a page. Every editor string is escaped; the form
// definition is embedded as JSON with "<" escaped, and assets/apply.js renders it (the server checks everything again).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { applyCalls, applyForms, applyFormVersions, media, pillars, projects } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc } from '../pages/blocks.ts';
import { articleBody } from '../news/render.ts';
import { publicState } from './applicant.ts';
import { CALL_TYPE_LABEL } from './calls.ts';

export const applyFile = (slug: string) => `apply-${slug}.html`;
export const APPLY_STATUSES = ['open', 'paused', 'closed', 'under_evaluation', 'completed'] as const;
const STATE_LABEL = { upcoming: 'Opening soon', open: 'Open', paused: 'Paused', closed: 'Closed' } as const;
const ARR = '<span class="arr" aria-hidden="true">↗</span>';
const ARR_BACK = '<span aria-hidden="true">←</span>';
const HOME_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/></svg>';
const CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10.5 3.2 3L15 6.5"/></svg>';
const line = (v: string) => v.replace(/[\r\n<>]+/g, ' ').trim();
/** JSON safe inside <script type="application/json">: nothing can close the tag or start a comment. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const when = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const zoneName = (tz: string) => (tz === 'Africa/Casablanca' ? 'Morocco time' : tz.replace(/_/g, ' '));
const FORMAT = { in_person: 'In person', online: 'Online', hybrid: 'In person and online' } as Record<string, string>;
const LANGUAGE = { en: 'English', fr: 'French', ar: 'Arabic', multi: 'Several languages' } as Record<string, string>;

export type ApplyPage = { call: typeof applyCalls.$inferSelect; version: typeof applyFormVersions.$inferSelect | null };

/** What the page must show; any change makes Studio rebuild it (the marker is compared with the file on disk). */
// TEMPLATE goes up when this page's markup changes, so every live application page is rebuilt once after a deploy
const TEMPLATE = 2;
export const pageMarker = (p: ApplyPage, now = new Date()) => `${p.call.id}:${p.call.rev}:${p.version?.number ?? 0}:${publicState(p.call, now) ?? 'none'}:t${TEMPLATE}`;

export async function livePages(db: DB): Promise<ApplyPage[]> {
  const calls = await db.select().from(applyCalls).where(inArray(applyCalls.status, [...APPLY_STATUSES]));
  if (!calls.length) return [];
  const rows = await db.select({ callId: applyForms.callId, v: applyFormVersions }).from(applyForms).innerJoin(applyFormVersions, eq(applyFormVersions.id, applyForms.publishedVersionId)).where(inArray(applyForms.callId, calls.map((c) => c.id)));
  const byCall = new Map(rows.map((r) => [r.callId, r.v]));
  return calls.map((call) => ({ call, version: byCall.get(call.id) ?? null }));
}

function assetVersion(siteRoot: string, f: string) {
  const p = resolve(siteRoot, 'assets', f);
  return existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 8) : '0';
}

export async function pageSource(db: DB, cfg: Config, p: ApplyPage, now = new Date()) {
  const c = p.call, st = publicState(c, now) ?? 'closed';
  const [pillar] = c.pillarId ? await db.select().from(pillars).where(eq(pillars.id, c.pillarId)) : [];
  const [project] = c.projectId ? await db.select({ name: projects.name, slug: projects.slug }).from(projects).where(and(eq(projects.id, c.projectId))) : [];
  const [m] = c.heroMediaId ? await db.select().from(media).where(eq(media.id, c.heroMediaId)) : [];
  const hero = m ? publicRef(m, 'assets/media/') : null;
  const facts: [string, string][] = [['Reference', esc(c.reference)], ['Type', esc(CALL_TYPE_LABEL[c.callType as keyof typeof CALL_TYPE_LABEL] ?? c.callType)], ['Status', STATE_LABEL[st]]];
  if (c.opensAt) facts.push(['Opens', `${when(c.opensAt, c.timeZone)} (${esc(zoneName(c.timeZone))})`]);
  if (c.closesAt) facts.push(['Deadline', `${when(c.closesAt, c.timeZone)} (${esc(zoneName(c.timeZone))})`]);
  if (c.location) facts.push(['Location', esc(c.location)]);
  facts.push(['Format', FORMAT[c.format] ?? esc(c.format)], ['Language', LANGUAGE[c.language] ?? esc(c.language)]);
  if (c.places) facts.push(['Places', String(c.places)]);
  if (c.audience) facts.push(['For', esc(c.audience)]);
  if (pillar) facts.push(['Pillar', `<a class="underline underline-offset-2" href="${esc(pillar.publicFile)}">${esc(pillar.name)}</a>`]);
  if (project) facts.push(['Project', `<a class="underline underline-offset-2" href="project-${esc(project.slug)}.html">${esc(project.name)}</a>`]);
  if (c.contactEmail) facts.push(['Questions', `<a class="underline underline-offset-2" href="mailto:${esc(c.contactEmail)}">${esc(c.contactEmail)}</a>`]);
  const list = (items: string[]) => `<ul class="mt-4 grid gap-2.5">${items.map((x) => `<li class="gi-check">${CHECK}<span>${esc(x)}</span></li>`).join('')}</ul>`;
  const para = (t: string) => t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  const notice = st === 'open' ? '' : `<p class="ap-state ap-state-${st}" role="status">${st === 'paused' ? 'Applications are paused for a moment. Drafts are kept; please come back later.' : st === 'upcoming' ? 'Applications are not open yet.' : 'Applications for this call are closed. Thank you to everyone who applied.'}</p>`;
  const title = esc(c.title);
  const form = p.version && (st === 'open' || st === 'paused')
    ? `<section id="apply" class="ap-sec border-t border-ink-light py-12 lg:py-16" aria-labelledby="apply-h">
  <div class="wrap"><div class="ap-wrap">
    <!-- application mode (Apply now): the page shows only this banner and the form; assets/apply.js switches it on -->
    <header class="ap-banner${hero ? ' has-img' : ''}">
      ${hero ? `<img class="ap-banner-img" src="${esc(hero.src)}" srcset="${esc(hero.srcset)}" sizes="(min-width:1024px) 800px, 100vw" width="${hero.w}" height="${hero.h}" alt="" decoding="async">` : ''}
      <div class="ap-banner-in">
        <a class="ap-exit" href="#top" data-ap-exit>${ARR_BACK} Call details</a>
        <p class="ap-banner-kicker">Application form · <span>${esc(c.reference)}</span></p>
        <p class="ap-banner-title">${title}</p>
        ${c.closesAt ? `<p class="ap-banner-meta"><span class="ap-banner-dot" aria-hidden="true"></span>Deadline ${when(c.closesAt, c.timeZone)} (${esc(zoneName(c.timeZone))})</p>` : ''}
      </div>
    </header>
    <h2 id="apply-h" class="ap-h2 sh-title text-[30px] font-semibold tracking-[-0.04em] md:text-[40px]">Apply</h2>
    ${notice}
    <div id="apply-app" class="ap-app" data-slug="${esc(c.slug)}" data-version="${p.version.number}">
      <noscript><p class="ap-state">The application form needs JavaScript. You can also write to <a href="mailto:${esc(c.contactEmail)}">${esc(c.contactEmail)}</a>.</p></noscript>
      <p class="ap-loading" data-ap-loading>Loading the application form…</p>
    </div>
    <script type="application/json" id="apply-data">${scriptJson({ slug: c.slug, title: c.title, reference: c.reference, timeZone: c.timeZone, closesAt: c.closesAt, contactEmail: c.contactEmail,
      version: { id: p.version.id, number: p.version.number, definition: p.version.definition } })}</script>
  </div></div>
</section>
<link rel="stylesheet" href="assets/apply.css?v=${assetVersion(cfg.siteRoot, 'apply.css')}">
<script src="assets/apply.js?v=${assetVersion(cfg.siteRoot, 'apply.js')}" defer></script>`
    : `<section id="apply" class="border-t border-ink-light py-12"><div class="wrap">${notice || '<p class="ap-state">The application form is not available.</p>'}</div></section>
<link rel="stylesheet" href="assets/apply.css?v=${assetVersion(cfg.siteRoot, 'apply.css')}">`;
  const body = `<section class="page-head phd">
  <div class="phd-glow" aria-hidden="true"></div>
  <div class="wrap relative pb-7 pt-4 lg:pb-9 lg:pt-5">
    <div class="phd-top">
      <nav aria-label="Breadcrumb" class="phd-crumbs"><ol><li><a href="index.html" class="phd-home" aria-label="Home">${HOME_ICO}</a></li><li class="phd-sep" aria-hidden="true">/</li><li><a href="get-involved.html">Get Involved</a></li><li class="phd-sep" aria-hidden="true">/</li><li aria-current="page" class="phd-cur">${esc(c.title.length > 40 ? c.title.slice(0, 40) + '…' : c.title)}</li></ol></nav>
      <span class="phd-rule" aria-hidden="true"></span>
      <span class="phd-label"><span class="tb-dot" aria-hidden="true"></span>Call for applications · ${STATE_LABEL[st]}</span>
    </div>
    <div class="phd-body">
      <h1 class="sh-title sh-xl phd-title" style="max-width:22ch">${title}</h1>
      <div class="phd-aside"><p class="phd-lead">${esc(c.summary)}</p>${st === 'open' && p.version ? `<a href="#apply" class="btn-dark btn-cta mt-5 inline-flex">Apply now ${ARR}</a>` : ''}</div>
    </div>
  </div>
  <div class="phd-hr" aria-hidden="true"></div>
</section>
${hero ? `<section class="pt-8 lg:pt-10"><div class="wrap"><img src="${esc(hero.src)}" srcset="${esc(hero.srcset)}" sizes="(min-width:1024px) 90vw, 100vw" width="${hero.w}" height="${hero.h}" alt="${esc(hero.alt)}" loading="eager" decoding="async" class="aspect-[16/9] w-full rounded-[28px] object-cover md:aspect-[21/9]" style="object-position:${hero.fx}% ${hero.fy}%"></div></section>` : ''}
<section class="py-12 lg:py-16">
  <div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-8">
      <div class="space-y-5 text-[17px] leading-[1.8] text-ink-dark">${articleBody(c.description)}</div>
      ${c.eligibility.length ? `<div class="mt-10 gi-box"><p class="label text-ink-mid">Who can apply</p>${list(c.eligibility)}</div>` : ''}
      <details class="ap-legal mt-8"><summary>How we use your data</summary><div class="ap-legal-b">${para(c.privacyNotice)}</div></details>
      ${c.terms.trim() ? `<details class="ap-legal mt-3"><summary>Terms of participation</summary><div class="ap-legal-b">${para(c.terms)}</div></details>` : ''}
    </div>
    <aside class="lg:col-span-4"><div class="rounded-[28px] border border-ink-light p-6 lg:sticky lg:top-32">
      <dl class="evd-facts">${facts.map(([a, b]) => `<div class="evd-fact"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>
      ${st === 'open' && p.version ? `<a href="#apply" class="btn-dark btn-cta mt-5 min-h-[50px] w-full justify-center px-6">Apply now ${ARR}</a>` : notice}
    </div></aside>
  </div>
</section>
${form}`;
  const noindex = c.unlisted || st !== 'open';
  return `---\ntitle: ${line(c.seoTitle || c.title)} · Apply · AFCD Foundation\ndescription: ${line(c.seoDescription || c.summary || c.title)}\nactive: involved\nparent: Get Involved|get-involved.html\n${noindex ? 'noindex: true\n' : ''}---\n<span id="top"></span>\n<article data-studio-apply="${c.id}" data-studio-apply-rev="${pageMarker(p, now)}" data-state="${st}">\n${body}\n</article>\n`;
}
