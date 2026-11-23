// Schema studio: structured data (schema.org JSON-LD) for the public site.
// - Organization profile: reviewed edits to the public fields of the NGO description that build.mjs puts on the homepage.
//   Only public fields exist here; tax identifiers, CNSS numbers and internal registration records have no field at all.
// - Generated markup: Article for live Studio stories with their own page, Event for live Studio events. It is built
//   only from published records, and only once the settings that switch it on have been reviewed and published.
// Studio writes src/data/schema.json; build.mjs merges it in. Without that file the site builds exactly as before.
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
import { articleFile, type ArticleSnapshot } from '../news/render.ts';
import { eventFile } from '../events/render.ts';
import type { EventSnapshot } from '../events/service.ts';

import { DEFAULT_SITE, siteUrl } from './site.ts';
export const KEY = 'organization';
const orgId = (site: string) => site + '#organization';
const plain = (n: number) => z.string().trim().max(n).refine((v) => !/[<>]/.test(v), 'Use plain text.');
const HTTPS = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i;
/** The foundation's public addresses. Any other address (personal, administrative) never goes into public markup. */
export const PUBLIC_EMAILS = ['contact@afcdteam.com', 'akaya@afcdteam.com'];
/** Keys build.mjs may take from schema.json for the Organization: names, description and public contacts only. */
export const ORG_KEYS = ['alternateName', 'legalName', 'description', 'email', 'telephone', 'foundingDate', 'sameAs'] as const;
/** Sample or placeholder text that must never be described to search engines as real content. */
const PLACEHOLDER = /lorem ipsum|consectetur adipiscing|\bsample\b|placeholder|\bdummy\b|\btest (event|story|article)\b|\bto be confirmed\b|\bTBC\b|\bTBD\b/i;

export const settingsSchema = z.object({
  organization: z.object({
    alternateName: plain(60).default(''),
    legalName: plain(160).default(''),
    description: plain(320).refine((v) => v === '' || v.length >= 50, 'Write at least 50 characters, or leave it empty to keep the site’s own.').default(''),
    email: z.string().trim().toLowerCase().max(120).refine((v) => v === '' || PUBLIC_EMAILS.includes(v), `Use one of the foundation’s public addresses: ${PUBLIC_EMAILS.join(' or ')}.`).default(''),
    telephone: z.string().trim().max(24).refine((v) => v === '' || /^\+[0-9 ]{8,20}$/.test(v), 'Use the international format, e.g. +212 6…').default(''),
    foundingDate: z.string().trim().refine((v) => v === '' || /^(19|20)\d{2}$/.test(v), 'Use a year like 2007.').default(''),
    sameAs: z.array(z.string().trim().max(300).regex(HTTPS, 'Use a full https:// address.')).max(10).default([]),
  }).strict().prefault({}),
  articles: z.boolean().default(true),
  events: z.boolean().default(true),
}).strict();
export type SchemaSettings = z.infer<typeof settingsSchema>;
export const EMPTY: SchemaSettings = settingsSchema.parse({});

/** Only the fields an editor filled in: build.mjs keeps its own value for every other field. */
export function orgOverrides(s: SchemaSettings) {
  const o = s.organization; const out: Record<string, unknown> = {};
  for (const k of ['alternateName', 'legalName', 'description', 'email', 'telephone', 'foundingDate'] as const) if (o[k]) out[k] = k === 'telephone' ? o[k].replace(/\s+/g, '') : o[k];
  if (o.sameAs.length) out.sameAs = o.sameAs;
  return out;
}

type Img = { src: string; w: number; h: number } | null;
const absFor = (site: string) => (p: string) => (/^https?:/.test(p) ? p : site + p.replace(/^\/+/, ''));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export function articleLd(a: ArticleSnapshot, img: Img, site = DEFAULT_SITE) {
  const abs = absFor(site);
  const file = articleFile(a); if (!file) return null;
  return { '@context': 'https://schema.org', '@type': 'Article', headline: clip(a.seo?.title || a.title, 110), description: a.seo?.description || a.excerpt || undefined,
    datePublished: a.publishDate, inLanguage: 'en', mainEntityOfPage: abs(file), url: abs(file),
    ...(img ? { image: [abs(img.src)] } : {}),
    author: a.authorName ? { '@type': 'Person', name: a.authorName } : { '@id': orgId(site) },
    publisher: { '@id': orgId(site) } };
}

export function eventLd(e: EventSnapshot, img: Img, site = DEFAULT_SITE) {
  const abs = absFor(site);
  const file = eventFile(e.slug);
  const place = e.location ? { '@type': 'Place', name: e.location, address: { '@type': 'PostalAddress', addressCountry: 'MA', addressLocality: e.location } } : null;
  const virtual = e.online ? { '@type': 'VirtualLocation', url: e.registration === 'external' && e.registrationUrl ? e.registrationUrl : abs(file) } : null;
  const location = place && virtual ? [virtual, place] : place ?? virtual ?? undefined;
  return { '@context': 'https://schema.org', '@type': 'Event', name: e.title, description: e.summary || undefined, url: abs(file),
    startDate: e.startDate, ...(e.endDate ? { endDate: e.endDate } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: `https://schema.org/${place && virtual ? 'Mixed' : virtual ? 'Online' : 'Offline'}EventAttendanceMode`,
    ...(location ? { location } : {}), ...(img ? { image: [abs(img.src)] } : {}),
    organizer: { '@id': orgId(site) } };
}

/** Checks generated objects against what search engines document as required or recommended. Not a guarantee of rich results. */
export function validateLd(obj: Record<string, unknown>) {
  const errors: string[] = []; const warnings: string[] = [];
  const t = obj['@type'];
  const words = [obj.headline, obj.name, obj.description].filter((x) => typeof x === 'string').join(' ');
  if (PLACEHOLDER.test(words)) errors.push('Looks like sample or placeholder content; it is not described to search engines.');
  if (t === 'Article') {
    if (!obj.headline) errors.push('Missing headline.');
    if (!obj.datePublished) errors.push('Missing publication date.');
    if (!obj.image) warnings.push('No image: add a cover photo to the story.');
  }
  if (t === 'Event') {
    if (!obj.name) errors.push('Missing name.');
    if (!obj.startDate) errors.push('Missing start date.');
    if (!obj.location) errors.push('No location: add a place, or mark the event as online.');
    if (!obj.image) warnings.push('No image: add a poster to the event.');
    if (!obj.description) warnings.push('No summary.');
  }
  return { errors, warnings };
}

export type LiveForSchema = { articles: { snap: ArticleSnapshot; img: Img }[]; events: { snap: EventSnapshot; img: Img }[] };
/** schema.json for build.mjs: organization overrides plus extra JSON-LD per page. Objects with errors are left out. */
export function buildSchemaFile(s: SchemaSettings, live: LiveForSchema, revision: string, site = DEFAULT_SITE) {
  const pages: Record<string, Record<string, unknown>[]> = {};
  const add = (file: string, obj: Record<string, unknown> | null) => { if (obj && !validateLd(obj).errors.length) (pages[file] ??= []).push(JSON.parse(JSON.stringify(obj))); };
  if (s.articles) for (const a of live.articles) add(articleFile(a.snap) ?? '', articleLd(a.snap, a.img, site));
  if (s.events) for (const e of live.events) add(eventFile(e.snap.slug), eventLd(e.snap, e.img, site));
  return { version: 1, source: 'AFCD Studio', revision, organization: orgOverrides(s), pages };
}

/** The homepage organization markup as the current build shows it (read from the built index.html, nothing assumed). */
export function builtOrganization(cfg: Config) {
  const f = resolve(cfg.siteRoot, 'index.html'); if (!existsSync(f)) return null;
  for (const m of readFileSync(f, 'utf8').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]); if (j['@type'] === 'NGO' || j['@type'] === 'Organization') return j as Record<string, unknown>; } catch { /* reported by the audit */ }
  }
  return null;
}

// ---------------------------------------------------------------- settings with review
export async function loadSettings(db: DB) {
  const [row] = await db.select().from(seoSettings).where(eq(seoSettings.key, KEY));
  return row ?? null;
}
const parse = (raw: unknown) => {
  const p = settingsSchema.safeParse(raw);
  if (!p.success) throw new AppError(422, 'Some fields need attention.', p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return p.data;
};

export async function saveSettings(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const draft = parse(raw); const cur = await loadSettings(db);
  if (cur && (cur.status === 'in_review' || cur.status === 'approved')) throw new AppError(409, 'These settings are being reviewed. Withdraw them to edit.');
  if (cur) await db.update(seoSettings).set({ draft, status: 'draft', updatedBy: actor.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  else await db.insert(seoSettings).values({ key: KEY, draft, status: 'draft', updatedBy: actor.id });
  await audit(db, actor, 'schema.update', { type: 'seo_settings', id: KEY }, 'Edited structured data settings');
  return loadSettings(db);
}

export const SCHEMA_ACTIONS = { submit: 'seo.update', withdraw: 'seo.update', request_changes: 'seo.approve', approve: 'seo.approve' } as const;
export async function transitionSettings(db: DB, actor: NonNullable<Actor>, role: Role, action: keyof typeof SCHEMA_ACTIONS, comment = '') {
  const cur = await loadSettings(db);
  if (!cur?.draft) throw new AppError(404, 'Save the settings first.');
  const from = cur.status; let to: typeof from;
  if (action === 'submit') { if (from !== 'draft' && from !== 'changes_requested') throw new AppError(409, 'Only a draft can be sent for review.'); to = 'in_review'; }
  else if (action === 'withdraw') { if (from !== 'in_review' && from !== 'approved') throw new AppError(409, 'Nothing to withdraw.'); to = 'draft'; }
  else {
    if (from !== 'in_review') throw new AppError(409, 'Only settings in review can be reviewed.');
    if (cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must review these settings.');
    if (action === 'request_changes' && !comment.trim()) throw new AppError(422, 'Say what needs to change.');
    to = action === 'approve' ? 'approved' : 'changes_requested';
  }
  await db.update(seoSettings).set({ status: to, ...(action === 'submit' ? { submittedBy: actor.id } : {}), updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  await audit(db, actor, `schema.${action}`, { type: 'seo_settings', id: KEY }, comment ? `${action}: ${comment.slice(0, 300)}` : action);
  return loadSettings(db);
}

export async function settingsView(db: DB, cfg: Config, live: LiveForSchema) {
  const site = await siteUrl(db);
  const row = await loadSettings(db);
  const [by] = row?.updatedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)) : [];
  const draft = (row?.draft as SchemaSettings | null) ?? EMPTY;
  const published = (row?.published as SchemaSettings | null) ?? null;
  const built = builtOrganization(cfg);
  const generated = [
    ...live.articles.map((a) => ({ kind: 'Article', file: articleFile(a.snap), title: a.snap.title, ld: articleLd(a.snap, a.img, site) })).filter((x) => x.file),
    ...live.events.map((e) => ({ kind: 'Event', file: eventFile(e.snap.slug), title: e.snap.title, ld: eventLd(e.snap, e.img, site) })),
  ].map((g) => ({ ...g, check: validateLd(g.ld as Record<string, unknown>) }));
  // the website build applies src/data/schema.json only once build.mjs has the Studio hook; until then publishing is off
  const buildFile = resolve(cfg.siteRoot, 'build.mjs');
  const buildSupport = existsSync(buildFile) && /SCHEMA_JSON|schema\.json/.test(readFileSync(buildFile, 'utf8'));
  return {
    buildSupport, status: row?.status ?? null, draft, published, publishedAt: row?.publishedAt ?? null, updatedAt: row?.updatedAt ?? null, updatedByName: by?.name ?? null,
    submittedBy: row?.submittedBy ?? null,
    // what the homepage would carry: the current build's organization with the draft's fields over it
    organization: { built, preview: built ? { ...built, ...orgOverrides(draft) } : null },
    generated,
  };
}
