// Project logo: a Media Library image with its framing (shape, fit, background, size), exported for the project summary.
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, addUser, client, projectInput, pngBytes, ORIGIN } from './helpers.ts';
import * as P from '../src/server/modules/projects/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('project logo', () => {
  it('saves the logo and its framing, checks it before review and exports it', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    const fd = new FormData(); fd.append('file', new File([new Uint8Array(await pngBytes())], 'test-logo.png'));
    const logo = await (await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } })).json();

    // without a logo nothing changes in the export
    const plain = await ed.post('/projects', projectInput());
    expect(P.toSnapshot(await P.loadProject(h.db, plain.body.id)).detail.logo).toBeNull();

    const style = { shape: '3:1', fit: 'cover', bg: 'pillar', size: 'l' };
    const r = await ed.post('/projects', projectInput({ slug: 'with-logo', name: 'With logo', logoMediaId: logo.id, logoStyle: style }));
    expect(r.status).toBe(201);
    const full = await P.loadProject(h.db, r.body.id);
    expect(full.logo?.id).toBe(logo.id);
    expect(P.publishProblems(full).join(' ')).toMatch(/rights and consent for “test-logo\.png”/);
    const snap = P.toSnapshot(full);
    expect(snap.detail.logo).toMatchObject({ id: logo.id, ...style });
    const lg = snap.detail.logo as { w: number; h: number }; expect(lg.w / lg.h).toBeCloseTo(800 / 600, 2);   // keeps the image proportions for the "original" shape
    expect(snap.media).toContain(logo.id);

    // only the known frames are accepted
    expect((await ed.post('/projects', projectInput({ slug: 'bad-logo', logoMediaId: logo.id, logoStyle: { ...style, shape: '5:7' } }))).status).toBe(422);
    expect((await ed.post('/projects', projectInput({ slug: 'bad-bg', logoMediaId: logo.id, logoStyle: { ...style, bg: 'url(x)' } }))).status).toBe(422);
    // the default framing when only the image is chosen
    const d = await ed.post('/projects', projectInput({ slug: 'default-logo', logoMediaId: logo.id }));
    expect(P.toSnapshot(await P.loadProject(h.db, d.body.id)).detail.logo).toMatchObject({ shape: 'original', fit: 'contain', bg: 'white', size: 'm' });

    // the Media Library knows the image is used, so it cannot be deleted
    const lib = (await ed.get('/media/library')).body.items.find((m: { id: string }) => m.id === logo.id);
    expect(lib.usedOn).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'Project', where: 'Logo' })]));
  });
});
