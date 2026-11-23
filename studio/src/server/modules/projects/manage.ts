// Project list management: duplicate a project as a new draft, and permanently delete a project that is not on the
// website. Both are permission-checked routes with audit entries; everything else (publish, archive, …) already has
// its own routes.
import type { Hono } from 'hono';
import { count, eq, like } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { articleProjects, partnerProjects, projects } from '../../db/schema.ts';
import { AppError, perm, type Env } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { createProject, loadProject, projectInputSchema } from './service.ts';

/** The editable fields of a project, read from a loaded project (the same shape the editor saves). */
function inputOf(p: Awaited<ReturnType<typeof loadProject>>): Record<string, unknown> {
  // projectInputSchema is an object with a refine: its keys are the fields the editor sends
  const sch = projectInputSchema as unknown as { shape?: Record<string, unknown>; _def?: { schema?: { shape: Record<string, unknown> } } };
  const shape = sch.shape ?? sch._def?.schema?.shape ?? {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(shape)) if (k in p) out[k] = (p as unknown as Record<string, unknown>)[k];
  const primary = p.pillars.find((x) => x.isPrimary) ?? p.pillars[0];
  return { ...out, pillarKeys: p.pillars.map((x) => x.key), primaryPillarKey: primary?.key ?? '', objectiveRefs: p.objectiveRefs, galleryMediaIds: p.gallery.map((g) => g.id) };
}

/** A new draft copy: "Copy of …", a free address (slug-copy, slug-copy-2…), same content, pillars, photos and sections. */
export async function duplicateProject(db: DB, actor: NonNullable<Actor>, id: string) {
  const p = await loadProject(db, id);
  const base = `${p.slug}-copy`.slice(0, 74);
  const taken = new Set((await db.select({ slug: projects.slug }).from(projects).where(like(projects.slug, `${base}%`))).map((r) => r.slug));
  let slug = base; for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const name = `Copy of ${p.name}`.slice(0, 160);
  const created = await createProject(db, actor, { ...inputOf(p), name, slug });
  await audit(db, actor, 'project.duplicate', { type: 'project', id: created.id }, `Duplicated “${p.name}” as “${name}”`, { from: id });
  return created;
}

/** What still points at a project (stories and partners); deleting is refused while these links exist. */
async function links(db: DB, id: string) {
  const [{ n: stories }] = await db.select({ n: count() }).from(articleProjects).where(eq(articleProjects.projectId, id));
  const [{ n: partners }] = await db.select({ n: count() }).from(partnerProjects).where(eq(partnerProjects.projectId, id));
  return { stories, partners };
}

/** Permanently delete a project that is not on the website (a draft, or archived). Its revisions, pillar links and
 *  gallery links go with it; its photos stay in the Media Library; events linked to it are kept and unlinked. */
export async function deleteProject(db: DB, actor: NonNullable<Actor>, id: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw new AppError(404, 'Project not found.');
  if (p.publishedRevisionId) throw new AppError(409, 'This project is on the website. Remove it from the website first, then delete it.');
  if (!['draft', 'changes_requested', 'archived'].includes(p.status)) throw new AppError(409, 'Only drafts and archived projects can be deleted. Withdraw it from review first.');
  const l = await links(db, id);
  if (l.stories || l.partners) {
    const what = [l.stories && `${l.stories} stor${l.stories === 1 ? 'y' : 'ies'}`, l.partners && `${l.partners} partner${l.partners === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
    throw new AppError(409, `This project is linked from ${what}. Remove those links first, or archive the project instead.`);
  }
  await db.transaction(async (tx) => {
    await tx.delete(projects).where(eq(projects.id, id));
    await audit(tx, actor, 'project.delete', { type: 'project', id }, `Deleted “${p.name}”`, { slug: p.slug, status: p.status });
  });
  return { ok: true };
}

export function projectManageRoutes(api: Hono<Env>, db: DB, actor: (c: never) => NonNullable<Actor>) {
  api.post('/projects/:id/duplicate', perm('project.create'), async (c) => c.json(await duplicateProject(db, actor(c as never), c.req.param('id')), 201));
  api.delete('/projects/:id', perm('project.archive'), async (c) => c.json(await deleteProject(db, actor(c as never), c.req.param('id'))));
}
