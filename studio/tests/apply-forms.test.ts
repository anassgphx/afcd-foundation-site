// AFCD Apply, phase 2: application forms (save, publish, versions, compatibility) and templates (versioned, import/export).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import { applyCallEvents, applyFormVersions, auditLog } from '../src/server/db/schema.ts';
import { runCallSchedule } from '../src/server/modules/apply/calls.ts';
import { zonedToUtc } from '../src/server/modules/apply/time.ts';
import { canonical, defHash } from '../src/server/modules/apply/forms.ts';
import type { FormDef } from '../src/server/modules/apply/engine.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
afterEach(async () => { await h?.close(); h = undefined; });

const DESC = 'Young people from Al Haouz join a twelve-week fellowship on climate action. Fellows meet every Saturday, plan a local project with mentors and present it to the commune at the end.';
const call = { title: 'Green Fellows 2099', slug: 'green-fellows-2099', summary: 'A fellowship.', description: DESC, eligibility: ['Aged 18 to 30'], opensLocal: '2099-01-10T09:00', closesLocal: '2099-02-15T23:59',
  contactEmail: 'apply@afcd.test', privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them 12 months after the call.' };

describe('apply forms', () => {
  let mgr: Awaited<ReturnType<typeof client>>, id: string;
  beforeEach(async () => {
    h = await makeApp();
    for (const [e, r] of [['mgr@afcd.test', 'application_manager'], ['mgr2@afcd.test', 'application_manager'], ['ar@afcd.test', 'application_reviewer'], ['rev@afcd.test', 'content_reviewer'], ['ed@afcd.test', 'content_editor']] as const) await addUser(h.db, e, r);
    mgr = await client(h.app, 'mgr@afcd.test');
    id = (await mgr.post('/apply/calls', call)).body.id;
  });

  it('creates a form from a template or blank, once', async () => {
    expect((await mgr.get(`/apply/calls/${id}/form`)).body.form).toBeNull();
    expect((await mgr.post(`/apply/calls/${id}/form`, { template: 'nope' })).status).toBe(404);
    const f = await mgr.post(`/apply/calls/${id}/form`, { template: 'grant' });
    expect(f.status).toBe(201);
    expect(f.body.form.definition.pages.map((p: { id: string }) => p.id)).toEqual(['organisation', 'project', 'budget', 'consent']);
    expect(f.body.issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);
    expect(f.body.unpublishedChanges).toBe(true);
    expect((await mgr.post(`/apply/calls/${id}/form`, {})).status).toBe(409);
    // roles: reviewers read, content editors do not even see it
    expect((await (await client(h!.app, 'ar@afcd.test')).post(`/apply/calls/${id}/form/publish`, { rev: 1 })).status).toBe(403);
    expect((await (await client(h!.app, 'ar@afcd.test')).get(`/apply/calls/${id}/form`)).status).toBe(200);
    expect((await (await client(h!.app, 'ed@afcd.test')).get(`/apply/calls/${id}/form`)).status).toBe(403);
  });

  it('saves with optimistic concurrency and refuses code or unknown keys', async () => {
    const f = (await mgr.post(`/apply/calls/${id}/form`, {})).body.form;
    const def: FormDef = f.definition;
    def.pages[0].fields.push({ id: 'motivation', type: 'long_text', label: { en: 'Why?' }, required: true });
    const s1 = await mgr.put(`/apply/calls/${id}/form`, { definition: def, rev: f.rev });
    expect(s1.status).toBe(200);
    const other = await client(h!.app, 'mgr2@afcd.test');
    expect((await other.put(`/apply/calls/${id}/form`, { definition: def, rev: f.rev })).status).toBe(409);
    const evil = JSON.parse(JSON.stringify(def)); evil.pages[0].fields[0].config = { expr: 'process.exit()' };
    expect((await mgr.put(`/apply/calls/${id}/form`, { definition: evil, rev: s1.body.rev })).status).toBe(422);
    const extra = JSON.parse(JSON.stringify(def)); extra.pages[0].script = '<script>';
    expect((await mgr.put(`/apply/calls/${id}/form`, { definition: extra, rev: s1.body.rev })).status).toBe(422);
    expect((await mgr.get(`/apply/calls/${id}/form`)).body.form.definition.pages[0].fields.map((x: { id: string }) => x.id)).toEqual(['full_name', 'email', 'motivation']);
  });

  it('publishes immutable versions; errors block; identical versions are refused', async () => {
    const f = (await mgr.post(`/apply/calls/${id}/form`, { template: 'youth_program' })).body.form;
    const broken: FormDef = JSON.parse(JSON.stringify(f.definition));
    broken.rules.push({ id: 'bad', when: { field: 'nope', op: 'empty' }, then: [{ type: 'hide', target: { kind: 'field', id: 'city' } }] });
    const r = (await mgr.put(`/apply/calls/${id}/form`, { definition: broken, rev: f.rev })).body;
    const blocked = await mgr.post(`/apply/calls/${id}/form/publish`, { rev: r.rev });
    expect(blocked.status).toBe(422);
    expect(blocked.body.details[0].message).toMatch(/no longer exists/);
    const fixed = (await mgr.put(`/apply/calls/${id}/form`, { definition: f.definition, rev: r.rev })).body;
    expect((await mgr.post(`/apply/calls/${id}/form/publish`, { rev: fixed.rev - 1 })).status).toBe(409);   // stale
    const p1 = await mgr.post(`/apply/calls/${id}/form/publish`, { rev: fixed.rev, note: 'First version' });
    expect(p1.body.version).toBe(1);
    expect((await mgr.post(`/apply/calls/${id}/form/publish`, { rev: fixed.rev })).body.error).toMatch(/Nothing changed/);
    const loaded = (await mgr.get(`/apply/calls/${id}/form`)).body;
    expect(loaded.unpublishedChanges).toBe(false);
    expect(loaded.versions[0]).toMatchObject({ number: 1, note: 'First version', current: true });
    const [v] = await h!.db.select().from(applyFormVersions).where(eq(applyFormVersions.callId, id));
    expect(v.sha256).toBe(defHash(f.definition));
    expect((await mgr.get(`/apply/calls/${id}/form/versions/1`)).body.number).toBe(1);
    expect((await h!.db.select().from(applyCallEvents).where(eq(applyCallEvents.kind, 'form_published'))).length).toBe(1);
  });

  it('once a call has opened, refuses versions that would break answers given; additions are fine', async () => {
    const f = (await mgr.post(`/apply/calls/${id}/form`, { template: 'youth_program' })).body.form;
    await mgr.post(`/apply/calls/${id}/form/publish`, { rev: f.rev });
    const rev = await client(h!.app, 'rev@afcd.test');
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'submit' });
    await rev.post(`/apply/calls/${id}/transition`, { action: 'approve' });
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'schedule' });
    await runCallSchedule(h!.db, zonedToUtc('2099-01-10T09:00', 'Africa/Casablanca')!);
    const def: FormDef = JSON.parse(JSON.stringify(f.definition));
    const removed: FormDef = JSON.parse(JSON.stringify(def));
    removed.pages[0].fields = removed.pages[0].fields.filter((x) => x.id !== 'city');
    let cur = (await mgr.put(`/apply/calls/${id}/form`, { definition: removed, rev: f.rev })).body;
    expect((await mgr.get(`/apply/calls/${id}/form`)).body.breaking).toHaveLength(1);
    const refused = await mgr.post(`/apply/calls/${id}/form/publish`, { rev: cur.rev });
    expect(refused.status).toBe(409);
    expect(refused.body.details[0].message).toMatch(/Town or city/);
    def.pages[0].fields.push({ id: 'heard_from', type: 'short_text', label: { en: 'How did you hear about us?' } });
    cur = (await mgr.put(`/apply/calls/${id}/form`, { definition: def, rev: cur.rev })).body;
    expect((await mgr.post(`/apply/calls/${id}/form/publish`, { rev: cur.rev })).body.version).toBe(2);
  });

  it('exports and imports forms as JSON, audited', async () => {
    const f = (await mgr.post(`/apply/calls/${id}/form`, { template: 'event' })).body.form;
    const res = await h!.app.request(`/studio/api/apply/calls/${id}/form/export`, { headers: { Cookie: mgr.cookie, Origin: ORIGIN } });
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="AFCD-\d{4}-001-form.json"/);
    const file = await res.json();
    expect(file).toMatchObject({ format: 'afcd-apply-form', formatVersion: 1 });
    const id2 = (await mgr.post('/apply/calls', { ...call, slug: 'second' })).body.id;
    const f2 = (await mgr.post(`/apply/calls/${id2}/form`, {})).body.form;
    expect((await mgr.post(`/apply/calls/${id2}/form/import`, { data: { ...file, format: 'other' }, rev: f2.rev })).status).toBe(422);
    expect((await mgr.post(`/apply/calls/${id2}/form/import`, { data: { ...file, formatVersion: 9 }, rev: f2.rev })).status).toBe(422);
    expect((await mgr.post(`/apply/calls/${id2}/form/import`, { data: file, rev: f2.rev })).status).toBe(200);
    expect(canonical((await mgr.get(`/apply/calls/${id2}/form`)).body.form.definition)).toBe(canonical(f.definition));
    // a template can replace the working form too
    const cur = (await mgr.get(`/apply/calls/${id2}/form`)).body.form;
    expect((await mgr.post(`/apply/calls/${id2}/form/template`, { template: 'training', rev: cur.rev })).status).toBe(200);
    const actions = (await h!.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['apply.form.export', 'apply.form.import', 'apply.form.template']));
  });

  it('lists forms per call with their status', async () => {
    const f = (await mgr.post(`/apply/calls/${id}/form`, { template: 'fellowship' })).body.form;
    await mgr.post('/apply/calls', { ...call, slug: 'no-form-yet' });
    await mgr.post(`/apply/calls/${id}/form/publish`, { rev: f.rev });
    const rows = (await mgr.get('/apply/forms')).body;
    const a = rows.find((r: { callId: string }) => r.callId === id);
    expect(a).toMatchObject({ version: 1, unpublishedChanges: false, errors: 0, pages: 4 });
    expect(rows.find((r: { callId: string }) => r.callId !== id)).toMatchObject({ formId: null, version: null });
  });
});

describe('apply templates', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'ar@afcd.test', 'application_reviewer');
  });

  it('lists ten built-ins, duplicates them into versioned custom templates, exports and imports', async () => {
    const mgr = await client(h!.app, 'mgr@afcd.test');
    const list = (await mgr.get('/apply/templates')).body;
    expect(list.filter((t: { builtIn: boolean }) => t.builtIn).map((t: { id: string }) => t.id)).toEqual(['youth_program', 'fellowship', 'training', 'volunteer', 'recruitment', 'grant', 'startup', 'event', 'expert', 'organization']);
    expect((await mgr.post('/apply/templates/youth_program/archive')).status).toBe(404);
    const dup = await mgr.post('/apply/templates', { meta: { name: 'Youth programme (Al Haouz)', category: 'youth_program' }, from: { template: 'youth_program' } });
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ version: 1, basedOn: 'youth_program' });
    const t = (await mgr.get(`/apply/templates/${dup.body.id}`)).body;
    t.definition.pages[0].title.en = 'Who you are';
    const s = await mgr.put(`/apply/templates/${t.id}`, { meta: { name: t.name, description: 'Edited', category: t.category }, definition: t.definition, version: 1 });
    expect(s.body.version).toBe(2);
    expect((await mgr.put(`/apply/templates/${t.id}`, { meta: { name: t.name, category: t.category }, definition: t.definition, version: 1 })).status).toBe(409);
    const res = await h!.app.request(`/studio/api/apply/templates/${t.id}/export`, { headers: { Cookie: mgr.cookie, Origin: ORIGIN } });
    const file = await res.json();
    expect(file).toMatchObject({ format: 'afcd-apply-template', version: 2, name: 'Youth programme (Al Haouz)' });
    const imp = await mgr.post('/apply/templates', { meta: { name: 'Imported' }, from: { data: file } });
    expect(imp.status).toBe(201);
    expect(imp.body.definition.pages[0].title.en).toBe('Who you are');
    expect((await mgr.post(`/apply/templates/${t.id}/archive`)).status).toBe(200);
    expect((await mgr.get('/apply/templates')).body.some((x: { id: string }) => x.id === t.id)).toBe(false);
    expect((await mgr.put(`/apply/templates/${t.id}`, { meta: { name: 'x y', category: 'other' }, definition: t.definition, version: 2 })).status).toBe(409);
    // read-only roles cannot change the library
    expect((await (await client(h!.app, 'ar@afcd.test')).post('/apply/templates', { meta: { name: 'Nope' }, from: { template: 'grant' } })).status).toBe(403);
  });
});
