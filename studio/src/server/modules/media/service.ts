// Media library: validated uploads, WebP derivatives, metadata and reuse tracking.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { desc, eq, ilike, or, count, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, projects, projectGallery } from '../../db/schema.ts';
import { AppError } from '../../http.ts';

export const DERIVATIVE_WIDTHS = [480, 960, 1600] as const;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff']);   // decoded formats; SVG/GIF/HTML etc. are refused

export type MediaRow = typeof media.$inferSelect;

/** Validates by decoding (not by file name or client MIME), keeps the original, writes WebP derivatives without metadata. */
export async function ingestUpload(db: DB, cfg: Config, file: { name: string; bytes: Uint8Array }, userId: string) {
  if (file.bytes.byteLength === 0) throw new AppError(422, 'The file is empty.');
  if (file.bytes.byteLength > cfg.maxUploadBytes) throw new AppError(422, `The file is larger than ${Math.round(cfg.maxUploadBytes / 1048576)} MB.`);
  let meta: Metadata;
  try { meta = await sharp(file.bytes, { limitInputPixels: 80_000_000 }).metadata(); }
  catch { throw new AppError(422, 'This file is not a supported image.'); }
  if (!meta.format || !ALLOWED.has(meta.format) || !meta.width || !meta.height) throw new AppError(422, 'Use a JPEG, PNG, WebP, AVIF or TIFF image.');

  const key = randomBytes(12).toString('hex');
  mkdirSync(cfg.mediaDir, { recursive: true });
  const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
  writeFileSync(resolve(cfg.mediaDir, `${key}.orig.${ext}`), file.bytes);

  // Auto-rotate from EXIF, then strip all metadata (GPS etc.) from published derivatives.
  const base = sharp(file.bytes).rotate();
  const { width: w0 = meta.width, height: h0 = meta.height } = await base.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  for (const w of DERIVATIVE_WIDTHS) {
    if (w > w0 && w !== DERIVATIVE_WIDTHS[0]) continue;
    await base.clone().resize({ width: Math.min(w, w0), withoutEnlargement: true }).webp({ quality: 80 })
      .toFile(resolve(cfg.mediaDir, `${key}-${w}.webp`));
  }
  const [row] = await db.insert(media).values({
    originalName: file.name.slice(0, 200).replace(/[^\w.\- ()]/g, '_'),
    storageKey: key, mime: `image/${meta.format}`, width: w0, height: h0, bytes: file.bytes.byteLength, uploadedBy: userId,
  }).returning();
  return row;
}

export function derivativeWidths(m: Pick<MediaRow, 'width'>) {
  return DERIVATIVE_WIDTHS.filter((w, i) => i === 0 || w <= m.width);
}

/** Shape the public generator expects (see media_img in src/content.py). */
export function publicRef(m: MediaRow, prefix = 'assets/media/') {
  const widths = derivativeWidths(m);
  const largest = widths[widths.length - 1];
  const scale = Math.min(1, largest / m.width);
  return {
    id: m.id,
    src: `${prefix}${m.storageKey}-${largest}.webp`,
    srcset: widths.map((w) => `${prefix}${m.storageKey}-${w}.webp ${Math.min(w, m.width)}w`).join(', '),
    w: Math.round(m.width * scale), h: Math.round(m.height * scale),
    alt: m.alt, fx: m.focalX, fy: m.focalY,
  };
}

export function derivativeFiles(m: Pick<MediaRow, 'storageKey' | 'width'>) {
  return derivativeWidths(m).map((w) => `${m.storageKey}-${w}.webp`);
}

export const mediaUpdateSchema = z.object({
  alt: z.string().trim().max(250).optional(),
  caption: z.string().trim().max(500).optional(),
  credit: z.string().trim().max(200).optional(),
  rightsConfirmed: z.boolean().optional(),
  focalX: z.number().int().min(0).max(100).optional(),
  focalY: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
}).strict();

export async function listMedia(db: DB, q: string | undefined, limit = 60, offset = 0) {
  const where = q ? or(ilike(media.originalName, `%${q}%`), ilike(media.alt, `%${q}%`), ilike(media.caption, `%${q}%`)) : undefined;
  const rows = await db.select().from(media).where(where).orderBy(desc(media.createdAt)).limit(limit).offset(offset);
  const [{ n }] = await db.select({ n: count() }).from(media).where(where);
  const usage = await usageCounts(db, rows.map((r) => r.id));
  return { items: rows.map((r) => ({ ...r, url: `/studio/media-file/${r.storageKey}-480.webp`, usedBy: usage[r.id] ?? 0 })), total: n };
}

export async function usageCounts(db: DB, ids: string[]) {
  if (!ids.length) return {} as Record<string, number>;
  const res: Record<string, number> = {};
  const heroes = await db.select({ id: projects.heroMediaId }).from(projects).where(inArray(projects.heroMediaId, ids));
  for (const h of heroes) if (h.id) res[h.id] = (res[h.id] ?? 0) + 1;
  const gal = await db.select({ id: projectGallery.mediaId }).from(projectGallery).where(inArray(projectGallery.mediaId, ids));
  for (const g of gal) res[g.id] = (res[g.id] ?? 0) + 1;
  return res;
}

export async function deleteMedia(db: DB, cfg: Config, id: string) {
  const [m] = await db.select().from(media).where(eq(media.id, id));
  if (!m) throw new AppError(404, 'Media not found.');
  const used = (await usageCounts(db, [id]))[id] ?? 0;
  if (used) throw new AppError(409, 'This image is used by content. Remove it there first.');
  await db.delete(media).where(eq(media.id, id));
  for (const f of [...derivativeFiles(m), ...DERIVATIVE_WIDTHS.map((w) => `${m.storageKey}-${w}.webp`)]) {
    const p = resolve(cfg.mediaDir, f); if (existsSync(p)) rmSync(p);
  }
  return m;
}
