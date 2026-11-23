// Project page sections: programme objectives, outcomes and activities (with an optional photo).
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, addUser, client, projectInput } from './helpers.ts';
import { media } from '../src/server/db/schema.ts';
import * as P from '../src/server/modules/projects/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const sections = (photos: string[]) => ({
  programObjectives: [{ title: 'Train young people in civic leadership', text: '' }, { title: 'Support youth-led initiatives', text: 'In three regions.' }],
  outcomes: [{ title: 'Youth-led initiatives launched', text: '', figure: '12 initiatives' }, { title: '', text: 'Participants joined local councils.', figure: '' }],
  activityItems: [{ title: 'Leadership bootcamp', text: 'Five days in Marrakech.', mediaIds: photos }],
});

describe('project page sections', () => {
  it('saves, validates and exports the three lists; empty lists leave the export unchanged', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');

    // a project without the sections exports exactly as before (no new keys)
    const plain = await ed.post('/projects', projectInput());
    expect(plain.status).toBe(201);
    const before = P.toSnapshot(await P.loadProject(h.db, plain.body.id));
    expect(Object.keys(before.detail)).not.toContain('programObjectives');
    expect(Object.keys(before.detail)).not.toContain('outcomes');
    expect(Object.keys(before.detail)).not.toContain('activities');

    // validation: titles are required, an outcome needs a title or a text, photos must exist
    const bad1 = await ed.put(`/projects/${plain.body.id}`, projectInput({ programObjectives: [{ title: '', text: 'x' }] }));
    expect(bad1.status).toBe(422);
    const bad2 = await ed.put(`/projects/${plain.body.id}`, projectInput({ outcomes: [{ title: '', text: '', figure: '40' }] }));
    expect(bad2.status).toBe(422);
    const bad3 = await ed.put(`/projects/${plain.body.id}`, projectInput({ activityItems: [{ title: 'A', text: '', mediaIds: ['00000000-0000-4000-8000-000000000000'] }] }));
    expect(bad3.status).toBe(422);
    const bad4 = await ed.put(`/projects/${plain.body.id}`, projectInput({ programObjectives: Array.from({ length: 13 }, (_, i) => ({ title: `O${i}`, text: '' })) }));
    expect(bad4.status).toBe(422);

    // a photo without alt text or rights blocks review, like the gallery
    const [photo] = await h.db.insert(media).values({ originalName: 'bootcamp.jpg', storageKey: 'abc123', mime: 'image/jpeg', width: 1600, height: 1200, bytes: 1000, alt: '', rightsConfirmed: false }).returning();
    const [photo2] = await h.db.insert(media).values({ originalName: 'bootcamp-2.jpg', storageKey: 'def456', mime: 'image/jpeg', width: 1600, height: 1200, bytes: 1000, alt: 'Group work', rightsConfirmed: true }).returning();
    const ok = await ed.put(`/projects/${plain.body.id}`, projectInput(sections([photo2.id, photo.id])));
    expect(ok.status).toBe(200);
    const got = (await ed.get(`/projects/${plain.body.id}`)).body;
    expect(got.programObjectives).toHaveLength(2);
    expect(got.outcomes[0].figure).toBe('12 initiatives');
    expect(got.activityItems[0].mediaIds).toEqual([photo2.id, photo.id]);
    expect(got.linkedEvents).toEqual([]);
    expect(got.activityMedia[photo.id].originalName).toBe('bootcamp.jpg');
    expect(got.problems).toContain('Add alt text to “bootcamp.jpg”.');
    expect(got.problems).toContain('Confirm usage rights and consent for “bootcamp.jpg”.');

    // export: plain text, empty optional parts left out, the photo in the gallery's shape
    const snap = P.toSnapshot(await P.loadProject(h.db, plain.body.id));
    expect(snap.detail.programObjectives).toEqual([{ title: 'Train young people in civic leadership' }, { title: 'Support youth-led initiatives', text: 'In three regions.' }]);
    expect(snap.detail.outcomes).toEqual([{ title: 'Youth-led initiatives launched', figure: '12 initiatives' }, { text: 'Participants joined local councils.' }]);
    const act = (snap.detail.activities as { title: string; text: string; images: Record<string, unknown>[] }[])[0];
    expect(act.title).toBe('Leadership bootcamp');
    expect(act.images.map((m) => m.id)).toEqual([photo2.id, photo.id]);   // in the editor's order
    expect(act.images[1]).toMatchObject({ id: photo.id, w: expect.any(Number), h: expect.any(Number), alt: '' });
    expect(String(act.images[1].src)).toMatch(/^assets\/media\/abc123-\d+\.webp$/);
    expect(snap.media).toContain(photo.id);

    // removing the photos keeps the activity and drops the images
    await ed.put(`/projects/${plain.body.id}`, projectInput(sections([])));
    const snap2 = P.toSnapshot(await P.loadProject(h.db, plain.body.id));
    expect((snap2.detail.activities as { images?: unknown }[])[0].images).toBeUndefined();
    expect(snap2.media).not.toContain(photo.id);
    // too many photos for one activity
    const many = await ed.put(`/projects/${plain.body.id}`, projectInput(sections(Array.from({ length: 13 }, () => photo2.id))));
    expect(many.status).toBe(422);
  });
});
