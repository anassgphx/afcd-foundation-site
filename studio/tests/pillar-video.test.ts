// A pillar's optional video: platform links (checked and turned into privacy-friendly players), MP4/WebM uploads
// (checked by their bytes), and publishing (the uploaded file is copied into the website; unused ones are removed).
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client, fakeRunner, ORIGIN } from './helpers.ts';
import { importPillars, readSitePillars } from '../src/server/modules/pillars/service.ts';
import { parseVideoUrl } from '../src/server/modules/pillars/video.ts';
import { loadConfig } from '../src/server/config.ts';
import { resolve } from 'node:path';

const SITE_PILLARS = readSitePillars({ siteRoot: resolve(import.meta.dirname, '../..') } as ReturnType<typeof loadConfig>);
let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });
const editable = (p: any) => { const { key: _k, number: _n, publicFile: _f, ...c } = p.content; return c; };
const mp4 = () => { const b = new Uint8Array(4096); b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]); return b; };

describe('pillar video', () => {
  it('recognises platform links and refuses others', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toMatchObject({ provider: 'youtube', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1' });
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://youtube.com/shorts/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://vimeo.com/76979871')).toMatchObject({ provider: 'vimeo', embed: 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1' });
    expect(parseVideoUrl('https://www.dailymotion.com/video/x8abc12')?.provider).toBe('dailymotion');
    expect(parseVideoUrl('https://www.facebook.com/AFCD/videos/1234567890123/')?.provider).toBe('facebook');
    expect(parseVideoUrl('https://www.instagram.com/reel/C1abcDEF23/')).toMatchObject({ provider: 'instagram', embed: 'https://www.instagram.com/reel/C1abcDEF23/embed/' });
    expect(parseVideoUrl('https://www.tiktok.com/@afcd/video/7234567890123456789')).toMatchObject({ provider: 'tiktok', embed: 'https://www.tiktok.com/embed/v2/7234567890123456789' });
    for (const bad of ['https://example.com/video.mp4', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=short', 'https://www.facebook.com/AFCD', 'not a link']) expect(parseVideoUrl(bad)).toBeNull();
  });

  it('uploads MP4/WebM only, saves link or file, and publishes the file into the website', async () => {
    h = await makeApp({ runner: fakeRunner() });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'admin@afcd.test', 'super_admin');
    const ed = await client(h.app, 'ed@afcd.test'); const admin = await client(h.app, 'admin@afcd.test');
    await importPillars(h.db, h.cfg, null, SITE_PILLARS);
    const youth = (await ed.get('/pillars/records')).body.find((p: any) => p.key === 'youth-empowerment');
    const { body: p } = await ed.get(`/pillars/${youth.id}`);
    expect(p.content.video).toBeNull();

    const up = async (bytes: Uint8Array, name: string) => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(bytes)], name));
      const r = await h.app.request('/studio/api/pillars/videos', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } });
      return { status: r.status, body: await r.json() as any }; };
    expect((await up(new TextEncoder().encode('<html>not a video</html>'), 'fake.mp4')).status).toBe(422);
    const ok = await up(mp4(), 'clip.mp4');
    expect(ok.status).toBe(201); expect(ok.body.file).toMatch(/^[0-9a-f]{32}\.mp4$/);
    const play = await h.app.request(`/studio/api/pillars/videos/${ok.body.file}`, { headers: { Cookie: ed.cookie, Range: 'bytes=0-99' } });
    expect(play.status).toBe(206); expect(play.headers.get('content-range')).toBe('bytes 0-99/4096');

    // a link from an unknown site is refused; a YouTube link and an uploaded file are saved
    expect((await ed.put(`/pillars/${p.id}`, { ...editable(p), video: { kind: 'embed', url: 'https://example.com/x' } })).status).toBe(422);
    expect((await ed.put(`/pillars/${p.id}`, { ...editable(p), video: { kind: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' } })).status).toBe(200);
    expect((await ed.get(`/pillars/${p.id}`)).body.content.video).toEqual({ kind: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect((await ed.put(`/pillars/${p.id}`, { ...editable(p), video: { kind: 'file', file: ok.body.file, name: 'clip.mp4', bytes: 4096 } })).status).toBe(200);

    // through review to the website: pillars.json carries the video, the file is in assets/media/video/
    expect((await ed.post(`/pillars/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await admin.post(`/pillars/${p.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await admin.post(`/pillars/${p.id}/publish`)).status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/pillars.json'), 'utf8'));
    expect(data.pillars.find((x: any) => x.key === 'youth-empowerment').video).toEqual({ kind: 'file', src: `assets/media/video/${ok.body.file}`, mime: 'video/mp4' });
    expect(existsSync(join(h.siteRoot, 'assets/media/video', ok.body.file))).toBe(true);
  });
});
