// Media Library: where each image is used, duplicate detection, replacing a file in place, bulk edits.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import * as t from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { DERIVATIVE_WIDTHS, isoDate, type MediaRow } from './service.ts';
import { RECORDS } from '../review/queue.ts';

export type Use = { kind: string; title: string; href: string; where: string; live: boolean };

/** Every place that uses each image: current drafts, galleries, page blocks, homepage fields and the published versions. */
export async function usage(db: DB, ids: string[]): Promise<Record<string, Use[]>> {
  const out: Record<string, Use[]> = {};
  if (!ids.length) return out;
  const want = new Set(ids);
  const add = (id: string | null | undefined, u: Use) => { if (!id || !want.has(id)) return; const l = (out[id] ??= []); if (!l.some((x) => x.href === u.href && x.where === u.where)) l.push(u); };
  for (const r of await db.select({ id: t.projects.id, name: t.projects.name, m: t.projects.heroMediaId }).from(t.projects).where(inArray(t.projects.heroMediaId, ids)))
    add(r.m, { kind: 'Project', title: r.name, href: `/studio/projects/${r.id}`, where: 'Main photo', live: false });
  for (const r of await db.select({ id: t.projects.id, name: t.projects.name, m: t.projectGallery.mediaId }).from(t.projectGallery).innerJoin(t.projects, eq(t.projects.id, t.projectGallery.projectId)).where(inArray(t.projectGallery.mediaId, ids)))
    add(r.m, { kind: 'Project', title: r.name, href: `/studio/projects/${r.id}`, where: 'Gallery', live: false });
  for (const r of await db.select({ id: t.articles.id, name: t.articles.title, m: t.articles.heroMediaId }).from(t.articles).where(inArray(t.articles.heroMediaId, ids)))
    add(r.m, { kind: 'Story', title: r.name, href: `/studio/news/${r.id}`, where: 'Cover photo', live: false });
  for (const r of await db.select({ id: t.articles.id, name: t.articles.title, m: t.articleGallery.mediaId }).from(t.articleGallery).innerJoin(t.articles, eq(t.articles.id, t.articleGallery.articleId)).where(inArray(t.articleGallery.mediaId, ids)))
    add(r.m, { kind: 'Story', title: r.name, href: `/studio/news/${r.id}`, where: 'Gallery', live: false });
  for (const r of await db.select({ id: t.events.id, name: t.events.title, m: t.events.posterMediaId }).from(t.events).where(inArray(t.events.posterMediaId, ids)))
    add(r.m, { kind: 'Event', title: r.name, href: `/studio/events/${r.id}`, where: 'Poster', live: false });
  for (const r of await db.select({ id: t.opportunities.id, name: t.opportunities.title, m: t.opportunities.heroMediaId }).from(t.opportunities).where(inArray(t.opportunities.heroMediaId, ids)))
    add(r.m, { kind: 'Opportunity', title: r.name, href: `/studio/opportunities/${r.id}`, where: 'Image', live: false });
  for (const r of await db.select({ id: t.partners.id, name: t.partners.name, m: t.partners.logoMediaId }).from(t.partners).where(inArray(t.partners.logoMediaId, ids)))
    add(r.m, { kind: 'Partner', title: r.name, href: `/studio/partners/${r.id}`, where: 'Logo', live: false });
  for (const r of await db.select({ id: t.seoOverrides.id, file: t.seoOverrides.file, m: t.seoOverrides.imageMediaId }).from(t.seoOverrides).where(inArray(t.seoOverrides.imageMediaId, ids)))
    add(r.m, { kind: 'SEO', title: r.file, href: '/studio/seo/pages', where: 'Share image', live: false });
  // documents that refer to images by id inside JSON: page blocks and homepage fields
  const inJson = (v: unknown) => { const s = JSON.stringify(v ?? null); return ids.filter((id) => s.includes(id)); };
  for (const r of await db.select({ id: t.pages.id, title: t.pages.title, doc: t.pages.doc }).from(t.pages))
    for (const m of inJson(r.doc)) add(m, { kind: 'Page', title: r.title, href: `/studio/pages/${r.id}`, where: 'Page content', live: false });
  for (const r of await db.select({ id: t.pageContents.id, values: t.pageContents.values }).from(t.pageContents))
    for (const m of inJson(r)) add(m, { kind: 'Homepage', title: 'Homepage', href: '/studio/home', where: 'Homepage photo', live: false });
  // what the website shows now: the published version of every record
  for (const s of RECORDS) {
    const rows = await db.select({ id: s.table.id, pub: s.table.publishedRevisionId }).from(s.table).where(isNotNull(s.table.publishedRevisionId));
    const revIds = rows.map((r) => r.pub as string);
    if (!revIds.length) continue;
    for (const rev of await db.select().from(s.rev).where(inArray(s.rev.id, revIds))) {
      const owner = rows.find((r) => r.pub === rev.id)!;
      for (const m of inJson(rev.snapshot)) add(m, { kind: s.label, title: s.label === 'Homepage' ? 'Homepage' : String((rev.snapshot as Record<string, unknown>).title ?? (rev.snapshot as Record<string, unknown>).name ?? s.label), href: s.href(owner.id), where: 'Live on the website', live: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------- duplicates
const fp = new Map<string, { sha: string; dhash: bigint; rgb: number[] }>();   // by storage key (the file never changes under a key, except on replace)
async function fingerprint(cfg: Config, m: MediaRow) {
  const hit = fp.get(m.storageKey); if (hit) return hit;
  const orig = readdirSync(cfg.mediaDir).find((f) => f.startsWith(`${m.storageKey}.orig.`));
  const file = orig ? resolve(cfg.mediaDir, orig) : resolve(cfg.mediaDir, `${m.storageKey}-480.webp`);
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  const sha = createHash('sha256').update(buf).digest('hex');
  // difference hash: 9x8 grayscale, one bit per neighbour comparison; robust to resizing and recompression
  const px = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let dhash = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dhash = (dhash << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  // average colour: a structure hash alone cannot tell two smooth gradients of different colours apart
  const rgb = [...(await sharp(buf).rotate().removeAlpha().resize(1, 1, { fit: 'fill' }).raw().toBuffer())];
  const v = { sha, dhash, rgb }; fp.set(m.storageKey, v); return v;
}
const bits = (n: bigint) => { let c = 0; while (n) { c += Number(n & 1n); n >>= 1n; } return c; };
/** Groups of images that are the same file, or look the same (at most 5 of 64 structure bits differ, and the average colour matches). */
export async function duplicates(cfg: Config, rows: MediaRow[]) {
  const prints = await Promise.all(rows.map(async (m) => ({ m, p: await fingerprint(cfg, m).catch(() => null) })));
  const groupOf = new Map<string, { ids: string[]; exact: boolean }>();
  for (let i = 0; i < prints.length; i++) for (let j = i + 1; j < prints.length; j++) {
    const a = prints[i], b = prints[j]; if (!a.p || !b.p) continue;
    const exact = a.p.sha === b.p.sha; const sameColour = a.p.rgb.every((c, k) => Math.abs(c - b.p!.rgb[k]) <= 20);
    const close = exact || (bits(a.p.dhash ^ b.p.dhash) <= 5 && sameColour);
    if (!close) continue;
    const g = groupOf.get(a.m.id) ?? groupOf.get(b.m.id) ?? { ids: [], exact: true };
    for (const x of [a.m.id, b.m.id]) if (!g.ids.includes(x)) g.ids.push(x);
    g.exact = g.exact && exact;
    groupOf.set(a.m.id, g); groupOf.set(b.m.id, g);
  }
  return groupOf;   // media id -> its group
}

// ---------------------------------------------------------------- replace a file, keeping every reference
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff']);
export async function replaceFile(db: DB, cfg: Config, m: MediaRow, file: { name: string; bytes: Uint8Array }) {
  if (!file.bytes.byteLength) throw new AppError(422, 'The file is empty.');
  if (file.bytes.byteLength > cfg.maxUploadBytes) throw new AppError(422, `The file is larger than ${Math.round(cfg.maxUploadBytes / 1048576)} MB.`);
  let meta: Metadata;
  try { meta = await sharp(file.bytes, { limitInputPixels: 80_000_000 }).metadata(); } catch { throw new AppError(422, 'This file is not a supported image.'); }
  if (!meta.format || !ALLOWED.has(meta.format) || !meta.width || !meta.height) throw new AppError(422, 'Use a JPEG, PNG, WebP, AVIF or TIFF image.');
  const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
  // the previous original goes (its format may differ); the new one takes its place under the same key
  for (const f of readdirSync(cfg.mediaDir).filter((f) => f.startsWith(`${m.storageKey}.orig.`))) rmSync(resolve(cfg.mediaDir, f));
  writeFileSync(resolve(cfg.mediaDir, `${m.storageKey}.orig.${ext}`), file.bytes);
  const base = sharp(file.bytes).rotate();
  const info = (await base.clone().toBuffer({ resolveWithObject: true })).info;
  // Same file names as before, so pages and published versions that point at them keep working.
  const had = DERIVATIVE_WIDTHS.filter((w) => existsSync(resolve(cfg.mediaDir, `${m.storageKey}-${w}.webp`)));
  for (const w of new Set([...had, ...DERIVATIVE_WIDTHS.filter((w, i) => i === 0 || w <= info.width)]))
    await base.clone().resize({ width: Math.min(w, info.width), withoutEnlargement: true }).webp({ quality: 80 }).toFile(resolve(cfg.mediaDir, `${m.storageKey}-${w}.webp`));
  fp.delete(m.storageKey);
  const [row] = await db.update(t.media).set({ mime: `image/${meta.format}`, width: info.width, height: info.height, bytes: file.bytes.byteLength, rightsConfirmed: false, updatedAt: new Date() }).where(eq(t.media.id, m.id)).returning();
  return row;
}

export function originalFile(cfg: Config, m: MediaRow) {
  const f = existsSync(cfg.mediaDir) ? readdirSync(cfg.mediaDir).find((x) => x.startsWith(`${m.storageKey}.orig.`)) : undefined;
  return f ? { path: resolve(cfg.mediaDir, f), ext: f.split('.').pop()! } : null;
}

export const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  addTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  removeTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  credit: z.string().trim().max(200).optional(),
  rightsConfirmed: z.boolean().optional(),
  licence: z.string().trim().max(120).optional(),
  rightsExpiresOn: isoDate.nullable().optional(),
}).strict();
export async function bulkUpdate(db: DB, input: z.infer<typeof bulkSchema>) {
  const rows = await db.select().from(t.media).where(inArray(t.media.id, input.ids));
  for (const m of rows) {
    const tags = [...new Set([...m.tags.filter((x) => !(input.removeTags ?? []).includes(x)), ...(input.addTags ?? [])])].slice(0, 20);
    await db.update(t.media).set({ tags, ...(input.credit !== undefined ? { credit: input.credit } : {}), ...(input.rightsConfirmed !== undefined ? { rightsConfirmed: input.rightsConfirmed } : {}), ...(input.licence !== undefined ? { licence: input.licence } : {}), ...(input.rightsExpiresOn !== undefined ? { rightsExpiresOn: input.rightsExpiresOn } : {}), updatedAt: new Date() }).where(eq(t.media.id, m.id));
  }
  return rows.length;
}
