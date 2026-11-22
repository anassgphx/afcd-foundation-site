// Public pages for opportunities, written by Studio into src/pages and built by build.mjs with the site's partials.
// opportunities.html lists open, opening-soon and recently closed opportunities; opportunity-<slug>.html has the details.
// Every editor-supplied string is escaped; the description uses the safe text subset of News & Stories.
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { media, pillars } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc, type MediaRef, type ProjectCard } from '../pages/blocks.ts';
import { buildCtx } from '../pages/render.ts';
import { articleBody, dateLabel } from '../news/render.ts';
import { todayMorocco } from '../events/render.ts';
import { TYPE_LABEL, type OpportunitySnapshot } from './service.ts';

export const opportunityFile = (slug: string) => `opportunity-${slug}.html`;
export type OppState = 'open' | 'soon' | 'closed';
export const oppState = (s: Pick<OpportunitySnapshot, 'opensOn' | 'deadline'>, today = todayMorocco()): OppState =>
  s.deadline && s.deadline < today ? 'closed' : s.opensOn && s.opensOn > today ? 'soon' : 'open';
const STATE_LABEL: Record<OppState, string> = { open: 'Open', soon: 'Opening soon', closed: 'Closed' };
const TOPIC: Record<string, string> = { volunteering: 'Volunteering', call_for_applications: 'Joining a programme', call_for_partners: 'Partnership' };
const ARR = '<span class="arr" aria-hidden="true">↗</span>';
const HOME_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/></svg>';
const CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10.5 3.2 3L15 6.5"/></svg>';
const line = (v: string) => v.replace(/[\r\n<>]+/g, ' ').trim();

export async function oppCtx(db: DB, snaps: OpportunitySnapshot[], opts: { projectOverride?: { projectId: string; revisionId: string | null } } = {}) {
  const ids = [...new Set(snaps.map((s) => s.heroMediaId).filter(Boolean) as string[])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const byId = new Map(rows.map((m) => [m.id, publicRef(m, 'assets/media/') as MediaRef]));
  return { media: (id: string | null) => (id ? byId.get(id) ?? null : null), pillars: await db.select().from(pillars),
    projects: (await buildCtx(db, [], { projectOverride: opts.projectOverride })).projects as ProjectCard[], today: todayMorocco() };
}
type Ctx = Awaited<ReturnType<typeof oppCtx>>;
export type LiveOpp = { id: string; snap: OpportunitySnapshot };

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

const when = (s: OpportunitySnapshot, st: OppState) =>
  st === 'soon' ? `Opens ${dateLabel(s.opensOn!)}` : s.deadline ? `${st === 'closed' ? 'Closed' : 'Apply by'} ${dateLabel(s.deadline)}` : 'Rolling, no fixed deadline';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tile(iso: string | null, what: string) {
  if (!iso) return `<span class="ev-date" title="No fixed deadline"><span class="ev-day">∞</span><span class="ev-mon">Rolling</span></span>`;
  const [y, m, d] = iso.split('-');
  return `<time class="ev-date" datetime="${iso}" title="${what}"><span class="ev-day">${d}</span><span class="ev-mon">${MON[Number(m) - 1]} ${y}</span></time>`;
}

function badge(st: OppState) {
  const c = st === 'open' ? '#82E591' : st === 'soon' ? '#FBE38A' : '#D4D4D4';
  return `<span class="inline-flex min-h-[28px] items-center gap-2 rounded-full bg-[#F6F6F6] px-3 text-[12.5px] font-medium"><span class="pj-dot" style="--c:${c}"></span>${STATE_LABEL[st]}</span>`;
}

function applyButton(s: OpportunitySnapshot, cls: string) {
  if (s.applyMethod === 'external') return `<a href="${esc(s.applyUrl)}" target="_blank" rel="noopener" class="btn-dark btn-cta ${cls}">Apply now ${ARR}</a>`;
  if (s.applyMethod === 'email') return `<a href="mailto:${esc(s.applyEmail)}?subject=${encodeURIComponent('Application: ' + s.title)}" class="btn-dark btn-cta ${cls}">Apply by email ${ARR}</a>`;
  return `<a href="contact.html?topic=${encodeURIComponent(TOPIC[s.type] ?? 'General question').replace(/%20/g, '+')}#message" class="btn-dark btn-cta ${cls}">Apply through our contact form ${ARR}</a>`;
}

function card(o: LiveOpp, ctx: Ctx) {
  const s = o.snap; const st = oppState(s, ctx.today);
  const p = ctx.pillars.find((x) => x.key === s.pillarKey);
  return `
      <li class="ev-row${st === 'closed' ? ' is-past' : ''}" data-studio-opportunity="${o.id}">
        ${tile(st === 'soon' ? s.opensOn : s.deadline, st === 'soon' ? 'Opens' : 'Deadline')}
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><span class="ev-kind">${TYPE_LABEL[s.type]}</span>${badge(st)}${p ? `<span class="ev-pillar"><span class="pj-dot" style="--c:${esc(p.colour)}"></span>${esc(p.name)}</span>` : ''}</div>
          <p class="mt-3 text-[19px] font-semibold leading-snug tracking-[-0.02em] md:text-[21px]"><a href="${opportunityFile(s.slug)}" class="ev-link">${esc(s.title)}</a></p>
          <p class="mt-1.5 max-w-[62ch] text-[14.5px] leading-relaxed text-ink-dark">${esc(s.summary)}</p>
          <p class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] text-ink-mid"><span>${when(s, st)}</span>${s.location ? `<span>${esc(s.location)}</span>` : ''}${s.commitment ? `<span>${esc(s.commitment)}</span>` : ''}</p>
        </div>
        <a href="${opportunityFile(s.slug)}" class="ev-act${st === 'closed' ? ' is-past' : ''}">${st === 'closed' ? 'View details' : 'See how to apply'} <span aria-hidden="true">↗</span></a>
      </li>`;
}

/** The listing page. Closed opportunities stay listed for 12 months after their deadline. */
export function listingSource(live: LiveOpp[], ctx: Ctx) {
  const yearAgo = new Date(Date.parse(`${ctx.today}T12:00:00Z`) - 365 * 864e5).toISOString().slice(0, 10);
  const by = (st: OppState) => live.filter((o) => oppState(o.snap, ctx.today) === st);
  const open = by('open').sort((a, b) => (a.snap.deadline ?? '9999').localeCompare(b.snap.deadline ?? '9999'));
  const soon = by('soon').sort((a, b) => a.snap.opensOn!.localeCompare(b.snap.opensOn!));
  const closed = by('closed').filter((o) => o.snap.deadline! >= yearAgo).sort((a, b) => b.snap.deadline!.localeCompare(a.snap.deadline!));
  const section = (id: string, n: string, title: string, soft: string, items: LiveOpp[], empty: string) => `
<section id="${id}" class="${id === 'open' ? 'pt-8 lg:pt-10 pb-14 lg:pb-16' : 'border-t border-ink-light py-14 lg:py-16'}">
  <div class="wrap">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="label text-ink-mid">${n}</p><h2 class="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[40px]">${title} <span class="text-ink-mid">${soft}</span></h2></div><p class="text-[14px] text-ink-mid">${items.length} ${items.length === 1 ? 'opportunity' : 'opportunities'}</p></div>
    ${items.length ? `<ul class="ev-list mt-8">${items.map((o) => card(o, ctx)).join('')}\n    </ul>` : `<div class="mt-8 rounded-[24px] border border-dashed border-ink-light p-6 text-[15px] text-ink-dark">${empty}</div>`}
  </div>
</section>`;
  const body = header([['Get Involved', 'get-involved.html'], ['Opportunities', 'opportunities.html']], 'Opportunities',
    'Apply, volunteer <span class="text-ink-mid">or work with us.</span>',
    'Calls for applications, volunteering, internships and other ways to take part in AFCD’s work. Each one explains who can apply and how.')
    + section('open', '01 / Open now', 'Open', 'opportunities.', open, 'Nothing is open right now. New calls are announced here, on News &amp; Stories and in our newsletter.')
    + (soon.length ? section('soon', '02 / Coming up', 'Opening', 'soon.', soon, '') : '')
    + (closed.length ? section('closed', soon.length ? '03 / Closed' : '02 / Closed', 'Recently', 'closed.', closed, '') : '')
    + `
<section class="pb-14 lg:pb-16"><div class="wrap"><div class="rounded-[28px] border border-ink-light p-6 md:p-8"><p class="text-[22px] font-semibold tracking-[-0.03em]">Don’t see the right fit?</p><p class="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink-dark">You can always volunteer, ask about upcoming calls or propose a partnership.</p><div class="mt-5 flex flex-wrap gap-x-6 gap-y-3"><a href="get-involved.html" class="link-arrow">Ways to get involved ${ARR}</a><a href="contact.html#message" class="link-arrow">Contact us ${ARR}</a></div></div></div></section>`;
  return `---\ntitle: Opportunities · AFCD Foundation\ndescription: Open calls for applications, volunteering, internships and other opportunities at AFCD Foundation.\nactive: involved\nparent: Get Involved|get-involved.html\n---\n<span id="top"></span>\n<div data-studio-opportunities="${live.map((o) => o.id).sort().join(',')}">\n${body}\n</div>\n`;
}

export function detailSource(o: LiveOpp, ctx: Ctx) {
  const s = o.snap; const st = oppState(s, ctx.today);
  const p = ctx.pillars.find((x) => x.key === s.pillarKey);
  const project = s.projectSlug ? ctx.projects.find((x) => x.slug === s.projectSlug) : undefined;
  const hero = ctx.media(s.heroMediaId);
  const facts: [string, string][] = [['Type', TYPE_LABEL[s.type]], ['Status', STATE_LABEL[st]]];
  if (s.opensOn) facts.push(['Opens', dateLabel(s.opensOn)]);
  facts.push(['Deadline', s.deadline ? dateLabel(s.deadline) : 'Rolling']);
  if (s.location) facts.push(['Location', esc(s.location)]);
  if (s.commitment) facts.push(['Commitment', esc(s.commitment)]);
  if (p) facts.push(['Pillar', `<a class="underline underline-offset-2" href="${esc(p.publicFile)}">${esc(p.name)}</a>`]);
  if (project?.file) facts.push(['Project', `<a class="underline underline-offset-2" href="${esc(project.file)}">${esc(project.name)}</a>`]);
  const list = (items: string[]) => `<ul class="mt-4 grid gap-2.5">${items.map((x) => `<li class="gi-check">${CHECK}<span>${esc(x)}</span></li>`).join('')}</ul>`;
  const apply = st === 'open' ? `${applyButton(s, 'mt-5 min-h-[50px] w-full justify-center px-6')}${s.deadline ? `<p class="mt-3 text-[12.5px] leading-relaxed text-ink-mid">Applications close at the end of ${dateLabel(s.deadline)} (Morocco time).</p>` : ''}`
    : st === 'soon' ? `<p class="mt-5 rounded-2xl bg-[#F6F6F6] px-4 py-3 text-[14px] text-ink-dark">Applications open on ${dateLabel(s.opensOn!)}.</p>`
    : `<p class="mt-5 rounded-2xl bg-[#F6F6F6] px-4 py-3 text-[14px] text-ink-dark">This opportunity is closed. <a class="underline underline-offset-2" href="opportunities.html">See open opportunities</a>.</p>`;
  const body = header([['Get Involved', 'get-involved.html'], ['Opportunities', 'opportunities.html'], [esc(s.title.length > 40 ? s.title.slice(0, 40) + '…' : s.title), opportunityFile(s.slug)]],
    `${TYPE_LABEL[s.type]} · ${STATE_LABEL[st]}`, esc(s.title), esc(s.summary)) + `
${hero ? `<section class="pt-8 lg:pt-10"><div class="wrap"><img src="${esc(hero.src)}" srcset="${esc(hero.srcset)}" sizes="(min-width:1024px) 90vw, 100vw" width="${hero.w}" height="${hero.h}" alt="${esc(hero.alt)}" loading="eager" decoding="async" class="aspect-[16/9] w-full rounded-[28px] object-cover md:aspect-[21/9]" style="object-position:${hero.fx}% ${hero.fy}%"></div></section>` : ''}
<section class="py-12 lg:py-16">
  <div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-8">
      <div class="space-y-5 text-[17px] leading-[1.8] text-ink-dark">${articleBody(s.body)}</div>
      <div class="mt-10 grid gap-3 md:grid-cols-2">
        <div class="gi-box"><p class="label text-ink-mid">Who can apply</p>${list(s.eligibility)}</div>
        ${s.benefits.length ? `<div class="gi-box"><p class="label text-ink-mid">What you get</p>${list(s.benefits)}</div>` : ''}
      </div>
    </div>
    <aside class="lg:col-span-4"><div class="rounded-[28px] border border-ink-light p-6 lg:sticky lg:top-32">
      <div class="flex flex-wrap items-center gap-2"><span class="ev-kind">${TYPE_LABEL[s.type]}</span>${badge(st)}</div>
      <dl class="evd-facts mt-5">${facts.map(([a, b]) => `<div class="evd-fact"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>
      ${apply}
    </div></aside>
  </div>
</section>
<section class="border-t border-ink-light py-10"><div class="wrap flex flex-wrap gap-x-6 gap-y-3"><a href="opportunities.html" class="link-arrow">All opportunities ${ARR}</a><a href="get-involved.html" class="link-arrow">Other ways to get involved ${ARR}</a></div></section>`;
  return `---\ntitle: ${line(s.seoTitle || s.title)} · Opportunities · AFCD Foundation\ndescription: ${line(s.seoDescription || s.summary || s.title)}\nactive: involved\nparent: Opportunities|opportunities.html\n${st === 'closed' ? 'noindex: true\n' : ''}---\n<span id="top"></span>\n<article data-studio-opportunity-rev="${o.id}" data-state="${st}">\n${body}\n</article>\n`;
}
