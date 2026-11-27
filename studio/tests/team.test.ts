// Team module: one record per person with review, publishing with verification, hide/show, groups and order, roles.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, fakeRunner, pngBytes, ORIGIN } from './helpers.ts';
import { auditLog, teamMembers } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); h = undefined as never; });

type C = Awaited<ReturnType<typeof client>>;
const teamJson = () => JSON.parse(readFileSync(join(h.siteRoot, 'src/data/team.json'), 'utf8'));
const teamHtml = () => readFileSync(join(h.siteRoot, 'team.html'), 'utf8');
const del = (c: C, p: string) => c.raw('DELETE', p);

let fail = false;
async function setup() {
  fail = false;
  h = await makeApp({ runner: fakeRunner({ fail: () => fail }) });
  for (const [e, r] of [['ed@afcd.test', 'content_editor'], ['rev@afcd.test', 'content_reviewer'], ['admin@afcd.test', 'website_admin'], ['ro@afcd.test', 'read_only'], ['media@afcd.test', 'media_manager']] as const) await addUser(h.db, e, r);
  return { ed: await client(h.app, 'ed@afcd.test'), rev: await client(h.app, 'rev@afcd.test'), admin: await client(h.app, 'admin@afcd.test'), ro: await client(h.app, 'ro@afcd.test'), media: await client(h.app, 'media@afcd.test') };
}

/** Adds a person, then edits, submits, approves and publishes them. */
async function livePerson(c: Awaited<ReturnType<typeof setup>>, name: string, groupKey = 'executive', extra: Record<string, unknown> = {}) {
  const { body: t } = await c.ed.get('/team');
  const groupId = t.groups.find((g: any) => g.key === groupKey).id;
  const { status, body: m } = await c.ed.post('/team/members', { name, groupId });
  expect(status).toBe(201);
  expect((await c.ed.put(`/team/members/${m.id}`, { name, slug: m.slug, role: 'Programme coordinator (fake)', bio: 'Fake bio.', groupId, photoMediaId: null, email: '', links: [], provenance: 'Test', ...extra })).status).toBe(200);
  expect((await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' })).status).toBe(200);
  expect((await c.rev.post(`/team/members/${m.id}/transition`, { action: 'approve' })).status).toBe(200);
  const pub = await c.admin.post(`/team/members/${m.id}/publish`);
  expect(pub.status).toBe(200);
  return { ...m, groupId, revisionId: pub.body.revisionId as string };
}

describe('team', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); });

  it('starts from the four groups of the page and no one is invented', async () => {
    const { status, body } = await c.ro.get('/team');
    expect(status).toBe(200);
    expect(body.groups.map((g: any) => g.key)).toEqual(['board', 'executive', 'staff', 'volunteers']);
    expect(body.members).toEqual([]);
    expect(body.layout.pending).toBe(false);
    expect((await c.ro.post('/team/members', { name: 'Fake Person', groupId: body.groups[0].id })).status).toBe(403);
    expect((await c.media.get('/team')).status).toBe(200);   // every role that reads content can read the team
  });

  it('validates input: plain text, public emails only, real profile links', async () => {
    const { body: t } = await c.ed.get('/team');
    const groupId = t.groups[1].id;
    const { body: m } = await c.ed.post('/team/members', { name: 'Fake Amina Test', groupId });
    expect(m.slug).toBe('fake-amina-test');
    const base = { name: 'Fake Amina Test', slug: m.slug, role: 'President', bio: '', groupId, photoMediaId: null, email: '', links: [], provenance: '' };
    expect((await c.ed.put(`/team/members/${m.id}`, { ...base, role: '<script>' })).status).toBe(422);
    expect((await c.ed.put(`/team/members/${m.id}`, { ...base, email: 'amina.private@example.org' })).status).toBe(422);
    expect((await c.ed.put(`/team/members/${m.id}`, { ...base, links: [{ kind: 'linkedin', url: 'https://evil.example.org/in/x' }] })).status).toBe(422);
    expect((await c.ed.put(`/team/members/${m.id}`, { ...base, links: [{ kind: 'website', url: 'javascript:alert(1)' }] })).status).toBe(422);
    expect((await c.ed.put(`/team/members/${m.id}`, { ...base, email: 'Contact@AFCDteam.com', links: [{ kind: 'linkedin', url: 'https://www.linkedin.com/in/fake' }] })).status).toBe(200);
    // a homonym gets its own record key; the editor is told about the same name
    const { body: m2 } = await c.ed.post('/team/members', { name: 'Fake Amina Test', groupId });
    expect(m2.slug).toBe('fake-amina-test-2');
    expect((await c.ed.get(`/team/members/${m2.id}`)).body.sameName).toEqual([{ id: m.id, name: 'Fake Amina Test' }]);
  });

  it('reviews, publishes with verification, and keeps internal notes off the website', async () => {
    const { body: t } = await c.ed.get('/team');
    const groupId = t.groups.find((g: any) => g.key === 'board').id;
    const { body: m } = await c.ed.post('/team/members', { name: 'Fake Omar & Co', groupId });
    // not ready: no role; the legal representative is never described as such
    const blocked = await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('role');
    await c.ed.put(`/team/members/${m.id}`, { name: 'Fake Omar & Co', slug: m.slug, role: 'Legal representative', bio: '', groupId, photoMediaId: null, email: '', links: [], provenance: 'Internal note' });
    expect(JSON.stringify((await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' })).body)).toContain('legal representative');
    await c.ed.put(`/team/members/${m.id}`, { name: 'Fake Omar & Co', slug: m.slug, role: 'President', bio: 'Fake bio <none>'.replace(/[<>]/g, ''), groupId, photoMediaId: null, email: 'akaya@afcdteam.com', links: [], provenance: 'Internal note' });
    expect((await c.ed.post(`/team/members/${m.id}/publish`)).status).toBe(403);
    expect((await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await c.ed.post(`/team/members/${m.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await c.rev.post(`/team/members/${m.id}/publish`)).status).toBe(403);
    expect((await c.rev.post(`/team/members/${m.id}/transition`, { action: 'approve' })).status).toBe(200);
    const queue = (await c.admin.get('/review-queue')).body;
    expect(queue.find((x: any) => x.id === m.id)).toMatchObject({ type: 'team', status: 'approved', canPublish: true });
    const pub = await c.admin.post(`/team/members/${m.id}/publish`);
    expect(pub.status).toBe(200);
    const data = teamJson();
    expect(data.members).toEqual([expect.objectContaining({ name: 'Fake Omar & Co', role: 'President', group: 'board', email: 'akaya@afcdteam.com', revision: pub.body.revisionId })]);
    expect(JSON.stringify(data)).not.toContain('Internal note');
    expect(teamHtml()).toContain(`data-studio-team-rev="${pub.body.revisionId}"`);
    expect(teamHtml()).toContain('Fake Omar &amp; Co');
    const [row] = await h.db.select().from(teamMembers).where(eq(teamMembers.id, m.id));
    expect(row.status).toBe('published');
    const actions = (await h.db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, m.id))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(['team.create', 'team.update', 'team.submit', 'team.approve', 'team.publish']));

    // a new draft does not change the website until it is published again
    await c.ed.put(`/team/members/${m.id}`, { name: 'Fake Omar & Co', slug: m.slug, role: 'Former president', bio: '', groupId, photoMediaId: null, email: '', links: [], provenance: '' });
    expect(teamJson().members[0].role).toBe('President');
    expect((await c.ed.put(`/team/members/${m.id}`, { name: 'Fake Omar & Co', slug: 'other-key', role: 'x', bio: '', groupId, photoMediaId: null, email: '', links: [], provenance: '' })).status).toBe(409);

    // removal
    expect((await c.admin.post(`/team/members/${m.id}/unpublish`)).status).toBe(200);
    expect(teamJson().members).toEqual([]);
    expect(teamHtml()).not.toContain('Fake Omar');
  });

  it('requires a confirmed, described photo before review and publishes its files', async () => {
    const fd = new FormData(); fd.append('file', new File([await pngBytes()], 'portrait.png', { type: 'image/png' }));
    const img = await (await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: c.ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.ed.csrf } })).json();
    const { body: t } = await c.ed.get('/team');
    const groupId = t.groups[1].id;
    const { body: m } = await c.ed.post('/team/members', { name: 'Fake Portrait Person', groupId, role: 'Volunteer', photoMediaId: img.id });
    const blocked = await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain('consent');
    await h.app.request(`/studio/api/media/${img.id}`, { method: 'PATCH', headers: { Cookie: c.ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': c.ed.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: 'Fake Portrait Person', rightsConfirmed: true }) });
    expect((await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' })).status).toBe(200);
    await c.rev.post(`/team/members/${m.id}/transition`, { action: 'approve' });
    expect((await c.admin.post(`/team/members/${m.id}/publish`)).status).toBe(200);
    const src = teamJson().members[0].image.src as string;
    expect(src).toMatch(/^assets\/media\/[0-9a-f]{24}-\d+\.webp$/);
    expect(existsSync(join(h.siteRoot, src))).toBe(true);
    const lib = (await c.ed.get('/media/library')).body.items.find((x: any) => x.id === img.id);
    expect(lib.usedOn).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'Team member', title: 'Fake Portrait Person', where: 'Photo' }), expect.objectContaining({ kind: 'Team member', live: true })]));
  });

  it('hides and shows a live person at once, for publishers only', async () => {
    const p = await livePerson(c, 'Fake Visible Person');
    expect((await c.ed.post(`/team/members/${p.id}/visibility`, { hidden: true })).status).toBe(403);
    expect((await c.admin.post(`/team/members/${p.id}/visibility`, { hidden: true })).status).toBe(200);
    expect(teamJson().members).toEqual([]);
    expect(teamHtml()).not.toContain(p.revisionId);
    const list = (await c.ed.get('/team')).body.members;
    expect(list[0]).toMatchObject({ hidden: true, status: 'published' });
    expect((await c.admin.post(`/team/members/${p.id}/visibility`, { hidden: false })).status).toBe(200);
    expect(teamHtml()).toContain(`data-studio-team-rev="${p.revisionId}"`);
    const actions = (await h.db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, p.id))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(['team.hide', 'team.show']));
    // a draft cannot be hidden: it is not on the website
    const { body: t } = await c.ed.get('/team');
    const { body: d } = await c.ed.post('/team/members', { name: 'Fake Draft Person', groupId: t.groups[0].id });
    expect((await c.admin.post(`/team/members/${d.id}/visibility`, { hidden: true })).status).toBe(409);
  });

  it('publishes groups and order separately, and never loses a live person', async () => {
    const a = await livePerson(c, 'Fake First');
    const b = await livePerson(c, 'Fake Second');
    expect(teamJson().members.map((m: any) => m.name)).toEqual(['Fake First', 'Fake Second']);
    const { body: t0 } = await c.ed.get('/team');
    expect(t0.layout.pending).toBe(true);   // the new people are not in the published order yet (they go last)

    // reorder people inside a group and the groups themselves (editor), publish (publisher only)
    expect((await c.ed.post('/team/order', { groupId: a.groupId, ids: [b.id, a.id] })).status).toBe(200);
    expect((await c.ed.post('/team/order', { groupId: a.groupId, ids: [b.id] })).status).toBe(422);
    const ids = t0.groups.map((g: any) => g.id);
    expect((await c.ed.post('/team/order', { groupId: null, ids: [ids[1], ids[0], ids[2], ids[3]] })).status).toBe(200);
    expect((await c.ed.post('/team/layout/publish')).status).toBe(403);
    expect(teamJson().members.map((m: any) => m.name)).toEqual(['Fake First', 'Fake Second']);
    const lay = await c.admin.post('/team/layout/publish');
    expect(lay.status).toBe(200);
    expect(teamJson().members.map((m: any) => m.name)).toEqual(['Fake Second', 'Fake First']);
    expect(teamJson().groups.map((g: any) => g.key)).toEqual(['executive', 'board', 'staff', 'volunteers']);
    expect(teamHtml()).toContain(`data-studio-team-layout="${lay.body.revisionId}"`);
    expect((await c.ed.get('/team')).body.layout.pending).toBe(false);

    // a new group reaches the website only with the layout; people in it cannot be published before
    const { status, body: g } = await c.ed.post('/team/groups', { name: 'Fake Alumni', description: 'Fake description' });
    expect(status).toBe(201);
    expect(g.key).toBe('fake-alumni');
    expect((await c.ed.get('/team')).body.layout.pending).toBe(true);
    const { body: m } = await c.ed.post('/team/members', { name: 'Fake Alumnus', groupId: g.id, role: 'Alumnus' });
    await c.ed.post(`/team/members/${m.id}/transition`, { action: 'submit' }); await c.rev.post(`/team/members/${m.id}/transition`, { action: 'approve' });
    const early = await c.admin.post(`/team/members/${m.id}/publish`);
    expect(early.status).toBe(409);
    expect(early.body.error ?? JSON.stringify(early.body)).toMatch(/order and groups/);
    expect((await c.admin.post('/team/layout/publish')).status).toBe(200);
    expect((await c.admin.post(`/team/members/${m.id}/publish`)).status).toBe(200);
    expect(teamJson().members.map((x: any) => x.group)).toContain('fake-alumni');

    // hiding a group keeps its people's records, the page leaves the group out
    await c.ed.put(`/team/groups/${g.id}`, { name: 'Fake Alumni', description: '', show: false });
    await c.admin.post('/team/layout/publish');
    expect(teamHtml()).not.toContain('Fake Alumnus');
    // a group with people cannot be removed
    expect((await del(c.ed, `/team/groups/${g.id}`)).status).toBe(409);
    const { body: empty } = await c.ed.post('/team/groups', { name: 'Fake Empty' });
    expect((await del(c.ed, `/team/groups/${empty.id}`)).status).toBe(200);
  });

  it('moving a live person to another group takes effect only when published', async () => {
    const p = await livePerson(c, 'Fake Mover', 'staff');
    const { body: t } = await c.ed.get('/team');
    const board = t.groups.find((g: any) => g.key === 'board').id;
    await c.ed.put(`/team/members/${p.id}`, { name: 'Fake Mover', slug: p.slug, role: 'Board member', bio: '', groupId: board, photoMediaId: null, email: '', links: [], provenance: '' });
    expect(teamJson().members[0].group).toBe('staff');
    await c.ed.post(`/team/members/${p.id}/transition`, { action: 'submit' }); await c.rev.post(`/team/members/${p.id}/transition`, { action: 'approve' });
    expect((await c.admin.post(`/team/members/${p.id}/publish`)).status).toBe(200);
    expect(teamJson().members[0]).toMatchObject({ group: 'board', role: 'Board member' });
  });

  it('leaves the website as it was when the build fails', async () => {
    const p = await livePerson(c, 'Fake Stable');
    const before = readFileSync(join(h.siteRoot, 'src/data/team.json'), 'utf8');
    fail = true;
    const r = await c.admin.post(`/team/members/${p.id}/visibility`, { hidden: true });
    expect(r.status).toBe(409);
    fail = false;
    expect(teamJson().members.map((m: any) => m.name)).toEqual(['Fake Stable']);
    expect(JSON.parse(before).members).toEqual(teamJson().members);
    const [row] = await h.db.select().from(teamMembers).where(eq(teamMembers.id, p.id));
    expect(row.hidden).toBe(false);
  });

  it('only someone else approves, and archived people stay out of the way', async () => {
    const { body: t } = await c.ed.get('/team');
    const { body: m } = await c.admin.post('/team/members', { name: 'Fake Self Approver', groupId: t.groups[0].id, role: 'Volunteer' });
    await c.admin.post(`/team/members/${m.id}/transition`, { action: 'submit' });
    expect((await c.admin.post(`/team/members/${m.id}/transition`, { action: 'approve' })).status).toBe(409);
    await c.admin.post(`/team/members/${m.id}/transition`, { action: 'withdraw' });
    expect((await c.ed.post(`/team/members/${m.id}/transition`, { action: 'archive' })).status).toBe(200);
    expect((await c.ed.put(`/team/members/${m.id}`, { name: 'x y', slug: m.slug, role: '', bio: '', groupId: t.groups[0].id, photoMediaId: null, email: '', links: [], provenance: '' })).status).toBe(409);
    const search = (await c.ed.get('/search?q=Self%20Approver')).body;
    expect(JSON.stringify(search)).toContain('Team member');
  });
});
