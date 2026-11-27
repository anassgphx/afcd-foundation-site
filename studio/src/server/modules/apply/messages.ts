// AFCD Apply communications: email to applicants through Studio's SMTP (inbox/mail.ts deliver + the branded compose),
// always through a queue. One email per applicant (never a shared recipient list), a unique key per purpose so nothing
// is queued twice, retries with backoff, delivery status kept on each message. Templates hold plain text with a fixed
// list of {{variables}}; values are filled in as text and escaped by compose() when the HTML version is built.
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { applyCalls, applyDecisions, applyMessageBatches, applyMessages, applyMessageTemplates, applySubmissionEvents, applySubmissions, type MessageVariant } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { deliver, mailSettings } from '../inbox/mail.ts';
import { compose } from '../settings/email-layout.ts';

type Me = NonNullable<Actor>;
type Lang = 'en' | 'fr' | 'ar';
type Sub = typeof applySubmissions.$inferSelect;
type Call = typeof applyCalls.$inferSelect;
const uuid = z.string().uuid();

export const VARIABLES: Record<string, string> = {
  applicant_name: 'The applicant’s name', call_title: 'The call’s title', reference: 'The application reference', contact_email: 'The call’s contact email', submitted_date: 'The date the application was submitted',
};
export const KEYS = ['receipt', 'decision_selected', 'decision_waitlisted', 'decision_not_selected'] as const;
export type Key = (typeof KEYS)[number];
export const KEY_LABEL: Record<Key, string> = { receipt: 'Receipt after applying', decision_selected: 'Decision: selected', decision_waitlisted: 'Decision: waitlisted', decision_not_selected: 'Decision: not selected' };

const V = (subject: string, body: string): MessageVariant => ({ subject, body });
export const BUILT_IN: Record<Key, Record<Lang, MessageVariant>> = {
  receipt: {
    en: V('We received your application: {{call_title}}', 'Dear {{applicant_name}},\n\nThank you for applying to “{{call_title}}”. We received your application on {{submitted_date}}.\n\nYour reference is {{reference}}. Please keep it for any question about your application.\n\nWe will contact you by email once the selection is complete. If you have a question, write to {{contact_email}}.'),
    fr: V('Nous avons reçu votre candidature : {{call_title}}', 'Bonjour {{applicant_name}},\n\nMerci d’avoir postulé à « {{call_title}} ». Nous avons reçu votre candidature le {{submitted_date}}.\n\nVotre référence est {{reference}}. Conservez-la pour toute question sur votre candidature.\n\nNous vous contacterons par e-mail à la fin de la sélection. Pour toute question, écrivez à {{contact_email}}.'),
    ar: V('توصلنا بطلبك: {{call_title}}', 'مرحبًا {{applicant_name}}،\n\nشكرًا لتقديم طلبك في «{{call_title}}». توصلنا بطلبك بتاريخ {{submitted_date}}.\n\nرقمك المرجعي هو {{reference}}. يرجى الاحتفاظ به لأي استفسار حول طلبك.\n\nسنتواصل معك عبر البريد الإلكتروني بعد انتهاء الانتقاء. لأي سؤال، راسلنا على {{contact_email}}.'),
  },
  decision_selected: {
    en: V('Your application to {{call_title}}: selected', 'Dear {{applicant_name}},\n\nWe are pleased to tell you that your application to “{{call_title}}” (reference {{reference}}) has been selected.\n\nWe will write to you soon with the next steps. If you have a question, write to {{contact_email}}.'),
    fr: V('Votre candidature à {{call_title}} : retenue', 'Bonjour {{applicant_name}},\n\nNous avons le plaisir de vous annoncer que votre candidature à « {{call_title}} » (référence {{reference}}) a été retenue.\n\nNous vous écrirons bientôt pour les prochaines étapes. Pour toute question, écrivez à {{contact_email}}.'),
    ar: V('طلبك في {{call_title}}: تم قبوله', 'مرحبًا {{applicant_name}}،\n\nيسعدنا إخبارك بأن طلبك في «{{call_title}}» (المرجع {{reference}}) قد تم قبوله.\n\nسنراسلك قريبًا بالخطوات التالية. لأي سؤال، راسلنا على {{contact_email}}.'),
  },
  decision_waitlisted: {
    en: V('Your application to {{call_title}}: waiting list', 'Dear {{applicant_name}},\n\nThank you for applying to “{{call_title}}” (reference {{reference}}). Your application is on our waiting list: if a place becomes available, we will contact you.\n\nIf you have a question, write to {{contact_email}}.'),
    fr: V('Votre candidature à {{call_title}} : liste d’attente', 'Bonjour {{applicant_name}},\n\nMerci d’avoir postulé à « {{call_title}} » (référence {{reference}}). Votre candidature est sur notre liste d’attente : si une place se libère, nous vous contacterons.\n\nPour toute question, écrivez à {{contact_email}}.'),
    ar: V('طلبك في {{call_title}}: لائحة الانتظار', 'مرحبًا {{applicant_name}}،\n\nشكرًا لتقديم طلبك في «{{call_title}}» (المرجع {{reference}}). طلبك في لائحة الانتظار: إذا توفر مكان سنتواصل معك.\n\nلأي سؤال، راسلنا على {{contact_email}}.'),
  },
  decision_not_selected: {
    en: V('Your application to {{call_title}}', 'Dear {{applicant_name}},\n\nThank you for your interest in “{{call_title}}” and for the time you gave to your application (reference {{reference}}). After careful review, we are not able to offer you a place this time.\n\nWe hope to see you apply to future calls. If you have a question, write to {{contact_email}}.'),
    fr: V('Votre candidature à {{call_title}}', 'Bonjour {{applicant_name}},\n\nMerci de votre intérêt pour « {{call_title}} » et du temps consacré à votre candidature (référence {{reference}}). Après un examen attentif, nous ne pouvons pas vous proposer de place cette fois-ci.\n\nNous espérons vous revoir lors de prochains appels. Pour toute question, écrivez à {{contact_email}}.'),
    ar: V('طلبك في {{call_title}}', 'مرحبًا {{applicant_name}}،\n\nشكرًا لاهتمامك بـ«{{call_title}}» وللوقت الذي خصصته لطلبك (المرجع {{reference}}). بعد دراسة متأنية، لا يمكننا أن نقترح عليك مكانًا هذه المرة.\n\nنأمل أن نراك في دعوات قادمة. لأي سؤال، راسلنا على {{contact_email}}.'),
  },
};

// ---------------------------------------------------------------- Rendering
const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;
export function unknownVariables(text: string) { return [...text.matchAll(VAR)].map((m) => m[1]).filter((v) => !(v in VARIABLES)); }
/** Fills {{variables}} with plain text. Subjects lose line breaks; nothing is HTML here (compose() escapes later). */
export function render(text: string, vars: Record<string, string>, subject = false) {
  const out = text.replace(VAR, (_, k: string) => (k in vars ? vars[k] : ''));
  return subject ? out.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) : out;
}
function varsOf(s: Pick<Sub, 'applicantName' | 'reference' | 'submittedAt' | 'lang'>, c: Pick<Call, 'title' | 'contactEmail' | 'timeZone'>): Record<string, string> {
  const lang = (s.lang as Lang) || 'en';
  return {
    applicant_name: s.applicantName || (lang === 'fr' ? 'Madame, Monsieur' : lang === 'ar' ? 'السيدة، السيد' : 'applicant'),
    call_title: c.title, reference: s.reference, contact_email: c.contactEmail,
    submitted_date: new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: c.timeZone, dateStyle: 'long' }).format(s.submittedAt),
  };
}

// ---------------------------------------------------------------- Templates
async function stored(db: DB, callId: string | null, key: Key) {
  const [r] = await db.select().from(applyMessageTemplates).where(and(callId ? eq(applyMessageTemplates.callId, callId) : isNull(applyMessageTemplates.callId), eq(applyMessageTemplates.key, key)));
  return r ?? null;
}
/** The template in effect: the call's own version, else the Studio-wide one, else the built-in text. */
export async function effective(db: DB, callId: string | null, key: Key) {
  const own = callId ? await stored(db, callId, key) : null;
  const global = await stored(db, null, key);
  const pick = own ?? global;
  return { key, label: KEY_LABEL[key], variants: { ...BUILT_IN[key], ...(pick?.variants ?? {}) } as Record<Lang, MessageVariant>,
    source: own ? 'call' : global ? 'default' : 'built-in', rev: own?.rev ?? 0, defaultRev: global?.rev ?? 0 };
}
export async function listTemplates(db: DB, callId: string | null) {
  if (callId && !uuid.safeParse(callId).success) throw new AppError(404, 'Call not found.');
  return { variables: VARIABLES, templates: await Promise.all(KEYS.map((k) => effective(db, callId, k))) };
}

const variantSchema = z.object({ subject: z.string().trim().min(3).max(200).refine((v) => !/[\r\n]/.test(v), 'One line only.'), body: z.string().trim().min(10).max(10000) }).strict();
export async function saveTemplate(db: DB, me: Me, callId: string | null, key: string, raw: unknown) {
  if (!(KEYS as readonly string[]).includes(key)) throw new AppError(404, 'Unknown template.');
  if (callId && !uuid.safeParse(callId).success) throw new AppError(404, 'Call not found.');
  const b = z.object({ variants: z.object({ en: variantSchema, fr: variantSchema.optional(), ar: variantSchema.optional() }).strict(), rev: z.number().int().min(0) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Check the template.', b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const bad = Object.values(b.data.variants).flatMap((v) => (v ? [...unknownVariables(v.subject), ...unknownVariables(v.body)] : []));
  if (bad.length) throw new AppError(422, `Unknown variable${bad.length > 1 ? 's' : ''}: ${[...new Set(bad)].map((x) => `{{${x}}}`).join(', ')}.`);
  const cur = await stored(db, callId, key as Key);
  if ((cur?.rev ?? 0) !== b.data.rev) throw new AppError(409, 'Someone else saved this template after you opened it. Reload and try again.');
  if (cur) {
    const [u] = await db.update(applyMessageTemplates).set({ variants: b.data.variants, rev: cur.rev + 1, updatedBy: me.id, updatedAt: new Date() }).where(and(eq(applyMessageTemplates.id, cur.id), eq(applyMessageTemplates.rev, cur.rev))).returning();
    if (!u) throw new AppError(409, 'Someone else saved this template after you opened it. Reload and try again.');
  } else await db.insert(applyMessageTemplates).values({ callId, key, variants: b.data.variants, updatedBy: me.id });
  await audit(db, me, 'apply.template_email.save', { type: 'apply_call', id: callId ?? undefined }, `Saved email template “${KEY_LABEL[key as Key]}”${callId ? ' for a call' : ' (Studio default)'}`);
  return { ok: true };
}
export async function resetTemplate(db: DB, me: Me, callId: string, key: string) {
  if (!uuid.safeParse(callId).success || !(KEYS as readonly string[]).includes(key)) throw new AppError(404, 'Template not found.');
  await db.delete(applyMessageTemplates).where(and(eq(applyMessageTemplates.callId, callId), eq(applyMessageTemplates.key, key)));
  await audit(db, me, 'apply.template_email.reset', { type: 'apply_call', id: callId }, `Call uses the default “${KEY_LABEL[key as Key]}” again`);
  return { ok: true };
}

// ---------------------------------------------------------------- Queueing
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
type Q = { call: Call; sub: Sub; kind: 'receipt' | 'decision' | 'custom'; dedupeKey: string; subject: string; body: string; decisionId?: string; batchId?: string; queuedBy: string | null };
/** Queues one email (or nothing when the same purpose was already queued for this application). */
async function enqueue(db: DB, q: Q) {
  if (!EMAIL.test(q.sub.applicantEmail)) return null;
  const vars = varsOf(q.sub, q.call);
  const [m] = await db.insert(applyMessages).values({ callId: q.call.id, submissionId: q.sub.id, decisionId: q.decisionId ?? null, batchId: q.batchId ?? null, kind: q.kind, dedupeKey: q.dedupeKey,
    toEmail: q.sub.applicantEmail, lang: q.sub.lang, subject: render(q.subject, vars, true), body: render(q.body, vars), queuedBy: q.queuedBy }).onConflictDoNothing().returning();
  return m ?? null;
}
const pickLang = (vs: Record<Lang, MessageVariant>, lang: string) => vs[(lang as Lang)] ?? vs.en;

/** Called inside the submit transaction when the call sends receipts. */
export async function queueReceipt(db: DB, call: Call, sub: Sub) {
  if (!call.receiptEnabled) return null;
  const t = await effective(db, call.id, 'receipt');
  const v = pickLang(t.variants, sub.lang);
  return enqueue(db, { call, sub, kind: 'receipt', dedupeKey: `receipt:${sub.id}`, subject: v.subject, body: v.body, queuedBy: null });
}

export async function setReceipt(db: DB, me: Me, callId: string, raw: unknown) {
  const b = z.object({ enabled: z.boolean() }).strict().safeParse(raw);
  if (!b.success || !uuid.safeParse(callId).success) throw new AppError(422, 'Say whether to send receipts.');
  const [c] = await db.update(applyCalls).set({ receiptEnabled: b.data.enabled }).where(eq(applyCalls.id, callId)).returning();
  if (!c) throw new AppError(404, 'Call not found.');
  await audit(db, me, 'apply.receipts', { type: 'apply_call', id: callId }, `Receipt emails ${b.data.enabled ? 'on' : 'off'} for ${c.reference}`);
  return { enabled: c.receiptEnabled };
}

/** Decision emails for APPROVED decisions that were not sent yet, one per applicant, after a confirmed count. */
export async function queueDecisionNotices(db: DB, me: Me, raw: unknown) {
  const b = z.object({ callId: z.string().uuid(), decisionIds: z.array(z.string().uuid()).min(1).max(1000), confirm: z.number().int() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Choose the decisions to send.');
  const ids = [...new Set(b.data.decisionIds)];
  if (b.data.confirm !== ids.length) throw new AppError(422, `Confirm the number of emails (${ids.length}).`);
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const [call] = await t2.select().from(applyCalls).where(eq(applyCalls.id, b.data.callId));
    if (!call) throw new AppError(404, 'Call not found.');
    const ds = await t2.select().from(applyDecisions).where(and(inArray(applyDecisions.id, ids), eq(applyDecisions.callId, call.id)));
    if (ds.length !== ids.length) throw new AppError(404, 'Some decisions do not belong to this call.');
    if (ds.some((d) => d.status !== 'approved')) throw new AppError(409, 'Only approved decisions can be sent to applicants.');
    const already = await t2.select({ d: applyMessages.decisionId }).from(applyMessages).where(and(inArray(applyMessages.decisionId, ids), sql`${applyMessages.status} <> 'cancelled'`));
    const todo = ds.filter((d) => !d.notifiedAt && !already.some((a) => a.d === d.id));
    if (!todo.length) throw new AppError(409, 'These decisions were already sent or are already in the outbox.');
    const subs = await t2.select().from(applySubmissions).where(inArray(applySubmissions.id, todo.map((d) => d.submissionId)));
    const binned = subs.filter((s) => s.deletedAt);
    if (binned.length) throw new AppError(409, `In the bin: ${binned.map((s) => s.reference).join(', ')}. Restore first.`);
    const [batch] = await t2.insert(applyMessageBatches).values({ callId: call.id, kind: 'decision', count: todo.length, queuedBy: me.id }).returning();
    let queued = 0, noEmail = 0;
    for (const d of todo) {
      const s = subs.find((x) => x.id === d.submissionId)!;
      const t = await effective(t2, call.id, `decision_${d.outcome}` as Key);
      const v = pickLang(t.variants, s.lang);
      const m = await enqueue(t2, { call, sub: s, kind: 'decision', dedupeKey: `decision:${d.id}`, subject: v.subject, body: v.body, decisionId: d.id, batchId: batch.id, queuedBy: me.id });
      if (m) queued++; else noEmail++;
    }
    await t2.update(applyMessageBatches).set({ count: queued }).where(eq(applyMessageBatches.id, batch.id));
    await audit(tx, me, 'apply.messages.decisions', { type: 'apply_call', id: call.id }, `Queued ${queued} decision email(s) for ${call.reference}`, { batch: batch.id, skippedNoEmail: noEmail, alreadySent: ds.length - todo.length });
    return { queued, skippedAlreadySent: ds.length - todo.length, skippedNoEmail: noEmail };
  });
}

/** A message written by staff to chosen applications of one call: one email per applicant, after a confirmed count. */
export async function queueCustom(db: DB, me: Me, raw: unknown) {
  const b = z.object({ callId: z.string().uuid(), submissionIds: z.array(z.string().uuid()).min(1).max(2000), subject: variantSchema.shape.subject, body: variantSchema.shape.body, confirm: z.number().int() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Write the subject and the message.');
  const bad = [...unknownVariables(b.data.subject), ...unknownVariables(b.data.body)];
  if (bad.length) throw new AppError(422, `Unknown variable: ${[...new Set(bad)].map((x) => `{{${x}}}`).join(', ')}.`);
  const ids = [...new Set(b.data.submissionIds)];
  if (b.data.confirm !== ids.length) throw new AppError(422, `Confirm the number of applicants (${ids.length}).`);
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const [call] = await t2.select().from(applyCalls).where(eq(applyCalls.id, b.data.callId));
    if (!call) throw new AppError(404, 'Call not found.');
    const subs = await t2.select().from(applySubmissions).where(and(inArray(applySubmissions.id, ids), eq(applySubmissions.callId, call.id)));
    if (subs.length !== ids.length) throw new AppError(404, 'Some applications do not belong to this call.');
    const binned = subs.filter((s) => s.deletedAt);
    if (binned.length) throw new AppError(409, `In the bin: ${binned.map((s) => s.reference).join(', ')}. Restore first.`);
    const [batch] = await t2.insert(applyMessageBatches).values({ callId: call.id, kind: 'custom', count: ids.length, subject: b.data.subject, queuedBy: me.id }).returning();
    let queued = 0;
    for (const s of subs) if (await enqueue(t2, { call, sub: s, kind: 'custom', dedupeKey: `custom:${batch.id}:${s.id}`, subject: b.data.subject, body: b.data.body, batchId: batch.id, queuedBy: me.id })) queued++;
    await t2.update(applyMessageBatches).set({ count: queued }).where(eq(applyMessageBatches.id, batch.id));
    await audit(tx, me, 'apply.messages.custom', { type: 'apply_call', id: call.id }, `Queued ${queued} message(s) for ${call.reference}`, { batch: batch.id, skippedNoEmail: subs.length - queued });
    return { queued, skippedNoEmail: subs.length - queued };
  });
}

/** What an email will look like for one application (nothing is queued). */
export async function preview(db: DB, raw: unknown) {
  const b = z.object({ submissionId: z.string().uuid(), key: z.enum(KEYS).optional(), subject: z.string().max(200).optional(), body: z.string().max(10000).optional() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Choose an application.');
  const [s] = await db.select().from(applySubmissions).where(eq(applySubmissions.id, b.data.submissionId));
  if (!s) throw new AppError(404, 'Application not found.');
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, s.callId));
  const v = b.data.key ? pickLang((await effective(db, c.id, b.data.key)).variants, s.lang) : { subject: b.data.subject ?? '', body: b.data.body ?? '' };
  const vars = varsOf(s, c);
  return { to: s.applicantEmail, lang: s.lang, subject: render(v.subject, vars, true), body: render(v.body, vars) };
}

// ---------------------------------------------------------------- Sending (the queue worker)
const BACKOFF_MIN = [1, 5, 25, 60, 180];
const MAX_ATTEMPTS = 5;

/** Sends due messages, a few at a time. Does nothing while email sending is not set up (messages wait, visibly). */
export async function processQueue(db: DB, cfg: Config, now = new Date(), limit = 20) {
  if (!mailSettings(cfg).ready) return { sent: 0, failed: 0, waiting: true };
  await db.update(applyMessages).set({ status: 'queued', updatedAt: now }).where(and(eq(applyMessages.status, 'sending'), lte(applyMessages.updatedAt, new Date(now.getTime() - 10 * 60_000))));
  const due = await db.select().from(applyMessages).where(and(eq(applyMessages.status, 'queued'), lte(applyMessages.nextAttemptAt, now))).orderBy(applyMessages.nextAttemptAt).limit(limit);
  let sent = 0, failed = 0;
  for (const m of due) {
    const [claimed] = await db.update(applyMessages).set({ status: 'sending', attempts: m.attempts + 1, updatedAt: now }).where(and(eq(applyMessages.id, m.id), eq(applyMessages.status, 'queued'))).returning();
    if (!claimed) continue;
    try {
      const msg = await compose(db, { subject: m.subject, body: m.body });
      const r = await deliver(cfg, { to: m.toEmail, subject: m.subject, ...msg });
      const at = new Date();
      await db.update(applyMessages).set({ status: 'sent', sentAt: at, providerMessageId: r.messageId.slice(0, 300), lastError: null, updatedAt: at }).where(eq(applyMessages.id, m.id));
      if (m.decisionId) await db.update(applyDecisions).set({ notifiedAt: at }).where(and(eq(applyDecisions.id, m.decisionId), isNull(applyDecisions.notifiedAt)));
      await db.insert(applySubmissionEvents).values({ submissionId: m.submissionId, actorId: m.queuedBy, kind: 'email', toValue: m.kind, body: m.subject, meta: { message: m.id } });
      sent++;
    } catch (e) {
      const err = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 400);
      const last = claimed.attempts >= MAX_ATTEMPTS;
      await db.update(applyMessages).set({ status: last ? 'failed' : 'queued', lastError: err, nextAttemptAt: new Date(Date.now() + BACKOFF_MIN[Math.min(claimed.attempts - 1, BACKOFF_MIN.length - 1)] * 60_000), updatedAt: new Date() }).where(eq(applyMessages.id, m.id));
      if (last) failed++;
    }
  }
  return { sent, failed, waiting: false };
}

export async function retry(db: DB, me: Me, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError(404, 'Message not found.');
  const [m] = await db.update(applyMessages).set({ status: 'queued', attempts: 0, nextAttemptAt: new Date(), updatedAt: new Date() }).where(and(eq(applyMessages.id, id), eq(applyMessages.status, 'failed'))).returning();
  if (!m) throw new AppError(409, 'Only a failed message can be retried.');
  await audit(db, me, 'apply.messages.retry', { type: 'apply_submission', id: m.submissionId }, 'Retried a failed email');
  return { ok: true };
}
export async function cancel(db: DB, me: Me, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError(404, 'Message not found.');
  const [m] = await db.update(applyMessages).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(applyMessages.id, id), or(eq(applyMessages.status, 'queued'), eq(applyMessages.status, 'failed')))).returning();
  if (!m) throw new AppError(409, 'Only a queued or failed message can be cancelled.');
  await audit(db, me, 'apply.messages.cancel', { type: 'apply_submission', id: m.submissionId }, 'Cancelled an email');
  return { ok: true };
}

export async function listMessages(db: DB, q: { call?: string; status?: string; submission?: string }) {
  const w = [q.call && uuid.safeParse(q.call).success ? eq(applyMessages.callId, q.call) : undefined, q.status ? eq(applyMessages.status, q.status) : undefined,
    q.submission && uuid.safeParse(q.submission).success ? eq(applyMessages.submissionId, q.submission) : undefined].filter(Boolean);
  return db.select({ id: applyMessages.id, kind: applyMessages.kind, toEmail: applyMessages.toEmail, subject: applyMessages.subject, status: applyMessages.status, attempts: applyMessages.attempts,
    lastError: applyMessages.lastError, sentAt: applyMessages.sentAt, createdAt: applyMessages.createdAt, nextAttemptAt: applyMessages.nextAttemptAt, reference: applySubmissions.reference, submissionId: applyMessages.submissionId, decisionId: applyMessages.decisionId })
    .from(applyMessages).innerJoin(applySubmissions, eq(applySubmissions.id, applyMessages.submissionId)).where(w.length ? and(...(w as never[])) : undefined).orderBy(desc(applyMessages.createdAt)).limit(500);
}

export async function messageBody(db: DB, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError(404, 'Message not found.');
  const [m] = await db.select().from(applyMessages).where(eq(applyMessages.id, id));
  if (!m) throw new AppError(404, 'Message not found.');
  return { id: m.id, to: m.toEmail, subject: m.subject, body: m.body, status: m.status, lastError: m.lastError, sentAt: m.sentAt };
}

/** For the dashboard: emails waiting, failed, and whether sending is set up. */
export async function outboxSummary(db: DB, cfg: Config) {
  const rows = await db.select({ s: applyMessages.status, n: sql<number>`count(*)::int` }).from(applyMessages).groupBy(applyMessages.status);
  const by = Object.fromEntries(rows.map((r) => [r.s, r.n]));
  return { queued: (by.queued ?? 0) + (by.sending ?? 0), failed: by.failed ?? 0, sent: by.sent ?? 0, ready: mailSettings(cfg).ready };
}
