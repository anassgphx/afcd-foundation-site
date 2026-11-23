// Homepage editing: edited values for the data-sf fields of src/pages/index.html, with review, revisions and publishing.
// Only edited fields are stored; every other field keeps the text written in the page.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, pageContents, pageContentRevisions, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { readFields, type FieldDef } from './fields.ts';
import { currentLayout, layoutBlocks, validateLayout, type LayoutEntry } from './layout.ts';
import { docMediaIds } from '../pages/render.ts';

export const HOME = 'index.html';
/** Hand-written pages whose marked text is edited in Studio. Only the homepage also has a section layout. */
export const TEXT_PAGES: Record<string, { label: string; noun: string; api: string; href: string; layout: boolean }> = {
  'index.html': { label: 'Homepage', noun: 'homepage', api: '/home', href: '/studio/home', layout: true },
  'contact.html': { label: 'Contact page', noun: 'contact page', api: '/page-text/contact.html', href: '/studio/contact', layout: false },
};
const pageOf = (file: string) => { const p = TEXT_PAGES[file]; if (!p) throw new AppError(404, 'This page is not edited in Studio.'); return p; };
type Status = typeof pageContents.$inferSelect['status'];
const plain = (max: number, min = 0) => z.string().trim().max(max).min(min, 'This field cannot be empty.').refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
const HREF = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:\+?[0-9 ]+|#[a-z0-9-]+|[a-z0-9-]+\.html(#[a-z0-9-]+)?)$/i;

/** Length limits of the numbered section headers (pill number, label, right-hand caption); the admin uses the same. */
export const HEAD_MAX: Record<string, number> = { num: 4, label: 60, meta: 60 };
const headPart = (key: string) => key.match(/\.head\.(num|label|meta)$/)?.[1];

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const PHONE = /^\+?[0-9][0-9 ]{5,19}$/;
/** Participant stories: at least one (the carousel is never left empty), at most STORIES_MAX. */
export const STORIES_MAX = 8;
// a story's photo: a Media Library item, or the page's own photo kept as it is (an existing file under assets/img/)
const storyImage = z.union([
  z.object({ mediaId: z.string().uuid() }).strict(),
  z.object({ src: z.string().regex(/^assets\/img\/[a-z0-9-]+\.(webp|jpe?g|png|avif)$/, 'Choose the photo from the Media Library.'), alt: plain(300, 1), w: z.number().int().positive(), h: z.number().int().positive(), fx: z.number().min(0).max(100), fy: z.number().min(0).max(100) }).strict(),
]);
const storySchema = z.object({ quote: plain(300, 1), name: plain(80, 1), role: plain(120), caption: plain(80), image: storyImage.optional(), sample: z.boolean().optional() }).strict();
/** Every Media Library photo a set of values uses: image fields ({ mediaId }) and story photos. */
export const valueMediaIds = (values: Record<string, unknown>) => Object.values(values).flatMap((v) =>
  v && typeof v === 'object' && 'mediaId' in v ? [(v as { mediaId: string }).mediaId]
  : Array.isArray(v) ? v.flatMap((s) => (s && typeof s === 'object' && s.image && typeof s.image === 'object' && 'mediaId' in s.image ? [String(s.image.mediaId)] : [])) : []);
const schemaFor = (f: FieldDef): z.ZodTypeAny => {
  const isNumber = f.key.endsWith('.value');
  const head = headPart(f.key);
  if (head && f.type === 'text') return plain(HEAD_MAX[head], 1);
  // a phone number or email address shown on the page also becomes its tel: / mailto: link
  if (/\.phone$/.test(f.key)) return plain(24, 1).refine((v) => PHONE.test(v), 'Use a phone number like +212 663 618 536.');
  if (/\.email\d?$/.test(f.key)) return plain(120, 1).refine((v) => EMAIL.test(v), 'Use an email address like contact@afcdteam.com.');
  if (/^faq\.a\d+$/.test(f.key)) return plain(300, 1);
  switch (f.type) {
    case 'split': return z.object({ main: plain(90, 1), soft: plain(90) }).strict();
    case 'link': return z.object({ label: plain(40, 1), href: z.string().trim().max(300).regex(HREF, 'Use a page like about.html, a #section, https://…, mailto: or tel:.') }).strict();
    case 'image': return z.object({ mediaId: z.string().uuid() }).strict();
    case 'stories': return z.array(storySchema).min(1, 'Keep at least one story.').max(STORIES_MAX, `Use at most ${STORIES_MAX} stories.`);
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

export async function contentProblems(db: DB, cfg: Config, values: Record<string, unknown>, layout: unknown = null, file = HOME) {
  const page = pageOf(file);
  const out: string[] = [];
  let blockIds: string[] = [];
  if (Array.isArray(layout) && page.layout) {
    try {
      const v = validateLayout(cfg.siteRoot, file, currentLayout(cfg.siteRoot, file, layout));
      out.push(...v.problems.map((p) => p.message));
      blockIds = docMediaIds({ blocks: layoutBlocks(v.layout) });
    } catch (e) { out.push((e as Error).message); }
  }
  const fields = readFields(cfg.siteRoot, file);
  const gone = Object.keys(values).filter((k) => !fields.some((f) => f.key === k));
  // edited participant stories go live only as real stories: no sample left in the list
  for (const f of fields.filter((x) => x.type === 'stories')) {
    const list = values[f.key]; if (!Array.isArray(list)) continue;
    list.forEach((s: { sample?: boolean; quote?: string; image?: { src?: string } }, i) => {
      if (s?.sample || /lorem|ipsum/i.test(s?.quote ?? '')) out.push(`Story ${i + 1} is still a sample. Replace its text or delete it.`);
      if (s?.image?.src && !existsSync(resolve(cfg.siteRoot, s.image.src))) out.push(`Story ${i + 1}’s photo is no longer on the website. Choose one from the Media Library.`);
    });
  }
  if (gone.length) out.push(`These edited fields are no longer on the ${page.noun}: ${gone.join(', ')}. Reset them.`);
  const ids = [...new Set([...valueMediaIds(values), ...blockIds])];
  if (ids.length) {
    const rows = await db.select().from(media).where(inArray(media.id, ids));
    for (const id of ids) {
      const m = rows.find((r) => r.id === id);
      if (!m) out.push('A chosen photo no longer exists in the media library.');
      else { if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`); if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`); }
    }
  }
  const changedLayout = page.layout && Array.isArray(layout) && JSON.stringify(currentLayout(cfg.siteRoot, file, layout)) !== JSON.stringify(currentLayout(cfg.siteRoot, file, null));
  if (!Object.keys(values).length && !changedLayout) out.push('Nothing is changed yet.');
  return out;
}

/** Saves the working copy: { values, layout, baseUpdatedAt }. A save based on an older copy than the stored one is refused. */
export async function saveContent(db: DB, cfg: Config, actor: NonNullable<Actor>, raw: unknown, file = HOME) {
  const page = pageOf(file);
  const body = (raw && typeof raw === 'object' && 'values' in (raw as object)) ? raw as { values: unknown; layout?: unknown; baseUpdatedAt?: string | null } : { values: raw, layout: undefined, baseUpdatedAt: undefined };
  const values = validateValues(readFields(cfg.siteRoot, file), body.values);
  const cur = await loadContent(db, file);
  let layout: LayoutEntry[] | null = cur?.layout && page.layout ? (cur.layout as LayoutEntry[]) : null;
  let problems: { path: string; message: string }[] = [];
  if (body.layout !== undefined && page.layout) {   // pages without a layout keep their sections as written
    if (body.layout === null) layout = null;
    else { const v = validateLayout(cfg.siteRoot, file, body.layout); layout = v.layout; problems = v.problems; }
  }
  const ids = [...valueMediaIds(values), ...(layout ? docMediaIds({ blocks: layoutBlocks(layout) }) : [])];
  if (ids.length && (await db.select({ id: media.id }).from(media).where(inArray(media.id, [...new Set(ids)]))).length !== new Set(ids).size) throw new AppError(422, 'A chosen photo no longer exists in the media library.');
  if (cur?.status === 'in_review') throw new AppError(409, `The ${page.noun} changes are in review. Withdraw them before editing.`);
  if (cur && body.baseUpdatedAt !== undefined && body.baseUpdatedAt !== null && new Date(body.baseUpdatedAt).getTime() !== cur.updatedAt.getTime()) {
    throw new AppError(409, `Someone else saved the ${page.noun} after you opened it. Reload to see their changes; your edits were not saved.`);
  }
  // a layout equal to the page as written is stored as null (no composition needed)
  if (layout && JSON.stringify(layout) === JSON.stringify(currentLayout(cfg.siteRoot, file, null))) layout = null;
  const [c] = cur
    ? await db.update(pageContents).set({ values, layout, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(pageContents.id, cur.id)).returning()
    : await db.insert(pageContents).values({ file, values, layout, updatedBy: actor.id }).returning();
  await audit(db, actor, 'home.update', { type: 'page_content', id: c.id }, `Edited the ${page.noun} (${Object.keys(values).length} field(s), ${layout ? layout.length + ' sections' : 'original sections'})`);
  return { ...c, problems: problems.map((p) => p.message) };
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'page.update' | 'page.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'page.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'page.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'page.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'page.approve' },
};
export const homeTransitionPerm = (a: string) => RULES[a]?.perm;

export async function transitionContent(db: DB, cfg: Config, actor: NonNullable<Actor>, role: Role, action: string, opts: { comment?: string } = {}, file = HOME) {
  const page = pageOf(file);
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(pageContents).where(eq(pageContents.file, file)).for('update');
    if (!cur) throw new AppError(404, `There are no ${page.noun} changes yet.`);
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} changes that are ${cur.status.replace('_', ' ')}.`);
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve these changes.');
    const patch: Partial<typeof pageContents.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const problems = await contentProblems(t, cfg, cur.values, cur.layout, file);
      if (problems.length) throw new AppError(422, `The ${page.noun} changes are not ready yet.`, problems.map((m) => ({ path: '', message: m })));
      const [{ n }] = await t.select({ n: max(pageContentRevisions.number) }).from(pageContentRevisions).where(eq(pageContentRevisions.contentId, cur.id));
      const [rev] = await t.insert(pageContentRevisions).values({ contentId: cur.id, number: (n ?? 0) + 1, snapshot: { file: cur.file, values: cur.values, layout: cur.layout ?? null }, reason: action === 'submit' ? 'submitted' : 'approved', createdBy: actor.id }).returning();
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'withdraw') patch.approvedRevisionId = null;
    await t.update(pageContents).set(patch).where(eq(pageContents.id, cur.id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'page_content', entityId: cur.id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `home.${action}`, { type: 'page_content', id: cur.id }, `${page.label} changes: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restoreContentRevision(db: DB, cfg: Config, actor: NonNullable<Actor>, revisionId: string, file = HOME) {
  const page = pageOf(file);
  const cur = await loadContent(db, file); if (!cur) throw new AppError(404, 'Revision not found.');
  const [rev] = await db.select().from(pageContentRevisions).where(and(eq(pageContentRevisions.id, revisionId), eq(pageContentRevisions.contentId, cur.id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const fields = readFields(cfg.siteRoot, file);
  const snap = rev.snapshot as { values: Record<string, unknown>; layout?: unknown };
  const values = Object.fromEntries(Object.entries(snap.values).filter(([k]) => fields.some((f) => f.key === k)));
  // restoring never changes the stored revision: it becomes the new working copy (a draft)
  return saveContent(db, cfg, actor, { values, layout: snap.layout && page.layout ? currentLayout(cfg.siteRoot, file, snap.layout) : null }, file);
}

export async function contentHistory(db: DB, id: string) {
  const revisions = await db.select({ id: pageContentRevisions.id, number: pageContentRevisions.number, reason: pageContentRevisions.reason, createdAt: pageContentRevisions.createdAt }).from(pageContentRevisions).where(eq(pageContentRevisions.contentId, id)).orderBy(desc(pageContentRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'page_content'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
