// Redirect manager. The site is static (GitHub Pages), which cannot send real 301/302 responses. Each active redirect
// becomes a small page at the old address that forwards instantly (meta refresh) and names the new address as canonical;
// Studio also writes a standard _redirects file with the real status codes for hosts that support it (Cloudflare Pages,
// Netlify). Exact paths only: no wildcards, no loops, no chains, never over a real page or a protected route.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { redirects, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { can, type Role } from '../../rbac.ts';

export const STUB_MARK = '<!-- studio-redirect -->';
const PROTECTED = new Set(['index.html', '404.html', 'sitemap.xml', 'robots.txt', '_redirects']);
const SOURCE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\.html$/;
const INTERNAL = /^[a-z0-9][a-z0-9-]*\.html(#[a-z0-9-]+)?$/;
const EXTERNAL = /^https:\/\/[a-z0-9.-]+(\/[^\s"'<>]*)?$/i;

export const redirectSchema = z.object({
  source: z.string().trim().toLowerCase().max(160).transform((s) => s.replace(/^\/+/, '')).pipe(z.string().regex(SOURCE, 'Use an address like old-page.html (lower-case letters, numbers, hyphens).')),
  destination: z.string().trim().max(500).transform((s) => s.replace(/^\/+/, '')).refine((d) => INTERNAL.test(d) || EXTERNAL.test(d), 'Use a page of this site like projects.html, or a full https:// address.'),
  code: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  reason: z.string().trim().max(300).refine((v) => !/[<>]/.test(v), 'Use plain text.').default(''),
}).strict();

const isStub = (cfg: Config, file: string) => { const p = resolve(cfg.siteRoot, file); return existsSync(p) && readFileSync(p, 'utf8').includes(STUB_MARK); };
const pageExists = (cfg: Config, file: string) => existsSync(resolve(cfg.siteRoot, file)) && !isStub(cfg, file);

/** Checks one redirect against the site and the other redirects. Returns blocking errors and warnings. */
export async function checkRedirect(db: DB, cfg: Config, r: z.infer<typeof redirectSchema>, role: Role, exceptId?: string) {
  const errors: string[] = []; const warnings: string[] = [];
  const all = (await db.select().from(redirects)).filter((x) => x.id !== exceptId && x.status !== 'disabled');
  if (PROTECTED.has(r.source) || r.source.startsWith('studio') || r.source.startsWith('assets/')) errors.push('This address is protected and cannot be redirected.');
  if (pageExists(cfg, r.source) || existsSync(resolve(cfg.siteRoot, 'src/pages', r.source))) errors.push(`${r.source} is a real page on the site. Remove or rename the page first; a redirect would hide it.`);
  if (all.some((x) => x.source === r.source)) errors.push('Another redirect already uses this address.');
  const destPath = r.destination.split('#')[0];
  if (destPath === r.source) errors.push('A redirect cannot point to itself.');
  const external = EXTERNAL.test(r.destination);
  if (external && !can(role, 'seo.publish')) errors.push('Only administrators can redirect to another website.');
  if (external && /^https:\/\/(www\.)?afcdfoundation\.org\//i.test(r.destination)) warnings.push('Use the page name (e.g. projects.html) for pages of this site.');
  if (!external) {
    // follow the chain: a destination that is itself redirected makes a chain (or a loop)
    let cur = destPath; const seen = new Set([r.source]);
    for (let hops = 0; ; hops++) {
      const next = all.find((x) => x.source === cur);
      if (!next) break;
      if (seen.has(cur) || hops > 5) { errors.push('This would create a redirect loop.'); break; }
      seen.add(cur);
      if (hops === 0) warnings.push(`${cur} is itself redirected to ${next.destination}. Point straight to the final page to avoid a chain.`);
      cur = next.destination.split('#')[0];
    }
    if (!errors.length && !pageExists(cfg, cur) && !all.some((x) => x.source === cur)) errors.push(`${destPath} does not exist on the site.`);
    if (all.some((x) => x.destination.split('#')[0] === r.source)) warnings.push('Other redirects point to this address; they will now form a chain.');
  }
  return { errors, warnings };
}

export async function listRedirects(db: DB, cfg: Config) {
  const rows = await db.select({ r: redirects, by: users.name }).from(redirects).leftJoin(users, eq(users.id, redirects.updatedBy)).orderBy(asc(redirects.source));
  return rows.map(({ r, by }) => ({ ...r, updatedByName: by, live: !!r.published && isStub(cfg, r.published.source),
    pending: r.status === 'draft' ? (r.published ? 'edited' : 'new') : r.status === 'disabled' && r.published ? 'removal' : null }));
}

export async function saveRedirect(db: DB, cfg: Config, actor: NonNullable<Actor>, role: Role, raw: unknown, id?: string) {
  const p = redirectSchema.safeParse(raw);
  if (!p.success) throw new AppError(422, 'Some fields need attention.', p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const { errors, warnings } = await checkRedirect(db, cfg, p.data, role, id);
  if (errors.length) throw new AppError(422, 'This redirect cannot be saved.', errors.map((m) => ({ path: '', message: m })));
  const [row] = id
    ? await db.update(redirects).set({ ...p.data, status: 'draft', updatedBy: actor.id, updatedAt: new Date() }).where(eq(redirects.id, id)).returning()
    : await db.insert(redirects).values({ ...p.data, createdBy: actor.id, updatedBy: actor.id }).returning();
  if (!row) throw new AppError(404, 'Redirect not found.');
  await audit(db, actor, id ? 'redirect.update' : 'redirect.create', { type: 'redirect', id: row.id }, `${row.source} → ${row.destination} (${row.code})`);
  return { ...row, warnings };
}

export async function setRedirectStatus(db: DB, actor: NonNullable<Actor>, id: string, status: 'draft' | 'disabled') {
  const [row] = await db.update(redirects).set({ status, updatedBy: actor.id, updatedAt: new Date() }).where(eq(redirects.id, id)).returning();
  if (!row) throw new AppError(404, 'Redirect not found.');
  await audit(db, actor, `redirect.${status === 'disabled' ? 'disable' : 'reenable'}`, { type: 'redirect', id }, row.source);
}

export async function deleteRedirect(db: DB, actor: NonNullable<Actor>, id: string) {
  const [row] = await db.select().from(redirects).where(eq(redirects.id, id));
  if (!row) throw new AppError(404, 'Redirect not found.');
  if (row.published) throw new AppError(409, 'This redirect is on the live site. Disable it and publish before deleting it.');
  await db.delete(redirects).where(eq(redirects.id, id));
  await audit(db, actor, 'redirect.delete', { type: 'redirect', id }, row.source);
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** The redirect page written at the old address. No scripts: a meta refresh, a canonical and a plain link. */
export function stubHtml(r: { source: string; destination: string }, site = 'https://afcdfoundation.org/') {
  const abs = EXTERNAL.test(r.destination) ? r.destination : site + r.destination;
  const rel = EXTERNAL.test(r.destination) ? r.destination : r.destination;
  return `<!doctype html>\n${STUB_MARK}\n<html lang="en"><head><meta charset="utf-8"><title>Moved · AFCD Foundation</title>\n<meta http-equiv="refresh" content="0; url=${escAttr(rel)}">\n<link rel="canonical" href="${escAttr(abs)}">\n<meta name="robots" content="noindex, follow">\n</head><body><p>This page has moved to <a href="${escAttr(rel)}">${escAttr(abs)}</a>.</p></body></html>\n`;
}
export const REDIRECTS_HEADER = '# Generated by AFCD Studio.';
export const redirectsFile = (rows: { source: string; destination: string; code: number }[]) =>
  `${REDIRECTS_HEADER} Used by hosts that support _redirects (e.g. Cloudflare Pages, Netlify); GitHub Pages uses the redirect pages instead.\n` +
  rows.map((r) => `/${r.source} ${EXTERNAL.test(r.destination) ? r.destination : `/${r.destination}`} ${r.code}`).join('\n') + '\n';
