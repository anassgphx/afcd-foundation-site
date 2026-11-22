import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { readFields } from '../src/server/modules/home/fields.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const HOME = `---\ntitle: AFCD Foundation · Home\ndescription: Home.\nactive: home\n---\n<section><p class="hx-kicker" data-sf="hero.1.kicker">Old title</p>
<h1 class="hx-title" data-sf="hero.1.title" data-sf-type="split">We Serve <span class="hx-soft">with Love.</span></h1>
<span data-sf="hero.1.title" data-sf-type="plain">We Serve with Love.</span>
<a data-sf="hero.1.cta1" data-sf-type="link" href="#who" class="hx-btn">Discover AFCD <span aria-hidden="true">↗</span></a>
<p data-sf="about.text" data-sf-type="rich"><span class="font-medium">Founded in 2007,</span> AFCD &amp; friends.</p>
<span data-sf="about.stat2.value" data-sf-type="plain">Ait Ourir</span>
<dt data-sf="impact.stat1.label" data-sf-type="tail"><span class="im-idx">01</span>Alumni</dt><dd data-sf="impact.stat1.value">2,700</dd></section>`;

describe('homepage fields', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), HOME);
  });

  it('reads editable fields and their current text from the page', () => {
    const f = readFields(h.siteRoot, 'index.html');
    expect(f.map((x) => x.key)).toEqual(['hero.1.kicker', 'hero.1.title', 'hero.1.cta1', 'about.text', 'about.stat2.value', 'impact.stat1.label', 'impact.stat1.value']);
    expect(f.find((x) => x.key === 'about.stat2.value')).toMatchObject({ type: 'text', default: 'Ait Ourir' });   // a key that only appears as "plain" is a normal field
    expect(f.find((x) => x.key === 'hero.1.title')!.default).toEqual({ main: 'We Serve', soft: 'with Love.' });
    expect(f.find((x) => x.key === 'hero.1.cta1')!.default).toEqual({ label: 'Discover AFCD', href: '#who' });
    expect(f.find((x) => x.key === 'about.text')!.default).toBe('**Founded in 2007,** AFCD & friends.');
    expect(f.find((x) => x.key === 'impact.stat1.label')!.default).toBe('Alumni');
  });

  it('validates, reviews, publishes, verifies and restores the original text', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    expect((await ed.put('/home', { 'hero.1.kicker': '<script>' })).status).toBe(422);
    expect((await ed.put('/home', { 'hero.1.cta1': { label: 'Go', href: 'javascript:alert(1)' } })).status).toBe(422);
    expect((await ed.put('/home', { 'not.a.field': 'x' })).status).toBe(422);
    expect((await ed.put('/home', { 'hero.1.kicker': 'New kicker & more', 'impact.stat1.value': '3,000' })).status).toBe(200);
    expect((await ed.post('/home/transition', { action: 'submit' })).status).toBe(200);
    expect((await ed.post('/home/transition', { action: 'approve' })).status).toBe(403);
    expect((await rev.post('/home/transition', { action: 'approve' })).status).toBe(200);
    expect((await ed.post('/home/publish')).status).toBe(403);
    const pub = await admin.post('/home/publish');
    expect(pub.status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/page-fields.json'), 'utf8'));
    expect(data.pages['index.html']).toMatchObject({ revision: pub.body.revisionId, fields: { 'hero.1.kicker': 'New kicker & more', 'impact.stat1.value': '3,000' } });
    const html = readFileSync(join(h.siteRoot, 'index.html'), 'utf8');
    expect(html).toContain(`studio-fields-rev" content="${pub.body.revisionId}"`);
    expect(html).not.toContain('data-sf');
    expect((await admin.post('/home/unpublish')).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'src/data/page-fields.json'))).toBe(false);
    expect((await ed.get('/home')).body.content.status).toBe('draft');
  });
});
