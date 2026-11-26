// AFCD Apply, applicant side: public call state, drafts (autosave with optimistic concurrency), private uploads and
// resume links. Applicants have no Studio account: a draft is opened with "<draftId>.<secret>" (only the SHA-256 of the
// secret is stored). Every rule about time uses the server clock, never what the website page says.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, count, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { applyCalls, applyDrafts, applyFiles, applyForms, applyFormVersions, applyResumeTokens, applySubmissionEvents, applySubmissions } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit } from '../../audit.ts';
import { ipSalt } from '../forms/service.ts';
import { deliver } from '../inbox/mail.ts';
import { compose } from '../settings/email-layout.ts';
import { allFields, FIELD_TYPES, FILE_TYPES, t, validate, type Answers, type FileRef, type FormDef } from './engine.ts';
import { detect, MAX_DRAFT_BYTES, MAX_DRAFT_FILES, removeStored, safeName, store } from './files.ts';

const DRAFT_DAYS = 30;
const RESUME_HOURS = 72;
const LIMIT = { draftsPerIpHour: 20, linksPerDraftHour: 3, linksPerIpHour: 10 };
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const hashIp = (cfg: Config, ip: string | null) => (ip ? sha(`${ipSalt(cfg)}:apply:${ip}`) : null);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PublicState = 'upcoming' | 'open' | 'paused' | 'closed';
type Call = typeof applyCalls.$inferSelect;
type Draft = typeof applyDrafts.$inferSelect;

/** The call as applicants see it right now (server time). Calls that were never released do not exist publicly. */
export function publicState(c: Call, now = new Date()): PublicState | null {
  if (c.status === 'scheduled') return 'upcoming';
  if (c.status === 'paused') return c.closesAt && c.closesAt <= now ? 'closed' : 'paused';
  if (c.status === 'open') return !c.closesAt || c.closesAt > now ? (c.opensAt && c.opensAt > now ? 'upcoming' : 'open') : 'closed';
  if (['closed', 'under_evaluation', 'completed'].includes(c.status)) return 'closed';
  return null;
}
const callInfo = (c: Call, now: Date) => ({ slug: c.slug, reference: c.reference, title: c.title, state: publicState(c, now), opensAt: c.opensAt, closesAt: c.closesAt, timeZone: c.timeZone, contactEmail: c.contactEmail, serverTime: now.toISOString() });

async function callBySlug(db: DB, slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new AppError(404, 'This call does not exist.');
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.slug, slug));
  if (!c || !publicState(c)) throw new AppError(404, 'This call does not exist.');
  return c;
}
async function liveVersion(db: DB, callId: string) {
  const [r] = await db.select({ v: applyFormVersions }).from(applyForms).innerJoin(applyFormVersions, eq(applyFormVersions.id, applyForms.publishedVersionId)).where(eq(applyForms.callId, callId));
  return r?.v ?? null;
}

export async function publicCall(db: DB, slug: string, now = new Date()) {
  const c = await callBySlug(db, slug);
  const v = await liveVersion(db, c.id);
  return { call: callInfo(c, now), version: v ? { id: v.id, number: v.number, definition: v.definition } : null };
}

// ---------------------------------------------------------------- Drafts
const startSchema = z.object({ lang: z.enum(['en', 'fr', 'ar']).default('en'), website: z.string().max(200).optional().default(''), t: z.number().int().nonnegative().optional() }).strict();

export async function createDraft(db: DB, cfg: Config, slug: string, raw: unknown, ip: string | null, now = new Date()) {
  const b = startSchema.safeParse(raw ?? {});
  if (!b.success) throw new AppError(422, 'Could not start the application.');
  const c = await callBySlug(db, slug);
  const st = publicState(c, now);
  if (st !== 'open') throw new AppError(409, st === 'upcoming' ? 'Applications are not open yet.' : st === 'paused' ? 'Applications are paused for a moment. Please try again later.' : 'Applications for this call are closed.');
  const v = await liveVersion(db, c.id);
  if (!v) throw new AppError(409, 'The application form is not available yet.');
  if (b.data.website) throw new AppError(422, 'Could not start the application.');             // honeypot
  const ipHash = hashIp(cfg, ip);
  if (ipHash) {
    const [{ n }] = await db.select({ n: count() }).from(applyDrafts).where(and(eq(applyDrafts.ipHash, ipHash), gte(applyDrafts.createdAt, new Date(now.getTime() - 3600_000))));
    if (n >= LIMIT.draftsPerIpHour) throw new AppError(429, 'Too many applications were started from this connection. Please wait an hour and try again.');
  }
  const secret = randomBytes(32).toString('base64url');
  const [d] = await db.insert(applyDrafts).values({ callId: c.id, versionId: v.id, secretHash: sha(secret), lang: b.data.lang, ipHash, expiresAt: new Date(now.getTime() + DRAFT_DAYS * 864e5) }).returning();
  return { token: `${d.id}.${secret}`, draft: await draftView(db, d, now) };
}

/** The draft a bearer token opens, or 401. Constant-time comparison of the secret's hash. */
export async function draftFromToken(db: DB, header: string | undefined, now = new Date(), opts: { allowSubmitted?: boolean } = {}) {
  const m = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  const fail = () => new AppError(404, 'This application draft cannot be opened. It may have expired or been submitted.');
  if (!m) throw fail();
  const [d] = await db.select().from(applyDrafts).where(eq(applyDrafts.id, m[1]));
  if (!d) throw fail();
  const a = Buffer.from(d.secretHash, 'hex'), b = Buffer.from(sha(m[2]), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b) || (d.status !== 'active' && !(opts.allowSubmitted && d.status === 'submitted')) || (d.status === 'active' && d.expiresAt <= now)) throw fail();
  return d;
}

async function versionOf(db: DB, d: Draft) {
  const [v] = await db.select().from(applyFormVersions).where(eq(applyFormVersions.id, d.versionId));
  return v;
}
const fileRef = (f: typeof applyFiles.$inferSelect): FileRef & { field: string } => ({ id: f.id, name: f.originalName, bytes: f.bytes, mime: f.mime, field: f.fieldId });

export async function draftView(db: DB, d: Draft, now = new Date()) {
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, d.callId));
  const v = await versionOf(db, d);
  const files = await db.select().from(applyFiles).where(eq(applyFiles.draftId, d.id));
  return { id: d.id, rev: d.rev, page: d.page, lang: d.lang, answers: d.answers, updatedAt: d.updatedAt, expiresAt: d.expiresAt,
    call: callInfo(c, now), version: { id: v.id, number: v.number, definition: v.definition }, files: files.map(fileRef) };
}

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
/** Keeps only answers that fit the form version's questions (shape and type, not yet completeness: a draft may be partial). */
export function sanitizeAnswers(def: FormDef, raw: Record<string, unknown>, files: Map<string, FileRef & { field: string }>): Answers {
  const out: Answers = {};
  for (const f of allFields(def)) {
    if (!FIELD_TYPES[f.type]?.input || !(f.id in raw)) continue;
    const v = raw[f.id];
    if (v === null || v === undefined || v === '') continue;
    const opts = new Set((f.config?.options ?? []).map((o) => o.value));
    switch (f.type) {
      case 'short_text': case 'long_text': case 'email': case 'phone': case 'url':
        if (typeof v === 'string') out[f.id] = clean(v).slice(0, 20000); break;
      case 'number':
        if (typeof v === 'number' && Number.isFinite(v)) out[f.id] = v; else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && v.length < 30) out[f.id] = Number(v); break;
      case 'date': if (typeof v === 'string' && DATE.test(v)) out[f.id] = v; break;
      case 'single_choice': if (typeof v === 'string' && opts.has(v)) out[f.id] = v; break;
      case 'multi_choice': if (Array.isArray(v)) { const xs = [...new Set(v.filter((x): x is string => typeof x === 'string' && opts.has(x)))]; if (xs.length) out[f.id] = xs; } break;
      case 'yes_no': case 'consent': if (typeof v === 'boolean') out[f.id] = v; break;
      case 'file': if (Array.isArray(v)) {
        const refs = v.map((x) => (x && typeof x === 'object' ? files.get(String((x as { id?: unknown }).id)) : undefined)).filter((x): x is FileRef & { field: string } => !!x && x.field === f.id);
        if (refs.length) out[f.id] = refs.map(({ field: _f, ...r }) => r);
      } break;
    }
  }
  return out;
}

const saveSchema = z.object({ answers: z.record(z.string().max(40), z.unknown()), page: z.string().max(40).nullable().optional(), rev: z.number().int().min(1), lang: z.enum(['en', 'fr', 'ar']).optional() }).strict();

async function assertOpen(db: DB, d: Draft, now: Date) {
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, d.callId));
  const st = publicState(c, now);
  if (st !== 'open') throw new AppError(409, st === 'paused' ? 'Applications are paused for a moment. Your answers are kept; try again later.' : 'Applications for this call are closed. Changes can no longer be saved.', [{ path: 'state', message: st ?? 'closed' }]);
  return c;
}

export async function saveDraft(db: DB, d: Draft, raw: unknown, now = new Date()) {
  const b = saveSchema.safeParse(raw);
  if (!b.success) throw new AppError(422, 'The answers could not be read.');
  await assertOpen(db, d, now);
  const v = await versionOf(db, d);
  const def = v.definition as unknown as FormDef;
  const files = new Map((await db.select().from(applyFiles).where(eq(applyFiles.draftId, d.id))).map((f) => [f.id, fileRef(f)]));
  const answers = sanitizeAnswers(def, b.data.answers, files);
  const page = b.data.page && (b.data.page === 'review' || def.pages.some((p) => p.id === b.data.page)) ? b.data.page : null;
  const [u] = await db.update(applyDrafts).set({ answers: answers as Record<string, unknown>, page, lang: b.data.lang ?? d.lang, rev: sql`${applyDrafts.rev} + 1`, updatedAt: now, expiresAt: new Date(now.getTime() + DRAFT_DAYS * 864e5) })
    .where(and(eq(applyDrafts.id, d.id), eq(applyDrafts.rev, b.data.rev), eq(applyDrafts.status, 'active'))).returning({ rev: applyDrafts.rev, updatedAt: applyDrafts.updatedAt });
  if (!u) throw new AppError(409, 'This application was changed in another window or device. Reload to continue with the latest answers.', [{ path: 'rev', message: 'stale' }]);
  return { rev: u.rev, savedAt: u.updatedAt, answers };
}

// ---------------------------------------------------------------- Files
export async function uploadFile(db: DB, cfg: Config, d: Draft, fieldId: string, file: { name: string; bytes: Uint8Array }, now = new Date()) {
  await assertOpen(db, d, now);
  const def = (await versionOf(db, d)).definition as unknown as FormDef;
  const f = allFields(def).find((x) => x.id === fieldId);
  if (!f || f.type !== 'file') throw new AppError(422, 'This question does not take files.');
  const c = f.config ?? {};
  const maxBytes = Math.min(c.maxMb ?? 10, 25) * 1048576;
  if (file.bytes.byteLength > maxBytes) throw new AppError(422, `The file is larger than ${c.maxMb ?? 10} MB.`);
  const found = await detect(file.bytes);
  if ('problem' in found) throw new AppError(422, found.problem);
  const accepted = c.accept?.length ? c.accept : ['pdf'];
  if (!accepted.includes(found.kind)) throw new AppError(422, `This question accepts ${accepted.map((k) => FILE_TYPES[k]?.label ?? k).join(', ')}.`);
  const mine = await db.select().from(applyFiles).where(eq(applyFiles.draftId, d.id));
  if (mine.filter((x) => x.fieldId === fieldId).length >= (c.maxFiles ?? 1)) throw new AppError(422, `This question takes at most ${c.maxFiles ?? 1} file${(c.maxFiles ?? 1) === 1 ? '' : 's'}. Remove one first.`);
  if (mine.length >= MAX_DRAFT_FILES || mine.reduce((s, x) => s + x.bytes, 0) + file.bytes.byteLength > MAX_DRAFT_BYTES) throw new AppError(422, 'This application already has as many files as it can hold.');
  const s = store(cfg, file.bytes);
  try {
    const [row] = await db.insert(applyFiles).values({ draftId: d.id, callId: d.callId, fieldId, originalName: safeName(file.name, found.ext), storageKey: s.key, kind: found.kind, mime: found.mime, bytes: file.bytes.byteLength, sha256: s.sha256 }).returning();
    return fileRef(row);
  } catch (e) { removeStored(cfg, s.key); throw e; }
}

export async function deleteFile(db: DB, cfg: Config, d: Draft, fileId: string, now = new Date()) {
  await assertOpen(db, d, now);
  if (!z.string().uuid().safeParse(fileId).success) throw new AppError(404, 'File not found.');
  const [f] = await db.delete(applyFiles).where(and(eq(applyFiles.id, fileId), eq(applyFiles.draftId, d.id))).returning();
  if (!f) throw new AppError(404, 'File not found.');
  removeStored(cfg, f.storageKey);
  return { ok: true };
}

// ---------------------------------------------------------------- Resume links
/** Emails a single-use link (72 h) that reopens this draft on another device. The email never contains answers. */
export async function sendResumeLink(db: DB, cfg: Config, d: Draft, raw: unknown, ip: string | null, now = new Date()) {
  const b = z.object({ email: z.string().trim().max(160) }).strict().safeParse(raw);
  if (!b.success || !EMAIL.test(b.data.email)) throw new AppError(422, 'Enter a valid email address.');
  const ipHash = hashIp(cfg, ip);
  const hour = new Date(now.getTime() - 3600_000);
  const [{ n }] = await db.select({ n: count() }).from(applyResumeTokens).where(and(eq(applyResumeTokens.draftId, d.id), gte(applyResumeTokens.createdAt, hour)));
  const [{ m }] = ipHash ? await db.select({ m: count() }).from(applyResumeTokens).where(and(eq(applyResumeTokens.ipHash, ipHash), gte(applyResumeTokens.createdAt, hour))) : [{ m: 0 }];
  if (n >= LIMIT.linksPerDraftHour || m >= LIMIT.linksPerIpHour) throw new AppError(429, 'Too many links were requested. Please wait an hour.');
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, d.callId));
  const raw32 = randomBytes(32).toString('base64url');
  const [tok] = await db.insert(applyResumeTokens).values({ draftId: d.id, tokenHash: sha(raw32), ipHash, expiresAt: new Date(now.getTime() + RESUME_HOURS * 3600_000) }).returning();
  const url = `${cfg.publicSiteUrl.replace(/\/?$/, '/')}apply-${c.slug}.html#resume=${raw32}`;
  const subject = `Continue your application: ${c.title}`.replace(/[\r\n]+/g, ' ').slice(0, 180);
  const msg = await compose(db, { subject, heading: 'Continue your application', preheader: `A link to continue your application for ${c.title}`.slice(0, 140),
    body: `You asked for a link to continue your application for “${c.title}” on another device.\n\nThe link works once, for ${RESUME_HOURS} hours. Your answers are not in this email: they stay in your saved application.\n\nIf the button does not work, copy this address into your browser:\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
    button: { label: 'Continue my application', url } });
  try { await deliver(cfg, { to: b.data.email, subject, ...msg }); }
  catch (e) { await db.delete(applyResumeTokens).where(eq(applyResumeTokens.id, tok.id)); throw e; }
  await audit(db, null, 'apply.resume_link', { type: 'apply_draft', id: d.id }, `Resume link sent for ${c.reference}`);   // never the address
  return { ok: true, expiresInHours: RESUME_HOURS };
}

/** Exchanges a resume link for a fresh draft token (the old secret stops working). Single use. */
export async function resumeDraft(db: DB, raw: unknown, now = new Date()) {
  const b = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(raw);
  const fail = new AppError(404, 'This link has expired or was already used. Ask for a new one from the application page.');
  if (!b.success) throw fail;
  const [t] = await db.update(applyResumeTokens).set({ usedAt: now }).where(and(eq(applyResumeTokens.tokenHash, sha(b.data.token)), isNull(applyResumeTokens.usedAt), gte(applyResumeTokens.expiresAt, now))).returning();
  if (!t) throw fail;
  const secret = randomBytes(32).toString('base64url');
  const [d] = await db.update(applyDrafts).set({ secretHash: sha(secret), updatedAt: now }).where(and(eq(applyDrafts.id, t.draftId), eq(applyDrafts.status, 'active'), gte(applyDrafts.expiresAt, now))).returning();
  if (!d) throw fail;
  // every other link for this draft stops working too
  await db.update(applyResumeTokens).set({ usedAt: now }).where(and(eq(applyResumeTokens.draftId, d.id), isNull(applyResumeTokens.usedAt)));
  return { token: `${d.id}.${secret}`, draft: await draftView(db, d, now) };
}

/** Deletes expired drafts with their files (disk first, then rows). Called from the server's minute tick. */
export async function purgeExpiredDrafts(db: DB, cfg: Config, now = new Date()) {
  const old = await db.select({ id: applyDrafts.id }).from(applyDrafts).where(and(eq(applyDrafts.status, 'active'), lt(applyDrafts.expiresAt, now))).limit(500);
  if (!old.length) return 0;
  const ids = old.map((x) => x.id);
  const files = await db.select().from(applyFiles).where(inArray(applyFiles.draftId, ids));
  for (const f of files) removeStored(cfg, f.storageKey);
  await db.delete(applyFiles).where(inArray(applyFiles.draftId, ids));
  await db.delete(applyDrafts).where(inArray(applyDrafts.id, ids));
  return ids.length;
}

// ---------------------------------------------------------------- Submit
/** Who the application is from, for staff lists and search: the form's first email question, and its name question
 *  (an ID such as full_name or contact_name, else the first required short text). */
export function applicantOf(def: FormDef, answers: Answers) {
  const fields = allFields(def);
  const email = fields.find((f) => f.type === 'email' && typeof answers[f.id] === 'string');
  const name = fields.find((f) => /(^|_)(full_name|name|contact_name)$/.test(f.id) && typeof answers[f.id] === 'string')
    ?? fields.find((f) => f.type === 'short_text' && f.required && typeof answers[f.id] === 'string');
  return { name: name ? String(answers[name.id]).slice(0, 200) : '', email: email ? String(answers[email.id]).trim().toLowerCase().slice(0, 200) : '' };
}

const submitSchema = z.object({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/) }).strict();

/** Final submission: ONE transaction. The server re-validates every answer against the draft's form version (hidden
 *  answers dropped, required-ness and calculations recomputed), checks the deadline on its own clock, stores the
 *  application with its consent and automatic eligibility, attaches the files and closes the draft. Sending the same
 *  idempotency key again, or submitting an already-submitted draft, returns the same reference: never a second
 *  application. The reference is only returned once the transaction has committed. */
export async function submitDraft(db: DB, cfg: Config, d0: Draft, raw: unknown, ip: string | null, now = new Date()) {
  const b = submitSchema.safeParse(raw ?? {});
  if (!b.success) throw new AppError(422, 'The request is missing its submission key. Reload the page and try again.');
  const key = b.data.idempotencyKey;
  const result = await db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const [d] = await t2.select().from(applyDrafts).where(eq(applyDrafts.id, d0.id)).for('update');
    const [done] = await t2.select().from(applySubmissions).where(sql`${applySubmissions.draftId} = ${d.id} or (${applySubmissions.callId} = ${d.callId} and ${applySubmissions.idempotencyKey} = ${key})`);
    if (done) return { reference: done.reference, submittedAt: done.submittedAt, already: true };
    if (d.status !== 'active') throw new AppError(409, 'This application was already submitted.');
    const [c] = await t2.select().from(applyCalls).where(eq(applyCalls.id, d.callId)).for('update');   // serializes references per call
    const st = publicState(c, now);
    if (st !== 'open') throw new AppError(409, st === 'paused' ? 'Applications are paused for a moment. Your answers are kept; please try again later.' : 'The deadline has passed: applications for this call are closed.');
    const [v] = await t2.select().from(applyFormVersions).where(eq(applyFormVersions.id, d.versionId));
    const def = v.definition as unknown as FormDef;
    const files = await t2.select().from(applyFiles).where(eq(applyFiles.draftId, d.id));
    const fileMap = new Map(files.map((f) => [f.id, fileRef(f)]));
    const answers = sanitizeAnswers(def, d.answers, fileMap);
    const checked = validate(def, answers);
    if (!checked.ok) throw new AppError(422, 'Some answers need attention before you can submit.', checked.errors.map((e) => ({ path: `${e.page}.${e.field}`, message: e.message.en, messages: e.message })));
    const ev = checked.evaluation;
    const kept = checked.answers;
    const consent = allFields(def).filter((f) => f.type === 'consent' && kept[f.id] === true)
      .map((f) => ({ field: f.id, label: t(f.label), text: t(f.config?.text), at: now.toISOString() }));
    const who = applicantOf(def, kept);
    const [{ n }] = await t2.select({ n: count() }).from(applySubmissions).where(eq(applySubmissions.callId, c.id));
    const reference = `${c.reference}-${String(n + 1).padStart(4, '0')}`;
    const [s] = await t2.insert(applySubmissions).values({
      callId: c.id, versionId: v.id, draftId: d.id, reference, idempotencyKey: key, answers: kept as Record<string, unknown>,
      applicantName: who.name, applicantEmail: who.email, lang: d.lang, eligibility: ev.eligibility.result,
      eligibilityAuto: { result: ev.eligibility.result, reasons: ev.eligibility.reasons, rules: ev.eligibility.rules, formVersion: v.number },
      consent, ipHash: hashIp(cfg, ip), submittedAt: now, updatedAt: now,
    }).returning();
    // files the applicant uploaded but no longer uses stay with the draft and are deleted with it
    const used = new Set(Object.values(kept).flatMap((x): unknown[] => (Array.isArray(x) ? x : [])).map((x) => (x && typeof x === 'object' ? (x as FileRef).id : '')));
    const keep = files.filter((f) => used.has(f.id)).map((f) => f.id);
    if (keep.length) await t2.update(applyFiles).set({ submissionId: s.id }).where(inArray(applyFiles.id, keep));
    await t2.update(applyDrafts).set({ status: 'submitted', answers: kept as Record<string, unknown>, updatedAt: now }).where(eq(applyDrafts.id, d.id));
    await t2.insert(applySubmissionEvents).values({ submissionId: s.id, kind: 'submitted', toValue: 'submitted', meta: { formVersion: v.number, eligibility: ev.eligibility.result } });
    await audit(tx, null, 'apply.submission.received', { type: 'apply_submission', id: s.id }, `Application ${reference} received for ${c.reference}`);   // no personal data
    return { reference, submittedAt: s.submittedAt, already: false };
  });
  return result;
}
