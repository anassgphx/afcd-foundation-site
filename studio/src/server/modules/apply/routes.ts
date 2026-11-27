// AFCD Apply staff routes (under /studio/api/apply). Applicants never reach these: their API will live at /apply/v1,
// outside /studio, with no staff session (docs/adr/0004-afcd-apply.md).
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import { AppError, perm, requireUser, type Env } from '../../http.ts';
import { publicRef, type MediaRow } from '../media/service.ts';
import * as C from './calls.ts';
import * as F from './forms.ts';
import { pageStatus } from './publish.ts';
import * as S from './submissions.ts';
import * as E from './evaluation.ts';
import * as D from './decisions.ts';
import * as MSG from './messages.ts';
import { filePath } from './files.ts';
import { existsSync, readFileSync } from 'node:fs';
import { HTTPException } from 'hono/http-exception';
import { can } from '../../rbac.ts';

/** After a change that can affect a public page: rebuild if needed. The change itself is already saved; a failed build is
 *  reported, never hidden, and the minute tick retries. */
async function refreshSite(c: Context<Env>) {
  try { return { refreshed: await c.var.publisher.refreshApplyPages(), error: null as string | null }; }
  catch (e) { console.error('[apply] page refresh failed', e); return { refreshed: false, error: `The website page could not be rebuilt yet: ${(e as Error).message}`.slice(0, 300) }; }
}

const mediaOut = (m: MediaRow) => ({ ...m, url: `/studio/media-file/${m.storageKey}-480.webp`, large: `/studio/media-file/${publicRef(m).src.split('/').pop()}` });

export function registerApplyRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });

  api.get('/apply/overview', perm('apply.read'), async (c) => {
    const { db } = c.var; const u = requireUser(c);
    const o = await C.overview(db);
    // application counts are not personal data; the list of recent applications is, so only for those who may read them
    const counts = await S.submissionCounts(db);
    const recent = can(u.role, 'apply.submission.read') ? (await S.listSubmissions(db, { limit: '10' })).items : null;
    const reviews = can(u.role, 'apply.evaluation.manage') ? await E.workloadSummary(db) : null;
    const mine = can(u.role, 'apply.review') ? (await E.myAssignments(db, actor(c))).filter((a) => a.status !== 'final' && a.status !== 'conflict').length : null;
    const outbox = can(u.role, 'apply.message') ? await MSG.outboxSummary(db, c.var.cfg) : null;
    return c.json({ ...o, applications: counts, recent, reviews, myPending: mine, outbox });
  });

  // ---------------------------------------------------------------- Applications (personal data)
  api.get('/apply/submissions', perm('apply.submission.read'), async (c) => c.json(await S.listSubmissions(c.var.db, c.req.query())));
  api.get('/apply/submissions/by-call', perm('apply.submission.read'), async (c) => c.json(await S.countsByCall(c.var.db)));
  api.get('/apply/submissions/counts', perm('apply.read'), async (c) => c.json(await S.submissionCounts(c.var.db, c.req.query('call') || undefined)));
  api.get('/apply/submissions/:id', perm('apply.submission.read'), async (c) => c.json(await S.getSubmission(c.var.db, c.req.param('id'))));
  api.get('/apply/submissions/:id/files/:file', perm('apply.submission.read'), async (c) => {
    const f = await S.fileForDownload(c.var.db, c.var.cfg, actor(c), c.req.param('id'), c.req.param('file'));
    c.header('Content-Type', f.mime); c.header('Cache-Control', 'private, no-store'); c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    // ?inline=1 shows a PDF or an image in Studio's viewer (still signed in, still recorded); everything else downloads
    const inline = c.req.query('inline') === '1' && (f.mime === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(f.mime));
    c.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    return c.body(f.bytes);
  });
  api.post('/apply/submissions/bulk-eligibility', perm('apply.submission.manage'), async (c) => c.json(await S.bulkEligibility(c.var.db, actor(c), await c.req.json().catch(() => ({})))));
  api.post('/apply/submissions/bulk-status', perm('apply.submission.manage'), async (c) => c.json(await S.bulkStatus(c.var.db, actor(c), await c.req.json().catch(() => ({})))));
  api.post('/apply/submissions/:id/status', perm('apply.submission.manage'), async (c) => c.json(await S.setStatus(c.var.db, actor(c), c.req.param('id'), await c.req.json().catch(() => ({})))));
  api.post('/apply/submissions/:id/eligibility', perm('apply.submission.manage'), async (c) => c.json(await S.setEligibility(c.var.db, actor(c), c.req.param('id'), await c.req.json().catch(() => ({})))));
  api.post('/apply/submissions/:id/notes', perm('apply.submission.manage'), async (c) => c.json(await S.addNote(c.var.db, actor(c), c.req.param('id'), await c.req.json().catch(() => ({})))));
  api.get('/apply/calls', perm('apply.read'), async (c) => c.json(await C.listCalls(c.var.db)));
  api.get('/apply/calls/export.csv', perm('apply.export'), async (c) => {
    const csv = await C.exportCallsCsv(c.var.db, actor(c));
    c.header('Content-Type', 'text/csv; charset=utf-8'); c.header('Cache-Control', 'private, no-store');
    c.header('Content-Disposition', `attachment; filename="afcd-calls-${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  });
  api.post('/apply/calls', perm('apply.call.manage'), async (c) => c.json(await C.createCall(c.var.db, actor(c), await c.req.json().catch(() => ({}))), 201));
  api.get('/apply/calls/:id', perm('apply.read'), async (c) => {
    const { db } = c.var;
    const call = await C.loadCall(db, c.req.param('id'));
    const [m] = call.heroMediaId ? await db.select().from(t.media).where(eq(t.media.id, call.heroMediaId)) : [];
    const u = requireUser(c);
    return c.json({ ...call, media: m ? mediaOut(m) : null, problems: await C.callProblems(db, call), history: await C.callHistory(db, call.id),
      actions: C.allowedActions(u.role, call.status), serverTime: new Date().toISOString(), page: await pageStatus(db, c.var.cfg, call.id) });
  });
  api.put('/apply/calls/:id', perm('apply.call.manage'), async (c) => {
    const r = await C.updateCall(c.var.db, actor(c), c.req.param('id'), await c.req.json().catch(() => ({})));
    return c.json({ ...r, site: await refreshSite(c) });
  });
  api.post('/apply/calls/:id/transition', perm('apply.read'), async (c) => {
    const r = await C.transitionCall(c.var.db, actor(c), requireUser(c).role, c.req.param('id'), await c.req.json().catch(() => ({})));
    return c.json({ ...r, site: await refreshSite(c) });
  });
  api.post('/apply/calls/:id/duplicate', perm('apply.call.manage'), async (c) => c.json(await C.duplicateCall(c.var.db, actor(c), c.req.param('id')), 201));
}

/** Application forms and templates (Form builder, Templates). */
export function registerApplyFormRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  const body = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => ({}));
  const download = (c: Context<Env>, name: string, data: unknown) => {
    c.header('Content-Type', 'application/json; charset=utf-8'); c.header('Cache-Control', 'private, no-store');
    c.header('Content-Disposition', `attachment; filename="${name.replace(/[^a-z0-9._-]+/gi, '-')}.json"`);
    return c.body(JSON.stringify(data, null, 2));
  };

  api.get('/apply/forms', perm('apply.read'), async (c) => c.json(await F.listForms(c.var.db)));
  api.get('/apply/calls/:id/form', perm('apply.read'), async (c) => c.json(await F.loadForm(c.var.db, c.req.param('id'))));
  api.post('/apply/calls/:id/form', perm('apply.form.edit'), async (c) => c.json(await F.createForm(c.var.db, actor(c), c.req.param('id'), await body(c)), 201));
  api.put('/apply/calls/:id/form', perm('apply.form.edit'), bodyLimit({ maxSize: 1_100_000, onError: () => { throw new AppError(422, 'The form is too large.'); } }),
    async (c) => c.json(await F.saveForm(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.post('/apply/calls/:id/form/publish', perm('apply.call.publish'), async (c) => {
    const r = await F.publishForm(c.var.db, actor(c), c.req.param('id'), await body(c));
    return c.json({ ...r, site: await refreshSite(c) });
  });
  api.post('/apply/calls/:id/form/import', perm('apply.form.edit'), bodyLimit({ maxSize: 1_100_000, onError: () => { throw new AppError(422, 'The file is too large.'); } }), async (c) => {
    const b = z.object({ data: z.unknown(), rev: z.number().int() }).strict().safeParse(await body(c));
    if (!b.success) throw new AppError(422, 'Send the file and the revision you loaded.');
    return c.json(await F.saveForm(c.var.db, actor(c), c.req.param('id'), { definition: F.unwrapImport(b.data.data), rev: b.data.rev }, 'import'));
  });
  api.post('/apply/calls/:id/form/template', perm('apply.form.edit'), async (c) => {
    const b = z.object({ template: z.string().max(80), rev: z.number().int() }).strict().safeParse(await body(c));
    if (!b.success) throw new AppError(422, 'Choose a template.');
    const src = await F.templateDefinition(c.var.db, b.data.template);
    return c.json(await F.saveForm(c.var.db, actor(c), c.req.param('id'), { definition: src.def, rev: b.data.rev }, 'template', src.label));
  });
  api.get('/apply/calls/:id/form/export', perm('apply.read'), async (c) => {
    const d = await F.exportForm(c.var.db, actor(c), c.req.param('id'));
    return download(c, `${d.source.reference}-form`, d);
  });
  api.get('/apply/calls/:id/form/versions/:n', perm('apply.read'), async (c) => c.json(await F.formVersion(c.var.db, c.req.param('id'), Number(c.req.param('n')) || 0)));

  api.get('/apply/templates', perm('apply.read'), async (c) => c.json(await F.listTemplates(c.var.db, c.req.query('archived') === '1')));
  api.get('/apply/templates/:id', perm('apply.read'), async (c) => c.json(await F.getTemplate(c.var.db, c.req.param('id'))));
  api.get('/apply/templates/:id/export', perm('apply.read'), async (c) => { const d = await F.exportTemplate(c.var.db, c.req.param('id')); return download(c, `template-${d.name}-v${d.version}`, d); });
  api.post('/apply/templates', perm('apply.form.edit'), bodyLimit({ maxSize: 1_100_000, onError: () => { throw new AppError(422, 'The file is too large.'); } }),
    async (c) => c.json(await F.createTemplate(c.var.db, actor(c), await body(c)), 201));
  api.put('/apply/templates/:id', perm('apply.form.edit'), bodyLimit({ maxSize: 1_100_000, onError: () => { throw new AppError(422, 'The template is too large.'); } }),
    async (c) => c.json(await F.updateTemplate(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.post('/apply/templates/:id/archive', perm('apply.form.edit'), async (c) => c.json(await F.archiveTemplate(c.var.db, actor(c), c.req.param('id'), true)));
  api.post('/apply/templates/:id/restore', perm('apply.form.edit'), async (c) => c.json(await F.archiveTemplate(c.var.db, actor(c), c.req.param('id'), false)));
}

/** Evaluation (rubric, assignments, reviews) and decisions. Reviewers reach only their own assignments. */
export function registerApplyEvaluationRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  const body = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => ({}));
  const reviewer: MiddlewareHandler<Env> = async (c, next) => {
    const u = requireUser(c);
    if (!can(u.role, 'apply.review') && !can(u.role, 'apply.evaluation.manage')) throw new HTTPException(403, { message: 'Your role cannot do this (apply.review).' });
    await next();
  };

  api.get('/apply/calls/:id/rubric', perm('apply.evaluation.manage'), async (c) => c.json(await E.getRubric(c.var.db, c.req.param('id'))));
  api.put('/apply/calls/:id/rubric', perm('apply.evaluation.manage'), async (c) => c.json(await E.saveRubric(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.post('/apply/calls/:id/rubric/publish', perm('apply.evaluation.manage'), async (c) => c.json(await E.publishRubric(c.var.db, actor(c), c.req.param('id'))));
  api.get('/apply/calls/:id/evaluation', perm('apply.evaluation.manage'), async (c) => c.json(await E.progress(c.var.db, c.req.param('id'))));
  api.post('/apply/calls/:id/assignments', perm('apply.evaluation.manage'), async (c) => c.json(await E.assign(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.delete('/apply/assignments/:id', perm('apply.evaluation.manage'), async (c) => c.json(await E.unassign(c.var.db, actor(c), c.req.param('id'))));
  api.get('/apply/reviewers', perm('apply.evaluation.manage'), async (c) => c.json(await E.reviewerPool(c.var.db)));
  api.get('/apply/submissions/:id/reviews', perm('apply.evaluation.manage'), async (c) => c.json(await E.reviewsOf(c.var.db, c.req.param('id'))));

  api.get('/apply/my-reviews', reviewer, async (c) => c.json(await E.myAssignments(c.var.db, actor(c))));
  api.get('/apply/reviews/:id', reviewer, async (c) => c.json(await E.reviewView(c.var.db, actor(c), c.req.param('id'))));
  api.post('/apply/reviews/:id/coi', reviewer, async (c) => c.json(await E.declare(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.put('/apply/reviews/:id', reviewer, async (c) => c.json(await E.saveReview(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.post('/apply/reviews/:id/final', reviewer, async (c) => c.json(await E.finalizeReview(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.get('/apply/reviews/:id/files/:file', reviewer, async (c) => {
    const f = await E.reviewerFile(c.var.db, actor(c), c.req.param('id'), c.req.param('file'));
    const p = filePath(c.var.cfg, f.storageKey);
    if (!existsSync(p)) throw new AppError(404, 'File not found.');
    c.header('Content-Type', f.mime); c.header('Cache-Control', 'private, no-store'); c.header('X-Content-Type-Options', 'nosniff'); c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('Content-Disposition', `attachment; filename="${f.originalName.replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
    return c.body(new Uint8Array(readFileSync(p)));
  });

  api.get('/apply/decisions', perm('apply.submission.read'), async (c) => c.json(await D.listDecisions(c.var.db, { call: c.req.query('call'), status: c.req.query('status') })));
  api.post('/apply/decisions', perm('apply.submission.manage'), async (c) => c.json(await D.propose(c.var.db, actor(c), await body(c)), 201));
  api.post('/apply/decisions/decide', perm('apply.decide'), async (c) => c.json(await D.decide(c.var.db, actor(c), requireUser(c).role, await body(c))));
  api.post('/apply/decisions/:id/withdraw', perm('apply.submission.manage'), async (c) => c.json(await D.withdrawDecision(c.var.db, actor(c), c.req.param('id'))));
}

/** Communications: email templates, receipts, decision notices, messages to applicants, the outbox. */
export function registerApplyMessageRoutes(api: Hono<Env>) {
  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  const body = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => ({}));
  const callOrNull = (v: string | undefined) => (v && v !== 'default' ? v : null);
  api.get('/apply/email-templates', perm('apply.message'), async (c) => c.json(await MSG.listTemplates(c.var.db, callOrNull(c.req.query('call')))));
  api.put('/apply/email-templates/:key', perm('apply.message'), async (c) => c.json(await MSG.saveTemplate(c.var.db, actor(c), callOrNull(c.req.query('call')), c.req.param('key'), await body(c))));
  api.delete('/apply/email-templates/:key', perm('apply.message'), async (c) => c.json(await MSG.resetTemplate(c.var.db, actor(c), c.req.query('call') ?? '', c.req.param('key'))));
  api.put('/apply/calls/:id/receipts', perm('apply.message'), async (c) => c.json(await MSG.setReceipt(c.var.db, actor(c), c.req.param('id'), await body(c))));
  api.post('/apply/messages/preview', perm('apply.message'), async (c) => c.json(await MSG.preview(c.var.db, await body(c))));
  api.post('/apply/messages/decisions', perm('apply.message'), async (c) => c.json(await MSG.queueDecisionNotices(c.var.db, actor(c), await body(c))));
  api.post('/apply/messages/custom', perm('apply.message'), async (c) => c.json(await MSG.queueCustom(c.var.db, actor(c), await body(c))));
  api.get('/apply/messages', perm('apply.message'), async (c) => c.json(await MSG.listMessages(c.var.db, { call: c.req.query('call'), status: c.req.query('status'), submission: c.req.query('submission') })));
  api.get('/apply/messages/:id', perm('apply.message'), async (c) => c.json(await MSG.messageBody(c.var.db, c.req.param('id'))));
  api.post('/apply/messages/:id/retry', perm('apply.message'), async (c) => c.json(await MSG.retry(c.var.db, actor(c), c.req.param('id'))));
  api.post('/apply/messages/:id/cancel', perm('apply.message'), async (c) => c.json(await MSG.cancel(c.var.db, actor(c), c.req.param('id'))));
}
