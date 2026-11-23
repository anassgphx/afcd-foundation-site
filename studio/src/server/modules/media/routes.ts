// Media Library routes: the full library with usage, issues and duplicates; replace a file; download the original; bulk edits.
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import { audit } from '../../audit.ts';
import { AppError, perm, type Env } from '../../http.ts';
import * as M from './service.ts';
import * as L from './library.ts';

const urls = (m: M.MediaRow) => ({ url: `/studio/media-file/${m.storageKey}-480.webp`, large: `/studio/media-file/${M.publicRef(m).src.split('/').pop()}` });
/** What a reviewer would ask for before this image can be used publicly. */
const today = () => new Date().toISOString().slice(0, 10);
const issues = (m: M.MediaRow) => [...(!m.alt.trim() ? ['alt'] : []), ...(!m.credit.trim() ? ['credit'] : []), ...(!m.rightsConfirmed ? ['rights'] : []),
  ...(m.rightsExpiresOn && m.rightsExpiresOn < today() ? ['expired'] : [])];

export function registerMediaLibraryRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });

  api.get('/media/library', perm('media.read'), async (c) => {
    const { db, cfg } = c.var;
    const rows = await db.select().from(t.media).orderBy(desc(t.media.createdAt)).limit(1000);
    const users = new Map((await db.select({ id: t.users.id, name: t.users.name }).from(t.users)).map((u) => [u.id, u.name]));
    const used = await L.usage(db, rows.map((r) => r.id));
    const dup = await L.duplicates(cfg, rows);
    return c.json({
      items: rows.map((m) => ({ ...m, ...urls(m), uploadedByName: m.uploadedBy ? users.get(m.uploadedBy) ?? 'Former user' : null,
        usedOn: used[m.id] ?? [], issues: issues(m), duplicateOf: dup.get(m.id) ? { ids: dup.get(m.id)!.ids.filter((x) => x !== m.id), exact: dup.get(m.id)!.exact } : null })),
      total: rows.length,
    });
  });

  api.post('/media/:id/replace', perm('media.update'), bodyLimit({ maxSize: 40 * 1024 * 1024, onError: () => { throw new AppError(422, 'The file is too large.'); } }), async (c) => {
    const { db, cfg } = c.var;
    const [m] = await db.select().from(t.media).where(eq(t.media.id, c.req.param('id')));
    if (!m) throw new AppError(404, 'Media not found.');
    const f = (await c.req.parseBody()).file;
    if (!(f instanceof File)) throw new AppError(422, 'Choose an image.');
    const row = await L.replaceFile(db, cfg, m, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    await audit(db, actor(c), 'media.replace', { type: 'media', id: m.id }, `Replaced the file of ${m.originalName} with ${f.name.slice(0, 120)}`);
    return c.json({ ...row, ...urls(row) });
  });

  api.get('/media/:id/original', perm('media.read'), async (c) => {
    const { db, cfg } = c.var;
    const [m] = await db.select().from(t.media).where(eq(t.media.id, c.req.param('id')));
    if (!m) throw new AppError(404, 'Media not found.');
    const o = L.originalFile(cfg, m); if (!o) throw new AppError(404, 'The original file is missing.');
    const name = m.originalName.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'image';
    c.header('Content-Type', m.mime); c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', `attachment; filename="${name}.${o.ext}"`);
    return c.body(new Uint8Array(readFileSync(o.path)));
  });

  api.post('/media/bulk', perm('media.update'), async (c) => {
    const p = L.bulkSchema.safeParse(await c.req.json());
    if (!p.success) throw new AppError(422, 'Invalid bulk edit.', p.error.issues);
    const n = await L.bulkUpdate(c.var.db, p.data);
    const what = [p.data.addTags?.length ? `added tags ${p.data.addTags.join(', ')}` : '', p.data.removeTags?.length ? `removed tags ${p.data.removeTags.join(', ')}` : '', p.data.credit !== undefined ? `credit “${p.data.credit}”` : '', p.data.rightsConfirmed !== undefined ? `rights ${p.data.rightsConfirmed ? 'confirmed' : 'unconfirmed'}` : '', p.data.licence !== undefined ? `licence “${p.data.licence}”` : '', p.data.rightsExpiresOn !== undefined ? (p.data.rightsExpiresOn ? `rights until ${p.data.rightsExpiresOn}` : 'no rights end date') : ''].filter(Boolean).join('; ');
    await audit(c.var.db, actor(c), 'media.bulk_update', { type: 'media' }, `Bulk edit of ${n} image${n === 1 ? '' : 's'}: ${what}`, { ids: p.data.ids });
    return c.json({ updated: n });
  });
}
