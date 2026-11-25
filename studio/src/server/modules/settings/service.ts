// Settings Center: General, Branding and Contact & social.
//
// Storage reuses seo_settings (like Menus and Schema studio): row 'settings:<category>' keeps the saved value (draft) and
// the value on the website (published). Saving never changes the site; "Publish settings" writes src/data/site-settings.json
// and rebuilds (see Publisher.publishSiteSettings). build.mjs + lib/site-settings.mjs apply that file; without it the site
// builds exactly as before, and the defaults below are exactly what the site shows today, so nothing is invented.
// Every save and restore adds a settings_revisions row (no secrets exist in these three categories).
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { media, seoSettings, settingsRevisions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { can, type Role } from '../../rbac.ts';
import { publicRef } from '../media/service.ts';
import { PUBLIC_EMAILS } from '../seo/schema.ts';

type Me = NonNullable<Actor>;
export const SITE_CATEGORIES = ['general', 'branding', 'contact'] as const;
export type SiteCategory = (typeof SITE_CATEGORIES)[number];
export const HISTORY_CATEGORIES = [...SITE_CATEGORIES, 'email', 'templates', 'notifications'] as const;
export type HistoryCategory = (typeof HISTORY_CATEGORIES)[number];
export const rowKey = (c: SiteCategory) => `settings:${c}`;

const plain = (n: number) => z.string().trim().max(n).refine((v) => !/[<>"]/.test(v), 'Use plain text, without < > or quotes.');
const mediaId = z.string().uuid().nullable().default(null);
const social = (host: RegExp, example: string) => z.string().trim().max(200)
  .refine((v) => v === '' || (/^https:\/\/[^\s"'<>]+$/.test(v) && host.test(new URL(v).hostname)), `Use the full profile address, e.g. ${example}, or leave it empty to hide the link.`);

export const SCHEMAS = {
  general: z.object({
    siteName: plain(80).min(2, 'Add the site name.'),
    canonicalUrl: z.string().trim().max(120)
      .regex(/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/$/i, 'Use the https address of the live site with a slash at the end, e.g. https://afcdfoundation.com/'),
    environment: z.enum(['preview', 'production']),
  }).strict(),
  branding: z.object({
    logoMediaId: mediaId,
    logoLightMediaId: mediaId,
    faviconMediaId: mediaId,
    socialImageMediaId: mediaId,
    socialImageAlt: plain(200).default(''),
    // monochrome presets only: the site design is black and white
    themeColor: z.enum(['#000000', '#FFFFFF']).default('#000000'),
  }).strict(),
  contact: z.object({
    phone: z.string().trim().max(24).regex(/^\+[0-9][0-9 ]{7,19}$/, 'Use the international format, e.g. +212 663 618 536.'),
    generalEmail: z.enum(PUBLIC_EMAILS as [string, ...string[]], { message: `Use one of the foundation’s public addresses: ${PUBLIC_EMAILS.join(' or ')}.` }),
    boardEmail: z.enum(PUBLIC_EMAILS as [string, ...string[]], { message: `Use one of the foundation’s public addresses: ${PUBLIC_EMAILS.join(' or ')}.` }),
    social: z.object({
      facebook: social(/(^|\.)facebook\.com$/i, 'https://www.facebook.com/afcd.foundation'),
      instagram: social(/(^|\.)instagram\.com$/i, 'https://www.instagram.com/afcd.foundation'),
      linkedin: social(/(^|\.)linkedin\.com$/i, 'https://www.linkedin.com/company/afcd-foundation'),
    }).strict(),
  }).strict(),
} as const;
export type Values = { [K in SiteCategory]: z.infer<(typeof SCHEMAS)[K]> };

/** What the site shows today (build.mjs, src/partials, src/pages/contact.html). Publishing these changes nothing. */
export const DEFAULTS: Values = {
  general: { siteName: 'AFCD Foundation', canonicalUrl: 'https://afcdfoundation.com/', environment: 'preview' },
  branding: { logoMediaId: null, logoLightMediaId: null, faviconMediaId: null, socialImageMediaId: null, socialImageAlt: '', themeColor: '#000000' },
  contact: {
    phone: '+212 663 618 536', generalEmail: 'contact@afcdteam.com', boardEmail: 'akaya@afcdteam.com',
    social: { facebook: 'https://www.facebook.com/afcd.foundation', instagram: 'https://www.instagram.com/afcd.foundation', linkedin: 'https://www.linkedin.com/company/afcd-foundation' },
  },
};
/** Fields only settings.admin may change (and restore). */
export const ADMIN_FIELDS: Record<SiteCategory, string[]> = { general: ['canonicalUrl', 'environment'], branding: [], contact: [] };

export const isSiteCategory = (c: string): c is SiteCategory => (SITE_CATEGORIES as readonly string[]).includes(c);
export const isHistoryCategory = (c: string): c is HistoryCategory => (HISTORY_CATEGORIES as readonly string[]).includes(c);

function parse<C extends SiteCategory>(c: C, raw: unknown): Values[C] {
  const r = SCHEMAS[c].safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data as Values[C];
}
// jsonb does not keep key order, so values are compared with their keys sorted
const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
export const changedKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));

export async function loadRows(db: DB) {
  const rows = await db.select().from(seoSettings).where(inArray(seoSettings.key, SITE_CATEGORIES.map(rowKey)));
  const by = new Map(rows.map((r) => [r.key, r]));
  return Object.fromEntries(SITE_CATEGORIES.map((c) => {
    const r = by.get(rowKey(c));
    // stored values are re-read through the schema with defaults, so an older row never breaks the screen
    const draft = { ...DEFAULTS[c], ...((r?.draft as object | null) ?? {}) };
    const { _revision, ...pub } = (r?.published ?? {}) as Record<string, unknown>; void _revision;
    const published = r?.published ? { ...DEFAULTS[c], ...pub } : null;
    return [c, { draft, published, updatedAt: r?.updatedAt ?? null, publishedAt: r?.publishedAt ?? null, updatedBy: r?.updatedBy ?? null }];
  })) as { [K in SiteCategory]: { draft: Values[K]; published: Values[K] | null; updatedAt: Date | null; publishedAt: Date | null; updatedBy: string | null } };
}

/** Media used by branding: exists and is an image of a usable size. Returns a preview for the screen. */
async function brandMedia(db: DB, ids: (string | null)[]) {
  const want = ids.filter((x): x is string => !!x);
  const rows = want.length ? await db.select().from(media).where(inArray(media.id, want)) : [];
  return new Map(rows.map((m) => [m.id, m]));
}
async function checkBranding(db: DB, v: Values['branding']) {
  const found = await brandMedia(db, [v.logoMediaId, v.logoLightMediaId, v.faviconMediaId, v.socialImageMediaId]);
  const need = (key: keyof Values['branding'], what: string) => {
    const id = v[key] as string | null;
    if (id && !found.has(id)) throw new AppError(422, `The ${what} is no longer in the Media library. Choose another image.`, [{ path: key, message: `The ${what} is no longer in the Media library. Choose another image.` }]);
    return id ? found.get(id)! : null;
  };
  need('logoMediaId', 'header logo'); need('logoLightMediaId', 'footer logo');
  const fav = need('faviconMediaId', 'favicon');
  if (fav && (Math.abs(fav.width - fav.height) > Math.max(2, fav.width * 0.02) || fav.width < 48)) throw new AppError(422, 'The favicon must be square and at least 48 × 48 pixels.', [{ path: 'faviconMediaId', message: 'The favicon must be square and at least 48 × 48 pixels.' }]);
  const og = need('socialImageMediaId', 'share image');
  if (og && (og.width < 600 || og.height < 315)) throw new AppError(422, 'The share image must be at least 600 × 315 pixels (1200 × 630 is best).', [{ path: 'socialImageMediaId', message: 'At least 600 × 315 pixels (1200 × 630 is best).' }]);
}

/** Saves one category as a draft (the website is unchanged until settings are published) and records a revision. */
export async function save(db: DB, me: Me, role: Role, c: SiteCategory, raw: unknown, opts: { restoredFrom?: string } = {}) {
  const next = parse(c, raw);
  const rows = await loadRows(db);
  const cur = rows[c].draft as Record<string, unknown>;
  const changed = changedKeys(cur, next as Record<string, unknown>);
  const adminTouched = changed.filter((k) => ADMIN_FIELDS[c].includes(k));
  if (adminTouched.length && !can(role, 'settings.admin')) throw new AppError(422, `Only an administrator can change: ${adminTouched.join(', ')}.`, adminTouched.map((k) => ({ path: k, message: 'Only an administrator can change this.' })));
  if (c === 'branding') await checkBranding(db, next as Values['branding']);
  if (!changed.length && !opts.restoredFrom) return { changed: [] as string[], revisionId: null };
  const key = rowKey(c);
  const [exists] = await db.select({ key: seoSettings.key }).from(seoSettings).where(eq(seoSettings.key, key));
  if (exists) await db.update(seoSettings).set({ draft: next as Record<string, unknown>, status: 'draft', updatedBy: me.id, updatedAt: new Date() }).where(eq(seoSettings.key, key));
  else await db.insert(seoSettings).values({ key, draft: next as Record<string, unknown>, status: 'draft', updatedBy: me.id });
  const revisionId = await addRevision(db, me, c, next as Record<string, unknown>, changed, opts.restoredFrom);
  await audit(db, me, opts.restoredFrom ? 'settings.restore' : 'settings.update', { type: 'settings', id: c },
    `${opts.restoredFrom ? 'Restored' : 'Changed'} ${c} settings${changed.length ? `: ${changed.join(', ')}` : ''}`, { revisionId, restoredFrom: opts.restoredFrom ?? null, changed });
  return { changed, revisionId };
}

export async function addRevision(db: DB, me: Me, category: HistoryCategory, values: Record<string, unknown>, changed: string[], restoredFrom?: string, summary = '') {
  const [r] = await db.insert(settingsRevisions).values({ category, values, changed, restoredFrom: restoredFrom ?? null, actorId: me.id, actorEmail: me.email,
    summary: summary || (restoredFrom ? 'Restored an earlier revision' : changed.length ? `Changed ${changed.join(', ')}` : 'Saved') }).returning({ id: settingsRevisions.id });
  return r.id;
}

export async function history(db: DB, category?: HistoryCategory, limit = 50) {
  const q = db.select({ id: settingsRevisions.id, category: settingsRevisions.category, changed: settingsRevisions.changed, summary: settingsRevisions.summary,
    restoredFrom: settingsRevisions.restoredFrom, actorEmail: settingsRevisions.actorEmail, actorName: users.name, createdAt: settingsRevisions.createdAt })
    .from(settingsRevisions).leftJoin(users, eq(users.id, settingsRevisions.actorId));
  return (category ? q.where(eq(settingsRevisions.category, category)) : q).orderBy(desc(settingsRevisions.createdAt)).limit(Math.min(200, limit));
}
export async function revision(db: DB, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'Revision not found.');
  const [r] = await db.select().from(settingsRevisions).where(eq(settingsRevisions.id, id));
  if (!r) throw new AppError(404, 'Revision not found.');
  return r;
}

/** Restores a General, Branding or Contact revision as a new revision (the history is never rewritten). */
export async function restore(db: DB, me: Me, role: Role, id: string) {
  const r = await revision(db, id);
  if (!isSiteCategory(r.category)) throw new AppError(409, 'This revision is restored by its own section.');
  return { category: r.category, ...(await save(db, me, role, r.category, r.values, { restoredFrom: r.id })) };
}

// ---------------------------------------------------------------- Website file
export type SiteFile = {
  version: 1; source: 'AFCD Studio'; revision: string;
  site: { name: string; canonicalUrl: string; environment: 'preview' | 'production' };
  contact: { phone: string; tel: string; generalEmail: string; boardEmail: string; social: Values['contact']['social'] };
  brand: { themeColor: string; logo: Img | null; logoLight: Img | null; favicon: Img | null; socialImage: (Img & { alt: string }) | null };
};
type Img = { src: string; w: number; h: number };

/** src/data/site-settings.json for the given values (published, or the drafts being published) and the media to copy. */
export async function siteFile(db: DB, v: Values, revision: string): Promise<{ content: string; mediaIds: string[] }> {
  const b = v.branding;
  const found = await brandMedia(db, [b.logoMediaId, b.logoLightMediaId, b.faviconMediaId, b.socialImageMediaId]);
  const img = (id: string | null): Img | null => { const m = id ? found.get(id) : null; if (!m) return null; const p = publicRef(m); return { src: p.src, w: p.w, h: p.h }; };
  const og = b.socialImageMediaId ? found.get(b.socialImageMediaId) : null;
  const file: SiteFile = {
    version: 1, source: 'AFCD Studio', revision,
    site: { name: v.general.siteName, canonicalUrl: v.general.canonicalUrl, environment: v.general.environment },
    contact: { ...v.contact, tel: v.contact.phone.replace(/\s+/g, '') },
    brand: { themeColor: b.themeColor, logo: img(b.logoMediaId), logoLight: img(b.logoLightMediaId), favicon: img(b.faviconMediaId),
      socialImage: og ? { ...img(og.id)!, alt: b.socialImageAlt.trim() || og.alt } : null },
  };
  return { content: JSON.stringify(file, null, 1) + '\n', mediaIds: [...found.keys()] };
}

/** The values on the website, or null when settings were never published (the site then uses its own built-in values). */
export async function publishedValues(db: DB): Promise<(Values & { revision: string }) | null> {
  const rows = await loadRows(db);
  const rev = (await db.select({ p: seoSettings.published }).from(seoSettings).where(eq(seoSettings.key, rowKey('general'))))[0]?.p as { _revision?: string } | null | undefined;
  if (!SITE_CATEGORIES.some((c) => rows[c].published)) return null;
  return {
    general: rows.general.published ?? DEFAULTS.general, branding: rows.branding.published ?? DEFAULTS.branding, contact: rows.contact.published ?? DEFAULTS.contact,
    revision: rev?._revision ?? 'published',
  };
}

/** Screen data for the three website categories, with media previews and what is not yet on the website. */
export async function view(db: DB) {
  const rows = await loadRows(db);
  const b = rows.branding.draft;
  const found = await brandMedia(db, [b.logoMediaId, b.logoLightMediaId, b.faviconMediaId, b.socialImageMediaId]);
  const preview = (id: string | null) => { const m = id ? found.get(id) : null; return m ? { id: m.id, url: `/studio/media-file/${m.storageKey}-480.webp`, width: m.width, height: m.height, alt: m.alt, name: m.originalName, rightsConfirmed: m.rightsConfirmed } : null; };
  const strip = (x: Record<string, unknown> | null) => { if (!x) return null; const { _revision, ...rest } = x as Record<string, unknown> & { _revision?: unknown }; void _revision; return rest; };
  return {
    categories: Object.fromEntries(SITE_CATEGORIES.map((c) => {
      const pub = strip(rows[c].published as Record<string, unknown> | null);
      const base = pub ?? (DEFAULTS[c] as Record<string, unknown>);
      return [c, { draft: rows[c].draft, published: pub, defaults: DEFAULTS[c], unpublished: changedKeys(base, rows[c].draft as Record<string, unknown>), updatedAt: rows[c].updatedAt, publishedAt: rows[c].publishedAt }];
    })),
    media: { logo: preview(b.logoMediaId), logoLight: preview(b.logoLightMediaId), favicon: preview(b.faviconMediaId), socialImage: preview(b.socialImageMediaId) },
    adminFields: ADMIN_FIELDS,
  };
}

export async function draftValues(db: DB): Promise<Values> {
  const rows = await loadRows(db);
  return { general: rows.general.draft, branding: rows.branding.draft, contact: rows.contact.draft };
}
