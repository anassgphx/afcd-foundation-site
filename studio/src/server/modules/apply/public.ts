// AFCD Apply applicant API: /apply/v1/*. Mounted outside /studio, so the staff session, the staff cookie (path=/studio)
// and every admin route are out of reach. No cookies at all: a draft is opened with "Authorization: Bearer <id>.<secret>".
// Cross-origin calls are accepted only from the website (same list as the contact form: PUBLIC_SITE_URL and
// FORMS_ALLOWED_ORIGINS).
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { AppError, clientIp, type Env } from '../../http.ts';
import * as A from './applicant.ts';
import { MAX_FILE_MB } from './files.ts';

export function registerApplyPublicRoutes(app: Hono<Env>, db: DB, cfg: Config) {
  const origins = new Set([new URL(cfg.publicSiteUrl).origin, ...(process.env.FORMS_ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean)]);
  app.use('/apply/v1/*', async (c, next) => {
    const o = c.req.header('origin');
    if (o && !origins.has(o)) return c.json({ error: 'This website is not allowed to use the application form.' }, 403);
    if (o) { c.header('Access-Control-Allow-Origin', o); c.header('Vary', 'Origin'); }
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE'); c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization'); c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }
    await next();
  });
  const json = async (c: Context<Env>) => {
    if (!(c.req.header('content-type') ?? '').includes('application/json')) throw new AppError(422, 'Send JSON.');
    return c.req.json().catch(() => { throw new AppError(422, 'Send JSON.'); });
  };
  const small = bodyLimit({ maxSize: 600 * 1024, onError: (c) => c.json({ error: 'Too much text: shorten some answers.' }, 413) });
  const draft = (c: Context<Env>) => A.draftFromToken(db, c.req.header('authorization'));

  app.get('/apply/v1/calls/:slug', async (c) => c.json(await A.publicCall(db, c.req.param('slug'))));
  app.post('/apply/v1/calls/:slug/drafts', small, async (c) => c.json(await A.createDraft(db, cfg, c.req.param('slug'), await json(c), clientIp(c)), 201));
  app.get('/apply/v1/drafts/me', async (c) => c.json(await A.draftView(db, await draft(c))));
  app.put('/apply/v1/drafts/me', small, async (c) => c.json(await A.saveDraft(db, await draft(c), await json(c))));
  app.post('/apply/v1/drafts/me/files', bodyLimit({ maxSize: (MAX_FILE_MB + 1) * 1048576, onError: (c) => c.json({ error: `The file is larger than ${MAX_FILE_MB} MB.` }, 413) }), async (c) => {
    const d = await draft(c);
    const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const file = body.file, field = String(body.field ?? '');
    if (!(file instanceof File)) throw new AppError(422, 'Choose a file to upload.');
    return c.json(await A.uploadFile(db, cfg, d, field, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }), 201);
  });
  app.delete('/apply/v1/drafts/me/files/:id', async (c) => c.json(await A.deleteFile(db, cfg, await draft(c), c.req.param('id'))));
  app.post('/apply/v1/drafts/me/resume-link', small, async (c) => c.json(await A.sendResumeLink(db, cfg, await draft(c), await json(c), clientIp(c))));
  app.post('/apply/v1/resume', small, async (c) => c.json(await A.resumeDraft(db, await json(c))));
  // Final submission: one transaction, idempotent (applicant.ts submitDraft). A submitted draft can no longer be opened.
  app.post('/apply/v1/drafts/me/submit', small, async (c) => {
    const d = await A.draftFromToken(db, c.req.header('authorization'), new Date(), { allowSubmitted: true });
    return c.json(await A.submitDraft(db, cfg, d, await json(c), clientIp(c)));
  });
}
