// Password hashing (Argon2id via @node-rs/argon2) and server-side sessions.
// Session token: 32 random bytes in an HttpOnly cookie; only its SHA-256 is stored, so a database leak cannot be replayed.
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, gte, sql, count } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { sessions, users, loginAttempts } from '../db/schema.ts';

export const SESSION_COOKIE = 'studio_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;          // 12 h, sliding
const REFRESH_WHEN_LEFT_MS = 6 * 60 * 60 * 1000;

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

/** True when Studio runs on this computer only (http://localhost, 127.0.0.1 or [::1]). */
export const isLocalOrigin = (origin: string) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return false; } };

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 256) return 'Use at most 256 characters.';
  return null;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export async function createSession(db: DB, userId: string, ip: string | null, ua: string | null) {
  const raw = token();
  const csrf = token();
  await db.insert(sessions).values({
    id: sha256(raw), userId, csrfToken: csrf, expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip, userAgent: ua?.slice(0, 300) ?? null,
  });
  return { token: raw, csrf, maxAge: SESSION_TTL_MS / 1000 };
}

export async function validateSession(db: DB, raw: string | undefined) {
  if (!raw || raw.length > 100) return null;
  const id = sha256(raw);
  const rows = await db.select({ s: sessions, u: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  const row = rows[0];
  if (!row || !row.u.active) return null;
  if (row.s.expiresAt.getTime() - Date.now() < REFRESH_WHEN_LEFT_MS) {
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) }).where(eq(sessions.id, id));
  }
  return { sessionId: id, csrf: row.s.csrfToken, user: row.u };
}

export async function deleteSession(db: DB, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Simple brute-force protection backed by the database (works across restarts and instances). */
export async function tooManyAttempts(db: DB, email: string, ip: string | null) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [byEmail] = await db.select({ n: count() }).from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gte(loginAttempts.createdAt, since)));
  const [byIp] = ip ? await db.select({ n: count() }).from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gte(loginAttempts.createdAt, since))) : [{ n: 0 }];
  return byEmail.n >= 5 || byIp.n >= 25;
}

export async function recordAttempt(db: DB, email: string, ip: string | null, success: boolean) {
  await db.insert(loginAttempts).values({ email, ip, success });
  // keep the table small
  await db.execute(sql`delete from login_attempts where created_at < now() - interval '7 days'`);
}
