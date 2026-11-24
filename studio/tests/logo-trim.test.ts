// Partner logos: empty margins around the mark are trimmed when the logo is chosen (src/server/modules/media/trim.ts).
// The test logo is a plain synthetic shape, nothing like a real organisation's logo.
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import * as t from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

/** 480×480 transparent canvas with a 200×60 dark bar in the middle: a "wide logo" lost in a square file. */
const paddedLogo = () => sharp({ create: { width: 480, height: 480, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: 200, height: 60, channels: 4, background: { r: 20, g: 40, b: 90, alpha: 1 } } }, left: 140, top: 210 }]).png().toBuffer();

describe('partner logo trim', () => {
  it('crops a newly chosen logo to its mark (with a little room), keeps a chosen crop, and is undone by Reset', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    const fd = new FormData(); fd.append('file', new File([new Uint8Array(await paddedLogo())], 'test-logo.png'));
    const up = await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } });
    expect(up.status).toBe(201);
    const m = await up.json() as { id: string; width: number; height: number };
    expect([m.width, m.height]).toEqual([480, 480]);

    const p = await ed.post('/partners', { name: 'Test Trim Partner', slug: 'test-trim-partner', scope: 'national', category: '', description: '', websiteUrl: '', sinceYear: null, current: true, logoMediaId: m.id, projectSlugs: [], sort: 500, provenance: 'Test' });
    expect(p.status).toBe(201);
    const [row] = await h.db.select().from(t.media).where(eq(t.media.id, m.id));
    expect(row.crop).not.toBeNull();
    expect(row.width).toBeGreaterThanOrEqual(200); expect(row.width).toBeLessThan(230);   // 200 px mark + about 3% room each side
    expect(row.height).toBeGreaterThanOrEqual(60); expect(row.height).toBeLessThan(90);
    expect(row.width / row.height).toBeGreaterThan(2.4);   // it now reads as the wide logo it is

    // saving again doesn't trim again (an existing crop, trimmed or chosen, is kept)
    const again = await ed.put(`/partners/${p.body.id}`, { name: 'Test Trim Partner', slug: 'test-trim-partner', scope: 'national', category: '', description: '', websiteUrl: '', sinceYear: null, current: true, logoMediaId: m.id, projectSlugs: [], sort: 500, provenance: 'Test' });
    expect(again.status).toBe(200);
    const [row2] = await h.db.select().from(t.media).where(eq(t.media.id, m.id));
    expect(row2.crop).toEqual(row.crop);
    // Reset in the crop tool brings the whole original back
    expect((await ed.post(`/media/${m.id}/crop`, { crop: null })).status).toBe(200);
    const [row3] = await h.db.select().from(t.media).where(eq(t.media.id, m.id));
    expect([row3.width, row3.height, row3.crop]).toEqual([480, 480, null]);
  });
});
