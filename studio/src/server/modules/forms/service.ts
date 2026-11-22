// Forms: receives the public site's contact and newsletter submissions and gives staff an inbox.
// Submissions are personal data: only administrators (forms.read / forms.manage) can see them, they are deleted
// after the retention period, IP addresses are never stored (only a salted hash, for rate limiting).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { formSettings, formSubmissions, newsletterSubscribers, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';

export const FORMS = {
  contact: { label: 'Contact messages', site: 'contact.html', success: 'Thank you. Your message was sent to the AFCD team, and we’ll reply by email.' },
  newsletter: { label: 'Newsletter sign-ups', site: 'Footer on every page', success: 'Thank you for subscribing to AFCD’s newsletter.' },
} as const;
export type FormKey = keyof typeof FORMS;
export const isFormKey = (k: string): k is FormKey => k in FORMS;

export const TOPICS = ['General question', 'Volunteering', 'Joining a programme', 'Partnership', 'Alumni club', 'Press', 'Board & governance'] as const;

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const text = (max: number) => z.string().trim().max(max).transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));
const meta = { website: z.string().max(200).optional().default(''), t: z.number().int().nonnegative().optional(), page: z.string().max(200).optional().default('') };
const contactSchema = z.object({
  topic: z.enum(TOPICS).default('General question'),
  name: text(120).pipe(z.string().min(1, 'Add your name.')),
  email: text(160).pipe(z.string().regex(EMAIL, 'Add a valid email address.')),
  phone: text(40).optional().default(''),
  org: text(160).optional().default(''),
  message: text(1000).pipe(z.string().min(1, 'Write a message.')),
  consent: z.literal(true, { message: 'Please agree to how we use your details.' }),
  ...meta,
}).strict();
const newsletterSchema = z.object({ email: text(160).pipe(z.string().regex(EMAIL, 'Add a valid email address.')), ...meta }).strict();

/** Salt for IP hashes: env FORMS_IP_SALT, or a random value kept in the data folder. */
export function ipSalt(cfg: Config) {
  if (process.env.FORMS_IP_SALT) return process.env.FORMS_IP_SALT;
  const f = resolve(cfg.dataDir, 'forms-ip-salt');
  if (!existsSync(f)) { mkdirSync(cfg.dataDir, { recursive: true }); writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 }); }
  return readFileSync(f, 'utf8').trim();
}
const hashIp = (ip: string | null, salt: string) => (ip ? createHash('sha256').update(`${salt}:${ip}`).digest('hex') : null);

export async function settingsOf(db: DB, key: FormKey) {
  const [s] = await db.select().from(formSettings).where(eq(formSettings.key, key));
  return s ?? { key, enabled: true, retentionDays: 365, updatedBy: null, updatedAt: null };
}

const LIMIT = { window: 10 * 60_000, max: 5 };

/** Public intake. Spam (honeypot or a form sent faster than a person can) is accepted silently and kept apart. */
export async function receive(db: DB, cfg: Config, key: FormKey, raw: unknown, ip: string | null) {
  const s = await settingsOf(db, key);
  if (!s.enabled) throw new AppError(503, 'This form is not accepting messages right now. Please email contact@afcdteam.com.');
  const parsed = (key === 'contact' ? contactSchema : newsletterSchema).safeParse(raw);
  if (!parsed.success) throw new AppError(422, 'Some fields need attention.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const d = parsed.data as z.infer<typeof contactSchema> & z.infer<typeof newsletterSchema>;
  const ipHash = hashIp(ip, ipSalt(cfg));
  if (ipHash) {
    const [{ n }] = await db.select({ n: count() }).from(formSubmissions).where(and(eq(formSubmissions.ipHash, ipHash), eq(formSubmissions.formKey, key), gte(formSubmissions.createdAt, new Date(Date.now() - LIMIT.window))));
    if (n >= LIMIT.max) throw new AppError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
  const spam = !!d.website || (typeof d.t === 'number' && d.t < 2500);
  const email = d.email.toLowerCase();
  const page = d.page.replace(/[^\w\-./#?=&]/g, '').slice(0, 200);
  if (key === 'contact') {
    await db.insert(formSubmissions).values({ formKey: key, topic: d.topic, name: d.name, email, data: { phone: d.phone, org: d.org, message: d.message }, status: spam ? 'spam' : 'new', consentAt: new Date(), ipHash, page: page || 'contact.html' });
  } else {
    await db.insert(formSubmissions).values({ formKey: key, email, status: spam ? 'spam' : 'done', consentAt: new Date(), ipHash, page });
    if (!spam) {
      await db.insert(newsletterSubscribers).values({ email, source: page, consentAt: new Date() })
        .onConflictDoUpdate({ target: newsletterSubscribers.email, set: { status: 'subscribed', unsubscribedAt: null, consentAt: new Date(), updatedAt: new Date() } });
    }
  }
  return { ok: true, message: FORMS[key].success };
}

// ---------------------------------------------------------------- Staff side
export async function overview(db: DB) {
  const rows = await db.select({ key: formSubmissions.formKey, status: formSubmissions.status, n: count() }).from(formSubmissions).groupBy(formSubmissions.formKey, formSubmissions.status);
  const [{ subs }] = await db.select({ subs: count() }).from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'subscribed'));
  const forms = await Promise.all((Object.keys(FORMS) as FormKey[]).map(async (k) => ({ key: k, ...FORMS[k], settings: await settingsOf(db, k),
    counts: Object.fromEntries(rows.filter((r) => r.key === k).map((r) => [r.status, r.n])) as Record<string, number> })));
  return { forms, subscribers: subs, topics: TOPICS };
}

export async function listSubmissions(db: DB, key: FormKey, status: string | null) {
  const where = status && ['new', 'in_progress', 'done', 'spam'].includes(status)
    ? and(eq(formSubmissions.formKey, key), eq(formSubmissions.status, status as 'new'))
    : and(eq(formSubmissions.formKey, key), sql`${formSubmissions.status} <> 'spam'`);
  return db.select({ id: formSubmissions.id, topic: formSubmissions.topic, name: formSubmissions.name, email: formSubmissions.email, data: formSubmissions.data, status: formSubmissions.status, note: formSubmissions.note, assignedTo: formSubmissions.assignedTo, assigneeName: users.name, page: formSubmissions.page, createdAt: formSubmissions.createdAt, updatedAt: formSubmissions.updatedAt })
    .from(formSubmissions).leftJoin(users, eq(users.id, formSubmissions.assignedTo)).where(where).orderBy(desc(formSubmissions.createdAt)).limit(500);
}

const updateSchema = z.object({ status: z.enum(['new', 'in_progress', 'done', 'spam']).optional(), assignedTo: z.string().uuid().nullable().optional(), note: z.string().trim().max(2000).optional() }).strict();

export async function updateSubmission(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const r = updateSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Invalid change.');
  const [cur] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, id));
  if (!cur) throw new AppError(404, 'Message not found.');
  if (r.data.assignedTo && !(await db.select({ id: users.id }).from(users).where(eq(users.id, r.data.assignedTo))).length) throw new AppError(422, 'Unknown user.');
  await db.update(formSubmissions).set({ ...r.data, updatedAt: new Date() }).where(eq(formSubmissions.id, id));
  // the audit log records what changed, never the message content
  await audit(db, actor, 'forms.update', { type: 'submission', id }, `${FORMS[cur.formKey as FormKey]?.label ?? cur.formKey}: ${Object.keys(r.data).join(', ')}${r.data.status ? ` → ${r.data.status}` : ''}`);
}

export async function deleteSubmissions(db: DB, actor: NonNullable<Actor>, ids: string[]) {
  if (!ids.length || ids.length > 500) throw new AppError(422, 'Choose between 1 and 500 messages.');
  const rows = await db.delete(formSubmissions).where(inArray(formSubmissions.id, ids)).returning({ id: formSubmissions.id });
  await audit(db, actor, 'forms.delete', { type: 'submission' }, `Permanently deleted ${rows.length} message(s)`);
  return rows.length;
}

export async function listSubscribers(db: DB) {
  return db.select().from(newsletterSubscribers).orderBy(desc(newsletterSubscribers.createdAt)).limit(5000);
}

export async function setSubscriber(db: DB, actor: NonNullable<Actor>, id: string, action: 'unsubscribe' | 'delete') {
  const [cur] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id));
  if (!cur) throw new AppError(404, 'Subscriber not found.');
  if (action === 'delete') await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, id));
  else await db.update(newsletterSubscribers).set({ status: 'unsubscribed', unsubscribedAt: new Date(), updatedAt: new Date() }).where(eq(newsletterSubscribers.id, id));
  await audit(db, actor, `forms.subscriber_${action}`, { type: 'subscriber', id }, action === 'delete' ? 'Deleted a newsletter subscriber' : 'Unsubscribed a newsletter subscriber');
}

const settingsSchema = z.object({ enabled: z.boolean(), retentionDays: z.number().int().min(30).max(1825) }).strict();
export async function saveSettings(db: DB, actor: NonNullable<Actor>, key: FormKey, raw: unknown) {
  const r = settingsSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Keep messages between 30 days and 5 years.');
  await db.insert(formSettings).values({ key, ...r.data, updatedBy: actor.id }).onConflictDoUpdate({ target: formSettings.key, set: { ...r.data, updatedBy: actor.id, updatedAt: new Date() } });
  await audit(db, actor, 'forms.settings', { type: 'form', id: key }, `${FORMS[key].label}: ${r.data.enabled ? 'accepting' : 'paused'}, keep ${r.data.retentionDays} days`);
}

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // prevent formula injection when opened in a spreadsheet
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export async function exportCsv(db: DB, actor: NonNullable<Actor>, what: 'contact' | 'newsletter') {
  await audit(db, actor, 'forms.export', { type: 'form', id: what }, `Exported ${what === 'contact' ? 'contact messages' : 'newsletter subscribers'} as CSV`);
  if (what === 'newsletter') {
    const rows = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'subscribed')).orderBy(newsletterSubscribers.createdAt);
    return toCsv(['email', 'subscribed_at', 'source'], rows.map((r) => [r.email, r.consentAt.toISOString(), r.source]));
  }
  const rows = await db.select().from(formSubmissions).where(and(eq(formSubmissions.formKey, 'contact'), sql`${formSubmissions.status} <> 'spam'`)).orderBy(formSubmissions.createdAt);
  return toCsv(['received_at', 'status', 'topic', 'name', 'email', 'phone', 'organisation', 'message'], rows.map((r) => [r.createdAt.toISOString(), r.status, r.topic, r.name, r.email, r.data.phone, r.data.org, r.data.message]));
}

/** Deletes submissions older than each form's retention period (spam after 30 days). Called by the scheduler. */
export async function purgeExpired(db: DB, now = new Date()) {
  let removed = 0;
  for (const k of Object.keys(FORMS) as FormKey[]) {
    const s = await settingsOf(db, k);
    const r = await db.delete(formSubmissions).where(and(eq(formSubmissions.formKey, k), lt(formSubmissions.createdAt, new Date(now.getTime() - s.retentionDays * 864e5)))).returning({ id: formSubmissions.id });
    removed += r.length;
  }
  const sp = await db.delete(formSubmissions).where(and(eq(formSubmissions.status, 'spam'), lt(formSubmissions.createdAt, new Date(now.getTime() - 30 * 864e5)))).returning({ id: formSubmissions.id });
  removed += sp.length;
  if (removed) await audit(db, null, 'forms.purge', { type: 'form' }, `Deleted ${removed} message(s) past their retention period`);
  return removed;
}
