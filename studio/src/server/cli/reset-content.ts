// Empties Studio's content so it can be filled again from scratch, and takes that content off the website.
// Usage (with Studio STOPPED, the database is single-process):  npm run content:reset            → dry run, shows what goes
//                                                                npm run content:reset -- --yes  → does it
// Deletes: every project, story, event, opportunity, publication and partner (with their revisions and links), the
// publication documents, and every Media Library item that nothing else uses. Keeps: the home page and other page
// content, pillars, menus, settings, SEO, users, forms and messages, and every photo the kept content still uses.
// Then rebuilds the live website from what is left, removing the old project, story, event, opportunity and
// publication pages (the Events page falls back to its labelled sample events while no event is published).
import { parseArgs } from 'node:util';
import { existsSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { count, inArray } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { audit } from '../audit.ts';
import { Publisher } from '../modules/publish/service.ts';
import { usage } from '../modules/media/library.ts';
import { deleteMedia } from '../modules/media/service.ts';
import { documentPath } from '../modules/publications/documents.ts';
import { LANGS } from '../modules/translations/service.ts';
import { KEY as MENU_KEY } from '../modules/menus/service.ts';
import { eq } from 'drizzle-orm';

const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false } } });
const cfg = loadConfig();
const { db, close } = await openDb(cfg);

const TABLES = [['Stories', t.articles], ['Events', t.events], ['Opportunities', t.opportunities], ['Publications', t.publications], ['Partners', t.partners], ['Projects', t.projects]] as const;
const n = async (tbl: (typeof TABLES)[number][1] | typeof t.documents | typeof t.media) => (await db.select({ n: count() }).from(tbl as typeof t.media))[0].n;
console.log(`Studio data: ${cfg.dataDir}\nWebsite:     ${cfg.siteRoot}\n`);
for (const [label, tbl] of TABLES) console.log(`${label.padEnd(14)} ${await n(tbl)} to delete`);
console.log(`${'Documents'.padEnd(14)} ${await n(t.documents)} to delete`);
console.log(`${'Media library'.padEnd(14)} ${await n(t.media)} items; the ones still used by the home page, pages, pillars or settings are kept`);

if (!values.yes) {
  console.log('\nDry run: nothing was changed. Run again with --yes (Studio stopped) to delete all of this and rebuild the website.');
  await close(); process.exit(0);
}

// 1. the content, with its revisions, links and review comments (cascades); one audit entry with the counts
const counts: Record<string, number> = {};
for (const [label, tbl] of TABLES) counts[label] = await n(tbl);
await db.transaction(async (tx) => {
  for (const [, tbl] of TABLES) await tx.delete(tbl);
  await tx.delete(t.reviewComments).where(inArray(t.reviewComments.entityType, ['project', 'article', 'news', 'event', 'opportunity', 'publication', 'partner']));
  await audit(tx, null, 'content.reset', { type: 'site' }, 'Deleted all projects, stories, events, opportunities, publications and partners (content reset)', counts);
});
console.log('\nDeleted the content records.');

// 2. publication documents (nothing uses them any more)
const docs = await db.select().from(t.documents);
for (const d of docs) { const p = documentPath(cfg, d); if (existsSync(p)) rmSync(p); }
if (docs.length) await db.delete(t.documents);
console.log(`Deleted ${docs.length} documents.`);

// 3. Media Library: delete what nothing uses any more; keep what the home page, pages, pillars, SEO or settings use
const all = await db.select({ id: t.media.id }).from(t.media);
const used = await usage(db, all.map((m) => m.id));
let gone = 0; let kept = 0;
for (const m of all) {
  if (used[m.id]?.length) { kept++; continue; }
  try { await deleteMedia(db, cfg, m.id); gone++; } catch { kept++; }
}
await audit(db, null, 'media.reset', { type: 'media' }, `Deleted ${gone} unused Media Library items (content reset); kept ${kept} still in use`, { deleted: gone, kept });
console.log(`Media Library: deleted ${gone}, kept ${kept} still in use.`);

// 4. menus: featured cards and links that point to a project page (those pages are gone) are removed, in the draft
//    and the published menu; a dropdown keeps at least one link
const PROJECT_PAGE = /^project-[a-z0-9-]+\.html(#.*)?$/;
const strip = (node: unknown): number => {
  let k = 0;
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const x = node[i] as { href?: string } | null;
      if (x && typeof x === 'object' && typeof x.href === 'string' && PROJECT_PAGE.test(x.href) && node.length > 1) { node.splice(i, 1); k++; } else k += strip(x);
    }
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    for (const [key, v] of Object.entries(o)) {
      if (key === 'feature' && v && typeof (v as { href?: string }).href === 'string' && PROJECT_PAGE.test((v as { href: string }).href)) { o[key] = null; k++; }
      else k += strip(v);
    }
  }
  return k;
};
const [menuRow] = await db.select().from(t.seoSettings).where(eq(t.seoSettings.key, MENU_KEY));
if (menuRow) {
  const draft = structuredClone(menuRow.draft); const published = structuredClone(menuRow.published);
  const k = strip(draft) + strip(published);
  if (k) {
    await db.update(t.seoSettings).set({ draft, published, updatedAt: new Date() } as never).where(eq(t.seoSettings.key, MENU_KEY));
    await audit(db, null, 'menu.update', { type: 'menu', id: MENU_KEY }, `Removed ${k} menu links to deleted project pages (content reset)`);
  }
  console.log(`Menus: removed ${k} links to deleted project pages.`);
} else console.log('Menus: Studio does not manage the menus yet; check the header for links to project pages.');

// 5. the website: no partners (the generator would otherwise keep the last list), old detail pages removed, full rebuild
const site = cfg.siteRoot;
mkdirSync(resolve(site, 'src/data'), { recursive: true });
writeFileSync(resolve(site, 'src/data/partners.json'), JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), partners: [] }, null, 2) + '\n');
const OLD = /^(project|news|event|opportunity|publication)-[a-z0-9-]+\.html$|^(opportunities|publications)\.html$/;
let removed = 0;
for (const dir of [site, resolve(site, 'src/pages'), ...LANGS.map((l) => resolve(site, l))]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (OLD.test(f)) { rmSync(resolve(dir, f)); removed++; }
}
console.log(`Removed ${removed} old page files. Rebuilding the website…`);
const publisher = new Publisher(db, cfg);
const log: string[] = [];
try {
  await publisher['rebuildFromDb'](log);   // the same full rebuild Studio uses to restore the site
  await audit(db, null, 'site.rebuild', { type: 'site' }, 'Rebuilt the website after the content reset');
  console.log('Website rebuilt. Start Studio again.');
} catch (e) {
  console.error(`The website rebuild failed: ${(e as Error).message}\n${log.join('\n').slice(-4000)}`);
  await close(); process.exit(1);
}
await close();
