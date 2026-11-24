import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, projectInput, ORIGIN } from './helpers.ts';
import * as t from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

/** A test gradient: left to right gets lighter ("up") or darker ("down"). Clearly synthetic, nothing like a real photo. */
async function gradient(dir: 'up' | 'down', w = 640, hgt = 480, fmt: 'png' | 'jpeg' = 'png') {
  const px = Buffer.alloc(w * hgt * 3);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const v = Math.round((dir === 'up' ? x : w - 1 - x) / (w - 1) * 255); px.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3); }
  const img = sharp(px, { raw: { width: w, height: hgt, channels: 3 } });
  return fmt === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 70 }).toBuffer();
}

describe('media library', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'mm@afcd.test', 'media_manager'); await addUser(h.db, 'ro@afcd.test', 'read_only');
  });
  const send = async (who: Awaited<ReturnType<typeof client>>, path: string, bytes: Buffer, name: string) => {
    const fd = new FormData(); fd.append('file', new File([new Uint8Array(bytes)], name));
    const r = await h.app.request(`/studio/api${path}`, { method: 'POST', body: fd, headers: { Cookie: who.cookie, Origin: ORIGIN, 'X-CSRF-Token': who.csrf } });
    return { status: r.status, body: await r.json() as any };
  };

  it('lists usage, what each image still needs, and duplicates', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const a = (await send(ed, '/media', await gradient('up'), 'test-gradient-a.png')).body;
    const copy = (await send(ed, '/media', await gradient('up'), 'test-gradient-a-again.png')).body;
    const small = (await send(ed, '/media', await gradient('up', 320, 240, 'jpeg'), 'test-gradient-small.jpg')).body;
    const other = (await send(ed, '/media', await gradient('down'), 'test-gradient-b.png')).body;
    await ed.raw('PATCH', `/media/${a.id}`, { alt: 'Test gradient', credit: 'Test', rightsConfirmed: true });
    const p = (await ed.post('/projects', projectInput({ heroMediaId: a.id }))).body;

    const lib = (await ed.get('/media/library')).body;
    expect(lib.total).toBe(4);
    const by = Object.fromEntries(lib.items.map((m: any) => [m.id, m]));
    expect(by[a.id].issues).toEqual([]);
    expect(by[copy.id].issues).toEqual(['alt', 'credit', 'rights']);
    expect(by[a.id].usedOn).toEqual([{ kind: 'Project', title: 'Green Schools', href: `/studio/projects/${p.id}`, where: 'Main photo', live: false }]);
    expect(by[copy.id].usedOn).toEqual([]);
    expect(by[a.id].uploadedByName).toBe('ed');
    // the same bytes twice are exact; the smaller JPEG looks the same; the reversed gradient does not
    expect(by[copy.id].duplicateOf.ids).toEqual(expect.arrayContaining([a.id, small.id]));
    expect(by[small.id].duplicateOf.exact).toBe(false);
    expect(by[other.id].duplicateOf).toBeNull();

    // in use: delete is refused and names where; unused: delete works
    const blocked = await ed.raw('DELETE', `/media/${a.id}`);
    expect([403, 409, 422]).toContain(blocked.status);
    const mm = await client(h.app, 'mm@afcd.test');
    const refused = await mm.raw('DELETE', `/media/${a.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/1 place/);
    expect((await mm.raw('DELETE', `/media/${copy.id}`)).status).toBe(200);
  });

  it('replaces a file in place, keeping its references and file names', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const a = (await send(ed, '/media', await gradient('up'), 'test-gradient-a.png')).body;
    await ed.raw('PATCH', `/media/${a.id}`, { alt: 'Test gradient', rightsConfirmed: true });
    const p = (await ed.post('/projects', projectInput({ heroMediaId: a.id }))).body;
    const before = readdirSync(h.cfg.mediaDir).filter((f) => f.startsWith(a.storageKey)).sort();

    const r = await send(ed, `/media/${a.id}/replace`, await gradient('down', 1200, 900, 'jpeg'), 'test-gradient-new.jpg');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: a.id, storageKey: a.storageKey, width: 1200, height: 900, mime: 'image/jpeg', rightsConfirmed: false, alt: 'Test gradient' });
    const after = readdirSync(h.cfg.mediaDir).filter((f) => f.startsWith(a.storageKey)).sort();
    for (const f of before.filter((x) => !x.includes('.orig.'))) expect(after).toContain(f);
    expect(after).toContain(`${a.storageKey}.orig.jpg`);
    expect(after.some((f) => f.endsWith('.orig.png'))).toBe(false);
    expect((await ed.get(`/projects/${p.id}`)).body.heroMediaId).toBe(a.id);

    // not an image: refused and nothing changes
    const bad = await send(ed, `/media/${a.id}/replace`, Buffer.from('not an image'), 'notes.txt');
    expect(bad.status).toBe(422);
    expect(existsSync(join(h.cfg.mediaDir, `${a.storageKey}.orig.jpg`))).toBe(true);

    // the original downloads as an attachment
    const dl = await h.app.request(`/studio/api/media/${a.id}/original`, { headers: { Cookie: ed.cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toMatch(/attachment; filename="test-gradient-a\.jpg"/);
    expect((await sharp(Buffer.from(await dl.arrayBuffer())).metadata()).width).toBe(1200);

    const [log] = await h.db.select().from(t.auditLog).where(eq(t.auditLog.action, 'media.replace'));
    expect(log.summary).toMatch(/test-gradient-new\.jpg/);
  });

  it('edits many images at once, within permissions', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), ro = await client(h.app, 'ro@afcd.test');
    const a = (await send(ed, '/media', await gradient('up'), 'test-a.png')).body;
    const b = (await send(ed, '/media', await gradient('down'), 'test-b.png')).body;
    await ed.raw('PATCH', `/media/${a.id}`, { tags: ['old', 'keep'] });

    const r = await ed.post('/media/bulk', { ids: [a.id, b.id], addTags: ['argan', 'test'], removeTags: ['old'], credit: 'Test credit', rightsConfirmed: true });
    expect(r.body).toEqual({ updated: 2 });
    const rows = await h.db.select().from(t.media);
    const ra = rows.find((m) => m.id === a.id)!, rb = rows.find((m) => m.id === b.id)!;
    expect(ra.tags).toEqual(['keep', 'argan', 'test']);
    expect(rb).toMatchObject({ tags: ['argan', 'test'], credit: 'Test credit', rightsConfirmed: true });

    expect((await ed.post('/media/bulk', { ids: [a.id], unknown: 1 })).status).toBe(422);
    expect((await ed.post('/media/bulk', { ids: [] })).status).toBe(422);
    expect((await ro.post('/media/bulk', { ids: [a.id], credit: 'x' })).status).toBe(403);
    expect((await send(ro, `/media/${a.id}/replace`, await gradient('up'), 'x.png')).status).toBe(403);
    expect((await ro.get('/media/library')).status).toBe(200);
    expect((await h.db.select().from(t.auditLog).where(eq(t.auditLog.action, 'media.bulk_update'))).length).toBe(1);
  });

  it('stores licence and an optional rights end date, and flags expired rights', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), ro = await client(h.app, 'ro@afcd.test');
    const a = (await send(ed, '/media', await gradient('up'), 'test-licence-a.png')).body;
    const b = (await send(ed, '/media', await gradient('down'), 'test-licence-b.png')).body;
    const ok = await ed.raw('PATCH', `/media/${a.id}`, { alt: 'Test gradient', credit: 'Test', rightsConfirmed: true, licence: 'CC BY 4.0', rightsExpiresOn: '2000-01-31' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ licence: 'CC BY 4.0', rightsExpiresOn: '2000-01-31' });
    expect((await ed.raw('PATCH', `/media/${a.id}`, { rightsExpiresOn: '31/01/2000' })).status).toBe(422);
    expect((await ed.raw('PATCH', `/media/${a.id}`, { rightsExpiresOn: '2000-13-45' })).status).toBe(422);

    let lib = (await ed.get('/media/library')).body;
    expect(lib.items.find((m: any) => m.id === a.id).issues).toEqual(['expired']);

    // clearing the end date removes the flag; a future date never raises it
    await ed.raw('PATCH', `/media/${a.id}`, { rightsExpiresOn: null });
    const r = await ed.post('/media/bulk', { ids: [b.id], licence: 'Used with permission', rightsExpiresOn: '2999-12-31' });
    expect(r.body).toEqual({ updated: 1 });
    lib = (await ed.get('/media/library')).body;
    const by = Object.fromEntries(lib.items.map((m: any) => [m.id, m]));
    expect(by[a.id]).toMatchObject({ issues: [], rightsExpiresOn: null });
    expect(by[b.id]).toMatchObject({ licence: 'Used with permission', rightsExpiresOn: '2999-12-31' });
    expect(by[b.id].issues).not.toContain('expired');
    expect((await ro.raw('PATCH', `/media/${a.id}`, { licence: 'x' })).status).toBe(403);
    const [log] = await h.db.select().from(t.auditLog).where(eq(t.auditLog.action, 'media.bulk_update'));
    expect(log.summary).toMatch(/licence “Used with permission”; rights until 2999-12-31/);
  });

  it('deletes an image that is in use when asked to, and restores it from the trash', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), mm = await client(h.app, 'mm@afcd.test'), ro = await client(h.app, 'ro@afcd.test');
    const a = (await send(ed, '/media', await gradient('up'), 'test-trash-a.png')).body;
    const b = (await send(ed, '/media', await gradient('down'), 'test-trash-b.png')).body;
    const p = (await ed.post('/projects', projectInput({ heroMediaId: a.id, galleryMediaIds: [a.id, b.id], activityItems: [{ title: 'Test activity', mediaIds: [a.id, b.id] }] }))).body;

    expect((await mm.raw('DELETE', `/media/${a.id}`)).status).toBe(409);              // in use: needs force
    expect((await ro.raw('DELETE', `/media/${a.id}?force=1`)).status).toBe(403);
    const del = await mm.raw('DELETE', `/media/${a.id}?force=1`);
    expect(del.status).toBe(200);
    expect(del.body.wasUsedIn).toBeGreaterThanOrEqual(3);

    // the project keeps working, without the image: no main photo, gallery and activity keep only the other photo
    let proj = (await ed.get(`/projects/${p.id}`)).body;
    expect(proj.heroMediaId).toBeNull();
    expect(proj.gallery.map((m: any) => m.id)).toEqual([b.id]);
    expect(proj.activityItems[0].mediaIds).toEqual([b.id]);
    expect((await ed.raw('PUT', `/projects/${p.id}`, projectInput({ heroMediaId: null, galleryMediaIds: [b.id], activityItems: proj.activityItems }))).status).toBe(200);

    // files are in the trash, not in the library
    expect(readdirSync(h.cfg.mediaDir).some((f) => f.startsWith(a.storageKey))).toBe(false);
    expect(readdirSync(join(h.cfg.mediaDir, '.trash', a.id))).toContain('record.json');
    expect((await ed.get('/media/library')).body.items.map((m: any) => m.id)).not.toContain(a.id);
    const trash = (await ed.get('/media/trash')).body;
    expect(trash.items).toHaveLength(1);
    expect(trash.items[0]).toMatchObject({ row: { id: a.id, originalName: 'test-trash-a.png' } });
    expect(trash.items[0].usedOn.length).toBeGreaterThanOrEqual(3);
    const [log] = await h.db.select().from(t.auditLog).where(eq(t.auditLog.action, 'media.delete'));
    expect(log.summary).toMatch(/was used in \d+ places; moved to the trash/);

    // restore: the image comes back where nothing else was chosen meanwhile
    expect((await ro.post(`/media/trash/${a.id}/restore`, {})).status).toBe(403);
    const r = await mm.post(`/media/trash/${a.id}/restore`, {});
    expect(r.status).toBe(200);
    proj = (await ed.get(`/projects/${p.id}`)).body;
    expect(proj.heroMediaId).toBe(a.id);
    expect(proj.gallery.map((m: any) => m.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(proj.activityItems[0].mediaIds).toEqual([a.id, b.id]);
    expect(readdirSync(h.cfg.mediaDir).some((f) => f === `${a.storageKey}-480.webp`)).toBe(true);
    expect(existsSync(join(h.cfg.mediaDir, '.trash', a.id))).toBe(false);
    expect((await ed.get('/media/trash')).body.items).toEqual([]);
    expect((await mm.post(`/media/trash/${a.id}/restore`, {})).status).toBe(404);

    // unused images go to the trash too, without force
    expect((await mm.raw('DELETE', `/media/${(await send(ed, '/media', await gradient('up', 200, 200), 'test-trash-c.png')).body.id}`)).status).toBe(200);
    expect((await ed.get('/media/trash')).body.items).toHaveLength(1);
  });

  it('restores images deleted together one by one, back into the same activity', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), mm = await client(h.app, 'mm@afcd.test');
    const a = (await send(ed, '/media', await gradient('up'), 'test-pair-a.png')).body;
    const b = (await send(ed, '/media', await gradient('down'), 'test-pair-b.png')).body;
    const p = (await ed.post('/projects', projectInput({ activityItems: [{ title: 'Test activity', mediaIds: [a.id, b.id] }] }))).body;
    for (const m of [a, b]) expect((await mm.raw('DELETE', `/media/${m.id}?force=1`)).status).toBe(200);
    expect((await ed.get(`/projects/${p.id}`)).body.activityItems[0].mediaIds).toEqual([]);
    expect((await mm.post(`/media/trash/${a.id}/restore`, {})).body).toMatchObject({ notRestored: 0 });
    expect((await ed.get(`/projects/${p.id}`)).body.activityItems[0].mediaIds).toEqual([a.id]);
    expect((await mm.post(`/media/trash/${b.id}/restore`, {})).body).toMatchObject({ notRestored: 0 });
    const ids = (await ed.get(`/projects/${p.id}`)).body.activityItems[0].mediaIds;   // both back (order may differ)
    expect(ids).toHaveLength(2); expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});
