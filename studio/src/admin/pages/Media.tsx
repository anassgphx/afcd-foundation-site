// Media library: upload (validated on the server), metadata, rights and consent, focal point, reuse count. Plus the picker modal.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, del, patch, ApiError } from '../api.ts';
import { Icon, Modal, fmtDate, useCan, useToast } from '../ui.tsx';

export type MediaItem = {
  id: string; originalName: string; url: string; large?: string; width: number; height: number; bytes: number; mime: string;
  alt: string; caption: string; credit: string; rightsConfirmed: boolean; focalX: number; focalY: number; createdAt: string; usedBy?: number;
};

async function upload(file: File): Promise<MediaItem> {
  const fd = new FormData(); fd.append('file', file);
  const csrf = (await api<{ csrf: string }>('/me')).csrf;
  const res = await fetch('/studio/api/media', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Upload failed');
  return data;
}

function useMedia() {
  const [items, setItems] = useState<MediaItem[] | null>(null); const [q, setQ] = useState('');
  const load = useCallback(() => api<{ items: MediaItem[] }>(`/media${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => setItems(r.items)), [q]);
  useEffect(() => { const t = setTimeout(() => { load().catch(() => setItems([])); }, 200); return () => clearTimeout(t); }, [load]);
  return { items, setItems, q, setQ, load };
}

function Uploader({ onDone }: { onDone: (m: MediaItem[]) => void }) {
  const can = useCan(); const toast = useToast(); const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false); const [busy, setBusy] = useState(0);
  if (!can('media.upload')) return null;
  async function go(files: FileList | File[]) {
    const list = [...files].slice(0, 20); setBusy(list.length); const ok: MediaItem[] = [];
    for (const f of list) { try { ok.push(await upload(f)); } catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); } finally { setBusy((n) => n - 1); } }
    if (ok.length) { toast(`${ok.length} image${ok.length > 1 ? 's' : ''} uploaded. Add alt text and confirm rights before publishing.`); onDone(ok); }
  }
  return <div className={`drop${over ? ' over' : ''}`} role="button" tabIndex={0}
    onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
    onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={(e) => { e.preventDefault(); setOver(false); go(e.dataTransfer.files); }}>
    <Icon n="upload" width={22} height={22} />
    <b>{busy ? `Uploading ${busy}…` : 'Drop images here or click to upload'}</b>
    <small>JPEG, PNG, WebP, AVIF or TIFF, up to 15 MB. Metadata such as GPS location is removed.</small>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/tiff" multiple hidden onChange={(e) => { if (e.target.files) go(e.target.files); e.target.value = ''; }} />
  </div>;
}

const ready = (m: MediaItem) => !!m.alt && m.rightsConfirmed;

export function MediaLibrary() {
  const { items, setItems, q, setQ } = useMedia();
  const [sel, setSel] = useState<MediaItem | null>(null);
  return (
    <>
      <div className="page-h"><div><h1>Media Library</h1><p>Every image used on the website, with alt text, credits and usage rights.</p></div></div>
      <div className="editor">
        <section className="card">
          <div className="card-h"><label className="search"><Icon n="search" /><span className="sr-only">Search media</span><input className="input" placeholder="Search by name, alt text or caption" value={q} onChange={(e) => setQ(e.target.value)} /></label><span className="muted">{items?.length ?? 0} items</span></div>
          <div className="card-b stack">
            <Uploader onDone={(m) => { setItems((x) => [...m, ...(x ?? [])]); setSel(m[0]); }} />
            {items && items.length === 0 && <div className="empty">No images yet.</div>}
            <div className="media-grid">{items?.map((m) => (
              <button key={m.id} className={`tile${sel?.id === m.id ? ' on' : ''}`} onClick={() => setSel(m)}>
                <img src={m.url} alt="" loading="lazy" />
                {!ready(m) && <span className="flag badge b-changes_requested">Needs info</span>}
                <div><b>{m.originalName}</b><small>{m.width}×{m.height} · used {m.usedBy ?? 0}×</small></div>
              </button>))}</div>
          </div>
        </section>
        <aside className="inspector">
          {sel ? <MediaDetails key={sel.id} m={sel} onSaved={(m) => { setSel(m); setItems((x) => x?.map((i) => i.id === m.id ? { ...i, ...m } : i) ?? null); }} onDeleted={() => { setItems((x) => x?.filter((i) => i.id !== sel.id) ?? null); setSel(null); }} />
            : <section className="card"><div className="card-b muted">Select an image to edit its details.</div></section>}
        </aside>
      </div>
    </>
  );
}

function MediaDetails({ m, onSaved, onDeleted }: { m: MediaItem; onSaved: (m: MediaItem) => void; onDeleted: () => void }) {
  const can = useCan(); const toast = useToast();
  const [f, setF] = useState({ alt: m.alt, caption: m.caption, credit: m.credit, rightsConfirmed: m.rightsConfirmed, focalX: m.focalX, focalY: m.focalY });
  const [busy, setBusy] = useState(false);
  const ro = !can('media.update');
  const dirty = JSON.stringify(f) !== JSON.stringify({ alt: m.alt, caption: m.caption, credit: m.credit, rightsConfirmed: m.rightsConfirmed, focalX: m.focalX, focalY: m.focalY });
  async function save() { setBusy(true); try { const r = await patch<MediaItem>(`/media/${m.id}`, f); onSaved({ ...m, ...r }); toast('Image details saved'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } }
  async function remove() { if (!confirm('Delete this image permanently? This cannot be undone.')) return; try { await del(`/media/${m.id}`); toast('Image deleted'); onDeleted(); } catch (e) { toast((e as Error).message, true); } }
  return <section className="card">
    <div className="card-h"><h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.originalName}</h2></div>
    <div className="card-b stack">
      <div className="focal" onClick={(e) => { if (ro) return; const r = e.currentTarget.getBoundingClientRect(); setF({ ...f, focalX: Math.round(((e.clientX - r.left) / r.width) * 100), focalY: Math.round(((e.clientY - r.top) / r.height) * 100) }); }} title="Click to set the focal point">
        <img src={m.large ?? m.url} alt="" /><i style={{ left: `${f.focalX}%`, top: `${f.focalY}%` }} />
      </div>
      <small className="muted">Click the image to set the focal point used when it is cropped.</small>
      <label className="field"><span>Alt text</span><textarea className="textarea" style={{ minHeight: 60 }} value={f.alt} maxLength={250} disabled={ro} onChange={(e) => setF({ ...f, alt: e.target.value })} placeholder="Describe what the photo shows" /><small className="muted">Required before publishing. Describe the content, not “photo of”.</small></label>
      <label className="field"><span>Caption <em>· optional</em></span><input className="input" value={f.caption} maxLength={500} disabled={ro} onChange={(e) => setF({ ...f, caption: e.target.value })} /></label>
      <label className="field"><span>Credit <em>· optional</em></span><input className="input" value={f.credit} maxLength={200} disabled={ro} onChange={(e) => setF({ ...f, credit: e.target.value })} placeholder="Photographer or source" /></label>
      <label className="check"><input type="checkbox" checked={f.rightsConfirmed} disabled={ro} onChange={(e) => setF({ ...f, rightsConfirmed: e.target.checked })} /><span><b>Usage rights and consent confirmed</b><br /><small className="muted">AFCD may publish this image, and people who can be identified agreed to appear in it.</small></span></label>
      <dl className="kv"><dt>Size</dt><dd>{m.width}×{m.height} · {(m.bytes / 1024 / 1024).toFixed(1)} MB</dd><dt>Type</dt><dd>{m.mime}</dd><dt>Uploaded</dt><dd>{fmtDate(m.createdAt)}</dd><dt>Used by</dt><dd>{m.usedBy ?? 0} item(s)</dd></dl>
      {!ro && <div className="between"><button className="btn btn-ghost btn-danger btn-sm" onClick={remove} disabled={!can('media.delete')}>Delete</button><button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save details'}</button></div>}
    </div>
  </section>;
}

export function MediaPicker({ multiple, onPick, onClose }: { multiple?: boolean; onPick: (m: MediaItem[]) => void; onClose: () => void }) {
  const { items, setItems, q, setQ } = useMedia();
  const [sel, setSel] = useState<MediaItem[]>([]);
  const toggle = (m: MediaItem) => setSel((s) => multiple ? (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : [...s, m]) : [m]);
  return <Modal title={multiple ? 'Add photos' : 'Choose a photo'} onClose={onClose} footer={<>
    <span className="muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{sel.some((m) => !ready(m)) ? 'Some selected images still need alt text or rights confirmation before publishing.' : ''}</span>
    <button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!sel.length} onClick={() => onPick(sel)}>{multiple ? `Add ${sel.length || ''}` : 'Use photo'}</button></>}>
    <div className="modal-b stack">
      <div className="between"><label className="search"><Icon n="search" /><span className="sr-only">Search media</span><input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label></div>
      <Uploader onDone={(m) => { setItems((x) => [...m, ...(x ?? [])]); setSel((s) => multiple ? [...s, ...m] : [m[0]]); }} />
      <div className="media-grid">{items?.map((m) => { const i = sel.findIndex((x) => x.id === m.id); return (
        <button key={m.id} className={`tile${i >= 0 ? ' on' : ''}`} onClick={() => toggle(m)} onDoubleClick={() => !multiple && onPick([m])}>
          <img src={m.url} alt="" loading="lazy" />{!ready(m) && <span className="flag badge b-changes_requested">Needs info</span>}
          {i >= 0 && multiple && <span className="num">{i + 1}</span>}
          <div><b>{m.originalName}</b><small>{m.alt || 'No alt text yet'}</small></div>
        </button>); })}</div>
      {items && items.length === 0 && <div className="empty">No images yet. Upload one above.</div>}
    </div>
  </Modal>;
}
