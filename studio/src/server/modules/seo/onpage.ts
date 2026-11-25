// On-page SEO checklist for every page of the website build, after the on-page checklist Semrush publishes
// (target keyword, title, H1, meta description, URL, keyword in the content, content quality, structure, links,
// images, structured data, crawling, speed, mobile) plus link previews.
// Automatic checks read the built HTML only (the same build the SEO audit checks) and reuse the audit's findings where
// they overlap, so the checklist, the Issues list and the scores never disagree. What HTML cannot show (search intent,
// accuracy, originality, use on a phone) is a manual review that a person ticks; Studio records who and when, and
// asks again when the page's text changes. Keyword volume, rankings and Core Web Vitals need outside data and are
// not estimated here.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { seoSettings, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { runBuildAudit, robotsAccess, decode, attr, meta, htmlText, type BuildAudit, type Finding, type PageScan } from './engine.ts';
export { robotsAccess };
import { siteUrl } from './site.ts';
import { owners, type Owner } from './service.ts';

// ---------------------------------------------------------------- Types
export type OnStatus = 'pass' | 'warn' | 'fail' | 'info' | 'na' | 'todo' | 'done';
export type OnGroup = 'keyword' | 'title' | 'h1' | 'meta' | 'url' | 'body' | 'quality' | 'structure' | 'links' | 'images' | 'schema' | 'crawl' | 'speed' | 'mobile' | 'social';
export type OnCheck = {
  id: string; group: OnGroup; label: string; status: OnStatus; detail: string; fix: string;
  manual?: boolean; reviewedBy?: string | null; reviewedAt?: string | null; changed?: boolean; codes?: string[];
};
export const GROUPS: [OnGroup, string][] = [
  ['keyword', 'Target keyword'], ['title', 'Title tag'], ['h1', 'Main heading (H1)'], ['meta', 'Meta description'], ['url', 'URL'],
  ['body', 'Keyword in the content'], ['quality', 'Content quality'], ['structure', 'Structure'], ['links', 'Links'], ['images', 'Images'],
  ['schema', 'Structured data'], ['crawl', 'Crawling and indexing'], ['speed', 'Page speed (build)'], ['mobile', 'Mobile'], ['social', 'Link previews'],
];
/** The keyword and content half of the score; the rest is the technical half. */
export const CONTENT_GROUPS: OnGroup[] = ['keyword', 'title', 'h1', 'meta', 'url', 'body', 'quality', 'structure'];
export const INTENTS = ['informational', 'navigational', 'commercial', 'transactional'] as const;
export type Intent = typeof INTENTS[number];
/** Reviews only a person can make. Each is recorded with who ticked it and the page text it was ticked against. */
export const MANUAL: { id: string; group: OnGroup; label: string; fix: string }[] = [
  { id: 'manual.intent', group: 'keyword', label: 'The page matches the search intent', fix: 'Search the keyphrase on Google and look at what ranks. If people want a guide, a list or a contact page, the page should offer that.' },
  { id: 'manual.accurate', group: 'quality', label: 'Facts are accurate and up to date', fix: 'Check dates, numbers, names and links. Fix anything outdated.' },
  { id: 'manual.original', group: 'quality', label: 'Original and genuinely helpful', fix: 'The page should say something the top results do not: AFCD’s own work, results and voices. It must not repeat another page.' },
  { id: 'manual.phone', group: 'mobile', label: 'Checked on a phone', fix: 'Open the page on a phone: text readable without zooming, buttons easy to tap, nothing cut off.' },
];

export type PageState = { keyphrase: string; intent: Intent | ''; manual: Record<string, { by: string | null; at: string; hash: string }> };
const EMPTY: PageState = { keyphrase: '', intent: '', manual: {} };
const KEY = (file: string) => `onpage:${file}`;
const FILE = /^[a-z0-9][a-z0-9-]*\.html$/;

// ---------------------------------------------------------------- Text helpers
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'at', 'by', 'from', 'is', 'are', 'your', 'our', 'de', 'la', 'le', 'les', 'et', 'du', 'des']);
/** Lowercase, without accents or punctuation: “Women’s Empowerment” → “women s empowerment”. */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s: string) => norm(s).split(' ').filter(Boolean);
const sig = (s: string) => words(s).filter((w) => w.length > 2 && !STOP.has(w));
/** 'full' when the phrase appears as written, 'partial' when every meaningful word appears, else 'none'. */
export function match(hay: string, kp: string): 'full' | 'partial' | 'none' {
  const h = ` ${norm(hay)} `, k = norm(kp);
  if (!k) return 'none';
  if (h.includes(` ${k} `)) return 'full';
  const ws = sig(kp);
  return ws.length && ws.every((w) => h.includes(` ${w} `)) ? 'partial' : 'none';
}
const countPhrase = (hay: string, kp: string) => { const k = norm(kp); if (!k) return 0; const h = ` ${norm(hay)} `; let n = 0, i = 0; while ((i = h.indexOf(` ${k} `, i)) !== -1) { n++; i += k.length + 1; } return n; };
const syllables = (w: string) => { const x = w.toLowerCase().replace(/[^a-z]/g, ''); if (!x) return 0; if (x.length <= 3) return 1; const m = x.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g); return Math.max(1, m?.length ?? 1); };
/** Flesch reading ease (English): 60–70 is plain English, below 50 is hard going. */
export function flesch(text: string) {
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().split(/\s+/).length > 2).length;
  const ws = text.match(/[A-Za-z’']+/g) ?? [];
  if (ws.length < 80 || !sentences) return null;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return Math.max(0, Math.min(100, Math.round(206.835 - 1.015 * (ws.length / sentences) - 84.6 * (syl / ws.length))));
}
const ease = (n: number) => (n >= 70 ? 'easy' : n >= 60 ? 'plain English' : n >= 50 ? 'fairly difficult' : n >= 30 ? 'difficult' : 'very difficult');
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- Page facts read from the built HTML
type Facts = {
  html: string; head: string; main: string; afterH1: string; first100: string; bodyText: string;
  paragraphs: string[]; subheads: string[]; anchors: { href: string; text: string }[]; external: string[];
  images: { src: string; alt: string | null }[]; viewport: string; twitter: string; headScripts: string[]; size: number; lang: string;
};
function facts(root: string, file: string, host: string): Facts {
  const html = readFileSync(resolve(root, file), 'utf8');
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? '';
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const h1at = main.search(/<h1\b/i);
  const afterH1 = h1at >= 0 ? main.slice(h1at) : main;
  const bodyText = htmlText(afterH1);
  const anchors = [...main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: decode(attr(` ${m[1]}`, 'href') ?? ''), text: htmlText(m[2]) || decode(attr(` ${m[1]}`, 'aria-label') ?? '') }));
  const external = [...new Set(anchors.map((a) => a.href).filter((h) => /^https?:\/\//i.test(h)).filter((h) => { try { return new URL(h).hostname.replace(/^www\./, '') !== host.replace(/^www\./, ''); } catch { return false; } }))];
  return {
    html, head, main, afterH1, bodyText, first100: bodyText.split(' ').slice(0, 100).join(' '),
    paragraphs: [...afterH1.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => htmlText(m[1])).filter(Boolean),
    subheads: [...main.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => htmlText(m[2])),
    anchors, external,
    images: [...main.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ src: attr(m[0], 'src') ?? '', alt: attr(m[0], 'alt') })),
    viewport: meta(html, 'viewport'), twitter: meta(html, 'twitter:card'),
    headScripts: [...head.matchAll(/<script\b[^>]*\ssrc="[^"]*"[^>]*>/gi)].map((m) => m[0]).filter((t) => !/\s(async|defer)\b|type="module"/i.test(t)),
    size: Buffer.byteLength(html), lang: html.match(/<html[^>]*\slang="([^"]*)"/i)?.[1] ?? '',
  };
}
export const contentHash = (f: { bodyText: string }) => createHash('sha256').update(f.bodyText).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- The checklist for one page
const LISTING = new Set(['contact.html', 'team.html', 'news.html', 'events.html', 'projects.html', 'partners.html', 'opportunities.html', 'publications.html', 'pillars.html', 'get-involved.html']);
const GENERIC_ANCHOR = /^(click here|here|this link|link|read this|this page|more|go)$/i;
const SEARCH_BOTS = ['Googlebot', 'Bingbot'];
const AI_BOTS = ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Google-Extended'];

/** How much each check weighs in the score (default 2): the target keyword, title, H1, description and indexability
 *  matter most in the on-page checklist; address details and optional extras least. */
const WEIGHT: Record<string, number> = {
  'kw.set': 4, 'title.present': 4, 'title.kw': 4, 'h1.one': 3, 'h1.kw': 3, 'meta.present': 3, 'meta.kw': 2, 'body.first': 3, 'body.count': 3,
  'c.robots': 4, 'c.index': 4, 'c.canonical': 3, 'l.broken': 3, 'q.placeholder': 3, 'm.viewport': 3, 'q.words': 2,
  'url.filler': 1, 'url.date': 1, 'url.format': 1, 'url.kw': 1, 'title.kw-start': 1, 'twitter': 1, 'sp.html': 1, 'sp.blocking': 1,
  'l.anchors': 1, 'l.redirect': 1, 'i.format': 1, 'i.dims': 1, 'q.paragraphs': 1, 'h1.title': 1, 'm.lang': 1, 'c.sitemap': 2,
};

export type Ctx = { audit: BuildAudit; root: string; robots: string; focusOf: Map<string, string[]>; reviewers: Map<string, string> };

export function pageChecklist(ctx: Ctx, p: PageScan, st: PageState) {
  const host = new URL(ctx.audit.site).hostname;
  const f = facts(ctx.root, p.file, host);
  const found = ctx.audit.findings.filter((x) => x.file === p.file);
  const hit = (...codes: string[]) => found.filter((x) => codes.includes(x.code));
  const is404 = p.file === '404.html';
  const kp = st.keyphrase.trim();
  const out: OnCheck[] = [];
  const add = (c: Omit<OnCheck, 'status' | 'detail'> & { status: OnStatus; detail: string }) => out.push(c);
  /** a check backed by audit rules: worst finding decides (critical/high = fail, medium/low = warn, info = info) */
  const fromAudit = (id: string, group: OnGroup, label: string, codes: string[], pass: string, fix: string) => {
    const h = hit(...codes);
    if (!h.length) return add({ id, group, label, status: 'pass', detail: pass, fix, codes });
    const sev = (x: Finding) => (x.severity === 'critical' || x.severity === 'high' ? 'fail' : x.severity === 'info' ? 'info' : 'warn');
    const status = h.map(sev).sort((a, b) => ['fail', 'warn', 'info'].indexOf(a) - ['fail', 'warn', 'info'].indexOf(b))[0] as OnStatus;
    add({ id, group, label, status, detail: h.map((x) => (x.evidence[0] ? `${x.title}: ${x.evidence[0]}` : x.title)).join(' · '), fix: h[0].fix || fix, codes });
  };
  const needKp = (id: string, group: OnGroup, label: string, fix: string) => add({ id, group, label, status: 'na', detail: 'Set a focus keyphrase to run this check.', fix });
  const kwCheck = (id: string, group: OnGroup, label: string, where: string, hay: string, fix: string, missing: OnStatus = 'fail') => {
    if (!kp) return needKp(id, group, label, fix);
    const m = match(hay, kp);
    add({ id, group, label, status: m === 'full' ? 'pass' : m === 'partial' ? 'warn' : missing, detail: m === 'full' ? `“${kp}” is in the ${where}.` : m === 'partial' ? `The words of “${kp}” are in the ${where}, but not as one phrase.` : `“${kp}” is not in the ${where}.`, fix });
  };

  // 1. Target keyword
  if (!kp) add({ id: 'kw.set', group: 'keyword', label: 'Focus keyphrase chosen', status: is404 ? 'na' : 'fail', detail: is404 ? 'Not needed on the error page.' : 'No focus keyphrase yet. Keyword checks below are waiting for one.', fix: 'Choose the search phrase this page should be found for (for example “youth leadership programme Morocco”) and enter it above. Pick one per page.' });
  else {
    add({ id: 'kw.set', group: 'keyword', label: 'Focus keyphrase chosen', status: 'pass', detail: `“${kp}”${st.intent ? ` · ${st.intent} intent` : ''}`, fix: '' });
    const others = (ctx.focusOf.get(norm(kp)) ?? []).filter((x) => x !== p.file);
    add({ id: 'kw.unique', group: 'keyword', label: 'Not the focus of another page', status: others.length ? 'warn' : 'pass', detail: others.length ? `Also the focus of ${others.join(', ')}: the pages compete with each other.` : 'No other page targets it.', fix: 'Give each page its own keyphrase. If two pages answer the same search, merge them or link one to the other.' });
  }

  // 2. Title tag
  fromAudit('title.present', 'title', 'Title tag present', ['tech.title-missing'], `“${clip(p.title, 70)}”`, 'Add a descriptive title in the page’s editor or SEO settings.');
  if (p.title) add({ id: 'title.length', group: 'title', label: 'Title fits in search results (about 60 characters)', status: p.title.length <= 60 ? 'pass' : 'warn', detail: `${p.title.length} characters${p.title.length > 60 ? ': the end may be cut off' : ''}.`, fix: 'Keep the most important words first and the whole title under about 60 characters.', codes: ['meta.title-long'] });
  kwCheck('title.kw', 'title', 'Keyphrase in the title', 'title', p.title, 'Put the keyphrase in the title, close to the start, written naturally.');
  if (kp && p.title) { const i = norm(p.title).indexOf(norm(kp)); add({ id: 'title.kw-start', group: 'title', label: 'Keyphrase near the start of the title', status: i < 0 ? 'na' : i <= norm(p.title).length / 2 ? 'pass' : 'warn', detail: i < 0 ? 'The keyphrase is not in the title yet.' : i <= norm(p.title).length / 2 ? 'In the first half of the title.' : 'In the second half of the title.', fix: 'Lead with the keyphrase; the site name can come last.' }); }
  fromAudit('title.escape', 'title', 'Shows correctly in results (no “&amp;”)', ['tech.double-escaped'], 'No text escaped twice.', 'Report it to the website team: a title or description is escaped twice.');
  fromAudit('title.unique', 'title', 'Title used only on this page', ['meta.title-dup', 'meta.title-vague'], 'Unique and descriptive.', 'Give each page a title that names its own subject.');

  // 3. H1
  if (!is404) {
    fromAudit('h1.one', 'h1', 'Exactly one H1', ['content.h1-missing', 'content.h1-many'], `“${clip(p.h1[0] ?? '', 70)}”`, 'Give the page one clear main heading.');
    kwCheck('h1.kw', 'h1', 'Keyphrase in the H1', 'main heading', p.h1.join(' '), 'Use the keyphrase, or a natural variant, in the main heading.');
    if (p.h1[0] && p.title) { const a = new Set(sig(p.title)), b = sig(p.h1[0]); const share = b.length ? b.filter((w) => a.has(w)).length / b.length : 0;
      add({ id: 'h1.title', group: 'h1', label: 'H1 and title tell the same story', status: share >= 0.5 ? 'pass' : 'warn', detail: share >= 0.5 ? 'The heading and the title share their main words.' : `Heading “${clip(p.h1[0], 50)}” and title share few words.`, fix: 'The H1 can be longer or friendlier than the title, but should promise the same thing.' }); }
  }

  // 4. Meta description
  const d = p.description;
  fromAudit('meta.present', 'meta', 'Meta description present', ['meta.desc-missing'], `${d.length} characters`, 'Write one or two sentences saying what the page offers.');
  if (d) add({ id: 'meta.length', group: 'meta', label: 'Description length (about 70–160 characters)', status: d.length >= 70 && d.length <= 160 ? 'pass' : 'warn', detail: `${d.length} characters${d.length > 160 ? ': it will be cut off' : d.length < 70 ? ': there is room to say more' : d.length > 105 ? '; phones may cut it after about 105' : ''}.`, fix: 'Lead with the essential point; keep it under about 160 characters (about 105 shows fully on phones).', codes: ['meta.desc-short', 'meta.desc-long'] });
  kwCheck('meta.kw', 'meta', 'Keyphrase in the description', 'description', d, 'Use the keyphrase once, naturally, in the description.', 'warn');
  fromAudit('meta.unique', 'meta', 'Description used only on this page', ['meta.desc-dup'], 'Unique to this page.', 'Describe what is unique about this page.');

  // 5. URL
  const slug = p.file.replace(/\.html$/, ''); const slugWords = slug.split('-').filter(Boolean);
  if (!is404) {
    add({ id: 'url.format', group: 'url', label: 'Readable address (lowercase words and hyphens)', status: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? 'pass' : 'warn', detail: p.url, fix: 'Use lowercase words separated by hyphens; no spaces, underscores or special characters.' });
    add({ id: 'url.length', group: 'url', label: 'Short address', status: slug.length <= 60 && slugWords.length <= 6 ? 'pass' : 'warn', detail: `${plural(slugWords.length, 'word')}, ${slug.length} characters.`, fix: 'Keep only the words that describe the page. Changing an address needs a redirect from the old one (SEO → Redirects).' });
    const years = slugWords.filter((w) => /^(19|20)\d\d$/.test(w));
    add({ id: 'url.date', group: 'url', label: 'No date in the address', status: years.length ? 'warn' : 'pass', detail: years.length ? `Contains ${years.join(', ')}: the address will look outdated.` : 'No year in the address.', fix: 'Leave years out of addresses so the page can be updated without changing its address.' });
    const filler = slugWords.filter((w) => STOP.has(w));
    add({ id: 'url.filler', group: 'url', label: 'No filler words in the address', status: filler.length ? 'warn' : 'pass', detail: filler.length ? `Filler words: ${[...new Set(filler)].join(', ')}.` : 'Only meaningful words.', fix: 'Drop words like “the”, “and”, “a”, “of” from addresses.' });
    kwCheck('url.kw', 'url', 'Keyphrase in the address', 'address', slug.replace(/-/g, ' '), 'Use the keyphrase’s main words in the address, when the page is created.', 'warn');
  }

  // 6. Keyword in the content
  if (!is404) {
    kwCheck('body.first', 'body', 'Keyphrase in the first 100 words', 'first 100 words', f.first100, 'Mention the keyphrase in the opening paragraph, where it tells readers they are in the right place.', 'warn');
    if (!kp) needKp('body.count', 'body', 'Keyphrase used in the text, without stuffing', 'Use the keyphrase where it fits naturally, plus related words.');
    else { const n = countPhrase(f.bodyText, kp); const total = Math.max(1, words(f.bodyText).length); const dens = (n * words(kp).length * 100) / total;
      add({ id: 'body.count', group: 'body', label: 'Keyphrase used in the text, without stuffing', status: n === 0 ? (match(f.bodyText, kp) === 'partial' ? 'warn' : 'fail') : dens > 3 ? 'warn' : 'pass', detail: n === 0 ? (match(f.bodyText, kp) === 'partial' ? 'Its words appear in the text, but never as the phrase.' : 'The keyphrase does not appear in the text at all.') : `${plural(n, 'time')} (${dens.toFixed(1)}% of the words)${dens > 3 ? ': this reads as keyword stuffing' : ''}.`, fix: 'Use the keyphrase a few times where it reads naturally, and related words elsewhere. More than about 3% of the words looks like stuffing.' }); }
    if (!kp) needKp('body.subhead', 'body', 'Keyphrase or its words in a subheading', 'Use the keyphrase or its main words in at least one H2 or H3.');
    else { const m = f.subheads.map((h) => match(h, kp)); const best = m.includes('full') ? 'full' : m.includes('partial') ? 'partial' : 'none';
      add({ id: 'body.subhead', group: 'body', label: 'Keyphrase or its words in a subheading', status: !f.subheads.length ? 'warn' : best === 'none' ? 'warn' : 'pass', detail: !f.subheads.length ? 'The page has no H2 or H3 subheadings.' : best === 'none' ? `None of the ${plural(f.subheads.length, 'subheading')} uses it.` : 'A subheading uses it.', fix: 'Name at least one section after the keyphrase or a close variant.' }); }
  }

  // 7. Content quality
  if (!is404) {
    const listing = LISTING.has(p.file);
    add({ id: 'q.words', group: 'quality', label: 'Enough text to answer the search', status: p.words >= 300 ? 'pass' : listing ? 'info' : p.words >= 150 ? 'info' : 'warn', detail: `${p.words} words in the main content${listing && p.words < 300 ? ': a listing page, short by design' : p.words < 150 ? ': very little for search engines to understand' : p.words < 300 ? ': short; fine if it says what it needs to' : ''}.`, fix: 'Pages meant to rank on their own usually need a few hundred words of real content: what, who, where, results.', codes: ['content.thin'] });
    fromAudit('q.placeholder', 'quality', 'No sample or placeholder text', ['content.placeholder'], 'None found.', 'Replace placeholder text with real content.');
    // measured on the prose paragraphs only: cards, figures and buttons are not sentences
    const fl = /^en/i.test(f.lang) ? flesch(f.paragraphs.filter((x) => x.split(' ').length >= 8).map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(' ')) : null;
    add({ id: 'q.read', group: 'quality', label: 'Easy to read', status: fl === null ? 'na' : fl >= 50 ? 'pass' : 'warn', detail: fl === null ? (/^en/i.test(f.lang) ? 'Too little text to measure.' : 'Measured for English pages only.') : `Flesch reading ease ${fl} (${ease(fl)}).`, fix: 'Use shorter sentences and everyday words; explain terms the first time they appear.' });
    const long = f.paragraphs.map((x) => x.split(' ').length).filter((n) => n > 150);
    add({ id: 'q.paragraphs', group: 'quality', label: 'Short paragraphs', status: long.length ? 'warn' : 'pass', detail: long.length ? `${plural(long.length, 'paragraph')} over 150 words (longest ${Math.max(...long)}).` : `${plural(f.paragraphs.length, 'paragraph')}, none over 150 words.`, fix: 'Split long paragraphs; each should make one point.' });
  }

  // 8. Structure
  if (!is404) {
    fromAudit('s.order', 'structure', 'Heading levels in order', ['content.heading-skip'], `${plural(p.headings.length, 'heading')}, no level skipped.`, 'Do not jump from H2 to H4; use the next level down.');
    const h2 = p.headings.filter((h) => h.level === 2).length;
    add({ id: 's.sections', group: 'structure', label: 'Text divided into sections (H2)', status: h2 >= 2 || p.words < 300 ? 'pass' : 'warn', detail: `${plural(h2, 'H2 section')}${h2 < 2 && p.words >= 300 ? ` for ${p.words} words` : ''}.`, fix: 'Give longer pages sections with H2 headings, each answering one question.' });
  }

  // 9. Links
  const internal = f.anchors.filter((a) => a.href && !/^(https?:|mailto:|tel:|#|javascript:|\/\/)/i.test(a.href));
  if (!is404) {
    fromAudit('l.inbound', 'links', 'Other pages link here', ['link.orphan'], p.file === 'index.html' ? 'Homepage.' : p.inbound.length ? `From ${plural(p.inbound.length, 'page')}.` : 'From the menu or footer.', 'Link to it from a related page.');
    add({ id: 'l.out', group: 'links', label: 'Links to related pages on the site', status: internal.length ? 'pass' : 'warn', detail: `${plural(new Set(internal.map((a) => a.href.split('#')[0])).size, 'page')} linked from the content.`, fix: 'Link to related projects, pillars or stories where it helps the reader.' });
    const generic = [...new Set(f.anchors.map((a) => a.text.trim()).filter((t) => GENERIC_ANCHOR.test(t)))];
    add({ id: 'l.anchors', group: 'links', label: 'Link text says where it goes', status: generic.length ? 'warn' : 'pass', detail: generic.length ? `Vague link text: ${generic.map((x) => `“${x}”`).join(', ')}.` : 'No “click here” style links.', fix: 'Use words that describe the destination, for example “Leadership Lab programme”.' });
    add({ id: 'l.external', group: 'links', label: 'Links to trusted sources', status: f.external.length ? 'pass' : 'info', detail: f.external.length ? `${plural(f.external.length, 'external link')}.` : 'No links to other websites. Optional; useful when citing data or partners.', fix: 'When you mention data, partners or reports, link to the original source.' });
  }
  fromAudit('l.broken', 'links', 'No broken links', ['tech.broken-links'], 'Every internal link works.', 'Correct or remove the links.');
  fromAudit('l.redirect', 'links', 'Links go straight to the page', ['link.via-redirect'], 'No link goes through a redirect.', 'Point the link at the new page.');

  // 10. Images
  if (f.images.length) {
    fromAudit('i.alt', 'images', 'Images have alt text', ['content.img-alt'], `All ${plural(f.images.length, 'image')} have alt text.`, 'Add alt text in the Media Library.');
    if (kp && !is404) { const any = f.images.some((i) => i.alt && match(i.alt, kp) !== 'none');
      add({ id: 'i.kw', group: 'images', label: 'An image’s alt text relates to the keyphrase', status: any ? 'pass' : 'info', detail: any ? 'At least one alt text uses its words.' : 'No alt text uses the keyphrase. Only add it where it truly describes the image.', fix: 'Describe images honestly; when an image shows the topic, its alt text can use the keyphrase’s words.' }); }
    const old = [...new Set(f.images.map((i) => i.src).filter((s) => /\.(jpe?g|png|gif|bmp)(\?|$)/i.test(s)))];
    add({ id: 'i.format', group: 'images', label: 'Modern image formats (WebP, AVIF, SVG)', status: old.length ? 'warn' : 'pass', detail: old.length ? `${plural(old.length, 'image')} in an older format: ${old.slice(0, 3).join(', ')}${old.length > 3 ? '…' : ''}.` : 'All images use modern formats.', fix: 'Upload through the Media Library, which makes WebP versions.' });
    fromAudit('i.size', 'images', 'Image files are light', ['perf.img-size'], 'No image over 400 KB.', 'Use smaller versions from the Media Library.');
    fromAudit('i.dims', 'images', 'Images have width and height', ['perf.img-dimensions'], 'Set on every image.', 'Add width and height so the layout does not jump.');
  } else if (!is404) add({ id: 'i.none', group: 'images', label: 'Images support the text', status: 'info', detail: 'No images in the main content.', fix: 'Original photos of AFCD’s work help readers and can appear in image search.' });

  // 11. Structured data
  fromAudit('sc.valid', 'schema', 'Structured data can be read', ['schema.invalid'], p.schema.types.length ? p.schema.types.join(', ') : 'No structured data on this page.', 'Fix the JSON-LD block.');
  const want = p.file === 'index.html' ? ['NGO', 'Organization'] : /^news-/.test(p.file) ? ['Article', 'NewsArticle', 'BlogPosting'] : /^event-/.test(p.file) ? ['Event'] : null;
  if (want) { const has = p.schema.types.some((t) => want.includes(t));
    add({ id: 'sc.type', group: 'schema', label: `${want[0]} markup for this kind of page`, status: has ? 'pass' : p.file === 'index.html' ? 'warn' : 'info', detail: has ? `${p.schema.types.filter((t) => want.includes(t)).join(', ')} present.` : `No ${want[0]} markup. It can help search engines present the page; it guarantees nothing.`, fix: /^news-/.test(p.file) ? 'Switch on Article markup in SEO → Structured data and publish it.' : 'Add the markup in SEO → Structured data.' }); }

  // 12. Crawling and indexing
  const prod = ctx.audit.production;
  const bots = robotsAccess(ctx.robots, [...SEARCH_BOTS, ...AI_BOTS]);
  const blockedSearch = SEARCH_BOTS.filter((b) => !bots[b]), blockedAi = AI_BOTS.filter((b) => !bots[b]);
  add({ id: 'c.robots', group: 'crawl', label: 'Search engines may crawl it (robots.txt)', status: !prod ? 'info' : blockedSearch.length ? 'fail' : 'pass', detail: !prod ? 'Preview build: robots.txt blocks everything on purpose.' : blockedSearch.length ? `Blocked: ${blockedSearch.join(', ')}.` : 'Googlebot and Bingbot are allowed.', fix: 'Remove the Disallow rule that blocks search engines in robots.txt.' });
  if (prod) add({ id: 'c.ai', group: 'crawl', label: 'AI search crawlers allowed', status: blockedAi.length ? 'warn' : 'pass', detail: blockedAi.length ? `Blocked: ${blockedAi.join(', ')}. The page cannot be cited in those AI answers.` : `${AI_BOTS.join(', ')} are allowed.`, fix: 'Decide which AI crawlers may read the site; blocking one keeps the page out of its answers.' });
  fromAudit('c.index', 'crawl', 'Not hidden from search (noindex)', ['tech.noindex'], prod ? 'No noindex.' : 'Preview build: noindex on purpose.', 'Remove “Hide from search engines” in the page’s SEO settings, unless intended.');
  if (!is404) {
    fromAudit('c.canonical', 'crawl', 'Canonical address is this page', ['tech.canonical-missing', 'tech.canonical-mismatch'], p.canonical, 'Check the canonical link.');
    fromAudit('c.sitemap', 'crawl', 'Listed in the sitemap', ['tech.not-in-sitemap'], 'sitemap.xml lists it.', 'Make sure the page is not marked noindex.');
  }

  // 13. Page speed (what the build shows; Core Web Vitals need field data and are not estimated)
  add({ id: 'sp.html', group: 'speed', label: 'Light HTML', status: f.size <= 150_000 ? 'pass' : 'warn', detail: `${Math.round(f.size / 1024)} KB of HTML.`, fix: 'Very large pages load slowly on mobile data; split very long lists or galleries.' });
  add({ id: 'sp.blocking', group: 'speed', label: 'No render-blocking scripts', status: f.headScripts.length ? 'warn' : 'pass', detail: f.headScripts.length ? `${plural(f.headScripts.length, 'script')} in the head without defer or async.` : 'Scripts load without blocking the page.', fix: 'Load scripts with defer, or at the end of the page.' });

  // 14. Mobile
  add({ id: 'm.viewport', group: 'mobile', label: 'Responsive viewport', status: /width=device-width/i.test(f.viewport) ? 'pass' : 'fail', detail: f.viewport ? `viewport: ${f.viewport}` : 'No viewport meta tag.', fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the page template.' });
  fromAudit('m.lang', 'mobile', 'Page language declared', ['tech.lang-missing'], `lang="${f.lang}"`, 'Add lang to the <html> element.');

  // 15. Link previews
  if (!is404) {
    fromAudit('og', 'social', 'Open Graph title, description and image', ['meta.og-missing'], 'All three present.', 'The build adds Open Graph tags; check the page’s title, description and share image.');
    add({ id: 'twitter', group: 'social', label: 'X (Twitter) card', status: f.twitter ? 'pass' : 'info', detail: f.twitter ? `twitter:card “${f.twitter}”.` : 'No twitter:card; X falls back to Open Graph.', fix: 'Optional: add twitter:card “summary_large_image” to the page template.' });
  }

  // Manual reviews (not for the error page)
  const hash = contentHash(f);
  if (!is404) for (const m of MANUAL) {
    const r = st.manual[m.id]; const changed = !!r && r.hash !== hash;
    out.push({ id: m.id, group: m.group, label: m.label, manual: true, status: r && !changed ? 'done' : 'todo', fix: m.fix,
      detail: !r ? 'Not reviewed yet.' : changed ? 'The page text changed since it was reviewed. Check again.' : `Reviewed by ${ctx.reviewers.get(r.by ?? '') ?? 'a former user'}.`,
      reviewedBy: r ? ctx.reviewers.get(r.by ?? '') ?? null : null, reviewedAt: r?.at ?? null, changed });
  }

  // score: automatic checks only, weighted by how much they matter (pass full weight, warn half, fail none; info and
  // n/a do not count). Keyword checks waiting for a keyphrase count as failed, because a page without one is a real gap.
  const auto = out.filter((c) => !c.manual && ['pass', 'warn', 'fail'].includes(c.status));
  const waiting = out.filter((c) => !c.manual && c.status === 'na' && c.detail.startsWith('Set a focus keyphrase'));
  const w = (c: OnCheck) => WEIGHT[c.id] ?? 2;
  // each group of the checklist counts the same (the article's items are equals), weighted checks inside a group
  const groupScore = (g: OnGroup) => {
    const scored = auto.filter((c) => c.group === g), wait = waiting.filter((c) => c.group === g);
    const total = [...scored, ...wait].reduce((n, c) => n + w(c), 0);
    return total ? scored.reduce((n, c) => n + w(c) * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0) / total : null;
  };
  const half = (gs: OnGroup[]) => { const v = gs.map(groupScore).filter((x): x is number => x !== null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) : null; };
  // two halves, as on-page tools separate content from technical work; the page score is their average
  const scores = { content: half(CONTENT_GROUPS), technical: half(GROUPS.map(([g]) => g).filter((g) => !CONTENT_GROUPS.includes(g))) };
  // a page is not optimised for a search it never mentions: cap the content half (and say why)
  let cap: string | null = null;
  const missing = (id: string) => out.find((c) => c.id === id)?.status !== 'pass';
  if (!is404 && scores.content !== null) {
    if (!kp && scores.content > 50) { scores.content = 50; cap = 'Capped at 50 until the page has a focus keyphrase.'; }
    else if (kp && missing('title.kw') && missing('h1.kw') && missing('body.count') && scores.content > 40) { scores.content = 40; cap = 'Capped at 40: the keyphrase, as a phrase, is in neither the title, the H1 nor the text, so the page is not optimised for it.'; }
  }
  const parts = [scores.content, scores.technical].filter((x): x is number => x !== null);
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
  const counts = { pass: auto.filter((c) => c.status === 'pass').length, warn: auto.filter((c) => c.status === 'warn').length, fail: auto.filter((c) => c.status === 'fail').length, total: auto.length };
  const manual = { done: out.filter((c) => c.manual && c.status === 'done').length, total: out.filter((c) => c.manual).length };
  return { checks: out, score, scores, cap, counts, manual, waiting: waiting.length, hash, serp: { title: p.title, url: p.url, description: d } };
}

// ---------------------------------------------------------------- Storage and the API's views
async function states(db: DB) {
  const rows = await db.select({ key: seoSettings.key, p: seoSettings.published }).from(seoSettings).where(like(seoSettings.key, 'onpage:%'));
  return new Map(rows.map((r) => [r.key.slice(7), { ...EMPTY, ...(r.p as Partial<PageState> ?? {}) } as PageState]));
}
async function context(db: DB, cfg: Config, all: Map<string, PageState>): Promise<Ctx> {
  const a = runBuildAudit(cfg.siteRoot, new Date(), await siteUrl(db));
  const robots = existsSync(resolve(cfg.siteRoot, 'robots.txt')) ? readFileSync(resolve(cfg.siteRoot, 'robots.txt'), 'utf8') : '';
  const focusOf = new Map<string, string[]>();
  for (const [file, s] of all) if (s.keyphrase.trim()) { const k = norm(s.keyphrase); focusOf.set(k, [...(focusOf.get(k) ?? []), file]); }
  const ids = [...new Set([...all.values()].flatMap((s) => Object.values(s.manual).map((m) => m.by)).filter(Boolean))] as string[];
  const reviewers = new Map<string, string>();
  for (const id of ids) { const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)); if (u) reviewers.set(id, u.name); }
  return { audit: a, root: cfg.siteRoot, robots, focusOf, reviewers };
}
const ownerOf = (own: Map<string, Owner>, file: string) => own.get(file) ?? { kind: 'template', label: 'Template page' };

/** Every page with its score: the On-page list and the Overview card. */
export async function listOnPage(db: DB, cfg: Config) {
  const all = await states(db); const ctx = await context(db, cfg, all); const own = await owners(db, cfg);
  const pages = ctx.audit.pages.map((p) => { const st = all.get(p.file) ?? EMPTY; const r = pageChecklist(ctx, p, st);
    return { file: p.file, url: p.url, title: p.title, keyphrase: st.keyphrase, intent: st.intent, score: r.score, scores: r.scores, cap: r.cap, waiting: r.waiting, counts: r.counts, manual: r.manual, owner: ownerOf(own, p.file) }; });
  const content = pages.filter((p) => p.file !== '404.html');
  return { at: ctx.audit.at, production: ctx.audit.production, pages,
    summary: { pages: content.length, average: content.length ? Math.round(content.reduce((n, p) => n + p.score, 0) / content.length) : 0,
      withKeyphrase: content.filter((p) => p.keyphrase).length, failing: content.filter((p) => p.counts.fail).length,
      reviewed: content.filter((p) => p.manual.total && p.manual.done === p.manual.total).length } };
}

export async function pageView(db: DB, cfg: Config, file: string) {
  if (!FILE.test(file)) throw new AppError(404, 'Unknown page.');
  const all = await states(db); const ctx = await context(db, cfg, all);
  const p = ctx.audit.pages.find((x) => x.file === file);
  if (!p) throw new AppError(404, 'This page is not in the website build.');
  const st = all.get(file) ?? EMPTY; const r = pageChecklist(ctx, p, st); const own = await owners(db, cfg);
  return { file, url: p.url, title: p.title, h1: p.h1[0] ?? '', words: p.words, production: ctx.audit.production, builtAt: ctx.audit.at,
    keyphrase: st.keyphrase, intent: st.intent, owner: ownerOf(own, file), groups: GROUPS, intents: INTENTS, ...r };
}

const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
export const focusSchema = z.object({ keyphrase: plain(80).default(''), intent: z.enum(['', ...INTENTS]).default('') }).strict();

async function save(db: DB, actor: NonNullable<Actor>, file: string, next: PageState) {
  const value = next as unknown as Record<string, unknown>;
  await db.insert(seoSettings).values({ key: KEY(file), published: value, status: 'published', updatedBy: actor.id, publishedAt: new Date() })
    .onConflictDoUpdate({ target: seoSettings.key, set: { published: value, updatedBy: actor.id, updatedAt: new Date(), publishedAt: new Date() } });
}
async function current(db: DB, file: string) {
  const [r] = await db.select({ p: seoSettings.published }).from(seoSettings).where(eq(seoSettings.key, KEY(file)));
  return { ...EMPTY, ...((r?.p as Partial<PageState>) ?? {}) } as PageState;
}

/** Saves the page's focus keyphrase and search intent. */
export async function setFocus(db: DB, cfg: Config, actor: NonNullable<Actor>, file: string, raw: unknown) {
  if (!FILE.test(file) || !existsSync(resolve(cfg.siteRoot, file))) throw new AppError(404, 'This page is not in the website build.');
  const r = focusSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const cur = await current(db, file);
  await save(db, actor, file, { ...cur, keyphrase: r.data.keyphrase, intent: r.data.intent });
  await audit(db, actor, 'seo.onpage_focus', { type: 'seo' }, r.data.keyphrase ? `${file}: focus “${r.data.keyphrase}”` : `${file}: focus keyphrase cleared`);
  return pageView(db, cfg, file);
}

/** Ticks or unticks a manual review. The tick remembers the page text it was made against. */
export async function setManual(db: DB, cfg: Config, actor: NonNullable<Actor>, file: string, raw: unknown) {
  const r = z.object({ id: z.enum(MANUAL.map((m) => m.id) as [string, ...string[]]), done: z.boolean() }).strict().safeParse(raw);
  if (!r.success) throw new AppError(422, 'Unknown review.');
  if (!FILE.test(file) || !existsSync(resolve(cfg.siteRoot, file))) throw new AppError(404, 'This page is not in the website build.');
  const hash = contentHash(facts(cfg.siteRoot, file, new URL(await siteUrl(db)).hostname));
  const cur = await current(db, file);
  const manual = { ...cur.manual };
  if (r.data.done) manual[r.data.id] = { by: actor.id, at: new Date().toISOString(), hash }; else delete manual[r.data.id];
  await save(db, actor, file, { ...cur, manual });
  await audit(db, actor, r.data.done ? 'seo.onpage_reviewed' : 'seo.onpage_unreviewed', { type: 'seo' }, `${file}: ${MANUAL.find((m) => m.id === r.data.id)!.label}`);
  return pageView(db, cfg, file);
}
