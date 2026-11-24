// Crop without losing anything: the original file stays as uploaded, and the resized copies the website uses are made
// again from it with the crop applied (same file names, so every page keeps pointing at them). Re-crop or reset any time.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import * as t from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { DERIVATIVE_WIDTHS, type MediaRow } from './service.ts';
import { originalFile } from './library.ts';

export const cropSchema = z.object({
  crop: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(16), h: z.number().int().min(16) }).strict().nullable(),
}).strict();
export type Crop = { x: number; y: number; w: number; h: number };

/** Size of the original as the browser shows it (EXIF rotation applied). */
async function uprightSize(buf: Buffer) {
  const m = await sharp(buf, { limitInputPixels: 80_000_000 }).metadata();
  const turn = (m.orientation ?? 1) >= 5;
  return { w: (turn ? m.height : m.width) ?? 0, h: (turn ? m.width : m.height) ?? 0 };
}

export async function cropMedia(db: DB, cfg: Config, m: MediaRow, crop: Crop | null) {
  const o = originalFile(cfg, m);
  if (!o) throw new AppError(409, 'The original file is missing, so this image cannot be cropped. Replace the file first.');
  const buf = readFileSync(o.path);
  const full = await uprightSize(buf);
  if (crop && (crop.x + crop.w > full.w || crop.y + crop.h > full.h)) throw new AppError(422, `The crop goes outside the image (${full.w}×${full.h}).`);
  const whole = !crop || (crop.x === 0 && crop.y === 0 && crop.w === full.w && crop.h === full.h);
  const box = whole ? { x: 0, y: 0, w: full.w, h: full.h } : crop!;

  let base = sharp(buf, { limitInputPixels: 80_000_000 }).rotate();
  if (!whole) base = base.extract({ left: box.x, top: box.y, width: box.w, height: box.h });
  // Same file names as before. Widths that existed stay (published pages may use them until the next publish).
  const had = DERIVATIVE_WIDTHS.filter((w) => existsSync(resolve(cfg.mediaDir, `${m.storageKey}-${w}.webp`)));
  for (const w of new Set([...had, ...DERIVATIVE_WIDTHS.filter((w, i) => i === 0 || w <= box.w)]))
    await base.clone().resize({ width: Math.min(w, box.w), withoutEnlargement: true }).webp({ quality: 80 }).toFile(resolve(cfg.mediaDir, `${m.storageKey}-${w}.webp`));

  // keep the focal point on the same spot of the photo when it is inside the new crop, else centre it
  const old = m.crop ?? { x: 0, y: 0, w: full.w, h: full.h };
  const fx = old.x + (m.focalX / 100) * old.w, fy = old.y + (m.focalY / 100) * old.h;
  const inside = fx >= box.x && fx <= box.x + box.w && fy >= box.y && fy <= box.y + box.h;
  const [row] = await db.update(t.media).set({
    crop: whole ? null : box, width: box.w, height: box.h,
    focalX: inside ? Math.round(((fx - box.x) / box.w) * 100) : 50, focalY: inside ? Math.round(((fy - box.y) / box.h) * 100) : 50,
    updatedAt: new Date(),
  }).where(eq(t.media.id, m.id)).returning();
  return row;
}
