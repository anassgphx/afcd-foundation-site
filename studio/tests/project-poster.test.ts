// Project cover with up to five places and a 1:1 poster that takes one of them.
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, addUser, client, projectInput, pngBytes, ORIGIN } from './helpers.ts';
import * as P from '../src/server/modules/projects/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('project cover and poster', () => {
  it('exports up to five cover photos, or four plus the poster', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    const up = async (name: string) => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(await pngBytes())], name));
      return (await (await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } })).json()).id as string; };
    const ids = [] as string[]; for (let i = 0; i < 7; i++) ids.push(await up(`test-cover-${i}.png`));
    const poster = await up('test-poster.png');

    const five = await ed.post('/projects', projectInput({ slug: 'five', name: 'Five', heroMediaId: ids[0], galleryMediaIds: ids.slice(1) }));
    const s5 = P.toSnapshot(await P.loadProject(h.db, five.body.id)).detail as { cover: { id: string }[]; poster: unknown };
    expect(s5.cover.map((c) => c.id)).toEqual(ids.slice(0, 5));
    expect(s5.poster).toBeNull();

    const withPoster = await ed.post('/projects', projectInput({ slug: 'with-poster', name: 'With poster', heroMediaId: ids[0], galleryMediaIds: ids.slice(1), posterMediaId: poster }));
    const full = await P.loadProject(h.db, withPoster.body.id);
    const s4 = P.toSnapshot(full);
    const d4 = s4.detail as { cover: { id: string }[]; poster: { id: string; w: number; h: number } };
    expect(d4.cover.map((c) => c.id)).toEqual(ids.slice(0, 4));   // the poster takes the fifth place
    expect(d4.poster).toMatchObject({ id: poster });
    expect(s4.media).toContain(poster);
    expect(P.publishProblems(full).join(' ')).toMatch(/alt text to “test-poster\.png”/);

    const lib = (await ed.get('/media/library')).body.items.find((m: { id: string }) => m.id === poster);
    expect(lib.usedOn).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'Project', where: 'Poster' })]));
    expect((await ed.post('/projects', projectInput({ slug: 'bad-poster', posterMediaId: '55555555-5555-4555-8555-555555555555' }))).status).toBe(422);
  });
});
