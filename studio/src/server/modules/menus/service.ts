// Menus: the website's main menu (desktop dropdowns and phone menu), its main button and the footer link columns.
//
// The site's partials stay the design. lib/menu.mjs reads their menus into a model and writes a model back into the same
// markup; build.mjs applies src/data/menu.json when it exists. Studio keeps a draft and a published copy (seo_settings
// row 'menu:site'); the first visit takes over the menus the site shows now as both. Publishing goes through review like
// every other change, writes menu.json, rebuilds and checks every page carries the new menu revision.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { seoSettings, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { readMenus, menuLinks } from '../../../../../lib/menu.mjs';

export const KEY = 'menu:site';
/** Values build.mjs understands for "highlight this item on its pages". */
export const NAV_KEYS = ['none', 'home', 'about', 'pillars', 'projects', 'news', 'events', 'partners', 'contact', 'involved'] as const;

const plain = (n: number) => z.string().trim().max(n).refine((v) => !/[<>]/.test(v), 'Use plain text, without < or >.');
/** Internal page (with optional #section), a #section, mailto:, tel: or an https address. */
const HREF = /^(?:[a-z0-9][a-z0-9-]*\.html(?:#[\w-]+)?|#[\w-]+|mailto:[^\s"<>]+@[^\s"<>]+|tel:\+?[0-9 ]{6,20}|https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"<>]*)?)$/i;
const href = z.string().trim().max(300).regex(HREF, 'Use a page of this site (e.g. about.html or projects.html#featured), or a full https:// address.');
const link = z.object({ label: plain(60).min(1, 'Add a label.'), href }).strict();
const dot = z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional();

export const menuSchema = z.object({
  version: z.literal(1).default(1),
  header: z.object({
    items: z.array(z.object({
      label: plain(40).min(1, 'Every menu item needs a label.'),
      key: z.enum(NAV_KEYS).default('none'),
      id: z.string().regex(/^dd-[a-z0-9-]+$/).optional(),
      href: href.optional(),
      phone: z.array(link).max(12).default([]),
      panel: z.object({
        title: plain(80).default(''),
        text: plain(200).default(''),
        all: z.object({ label: plain(40).default(''), href: z.union([href, z.literal('')]).default('') }).strict().prefault({}),
        links: z.array(z.object({ title: plain(60).min(1, 'Each dropdown link needs a title.'), desc: plain(120).default(''), href, dot }).strict()).min(1, 'A dropdown needs at least one link.').max(8),
        feature: z.object({ photo: plain(80).default(''), kicker: plain(40).default(''), title: plain(90).min(1, 'Give the featured card a title, or remove it.'), href }).strict().nullable().default(null),
        prompt: plain(80).default(''),
        pills: z.array(link).max(4).default([]),
      }).strict().optional(),
    }).strict().superRefine((it, ctx) => { if (!it.panel && !it.href) ctx.addIssue({ code: 'custom', message: `“${it.label}” needs a link or dropdown links.`, path: ['href'] }); })).min(1).max(9),
    cta: z.object({ label: plain(30).default(''), href: z.union([href, z.literal('')]).default('') }).strict().prefault({}),
    phoneExtra: z.array(link).max(6).default([]),
  }).strict(),
  footer: z.object({
    columns: z.array(z.object({ title: plain(40).min(1, 'Each footer column needs a title.'), aria: plain(60).optional(), links: z.array(z.object({ label: plain(60).min(1, 'Add a label.'), href, dot }).strict()).max(10) }).strict()).max(3),
  }).strict(),
}).strict();
export type Menu = z.infer<typeof menuSchema>;

const partial = (cfg: Config, n: string) => readFileSync(resolve(cfg.siteRoot, 'src/partials', `${n}.html`), 'utf8');
/** The menus the site's partials show today (what the site looks like without Studio menus). */
export function siteMenus(cfg: Config): Menu { return menuSchema.parse(readMenus(partial(cfg, 'header'), partial(cfg, 'footer'))); }

/** Pages a menu can link to: the site's pages with their titles. */
export function sitePages(cfg: Config) {
  const dir = resolve(cfg.siteRoot, 'src/pages');
  return (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.html') && f !== '404.html').map((file) => {
    const fm = readFileSync(resolve(dir, file), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const title = (fm?.[1].match(/^title:\s*(.+)$/m)?.[1] ?? file).replace(/\s*·\s*AFCD Foundation$/, '').replace(/&amp;/g, '&');
    return { file, title };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

/** Problems that would make a menu link fail on the website (missing page). */
export function checkLinks(cfg: Config, m: Menu) {
  const files = new Set(sitePages(cfg).map((p) => p.file).concat('index.html'));
  return menuLinks(m).filter((l: { href: string }) => /^[a-z0-9-]+\.html/i.test(l.href) && !files.has(l.href.split('#')[0]))
    .map((l: { where: string; href: string }) => ({ path: l.where, message: `${l.href.split('#')[0]} is not a page of this site.` }));
}

export async function loadRow(db: DB) {
  const [row] = await db.select().from(seoSettings).where(eq(seoSettings.key, KEY));
  return row ?? null;
}
async function ensureRow(db: DB, cfg: Config, actor: NonNullable<Actor>) {
  const cur = await loadRow(db); if (cur) return cur;
  const m = siteMenus(cfg);
  await db.insert(seoSettings).values({ key: KEY, draft: m as unknown as Record<string, unknown>, published: m as unknown as Record<string, unknown>, status: 'published', updatedBy: actor.id }).onConflictDoNothing();
  await audit(db, actor, 'menu.import', { type: 'menu', id: KEY }, 'Took over the menus the website shows today');
  return (await loadRow(db))!;
}

export async function view(db: DB, cfg: Config, actor: NonNullable<Actor>) {
  const row = await ensureRow(db, cfg, actor);
  const draft = row.draft as unknown as Menu; const pub = row.published as unknown as (Menu & { _revision?: string }) | null;
  const [by] = row.updatedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)) : [];
  const { _revision, ...pubMenu } = (pub ?? {}) as Menu & { _revision?: string };
  return {
    status: row.status, draft, revision: _revision ?? null, publishedAt: row.publishedAt, updatedAt: row.updatedAt, updatedByName: by?.name ?? null, submittedBy: row.submittedBy,
    pending: JSON.stringify(draft) !== JSON.stringify(pub ? pubMenu : null),
    linkIssues: checkLinks(cfg, draft), pages: sitePages(cfg), navKeys: NAV_KEYS,
  };
}

export async function save(db: DB, cfg: Config, actor: NonNullable<Actor>, raw: unknown) {
  const row = await ensureRow(db, cfg, actor);
  if (row.status === 'in_review' || row.status === 'approved') throw new AppError(409, 'The menus are being reviewed. Withdraw them to edit.');
  const p = menuSchema.safeParse(raw);
  if (!p.success) throw new AppError(422, 'Some menu entries need attention.', p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const issues = checkLinks(cfg, p.data);
  if (issues.length) throw new AppError(422, 'Some links point to pages that do not exist.', issues);
  await db.update(seoSettings).set({ draft: p.data as unknown as Record<string, unknown>, status: 'draft', updatedBy: actor.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  await audit(db, actor, 'menu.update', { type: 'menu', id: KEY }, 'Edited the website menus');
}

/** Start again from what the website shows (the published menus). */
export async function discard(db: DB, cfg: Config, actor: NonNullable<Actor>) {
  const row = await ensureRow(db, cfg, actor);
  if (row.status === 'in_review' || row.status === 'approved') throw new AppError(409, 'Withdraw the menus from review first.');
  const pub = row.published as unknown as (Menu & { _revision?: string }) | null;
  const { _revision, ...m } = (pub ?? siteMenus(cfg)) as Menu & { _revision?: string };
  await db.update(seoSettings).set({ draft: m as unknown as Record<string, unknown>, status: row.published ? 'published' : 'draft', updatedBy: actor.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  await audit(db, actor, 'menu.discard', { type: 'menu', id: KEY }, 'Discarded menu changes');
}

export const MENU_ACTIONS = { submit: 'page.update', withdraw: 'page.update', request_changes: 'page.approve', approve: 'page.approve' } as const;
export async function transition(db: DB, actor: NonNullable<Actor>, role: Role, action: keyof typeof MENU_ACTIONS, comment = '') {
  const cur = await loadRow(db);
  if (!cur) throw new AppError(404, 'Open the menus first.');
  const from = cur.status; let to: typeof from;
  if (action === 'submit') { if (from !== 'draft' && from !== 'changes_requested') throw new AppError(409, 'Only a draft can be sent for review.'); to = 'in_review'; }
  else if (action === 'withdraw') { if (from !== 'in_review' && from !== 'approved') throw new AppError(409, 'Nothing to withdraw.'); to = 'draft'; }
  else {
    if (from !== 'in_review') throw new AppError(409, 'Only menus in review can be reviewed.');
    if (cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must review the menus.');
    if (action === 'request_changes' && !comment.trim()) throw new AppError(422, 'Say what needs to change.');
    to = action === 'approve' ? 'approved' : 'changes_requested';
  }
  await db.update(seoSettings).set({ status: to, ...(action === 'submit' ? { submittedBy: actor.id } : {}), updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  await audit(db, actor, `menu.${action}`, { type: 'menu', id: KEY }, comment ? `${action}: ${comment.slice(0, 300)}` : `${action} menus`);
}

/** What src/data/menu.json should contain: the published menus with their revision, or the ones being delivered.
 *  null = no file (the site uses its partials as written). */
export async function publishedFile(db: DB, override?: { menu: Menu; revision: string }) {
  if (override) return JSON.stringify({ ...override.menu, revision: override.revision }, null, 1) + '\n';
  const row = await loadRow(db);
  const pub = row?.published as unknown as (Menu & { _revision?: string }) | null | undefined;
  if (!pub?._revision) return null;
  const { _revision, ...m } = pub;
  return JSON.stringify({ ...m, revision: _revision }, null, 1) + '\n';
}
