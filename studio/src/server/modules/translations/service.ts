// Translations: the French and Arabic text of the public site, edited and reviewed in Studio.
//
// English stays the source. The website build (lib/i18n.mjs) turns the finished English pages into fr/ and ar/ using
// src/i18n/<lang>.json, a map from each English segment to its translation. Studio keeps a draft and a published copy of
// each language (seo_settings rows 'i18n:fr' and 'i18n:ar'); publishing writes the published copy to that file, rebuilds
// and checks the language pages carry the new revision. Untranslated segments stay in English: nothing is invented.
//
// Two separate decisions, both reviewed: the text itself, and `live`, whether the language may appear on the production
// site. While `live` is false the build makes the language for previews only (noindex, "under review" notice).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { seoSettings, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { collectSegments } from '../../../../../lib/i18n.mjs';

export const LANGS = ['fr', 'ar'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_INFO: Record<Lang, { name: string; native: string; label: string; dir: 'ltr' | 'rtl' }> = {
  fr: { name: 'French', native: 'Français', label: 'French', dir: 'ltr' },
  ar: { name: 'Arabic', native: 'العربية', label: 'Arabic', dir: 'rtl' },
};
export const isLang = (x: string): x is Lang => (LANGS as readonly string[]).includes(x);
const KEY = (lang: Lang) => `i18n:${lang}`;
export const NOTE = 'Machine-drafted by Claude for review. Keys are the English text of the built pages; run node lib/i18n.mjs report to see what is missing. Set status to approved only after a native speaker has reviewed it.';

export type LangData = { strings: Record<string, string>; live: boolean };
type Published = LangData & { _revision?: string };

/** Sample text that is never worth translating (it will be replaced by AFCD's real content). */
/** Emails, language and objective codes, initials and file names: the same in every language. */
export const CODE = /^(?:\S+@\S+\.\S+|[A-Z]{1,4}|[A-Z]{1,4}-?\d+|[A-Z0-9]*\d[A-Z0-9]*|[\w.-]+\.(?:org|com|ma|html))$/;
export const PLACEHOLDER = /lorem|ipsum|consectetur|adipiscing|\bdolor\b|\bamet\b|vestibulum|aenean|curabitur|etiam|cras mattis|nulla vitae|sed posuere|\but enim\b|minim veniam|nostrud|eiusmod|tempor|integer posuere|\bsample (?:text|event)\b/i;
const tagsOf = (s: string) => (s.match(/<[^>]+>/g) ?? []).slice().sort().join('\n');
const MAX = 4000;

/** Makes a translation safe to drop into both HTML text and attribute values, keeping the English segment's tags. */
export function cleanValue(key: string, raw: string): { value?: string; error?: string } {
  const v = raw.replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ').trim();
  if (!v) return { value: '' };
  if (v.length > MAX) return { error: `Too long (max ${MAX} characters).` };
  // Tags are part of the page design (links, emphasis, icons). The translation must keep exactly the same ones.
  if (tagsOf(v) !== tagsOf(key)) return { error: tagsOf(key) ? 'Keep the same HTML tags as the English text (links, bold text and icons), in any order.' : 'Remove the HTML tags: this text has none in English.' };
  if (/<script|\son\w+\s*=|javascript:/i.test(v)) return { error: 'Scripts and event handlers are not allowed.' };
  // Escape what sits between tags: bare &, quotes (the same text may go into an attribute) and stray < >.
  const value = v.split(/(<[^>]+>)/).map((part, i) => (i % 2 ? part : part
    .replace(/&(?![a-z][a-z0-9]*;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))).join('');
  return { value };
}

const fileOf = (cfg: Config, lang: Lang) => resolve(cfg.siteRoot, 'src/i18n', `${lang}.json`);
function readFile(cfg: Config, lang: Lang): (LangData & { revision?: string }) | null {
  const f = fileOf(cfg, lang); if (!existsSync(f)) return null;
  try { const j = JSON.parse(readFileSync(f, 'utf8')); return { strings: j.strings ?? {}, live: j.status === 'approved', revision: j.revision }; } catch { return null; }
}
/** The exact file the website build reads, in the shape of the hand-made files. The database does not keep key order, so
 *  strings are written in the order the texts appear on the site (then any others alphabetically): stable, readable diffs. */
export function fileContent(lang: Lang, d: LangData, revision?: string, order?: string[]) {
  const pos = new Map((order ?? []).map((k, i) => [k, i]));
  const keys = Object.keys(d.strings).sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity) || (pos.has(a) ? 0 : a.localeCompare(b)));
  const strings = Object.fromEntries(keys.map((k) => [k, d.strings[k]]));
  return JSON.stringify({ status: d.live ? 'approved' : 'draft', language: LANG_INFO[lang].name, note: NOTE, ...(revision ? { revision } : {}), strings }, null, 1) + '\n';
}
const sameStrings = (a: Record<string, string>, b: Record<string, string>) => { const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]); };

export async function loadRow(db: DB, lang: Lang) {
  const [row] = await db.select().from(seoSettings).where(eq(seoSettings.key, KEY(lang)));
  return row ?? null;
}
/** First visit: take over the language file the site already has, as both draft and published (it is what the site shows). */
async function ensureRow(db: DB, cfg: Config, lang: Lang, actor: NonNullable<Actor>) {
  const cur = await loadRow(db, lang); if (cur) return cur;
  const f = readFile(cfg, lang);
  const data: LangData = { strings: f?.strings ?? {}, live: f?.live ?? false };
  await db.insert(seoSettings).values({ key: KEY(lang), draft: data, published: f ? { ...data, ...(f.revision ? { _revision: f.revision } : {}) } : null, status: f ? 'published' : 'draft', updatedBy: actor.id }).onConflictDoNothing();
  await audit(db, actor, 'translation.import', { type: 'translation', id: lang }, f ? `Took over src/i18n/${lang}.json (${Object.keys(data.strings).length} translations)` : `Started ${LANG_INFO[lang].name} translations`);
  return (await loadRow(db, lang))!;
}

let segCache: { at: number; root: string; map: Map<string, Set<string>> } | null = null;
/** English segments of the built site (re-read at most every few seconds; the site changes only when it is rebuilt). */
export function segments(cfg: Config) {
  if (!segCache || segCache.root !== cfg.siteRoot || Date.now() - segCache.at > 5000) segCache = { at: Date.now(), root: cfg.siteRoot, map: collectSegments(cfg.siteRoot) };
  return segCache.map;
}
export const clearSegmentCache = () => { segCache = null; };

export async function overview(db: DB, cfg: Config) {
  const segs = segments(cfg);
  return Promise.all(LANGS.map(async (lang) => {
    const row = await loadRow(db, lang);
    const d = (row?.draft as LangData | null) ?? readFile(cfg, lang) ?? { strings: {}, live: false };
    const translated = [...segs.keys()].filter((k) => d.strings[k]).length;
    return { lang, ...LANG_INFO[lang], total: segs.size, translated, status: row?.status ?? (readFile(cfg, lang) ? 'published' : null), live: d.live, publishedLive: (row?.published as Published | null)?.live ?? readFile(cfg, lang)?.live ?? false };
  }));
}

export async function view(db: DB, cfg: Config, lang: Lang, actor: NonNullable<Actor>) {
  const row = await ensureRow(db, cfg, lang, actor);
  const draft = row.draft as LangData; const pub = (row.published as Published | null) ?? { strings: {}, live: false };
  const segs = segments(cfg);
  const items = [...segs.entries()].map(([key, files]) => {
    const t = draft.strings[key] ?? ''; const p = pub.strings[key] ?? '';
    const state = !t ? 'missing' : t !== p ? 'edited' : 'done';
    return { key, files: [...files], text: t, published: p, state, placeholder: PLACEHOLDER.test(key), code: CODE.test(key.replace(/<[^>]+>/g, '').trim()), tags: (key.match(/<[^>]+>/g) ?? []).length };
  });
  const unused = Object.keys(draft.strings).filter((k) => !segs.has(k));
  // published strings that are no longer in the draft (removed): count as pending changes too
  const removed = Object.keys(pub.strings).filter((k) => !(k in draft.strings)).length;
  const file = readFile(cfg, lang);
  const fileDiffers = !!file && !!row.published && (!sameStrings(file.strings, pub.strings) || file.live !== pub.live);
  const [by] = row.updatedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)) : [];
  const count = (s: string) => items.filter((i) => i.state === s).length;
  return {
    lang, ...LANG_INFO[lang], status: row.status, live: draft.live, publishedLive: pub.live, revision: pub._revision ?? null,
    publishedAt: row.publishedAt, updatedAt: row.updatedAt, updatedByName: by?.name ?? null, submittedBy: row.submittedBy,
    counts: { total: items.length, done: count('done'), edited: count('edited'), missing: count('missing'), placeholder: items.filter((i) => i.placeholder && i.state === 'missing').length, code: items.filter((i) => i.code && !i.placeholder && i.state === 'missing').length, unused: unused.length, removed },
    pending: count('edited') + removed + (draft.live !== pub.live ? 1 : 0) + unused.filter((k) => !(k in pub.strings)).length,
    fileDiffers, items, unused,
  };
}

const saveBody = z.object({
  strings: z.record(z.string().max(MAX * 2), z.string().max(MAX * 2).nullable()).default({}),
  live: z.boolean().optional(),
  removeUnused: z.boolean().optional(),
}).strict();

export async function save(db: DB, cfg: Config, lang: Lang, actor: NonNullable<Actor>, raw: unknown) {
  const p = saveBody.safeParse(raw);
  if (!p.success) throw new AppError(422, 'Invalid request.');
  const row = await ensureRow(db, cfg, lang, actor);
  if (row.status === 'in_review' || row.status === 'approved') throw new AppError(409, 'These translations are being reviewed. Withdraw them to edit.');
  const draft = structuredClone(row.draft as LangData); const segs = segments(cfg);
  const errors: { path: string; message: string }[] = []; let changed = 0;
  for (const [key, val] of Object.entries(p.data.strings)) {
    if (val === null || val.trim() === '') { if (key in draft.strings) { delete draft.strings[key]; changed++; } continue; }
    if (!segs.has(key)) { errors.push({ path: key, message: 'This English text is no longer on the site.' }); continue; }
    const r = cleanValue(key, val);
    if (r.error) { errors.push({ path: key, message: r.error }); continue; }
    if (draft.strings[key] !== r.value) { draft.strings[key] = r.value!; changed++; }
  }
  if (errors.length) throw new AppError(422, `${errors.length} translation${errors.length === 1 ? ' needs' : 's need'} attention. Nothing was saved.`, errors);
  if (p.data.removeUnused) for (const k of Object.keys(draft.strings)) if (!segs.has(k)) { delete draft.strings[k]; changed++; }
  if (p.data.live !== undefined && p.data.live !== draft.live) { draft.live = p.data.live; changed++; }
  if (!changed) return;
  await db.update(seoSettings).set({ draft, status: 'draft', updatedBy: actor.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY(lang)));
  await audit(db, actor, 'translation.update', { type: 'translation', id: lang }, `Edited ${LANG_INFO[lang].name} translations (${changed} change${changed === 1 ? '' : 's'})`);
}

export const TRANSLATION_ACTIONS = { submit: 'translation.update', withdraw: 'translation.update', request_changes: 'translation.approve', approve: 'translation.approve' } as const;
export async function transition(db: DB, lang: Lang, actor: NonNullable<Actor>, role: Role, action: keyof typeof TRANSLATION_ACTIONS, comment = '') {
  const cur = await loadRow(db, lang);
  if (!cur) throw new AppError(404, 'Open the translations first.');
  const from = cur.status; let to: typeof from;
  if (action === 'submit') { if (from !== 'draft' && from !== 'changes_requested') throw new AppError(409, 'Only a draft can be sent for review.'); to = 'in_review'; }
  else if (action === 'withdraw') { if (from !== 'in_review' && from !== 'approved') throw new AppError(409, 'Nothing to withdraw.'); to = 'draft'; }
  else {
    if (from !== 'in_review') throw new AppError(409, 'Only translations in review can be reviewed.');
    if (cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the translator must review these translations.');
    if (action === 'request_changes' && !comment.trim()) throw new AppError(422, 'Say what needs to change.');
    to = action === 'approve' ? 'approved' : 'changes_requested';
  }
  await db.update(seoSettings).set({ status: to, ...(action === 'submit' ? { submittedBy: actor.id } : {}), updatedAt: new Date() }).where(eq(seoSettings.key, KEY(lang)));
  await audit(db, actor, `translation.${action}`, { type: 'translation', id: lang }, comment ? `${action}: ${comment.slice(0, 300)}` : `${action} ${LANG_INFO[lang].name}`);
}

/** What the website file should contain for each language: the published copy, or an override being delivered. */
export async function publishedFiles(db: DB, cfg: Config, override?: { lang: Lang; data: LangData; revision: string }) {
  const out: { lang: Lang; content: string }[] = [];
  let order: string[] | undefined; try { order = [...segments(cfg).keys()]; } catch { order = undefined; }
  for (const lang of LANGS) {
    if (override?.lang === lang) { out.push({ lang, content: fileContent(lang, override.data, override.revision, order) }); continue; }
    const row = await loadRow(db, lang);
    const pub = row?.published as Published | null | undefined;
    if (pub) out.push({ lang, content: fileContent(lang, { strings: pub.strings, live: pub.live }, pub._revision, order) });
  }
  return out;   // languages Studio has never opened are left as they are on disk
}
export const KEY_OF = KEY;

// ---------------------------------------------------------------- one record's texts (the Translations tab of each editor)
const plainText = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
export const recordBody = z.object({
  files: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*\.html$/)).max(5).default([]),
  texts: z.array(z.string().max(2000)).max(80).default([]),
}).strict();

/** The English segments that belong to one record: text that appears only on its own page (template headings, header,
 *  footer and cards of other records appear on other pages too), plus listing texts made from one of its fields. */
export async function recordView(db: DB, cfg: Config, actor: NonNullable<Actor>, raw: unknown) {
  const p = recordBody.safeParse(raw); if (!p.success) throw new AppError(422, 'Invalid request.');
  const segs = segments(cfg);
  const chrome = new Set([...segs.entries()].filter(([, f]) => f.has('404.html')).map(([k]) => k));
  const own = new Set(p.data.files);
  const needles = [...new Set(p.data.texts.map((t) => plainText(t)).filter((t) => t.length >= 3))];
  const keys = [...segs.entries()].filter(([k, files]) => {
    if (chrome.has(k)) return false;
    if ([...files].every((f) => own.has(f))) return true;
    const pk = plainText(k);
    return needles.some((n) => pk === n || (n.length >= 24 && pk.includes(n)));   // short fields (a category, a place) only as exact text
  }).map(([k]) => k).slice(0, 300);
  const langs = await Promise.all(LANGS.map(async (lang) => {
    const row = await ensureRow(db, cfg, lang, actor);
    return { lang, row, draft: row.draft as LangData, pub: (row.published as Published | null) ?? { strings: {}, live: false } };
  }));
  return {
    pageBuilt: p.data.files.some((f) => existsSync(resolve(cfg.siteRoot, f))),
    langs: langs.map(({ lang, row, draft }) => ({ lang, ...LANG_INFO[lang], status: row.status, live: draft.live })),
    items: keys.map((key) => ({
      key, files: [...segs.get(key)!], placeholder: PLACEHOLDER.test(key), code: CODE.test(key.replace(/<[^>]+>/g, '').trim()), tags: (key.match(/<[^>]+>/g) ?? []).length,
      onPage: [...segs.get(key)!].some((f) => own.has(f)),
      t: Object.fromEntries(langs.map(({ lang, draft, pub }) => { const t = draft.strings[key] ?? ''; const pv = pub.strings[key] ?? ''; return [lang, { text: t, state: !t ? 'missing' : t !== pv ? 'edited' : 'done' }]; })),
    })),
  };
}
