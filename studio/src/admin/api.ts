// Thin API client. Every write sends the session's CSRF token; errors carry the server message and field details.
let csrf = ''; let userId = '';
/** The signed-in user's CSRF token (and who they are), from /me. */
export const setCsrf = (t: string, uid = '') => { csrf = t; userId = uid; };

export class ApiError extends Error {
  constructor(public status: number, message: string, public details: { path?: string; message: string }[] | null = null) { super(message); }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.method && init.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const res = await fetch(`/studio/api${path}`, {
    ...init, headers: { ...headers, ...(init.headers as Record<string, string>) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  // The browser's sign-in changed since this tab loaded (signed in again, or as someone else, in another tab):
  // the same person carries on with the fresh token; a different person is never acted for silently.
  if (res.status === 403 && /CSRF/i.test(data.error ?? '') && !retried) {
    const me = await fetch('/studio/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (me?.csrf && me.user?.id && (!userId || me.user.id === userId)) { setCsrf(me.csrf, me.user.id); return api<T>(path, init, true); }
    throw new ApiError(403, me?.user ? `This tab was opened as another user; you are now signed in as ${me.user.name || me.user.email} in this browser. Reload the page to continue as them.` : 'Your session ended. Reload the page and sign in again.');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details ?? null);
  return data as T;
}

export const post = <T = any>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const put = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
