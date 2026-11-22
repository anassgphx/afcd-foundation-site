import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeApp, addUser, client, fakeRunner } from './helpers.ts';
import { menuLinks, readMenus, renderMenus } from '../../lib/menu.mjs';
import type { BuildRunner } from '../src/server/modules/publish/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });
const SITE = resolve(__dirname, '../..');

/** The fake build, then what build.mjs does with src/data/menu.json: every page gets the menus and the revision marker. */
const runner = (fail: () => boolean): BuildRunner => {
  const base = fakeRunner({ fail });
  return async (cfg, mode) => {
    const out = await base(cfg, mode);
    if (mode.kind !== 'live') return out;
    const head = readFileSync(join(cfg.siteRoot, 'src/partials/header.html'), 'utf8'), foot = readFileSync(join(cfg.siteRoot, 'src/partials/footer.html'), 'utf8');
    const file = join(cfg.siteRoot, 'src/data/menu.json');
    const menu = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const r = menu ? renderMenus(head, foot, menu) : { header: head, footer: foot };
    for (const f of readdirSync(join(cfg.siteRoot, 'src/pages')).filter((x) => x.endsWith('.html')))
      writeFileSync(join(cfg.siteRoot, f), `${menu ? `<meta name="studio-menu-rev" content="${menu.revision}">` : ''}${r.header}<main>${f}</main>${r.footer}`);
    return out;
  };
};

describe('menu model', () => {
  it('reads the site menus and writes them back unchanged', () => {
    const head = readFileSync(join(SITE, 'src/partials/header.html'), 'utf8'), foot = readFileSync(join(SITE, 'src/partials/footer.html'), 'utf8');
    const m = readMenus(head, foot) as { header: { items: { label: string; panel?: unknown }[] }; footer: { columns: unknown[] } };
    expect(m.header.items.length).toBeGreaterThan(3);
    expect(m.header.items.some((i) => i.panel)).toBe(true);
    expect(m.footer.columns.length).toBe(3);
    const norm = (s: string) => s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
    const r = renderMenus(head, foot, m);
    expect(norm(r.header)).toBe(norm(head));
    expect(norm(r.footer)).toBe(norm(foot));
  });
});

describe('Menus workflow', () => {
  let failFn = () => false;
  beforeEach(async () => {
    failFn = () => false;
    h = await makeApp({ runner: runner(() => failFn()) });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    for (const p of ['header', 'footer']) copyFileSync(join(SITE, `src/partials/${p}.html`), join(h.siteRoot, `src/partials/${p}.html`));
    // every page the real menus link to exists in the test site
    const linked = menuLinks(readMenus(readFileSync(join(SITE, 'src/partials/header.html'), 'utf8'), readFileSync(join(SITE, 'src/partials/footer.html'), 'utf8')))
      .map((l) => l.href.split('#')[0]).filter((x) => /\.html$/.test(x));
    for (const f of new Set(['index.html', ...linked]))
      writeFileSync(join(h.siteRoot, `src/pages/${f}`), `---\ntitle: ${f} · AFCD Foundation\ndescription: x\nactive: none\n---\n<h1>${f}</h1>`);
  });

  it('takes over the site menus, then edits, reviews, publishes and verifies them', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const v0 = await ed.get('/menus');
    expect(v0.status).toBe(200);
    expect(v0.body).toMatchObject({ status: 'published', revision: null, pending: false });
    expect(v0.body.pages.map((p: { file: string }) => p.file)).toContain('about.html');
    const draft = v0.body.draft;
    expect(existsSync(join(h.siteRoot, 'src/data/menu.json'))).toBe(false);

    // validation: no markup, only real pages or https links
    const bad = structuredClone(draft); bad.header.items[0].label = '<script>x</script>';
    expect((await ed.put('/menus', bad)).status).toBe(422);
    const missing = structuredClone(draft); missing.header.phoneExtra = [{ label: 'Donate', href: 'donate.html' }];
    const r1 = await ed.put('/menus', missing);
    expect(r1.status).toBe(422); expect(r1.body.details[0].message).toMatch(/donate\.html is not a page/);
    const js = structuredClone(draft); js.header.cta.href = 'javascript:alert(1)';
    expect((await ed.put('/menus', js)).status).toBe(422);

    // a real edit: rename an item and add a phone-only link
    const next = structuredClone(draft);
    const partners = next.header.items.find((i: { href?: string }) => i.href === 'partners.html');
    partners.label = 'Our Partners';
    next.header.phoneExtra = [...next.header.phoneExtra, { label: 'News', href: 'news.html' }];
    const saved = await ed.put('/menus', next);
    expect(saved.status).toBe(200); expect(saved.body).toMatchObject({ status: 'draft', pending: true });
    expect(existsSync(join(h.siteRoot, 'src/data/menu.json'))).toBe(false);          // drafts never touch the site

    expect((await ed.post('/menus/transition', { action: 'submit' })).status).toBe(200);
    expect((await ed.put('/menus', next)).status).toBe(409);
    expect((await ed.post('/menus/transition', { action: 'approve' })).status).toBe(403);
    expect((await rev.post('/menus/transition', { action: 'approve' })).status).toBe(200);
    expect((await ed.post('/menus/publish')).status).toBe(403);
    const pub = await admin.post('/menus/publish');
    expect(pub.status).toBe(200);
    const file = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/menu.json'), 'utf8'));
    expect(file.revision).toBe(pub.body.revision);
    const page = readFileSync(join(h.siteRoot, 'about.html'), 'utf8');
    expect(page).toContain(`<meta name="studio-menu-rev" content="${pub.body.revision}">`);
    expect(page).toContain('>Our Partners</a>');
    expect(page).toMatch(/class="m-link flex[^"]*">News<\/a>/);
    expect((await admin.get('/menus')).body).toMatchObject({ status: 'published', revision: pub.body.revision, pending: false });
  });

  it('restores the site when publishing fails, and discards a draft', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body } = await ed.get('/menus');
    const next = structuredClone(body.draft); next.header.cta.label = 'Join us';
    await ed.put('/menus', next); await ed.post('/menus/transition', { action: 'submit' }); await rev.post('/menus/transition', { action: 'approve' });
    let calls = 0; failFn = () => calls++ === 0;
    expect((await admin.post('/menus/publish')).status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(h.siteRoot, 'src/data/menu.json'))).toBe(false);          // back to the partials as written
    expect((await admin.get('/menus')).body.status).toBe('approved');
    await ed.post('/menus/transition', { action: 'withdraw' });
    const d = await ed.post('/menus/discard');
    expect(d.status).toBe(200); expect(d.body.draft.header.cta.label).toBe('Get Involved'); expect(d.body.pending).toBe(false);
  });
});
