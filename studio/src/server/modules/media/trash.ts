// Media trash: deleting an image (even one in use) moves its files to <mediaDir>/.trash/<id>/ and records every place it
// was taken out of, so it can be restored for 30 days. Where it was used, the records simply have no image any more,
// and the website shows its usual empty state (placeholder) from the next publish.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, isNull, like } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import * as t from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import type { MediaRow } from './service.ts';
import { usage, type Use } from './library.ts';

export const TRASH_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Single-image columns that point at media (the database clears them itself when the image row goes: ON DELETE SET NULL). */
const FKS = [
  { name: 'projects.heroMediaId', table: t.projects, col: t.projects.heroMediaId, key: 'heroMediaId', id: t.projects.id },
  { name: 'projects.logoMediaId', table: t.projects, col: t.projects.logoMediaId, key: 'logoMediaId', id: t.projects.id },
  { name: 'projects.posterMediaId', table: t.projects, col: t.projects.posterMediaId, key: 'posterMediaId', id: t.projects.id },
  { name: 'articles.heroMediaId', table: t.articles, col: t.articles.heroMediaId, key: 'heroMediaId', id: t.articles.id },
  { name: 'events.posterMediaId', table: t.events, col: t.events.posterMediaId, key: 'posterMediaId', id: t.events.id },
  { name: 'opportunities.heroMediaId', table: t.opportunities, col: t.opportunities.heroMediaId, key: 'heroMediaId', id: t.opportunities.id },
  { name: 'publications.coverMediaId', table: t.publications, col: t.publications.coverMediaId, key: 'coverMediaId', id: t.publications.id },
  { name: 'partners.logoMediaId', table: t.partners, col: t.partners.logoMediaId, key: 'logoMediaId', id: t.partners.id },
  { name: 'pillars.mediaId', table: t.pillars, col: t.pillars.mediaId, key: 'mediaId', id: t.pillars.id },
  { name: 'seoOverrides.imageMediaId', table: t.seoOverrides, col: t.seoOverrides.imageMediaId, key: 'imageMediaId', id: t.seoOverrides.id },
] as const;

/** Working copies that hold image ids inside JSON or text. Published versions are left as they were (history); the
 * website build resolves ids to files, so a missing image renders as the empty state. */
/** Where the image was taken out: a field that held it (set back if still empty), a list position (inserted again),
 * or a photo token in story text (put back after the text that preceded it). */
type Spot = { path: (string | number)[]; kind: 'field' | 'item' } | { kind: 'token'; token: string; before: string };
type JsonRef = { name: string; rowId: string; spots: Spot[] };

/** Removes one image id from a JSON value: a field holding it becomes null, a list loses it. */
export function scrub(v: unknown, id: string, spots: Spot[] = [], path: (string | number)[] = []): unknown {
  if (v === id) { spots.push({ path, kind: 'field' }); return null; }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    v.forEach((x, i) => { if (x === id) spots.push({ path: [...path, i], kind: 'item' }); else out.push(scrub(x, id, spots, [...path, out.length])); });
    return out;
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, id, spots, [...path, k])]));
  return v;
}
/** Puts the image back at its spots in the current value; false when the place no longer fits (edited meanwhile). */
function unscrub(cur: unknown, id: string, spots: Spot[]): { v: unknown; ok: boolean } {
  const v = structuredClone(cur); let ok = true;
  for (const sp of spots) {
    if (sp.kind === 'token') continue;
    let o: any = v; for (const k of sp.path.slice(0, -1)) { o = o?.[k]; }
    const last = sp.path[sp.path.length - 1];
    if (sp.kind === 'field') { if (o && typeof o === 'object' && o[last] == null) o[last] = id; else ok = false; }
    else if (Array.isArray(o)) { if (!o.includes(id)) o.splice(Math.min(Number(last), o.length), 0, id); }
    else ok = false;
  }
  return { v, ok };
}
/** Story text: drops photo tokens ![caption](media:<id> "layout") for this image. */
const scrubBody = (s: string, id: string, spots: Spot[] = []) => s.replace(new RegExp(`!\\[[^\\]\\n]{0,300}\\]\\(media:${id}(?:\\s+"(?:full|center|left|right)")?\\)[ \\t]*\\n?`, 'g'),
  (token: string, at: number, all: string) => { spots.push({ kind: 'token', token, before: all.slice(Math.max(0, at - 60), at) }); return ''; });

export type TrashRecord = {
  row: MediaRow; deletedAt: string; deletedBy: string | null; usedOn: Use[];
  fks: { name: string; rowId: string }[];
  galleries: { kind: 'project' | 'article'; ownerId: string; sort: number }[];
  json: JsonRef[];
};

const dirOf = (cfg: Config, id: string) => resolve(cfg.mediaDir, '.trash', id);

/** Moves an image to the trash. In use: refused unless `force`, then taken out of every working copy first. */
export async function trashMedia(db: DB, cfg: Config, id: string, opts: { force?: boolean; by?: string | null } = {}) {
  const [m] = await db.select().from(t.media).where(eq(t.media.id, id));
  if (!m) throw new AppError(404, 'Media not found.');
  const usedOn = (await usage(db, [id]))[id] ?? [];
  if (usedOn.length && !opts.force) throw new AppError(409, `This image is used in ${usedOn.length} place${usedOn.length === 1 ? '' : 's'} (see “Used on”). Remove it there first, or delete it anyway to show a placeholder there.`);

  const rec: TrashRecord = { row: m, deletedAt: new Date().toISOString(), deletedBy: opts.by ?? null, usedOn, fks: [], galleries: [], json: [] };
  await db.transaction(async (tx) => {
    for (const f of FKS) for (const r of await tx.select({ id: f.id }).from(f.table as typeof t.projects).where(eq(f.col, id))) rec.fks.push({ name: f.name, rowId: r.id });
    for (const g of await tx.select().from(t.projectGallery).where(eq(t.projectGallery.mediaId, id))) rec.galleries.push({ kind: 'project', ownerId: g.projectId, sort: g.sort });
    for (const g of await tx.select().from(t.articleGallery).where(eq(t.articleGallery.mediaId, id))) rec.galleries.push({ kind: 'article', ownerId: g.articleId, sort: g.sort });
    await tx.delete(t.projectGallery).where(eq(t.projectGallery.mediaId, id));
    await tx.delete(t.articleGallery).where(eq(t.articleGallery.mediaId, id));

    const has = (v: unknown) => JSON.stringify(v ?? null).includes(id);
    for (const r of await tx.select({ id: t.pages.id, doc: t.pages.doc }).from(t.pages)) if (has(r.doc)) {
      const spots: Spot[] = []; const after = scrub(r.doc, id, spots); rec.json.push({ name: 'pages.doc', rowId: r.id, spots });
      await tx.update(t.pages).set({ doc: after as typeof r.doc }).where(eq(t.pages.id, r.id));
    }
    for (const r of await tx.select({ id: t.pageContents.id, values: t.pageContents.values, layout: t.pageContents.layout }).from(t.pageContents)) {
      if (has(r.values)) { const spots: Spot[] = []; const after = scrub(r.values, id, spots); rec.json.push({ name: 'pageContents.values', rowId: r.id, spots }); await tx.update(t.pageContents).set({ values: after as typeof r.values }).where(eq(t.pageContents.id, r.id)); }
      if (has(r.layout)) { const spots: Spot[] = []; const after = scrub(r.layout, id, spots); rec.json.push({ name: 'pageContents.layout', rowId: r.id, spots }); await tx.update(t.pageContents).set({ layout: after as typeof r.layout }).where(eq(t.pageContents.id, r.id)); }
    }
    for (const r of await tx.select({ id: t.pillars.id, draft: t.pillars.draft }).from(t.pillars)) if (has(r.draft)) {
      const spots: Spot[] = []; const after = scrub(r.draft, id, spots); rec.json.push({ name: 'pillars.draft', rowId: r.id, spots });
      await tx.update(t.pillars).set({ draft: after as typeof r.draft }).where(eq(t.pillars.id, r.id));
    }
    for (const r of await tx.select({ id: t.projects.id, items: t.projects.activityItems }).from(t.projects)) if (has(r.items)) {
      const spots: Spot[] = []; const after = scrub(r.items, id, spots); rec.json.push({ name: 'projects.activityItems', rowId: r.id, spots });
      await tx.update(t.projects).set({ activityItems: after as typeof r.items }).where(eq(t.projects.id, r.id));
    }
    for (const r of await tx.select({ id: t.articles.id, body: t.articles.body }).from(t.articles)) if (r.body.includes(`media:${id}`)) {
      const spots: Spot[] = []; const after = scrubBody(r.body, id, spots); rec.json.push({ name: 'articles.body', rowId: r.id, spots });
      await tx.update(t.articles).set({ body: after }).where(eq(t.articles.id, r.id));
    }
    for (const r of await tx.select({ key: t.seoSettings.key, draft: t.seoSettings.draft }).from(t.seoSettings).where(like(t.seoSettings.key, 'settings:%'))) if (has(r.draft)) {
      const spots: Spot[] = []; const after = scrub(r.draft, id, spots); rec.json.push({ name: 'seoSettings.draft', rowId: r.key, spots });
      await tx.update(t.seoSettings).set({ draft: after as typeof r.draft }).where(eq(t.seoSettings.key, r.key));
    }
    await tx.delete(t.media).where(eq(t.media.id, id));   // single-image columns are cleared by ON DELETE SET NULL
  });

  // files: into the trash folder with the record (after the database change succeeded)
  const dir = dirOf(cfg, id); mkdirSync(dir, { recursive: true });
  if (existsSync(cfg.mediaDir)) for (const f of readdirSync(cfg.mediaDir).filter((f) => f.startsWith(`${m.storageKey}.`) || f.startsWith(`${m.storageKey}-`)))
    renameSync(resolve(cfg.mediaDir, f), resolve(dir, f));
  writeFileSync(resolve(dir, 'record.json'), JSON.stringify(rec, null, 1));
  return rec;
}

/** Trash entries, newest first. Entries older than TRASH_DAYS are removed for good here. */
export function listTrash(cfg: Config) {
  const root = resolve(cfg.mediaDir, '.trash');
  if (!existsSync(root)) return [];
  const out: (Omit<TrashRecord, 'json' | 'row'> & { row: MediaRow; reattach: number; thumb: string | null })[] = [];
  for (const id of readdirSync(root).filter((x) => UUID.test(x))) {
    const dir = resolve(root, id); const file = resolve(dir, 'record.json');
    if (!existsSync(file)) continue;
    let rec: TrashRecord; try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (Date.now() - Date.parse(rec.deletedAt) > TRASH_DAYS * 864e5) { rmSync(dir, { recursive: true, force: true }); continue; }
    const thumb = readdirSync(dir).find((f) => f.endsWith('-480.webp')) ?? null;
    const { json, ...rest } = rec;
    out.push({ ...rest, reattach: rec.fks.length + rec.galleries.length + json.length, thumb: thumb ? `/studio/api/media/trash/${id}/thumb` : null });
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function trashThumb(cfg: Config, id: string) {
  if (!UUID.test(id)) return null;
  const dir = dirOf(cfg, id); if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.endsWith('-480.webp'));
  return f && statSync(resolve(dir, f)).isFile() ? readFileSync(resolve(dir, f)) : null;
}

/** Puts an image back with its files, and back into every place it was taken out of that has not changed since. */
export async function restoreMedia(db: DB, cfg: Config, id: string) {
  if (!UUID.test(id)) throw new AppError(404, 'Not in the trash.');
  const dir = dirOf(cfg, id); const file = resolve(dir, 'record.json');
  if (!existsSync(file)) throw new AppError(404, 'Not in the trash (it may be older than 30 days).');
  const rec: TrashRecord = JSON.parse(readFileSync(file, 'utf8'));
  if ((await db.select({ id: t.media.id }).from(t.media).where(eq(t.media.id, id))).length) throw new AppError(409, 'This image is already in the library.');
  const back: string[] = []; const skipped: string[] = [];
  await db.transaction(async (tx) => {
    const r = rec.row;
    await tx.insert(t.media).values({ ...r, createdAt: new Date(r.createdAt), updatedAt: new Date() });
    for (const ref of rec.fks) {
      const f = FKS.find((x) => x.name === ref.name); if (!f) continue;
      // only where nothing else was chosen meanwhile
      const done = await tx.update(f.table as typeof t.projects).set({ [f.key]: id } as never).where(and(eq(f.id, ref.rowId), isNull(f.col))).returning({ id: f.id });
      (done.length ? back : skipped).push(ref.name.split('.')[0]);
    }
    for (const g of rec.galleries) {
      const owner = g.kind === 'project' ? await tx.select({ id: t.projects.id }).from(t.projects).where(eq(t.projects.id, g.ownerId)) : await tx.select({ id: t.articles.id }).from(t.articles).where(eq(t.articles.id, g.ownerId));
      if (!owner.length) { skipped.push(`${g.kind} gallery`); continue; }
      if (g.kind === 'project') await tx.insert(t.projectGallery).values({ projectId: g.ownerId, mediaId: id, sort: g.sort }).onConflictDoNothing();
      else await tx.insert(t.articleGallery).values({ articleId: g.ownerId, mediaId: id, sort: g.sort }).onConflictDoNothing();
      back.push(`${g.kind} gallery`);
    }
    for (const j of rec.json) {
      // put the old value back only if nobody edited it since the delete; otherwise the editor re-chooses the photo
      const [tbl, col] = j.name.split('.');
      const cur = tbl === 'pages' ? (await tx.select({ v: t.pages.doc }).from(t.pages).where(eq(t.pages.id, j.rowId)))[0]?.v
        : tbl === 'pageContents' ? (await tx.select({ v: col === 'layout' ? t.pageContents.layout : t.pageContents.values }).from(t.pageContents).where(eq(t.pageContents.id, j.rowId)))[0]?.v
        : tbl === 'pillars' ? (await tx.select({ v: t.pillars.draft }).from(t.pillars).where(eq(t.pillars.id, j.rowId)))[0]?.v
        : tbl === 'projects' ? (await tx.select({ v: t.projects.activityItems }).from(t.projects).where(eq(t.projects.id, j.rowId)))[0]?.v
        : tbl === 'articles' ? (await tx.select({ v: t.articles.body }).from(t.articles).where(eq(t.articles.id, j.rowId)))[0]?.v
        : (await tx.select({ v: t.seoSettings.draft }).from(t.seoSettings).where(eq(t.seoSettings.key, j.rowId)))[0]?.v;
      if (cur === undefined) { skipped.push(tbl); continue; }
      let want: unknown;
      if (tbl === 'articles') {
        let body = String(cur); let ok = true;
        for (const sp of j.spots ?? []) if (sp.kind === 'token') {
          if (body.includes(sp.token)) continue;
          const at = sp.before ? body.indexOf(sp.before) : 0;
          if (at < 0) { ok = false; continue; }
          const k = at + sp.before.length; body = body.slice(0, k) + sp.token + body.slice(k);
        }
        if (!ok) { skipped.push(tbl); continue; }
        want = body;
      } else {
        const r = unscrub(cur, id, j.spots ?? []);
        if (!r.ok) { skipped.push(tbl); continue; }   // edited since the delete: the editor chooses the photo again
        want = r.v;
      }
      const b = want as never;
      if (tbl === 'pages') await tx.update(t.pages).set({ doc: b }).where(eq(t.pages.id, j.rowId));
      else if (tbl === 'pageContents') await tx.update(t.pageContents).set(col === 'layout' ? { layout: b } : { values: b }).where(eq(t.pageContents.id, j.rowId));
      else if (tbl === 'pillars') await tx.update(t.pillars).set({ draft: b }).where(eq(t.pillars.id, j.rowId));
      else if (tbl === 'projects') await tx.update(t.projects).set({ activityItems: b }).where(eq(t.projects.id, j.rowId));
      else if (tbl === 'articles') await tx.update(t.articles).set({ body: b }).where(eq(t.articles.id, j.rowId));
      else await tx.update(t.seoSettings).set({ draft: b }).where(eq(t.seoSettings.key, j.rowId));
      back.push(tbl);
    }
  });
  mkdirSync(cfg.mediaDir, { recursive: true });
  for (const f of readdirSync(dir).filter((f) => f !== 'record.json')) renameSync(resolve(dir, f), resolve(cfg.mediaDir, f));
  rmSync(dir, { recursive: true, force: true });
  return { row: rec.row, restored: back.length, notRestored: skipped.length };
}

