// Media library: validated uploads, WebP derivatives, metadata and reuse tracking.
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { desc, eq, ilike, or, count } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media } from '../../db/schema.ts';
import { AppError } from '../../http.ts';

// 2400 and 3200 keep full-width photos (hero slider, photo viewer) sharp on high-density laptop and phone screens.
export const DERIVATIVE_WIDTHS = [480, 960, 1600, 2400, 3200] as const;
/** Compression levels for the website copies (WebP). New uploads use 'best' (sharp slider and full-width photos);
 * lighter levels are chosen per image in the Media Library. The original upload is never touched. */
export const QUALITY = { best: 86, balanced: 78, smaller: 68 } as const;
export type Level = keyof typeof QUALITY;
export const LEVELS = Object.keys(QUALITY) as Level[];
const level = (q: string | null | undefined): Level => (q && q in QUALITY ? q as Level : 'best');
export const toWebp = (img: Sharp, q?: string | null) => img.webp({ quality: QUALITY[level(q)], smartSubsample: true, effort: 5 });
/** Bytes of the copies the website uses (all sizes). */
export const webBytes = (cfg: Config, m: Pick<MediaRow, 'storageKey'>) => DERIVATIVE_WIDTHS.reduce((n, w) => { const p = resolve(cfg.mediaDir, `${m.storageKey}-${w}.webp`); return n + (existsSync(p) ? statSync(p).size : 0); }, 0);
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
    await toWebp(base.clone().resize({ width: Math.min(w, w0), withoutEnlargement: true }), 'best')
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

/** A calendar day, YYYY-MM-DD (the end of a usage right). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-06-30.').refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date.');

export const mediaUpdateSchema = z.object({
  alt: z.string().trim().max(250).optional(),
  caption: z.string().trim().max(500).optional(),
  credit: z.string().trim().max(200).optional(),
  rightsConfirmed: z.boolean().optional(),
  licence: z.string().trim().max(120).optional(),
  rightsExpiresOn: isoDate.nullable().optional(),
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

/** How many places use each image (drafts, galleries, page blocks, homepage, published versions): see library.ts. */
export async function usageCounts(db: DB, ids: string[]) {
  const { usage } = await import('./library.ts');
  const u = await usage(db, ids);
  return Object.fromEntries(Object.entries(u).map(([id, l]) => [id, l.length])) as Record<string, number>;
}

/** Moves an unused image to the trash (restorable for 30 days). In use: refused, see trashMedia({ force }) in trash.ts. */
export async function deleteMedia(db: DB, cfg: Config, id: string) {
  const { trashMedia } = await import('./trash.ts');
  return (await trashMedia(db, cfg, id)).row;
}
