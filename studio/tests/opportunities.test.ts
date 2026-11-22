import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { opportunities } from '../src/server/db/schema.ts';
import { oppState } from '../src/server/modules/opportunities/render.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const BODY = 'Young people from Al Haouz join a six-week programme on climate action. Participants meet every Saturday, plan a local project with mentors and present it to the commune at the end.';
const opp = (over: Record<string, unknown> = {}) => ({
  title: 'Youth climate fellows & mentors', slug: 'youth-climate-fellows', type: 'call_for_applications', summary: 'A six-week programme for young climate leaders.', body: BODY,
  eligibility: ['Aged 18 to 30', 'Living in Al Haouz'], benefits: ['Training and mentoring'], location: 'Ait Ourir', commitment: '6 Saturdays',
  opensOn: null, deadline: '2099-02-15', applyMethod: 'external', applyUrl: 'https://forms.example.org/apply', applyEmail: '',
  pillarKey: 'green-thumbs', projectSlug: 'eco-citizen', heroMediaId: null, seoTitle: '', seoDescription: '', ...over,
});

describe('opportunity state', () => {
  it('opens and closes by date', () => {
    expect(oppState({ opensOn: '2026-12-01', deadline: '2026-12-31' }, '2026-11-22')).toBe('soon');
    expect(oppState({ opensOn: null, deadline: '2026-11-22' }, '2026-11-22')).toBe('open');
    expect(oppState({ opensOn: null, deadline: '2026-11-21' }, '2026-11-22')).toBe('closed');
    expect(oppState({ opensOn: null, deadline: null }, '2030-01-01')).toBe('open');
  });
});

describe('opportunities', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('validates input and readiness', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.post('/opportunities', opp({ applyUrl: '' }))).status).toBe(422);
    expect((await ed.post('/opportunities', opp({ applyUrl: 'javascript:alert(1)' }))).status).toBe(422);
    expect((await ed.post('/opportunities', opp({ applyMethod: 'email', applyEmail: 'not-an-email' }))).status).toBe(422);
    expect((await ed.post('/opportunities', opp({ opensOn: '2099-03-01' }))).status).toBe(422);
    const { body } = await ed.post('/opportunities', opp({ summary: '', body: 'Too short.', eligibility: [] }));
    const r = await ed.post(`/opportunities/${body.id}/transition`, { action: 'submit' });
    expect(r.status).toBe(422);
    expect(r.body.details.length).toBe(3);
  });

  it('reviews, publishes the listing and page, then removes them', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { status, body: o } = await ed.post('/opportunities', opp());
    expect(status).toBe(201);
    expect((await ed.post(`/opportunities/${o.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await ed.post(`/opportunities/${o.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await rev.post(`/opportunities/${o.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`/opportunities/${o.id}/publish`)).status).toBe(403);
    const pub = await admin.post(`/opportunities/${o.id}/publish`);
    expect(pub.status).toBe(200);
    const page = readFileSync(join(h.siteRoot, 'opportunity-youth-climate-fellows.html'), 'utf8');
    expect(page).toContain(`data-studio-opportunity-rev="${pub.body.revisionId}"`);
    expect(page).toContain('Youth climate fellows &amp; mentors');
    expect(page).toContain('href="https://forms.example.org/apply" target="_blank" rel="noopener"');
    expect(page).toContain('data-state="open"');
    const listing = readFileSync(join(h.siteRoot, 'opportunities.html'), 'utf8');
    expect(listing).toContain(`data-studio-opportunity="${pub.body.revisionId}"`);
    expect(readFileSync(join(h.siteRoot, 'sitemap.xml'), 'utf8')).toContain('opportunities.html');

    expect((await admin.post(`/opportunities/${o.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'opportunity-youth-climate-fellows.html'))).toBe(false);
    expect(existsSync(join(h.siteRoot, 'opportunities.html'))).toBe(false);   // nothing live: no empty listing page
    expect(existsSync(join(h.siteRoot, 'src/pages/opportunities.html'))).toBe(false);
    const [row] = await h.db.select().from(opportunities).where(eq(opportunities.id, o.id));
    expect(row.status).toBe('draft');
  });

  it('shows a closed opportunity without an apply button and keeps it out of search engines', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: o } = await ed.post('/opportunities', opp({ deadline: '2020-01-31', applyMethod: 'email', applyUrl: '', applyEmail: 'apply@afcdteam.com' }));
    await ed.post(`/opportunities/${o.id}/transition`, { action: 'submit' }); await rev.post(`/opportunities/${o.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/opportunities/${o.id}/publish`)).status).toBe(200);
    const src = readFileSync(join(h.siteRoot, 'src/pages/opportunity-youth-climate-fellows.html'), 'utf8');
    expect(src).toContain('noindex: true');
    expect(src).toContain('data-state="closed"');
    expect(src).not.toContain('mailto:');
  });
});
