// Reads the editable fields of a hand-written page from its data-sf markers (the same markers build.mjs applies).
// The page source is the single source of the default values: when the website team changes a text, Studio shows it.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitSections } from '../../../../../lib/page-fields.mjs';

export type FieldType = 'text' | 'split' | 'rich' | 'link' | 'tail' | 'image' | 'stories';
export type Story = { quote: string; name: string; role: string; caption: string; sample?: boolean };
export type FieldDef = { key: string; type: FieldType; section: string; sectionId: string | null; label: string; default: unknown; tag: string };

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const attr = (tag: string, n: string) => tag.match(new RegExp(`\\s${n}="([^"]*)"`))?.[1] ?? '';

function closeIndex(html: string, tag: string, from: number) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi'); re.lastIndex = from; let depth = 1; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) return m.index; }
  return -1;
}

export const SECTION_LABEL: Record<string, string> = {
  'hero.1': 'Hero · slide 1', 'hero.2': 'Hero · slide 2', 'hero.3': 'Hero · slide 3', 'hero.4': 'Hero · slide 4',
  about: 'Who we are', purpose: 'Our purpose', pillars: 'Pillars', projects: 'Featured projects', impact: 'Impact', news: 'News & stories', events: 'Events', partners: 'Partners', involved: 'Get involved',
};
const FIELD_LABEL: Record<string, string> = {
  kicker: 'Small line above the title', title: 'Title', text: 'Text', cta1: 'Main button', cta2: 'Second link', image: 'Photo', chapter: 'Chapter label (bottom bar)',
  desc: 'Introduction', quote: 'Quote', quote_name: 'Quote: name', quote_role: 'Quote: programme and date', benefit: '“Who has benefited” text',
  'stat1.label': 'Figure 1 · label', 'stat1.value': 'Figure 1 · value', 'stat2.label': 'Figure 2 · label', 'stat2.value': 'Figure 2 · value',
  'stat3.label': 'Figure 3 · label', 'stat3.value': 'Figure 3 · value', 'stat4.label': 'Figure 4 · label',
  'stat1.text': 'Figure 1 · description', 'stat2.text': 'Figure 2 · description', 'stat3.text': 'Figure 3 · description',
  image2: 'Second photo', stories: 'Participant stories',
  // the numbered header line of a section: pill, label, thin rule, then a caption or a link on the right
  // contact page
  lead: 'Introduction', phone: 'Phone number', 'phone.label': 'Phone · card title', email1: 'First email address', 'email1.label': 'First email · card title',
  email2: 'Second email address', 'email2.label': 'Second email · card title', office: 'Office · city', 'office.label': 'Office · card title',
  'office.title': 'Office · heading', 'office.text': 'Office · text', 'to1.label': 'Who to contact 1 · topic', 'to1.email': 'Who to contact 1 · email',
  'to2.label': 'Who to contact 2 · topic', 'to2.email': 'Who to contact 2 · email', 'to3.label': 'Who to contact 3 · topic', 'to3.email': 'Who to contact 3 · email',
  q1: 'Question 1', a1: 'Answer 1', link1: 'Answer 1 · link', q2: 'Question 2', a2: 'Answer 2', link2: 'Answer 2 · link',
  q3: 'Question 3', a3: 'Answer 3', link3: 'Answer 3 · link', q4: 'Question 4', a4: 'Answer 4', link4: 'Answer 4 · link', access: 'Accessibility text',
  'head.num': 'Header · number', 'head.label': 'Header · label', 'head.meta': 'Header · right-hand caption', 'head.link': 'Header · right-hand link',
};

/** The stories of a participant-stories carousel as written in the page (see "stories" in lib/page-fields.mjs). */
function readStories(inner: string): Story[] {
  return (inner.match(/<article class="tm-slide[\s\S]*?<\/article>/g) ?? []).map((a) => {
    const cap = a.match(/<span class="ph-cap tm-cap">([\s\S]*?)<\/span><\/div>/)?.[1] ?? '';
    return {
      quote: strip(a.match(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/)?.[1] ?? ''),
      name: strip(a.match(/<span class="block font-medium">([^<]*)<\/span>/)?.[1] ?? ''),
      role: strip(a.match(/<span class="block text-white\/65">([^<]*)<\/span>/)?.[1] ?? ''),
      caption: strip(cap.replace(/^<b>Photo<\/b>\s*·\s*/, '')),
      ...(a.includes('<span class="tm-sample">') ? { sample: true } : {}),
    };
  });
}

/** Field definitions in page order. Mirrors (data-sf-type="plain") are not separate fields. */
export function readFields(siteRoot: string, file: string): FieldDef[] {
  const p = resolve(siteRoot, 'src/pages', file);
  if (!/^[a-z0-9-]+\.html$/.test(file) || !existsSync(p)) return [];
  const html = readFileSync(p, 'utf8');
  const out = new Map<string, FieldDef>();
  // which top-level <section> each marker sits in (the homepage editor shows a section's fields when it is selected)
  const fm = html.match(/^---\n[\s\S]*?\n---\n/)?.[0] ?? '';
  const ranges: { id: string | null; from: number; to: number }[] = []; let pos = fm.length;
  for (const [i, part] of splitSections(html.slice(fm.length)).parts.entries()) { ranges.push({ id: partId(part, i), from: pos, to: pos + part.html.length }); pos += part.html.length; }
  const sectionAt = (i: number) => ranges.find((r) => i >= r.from && i < r.to)?.id ?? null;
  const re = /<([a-z][a-z0-9]*)\b[^>]*\sdata-sf="([^"]+)"[^>]*>/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [raw, tag, key] = m;
    const type = (attr(raw, 'data-sf-type') || 'text') as FieldType | 'plain' | 'email' | 'tel' | 'mailto';
    if (out.has(key) || type === 'tel' || type === 'mailto') continue;   // links that only follow a field shown inside them
    // "plain" marks a copy of a field defined elsewhere on the page; a key that only appears as plain is a normal text field
    if (type === 'plain' && new RegExp(`data-sf="${key.replace(/\./g, '\\.')}"(?![^>]*data-sf-type="plain")`).test(html)) continue;
    let def: unknown = '';
    if (tag === 'img') def = { src: attr(raw, 'src'), alt: decode(attr(raw, 'alt')), w: Number(attr(raw, 'width')), h: Number(attr(raw, 'height')) };
    else {
      const end = closeIndex(html, tag, m.index + raw.length); const inner = end < 0 ? '' : html.slice(m.index + raw.length, end);
      if (type === 'split') { const i = inner.indexOf('<span'); def = { main: strip(i >= 0 ? inner.slice(0, i) : inner), soft: i >= 0 ? strip(inner.slice(i)) : '' }; }
      else if (type === 'link') def = { label: strip(inner.replace(/<span[\s\S]*$/, '')), href: decode(attr(raw, 'href')) };
      else if (type === 'rich') def = decode(inner.replace(/<span[^>]*>([\s\S]*?)<\/span>/g, '**$1**').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      else if (type === 'tail') def = strip(inner.slice(inner.lastIndexOf('</span>') + 7));
      else if (type === 'stories') def = readStories(inner);
      else def = strip(inner);
    }
    const dot = key.indexOf('.'); const section = key.startsWith('hero.') ? key.split('.').slice(0, 2).join('.') : key.slice(0, dot);
    const rest = key.slice(section.length + 1);
    out.set(key, { key, type: (type === 'plain' || type === 'email' ? 'text' : type) as FieldType, section, sectionId: sectionAt(m.index), label: FIELD_LABEL[rest] ?? rest, default: def, tag });
  }
  return [...out.values()];
}

/** A top-level section's id, or a stable stand-in for one written without an id (the contact page's header). Used for
 *  grouping fields in the editor and selecting them on the canvas only; it is never written to the page. */
export const partId = (part: { id: string | null }, i: number) => part.id ?? `section-${i + 1}`;

/** The page's top-level sections in source order, with readable names. */
export const SITE_SECTION_LABEL: Record<string, string> = {
  hero: 'Hero slider', 'who-we-are': 'Who we are', purpose: 'Our purpose', pillars: 'Strategic pillars', projects: 'Featured projects', impact: 'Our impact',
  news: 'News & stories', events: 'Upcoming events', partners: 'Partners', 'get-involved': 'Get involved', opportunities: 'Opportunities',
};
/** Sections of the pages edited as text only (no layout), by field prefix. */
export const TEXT_SECTION_LABEL: Record<string, string> = { head: 'Page header', reach: 'Contact details', message: 'Message and office', faq: 'Questions', policy: 'Privacy and accessibility' };
/** Every top-level section that has fields, in page order (pages edited as text only). */
export function fieldSections(siteRoot: string, file: string) {
  const seen = new Map<string, string>();
  for (const f of readFields(siteRoot, file)) if (f.sectionId && !seen.has(f.sectionId)) seen.set(f.sectionId, TEXT_SECTION_LABEL[f.section] ?? f.section);
  return [...seen].map(([id, label]) => ({ id, label }));
}
export function pageBody(siteRoot: string, file: string) {
  const p = resolve(siteRoot, 'src/pages', file);
  if (!/^[a-z0-9-]+\.html$/.test(file) || !existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}
export function siteSections(siteRoot: string, file: string) {
  return splitSections(pageBody(siteRoot, file)).parts.filter((p) => p.id).map((p) => ({ id: p.id as string, label: SITE_SECTION_LABEL[p.id as string] ?? (p.id as string).replace(/-/g, ' ') }));
}
