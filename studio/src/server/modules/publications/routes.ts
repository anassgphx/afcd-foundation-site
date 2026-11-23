// Publications routes: records, workflow, publishing, and the PDF files (upload and signed-in download).
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as t from '../../db/schema.ts';
import { audit } from '../../audit.ts';
import { AppError, perm, requirePerm, type Env } from '../../http.ts';
import * as PB from './service.ts';
import { documentOnDisk, documentPath, ingestDocument, maxDocumentBytes } from './documents.ts';

const docOut = (d: typeof t.documents.$inferSelect) => ({ id: d.id, originalName: d.originalName, bytes: d.bytes, createdAt: d.createdAt, url: `/studio/api/documents/${d.id}/file` });

export function registerPublicationRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });

  api.get('/publications', perm('publication.read'), async (c) => c.json(await PB.listPublications(c.var.db)));
  api.post('/publications', perm('publication.create'), async (c) => c.json(await PB.createPublication(c.var.db, actor(c), await c.req.json()), 201));
  api.get('/publications/:id', perm('publication.read'), async (c) => {
    const { db, cfg } = c.var;
    const p = await PB.loadPublication(db, c.req.param('id'));
    const [m] = p.coverMediaId ? await db.select().from(t.media).where(eq(t.media.id, p.coverMediaId)) : [];
    const [d] = p.documentId ? await db.select().from(t.documents).where(eq(t.documents.id, p.documentId)) : [];
    return c.json({ ...p, cover: m ? { ...m, url: `/studio/media-file/${m.storageKey}-480.webp` } : null, document: d ? { ...docOut(d), missing: !documentOnDisk(cfg, d) } : null,
      problems: await PB.publicationProblems(db, cfg, p), history: await PB.publicationHistory(db, p.id) });
  });
  api.put('/publications/:id', perm('publication.update'), async (c) => c.json(await PB.updatePublication(c.var.db, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/publications/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !PB.publicationTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, PB.publicationTransitionPerm(body.data.action)!);
    return c.json(await PB.transitionPublication(c.var.db, c.var.cfg, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/publications/:id/publish', perm('publication.publish'), async (c) => c.json(await c.var.publisher.publishPublication(actor(c), c.req.param('id'))));
  api.post('/publications/:id/unpublish', perm('publication.publish'), async (c) => c.json(await c.var.publisher.unpublishPublication(actor(c), c.req.param('id'))));
  api.post('/publications/:id/preview', perm('publication.read'), async (c) => {
    const r = await c.var.publisher.previewPublication(c.req.param('id'), PB.toPublicationSnapshot(await PB.loadPublication(c.var.db, c.req.param('id'))));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/publications/:id/revisions/:rev/restore', perm('publication.update'), async (c) => { await PB.restorePublicationRevision(c.var.db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });

  // PDF upload: checked on the bytes (documents.ts). The new file is attached to a publication when its draft is saved.
  api.post('/documents', perm('publication.update'), bodyLimit({ maxSize: maxDocumentBytes() + 64 * 1024, onError: () => { throw new AppError(422, `The file is larger than ${Math.round(maxDocumentBytes() / 1048576)} MB.`); } }), async (c) => {
    const f = (await c.req.parseBody()).file;
    if (!(f instanceof File)) throw new AppError(422, 'Choose a PDF to upload.');
    const row = await ingestDocument(c.var.db, c.var.cfg, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, c.var.user!.id);
    await audit(c.var.db, actor(c), 'document.upload', { type: 'document', id: row.id }, `Uploaded ${row.originalName}`, { bytes: row.bytes, sha256: row.sha256 });
    return c.json(docOut(row), 201);
  });
  // Signed-in download of the stored file (drafts included). Always an attachment, never rendered inside Studio.
  api.get('/documents/:id/file', perm('publication.read'), async (c) => {
    if (!/^[0-9a-f-]{36}$/.test(c.req.param('id'))) throw new AppError(404, 'Document not found.');
    const [d] = await c.var.db.select().from(t.documents).where(eq(t.documents.id, c.req.param('id')));
    if (!d || !documentOnDisk(c.var.cfg, d)) throw new AppError(404, 'Document not found.');
    c.header('Content-Type', 'application/pdf'); c.header('Cache-Control', 'private, no-store'); c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Disposition', `attachment; filename="${d.originalName.replace(/["\\\r\n]/g, '_')}"`);
    return c.body(new Uint8Array(readFileSync(documentPath(c.var.cfg, d))));
  });
}
