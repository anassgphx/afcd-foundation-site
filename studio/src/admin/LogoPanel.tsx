// Project logo panel (project editor): choose or upload the logo, frame it, and see it exactly as the website shows it,
// a badge on the cover's top corner (desktop and phone), with the file's details and warnings that matter for a logo.
// The sizes and rules mirror "Project logo: a badge on the cover" in the site's input.css.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { patch } from './api.ts';
import { Icon, useCan, useToast } from './ui.tsx';
import { MediaPicker, upload, type MediaItem } from './pages/Media.tsx';
import './logo-panel.css';

export type LogoStyle = { shape: string; fit: 'contain' | 'cover'; bg: 'none' | 'white' | 'light' | 'dark' | 'pillar'; size: 's' | 'm' | 'l' };
const FRAMES: [string, string][] = [['1:1', 'Square'], ['circle', 'Circle'], ['3:1', 'Wide 3:1'], ['2:1', 'Wide 2:1'], ['4:3', '4:3'], ['16:9', '16:9'], ['3:4', 'Tall 3:4'], ['1:3', 'Tall 1:3']];
const BGS: [LogoStyle['bg'], string][] = [['white', 'White card'], ['light', 'Light card'], ['dark', 'Dark card'], ['pillar', 'Pillar colour'], ['none', 'No background']];
// badge heights in px, as on the website: [desktop, phone], normal and tall shapes
const H = { s: [56, 44], m: [76, 56], l: [100, 72] } as const;
const H_TALL = { s: [84, 64], m: [112, 84], l: [148, 108] } as const;
const BG_RGB: Record<string, [number, number, number]> = { white: [255, 255, 255], light: [245, 245, 244], dark: [23, 23, 23], none: [210, 210, 210] };

type Analysis = { alpha: boolean; lum: number };
/** Whether the logo has transparent pixels, and the average lightness of its visible pixels (0 dark – 1 light). */
function useAnalysis(src: string | undefined) {
  const [a, setA] = useState<Analysis | null>(null);
  useEffect(() => {
    setA(null); if (!src) return;
    const img = new Image(); img.decoding = 'async';
    img.onload = () => {
      try {
        const w = 64, h = Math.max(1, Math.round(64 * img.height / img.width)); const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
        let alpha = false, sum = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 250) alpha = true; if (d[i + 3] > 40) { sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; } }
        setA({ alpha, lum: n ? sum / n : 1 });
      } catch { setA(null); }
    };
    img.src = src;
  }, [src]);
  return a;
}
const relLum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const hexRgb = (h: string) => { const m = h.replace('#', ''); const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };

function Badge({ m, st, tone, phone }: { m: MediaItem; st: LogoStyle; tone: string; phone?: boolean }) {
  const framed = st.shape !== 'original';
  const ratio = !framed ? `${m.width} / ${m.height}` : st.shape === 'circle' ? '1 / 1' : st.shape.replace(':', ' / ');
  const tall = st.shape === '3:4' || st.shape === '1:3' || (!framed && m.height > m.width);
  const h = (tall ? H_TALL : H)[st.size][phone ? 1 : 0];
  return <span className={`lp-badge bg-${st.bg}${st.shape === 'circle' ? ' round' : ''}${framed && st.fit === 'cover' ? ' cover' : ''}`}
    style={{ height: h, aspectRatio: ratio, top: phone ? 14 : 22, insetInlineStart: phone ? 14 : 22, ['--pc' as string]: tone }}>
    <img src={m.large ?? m.url} alt="" style={{ objectPosition: `${m.focalX}% ${m.focalY}%` }} /></span>;
}

/** A cover drawn at its real width and scaled to fit, so the badge keeps its true proportion. */
function Stage({ width, ratio, cover, children, label }: { width: number; ratio: string; cover: MediaItem | null; children: React.ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null); const [k, setK] = useState(0.4);
  useLayoutEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setK(el.clientWidth / width)); ro.observe(el); return () => ro.disconnect(); }, [width]);
  return <figure className="lp-stage-f"><div ref={box} className="lp-stage" style={{ aspectRatio: ratio }}>
    <div className="lp-cover" style={{ width, transform: `scale(${k})`, aspectRatio: ratio }}>
      {cover ? <img className="lp-cover-img" src={cover.large ?? cover.url} alt="" style={{ objectPosition: `${cover.focalX}% ${cover.focalY}%` }} /> : <span className="lp-cover-ph">Cover photo</span>}
      {children}
    </div></div><figcaption>{label}</figcaption></figure>;
}

export function LogoPanel({ logo, style, onStyle, onLogo, cover, tone, ro }: {
  logo: MediaItem | null; style: LogoStyle; onStyle: (s: LogoStyle) => void; onLogo: (m: MediaItem | null) => void;
  cover: MediaItem | null; tone: string; ro: boolean;
}) {
  const can = useCan(); const toast = useToast();
  const [over, setOver] = useState(false); const [busy, setBusy] = useState(false); const [pick, setPick] = useState(false);
  const [more, setMore] = useState(style.shape !== 'original');
  const [fix, setFix] = useState({ alt: logo?.alt ?? '', rights: !!logo?.rightsConfirmed }); const [saving, setSaving] = useState(false);
  useEffect(() => { setFix({ alt: logo?.alt ?? '', rights: !!logo?.rightsConfirmed }); }, [logo?.id, logo?.alt, logo?.rightsConfirmed]);
  const input = useRef<HTMLInputElement>(null);
  const a = useAnalysis(logo ? logo.large ?? logo.url : undefined);
  const set = (p: Partial<LogoStyle>) => onStyle({ ...style, ...p });

  async function take(files: FileList | File[] | null) {
    const f = [...(files ?? [])].find((x) => x.type.startsWith('image/')); if (!f) return;
    if (!can('media.upload')) { toast('Uploading needs the media upload permission. Choose the logo from the library instead.', true); return; }
    setBusy(true);
    try { const m = await upload(f); onLogo(m); toast('Logo uploaded to the Media Library. Add its alt text and confirm the rights below.'); }
    catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); } finally { setBusy(false); }
  }
  async function saveFix() {
    if (!logo) return; setSaving(true);
    try { const r = await patch<MediaItem>(`/media/${logo.id}`, { alt: fix.alt.trim(), rightsConfirmed: fix.rights }); onLogo({ ...logo, ...r, url: logo.url, large: logo.large }); toast('Logo details saved.'); }
    catch (e) { toast((e as Error).message, true); } finally { setSaving(false); }
  }

  // what a reviewer would flag about this logo
  const warn: string[] = [];
  if (logo) {
    const tall = style.shape === '3:4' || style.shape === '1:3' || (style.shape === 'original' && logo.height > logo.width);
    const need = (tall ? H_TALL : H)[style.size][0] * 2;   // sharp on high-density screens
    if (Math.min(logo.width, logo.height) < need * 0.6) warn.push(`Small file (${logo.width}×${logo.height}): it may look blurry at this size. Upload a larger version or choose a smaller size.`);
    if (a && !a.alpha && (style.bg === 'dark' || style.bg === 'pillar' || style.bg === 'none')) warn.push('This logo has a solid background, so it will show as a box on this background. Use a transparent PNG, or choose the white card.');
    if (a) {
      const bgRgb = style.bg === 'pillar' ? hexRgb(tone) : BG_RGB[style.bg];
      const l1 = relLum(bgRgb), l2 = a.lum ** 2.2; const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (a.alpha && ratio < 2.2) warn.push(`Low contrast: the logo is hard to see on ${BGS.find((b) => b[0] === style.bg)?.[1].toLowerCase()}. Try ${a.lum > 0.5 ? 'the dark card' : 'the white card'}.`);
    }
  }
  const fmt = (logo?.mime ?? '').replace('image/', '').toUpperCase();

  return <div className="lp">
    <div className="lp-previews">
      <Stage width={1240} ratio="21 / 9" cover={cover} label="Desktop">{logo && <Badge m={logo} st={style} tone={tone} />}</Stage>
      <Stage width={343} ratio="4 / 4.2" cover={cover} label="Phone">{logo && <Badge m={logo} st={style} tone={tone} phone />}</Stage>
    </div>

    {!ro && <div className={`lp-drop${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
      {logo ? <img className="lp-thumb" src={logo.url} alt="" /> : <span className="lp-drop-i"><Icon n="upload" width={20} height={20} /></span>}
      <span className="lp-drop-t"><b>{busy ? 'Uploading…' : logo ? 'Replace the logo' : 'Drop the logo here'}</b>
        <small>PNG or WebP with a transparent background works best. Uploads go to the Media Library.</small></span>
      <span className="lp-drop-b">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}><Icon n="upload" />Upload</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPick(true)}><Icon n="image" />Choose from library</button>
        {logo && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => onLogo(null)}>Remove</button>}</span>
      <input ref={input} type="file" accept="image/png,image/webp,image/jpeg,image/avif" hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </div>}

    {logo && <>
      <dl className="lp-info">
        <div><dt>Size</dt><dd>{logo.width} × {logo.height} px</dd></div>
        <div><dt>Format</dt><dd>{fmt || '—'}</dd></div>
        <div><dt>Transparency</dt><dd>{a ? (a.alpha ? 'Yes' : 'No, solid background') : '…'}</dd></div>
        <div><dt>File</dt><dd title={logo.originalName}>{logo.originalName}</dd></div>
      </dl>
      {warn.map((w) => <p key={w} className="lp-warn"><Icon n="alert" width={14} height={14} />{w}</p>)}
      {(!logo.alt || !logo.rightsConfirmed) && !ro && <div className="lp-fix">
        <b>Before publishing</b>
        <label className="field"><span>Alt text</span><input className="input" value={fix.alt} maxLength={250} placeholder="e.g. Leadership Lab logo" onChange={(e) => setFix({ ...fix, alt: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={fix.rights} onChange={(e) => setFix({ ...fix, rights: e.target.checked })} /><span>AFCD may use this logo on the website</span></label>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || !fix.alt.trim() || !fix.rights} onClick={saveFix}>{saving ? 'Saving…' : 'Save logo details'}</button>
      </div>}

      {!ro && <div className="lp-opts">
        <div className="lp-opt"><span className="lp-k">Shape</span>
          <div className="seg-btns" role="group" aria-label="Logo shape">
            <button type="button" className={style.shape === 'original' ? 'on' : ''} aria-pressed={style.shape === 'original'} onClick={() => { set({ shape: 'original' }); setMore(false); }}>Original</button>
            <button type="button" className={style.shape !== 'original' ? 'on' : ''} aria-pressed={style.shape !== 'original'} aria-expanded={more} onClick={() => setMore(!more)}>{style.shape !== 'original' ? FRAMES.find((f) => f[0] === style.shape)?.[1] : 'More shapes'} ▾</button></div>
          {more && <div className="lp-frames">{FRAMES.map(([k, l]) => <button key={k} type="button" className={style.shape === k ? 'on' : ''} aria-pressed={style.shape === k} onClick={() => set({ shape: k })} title={l}>
            <i className={k === 'circle' ? 'round' : ''} style={{ aspectRatio: k === 'circle' ? '1 / 1' : k.replace(':', ' / ') }} />{l}</button>)}</div>}
        </div>
        {style.shape !== 'original' && <div className="lp-opt"><span className="lp-k">Fit in the frame</span>
          <div className="seg-btns" role="group" aria-label="Logo fit">
            <button type="button" className={style.fit === 'contain' ? 'on' : ''} aria-pressed={style.fit === 'contain'} onClick={() => set({ fit: 'contain' })}>Whole logo</button>
            <button type="button" className={style.fit === 'cover' ? 'on' : ''} aria-pressed={style.fit === 'cover'} onClick={() => set({ fit: 'cover' })} title="Fills the frame and crops around the focal point set in the Media Library">Fill and crop</button></div></div>}
        <div className="lp-opt"><span className="lp-k">Background</span>
          <div className="lp-swatches" role="radiogroup" aria-label="Logo background">{BGS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={style.bg === k} className={`sw sw-${k}${style.bg === k ? ' on' : ''}`} style={k === 'pillar' ? { background: tone } : undefined} title={l} aria-label={l} onClick={() => set({ bg: k })} />)}
            <span className="lp-sw-l">{BGS.find((b) => b[0] === style.bg)?.[1]}</span></div></div>
        <div className="lp-opt"><span className="lp-k">Size</span>
          <div className="seg-btns" role="group" aria-label="Logo size">{(['s', 'm', 'l'] as const).map((k) => <button key={k} type="button" className={style.size === k ? 'on' : ''} aria-pressed={style.size === k} onClick={() => set({ size: k })}>
            {k.toUpperCase()} <small>{H[k][0]} px</small></button>)}</div>
          <small className="muted">Height on desktop ({H[style.size][1]} px on phones). Tall logos get more height.</small></div>
      </div>}
    </>}
    {pick && <MediaPicker onClose={() => setPick(false)} onPick={(items) => { if (items[0]) onLogo(items[0]); setPick(false); }} />}
  </div>;
}
