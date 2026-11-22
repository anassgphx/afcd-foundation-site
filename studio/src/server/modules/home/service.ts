// Homepage editing: edited values for the data-sf fields of src/pages/index.html, with review, revisions and publishing.
// Only edited fields are stored; every other field keeps the text written in the page.
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, pageContents, pageContentRevisions, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { readFields, type FieldDef } from './fields.ts';

export const HOME = 'index.html';
type Status = typeof pageContents.$inferSelect['status'];
const plain = (max: number, min = 0) => z.string().trim().max(max).min(min, 'This field cannot be empty.').refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
const HREF = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:\+?[0-9 ]+|#[a-z0-9-]+|[a-z0-9-]+\.html(#[a-z0-9-]+)?)$/i;

const schemaFor = (f: FieldDef): z.ZodTypeAny => {
  const isNumber = f.key.endsWith('.value');
  switch (f.type) {
    case 'split': return z.object({ main: plain(90, 1), soft: plain(90) }).strict();
    case 'link': return z.object({ label: plain(40, 1), href: z.string().trim().max(300).regex(HREF, 'Use a page like about.html, a #section, https://…, mailto: or tel:.') }).strict();
    case 'image': return z.object({ mediaId: z.string().uuid() }).strict();
    case 'rich': return plain(700, 1);
    default: return isNumber ? plain(24, 1) : plain(f.key.endsWith('quote') ? 300 : 240, 1);
  }
};

export function validateValues(fields: FieldDef[], raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(422, 'Invalid changes.');
  const out: Record<string, unknown> = {}; const errors: { path: string; message: string }[] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = fields.find((x) => x.key === k);
    if (!f) { errors.push({ path: k, message: 'This field is no longer on the page.' }); continue; }
    if (v === null || v === undefined) continue;   // null = back to the page's own text
    const r = schemaFor(f).safeParse(v);
    if (!r.success) errors.push(...r.error.issues.map((i) => ({ path: [k, ...i.path].join('.'), message: i.message })));
    else out[k] = r.data;
  }
  if (errors.length) throw new AppError(422, 'Some fields need attention.', errors);
  return out;
}

export async function loadContent(db: DB, file = HOME) {
  const [c] = await db.select().from(pageContents).where(eq(pageContents.file, file));
  return c ?? null;
}

export async function contentProblems(db: DB, cfg: Config, values: Record<string, unknown>) {
  const out: string[] = [];
  const fields = readFields(cfg.siteRoot, HOME);
  const gone = Object.keys(values).filter((k) => !fields.some((f) => f.key === k));
  if (gone.length) out.push(`These edited fields are no longer on the homepage: ${gone.join(', ')}. Reset them.`);
  const ids = Object.values(values).flatMap((v) => (v && typeof v === 'object' && 'mediaId' in v ? [(v as { mediaId: string }).mediaId] : []));
  if (ids.length) {
    const rows = await db.select().from(media).where(inArray(media.id, ids));
    for (const id of ids) {
      const m = rows.find((r) => r.id === id);
      if (!m) out.push('A chosen photo no longer exists in the media library.');
      else { if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`); if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`); }
    }
  }
  if (!Object.keys(values).length) out.push('Nothing is changed yet.');
  return out;
}

export async function saveContent(db: DB, cfg: Config, actor: NonNullable<Actor>, raw: unknown) {
  const values = validateValues(readFields(cfg.siteRoot, HOME), raw);
  const ids = Object.values(values).flatMap((v) => (v && typeof v === 'object' && 'mediaId' in v ? [(v as { mediaId: string }).mediaId] : []));
  if (ids.length && (await db.select({ id: media.id }).from(media).where(inArray(media.id, ids))).length !== new Set(ids).size) throw new AppError(422, 'A chosen photo no longer exists in the media library.');
  const cur = await loadContent(db);
  if (cur?.status === 'in_review') throw new AppError(409, 'The homepage changes are in review. Withdraw them before editing.');
  const [c] = cur
    ? await db.update(pageContents).set({ values, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(pageContents.id, cur.id)).returning()
    : await db.insert(pageContents).values({ file: HOME, values, updatedBy: actor.id }).returning();
  await audit(db, actor, 'home.update', { type: 'page_content', id: c.id }, `Edited the homepage (${Object.keys(values).length} field(s) changed)`);
  return c;
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'page.update' | 'page.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'page.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'page.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'page.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'page.approve' },
};
export const homeTransitionPerm = (a: string) => RULES[a]?.perm;

export async function transitionContent(db: DB, cfg: Config, actor: NonNullable<Actor>, role: Role, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(pageContents).where(eq(pageContents.file, HOME)).for('update');
    if (!cur) throw new AppError(404, 'There are no homepage changes yet.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} changes that are ${cur.status.replace('_', ' ')}.`);
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve these changes.');
    const patch: Partial<typeof pageContents.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const problems = await contentProblems(t, cfg, cur.values);
      if (problems.length) throw new AppError(422, 'The homepage changes are not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const [{ n }] = await t.select({ n: max(pageContentRevisions.number) }).from(pageContentRevisions).where(eq(pageContentRevisions.contentId, cur.id));
      const [rev] = await t.insert(pageContentRevisions).values({ contentId: cur.id, number: (n ?? 0) + 1, snapshot: { file: cur.file, values: cur.values }, reason: action === 'submit' ? 'submitted' : 'approved', createdBy: actor.id }).returning();
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'withdraw') patch.approvedRevisionId = null;
    await t.update(pageContents).set(patch).where(eq(pageContents.id, cur.id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'page_content', entityId: cur.id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `home.${action}`, { type: 'page_content', id: cur.id }, `Homepage changes: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restoreContentRevision(db: DB, cfg: Config, actor: NonNullable<Actor>, revisionId: string) {
  const cur = await loadContent(db); if (!cur) throw new AppError(404, 'Revision not found.');
  const [rev] = await db.select().from(pageContentRevisions).where(and(eq(pageContentRevisions.id, revisionId), eq(pageContentRevisions.contentId, cur.id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const fields = readFields(cfg.siteRoot, HOME);
  const values = Object.fromEntries(Object.entries((rev.snapshot as { values: Record<string, unknown> }).values).filter(([k]) => fields.some((f) => f.key === k)));
  return saveContent(db, cfg, actor, values);
}

export async function contentHistory(db: DB, id: string) {
  const revisions = await db.select({ id: pageContentRevisions.id, number: pageContentRevisions.number, reason: pageContentRevisions.reason, createdAt: pageContentRevisions.createdAt }).from(pageContentRevisions).where(eq(pageContentRevisions.contentId, id)).orderBy(desc(pageContentRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'page_content'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
