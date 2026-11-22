import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client as baseClient, fakeRunner } from './helpers.ts';
import { auditLog } from '../src/server/db/schema.ts';
import { cleanValue, fileContent } from '../src/server/modules/translations/service.ts';
import { buildLanguages } from '../../lib/i18n.mjs';
import type { BuildRunner } from '../src/server/modules/publish/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
const client = async (app: Parameters<typeof baseClient>[0], email: string) => { const c = await baseClient(app, email); return { ...c, patch: (p: string, b: unknown) => c.raw('PATCH', p, b) }; };
afterEach(async () => { await h?.close(); });

const LINK = 'Read <a href="our-story.html">our story</a> today.';
const PAGE = `---\ntitle: Home\ndescription: Home.\nactive: home\n---\n<!doctype html>\n<html lang="en" dir="ltr">\n<head><title>Home</title></head>\n<body><main id="main"><h1>Hello world</h1><p>${LINK}</p><img src="assets/a.png" alt="Volunteers planting trees"></main></body></html>\n`;

/** The fake site build, then the real language step of build.mjs (lib/i18n.mjs) on its output. */
const runner = (fail = () => false): BuildRunner => {
  const base = fakeRunner({ fail });
  return async (cfg, mode) => {
    const out = await base(cfg, mode);
    if (mode.kind === 'live') buildLanguages({ src: join(cfg.siteRoot, 'src'), outDir: cfg.siteRoot, files: ['index.html'], site: 'https://afcdfoundation.org/', production: false, lastmod: () => '2026-11-22', noindexFiles: new Set() });
    return out;
  };
};

describe('translation values', () => {
  it('keeps the English tags and escapes text for HTML and attributes', () => {
    expect(cleanValue(LINK, 'Lisez <a href="our-story.html">notre histoire</a> aujourd’hui.')).toEqual({ value: 'Lisez <a href="our-story.html">notre histoire</a> aujourd’hui.' });
    expect(cleanValue(LINK, 'Lisez notre histoire.').error).toMatch(/same HTML tags/);
    expect(cleanValue('Hello', 'Bonjour <b>tout</b>').error).toMatch(/Remove the HTML tags/);
    expect(cleanValue('Hello', 'Sûr & "certain" <3').value).toBe('Sûr &amp; &quot;certain&quot; &lt;3');
    expect(cleanValue('Hello', 'Déjà &amp; bien').value).toBe('Déjà &amp; bien');
    expect(cleanValue('<a href="x">Go</a>', '<a href="x" onclick="alert(1)">Aller</a>').error).toBeTruthy();
    expect(cleanValue('Hello', '  \n ').value).toBe('');
  });
  it('writes the file the website build reads, in the same shape as the hand-made one', () => {
    expect(JSON.parse(fileContent('ar', { strings: { Hello: 'مرحبا' }, live: false }))).toEqual({ status: 'draft', language: 'Arabic', note: expect.any(String), strings: { Hello: 'مرحبا' } });
    expect(JSON.parse(fileContent('fr', { strings: {}, live: true }, 'rev-1'))).toMatchObject({ status: 'approved', revision: 'rev-1' });
  });
});

describe('Translations workflow', () => {
  let failFn = () => false;
  beforeEach(async () => {
    failFn = () => false;
    h = await makeApp({ runner: runner(() => failFn()) });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), PAGE);
    writeFileSync(join(h.siteRoot, 'index.html'), PAGE.replace(/^---[\s\S]*?---\n/, ''));
    mkdirSync(join(h.siteRoot, 'assets'), { recursive: true }); writeFileSync(join(h.siteRoot, 'assets/main.js'), "toast('Link copied.');\n");
    mkdirSync(join(h.siteRoot, 'src/i18n'), { recursive: true });
    writeFileSync(join(h.siteRoot, 'src/i18n/fr.json'), fileContent('fr', { strings: { 'Hello world': 'Bonjour le monde' }, live: false }));
  });

  it('takes over the site file, then edits, reviews, publishes and verifies a language', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const before = readFileSync(join(h.siteRoot, 'src/i18n/fr.json'), 'utf8');
    const v0 = await ed.get('/translations/fr');
    expect(v0.status).toBe(200);
    expect(v0.body.status).toBe('published');   // what the site already shows
    expect(v0.body.items.map((i: { key: string }) => i.key)).toEqual(expect.arrayContaining(['Hello world', LINK, 'Volunteers planting trees', 'Link copied.']));
    expect(v0.body.items.find((i: { key: string }) => i.key === 'Hello world')).toMatchObject({ text: 'Bonjour le monde', state: 'done', files: ['index.html'] });
    expect(v0.body.counts).toMatchObject({ done: 1, edited: 0 });
    expect((await ed.get('/translations/de')).status).toBe(404);

    // validation: nothing is saved when one value is wrong
    const bad = await ed.patch('/translations/fr', { strings: { [LINK]: 'Lisez notre histoire.', 'Volunteers planting trees': 'Des bénévoles plantent des arbres' } });
    expect(bad.status).toBe(422); expect(bad.body.details[0].path).toBe(LINK);
    expect((await ed.patch('/translations/fr', { strings: { 'Not on the site': 'x' } })).status).toBe(422);
    const ok = await ed.patch('/translations/fr', { strings: { [LINK]: 'Lisez <a href="our-story.html">notre histoire</a> aujourd’hui.', 'Volunteers planting trees': 'Des bénévoles plantent des arbres', 'Link copied.': 'Lien copié.' } });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('draft'); expect(ok.body.counts).toMatchObject({ done: 1, edited: 3, missing: 1 });   // the page title is still untranslated
    expect(readFileSync(join(h.siteRoot, 'src/i18n/fr.json'), 'utf8')).toBe(before);   // drafts never touch the site

    // review: no self-approval, comment needed to send back, locked while in review
    expect((await ed.post('/translations/fr/transition', { action: 'submit' })).status).toBe(200);
    expect((await ed.patch('/translations/fr', { strings: { 'Hello world': 'Salut' } })).status).toBe(409);
    expect((await ed.post('/translations/fr/transition', { action: 'approve' })).status).toBe(403);
    expect((await rev.post('/translations/fr/transition', { action: 'request_changes' })).status).toBe(422);
    expect((await rev.post('/translations/fr/transition', { action: 'approve' })).status).toBe(200);
    expect((await ed.post('/translations/fr/publish')).status).toBe(403);
    expect((await rev.post('/translations/fr/publish')).status).toBe(403);

    const pub = await admin.post('/translations/fr/publish');
    expect(pub.status).toBe(200);
    const file = JSON.parse(readFileSync(join(h.siteRoot, 'src/i18n/fr.json'), 'utf8'));
    expect(file).toMatchObject({ status: 'draft', revision: pub.body.revision, strings: { 'Hello world': 'Bonjour le monde', 'Link copied.': 'Lien copié.' } });
    const fr = readFileSync(join(h.siteRoot, 'fr/index.html'), 'utf8');
    expect(fr).toContain(`<meta name="studio-i18n-rev" content="${pub.body.revision}">`);
    expect(fr).toContain('<h1>Bonjour le monde</h1>');
    expect(fr).toContain('Lisez <a href="our-story.html">notre histoire</a> aujourd’hui.');
    expect(fr).toContain('alt="Des bénévoles plantent des arbres"');
    expect(fr).toContain('<html lang="fr" dir="ltr">');
    expect(readFileSync(join(h.siteRoot, 'assets/main.fr.js'), 'utf8')).toContain("'Lien copié.'");
    const v1 = (await admin.get('/translations/fr')).body;
    expect(v1).toMatchObject({ status: 'published', revision: pub.body.revision, pending: 0 });

    // going public on the live site is a reviewed change of its own
    expect((await ed.patch('/translations/fr', { live: true })).status).toBe(200);
    expect((await ed.get('/translations/fr')).body.pending).toBe(1);
    await ed.post('/translations/fr/transition', { action: 'submit' }); await rev.post('/translations/fr/transition', { action: 'approve' });
    expect((await admin.post('/translations/fr/publish')).status).toBe(200);
    expect(JSON.parse(readFileSync(join(h.siteRoot, 'src/i18n/fr.json'), 'utf8')).status).toBe('approved');

    const ov = (await rev.get('/translations')).body;
    expect(ov.find((l: { lang: string }) => l.lang === 'fr')).toMatchObject({ translated: 4, total: 5, live: true, publishedLive: true });
    expect(ov.find((l: { lang: string }) => l.lang === 'ar')).toMatchObject({ translated: 0, status: null });
    // one record's texts, for the Translations tab of its editor: its page minus site chrome, plus listing texts with its fields
    writeFileSync(join(h.siteRoot, '404.html'), '<html><body><title>Home</title><p>Not found</p></body></html>');
    const rec = await ed.post('/translations/record', { files: [], texts: ['Volunteers planting trees'] });
    expect(rec.status).toBe(200);
    expect(rec.body.items.map((i: { key: string }) => i.key)).toEqual(['Volunteers planting trees']);
    expect(rec.body.items[0].t.fr).toMatchObject({ text: 'Des bénévoles plantent des arbres', state: 'done' });
    expect(rec.body.items[0].t.ar).toMatchObject({ text: '', state: 'missing' });
    expect((await ed.post('/translations/record', { files: ['../secret.html'] })).status).toBe(422);
    const actions = (await h.db.select({ a: auditLog.action }).from(auditLog)).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(['translation.import', 'translation.update', 'translation.submit', 'translation.approve', 'translation.publish']));
  });

  it('restores the published translations when a delivery fails', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const before = readFileSync(join(h.siteRoot, 'src/i18n/fr.json'), 'utf8');
    await ed.get('/translations/fr');
    await ed.patch('/translations/fr', { strings: { 'Hello world': 'Salut tout le monde' } });
    await ed.post('/translations/fr/transition', { action: 'submit' }); await rev.post('/translations/fr/transition', { action: 'approve' });
    let calls = 0;
    failFn = () => calls++ === 0;   // the delivery build fails; the restore build succeeds
    const r = await admin.post('/translations/fr/publish');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(join(h.siteRoot, 'src/i18n/fr.json'), 'utf8')).toBe(before);
    expect((await admin.get('/translations/fr')).body.status).toBe('approved');   // still approved, nothing recorded as live
    expect(existsSync(join(h.siteRoot, 'src/i18n/ar.json'))).toBe(false);          // languages Studio never opened are left alone
  });
});
