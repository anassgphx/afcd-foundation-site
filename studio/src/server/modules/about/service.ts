// About pages: Our Story, Mission & Vision, Strategy & Objectives, Our Team, and the texts of the Partners page.
//
// One record per page (fixed key, created by migration 0026), edited through the same workflow as every other record
// (draft → in review → approved → published). The working copy lives in `about_pages.draft` (plain text and media ids);
// each submit/approve stores a revision; publishing exports the approved revision to src/data/about.json, which
// src/content.py reads (see ABOUT_DEFAULTS there). draft = null: the page is not imported yet and the website keeps the
// text written in src/content.py.
//
// Two pages reuse records that live elsewhere:
//  - Strategy: the strategic objectives SO-01…SO-06 are the rows of `objectives` (linked to projects and pillars). The
//    page edits their title and text; publishing the page writes the published wording back to those rows. Which pillars
//    an objective belongs to stays in `objective_pillars`.
//  - Partners: the organisations are Partner records (Content > Partners). Only the page's own texts are edited here.
import { execFileSync } from 'node:child_process';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { aboutPages, aboutPageRevisions, media, objectivePillars, objectives, pillars, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { altProblem } from '../media/alt.ts';

export const ABOUT_KEYS = ['our-story', 'mission-vision', 'strategy', 'team', 'partners'] as const;
export type AboutKey = (typeof ABOUT_KEYS)[number];
export const ABOUT_META: Record<AboutKey, { title: string; file: string; desc: string }> = {
  'our-story': { title: 'Our Story', file: 'our-story.html', desc: 'Introduction, president’s statement, journey, principles, focus areas, approach and impact numbers.' },
  'mission-vision': { title: 'Mission & Vision', file: 'mission-vision.html', desc: 'Mission, values and vision, shown as one path from today to tomorrow.' },
  strategy: { title: 'Strategy & Objectives', file: 'strategy.html', desc: 'The strategic objectives SO-01 to SO-06, who we serve and where we work.' },
  team: { title: 'Our Team', file: 'team.html', desc: 'The people of AFCD by group: board, executive team, staff, volunteers.' },
  partners: { title: 'Partners page', file: 'partners.html', desc: 'The texts around the partner directory. The organisations themselves are edited in Partners.' },
};
export const TEAM_GROUPS = [
  { value: 'board', label: 'Board' }, { value: 'executive', label: 'Executive team' },
  { value: 'staff', label: 'Staff' }, { value: 'volunteers', label: 'Volunteers & ambassadors' },
] as const;
/** The only email addresses that may appear on the public website. */
export const PUBLIC_EMAILS = ['contact@afcdteam.com', 'akaya@afcdteam.com'];

// ---------------------------------------------------------------- content schemas (plain text; the generator escapes)
const plain = (max: number) => z.string().trim().max(max, `Up to ${max} characters.`).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
const opt = (max: number) => plain(max).default('');
const mediaId = z.string().uuid().nullable().default(null);
const hero = z.object({ title: opt(90), soft: opt(90), lead: opt(280) }).strict();
const closing = z.object({ title: opt(90), text: opt(300) }).strict();
const item = (t: number, x: number) => z.object({ title: opt(t), text: opt(x) }).strict();
/** Per-section settings: shown or hidden, and any heading text that replaces the built-in one (see ABOUT_SECTIONS in
 *  src/content.py). A field left out keeps the built-in text; an empty field shows nothing there. */
export const sectionSchema = z.object({
  show: z.boolean().default(true), tab: plain(40).optional(), label: plain(60).optional(), title: plain(120).optional(), soft: plain(120).optional(),
  meta: plain(60).optional(), desc: plain(400).optional(), sub: plain(60).optional(), sub2: plain(60).optional(),
}).strict();
const SECTION_ID = z.string().regex(/^[a-z][a-z-]{1,29}$/);
const layout = { sections: z.record(SECTION_ID, sectionSchema).default({}), order: z.array(SECTION_ID).max(20).default([]) };

export const SCHEMAS = {
  'our-story': z.object({
    hero, intro: opt(700),
    paragraphs: z.array(plain(600)).max(4).default([]),
    facts: z.array(z.object({ label: opt(30), value: opt(60) }).strict()).max(4).default([]),
    legalName: opt(160),
    foundedYear: z.number().int().min(1900).max(2100).nullable().default(null),
    statement: z.object({ kicker: opt(80), title: opt(140), paragraphs: z.array(plain(1500)).max(5).default([]), name: opt(80), role: opt(100), mediaId }).strict(),
    milestones: z.array(z.object({ when: opt(24), title: opt(90), text: opt(500) }).strict()).max(20).default([]),
    principles: z.array(item(90, 500)).max(10).default([]),
    areas: z.array(z.object({ title: opt(90), text: opt(700), pillar: opt(60) }).strict()).max(8).default([]),
    approach: z.object({ title: opt(60), soft: opt(60), steps: z.array(item(40, 260)).max(6).default([]) }).strict(),
    stats: z.array(z.object({ value: opt(12), label: opt(60) }).strict()).max(6).default([]),
    mediaId,
    closing, ...layout,
  }).strict(),
  'mission-vision': z.object({ hero, mission: opt(600), vision: opt(600), values: z.array(item(40, 320)).max(8).default([]), mediaId, missionMediaId: mediaId, visionMediaId: mediaId, closing, ...layout }).strict(),
  strategy: z.object({
    hero, objectivesIntro: opt(420),
    objectives: z.array(z.object({ ref: z.string().regex(/^SO-\d{2}$/), title: opt(180), text: opt(600) }).strict()).max(20).default([]),
    whoIntro: opt(320),
    summary: z.array(plain(1000)).max(5).default([]),
    regions: z.array(z.object({ name: opt(60), places: opt(260) }).strict()).max(16).default([]),
    coverage: opt(1000),
    closing, ...layout,
  }).strict(),
  team: z.object({
    hero, intro: opt(700),
    people: z.array(z.object({ name: opt(80), role: opt(100), group: z.enum(['board', 'executive', 'staff', 'volunteers']), bio: opt(700), mediaId }).strict()).max(120).default([]),
    closing, ...layout,
  }).strict(),
  partners: z.object({ hero, directoryIntro: opt(260), models: z.array(item(40, 320)).max(6).default([]), steps: z.array(item(80, 320)).max(6).default([]), closing, ...layout }).strict(),
} as const;
export type AboutContent<K extends AboutKey = AboutKey> = z.infer<(typeof SCHEMAS)[K]>;
/** What a revision stores and the website receives (before media ids become image refs). */
export type AboutSnapshot = { key: AboutKey } & Record<string, unknown>;

export const isKey = (k: string): k is AboutKey => (ABOUT_KEYS as readonly string[]).includes(k);

export function parseContent(key: AboutKey, raw: unknown) {
  const r = SCHEMAS[key].safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data as Record<string, unknown>;
}

/** Every media id the content uses (page photo, the president’s portrait, team portraits). */
export function contentMediaIds(key: AboutKey, c: Record<string, unknown>): string[] {
  const out: (string | null | undefined)[] = [];
  if (key === 'our-story') { out.push(c.mediaId as string | null, (c.statement as { mediaId?: string | null } | undefined)?.mediaId); }
  if (key === 'team') for (const p of (c.people as { mediaId: string | null }[]) ?? []) out.push(p.mediaId);
  if (key === 'mission-vision') out.push(c.mediaId as string | null, c.missionMediaId as string | null, c.visionMediaId as string | null);
  return [...new Set(out.filter(Boolean) as string[])];
}

/** All plain strings in the content, for the publishing rules below. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// ---------------------------------------------------------------- loading
type Row = typeof aboutPages.$inferSelect;
export type FullAbout = Row & { key: AboutKey; content: Record<string, unknown> | null };

/** Resolves a page by its key (our-story) or its id. */
export async function findPage(db: DB, ref: string): Promise<Row> {
  const [p] = await db.select().from(aboutPages).where(/^[0-9a-f-]{36}$/.test(ref) ? eq(aboutPages.id, ref) : eq(aboutPages.key, ref));
  if (!p || !isKey(p.key)) throw new AppError(404, 'Page not found.');
  return p;
}

export async function loadAbout(db: DB, ref: string): Promise<FullAbout> {
  const p = await findPage(db, ref);
  return { ...p, key: p.key as AboutKey, content: (p.draft as Record<string, unknown> | null) ?? null };
}

export const toAboutSnapshot = (p: FullAbout): AboutSnapshot => {
  if (!p.content) throw new AppError(409, 'Import the page content first.');
  return { key: p.key, ...p.content };
};

/** What still stops the page from going to review. */
export async function aboutProblems(db: DB, p: FullAbout): Promise<string[]> {
  if (!p.content) return ['Import the current page content first.'];
  const c = p.content as Record<string, any>;
  const out: string[] = [];
  if (!c.hero?.title) out.push('Add the page title.');
  if (p.key === 'our-story') {
    if (!c.intro) out.push('Add the introduction.');
    if ((c.milestones ?? []).some((m: any) => !m.when || !m.title)) out.push('Give every milestone a date and a title, or remove the empty one.');
    if ((c.principles ?? []).some((x: any) => !x.title)) out.push('Give every principle a title, or remove the empty one.');
    if ((c.areas ?? []).some((x: any) => !x.title)) out.push('Give every focus area a title, or remove the empty one.');
    if ((c.stats ?? []).some((x: any) => !x.value || !x.label)) out.push('Give every impact number a value and a label, or remove it.');
    if ((c.facts ?? []).some((x: any) => !x.label || !x.value)) out.push('Give every key fact a label and a value, or remove it.');
    if ((c.statement?.paragraphs ?? []).length && !c.statement?.title) out.push('Add a heading to the president’s statement.');
    const keys = new Set((await db.select({ key: pillars.key }).from(pillars)).map((x) => x.key));
    if ((c.areas ?? []).some((x: any) => x.pillar && !keys.has(x.pillar))) out.push('A focus area links to a pillar that no longer exists.');
  }
  if (p.key === 'mission-vision') {
    if (!c.mission) out.push('Add the mission.');
    if (!c.vision) out.push('Add the vision.');
    if (!(c.values ?? []).length) out.push('Add at least one value.');
    if ((c.values ?? []).some((v: any) => !v.title)) out.push('Give every value a name, or remove the empty one.');
  }
  if (p.key === 'strategy') {
    const refs = (await db.select({ ref: objectives.ref }).from(objectives)).map((o) => o.ref).sort();
    const mine = (c.objectives ?? []).map((o: any) => o.ref).sort();
    if (refs.join() !== mine.join()) out.push('The objectives no longer match the strategic objectives in Studio. Restore them from the published version.');
    if ((c.objectives ?? []).some((o: any) => !o.title)) out.push('Give every objective a title.');
    if ((c.regions ?? []).some((r: any) => !r.name)) out.push('Give every region a name, or remove the empty one.');
  }
  if (p.key === 'team') {
    (c.people ?? []).forEach((x: any, i: number) => {
      if (!x.name || !x.role) out.push(`Person ${i + 1}: add a name and a role.`);
      if (/legal\s+rep|repr[ée]sentant\s+l[ée]gal/i.test(`${x.role} ${x.bio}`)) out.push(`Person ${i + 1}: the legal representative is not shown on the website. Describe the role instead (for example, President).`);
    });
  }
  if (p.key === 'partners' && ((c.models ?? []).some((x: any) => !x.title) || (c.steps ?? []).some((x: any) => !x.title))) out.push('Give every partnership model and step a title, or remove the empty one.');
  // publishing rules that apply to every page: only the two public addresses; no ID numbers
  const text = strings(c).join('\n');
  for (const e of new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])) if (!PUBLIC_EMAILS.includes(e.toLowerCase())) out.push(`The address ${e} is not public. Only ${PUBLIC_EMAILS.join(' and ')} may appear on the website.`);
  if (/\b(?:ICE|IF|RC|CNSS|patente)\b\s*(?:n[°o]\.?|number|:)?\s*\d{4,}/i.test(text)) out.push('Remove registration, tax and CNSS numbers: they are not published on the website.');
  for (const id of contentMediaIds(p.key, c)) {
    const [m] = await db.select().from(media).where(eq(media.id, id));
    if (!m) out.push('A photo no longer exists in the media library.');
    else {
      { const ap = altProblem(m, `Add alt text to the photo “${m.originalName}” in the media library.`); if (ap) out.push(ap); }
      if (!m.rightsConfirmed) out.push(`Confirm AFCD may use the photo “${m.originalName}” (usage rights and consent of the people shown).`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- editing
type Status = Row['status'];
const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updateAbout(db: DB, actor: NonNullable<Actor>, ref: string, raw: unknown) {
  const page = await findPage(db, ref);
  const key = page.key as AboutKey;
  const body = (raw ?? {}) as { content?: unknown; provenance?: unknown };
  const content = parseContent(key, body.content);
  const provenance = z.string().trim().max(300).default('').parse(body.provenance ?? page.provenance);
  if (key === 'strategy') {
    const refs = new Set((await db.select({ ref: objectives.ref }).from(objectives)).map((o) => o.ref));
    const mine = (content.objectives as { ref: string }[]).map((o) => o.ref);
    if (mine.length !== refs.size || new Set(mine).size !== mine.length || mine.some((r) => !refs.has(r))) throw new AppError(422, 'Each strategic objective must appear exactly once.');
  }
  const ids = contentMediaIds(key, content);
  for (const id of ids) if (!(await db.select({ id: media.id }).from(media).where(eq(media.id, id))).length) throw new AppError(422, 'A photo no longer exists in the media library.');
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(aboutPages).where(eq(aboutPages.id, page.id)).for('update');
    if (!cur.draft) throw new AppError(409, 'Import the current page content before editing.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, 'This page is in review. Withdraw it before editing.');
    const [p] = await t.update(aboutPages).set({ draft: content, provenance, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(aboutPages.id, page.id)).returning();
    await audit(tx, actor, 'about.update', { type: 'about_page', id: page.id }, `Edited ${ABOUT_META[key].title}`);
    return { id: p.id, status: p.status };
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'about.update' | 'about.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'about.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'about.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'about.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'about.approve' },
};
export const aboutTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, pageId: string, snap: AboutSnapshot, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(aboutPageRevisions.number) }).from(aboutPageRevisions).where(eq(aboutPageRevisions.pageId, pageId));
  const [rev] = await db.insert(aboutPageRevisions).values({ pageId, number: (n ?? 0) + 1, snapshot: snap, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionAbout(db: DB, actor: NonNullable<Actor>, role: Role, ref: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  const page = await findPage(db, ref);
  const title = ABOUT_META[page.key as AboutKey].title;
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(aboutPages).where(eq(aboutPages.id, page.id)).for('update');
    if (!cur.draft) throw new AppError(409, 'Import the current page content first.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a page that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this page.');
    const patch: Partial<typeof aboutPages.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadAbout(t, page.id);
      const problems = await aboutProblems(t, full);
      if (problems.length) throw new AppError(422, 'This page is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, page.id, toAboutSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') { patch.approvedRevisionId = rev.id; patch.verifiedAt = new Date(); }
    }
    if (action === 'withdraw') patch.approvedRevisionId = null;
    await t.update(aboutPages).set(patch).where(eq(aboutPages.id, page.id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'about_page', entityId: page.id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `about.${action}`, { type: 'about_page', id: page.id }, `${title}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restoreAboutRevision(db: DB, actor: NonNullable<Actor>, ref: string, revisionId: string) {
  const page = await findPage(db, ref);
  const [rev] = await db.select().from(aboutPageRevisions).where(and(eq(aboutPageRevisions.id, revisionId), eq(aboutPageRevisions.pageId, page.id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const { key: _k, ...content } = rev.snapshot as AboutSnapshot;
  await updateAbout(db, actor, page.id, { content, provenance: page.provenance });
}

export async function listAbout(db: DB) {
  const rows = await db.select().from(aboutPages);
  return ABOUT_KEYS.map((k) => rows.find((r) => r.key === k)).filter(Boolean).map((r) => {
    const m = ABOUT_META[r!.key as AboutKey];
    const c = r!.draft as Record<string, any> | null;
    return { id: r!.id, key: r!.key, title: m.title, file: m.file, desc: m.desc, status: r!.status, imported: !!c, publishedRevisionId: r!.publishedRevisionId,
      publishedAt: r!.publishedAt, updatedAt: r!.updatedAt, people: r!.key === 'team' && c ? (c.people ?? []).length : null };
  });
}

export async function aboutHistory(db: DB, id: string) {
  const revisions = await db.select({ id: aboutPageRevisions.id, number: aboutPageRevisions.number, reason: aboutPageRevisions.reason, createdAt: aboutPageRevisions.createdAt })
    .from(aboutPageRevisions).where(eq(aboutPageRevisions.pageId, id)).orderBy(desc(aboutPageRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'about_page'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}

/** Reference data the editor shows next to the fields (read-only here, edited in their own modules). */
export async function aboutContext(db: DB) {
  const pl = await db.select({ key: pillars.key, name: pillars.name, sort: pillars.sort }).from(pillars).orderBy(asc(pillars.sort));
  const objs = await db.select().from(objectives).orderBy(asc(objectives.sort));
  const links = await db.select({ o: objectivePillars.objectiveId, key: pillars.key }).from(objectivePillars).innerJoin(pillars, eq(pillars.id, objectivePillars.pillarId));
  return {
    pillars: pl.map(({ key, name }) => ({ key, name })),
    objectives: objs.map((o) => ({ ref: o.ref, pillarKeys: links.filter((l) => l.o === o.id).map((l) => l.key) })),
    groups: TEAM_GROUPS, publicEmails: PUBLIC_EMAILS,
  };
}

// ---------------------------------------------------------------- built-in section headings (src/content.py ABOUT_SECTIONS)
export type SectionDefaults = Record<string, Record<string, Record<string, string | boolean>>>;
let sectionsCache: { root: string; data: SectionDefaults } | null = null;
/** The built-in sections of each page, in their default order, so the editor can show today's wording. */
export function sectionDefaults(cfg: Config): SectionDefaults {
  if (sectionsCache?.root === cfg.siteRoot) return sectionsCache.data;
  let data: SectionDefaults = {};
  try {
    const py = `import sys, json, os; os.environ['STUDIO_ABOUT_JSON'] = '/nonexistent'; sys.path.insert(0, 'src'); import content as c\nprint(json.dumps(c.ABOUT_SECTIONS))`;
    data = JSON.parse(execFileSync('python3', ['-I', '-c', py], { cwd: cfg.siteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { /* site without the generator (tests): the editor shows no section settings */ }
  sectionsCache = { root: cfg.siteRoot, data };
  return data;
}

// ---------------------------------------------------------------- import of the current pages
/** Reads the built-in About texts of src/content.py (never about.json, so Studio's own export cannot feed back). */
export function readSiteAbout(cfg: Config): Record<AboutKey, Record<string, unknown>> {
  const py = `import sys, json, os; os.environ['STUDIO_ABOUT_JSON'] = '/nonexistent'; sys.path.insert(0, 'src'); import content as c\nprint(json.dumps(c.ABOUT_DEFAULTS))`;
  return JSON.parse(execFileSync('python3', ['-I', '-c', py], { cwd: cfg.siteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** The site's text for one page, shaped for Studio. Strategy takes its objectives from the `objectives` records. */
export async function contentFromSite(db: DB, key: AboutKey, site: Record<string, unknown>) {
  const s = structuredClone(site) as Record<string, any>;
  if (key === 'our-story') { s.mediaId = null; s.statement = { mediaId: null, ...(s.statement ?? {}) }; }
  if (key === 'team') s.people = (s.people ?? []).map((p: any) => ({ mediaId: null, ...p }));
  if (key === 'mission-vision') Object.assign(s, { mediaId: null, missionMediaId: null, visionMediaId: null });
  if (key === 'strategy') {
    const objs = await db.select().from(objectives).orderBy(asc(objectives.sort));
    const lit = new Map(((s.objectives ?? []) as { ref: string; title: string; text: string }[]).map((o) => [o.ref, o]));
    s.objectives = objs.map((o) => ({ ref: o.ref, title: o.title || lit.get(o.ref)?.title || '', text: o.description || lit.get(o.ref)?.text || '' }));
  }
  return parseContent(key, s);
}

/** Imports the current text of each About page as published revision 1. Idempotent: pages with content are skipped.
 *  Nothing is invented: every value is the text the website shows today. */
export async function importAbout(db: DB, cfg: Config, actor: Actor = null, source?: Record<string, Record<string, unknown>>) {
  let site = source;
  if (!site) try { site = readSiteAbout(cfg); } catch { throw new AppError(409, 'Could not read the current About pages from src/content.py.'); }
  let imported = 0, skipped = 0;
  for (const key of ABOUT_KEYS) {
    const [row] = await db.select().from(aboutPages).where(eq(aboutPages.key, key));
    if (!row || row.draft || !site[key]) { skipped++; continue; }
    const content = await contentFromSite(db, key, site[key]);
    await db.transaction(async (tx) => {
      const t = tx as unknown as DB;
      const provenance = 'Imported from the current website (src/content.py)';
      await t.update(aboutPages).set({ draft: content, provenance, status: 'published', updatedAt: new Date() }).where(eq(aboutPages.id, row.id));
      const [rev] = await t.insert(aboutPageRevisions).values({ pageId: row.id, number: 1, snapshot: { key, ...content }, reason: 'imported', createdBy: actor?.id ?? null }).returning();
      await t.update(aboutPages).set({ publishedRevisionId: rev.id, publishedAt: new Date() }).where(eq(aboutPages.id, row.id));
      await audit(tx, actor, 'about.import', { type: 'about_page', id: row.id }, `Imported ${ABOUT_META[key].title} from the current website`);
    });
    imported++;
  }
  return { imported, skipped };
}
