// SEO studio: audit of the built site, and reviewed SEO overrides (title, description, noindex, share image) for the
// site's template pages. Pages that Studio already manages keep their SEO in their own editor.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, desc, eq, isNotNull, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { articles, events, media, opportunities, pages, projects, reviewComments, seoAudits, seoOverrides, seoRevisions } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { auditSite } from './audit.ts';

type Status = typeof seoOverrides.$inferSelect['status'];
const FILE = /^[a-z0-9][a-z0-9-]*\.html$/;
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');

export type Owner = { kind: 'template' | 'project' | 'story' | 'event' | 'sample' | 'opportunity' | 'page'; id?: string; label: string };

/** Who edits a page: a Studio editor, or (for the site's template pages) an SEO override here. */
export async function owners(db: DB, cfg: Config): Promise<Map<string, Owner>> {
  const map = new Map<string, Owner>();
  for (const p of await db.select({ id: projects.id, slug: projects.slug, name: projects.name }).from(projects)) map.set(`project-${p.slug}.html`, { kind: 'project', id: p.id, label: p.name });
  for (const a of await db.select({ id: articles.id, slug: articles.slug, title: articles.title }).from(articles)) map.set(`news-${a.slug}.html`, { kind: 'story', id: a.id, label: a.title });
  for (const e of await db.select({ id: events.id, slug: events.slug, title: events.title }).from(events).where(isNotNull(events.publishedRevisionId))) map.set(`event-${e.slug}.html`, { kind: 'event', id: e.id, label: e.title });
  for (const o of await db.select({ id: opportunities.id, slug: opportunities.slug, title: opportunities.title }).from(opportunities)) map.set(`opportunity-${o.slug}.html`, { kind: 'opportunity', id: o.id, label: o.title });
  if (await db.select({ id: opportunities.id }).from(opportunities).where(isNotNull(opportunities.publishedRevisionId)).limit(1).then((r) => r.length)) map.set('opportunities.html', { kind: 'opportunity', label: 'Opportunities listing' });
  for (const p of await db.select({ id: pages.id, slug: pages.slug, title: pages.title }).from(pages)) map.set(`${p.slug}.html`, { kind: 'page', id: p.id, label: p.title });
  // the site's own sample events (no Studio event behind them)
  for (const f of existsSync(cfg.siteRoot) ? readdirSync(cfg.siteRoot) : []) if (/^event-[a-z0-9-]+\.html$/.test(f) && !map.has(f)) map.set(f, { kind: 'sample', label: 'Sample event' });
  return map;
}

/** Template pages: built pages that no Studio record owns. Only these take SEO overrides. */
export async function templateFiles(db: DB, cfg: Config) {
  const own = await owners(db, cfg);
  return readdirSync(resolve(cfg.siteRoot, 'src/pages')).filter((f) => FILE.test(f) && !own.has(f)).sort();
}

export async function runAudit(db: DB, cfg: Config, actor: Actor) {
  const result = auditSite(cfg.siteRoot);
  const own = await owners(db, cfg);
  const pagesOut = result.pages.map((p) => ({ ...p, owner: own.get(p.file) ?? { kind: 'template', label: 'Template page' } }));
  const [row] = await db.insert(seoAudits).values({ result: { ...result, pages: pagesOut } as unknown as Record<string, unknown>, createdBy: actor?.id ?? null }).returning();
  // keep the last 20 audits
  const old = await db.select({ id: seoAudits.id }).from(seoAudits).orderBy(desc(seoAudits.createdAt)).offset(20);
  for (const o of old) await db.delete(seoAudits).where(eq(seoAudits.id, o.id));
  return { id: row.id, ...result, pages: pagesOut };
}
export async function lastAudit(db: DB) {
  const [r] = await db.select().from(seoAudits).orderBy(desc(seoAudits.createdAt)).limit(1);
  return r ? { id: r.id, ...(r.result as object) } : null;
}
export async function auditHistory(db: DB) {
  const rows = await db.select().from(seoAudits).orderBy(desc(seoAudits.createdAt)).limit(20);
  return rows.map((r) => { const x = r.result as { score: number; counts: { errors: number; warnings: number } }; return { at: r.createdAt, score: x.score, ...x.counts }; });
}

// ---------------------------------------------------------------- Overrides
export const overrideSchema = z.object({
  title: plain(70).default(''),
  description: plain(170).default(''),
  noindex: z.boolean().default(false),
  imageMediaId: z.string().uuid().nullable().default(null),
}).strict();
export type OverrideSnapshot = z.infer<typeof overrideSchema> & { file: string };

/** What the page currently has from its own source (front matter), to show next to the override. */
export function pageDefaults(cfg: Config, file: string) {
  const p = resolve(cfg.siteRoot, 'src/pages', file);
  if (!FILE.test(file) || !existsSync(p)) return null;
  const fm = readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const get = (k: string) => fm.split('\n').find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1).trim() ?? '';
  const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { title: dec(get('title')), description: dec(get('description')), noindex: get('noindex') === 'true' };
}

export async function listOverrides(db: DB, cfg: Config) {
  const files = await templateFiles(db, cfg);
  const rows = await db.select().from(seoOverrides);
  return files.map((file) => ({ file, defaults: pageDefaults(cfg, file), override: rows.find((r) => r.file === file) ?? null }))
    .concat(rows.filter((r) => !files.includes(r.file)).map((r) => ({ file: r.file, defaults: pageDefaults(cfg, r.file), override: r, orphan: true } as never)));
}

async function assertTemplate(db: DB, cfg: Config, file: string) {
  if (!FILE.test(file)) throw new AppError(422, 'Unknown page.');
  if (!(await templateFiles(db, cfg)).includes(file)) {
    const o = (await owners(db, cfg)).get(file);
    throw new AppError(409, o ? `This page is managed in Studio (${o.kind}: ${o.label}). Edit its SEO fields there.` : 'Unknown page.');
  }
}

export async function loadOverride(db: DB, id: string) {
  const [o] = await db.select().from(seoOverrides).where(eq(seoOverrides.id, id));
  if (!o) throw new AppError(404, 'SEO settings not found.');
  return o;
}
const snap = (o: typeof seoOverrides.$inferSelect): OverrideSnapshot => ({ file: o.file, title: o.title, description: o.description, noindex: o.noindex, imageMediaId: o.imageMediaId });

export async function overrideProblems(db: DB, o: typeof seoOverrides.$inferSelect) {
  const out: string[] = [];
  if (!o.title && !o.description && !o.noindex && !o.imageMediaId) out.push('Change at least one field.');
  if (o.imageMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, o.imageMediaId));
    if (!m) out.push('The image no longer exists in the media library.');
    else { if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`); if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`); }
  }
  return out;
}

/** Saves the working copy for a page (creates it on first save). */
export async function saveOverride(db: DB, cfg: Config, actor: NonNullable<Actor>, file: string, raw: unknown) {
  await assertTemplate(db, cfg, file);
  const r = overrideSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  if (r.data.imageMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, r.data.imageMediaId))).length) throw new AppError(422, 'The image no longer exists in the media library.');
  const [cur] = await db.select().from(seoOverrides).where(eq(seoOverrides.file, file));
  if (cur && cur.status === 'in_review') throw new AppError(409, 'These settings are in review. Withdraw them before editing.');
  const [o] = cur
    ? await db.update(seoOverrides).set({ ...r.data, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(seoOverrides.id, cur.id)).returning()
    : await db.insert(seoOverrides).values({ file, ...r.data, updatedBy: actor.id }).returning();
  await audit(db, actor, 'seo.update', { type: 'seo', id: o.id }, `Edited SEO for ${file}`);
  return o;
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'seo.update' | 'seo.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'seo.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'seo.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'seo.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'seo.approve' },
};
export const seoTransitionPerm = (a: string) => RULES[a]?.perm;

export async function transitionOverride(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(seoOverrides).where(eq(seoOverrides.id, id)).for('update');
    if (!cur) throw new AppError(404, 'SEO settings not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} settings that are ${cur.status.replace('_', ' ')}.`);
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve these settings.');
    const patch: Partial<typeof seoOverrides.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const problems = await overrideProblems(t, cur);
      if (problems.length) throw new AppError(422, 'These settings are not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const [{ n }] = await t.select({ n: max(seoRevisions.number) }).from(seoRevisions).where(eq(seoRevisions.overrideId, id));
      const [rev] = await t.insert(seoRevisions).values({ overrideId: id, number: (n ?? 0) + 1, snapshot: snap(cur) as unknown as Record<string, unknown>, reason: action === 'submit' ? 'submitted' : 'approved', createdBy: actor.id }).returning();
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'withdraw') patch.approvedRevisionId = null;
    await t.update(seoOverrides).set(patch).where(eq(seoOverrides.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'seo', entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `seo.${action}`, { type: 'seo', id }, `${cur.file}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

/** Discards settings that are not on the live site (the page keeps its own). */
export async function discardOverride(db: DB, actor: NonNullable<Actor>, id: string) {
  const o = await loadOverride(db, id);
  if (o.publishedRevisionId) throw new AppError(409, 'These settings are live. Go back to the page’s own settings first.');
  await db.delete(seoOverrides).where(eq(seoOverrides.id, id));
  await db.delete(reviewComments).where(and(eq(reviewComments.entityType, 'seo'), eq(reviewComments.entityId, id)));
  await audit(db, actor, 'seo.discard', { type: 'seo', id }, `Discarded SEO draft for ${o.file}`);
}

export async function overrideHistory(db: DB, id: string) {
  const revisions = await db.select({ id: seoRevisions.id, number: seoRevisions.number, reason: seoRevisions.reason, createdAt: seoRevisions.createdAt }).from(seoRevisions).where(eq(seoRevisions.overrideId, id)).orderBy(desc(seoRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'seo'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}

