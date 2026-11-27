// Team routes: members (workflow, publishing, hide/show), groups, order, and publishing the order and groups.
import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as t from '../../db/schema.ts';
import { AppError, perm, requirePerm, type Env } from '../../http.ts';
import * as M from '../media/service.ts';
import * as TM from './service.ts';

const withUrl = (m: M.MediaRow) => ({ ...m, url: `/studio/media-file/${m.storageKey}-480.webp`, large: `/studio/media-file/${M.publicRef(m).src.split('/').pop()}` });

export function registerTeamRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });

  api.get('/team', perm('team.read'), async (c) => c.json(await TM.listTeam(c.var.db)));
  // groups and order (working copy) and publishing them
  api.post('/team/groups', perm('team.update'), async (c) => c.json(await TM.createGroup(c.var.db, actor(c), await c.req.json()), 201));
  api.put('/team/groups/:id', perm('team.update'), async (c) => c.json(await TM.updateGroup(c.var.db, actor(c), c.req.param('id'), await c.req.json())));
  api.delete('/team/groups/:id', perm('team.update'), async (c) => c.json(await TM.deleteGroup(c.var.db, actor(c), c.req.param('id'))));
  api.post('/team/order', perm('team.update'), async (c) => c.json(await TM.reorder(c.var.db, actor(c), await c.req.json())));
  api.post('/team/layout/publish', perm('team.publish'), async (c) => c.json(await c.var.publisher.publishTeamLayout(actor(c))));
  api.post('/team/preview', perm('team.read'), async (c) => { const r = await c.var.publisher.previewTeam(null, null); return c.json({ url: `/studio/preview/${r.token}/${r.file}` }); });

  // members
  api.post('/team/members', perm('team.create'), async (c) => c.json(await TM.createMember(c.var.db, actor(c), await c.req.json()), 201));
  api.get('/team/members/:id', perm('team.read'), async (c) => {
    const { db } = c.var;
    const m = await TM.loadMember(db, c.req.param('id'));
    const rows = m.photoMediaId ? await db.select().from(t.media).where(eq(t.media.id, m.photoMediaId)) : [];
    const others = (await db.select({ id: t.teamMembers.id, name: t.teamMembers.name, nameKey: t.teamMembers.nameKey }).from(t.teamMembers)).filter((x) => x.id !== m.id && x.nameKey === m.nameKey && m.nameKey);
    return c.json({ ...m, media: rows.map(withUrl), problems: await TM.memberProblems(db, m), history: await TM.memberHistory(db, m.id), sameName: others.map(({ id, name }) => ({ id, name })),
      publicEmails: TM.PUBLIC_EMAILS, linkKinds: TM.LINK_KINDS });
  });
  api.put('/team/members/:id', perm('team.update'), async (c) => c.json(await TM.updateMember(c.var.db, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/team/members/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !TM.memberTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, TM.memberTransitionPerm(body.data.action)!);
    return c.json(await TM.transitionMember(c.var.db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/team/members/:id/publish', perm('team.publish'), async (c) => c.json(await c.var.publisher.publishTeamMember(actor(c), c.req.param('id'))));
  api.post('/team/members/:id/unpublish', perm('team.publish'), async (c) => c.json(await c.var.publisher.unpublishTeamMember(actor(c), c.req.param('id'))));
  api.post('/team/members/:id/visibility', perm('team.publish'), async (c) => {
    const b = z.object({ hidden: z.boolean() }).safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Say whether the person is hidden.');
    return c.json(await c.var.publisher.setTeamMemberHidden(actor(c), c.req.param('id'), b.data.hidden));
  });
  api.post('/team/members/:id/preview', perm('team.read'), async (c) => {
    const id = c.req.param('id');
    const r = await c.var.publisher.previewTeam(id, TM.toMemberSnapshot(await TM.loadMember(c.var.db, id)));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/team/members/:id/revisions/:rev/restore', perm('team.update'), async (c) => { await TM.restoreMemberRevision(c.var.db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });
}
