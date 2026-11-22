// Inbox routes (personal data). Reading needs forms.read; anything that changes a message, exports CSV or changes
// settings needs forms.manage. Starring is personal, so forms.read is enough.
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { AppError, clientIp, perm, type Env } from '../../http.ts';
import { isFormKey, saveSettings } from '../forms/service.ts';
import * as I from './service.ts';

export function registerInboxRoutes(api: Hono<Env>) {
  const me = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  const csv = (c: Context<Env>, name: string, body: string) => {
    c.header('Content-Type', 'text/csv; charset=utf-8'); c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', `attachment; filename="afcd-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(body);
  };
  const ids = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

  api.get('/inbox/summary', perm('forms.read'), async (c) => c.json(await I.summary(c.var.db, me(c))));
  api.get('/inbox/unread', perm('forms.read'), async (c) => c.json({ unread: await I.unreadCount(c.var.db) }));
  api.get('/inbox/people', perm('forms.read'), async (c) => c.json(await I.people(c.var.db)));
  api.get('/inbox/messages', perm('forms.read'), async (c) => c.json(await I.listMessages(c.var.db, me(c), I.listQuery.parse(c.req.query()))));
  api.get('/inbox/messages/:id', perm('forms.read'), async (c) => c.json(await I.openMessage(c.var.db, me(c), c.req.param('id'), clientIp(c))));
  api.patch('/inbox/messages/:id', perm('forms.manage'), async (c) => { await I.change(c.var.db, me(c), c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  api.post('/inbox/messages/:id/star', perm('forms.read'), async (c) => {
    const b = z.object({ starred: z.boolean() }).safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Invalid change.');
    await I.setStar(c.var.db, me(c), c.req.param('id'), b.data.starred); return c.json({ ok: true });
  });
  api.post('/inbox/messages/:id/notes', perm('forms.manage'), async (c) => { await I.addNote(c.var.db, me(c), c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  api.delete('/inbox/messages/:id/notes/:note', perm('forms.manage'), async (c) => { await I.deleteNote(c.var.db, me(c), c.req.param('id'), c.req.param('note')); return c.json({ ok: true }); });
  api.post('/inbox/messages/:id/reply', perm('forms.manage'), async (c) => { await I.replyOpened(c.var.db, me(c), c.req.param('id')); return c.json({ ok: true }); });
  api.post('/inbox/flag', perm('forms.manage'), async (c) => {
    const b = ids.extend({ flag: z.enum(I.FLAGS) }).safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Invalid selection.');
    return c.json({ changed: await I.flag(c.var.db, me(c), b.data.ids, b.data.flag) });
  });
  api.post('/inbox/delete', perm('forms.manage'), async (c) => {
    const b = ids.safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Invalid selection.');
    return c.json({ deleted: await I.remove(c.var.db, me(c), b.data.ids) });
  });
  api.get('/inbox/export.csv', perm('forms.manage'), async (c) => csv(c, 'messages', await I.exportMessages(c.var.db, me(c), I.listQuery.parse(c.req.query()), clientIp(c))));

  api.get('/inbox/subscribers', perm('forms.read'), async (c) => c.json(await I.subscribers(c.var.db, me(c), c.req.query(), clientIp(c))));
  api.post('/inbox/subscribers/:id/:action', perm('forms.manage'), async (c) => {
    const a = c.req.param('action'); if (a !== 'unsubscribe' && a !== 'delete') throw new AppError(404, 'Unknown action.');
    await I.setSubscriber(c.var.db, me(c), c.req.param('id'), a); return c.json({ ok: true });
  });
  api.get('/inbox/subscribers/export.csv', perm('forms.manage'), async (c) => csv(c, 'newsletter', await I.exportSubscribers(c.var.db, me(c), clientIp(c))));

  api.put('/inbox/settings/:key', perm('forms.manage'), async (c) => {
    const key = c.req.param('key'); if (!isFormKey(key)) throw new AppError(404, 'Unknown form.');
    await saveSettings(c.var.db, me(c), key, await c.req.json()); return c.json({ ok: true });
  });
}
