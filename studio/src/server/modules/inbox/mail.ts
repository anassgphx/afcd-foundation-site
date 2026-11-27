// Outgoing email for the Inbox: SMTP settings and replies to website messages.
// Settings live in <dataDir>/mail-settings.json (mode 600). The SMTP password is encrypted with AES-256-GCM using
// STUDIO_ENCRYPTION_KEY, or, when that is not set, a random key kept in <dataDir>/mail-key (mode 600). The password is
// never sent back to the browser. Sent replies are kept in the message's history; the audit log records that a reply
// was sent, never its text.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { and, count, eq, gte } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { formSubmissions, submissionEvents, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { decrypt, encrypt, keyFrom } from '../google/crypto.ts';
import { compose } from '../settings/email-layout.ts';
import { senderVars } from '../settings/templates.ts';

type Me = NonNullable<Actor>;
export type Security = 'starttls' | 'tls' | 'none';
type Stored = { enabled: boolean; host: string; port: number; security: Security; user: string; passwordBox: string | null;
  fromName: string; fromEmail: string; replyTo: string; updatedAt: string | null; updatedBy: string | null };
const EMPTY: Stored = { enabled: false, host: '', port: 587, security: 'starttls', user: '', passwordBox: null, fromName: 'AFCD Foundation', fromEmail: '', replyTo: '', updatedAt: null, updatedBy: null };
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;

const file = (cfg: Config) => resolve(cfg.dataDir, 'mail-settings.json');
function key(cfg: Config) {
  if (cfg.encryptionKey) return keyFrom(cfg.encryptionKey);
  const f = resolve(cfg.dataDir, 'mail-key');
  if (!existsSync(f)) { mkdirSync(cfg.dataDir, { recursive: true }); writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 }); }
  return keyFrom(readFileSync(f, 'utf8').trim());
}
function read(cfg: Config): Stored {
  try { return { ...EMPTY, ...JSON.parse(readFileSync(file(cfg), 'utf8')) }; } catch { return { ...EMPTY }; }
}
function write(cfg: Config, s: Stored) {
  mkdirSync(cfg.dataDir, { recursive: true });
  const tmp = `${file(cfg)}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, file(cfg));
}
const complete = (s: Stored) => !!(s.host && s.port && EMAIL.test(s.fromEmail) && (!s.user || s.passwordBox));

/** What the admin UI may see: everything except the password. `ready` = sending is switched on and fully set up. */
export function mailSettings(cfg: Config) {
  const { passwordBox, ...s } = read(cfg);
  return { ...s, hasPassword: !!passwordBox, ready: s.enabled && complete({ ...s, passwordBox }), keySource: cfg.encryptionKey ? 'env' : 'data-folder' };
}

const host = z.string().trim().max(253).regex(/^[a-z0-9.-]+$/i, 'Enter a server name such as smtp.example.org.');
const settingsSchema = z.object({
  enabled: z.boolean(),
  host: host.or(z.literal('')),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['starttls', 'tls', 'none']),
  user: z.string().trim().max(200),
  password: z.string().max(500).optional(),            // omitted = keep the saved one; '' = remove it
  fromName: z.string().trim().max(100).regex(/^[^\r\n<>"]*$/, 'The sender name can’t contain < > or quotes.'),
  fromEmail: z.string().trim().max(200).regex(EMAIL, 'Enter the sender email address.').or(z.literal('')),
  replyTo: z.string().trim().max(200).regex(EMAIL, 'Enter a valid reply-to address, or leave it empty.').or(z.literal('')),
}).strict();

export async function saveMailSettings(db: DB, cfg: Config, me: Me, raw: unknown) {
  const r = settingsSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Check the email settings.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const cur = read(cfg);
  const { password, ...rest } = r.data;
  const next: Stored = { ...cur, ...rest, passwordBox: password === undefined ? cur.passwordBox : password === '' ? null : encrypt(key(cfg), password), updatedAt: new Date().toISOString(), updatedBy: me.email };
  if (next.enabled && !complete(next)) throw new AppError(422, 'To switch sending on, fill in the server, the sender address and (with a username) the password.');
  write(cfg, next);
  await audit(db, me, 'inbox.mail_settings', { type: 'mail' }, `Email sending ${next.enabled ? 'on' : 'off'} · ${next.host || 'no server'}:${next.port}${password !== undefined ? ' · password changed' : ''}`);
  return mailSettings(cfg);
}

/** Whether the saved SMTP password can be decrypted with the current key (never returns the password). */
export function passwordState(cfg: Config): 'none' | 'readable' | 'unreadable' {
  const s = read(cfg);
  if (!s.passwordBox) return 'none';
  try { decrypt(key(cfg), s.passwordBox); return 'readable'; } catch { return 'unreadable'; }
}

// ---------------------------------------------------------------- Transport
export type SendInput = { from: string; to: string; replyTo?: string; subject: string; text: string; html?: string; inReplyTo?: string };
export type Sender = (s: Stored & { password: string }, m: SendInput) => Promise<{ messageId: string; response?: string }>;
const smtpSender: Sender = async (s, m) => {
  const t = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.security === 'tls', requireTLS: s.security === 'starttls', ignoreTLS: s.security === 'none',
    auth: s.user ? { user: s.user, pass: s.password } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  });
  try { const info = await t.sendMail(m); return { messageId: String(info.messageId ?? ''), response: String(info.response ?? '') }; } finally { t.close(); }
};
let sender: Sender = smtpSender;
/** Tests replace the SMTP connection with a recorder. */
export const setSender = (s: Sender | null) => { sender = s ?? smtpSender; };

/** Sends one message with the saved settings (used by the Inbox and by Settings → Email's test email). */
export async function deliver(cfg: Config, m: Omit<SendInput, 'from' | 'replyTo'>) {
  const s = read(cfg);
  if (!s.enabled || !complete(s)) throw new AppError(409, 'Email sending isn’t set up. An administrator can set it up in Inbox → Settings.');
  let password = '';
  if (s.passwordBox) { try { password = decrypt(key(cfg), s.passwordBox); } catch { throw new AppError(409, 'The saved SMTP password can’t be read (the encryption key changed). Enter it again in Inbox → Settings.'); } }
  const from = s.fromName ? `"${s.fromName}" <${s.fromEmail}>` : s.fromEmail;
  try {
    return { ...(await sender({ ...s, password }, { ...m, from, replyTo: s.replyTo || undefined })), from: s.fromEmail };
  } catch (e) {
    // server messages can be long or contain the address; never the password, which nodemailer does not echo
    const msg = String((e as Error)?.message ?? e).split('\n')[0].replace(password || '\u0000', '•••').slice(0, 240);
    throw new HTTPException(502, { message: `The email server refused or could not be reached: ${msg}` });
  }
}

export async function sendTest(db: DB, cfg: Config, me: Me) {
  const msg = await compose(db, { subject: 'AFCD Studio: test email', heading: 'Email sending works', body: `This is a test email from AFCD Studio's Inbox.\n\nIf you can read it, replies to website messages can be sent from Studio, in this design.\n\nSent by ${me.email} at ${new Date().toISOString()}.` });
  const r = await deliver(cfg, { to: me.email, subject: 'AFCD Studio: test email', ...msg });
  await audit(db, me, 'inbox.mail_test', { type: 'mail' }, 'Sent a test email to themselves');
  return { ok: true, to: me.email, messageId: r.messageId };
}

const replySchema = z.object({
  subject: z.string().trim().min(1, 'Add a subject.').max(200).transform((v) => v.replace(/[\r\n]+/g, ' ')),
  body: z.string().trim().min(1, 'Write your reply.').max(20_000),
  markReplied: z.boolean().optional().default(true),
  // optional parts of a template, shown by the branded layout (Settings → Email templates)
  heading: z.string().trim().max(120).optional(),
  preheader: z.string().trim().max(150).optional(),
  button: z.object({ label: z.string().trim().min(1).max(40), url: z.string().trim().max(500).regex(/^(https:\/\/|mailto:)[^\s"'<>]+$/i, 'The button link must be https:// or mailto:.') }).strict().nullable().optional(),
  details: z.object({ title: z.string().trim().max(60).optional(), rows: z.array(z.object({ label: z.string().trim().max(40), value: z.string().trim().max(160) }).strict()).max(8) }).strict().nullable().optional(),
}).strict();
const HOURLY_LIMIT = 60;

/** Sends a reply to the sender of a contact message, records it in the history and (by default) marks it Replied. */
export async function sendReply(db: DB, cfg: Config, me: Me, id: string, raw: unknown) {
  const r = replySchema.safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Check the reply.');
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'Message not found.');
  const [m] = await db.select().from(formSubmissions).where(and(eq(formSubmissions.id, id), eq(formSubmissions.formKey, 'contact')));
  if (!m) throw new AppError(404, 'Message not found.');
  if (m.spam) throw new AppError(409, 'This message is in Spam. Move it back to the inbox before replying.');
  if (!EMAIL.test(m.email)) throw new AppError(409, 'This message has no valid email address to reply to.');
  const [{ n }] = await db.select({ n: count() }).from(submissionEvents).where(and(eq(submissionEvents.actorId, me.id), eq(submissionEvents.kind, 'email_sent'), gte(submissionEvents.createdAt, new Date(Date.now() - 3600_000))));
  if (n >= HOURLY_LIMIT) throw new AppError(429, `You’ve sent ${HOURLY_LIMIT} replies in the last hour. Wait a little before sending more.`);

  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, me.id));
  const msg = await compose(db, { subject: r.data.subject, body: r.data.body, heading: r.data.heading, preheader: r.data.preheader, button: r.data.button ?? null, details: r.data.details ?? null },
    await senderVars(db, { name: u?.name ?? '' }));
  const sent = await deliver(cfg, { to: m.email, subject: r.data.subject, ...msg });
  await db.insert(submissionEvents).values({ submissionId: id, actorId: me.id, kind: 'email_sent', body: r.data.body, meta: { subject: r.data.subject, to: m.email, from: sent.from, messageId: sent.messageId } });
  const now = new Date();
  if (r.data.markReplied && m.status !== 'replied' && m.status !== 'closed') {
    await db.update(formSubmissions).set({ status: 'replied', closedAt: null, readAt: m.readAt ?? now, updatedAt: now }).where(eq(formSubmissions.id, id));
    await db.insert(submissionEvents).values({ submissionId: id, actorId: me.id, kind: 'status', meta: { from: m.status, to: 'replied' } });
  } else {
    await db.update(formSubmissions).set({ updatedAt: now }).where(eq(formSubmissions.id, id));
  }
  await audit(db, me, 'inbox.reply_sent', { type: 'submission', id }, 'Sent an email reply to a contact message');   // never the text or address
  return { ok: true };
}
