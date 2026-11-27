// Studio accounts: "Forgot password" by email, changing your own password, and administrators setting a password or
// sending a password link. Links carry a random token; only its SHA-256 is stored, it works once and expires.
// A request never reveals whether an address has an account: the answer and the timing are the same either way.
import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { passwordResets, sessions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../../auth/session.ts';
import { deliver, mailSettings } from '../inbox/mail.ts';
import { compose } from '../settings/email-layout.ts';

type Me = NonNullable<Actor>;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const FORGOT_MINUTES = 30, ADMIN_HOURS = 72;
const LIMIT_EMAIL = 3, LIMIT_IP = 10;   // requests per hour

export const mailReady = (cfg: Config) => mailSettings(cfg).ready;
const linkFor = (cfg: Config, token: string) => `${cfg.origin.replace(/\/$/, '')}/studio/?reset=${encodeURIComponent(token)}`;

async function sendLink(db: DB, cfg: Config, u: { email: string; name: string }, token: string, kind: 'forgot' | 'admin') {
  const url = linkFor(cfg, token);
  const first = u.name.split(/\s+/)[0] || u.name;
  const body = kind === 'forgot'
    ? `Hello ${first},\n\nSomeone asked to reset the password of your AFCD Studio account. If it was you, choose a new password with the link below. It works once, for ${FORGOT_MINUTES} minutes.\n\n${url}\n\nIf you did not ask, you can ignore this email: your password stays the same.`
    : `Hello ${first},\n\nAn administrator asked AFCD Studio to send you a link to choose your password. It works once, for ${ADMIN_HOURS / 24} days.\n\n${url}\n\nIf you were not expecting this, tell your administrator.`;
  const subject = kind === 'forgot' ? 'Reset your AFCD Studio password' : 'Choose your AFCD Studio password';
  const m = await compose(db, { subject, heading: subject, body, button: { label: 'Choose a new password', url } });
  await deliver(cfg, { to: u.email, subject, text: m.text, html: m.html });
}

/** Forgot password. Always answers the same way; sends a link only to an active account, at most 3 per hour per address. */
export async function requestReset(db: DB, cfg: Config, raw: unknown, ip: string | null) {
  const b = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).safeParse(raw);
  if (!b.success) throw new AppError(422, 'Enter the email address of your account.');
  const email = b.data.email;
  const hourAgo = new Date(Date.now() - 3600_000);
  const [byEmail] = await db.select({ n: count() }).from(passwordResets).where(and(eq(passwordResets.email, email), gte(passwordResets.createdAt, hourAgo)));
  const [byIp] = ip ? await db.select({ n: count() }).from(passwordResets).where(and(eq(passwordResets.ip, ip), gte(passwordResets.createdAt, hourAgo))) : [{ n: 0 }];
  if (byEmail.n >= LIMIT_EMAIL || byIp.n >= LIMIT_IP) return { ok: true };
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const expiresAt = new Date(Date.now() + FORGOT_MINUTES * 60_000);
  if (!u || !u.active) {
    await db.insert(passwordResets).values({ email, ip, expiresAt });
    return { ok: true };
  }
  const token = randomBytes(32).toString('base64url');
  await db.insert(passwordResets).values({ userId: u.id, email, tokenHash: sha256(token), kind: 'forgot', ip, expiresAt });
  await audit(db, null, 'auth.reset_requested', { type: 'user', id: u.id }, email, { mail: mailReady(cfg) }, ip);
  // sent in the background, so the answer takes the same time whether or not the account exists
  if (mailReady(cfg)) void sendLink(db, cfg, u, token, 'forgot').catch((e) => audit(db, null, 'auth.reset_mail_failed', { type: 'user', id: u.id }, String((e as Error).message ?? e).slice(0, 200)).catch(() => {}));
  await db.execute(sql`delete from password_resets where created_at < now() - interval '30 days'`);
  return { ok: true };
}

/** Is this link still usable? (The sign-in page asks before showing the new-password form.) */
export async function checkToken(db: DB, token: string) {
  const r = await usable(db, token);
  return r ? { ok: true, email: r.email } : { ok: false };
}
async function usable(db: DB, token: string) {
  if (!token || token.length > 200) return null;
  const [r] = await db.select().from(passwordResets).where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gte(passwordResets.expiresAt, new Date())));
  if (!r?.userId) return null;
  const [u] = await db.select().from(users).where(eq(users.id, r.userId));
  return u?.active ? { ...r, userId: u.id, email: u.email } : null;
}

/** Sets the new password from a link. The link stops working, other links of the account too, and every session ends. */
export async function completeReset(db: DB, raw: unknown, ip: string | null) {
  const b = z.object({ token: z.string().min(10).max(200), password: z.string().max(256) }).safeParse(raw);
  if (!b.success) throw new AppError(422, 'This link is not valid.');
  const weak = validatePasswordStrength(b.data.password);
  if (weak) throw new AppError(422, weak);
  const r = await usable(db, b.data.token);
  if (!r) throw new AppError(409, 'This link has expired or was already used. Ask for a new one.');
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(b.data.password), localOnlyPassword: false, updatedAt: now }).where(eq(users.id, r.userId));
    await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, r.userId), isNull(passwordResets.usedAt)));
    await tx.delete(sessions).where(eq(sessions.userId, r.userId));
    await audit(tx, null, 'auth.password_reset', { type: 'user', id: r.userId }, r.email, { via: r.kind }, ip);
  });
  return { ok: true };
}

/** Your own password: the current one is required; your other sessions end, this one stays. */
export async function changeOwn(db: DB, me: Me, sessionId: string | null, raw: unknown) {
  const b = z.object({ current: z.string().min(1).max(256), password: z.string().max(256) }).safeParse(raw);
  if (!b.success) throw new AppError(422, 'Enter your current password and a new one.');
  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u || !(await verifyPassword(u.passwordHash, b.data.current))) throw new AppError(422, 'Your current password is not right.', [{ path: 'current', message: 'Your current password is not right.' }]);
  const weak = validatePasswordStrength(b.data.password);
  if (weak) throw new AppError(422, weak, [{ path: 'password', message: weak }]);
  if (b.data.password === b.data.current) throw new AppError(422, 'Choose a password different from the current one.', [{ path: 'password', message: 'Choose a password different from the current one.' }]);
  await db.update(users).set({ passwordHash: await hashPassword(b.data.password), localOnlyPassword: false, updatedAt: new Date() }).where(eq(users.id, me.id));
  if (sessionId) await db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, sessionId)));
  await audit(db, me, 'auth.password_changed', { type: 'user', id: me.id }, me.email);
  return { ok: true };
}

async function other(db: DB, me: Me, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'User not found.');
  if (id === me.id) throw new AppError(409, 'Change your own password from your account menu.');
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new AppError(404, 'User not found.');
  return u;
}

/** An administrator sets someone's password. Their sessions end, so they sign in again with it. */
export async function adminSetPassword(db: DB, me: Me, id: string, raw: unknown) {
  const u = await other(db, me, id);
  const b = z.object({ password: z.string().max(256) }).safeParse(raw);
  if (!b.success) throw new AppError(422, 'Enter a password.');
  const weak = validatePasswordStrength(b.data.password);
  if (weak) throw new AppError(422, weak);
  await db.update(users).set({ passwordHash: await hashPassword(b.data.password), localOnlyPassword: false, updatedAt: new Date() }).where(eq(users.id, u.id));
  await db.delete(sessions).where(eq(sessions.userId, u.id));
  await audit(db, me, 'users.password_set', { type: 'user', id: u.id }, u.email);
  return { ok: true };
}

/** An administrator emails someone a link to choose their password (valid 3 days). Needs email sending to be set up. */
export async function adminSendLink(db: DB, cfg: Config, me: Me, id: string) {
  const u = await other(db, me, id);
  if (!u.active) throw new AppError(409, 'This account is deactivated. Reactivate it first.');
  if (!mailReady(cfg)) throw new AppError(409, 'Email sending isn’t set up yet (Settings → Email). Set a password for them instead.');
  const token = randomBytes(32).toString('base64url');
  await db.insert(passwordResets).values({ userId: u.id, email: u.email, tokenHash: sha256(token), kind: 'admin', expiresAt: new Date(Date.now() + ADMIN_HOURS * 3600_000) });
  await sendLink(db, cfg, u, token, 'admin');
  await audit(db, me, 'users.password_link_sent', { type: 'user', id: u.id }, u.email);
  return { ok: true, email: u.email };
}
