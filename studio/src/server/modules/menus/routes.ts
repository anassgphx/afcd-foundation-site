// Menu routes: edited (page.update), reviewed by someone else (page.approve), published (page.publish).
import type { Hono } from 'hono';
import { z } from 'zod';
import { AppError, perm, requirePerm, type Env } from '../../http.ts';
import * as M from './service.ts';

export function registerMenuRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  api.get('/menus', perm('page.read'), async (c) => c.json(await M.view(c.var.db, c.var.cfg, actor(c))));
  api.put('/menus', perm('page.update'), async (c) => { await M.save(c.var.db, c.var.cfg, actor(c), await c.req.json()); return c.json(await M.view(c.var.db, c.var.cfg, actor(c))); });
  api.post('/menus/discard', perm('page.update'), async (c) => { await M.discard(c.var.db, c.var.cfg, actor(c)); return c.json(await M.view(c.var.db, c.var.cfg, actor(c))); });
  api.post('/menus/transition', async (c) => {
    const body = z.object({ action: z.enum(['submit', 'withdraw', 'request_changes', 'approve']), comment: z.string().max(2000).optional() }).safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, M.MENU_ACTIONS[body.data.action]);
    await M.transition(c.var.db, actor(c), u.role, body.data.action, body.data.comment ?? '');
    return c.json(await M.view(c.var.db, c.var.cfg, actor(c)));
  });
  api.post('/menus/publish', perm('page.publish'), async (c) => c.json(await c.var.publisher.publishMenus(actor(c))));
}
