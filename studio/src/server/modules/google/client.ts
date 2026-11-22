// Google APIs used by SEO Pro, called with the official REST endpoints (no SDK needed for these few calls).
// `http` is injectable so tests can stand in for Google; production uses the global fetch.
// Docs: OAuth 2.0 for web server apps (PKCE), Search Console API v1/v3 (sites, searchAnalytics.query, urlInspection).
import type { Config } from '../../config.ts';

export type Http = typeof fetch;
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
// read-only Search Console access, plus the account email shown on the connection card
export const GSC_SCOPES = ['openid', 'email', GSC_SCOPE];

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const WM = 'https://www.googleapis.com/webmasters/v3';
const INSPECT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

/** A failed Google call. `retry` marks rate limits and server errors (worth retrying later); `reauth` means the grant is gone. */
export class GoogleError extends Error {
  constructor(public status: number, public reason: string, message: string, public retry = status === 429 || status >= 500, public reauth = false) { super(message); }
}

async function call<T>(http: Http, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try { res = await http(url, { ...init, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw new GoogleError(0, 'network', `Could not reach Google: ${(e as Error).message}`, true); }
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const reason = body?.error?.status ?? body?.error ?? `http_${res.status}`;
    const msg = body?.error_description ?? body?.error?.message ?? `Google answered ${res.status}.`;
    throw new GoogleError(res.status, String(reason), String(msg), undefined, reason === 'invalid_grant' || res.status === 401 && /invalid_grant|revoked/i.test(msg));
  }
  return body as T;
}

export function authUrl(cfg: Config, state: string, challenge: string) {
  const q = new URLSearchParams({
    client_id: cfg.googleClientId, redirect_uri: cfg.googleRedirectUri, response_type: 'code', scope: GSC_SCOPES.join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  });
  return `${AUTH}?${q}`;
}

export type TokenSet = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; token_type: string };
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

export const exchangeCode = (http: Http, cfg: Config, code: string, verifier: string) =>
  call<TokenSet>(http, TOKEN, form({ code, code_verifier: verifier, client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, redirect_uri: cfg.googleRedirectUri, grant_type: 'authorization_code' }));
export const refreshAccess = (http: Http, cfg: Config, refreshToken: string) =>
  call<TokenSet>(http, TOKEN, form({ refresh_token: refreshToken, client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, grant_type: 'refresh_token' }));
export const revoke = (http: Http, token: string) => call<unknown>(http, REVOKE, form({ token }));

/** Email from the ID token Google returned directly to us over TLS (not used for any authorization decision). */
export function idTokenEmail(idToken?: string) {
  if (!idToken) return null;
  try { const p = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')); return typeof p.email === 'string' ? p.email : null; } catch { return null; }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
export type Site = { siteUrl: string; permissionLevel: string };
export const listSites = async (http: Http, token: string) => (await call<{ siteEntry?: Site[] }>(http, `${WM}/sites`, { headers: auth(token) })).siteEntry ?? [];

export type SaRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type SaRequest = { startDate: string; endDate: string; dimensions: string[]; type?: string; rowLimit?: number; startRow?: number; dataState?: 'final' | 'all'; aggregationType?: string };
export const searchAnalytics = async (http: Http, token: string, site: string, body: SaRequest) =>
  (await call<{ rows?: SaRow[]; responseAggregationType?: string }>(http, `${WM}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) })).rows ?? [];

export type InspectResult = { inspectionResult?: { inspectionResultLink?: string; indexStatusResult?: Record<string, any> } };
export const inspectUrl = (http: Http, token: string, site: string, url: string) =>
  call<InspectResult>(http, INSPECT, { method: 'POST', headers: auth(token), body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: 'en' }) });
