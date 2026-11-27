// AFCD Apply pages in the website build. The Publisher calls writeApplyPages() on every site write, so apply pages are
// always written from the database like every other Studio page, and refreshApplyPages() (publish/service.ts) rebuilds
// the site when a page is missing, out of date or should be gone (status change, deadline, extension, new form version).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { applyCalls } from '../../db/schema.ts';
import { applyFile, livePages, pageMarker, pageSource } from './render.ts';

const FILE = /^apply-[a-z0-9-]+\.html$/;

/** Writes one page per released call into `pagesDir`; removes apply pages that should no longer exist from `pagesDir`
 *  and from `outDirs` (site root, fr/, ar/: build.mjs never deletes pages). Returns the media the pages use. */
export async function writeApplyPages(db: DB, cfg: Config, pagesDir: string, outDirs: string[], now = new Date()) {
  const live = await livePages(db);
  const keep = new Set(live.map((p) => applyFile(p.call.slug)));
  for (const dir of [pagesDir, ...outDirs]) if (existsSync(dir)) for (const f of readdirSync(dir)) if (FILE.test(f) && !keep.has(f)) rmSync(resolve(dir, f));
  if (!live.length) return [] as string[];
  mkdirSync(pagesDir, { recursive: true });
  for (const p of live) {
    const file = resolve(pagesDir, applyFile(p.call.slug));
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, await pageSource(db, cfg, p, now)); renameSync(tmp, file);
  }
  return live.map((p) => p.call.heroMediaId).filter(Boolean) as string[];
}

const markerOf = (html: string) => /data-studio-apply-rev="([^"]+)"/.exec(html)?.[1] ?? null;

/** Is the built site out of date for any call? (a page missing or stale, or a page that should be gone) */
export async function applyPagesStale(db: DB, cfg: Config, now = new Date()) {
  const live = await livePages(db);
  const keep = new Set(live.map((p) => applyFile(p.call.slug)));
  if (existsSync(cfg.siteRoot) && readdirSync(cfg.siteRoot).some((f) => FILE.test(f) && !keep.has(f))) return true;
  return live.some((p) => {
    const f = resolve(cfg.siteRoot, applyFile(p.call.slug));
    return !existsSync(f) || markerOf(readFileSync(f, 'utf8')) !== pageMarker(p, now);
  });
}

/** For the call editor: is the public page there and current? (read from the built file, never assumed) */
export async function pageStatus(db: DB, cfg: Config, callId: string, now = new Date()) {
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, callId));
  if (!c) return null;
  const p = (await livePages(db)).find((x) => x.call.id === callId);
  const file = applyFile(c.slug);
  const path = resolve(cfg.siteRoot, file);
  const built = existsSync(path) ? markerOf(readFileSync(path, 'utf8')) : null;
  if (!p) return { file, expected: false, onSite: !!built, current: !built };
  return { file, expected: true, onSite: !!built, current: built === pageMarker(p, now), hasForm: !!p.version };
}
