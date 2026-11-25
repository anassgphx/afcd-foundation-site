// A pillar's optional video, shown in the pillar page's overview instead of a still photo (the photo becomes its
// poster). Either a link to a video platform (YouTube, Vimeo, Dailymotion, Facebook, Instagram, TikTok) or an MP4/WebM
// file uploaded here. Platform players load only after the visitor presses play; uploaded files are copied into
// the website (assets/media/video/) when the pillar is published.
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import type { DB } from '../../db/client.ts';
import { AppError, perm, type Env } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';

/** Largest upload: GitHub Pages refuses files over 100 MB, and a pillar video should stay a short clip. */
export const VIDEO_MAX_BYTES = 95 * 1024 * 1024;
export const VIDEO_FILE = /^[0-9a-f]{32}\.(mp4|webm)$/;
export const videosDir = (cfg: Pick<Config, 'dataDir'>) => resolve(cfg.dataDir, 'videos');

export type VideoEmbed = { provider: string; id: string; embed: string; watch: string };
const PROVIDER_LABEL: Record<string, string> = { youtube: 'YouTube', vimeo: 'Vimeo', dailymotion: 'Dailymotion', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p;

/** A platform link → its player address (privacy-friendly where the platform offers it) and its public page. */
export function parseVideoUrl(raw: string): VideoEmbed | null {
  let u: URL; try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.|mobile\.)/, '').toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const id = host === 'youtu.be' ? seg[0] : u.searchParams.get('v') ?? (['shorts', 'embed', 'live', 'v'].includes(seg[0]) ? seg[1] : undefined);
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return { provider: 'youtube', id, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`, watch: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const nums = seg.filter((s) => /^\d{5,12}$/.test(s)); const id = nums[0];
    if (!id) return null;
    const after = seg[seg.indexOf(id) + 1]; const hash = u.searchParams.get('h') ?? (after && /^[0-9a-f]{6,20}$/.test(after) ? after : '');
    return { provider: 'vimeo', id, embed: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${hash ? `&h=${hash}` : ''}`, watch: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}` };
  }
  if (host === 'dailymotion.com' || host === 'dai.ly') {
    const id = host === 'dai.ly' ? seg[0] : seg[0] === 'video' ? seg[1]?.split('_')[0] : seg[0] === 'embed' && seg[1] === 'video' ? seg[2] : undefined;
    if (!id || !/^[a-z0-9]{5,12}$/i.test(id)) return null;
    return { provider: 'dailymotion', id, embed: `https://www.dailymotion.com/embed/video/${id}?autoplay=1`, watch: `https://www.dailymotion.com/video/${id}` };
  }
  if (host === 'facebook.com' || host === 'fb.watch' || host === 'web.facebook.com') {
    const id = u.searchParams.get('v') ?? seg.find((s) => /^\d{6,25}$/.test(s)) ?? (host === 'fb.watch' ? seg[0] : undefined);
    const isVideo = host === 'fb.watch' || seg.includes('videos') || seg[0] === 'watch' || seg[0] === 'reel' || seg.includes('reel');
    if (!id || !isVideo) return null;
    const href = `https://www.facebook.com${u.pathname}${u.searchParams.get('v') ? `?v=${u.searchParams.get('v')}` : ''}`;
    const watch = host === 'fb.watch' ? `https://fb.watch/${id}/` : href;
    return { provider: 'facebook', id, embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(watch)}&show_text=false&autoplay=true`, watch };
  }
  if (host === 'instagram.com') {
    const i = seg.findIndex((s) => s === 'p' || s === 'reel' || s === 'reels' || s === 'tv'); const id = i >= 0 ? seg[i + 1] : undefined;
    if (!id || !/^[\w-]{5,40}$/.test(id)) return null;
    const kind = seg[i] === 'p' ? 'p' : 'reel';
    return { provider: 'instagram', id, embed: `https://www.instagram.com/${kind}/${id}/embed/`, watch: `https://www.instagram.com/${kind}/${id}/` };
  }
  if (host === 'tiktok.com') {
    const i = seg.indexOf('video'); const id = i >= 0 ? seg[i + 1] : seg[0] === 'embed' ? seg[seg.length - 1] : undefined;
    if (!id || !/^\d{8,25}$/.test(id)) return null;
    return { provider: 'tiktok', id, embed: `https://www.tiktok.com/embed/v2/${id}`, watch: `https://www.tiktok.com${seg[0]?.startsWith('@') ? `/${seg[0]}` : ''}/video/${id}` };
  }
  return null;
}

/** What the pillar editor saves: a platform link, or an uploaded file (by its storage name). */
export const videoSchema = z.union([
  z.object({ kind: z.literal('embed'), url: z.string().trim().max(500) }).strict()
    .refine((v) => !!parseVideoUrl(v.url), { message: 'Use a video link from YouTube, Vimeo, Dailymotion, Facebook, Instagram or TikTok.', path: ['url'] }),
  z.object({ kind: z.literal('file'), file: z.string().regex(VIDEO_FILE), name: z.string().trim().max(200).default(''), bytes: z.number().int().min(1).max(VIDEO_MAX_BYTES) }).strict(),
]).nullable().default(null);
export type PillarVideo = z.infer<typeof videoSchema>;

/** The video as the website receives it (content.py inserts these values into attributes as they are). */
export function videoOut(v: PillarVideo | undefined, esc: (s: string) => string) {
  if (!v) return null;
  if (v.kind === 'file') return { kind: 'file', src: `assets/media/video/${v.file}`, mime: v.file.endsWith('.webm') ? 'video/webm' : 'video/mp4' };
  const e = parseVideoUrl(v.url); if (!e) return null;
  return { kind: 'embed', provider: e.provider, label: providerLabel(e.provider), embed: esc(e.embed), watch: esc(e.watch) };
}

/** The file's real type from its first bytes (never from the name or the browser's claim). */
function sniff(b: Uint8Array): 'mp4' | 'webm' | null {
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4';   // ....ftyp
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';   // EBML
  return null;
}

export function pillarVideoRoutes(api: Hono<Env>, db: DB, cfg: Config, actor: (c: never) => NonNullable<Actor>) {
  api.post('/pillars/videos', perm('pillar.update'), bodyLimit({ maxSize: VIDEO_MAX_BYTES + 256 * 1024, onError: () => { throw new AppError(422, 'The video is too large. Use a file under 95 MB, or a link to YouTube or Vimeo.'); } }), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new AppError(422, 'Choose a video file.');
    if (file.size > VIDEO_MAX_BYTES) throw new AppError(422, 'The video is too large. Use a file under 95 MB, or a link to YouTube or Vimeo.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = sniff(bytes);
    if (!ext) throw new AppError(422, 'Use an MP4 or WebM video file.');
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    mkdirSync(videosDir(cfg), { recursive: true });
    writeFileSync(resolve(videosDir(cfg), name), bytes);
    await audit(db, actor(c as never), 'pillar.video_upload', { type: 'video', id: name }, file.name.slice(0, 200), { bytes: bytes.byteLength });
    return c.json({ file: name, name: file.name.slice(0, 200), bytes: bytes.byteLength }, 201);
  });

  // Studio playback of an uploaded video, with byte ranges so the player can seek
  api.get('/pillars/videos/:file', perm('pillar.read'), (c) => {
    const name = c.req.param('file');
    if (!VIDEO_FILE.test(name)) throw new AppError(404, 'Video not found.');
    const p = resolve(videosDir(cfg), name);
    if (!existsSync(p)) throw new AppError(404, 'Video not found.');
    const size = statSync(p).size; const type = name.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    if (!m) return c.body(readFileSync(p), 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size), 'Cache-Control': 'private, max-age=3600' });
    let start = 0, end = size - 1;
    start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])); end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    end = Math.min(end, start + 4 * 1024 * 1024 - 1);   // at most 4 MB per answer
    const buf = Buffer.alloc(end - start + 1); const fd = openSync(p, 'r');
    try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
    return c.body(buf, 206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Cache-Control': 'private, max-age=3600' });
  });
}
