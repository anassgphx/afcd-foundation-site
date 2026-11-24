// Partners chosen in the project editor: the same links as the Partners editor, exported for the project page.
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, addUser, client, projectInput } from './helpers.ts';
import * as P from '../src/server/modules/projects/service.ts';
import * as PT from '../src/server/modules/partners/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('project partners', () => {
  it('links partners from the project, shows them in the partner editor and exports only published ones', async () => {
    h = await makeApp({ partners: [{ scope: 'International', names: ['Test Partner One', 'Test Partner Two'] }] });
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    const all = await PT.listPartners(h.db);
    const [one, two] = all.filter((x) => x.name.startsWith('Test Partner'));
    expect(one.publishedRevisionId && two.publishedRevisionId).toBeTruthy();
    // a draft partner that isn't on the website yet
    const draft = await ed.post('/partners', { name: 'Test Draft Partner', slug: 'test-draft-partner', scope: 'local', category: '', description: '', websiteUrl: '', sinceYear: null, current: true, logoMediaId: null, projectSlugs: [], sort: 900, provenance: 'Test' });
    expect(draft.status).toBe(201);

    const r = await ed.post('/projects', projectInput({ slug: 'with-partners', name: 'With partners', partnerSlugs: [two.slug, one.slug, 'test-draft-partner'] }));
    expect(r.status).toBe(201);
    const full = await P.loadProject(h.db, r.body.id);
    expect(full.partnerLinks.map((x) => [x.name, x.live])).toEqual(expect.arrayContaining([['Test Partner One', true], ['Test Partner Two', true], ['Test Draft Partner', false]]));
    expect((P.toSnapshot(full).detail as { partners: { name: string }[] }).partners.map((x) => x.name).sort()).toEqual(['Test Partner One', 'Test Partner Two']);

    // the partner editor sees the same link
    const p1 = await ed.get(`/partners/${one.id}`);
    expect(p1.body.projectSlugs).toContain('with-partners');

    // removing it from the project removes the link
    await ed.put(`/projects/${r.body.id}`, projectInput({ slug: 'with-partners', name: 'With partners', partnerSlugs: [two.slug] }));
    expect((await ed.get(`/partners/${one.id}`)).body.projectSlugs).not.toContain('with-partners');
    expect((await ed.post('/projects', projectInput({ slug: 'bad-partner', partnerSlugs: ['no-such-partner'] }))).status).toBe(422);
  });
});
