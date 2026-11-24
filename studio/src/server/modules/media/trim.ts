// Logos often arrive with wide empty margins (transparent or white) around the mark, so on the website a square logo
// looks tiny next to a wide one. "Trim" finds the mark and crops to it, with a little breathing room, through the normal
// non-destructive crop: the original stays as uploaded, and Reset in the crop tool brings the margins back.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import * as t from '../../db/schema.ts';
import { originalFile } from './library.ts';
import { cropMedia, type Crop } from './crop.ts';
import type { MediaRow } from './service.ts';

/** The box around the logo inside the original (upright pixels), or null when there is nothing worth trimming. */
export async function trimBox(cfg: Config, m: MediaRow): Promise<Crop | null> {
  const o = originalFile(cfg, m); if (!o) return null;
  const buf = readFileSync(o.path);
  const upright = await sharp(buf, { limitInputPixels: 80_000_000 }).rotate().toBuffer({ resolveWithObject: true });
  const full = { w: upright.info.width, h: upright.info.height };
  // trim() removes the border colour found at the top-left pixel (transparent or white for logos)
  const { info } = await sharp(upright.data, { limitInputPixels: 80_000_000 }).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true });
  const left = -(info.trimOffsetLeft ?? 0), top = -(info.trimOffsetTop ?? 0);
  if (info.width < 16 || info.height < 16) return null;   // nearly blank: leave it alone
  if (full.w - info.width < full.w * 0.04 && full.h - info.height < full.h * 0.04) return null;   // margins already small
  const pad = Math.round(Math.max(info.width, info.height) * 0.03);
  const x = Math.max(0, left - pad), y = Math.max(0, top - pad);
  return { x, y, w: Math.min(full.w - x, info.width + 2 * pad), h: Math.min(full.h - y, info.height + 2 * pad) };
}

/** Trims an image that has no crop yet. Returns the updated row, or null when nothing changed. */
export async function trimIfUncropped(db: DB, cfg: Config, id: string | null | undefined) {
  if (!id) return null;
  const [m] = await db.select().from(t.media).where(eq(t.media.id, id));
  if (!m || m.crop) return null;   // a crop someone chose is kept
  const box = await trimBox(cfg, m).catch(() => null);
  return box ? cropMedia(db, cfg, m, box) : null;
}
