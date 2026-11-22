// Pillars: the four strategic pillars of AFCD (Youth, Women, Environment and Climate, Digital), their hub card and their
// own page. The pillar rows are the canonical records that projects, stories, events and objectives link to.
//
// The set of pillars is fixed (four pillars, "Pillar 01 / 04"), and so are each pillar's key, number and page file: the
// public URLs never change. What editors change is the content, through the same workflow as every other record
// (draft → in review → approved → published). The working copy lives in `pillars.draft`; name, description (the summary)
// and colour on the row stay the live values other modules read, and change only when a pillar is published.
import { execFileSync } from 'node:child_process';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, pillars, pillarRevisions, projectPillars, projects, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';

type Status = typeof pillars.$inferSelect['status'];
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
const need = (max: number, msg: string) => plain(max).pipe(z.string().min(1, msg));

/** The four accent colours of the site's design. A pillar uses one of these, never a new colour. */
export const COLOURS = [
  { value: '#FFB2B9', label: 'Pink' }, { value: '#A8DDFB', label: 'Blue' },
  { value: '#82E591', label: 'Green' }, { value: '#FBE38A', label: 'Yellow' },
] as const;
const COLOUR_VALUES = COLOURS.map((c) => c.value) as [string, ...string[]];

export const pillarSchema = z.object({
  name: need(60, 'Add the pillar name.'),
  short: need(20, 'Add a one-word short name.'),
  summary: need(320, 'Add the summary.'),
  intro: need(200, 'Add the page introduction.'),
  colour: z.enum(COLOUR_VALUES, { message: 'Choose one of the four site colours.' }),
  brand: plain(40).default(''),
  highlights: z.array(need(80, 'Remove empty programme names.')).max(8).default([]),
  approachTitle: need(60, 'Add the approach heading.'),
  approachSoft: plain(60).default(''),
  view: need(500, 'Add the perspective text.'),
  principles: z.array(need(40, 'Remove empty principles.')).min(1, 'Add at least one guiding principle.').max(6),
  steps: z.array(z.object({ title: need(40, 'Every step needs a title.'), text: need(200, 'Every step needs a text.') }).strict()).min(1, 'Add at least one step.').max(6),
  activities: z.array(z.number().int().min(0).max(50)).max(8).refine((a) => new Set(a).size === a.length, 'Each activity once.').default([]),
  groups: z.array(z.number().int().min(0).max(50)).max(8).refine((a) => new Set(a).size === a.length, 'Each group once.').default([]),
  mediaId: z.string().uuid().nullable().default(null),
  provenance: plain(300).default(''),
}).strict();
export type PillarInput = z.infer<typeof pillarSchema>;

/** What a revision stores and the website receives: the editable content plus the fixed identity. */
export type PillarSnapshot = Omit<PillarInput, 'provenance'> & { key: string; number: string; publicFile: string };

function parse(raw: unknown): PillarInput {
  const r = pillarSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

// ---------------------------------------------------------------- the site's shared lists (activities, participant groups)
/** Shared lists written in src/content.py. Pillars pick from them by position; the texts themselves stay in one place. */
export type SiteLists = { activities: string[]; groups: string[] };
let listsCache: { root: string; lists: SiteLists } | null = null;
export function siteLists(cfg: Config): SiteLists {
  if (listsCache?.root === cfg.siteRoot) return listsCache.lists;
  let lists: SiteLists = { activities: [], groups: [] };
  try {
    const py = `import sys, json; sys.path.insert(0, 'src'); import content as c\nprint(json.dumps(dict(activities=c.ACTIVITIES, groups=c.BENEFICIARIES)))`;
    lists = JSON.parse(execFileSync('python3', ['-I', '-c', py], { cwd: cfg.siteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { /* site without the generator (tests): no lists to offer */ }
  listsCache = { root: cfg.siteRoot, lists };
  return lists;
}

function checkLists(input: PillarInput, lists: SiteLists) {
  if (lists.activities.length && input.activities.some((i) => i >= lists.activities.length)) throw new AppError(422, 'Unknown activity.');
  if (lists.groups.length && input.groups.some((i) => i >= lists.groups.length)) throw new AppError(422, 'Unknown participant group.');
}

// ---------------------------------------------------------------- loading
type Row = typeof pillars.$inferSelect;
export type FullPillar = Row & { content: PillarInput | null; projects: { slug: string; name: string; live: boolean; primary: boolean }[] };

/** Live and draft projects that link to this pillar. The link belongs to the project record and is edited there. */
async function linkedProjects(db: DB, id: string) {
  const rows = await db.select({ id: projects.id, slug: projects.slug, name: projects.name, pub: projects.publishedRevisionId, status: projects.status, sort: projects.sort, primary: projectPillars.isPrimary })
    .from(projectPillars).innerJoin(projects, eq(projects.id, projectPillars.projectId)).where(eq(projectPillars.pillarId, id));
  return rows.filter((r) => r.status !== 'archived').sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((r) => ({ id: r.id, slug: r.slug, name: r.name, live: !!r.pub, primary: r.primary }));
}

export async function loadPillar(db: DB, id: string): Promise<FullPillar> {
  const [p] = await db.select().from(pillars).where(eq(pillars.id, id));
  if (!p) throw new AppError(404, 'Pillar not found.');
  const content = p.draft ? { ...(p.draft as unknown as PillarInput), mediaId: p.mediaId, provenance: p.provenance } : null;
  return { ...p, content, projects: await linkedProjects(db, id) };
}

export const toPillarSnapshot = (p: FullPillar): PillarSnapshot => {
  if (!p.content) throw new AppError(409, 'Import the pillar content first.');
  const { provenance: _p, ...c } = p.content;
  return { key: p.key, number: p.number, publicFile: p.publicFile, ...c };
};

export async function pillarProblems(db: DB, p: FullPillar) {
  const out: string[] = [];
  if (!p.content) return ['Import the current pillar content first.'];
  if (p.mediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, p.mediaId));
    if (!m) out.push('The photo no longer exists in the media library.');
    else {
      if (!m.alt) out.push(`Add alt text to the photo “${m.originalName}” in the media library.`);
      if (!m.rightsConfirmed) out.push(`Confirm AFCD may use the photo “${m.originalName}” (usage rights and consent of the people shown).`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- editing
const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updatePillar(db: DB, cfg: Config, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(raw);
  checkLists(input, siteLists(cfg));
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(pillars).where(eq(pillars.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Pillar not found.');
    if (!cur.draft) throw new AppError(409, 'Import the current pillar content before editing.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, 'This pillar is in review. Withdraw it before editing.');
    if (input.mediaId && !(await t.select({ id: media.id }).from(media).where(eq(media.id, input.mediaId))).length) throw new AppError(422, 'The photo no longer exists in the media library.');
    const { provenance, mediaId, ...content } = input;
    const [p] = await t.update(pillars).set({ draft: content as unknown as Record<string, unknown>, mediaId, provenance, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(pillars.id, id)).returning();
    await audit(tx, actor, 'pillar.update', { type: 'pillar', id }, `Edited pillar “${input.name}”`);
    return { id: p.id, status: p.status };
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'pillar.update' | 'pillar.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'pillar.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'pillar.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'pillar.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'pillar.approve' },
};
export const pillarTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, pillarId: string, snap: PillarSnapshot, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(pillarRevisions.number) }).from(pillarRevisions).where(eq(pillarRevisions.pillarId, pillarId));
  const [rev] = await db.insert(pillarRevisions).values({ pillarId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionPillar(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(pillars).where(eq(pillars.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Pillar not found.');
    if (!cur.draft) throw new AppError(409, 'Import the current pillar content first.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a pillar that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this pillar.');
    const patch: Partial<typeof pillars.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadPillar(t, id);
      const problems = await pillarProblems(t, full);
      if (problems.length) throw new AppError(422, 'This pillar is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toPillarSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') { patch.approvedRevisionId = rev.id; patch.verifiedAt = new Date(); }
    }
    if (action === 'withdraw') patch.approvedRevisionId = null;
    await t.update(pillars).set(patch).where(eq(pillars.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'pillar', entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `pillar.${action}`, { type: 'pillar', id }, `${cur.name}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restorePillarRevision(db: DB, cfg: Config, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(pillarRevisions).where(and(eq(pillarRevisions.id, revisionId), eq(pillarRevisions.pillarId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const { key: _k, number: _n, publicFile: _f, ...s } = rev.snapshot as unknown as PillarSnapshot;
  const cur = await loadPillar(db, id);
  await updatePillar(db, cfg, actor, id, { ...s, provenance: cur.provenance });
}

export async function listPillars(db: DB) {
  const rows = await db.select({ id: pillars.id, key: pillars.key, number: pillars.number, name: pillars.name, colour: pillars.colour, publicFile: pillars.publicFile, status: pillars.status,
    imported: pillars.draft, mediaId: pillars.mediaId, publishedRevisionId: pillars.publishedRevisionId, updatedAt: pillars.updatedAt }).from(pillars).orderBy(asc(pillars.sort), asc(pillars.number));
  const links = await db.select({ pillarId: projectPillars.pillarId, pub: projects.publishedRevisionId }).from(projectPillars).innerJoin(projects, eq(projects.id, projectPillars.projectId));
  return rows.map(({ imported, ...r }) => {
    const d = imported as { name?: string; short?: string; summary?: string; colour?: string } | null;
    return { ...r, imported: !!d, draftName: d?.name ?? r.name, short: d?.short ?? '', summary: d?.summary ?? '', draftColour: d?.colour ?? r.colour,
      projects: links.filter((l) => l.pillarId === r.id && l.pub).length };
  });
}

export async function pillarHistory(db: DB, id: string) {
  const revisions = await db.select({ id: pillarRevisions.id, number: pillarRevisions.number, reason: pillarRevisions.reason, createdAt: pillarRevisions.createdAt }).from(pillarRevisions).where(eq(pillarRevisions.pillarId, id)).orderBy(desc(pillarRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'pillar'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}

// ---------------------------------------------------------------- import of the current pages
type SitePillar = { key: string; name: string; summary: string; highlights: string[]; intro: string; short: string; colour: string; brand: string;
  activities: number[]; groups: number[]; approach: { title: string; view: string; principles: string[]; steps: [string, string][] } };

/** Reads the literal pillar content of src/content.py (never a pillars.json, so Studio's own export cannot feed back). */
export function readSitePillars(cfg: Config): SitePillar[] {
  const py = `
import sys, json, os; os.environ['STUDIO_PILLARS_JSON'] = '/nonexistent'; sys.path.insert(0, 'src'); import content as c
print(json.dumps([dict(key=k, name=t, summary=d, highlights=r, intro=c.PILLAR_INTRO[k], short=c.PILLAR_SHORT[k], colour=c.PILLAR_TONE[k],
  brand=c.PILLAR_BRAND.get(k, ''), activities=c.PILLAR_ACTS[k], groups=c.PILLAR_GROUPS[k], approach=c.PILLAR_APPROACH[k]) for k, n, t, d, r in c.PILLARS]))`;
  return JSON.parse(execFileSync('python3', ['-I', '-c', py], { cwd: cfg.siteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** "From learning <span class="text-white/45">to leading.</span>" → ["From learning", "to leading."] */
export function splitTitle(html: string): [string, string] {
  const m = html.match(/^(.*?) <span class="text-white\/45">(.*)<\/span>$/);
  if (!m) { if (/[<>]/.test(html)) throw new Error(`Unexpected markup in approach title: ${html}`); return [unescape(html), '']; }
  return [unescape(m[1]), unescape(m[2])];
}

export function contentFromSite(s: SitePillar): PillarInput {
  const [approachTitle, approachSoft] = splitTitle(s.approach.title);
  return parse({
    name: unescape(s.name), short: unescape(s.short), summary: unescape(s.summary), intro: unescape(s.intro), colour: s.colour, brand: unescape(s.brand),
    highlights: s.highlights.map(unescape), approachTitle, approachSoft, view: unescape(s.approach.view), principles: s.approach.principles.map(unescape),
    steps: s.approach.steps.map(([title, text]) => ({ title: unescape(title), text: unescape(text) })), activities: s.activities, groups: s.groups,
    mediaId: null, provenance: 'Imported from the current pillar pages (src/content.py)',
  });
}

/** Imports the content of the current pillar pages as published revision 1 of each pillar. Idempotent: pillars that
 *  already have content are skipped. Nothing is invented: every value is the text the website shows today. */
export async function importPillars(db: DB, cfg: Config, actor: Actor = null, source?: SitePillar[]) {
  let site = source;
  if (!site) try { site = readSitePillars(cfg); } catch { throw new AppError(409, 'Could not read the current pillar content from src/content.py.'); }
  let imported = 0, skipped = 0;
  for (const s of site) {
    const [row] = await db.select().from(pillars).where(eq(pillars.key, s.key));
    if (!row || row.draft) { skipped++; continue; }
    const input = contentFromSite(s);
    await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const { provenance, mediaId: _m, ...content } = input;
      await t.update(pillars).set({ draft: content as unknown as Record<string, unknown>, provenance, status: 'published', updatedAt: new Date() }).where(eq(pillars.id, row.id));
      const snap = toPillarSnapshot(await loadPillar(t, row.id));
      const [rev] = await t.insert(pillarRevisions).values({ pillarId: row.id, number: 1, snapshot: snap as unknown as Record<string, unknown>, reason: 'imported', createdBy: actor?.id ?? null }).returning();
      await t.update(pillars).set({ publishedRevisionId: rev.id, publishedAt: new Date() }).where(eq(pillars.id, row.id));
      await audit(tx, actor, 'pillar.import', { type: 'pillar', id: row.id }, `Imported the content of pillar “${input.name}” from the current website`);
    });
    imported++;
  }
  return { imported, skipped };
}
