// Forms: receives the public site's contact and newsletter submissions (the staff side is modules/inbox).
// Submissions are personal data: only administrators (forms.read / forms.manage) can see them, they are deleted
// after the retention period, IP addresses are never stored (only a salted hash, for rate limiting).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, count, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { formSettings, formSubmissions, newsletterSubscribers } from '../../db/schema.ts';
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
  return s ?? { key, enabled: true, retentionDays: 365, closedRetentionMonths: null as number | null, updatedBy: null, updatedAt: null };
}

// Rate: more than SOFT sends from one address in the window are kept but flagged as spam (a person can still reach us
// from a shared connection, and staff can un-flag them); above HARD the intake refuses, so a flood cannot fill the disk.
const LIMIT = { window: 10 * 60_000, soft: 5, hard: 20 };

/** Public intake. Spam (honeypot, a form sent faster than a person can, or too many sends from one address) is
 *  accepted silently and kept apart in the Inbox's Spam folder, never dropped. */
export async function receive(db: DB, cfg: Config, key: FormKey, raw: unknown, ip: string | null) {
  const s = await settingsOf(db, key);
  if (!s.enabled) throw new AppError(503, 'This form is not accepting messages right now. Please email contact@afcdteam.com.');
  const parsed = (key === 'contact' ? contactSchema : newsletterSchema).safeParse(raw);
  if (!parsed.success) throw new AppError(422, 'Some fields need attention.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const d = parsed.data as z.infer<typeof contactSchema> & z.infer<typeof newsletterSchema>;
  const ipHash = hashIp(ip, ipSalt(cfg));
  let recent = 0;
  if (ipHash) {
    [{ n: recent }] = await db.select({ n: count() }).from(formSubmissions).where(and(eq(formSubmissions.ipHash, ipHash), eq(formSubmissions.formKey, key), gte(formSubmissions.createdAt, new Date(Date.now() - LIMIT.window))));
    if (recent >= LIMIT.hard) throw new AppError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
  const spamReason = d.website ? 'honeypot' : typeof d.t === 'number' && d.t < 2500 ? 'too_fast' : recent >= LIMIT.soft ? 'rate_limit' : null;
  const spam = !!spamReason;
  const email = d.email.toLowerCase();
  const page = d.page.replace(/[^\w\-./#?=&]/g, '').slice(0, 200);
  if (key === 'contact') {
    await db.insert(formSubmissions).values({ formKey: key, topic: d.topic, name: d.name, email, data: { phone: d.phone, org: d.org, message: d.message }, status: 'new', spam, spamReason, consentAt: new Date(), ipHash, page: page || 'contact.html' });
  } else {
    // a sign-up is a list change, not a message to answer: stored closed and read, for rate limiting and the record
    const now = new Date();
    await db.insert(formSubmissions).values({ formKey: key, email, status: 'closed', closedAt: now, readAt: now, spam, spamReason, consentAt: now, ipHash, page });
    if (!spam) {
      await db.insert(newsletterSubscribers).values({ email, source: page, consentAt: now })
        .onConflictDoUpdate({ target: newsletterSubscribers.email, set: { status: 'subscribed', unsubscribedAt: null, consentAt: now, updatedAt: now } });
    }
  }
  return { ok: true, message: FORMS[key].success };
}

// ---------------------------------------------------------------- Settings, CSV, retention (the Inbox module uses these)
const settingsSchema = z.object({ enabled: z.boolean(), retentionDays: z.number().int().min(30).max(1825), closedRetentionMonths: z.number().int().min(1).max(60).nullable().optional() }).strict();
export async function saveSettings(db: DB, actor: NonNullable<Actor>, key: FormKey, raw: unknown) {
  const r = settingsSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Keep messages between 30 days and 5 years, and closed messages between 1 and 60 months.');
  const v = { enabled: r.data.enabled, retentionDays: r.data.retentionDays, closedRetentionMonths: r.data.closedRetentionMonths ?? null };
  await db.insert(formSettings).values({ key, ...v, updatedBy: actor.id }).onConflictDoUpdate({ target: formSettings.key, set: { ...v, updatedBy: actor.id, updatedAt: new Date() } });
  await audit(db, actor, 'forms.settings', { type: 'form', id: key }, `${FORMS[key].label}: ${v.enabled ? 'accepting' : 'paused'}, keep ${v.retentionDays} days${v.closedRetentionMonths ? `, closed ones ${v.closedRetentionMonths} months` : ''}`);
}

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // prevent formula injection when opened in a spreadsheet
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Deletes submissions older than each form's retention period, closed messages past the closed-message setting, and
 *  spam after 30 days. Called by the scheduler. */
export async function purgeExpired(db: DB, now = new Date()) {
  let removed = 0;
  for (const k of Object.keys(FORMS) as FormKey[]) {
    const s = await settingsOf(db, k);
    const r = await db.delete(formSubmissions).where(and(eq(formSubmissions.formKey, k), lt(formSubmissions.createdAt, new Date(now.getTime() - s.retentionDays * 864e5)))).returning({ id: formSubmissions.id });
    removed += r.length;
    if (s.closedRetentionMonths && k === 'contact') {
      const cut = new Date(now); cut.setMonth(cut.getMonth() - s.closedRetentionMonths);
      const c = await db.delete(formSubmissions).where(and(eq(formSubmissions.formKey, k), eq(formSubmissions.status, 'closed'), lt(formSubmissions.closedAt, cut))).returning({ id: formSubmissions.id });
      removed += c.length;
    }
  }
  const sp = await db.delete(formSubmissions).where(and(eq(formSubmissions.spam, true), lt(formSubmissions.createdAt, new Date(now.getTime() - 30 * 864e5)))).returning({ id: formSubmissions.id });
  removed += sp.length;
  if (removed) await audit(db, null, 'forms.purge', { type: 'form' }, `Deleted ${removed} message(s) past their retention period`);
  return removed;
}
