// Approval Queue routes (read-only: approving and publishing go through each module's own endpoints and rules).
import type { Hono } from 'hono';
import { requireUser, type Env } from '../../http.ts';
import * as Q from './queue.ts';

export function registerReviewRoutes(api: Hono<Env>) {
  api.get('/review-queue', async (c) => { const u = requireUser(c); return c.json(await Q.queue(c.var.db, { id: u.id, role: u.role })); });
  api.get('/review-queue/:type/:id/diff', async (c) => { const u = requireUser(c); return c.json(await Q.itemDiff(c.var.db, u.role, c.req.param('type'), c.req.param('id'))); });
}
