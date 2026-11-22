// Shared HTTP plumbing: typed context, security headers, session loading, CSRF and permission guards.
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { DB } from './db/client.ts';
import type { Config } from './config.ts';
import { SESSION_COOKIE, validateSession } from './auth/session.ts';
import { can, type Permission, type Role } from './rbac.ts';
import type { Publisher } from './modules/publish/service.ts';

export type SessionUser = { id: string; email: string; name: string; role: Role };
export type Env = {
  Variables: {
    db: DB; cfg: Config; publisher: Publisher;
    user: SessionUser | null; sessionId: string | null; csrf: string | null;
  };
};

export const clientIp = (c: Context) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress || null;

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  if (!c.res.headers.has('Content-Security-Policy')) {
    c.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; script-src 'self'; frame-src 'self'; frame-ancestors 'self'; " +
      "form-action 'self'; base-uri 'self'; object-src 'none'");
  }
};

/** Loads the session (if any) for every request. */
export const loadSession: MiddlewareHandler<Env> = async (c, next) => {
  const s = await validateSession(c.var.db, getCookie(c, SESSION_COOKIE));
  c.set('user', s ? { id: s.user.id, email: s.user.email, name: s.user.name, role: s.user.role as Role } : null);
  c.set('sessionId', s?.sessionId ?? null);
  c.set('csrf', s?.csrf ?? null);
  await next();
};

/** Blocks cross-site writes: Origin must match the Studio origin and the X-CSRF-Token header must match the session. */
export const csrfGuard: MiddlewareHandler<Env> = async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const origin = c.req.header('origin');
  if (origin && origin !== c.var.cfg.origin) throw new HTTPException(403, { message: 'Cross-origin request blocked.' });
  if (c.var.sessionId) {
    if (c.req.header('x-csrf-token') !== c.var.csrf) throw new HTTPException(403, { message: 'Invalid or missing CSRF token.' });
  }
  await next();
};

export function requireUser(c: Context<Env>): SessionUser {
  const u = c.var.user;
  if (!u) throw new HTTPException(401, { message: 'Please sign in.' });
  return u;
}

export function requirePerm(c: Context<Env>, perm: Permission): SessionUser {
  const u = requireUser(c);
  if (!can(u.role, perm)) throw new HTTPException(403, { message: `Your role cannot do this (${perm}).` });
  return u;
}

export const perm = (p: Permission): MiddlewareHandler<Env> => async (c, next) => { requirePerm(c, p); await next(); };

export class AppError extends Error {
  constructor(public status: 400 | 404 | 409 | 422 | 429 | 503, message: string, public details?: unknown) { super(message); }
}
