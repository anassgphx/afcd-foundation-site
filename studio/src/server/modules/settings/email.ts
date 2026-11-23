// Settings Center → Email & SMTP. The settings and the transport are the Inbox's (modules/inbox/mail.ts): one email
// server for the whole of Studio, the password encrypted at rest and never sent to the browser. This module adds a history
// of the non-secret values, a rate-limited test email that reports the server's own answer, and real connection checks.
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { auditLog } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import * as MAIL from '../inbox/mail.ts';
import { addRevision, changedKeys, revision } from './service.ts';

type Me = NonNullable<Actor>;
export const TEST_LIMIT_PER_HOUR = 5;
export const TEST_MIN_GAP_MS = 30_000;
const NON_SECRET = ['enabled', 'host', 'port', 'security', 'user', 'fromName', 'fromEmail', 'replyTo'] as const;

/** What a revision keeps: the non-secret values and whether a password was saved. Never the password or its ciphertext. */
const snapshot = (s: ReturnType<typeof MAIL.mailSettings>) => ({ ...Object.fromEntries(NON_SECRET.map((k) => [k, s[k]])), passwordSet: s.hasPassword });

export function view(cfg: Config) {
  const s = MAIL.mailSettings(cfg);
  return { ...s, passwordState: MAIL.passwordState(cfg) };
}

export async function save(db: DB, cfg: Config, me: Me, raw: unknown, restoredFrom?: string) {
  const before = snapshot(MAIL.mailSettings(cfg));
  const passwordChanged = !!raw && typeof raw === 'object' && 'password' in raw && (raw as { password?: unknown }).password !== undefined;
  await MAIL.saveMailSettings(db, cfg, me, raw);   // validates, encrypts the password, audits 'inbox.mail_settings'
  const after = snapshot(MAIL.mailSettings(cfg));
  const changed = changedKeys(before, after).filter((k) => k !== 'passwordSet');
  if (passwordChanged) changed.push('password');
  if (changed.length || restoredFrom) {
    await addRevision(db, me, 'email', after, changed, restoredFrom);
    await audit(db, me, restoredFrom ? 'settings.restore' : 'settings.update', { type: 'settings', id: 'email' },
      `${restoredFrom ? 'Restored' : 'Changed'} email settings${changed.length ? `: ${changed.join(', ')}` : ''}`, { changed, restoredFrom: restoredFrom ?? null });
  }
  return view(cfg);
}

/** Restores the non-secret email values of a revision. The saved password is kept as it is (revisions never hold one). */
export async function restore(db: DB, cfg: Config, me: Me, id: string) {
  const r = await revision(db, id);
  if (r.category !== 'email') throw new AppError(409, 'This revision is not an email revision.');
  const v = r.values as Record<string, unknown>;
  const body = Object.fromEntries(NON_SECRET.map((k) => [k, v[k]]));
  if (v.enabled && v.passwordSet && !MAIL.mailSettings(cfg).hasPassword) throw new AppError(409, 'This revision used a password that is no longer saved. Enter the password, then switch sending on.');
  return save(db, cfg, me, body, r.id);
}

// ---------------------------------------------------------------- Test email
export async function lastTests(db: DB, limit = 5) {
  return db.select({ at: auditLog.at, action: auditLog.action, actorEmail: auditLog.actorEmail, summary: auditLog.summary, meta: auditLog.meta })
    .from(auditLog).where(inArray(auditLog.action, ['settings.email_test', 'settings.email_test_failed', 'inbox.mail_test'])).orderBy(desc(auditLog.at)).limit(limit);
}

/** Sends a real test email to the signed-in user and returns what the server said. Failures are reported, not thrown. */
export async function sendTest(db: DB, cfg: Config, me: Me) {
  const since = new Date(Date.now() - 3600_000);
  const mine = and(eq(auditLog.actorId, me.id), inArray(auditLog.action, ['settings.email_test', 'settings.email_test_failed']));
  const [{ n }] = await db.select({ n: count() }).from(auditLog).where(and(mine, gte(auditLog.at, since)));
  if (n >= TEST_LIMIT_PER_HOUR) throw new AppError(429, `You’ve sent ${TEST_LIMIT_PER_HOUR} test emails in the last hour. Try again later.`);
  const [last] = await db.select({ at: auditLog.at }).from(auditLog).where(mine).orderBy(desc(auditLog.at)).limit(1);
  if (last && Date.now() - last.at.getTime() < TEST_MIN_GAP_MS) throw new AppError(429, 'Wait 30 seconds between test emails.');

  const s = MAIL.mailSettings(cfg);
  if (!s.ready) {
    const reason = !s.enabled ? 'Sending is switched off.' : 'The server, the sender address or the password is missing.';
    await audit(db, me, 'settings.email_test_failed', { type: 'settings', id: 'email' }, `Test email not sent: ${reason}`, { stage: 'settings' });
    return { ok: false as const, stage: 'settings', message: reason, to: me.email };
  }
  try {
    const r = await MAIL.deliver(cfg, {
      to: me.email, subject: 'AFCD Studio: test email',
      text: `This is a test email from AFCD Studio (Settings → Email & SMTP).\n\nIf you can read it, Studio can send email through ${s.host}:${s.port}.\n\nRequested by ${me.email} at ${new Date().toISOString()}.`,
    });
    const response = (r.response ?? '').slice(0, 300);
    await audit(db, me, 'settings.email_test', { type: 'settings', id: 'email' }, `Test email accepted by ${s.host}`, { to: me.email, host: s.host, port: s.port, response, messageId: r.messageId });
    return { ok: true as const, to: me.email, host: s.host, port: s.port, messageId: r.messageId, response };
  } catch (e) {
    // deliver() already removes the password from the server's message
    const message = (e as Error).message.replace(/^The email server refused or could not be reached: /, '').slice(0, 300);
    await audit(db, me, 'settings.email_test_failed', { type: 'settings', id: 'email' }, `Test email failed: ${message}`, { stage: 'server', host: s.host, port: s.port, message });
    return { ok: false as const, stage: 'server', message, to: me.email, host: s.host, port: s.port };
  }
}

// ---------------------------------------------------------------- Diagnostics (real checks only)
export type Probe = { dns: (host: string) => Promise<string[]>; tcp: (host: string, port: number, ms: number) => Promise<number> };
const realProbe: Probe = {
  dns: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  tcp: (host, port, ms) => new Promise((ok, fail) => {
    const t0 = Date.now(); const sock = connect({ host, port });
    const done = (err?: Error) => { sock.destroy(); if (err) fail(err); else ok(Date.now() - t0); };
    sock.setTimeout(ms, () => done(new Error(`no answer within ${ms / 1000} s`)));
    sock.once('connect', () => done()); sock.once('error', (e) => done(e));
  }),
};
let probe: Probe = realProbe;
/** Tests replace DNS and TCP with fakes. */
export const setProbe = (p: Probe | null) => { probe = p ?? realProbe; };

export async function diagnose(cfg: Config) {
  const s = MAIL.mailSettings(cfg);
  const checks: { id: string; label: string; ok: boolean | null; detail: string }[] = [];
  checks.push({ id: 'complete', label: 'Settings complete', ok: s.host && s.fromEmail ? true : false, detail: s.host && s.fromEmail ? 'Server and sender address are filled in.' : 'Fill in the server and the sender address.' });
  checks.push({ id: 'enabled', label: 'Sending switched on', ok: s.enabled, detail: s.enabled ? 'Studio may send email.' : 'Sending is off: Inbox replies and test emails are not sent.' });
  const pw = MAIL.passwordState(cfg);
  checks.push({ id: 'password', label: 'Saved password readable', ok: pw === 'none' ? (s.user ? false : null) : pw === 'readable',
    detail: pw === 'readable' ? `Encrypted with the key from ${s.keySource === 'env' ? 'STUDIO_ENCRYPTION_KEY' : 'the data folder'}.` : pw === 'unreadable' ? 'The encryption key changed. Enter the password again.' : s.user ? 'A username is set but no password is saved.' : 'No password (the server needs no login).' });
  if (!s.host) return { checks, checkedAt: new Date().toISOString() };
  let addrs: string[] = [];
  try { addrs = await probe.dns(s.host); checks.push({ id: 'dns', label: 'Server name resolves', ok: true, detail: `${s.host} → ${addrs.slice(0, 3).join(', ')}` }); }
  catch (e) { checks.push({ id: 'dns', label: 'Server name resolves', ok: false, detail: `${s.host}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}` }); }
  if (addrs.length) {
    try { const ms = await probe.tcp(s.host, s.port, 6000); checks.push({ id: 'tcp', label: 'Server accepts connections', ok: true, detail: `Port ${s.port} answered in ${ms} ms. This does not test the login; send a test email for that.` }); }
    catch (e) { checks.push({ id: 'tcp', label: 'Server accepts connections', ok: false, detail: `Port ${s.port}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}` }); }
  }
  return { checks, checkedAt: new Date().toISOString() };
}
