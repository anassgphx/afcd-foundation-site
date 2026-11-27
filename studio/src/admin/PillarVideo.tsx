// A pillar's optional video (pillar editor → Photo and video): a link to a video platform, or an MP4/WebM upload.
// The server checks the link (modules/pillars/video.ts) and the file's real type; the pillar photo is the poster.
import { useRef, useState } from 'react';
import { api } from './api.ts';
import { Icon } from './ui.tsx';
import './pillar-video.css';

export type PillarVideo = { kind: 'embed'; url: string } | { kind: 'file'; file: string; name: string; bytes: number } | null;

/** Which platform a link points to (the server does the full check when the pillar is saved). */
export function videoProvider(url: string): string | null {
  let h = ''; try { h = new URL(url.trim()).hostname.replace(/^(www\.|m\.|web\.)/, ''); } catch { return null; }
  return /(^|\.)youtube\.com$|^youtu\.be$/.test(h) ? 'YouTube' : /vimeo\.com$/.test(h) ? 'Vimeo' : /dailymotion\.com$|^dai\.ly$/.test(h) ? 'Dailymotion'
    : /facebook\.com$|^fb\.watch$/.test(h) ? 'Facebook' : /instagram\.com$/.test(h) ? 'Instagram' : /tiktok\.com$/.test(h) ? 'TikTok' : null;
}
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function PillarVideoField({ value, onChange, disabled, hasPhoto }: { value: PillarVideo; onChange: (v: PillarVideo) => void; disabled?: boolean; hasPhoto: boolean }) {
  const [mode, setMode] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const provider = videoProvider(url);

  async function upload(file: File) {
    setErr('');
    if (!/^video\/(mp4|webm)$/.test(file.type) && !/\.(mp4|webm)$/i.test(file.name)) { setErr('Use an MP4 or WebM video file.'); return; }
    if (file.size > 95 * 1024 * 1024) { setErr(`This file is ${mb(file.size)}. Use a file under 95 MB, or put the video on YouTube or Vimeo and paste its link.`); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api<{ file: string; name: string; bytes: number }>('/pillars/videos', { method: 'POST', body: fd });
      onChange({ kind: 'file', file: r.file, name: r.name, bytes: r.bytes });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  if (value) return <div className="pv">
    {value.kind === 'file'
      ? <video className="pv-player" src={`/studio/api/pillars/videos/${value.file}`} controls preload="metadata" />
      : <div className="pv-link"><span className="pv-prov">{videoProvider(value.url) ?? 'Video'}</span><a href={value.url} target="_blank" rel="noopener" className="pv-url">{value.url}<Icon n="ext" width={13} height={13} /></a></div>}
    <div className="pv-meta">
      <span>{value.kind === 'file' ? <>Uploaded file · {value.name || value.file} · {mb(value.bytes)}</> : <>Plays on the page from {videoProvider(value.url) ?? 'the platform'}, only after the visitor presses play.</>}</span>
      {!disabled && <button type="button" className="btn btn-sm" onClick={() => onChange(null)}><Icon n="x" />Remove video</button>}
    </div>
    {!hasPhoto && <p className="pv-note"><Icon n="alert" width={14} height={14} />Choose a photo above as well: it is the poster shown before the video plays.</p>}
  </div>;

  return <div className="pv">
    <div className="seg pv-seg" role="tablist" aria-label="Video source">
      <button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'on' : ''} onClick={() => { setMode('link'); setErr(''); }} disabled={disabled}>Paste a link</button>
      <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'on' : ''} onClick={() => { setMode('file'); setErr(''); }} disabled={disabled}>Upload a file</button>
    </div>
    {mode === 'link'
      ? <div className="pv-row">
          <input className="input" type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} disabled={disabled} aria-label="Video link" />
          <button type="button" className="btn btn-primary" disabled={disabled || !provider} onClick={() => { onChange({ kind: 'embed', url: url.trim() }); setUrl(''); }}>Add video</button>
        </div>
      : <button type="button" className="ed-drop pv-drop" disabled={disabled || busy} onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !disabled) upload(f); }}>
          <Icon n="upload" /><b>{busy ? 'Uploading…' : 'Choose a video file'}</b><small>MP4 or WebM, up to 95 MB. Drop it here or click.</small>
        </button>}
    <input ref={input} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
    <small className="pv-hint">{mode === 'link'
      ? (url && !provider ? 'This link isn’t from a supported platform. Use YouTube, Vimeo, Dailymotion, Facebook, Instagram or TikTok.' : provider ? `${provider} link recognised.` : 'YouTube, Vimeo, Dailymotion, Facebook, Instagram or TikTok. The player loads only when a visitor presses play.')
      : 'Short clips work best. Longer videos are better on YouTube or Vimeo, then pasted as a link.'}</small>
    {err && <p className="pv-err" role="alert">{err}</p>}
  </div>;
}
