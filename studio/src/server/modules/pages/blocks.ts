// Block library for the visual page builder.
// Each block type has: a versioned Zod schema (validated on every save and publish), editor field metadata (sent to the
// admin app), default props, optional migrations from older versions, and a server-side renderer that ONLY emits the
// website's approved component markup. Editors can never inject HTML, CSS or JavaScript: every string is escaped, rich
// text is a tiny safe subset (**bold**, *italic*, [link](url), paragraphs and lists), and URLs are allow-listed.
import { z } from 'zod';

// ---------------------------------------------------------------- Safe output helpers
export const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE_URL = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:\+?[0-9 ]+|[a-z0-9-]+\.html(#[a-z0-9-]+)?|#[a-z0-9-]+)$/i;
export const safeUrl = (u: string) => (SAFE_URL.test(u.trim()) ? u.trim() : '#');
const isExternal = (u: string) => /^https:\/\//.test(u);
const linkAttrs = (u: string) => `href="${esc(safeUrl(u))}"${isExternal(u) ? ' target="_blank" rel="noopener"' : ''}`;

/** Inline formatting on already-escaped text. */
function inline(raw: string) {
  let s = esc(raw);
  s = s.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (_m, t: string, u: string) => `<a class="underline underline-offset-4" ${linkAttrs(u.replace(/&amp;/g, '&'))}>${t}</a>`);
  s = s.replace(/\*\*([^*]{1,300})\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]{1,300})\*/g, '$1<em>$2</em>');
  return s;
}

/** Paragraphs separated by blank lines; lines starting with "- " become a list. */
export function richText(raw: string, pClass = '') {
  return String(raw ?? '').trim().split(/\n{2,}/).filter(Boolean).map((para) => {
    const lines = para.split('\n');
    if (lines.every((l) => /^\s*-\s+/.test(l))) return `<ul class="list-disc space-y-1 pl-5">${lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p${pClass ? ` class="${pClass}"` : ''}>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

const ARR = '<span class="arr" aria-hidden="true">↗</span>';
const HOME_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/></svg>';

// ---------------------------------------------------------------- Render context
export type MediaRef = { src: string; srcset: string; w: number; h: number; alt: string; fx: number; fy: number };
export type ProjectCard = { name: string; slug: string; pillar: string; pillars: string[]; category: string; summary: string; file: string | null; hero: MediaRef | null; colour: string };
export type RenderCtx = { media: (id: string | null | undefined) => MediaRef | null; projects: ProjectCard[]; pageTitle: string; editor?: boolean };

function img(m: MediaRef | null, cls: string, sizes = '100vw', caption = 'Photo') {
  if (!m) return `<div class="ph ${cls}" style="--ph:#D4D4D4"><span class="ph-cap"><b>Photo</b> · ${esc(caption)}</span></div>`;
  return `<img src="${esc(m.src)}" srcset="${esc(m.srcset)}" sizes="${sizes}" width="${m.w}" height="${m.h}" alt="${esc(m.alt)}" loading="lazy" decoding="async" class="${cls} object-cover" style="object-position:${m.fx}% ${m.fy}%">`;
}

// ---------------------------------------------------------------- Field metadata (drives the inspector UI)
export type Field =
  | { key: string; label: string; type: 'text' | 'textarea' | 'richtext' | 'url'; max: number; hint?: string; required?: boolean }
  | { key: string; label: string; type: 'select'; options: [string, string][]; hint?: string }
  | { key: string; label: string; type: 'toggle'; hint?: string }
  | { key: string; label: string; type: 'media'; hint?: string }
  | { key: string; label: string; type: 'pillar'; hint?: string }
  | { key: string; label: string; type: 'projects'; hint?: string }
  | { key: string; label: string; type: 'list'; itemLabel: string; min: number; max: number; fields: Field[]; hint?: string };

type Def<S extends z.ZodTypeAny> = {
  type: string; version: number; label: string; group: 'Structure' | 'Text' | 'Media' | 'Content' | 'Action';
  description: string; fields: Field[]; schema: S; defaults: z.infer<S>;
  migrate?: (from: number, props: Record<string, unknown>) => Record<string, unknown>;
  render: (p: z.infer<S>, ctx: RenderCtx) => string;
};
const def = <S extends z.ZodTypeAny>(d: Def<S>) => d;

const t = (max: number) => z.string().trim().max(max).default('');
const req = (max: number, msg: string) => z.string().trim().min(1, msg).max(max);
const url = z.string().trim().max(500).refine((u) => u === '' || SAFE_URL.test(u), 'Use https://…, mailto:, tel:, a page like about.html, or #section.').default('');
const space = z.enum(['sm', 'md', 'lg']).default('md');
const PAD: Record<string, string> = { sm: 'py-8 lg:py-10', md: 'py-14 lg:py-16', lg: 'py-20 lg:py-24' };
const SPACE_FIELD: Field = { key: 'space', label: 'Vertical spacing', type: 'select', options: [['sm', 'Compact'], ['md', 'Standard'], ['lg', 'Spacious']] };

function secHead(p: { number?: string; label?: string; title: string; soft?: string; desc?: string }) {
  const pill = p.number ? `<span class="sh-num">${esc(p.number)}</span>` : '';
  const aside = p.desc ? `<div class="sh-aside"><span class="brand-line brand-line-thin sh-accent" aria-hidden="true"></span><p class="sh-desc">${esc(p.desc)}</p></div>` : '';
  const top = p.label || p.number ? `<div class="sh-top">${pill}<span class="sh-label">${esc(p.label ?? '')}</span><span class="sh-rule" aria-hidden="true"></span></div>` : '';
  return `<header class="sh">${top}<div class="sh-body"><h2 class="sh-title">${esc(p.title)}${p.soft ? ` <span class="sh-soft">${esc(p.soft)}</span>` : ''}</h2>${aside}</div></header>`;
}

// ---------------------------------------------------------------- Blocks
export const BLOCKS = [
  def({
    type: 'page_header', version: 1, label: 'Page header', group: 'Structure', description: 'Breadcrumb, label, title and intro, like every inner page.',
    fields: [
      { key: 'label', label: 'Label pill', type: 'text', max: 40 },
      { key: 'title', label: 'Title', type: 'text', max: 120, required: true },
      { key: 'soft', label: 'Title, grey part', type: 'text', max: 80, hint: 'Optional second part shown in grey.' },
      { key: 'lead', label: 'Introduction', type: 'textarea', max: 400 },
    ],
    schema: z.object({ label: t(40), title: req(120, 'Add a title.'), soft: t(80), lead: t(400) }),
    defaults: { label: 'New page', title: 'Page title', soft: '', lead: 'A short introduction to this page.' },
    render: (p, ctx) => `
<section class="page-head phd">
  <div class="phd-glow" aria-hidden="true"></div>
  <div class="wrap relative pb-7 pt-4 lg:pb-9 lg:pt-5">
    <div class="phd-top">
      <nav aria-label="Breadcrumb" class="phd-crumbs"><ol><li><a href="index.html" class="phd-home" aria-label="Home">${HOME_ICO}</a></li><li class="phd-sep" aria-hidden="true">/</li><li aria-current="page" class="phd-cur">${esc(ctx.pageTitle)}</li></ol></nav>
      <span class="phd-rule" aria-hidden="true"></span>
      ${p.label ? `<span class="phd-label"><span class="tb-dot" aria-hidden="true"></span>${esc(p.label)}</span>` : ''}
    </div>
    <div class="phd-body">
      <h1 class="sh-title sh-xl phd-title">${esc(p.title)}${p.soft ? ` <span class="text-ink-mid">${esc(p.soft)}</span>` : ''}</h1>
      ${p.lead ? `<div class="phd-aside"><p class="phd-lead">${esc(p.lead)}</p></div>` : ''}
    </div>
  </div>
  <div class="phd-hr" aria-hidden="true"></div>
</section>`,
  }),
  def({
    type: 'section_heading', version: 1, label: 'Section heading', group: 'Text', description: 'Numbered section title with an optional description.',
    fields: [
      { key: 'number', label: 'Number', type: 'text', max: 4, hint: 'e.g. 01' }, { key: 'label', label: 'Label', type: 'text', max: 40 },
      { key: 'title', label: 'Title', type: 'text', max: 120, required: true }, { key: 'soft', label: 'Title, grey part', type: 'text', max: 80 },
      { key: 'desc', label: 'Description', type: 'textarea', max: 300 }, SPACE_FIELD,
    ],
    schema: z.object({ number: t(4), label: t(40), title: req(120, 'Add a title.'), soft: t(80), desc: t(300), space }),
    defaults: { number: '01', label: 'Section', title: 'A clear section title', soft: 'with a soft ending.', desc: '', space: 'md' },
    render: (p) => `<section class="${PAD[p.space]}"><div class="wrap">${secHead(p)}</div></section>`,
  }),
  def({
    type: 'rich_text', version: 1, label: 'Text', group: 'Text', description: 'Paragraphs and lists with bold, italic and links.',
    fields: [
      { key: 'title', label: 'Small heading', type: 'text', max: 120 },
      { key: 'body', label: 'Text', type: 'richtext', max: 6000, required: true, hint: 'Blank line = new paragraph. Lines starting with "- " make a list. **bold**, *italic*, [link](about.html).' },
      { key: 'width', label: 'Width', type: 'select', options: [['narrow', 'Reading width'], ['wide', 'Wide']] }, SPACE_FIELD,
    ],
    schema: z.object({ title: t(120), body: req(6000, 'Add some text.'), width: z.enum(['narrow', 'wide']).default('narrow'), space }),
    defaults: { title: '', body: 'Write your text here. Use **bold** for emphasis and [links](about.html) to other pages.', width: 'narrow', space: 'md' },
    render: (p) => `<section class="${PAD[p.space]}"><div class="wrap"><div class="${p.width === 'narrow' ? 'max-w-[68ch]' : ''} space-y-5 text-[17px] leading-[1.75] text-ink-dark">${p.title ? `<h2 class="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink-pure">${esc(p.title)}</h2>` : ''}${richText(p.body)}</div></div></section>`,
  }),
  def({
    type: 'image', version: 1, label: 'Image', group: 'Media', description: 'One photo from the media library, with a caption.',
    fields: [{ key: 'mediaId', label: 'Photo', type: 'media' }, { key: 'caption', label: 'Caption', type: 'text', max: 200 },
      { key: 'size', label: 'Size', type: 'select', options: [['content', 'Content width'], ['wide', 'Full container width']] }, SPACE_FIELD],
    schema: z.object({ mediaId: z.string().uuid().nullable().default(null), caption: t(200), size: z.enum(['content', 'wide']).default('wide'), space }),
    defaults: { mediaId: null, caption: '', size: 'wide', space: 'md' },
    render: (p, ctx) => `<section class="${PAD[p.space]}"><div class="wrap"><figure class="${p.size === 'content' ? 'mx-auto max-w-[900px]' : ''}">${img(ctx.media(p.mediaId), 'aspect-[16/9] w-full rounded-[28px]', '(min-width:1024px) 80vw, 100vw', p.caption || 'Image')}${p.caption ? `<figcaption class="mt-3 text-[13px] text-ink-mid">${esc(p.caption)}</figcaption>` : ''}</figure></div></section>`,
  }),
  def({
    type: 'image_text', version: 1, label: 'Image + text', group: 'Media', description: 'Photo beside a title, text and an optional link.',
    fields: [{ key: 'mediaId', label: 'Photo', type: 'media' }, { key: 'label', label: 'Label', type: 'text', max: 40 },
      { key: 'title', label: 'Title', type: 'text', max: 120, required: true }, { key: 'body', label: 'Text', type: 'richtext', max: 2000 },
      { key: 'linkText', label: 'Link text', type: 'text', max: 40 }, { key: 'linkUrl', label: 'Link', type: 'url', max: 500 },
      { key: 'side', label: 'Photo side', type: 'select', options: [['left', 'Left'], ['right', 'Right']] }, SPACE_FIELD],
    schema: z.object({ mediaId: z.string().uuid().nullable().default(null), label: t(40), title: req(120, 'Add a title.'), body: t(2000), linkText: t(40), linkUrl: url, side: z.enum(['left', 'right']).default('left'), space }),
    defaults: { mediaId: null, label: '', title: 'A title for this story', body: 'Tell the story in two or three sentences.', linkText: '', linkUrl: '', side: 'left', space: 'md' },
    render: (p, ctx) => `<section class="${PAD[p.space]}"><div class="wrap grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-16">
  <div class="lg:col-span-6 ${p.side === 'right' ? 'lg:order-2' : ''}">${img(ctx.media(p.mediaId), 'aspect-[4/3] w-full rounded-[28px]', '(min-width:1024px) 50vw, 100vw', p.title)}</div>
  <div class="lg:col-span-6 ${p.side === 'right' ? 'lg:order-1' : ''}">${p.label ? `<p class="label text-ink-mid">${esc(p.label)}</p>` : ''}
    <h2 class="mt-4 text-[32px] font-semibold leading-[1.06] tracking-[-0.04em] md:text-[42px]">${esc(p.title)}</h2>
    <div class="mt-5 space-y-4 text-[16.5px] leading-relaxed text-ink-dark">${richText(p.body)}</div>
    ${p.linkText && p.linkUrl ? `<a ${linkAttrs(p.linkUrl)} class="btn-dark btn-cta mt-8 min-h-[48px] px-6 text-[14px]">${esc(p.linkText)} ${ARR}</a>` : ''}
  </div></div></section>`,
  }),
  def({
    type: 'stats', version: 1, label: 'Key figures', group: 'Content', description: '2–4 verified figures with labels.',
    fields: [{ key: 'title', label: 'Heading', type: 'text', max: 120 },
      { key: 'items', label: 'Figures', type: 'list', itemLabel: 'Figure', min: 2, max: 4, fields: [{ key: 'value', label: 'Value', type: 'text', max: 12, required: true }, { key: 'label', label: 'Label', type: 'text', max: 80, required: true }], hint: 'Use verified figures only.' },
      { key: 'tone', label: 'Style', type: 'select', options: [['light', 'Light'], ['dark', 'Dark']] }, SPACE_FIELD],
    schema: z.object({ title: t(120), items: z.array(z.object({ value: req(12, 'Add a value.'), label: req(80, 'Add a label.') })).min(2).max(4), tone: z.enum(['light', 'dark']).default('light'), space }),
    defaults: { title: '', items: [{ value: '2007', label: 'Founded in Ait Ourir' }, { value: '4', label: 'Strategic pillars' }], tone: 'light', space: 'md' },
    render: (p) => `<section class="${PAD[p.space]}"><div class="wrap"><div class="${p.tone === 'dark' ? 'os-band on-dark text-white' : 'rounded-[28px] border border-ink-light p-6 md:p-10'}">
  ${p.title ? `<h2 class="text-[24px] font-semibold tracking-[-0.03em]">${esc(p.title)}</h2>` : ''}
  <dl class="${p.title ? 'mt-8 ' : ''}grid grid-cols-2 gap-6 lg:grid-cols-4">${p.items.map((i) => `<div><dd class="text-[36px] font-semibold leading-none tracking-[-0.05em] tabular-nums sm:text-[44px] lg:text-[56px]">${esc(i.value)}</dd><dt class="mt-3 text-[14px] ${p.tone === 'dark' ? 'text-white/65' : 'text-ink-mid'}">${esc(i.label)}</dt></div>`).join('')}</dl>
</div></div></section>`,
  }),
  def({
    type: 'cards', version: 1, label: 'Link cards', group: 'Content', description: '2–6 cards that each link somewhere.',
    fields: [{ key: 'items', label: 'Cards', type: 'list', itemLabel: 'Card', min: 2, max: 6, fields: [
      { key: 'title', label: 'Title', type: 'text', max: 60, required: true }, { key: 'text', label: 'Text', type: 'textarea', max: 200 }, { key: 'url', label: 'Link', type: 'url', max: 500 }] },
      { key: 'columns', label: 'Columns on desktop', type: 'select', options: [['2', '2'], ['3', '3'], ['4', '4']] }, SPACE_FIELD],
    schema: z.object({ items: z.array(z.object({ title: req(60, 'Add a title.'), text: t(200), url })).min(2).max(6), columns: z.enum(['2', '3', '4']).default('3'), space }),
    defaults: { items: [{ title: 'Volunteer', text: 'Give time to activities in Ait Ourir and beyond.', url: 'get-involved.html#volunteer' }, { title: 'Partner with us', text: 'Co-design and fund community initiatives.', url: 'get-involved.html#partner' }, { title: 'Contact', text: 'Questions, partnerships or press.', url: 'contact.html' }], columns: '3', space: 'md' },
    render: (p) => `<section class="${PAD[p.space]}"><div class="wrap"><ul class="grid gap-3 sm:grid-cols-2 ${{ '2': 'lg:grid-cols-2', '3': 'lg:grid-cols-3', '4': 'lg:grid-cols-4' }[p.columns]}">${p.items.map((c, i) => `<li><a ${linkAttrs(c.url || '#')} class="gi-tile group"><span class="flex items-center justify-between"><span class="text-[12px] tabular-nums text-ink-mid">${String(i + 1).padStart(2, '0')}</span><span class="gi-arr" aria-hidden="true">↗</span></span><span class="mt-3 block text-[20px] font-semibold leading-[1.1] tracking-[-0.03em] sm:mt-8 md:text-[24px]">${esc(c.title)}</span>${c.text ? `<span class="mt-2 block text-[14px] leading-relaxed text-ink-dark">${esc(c.text)}</span>` : ''}</a></li>`).join('')}</ul></div></section>`,
  }),
  def({
    type: 'project_list', version: 1, label: 'Projects', group: 'Content', description: 'Live projects from Studio, by pillar or hand-picked. Updates when projects are published.',
    fields: [{ key: 'title', label: 'Heading', type: 'text', max: 120 },
      { key: 'mode', label: 'Show', type: 'select', options: [['pillar', 'Projects of a pillar'], ['selected', 'Hand-picked projects'], ['all', 'All live projects']] },
      { key: 'pillar', label: 'Pillar', type: 'pillar', hint: 'Used when “Projects of a pillar” is chosen.' },
      { key: 'projectSlugs', label: 'Projects', type: 'projects', hint: 'Used when “Hand-picked projects” is chosen.' },
      { key: 'limit', label: 'Maximum', type: 'select', options: [['3', '3'], ['6', '6'], ['9', '9'], ['12', '12']] }, SPACE_FIELD],
    schema: z.object({ title: t(120), mode: z.enum(['pillar', 'selected', 'all']).default('all'), pillar: t(40), projectSlugs: z.array(z.string().max(80)).max(12).default([]), limit: z.enum(['3', '6', '9', '12']).default('6'), space }),
    defaults: { title: 'Our projects', mode: 'all', pillar: '', projectSlugs: [], limit: '6', space: 'md' },
    render: (p, ctx) => {
      let list = ctx.projects;
      if (p.mode === 'pillar') list = list.filter((x) => x.pillars.includes(p.pillar));
      if (p.mode === 'selected') list = p.projectSlugs.map((s) => list.find((x) => x.slug === s)).filter(Boolean) as ProjectCard[];
      list = list.slice(0, Number(p.limit));
      const cards = list.map((x) => {
        const inner = `<div class="relative">${img(x.hero, 'aspect-[16/10] w-full rounded-[20px]', '(min-width:1024px) 33vw, 100vw', x.name)}<span class="nw-type">${esc(x.category)}</span></div><span class="mt-5 flex items-center gap-2 px-2.5 text-[12.5px] font-medium"><span class="pj-dot" style="--c:${esc(x.colour)}"></span>${esc(x.pillar)}</span><span class="mt-2 block px-2.5 text-[21px] font-semibold leading-[1.2] tracking-[-0.025em]">${esc(x.name)}</span>${x.summary ? `<span class="mt-2 block px-2.5 text-[14.5px] leading-relaxed text-ink-dark">${esc(x.summary)}</span>` : ''}${x.file ? `<span class="nw-read px-2.5">Explore project <span aria-hidden="true">↗</span></span>` : ''}`;
        return x.file ? `<li><a href="${esc(x.file)}" class="nw-card group">${inner}</a></li>` : `<li><div class="nw-card">${inner}</div></li>`;
      }).join('');
      return `<section class="${PAD[p.space]}"><div class="wrap">${p.title ? `<h2 class="text-[30px] font-semibold tracking-[-0.04em] md:text-[40px]">${esc(p.title)}</h2>` : ''}${list.length ? `<ul class="nw-grid ${p.title ? 'mt-8' : ''}">${cards}</ul>` : `<p class="mt-6 text-ink-mid">${ctx.editor ? 'No live projects match yet.' : ''}</p>`}</div></section>`;
    },
  }),
  def({
    type: 'quote', version: 1, label: 'Quote', group: 'Text', description: 'A highlighted quote with attribution.',
    fields: [{ key: 'text', label: 'Quote', type: 'textarea', max: 400, required: true, hint: 'Only quotes with the person’s consent.' }, { key: 'name', label: 'Name', type: 'text', max: 80 }, { key: 'role', label: 'Role', type: 'text', max: 120 },
      { key: 'tone', label: 'Style', type: 'select', options: [['light', 'Light'], ['dark', 'Dark']] }, SPACE_FIELD],
    schema: z.object({ text: req(400, 'Add the quote.'), name: t(80), role: t(120), tone: z.enum(['light', 'dark']).default('light'), space }),
    defaults: { text: 'With communities, not simply for communities.', name: 'AFCD Foundation', role: '', tone: 'light', space: 'md' },
    render: (p) => `<section class="${PAD[p.space]}"><div class="wrap"><figure class="${p.tone === 'dark' ? 'os-band on-dark text-white' : 'rounded-[28px] bg-[#F6F6F6] p-8 md:p-12'}"><blockquote class="max-w-[30ch] text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] md:text-[44px]">“${esc(p.text)}”</blockquote>${p.name ? `<figcaption class="mt-6 text-[14px] ${p.tone === 'dark' ? 'text-white/65' : 'text-ink-mid'}"><b class="${p.tone === 'dark' ? 'text-white' : 'text-ink-pure'}">${esc(p.name)}</b>${p.role ? ` · ${esc(p.role)}` : ''}</figcaption>` : ''}</figure></div></section>`,
  }),
  def({
    type: 'accordion', version: 1, label: 'Questions (accordion)', group: 'Text', description: 'Questions that open to show the answer.',
    fields: [{ key: 'title', label: 'Heading', type: 'text', max: 120 },
      { key: 'items', label: 'Questions', type: 'list', itemLabel: 'Question', min: 1, max: 12, fields: [{ key: 'q', label: 'Question', type: 'text', max: 160, required: true }, { key: 'a', label: 'Answer', type: 'richtext', max: 1500, required: true }] }, SPACE_FIELD],
    schema: z.object({ title: t(120), items: z.array(z.object({ q: req(160, 'Add the question.'), a: req(1500, 'Add the answer.') })).min(1).max(12), space }),
    defaults: { title: 'Questions', items: [{ q: 'A frequent question?', a: 'A short, clear answer.' }], space: 'md' },
    render: (p) => `<section class="${PAD[p.space]}"><div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">${p.title ? `<h2 class="text-[30px] font-semibold tracking-[-0.04em] md:text-[40px] lg:col-span-4">${esc(p.title)}</h2>` : ''}<div class="grid gap-2 ${p.title ? 'lg:col-span-8' : 'lg:col-span-12'}">${p.items.map((i, n) => `<details class="ct-faq"${n === 0 ? ' open' : ''}><summary><span>${esc(i.q)}</span><span class="ct-faq-ic" aria-hidden="true">+</span></summary><div class="ct-faq-a space-y-3">${richText(i.a)}</div></details>`).join('')}</div></div></section>`,
  }),
  def({
    type: 'cta', version: 1, label: 'Call to action', group: 'Action', description: 'The site’s call-to-action card with two buttons.',
    fields: [{ key: 'kicker', label: 'Kicker', type: 'text', max: 30 }, { key: 'title', label: 'Title', type: 'text', max: 100, required: true }, { key: 'text', label: 'Text', type: 'textarea', max: 300 },
      { key: 'primaryText', label: 'Main button', type: 'text', max: 30 }, { key: 'primaryUrl', label: 'Main button link', type: 'url', max: 500 },
      { key: 'secondaryText', label: 'Second link', type: 'text', max: 30 }, { key: 'secondaryUrl', label: 'Second link URL', type: 'url', max: 500 }],
    schema: z.object({ kicker: t(30), title: req(100, 'Add a title.'), text: t(300), primaryText: t(30), primaryUrl: url, secondaryText: t(30), secondaryUrl: url }),
    defaults: { kicker: 'Get involved', title: 'Let’s create change together.', text: 'Join our community, explore opportunities or collaborate with AFCD Foundation.', primaryText: 'Get Involved', primaryUrl: 'get-involved.html', secondaryText: 'Contact us', secondaryUrl: 'contact.html' },
    render: (p) => `<section class="cta-wrap py-10 lg:py-14"><div class="wrap"><div class="cta-card"><div class="cta-glow" aria-hidden="true"></div><div class="max-w-[760px]">
  ${p.kicker ? `<span class="cta-kicker"><span class="tb-dot" aria-hidden="true"></span>${esc(p.kicker)}</span>` : ''}
  <h2 class="mt-6 text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] md:text-[56px]" style="text-wrap:balance">${esc(p.title)}</h2>
  ${p.text ? `<p class="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-ink-dark md:text-[17px]">${esc(p.text)}</p>` : ''}
  <div class="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">${p.primaryText && p.primaryUrl ? `<a ${linkAttrs(p.primaryUrl)} class="btn-dark btn-cta min-h-[50px] px-7">${esc(p.primaryText)} ${ARR}</a>` : ''}${p.secondaryText && p.secondaryUrl ? `<a ${linkAttrs(p.secondaryUrl)} class="link-arrow">${esc(p.secondaryText)} ${ARR}</a>` : ''}</div>
</div></div></div></section>`,
  }),
  def({
    type: 'divider', version: 1, label: 'Divider', group: 'Structure', description: 'A thin line between sections.',
    fields: [], schema: z.object({}), defaults: {},
    render: () => `<div class="wrap"><hr class="border-0 border-t border-ink-light"></div>`,
  }),
  def({
    type: 'spacer', version: 1, label: 'Spacer', group: 'Structure', description: 'Extra space between sections.',
    fields: [{ key: 'size', label: 'Size', type: 'select', options: [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] }],
    schema: z.object({ size: z.enum(['sm', 'md', 'lg']).default('md') }), defaults: { size: 'md' },
    render: (p) => `<div aria-hidden="true" class="${{ sm: 'h-6', md: 'h-12', lg: 'h-24' }[p.size]}"></div>`,
  }),
];

export const BLOCK_MAP = new Map(BLOCKS.map((b) => [b.type, b]));
export const DOC_VERSION = 1;

export const blockSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,24}$/),
  type: z.string(),
  v: z.number().int().min(1),
  hidden: z.boolean().default(false),
  props: z.record(z.string(), z.unknown()),
});
export const docSchema = z.object({ version: z.literal(DOC_VERSION), blocks: z.array(blockSchema).max(60) });
export type Block = z.infer<typeof blockSchema>;
export type Doc = z.infer<typeof docSchema>;

/** Upgrades older block versions, then validates every block's props against its schema. */
export function validateDoc(raw: unknown): { doc: Doc; problems: { path: string; message: string }[] } {
  const parsed = docSchema.safeParse(raw);
  if (!parsed.success) return { doc: { version: 1, blocks: [] }, problems: [{ path: 'doc', message: 'The page layout is not valid.' }] };
  const problems: { path: string; message: string }[] = [];
  const blocks = parsed.data.blocks.map((b, i) => {
    const d = BLOCK_MAP.get(b.type);
    if (!d) { problems.push({ path: `blocks.${i}`, message: `Unknown block “${b.type}”.` }); return b; }
    let props = b.props;
    if (b.v < d.version && d.migrate) props = d.migrate(b.v, props);
    if (b.v > d.version) problems.push({ path: `blocks.${i}`, message: `${d.label} was saved by a newer Studio version.` });
    const r = d.schema.safeParse(props);
    if (!r.success) { for (const iss of r.error.issues) problems.push({ path: `blocks.${i}.${iss.path.join('.')}`, message: `${d.label}: ${iss.message}` }); return { ...b, props }; }
    return { ...b, v: d.version, props: r.data as Record<string, unknown> };
  });
  return { doc: { version: 1, blocks }, problems };
}

/** Renders the visible blocks. In editor mode each block is wrapped so the canvas can select it. */
export function renderBlocks(doc: Doc, ctx: RenderCtx) {
  return doc.blocks.map((b) => {
    const d = BLOCK_MAP.get(b.type);
    if (!d || (b.hidden && !ctx.editor)) return '';
    const r = d.schema.safeParse(b.props);
    const html = r.success ? d.render(r.data as never, ctx) : (ctx.editor ? `<div class="wrap py-6"><p class="rounded-2xl border border-dashed border-ink-light p-4 text-[13px] text-ink-mid">${esc(d.label)}: complete the required fields.</p></div>` : '');
    return ctx.editor ? `<div data-block-id="${b.id}"${b.hidden ? ' data-hidden="1"' : ''}>${html}</div>` : html;
  }).join('\n');
}

/** Field metadata for the admin app (no render functions). */
export const blockCatalog = () => BLOCKS.map(({ type, version, label, group, description, fields, defaults }) => ({ type, version, label, group, description, fields, defaults }));
