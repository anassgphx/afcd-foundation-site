// On-page checklist routes. Everyone with seo.read sees the checklists; SEO editors (seo.update) set a page's focus
// keyphrase and tick the manual reviews. Nothing here changes the website.
import type { Hono } from 'hono';
import { perm, type Env } from '../../http.ts';
import * as OP from './onpage.ts';

export function registerOnPageRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  api.get('/seo/onpage', perm('seo.read'), async (c) => c.json(await OP.listOnPage(c.var.db, c.var.cfg)));
  api.get('/seo/onpage/:file', perm('seo.read'), async (c) => c.json(await OP.pageView(c.var.db, c.var.cfg, c.req.param('file'))));
  api.put('/seo/onpage/:file', perm('seo.update'), async (c) => c.json(await OP.setFocus(c.var.db, c.var.cfg, actor(c), c.req.param('file'), await c.req.json())));
  api.post('/seo/onpage/:file/review', perm('seo.update'), async (c) => c.json(await OP.setManual(c.var.db, c.var.cfg, actor(c), c.req.param('file'), await c.req.json())));
}
