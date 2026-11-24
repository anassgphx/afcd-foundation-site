// Program activities editor (project editor › Activities): collapsible, reorderable activity cards, each with a photo
// gallery (drag to reorder, first photo = main, inline alt text and rights, drop files to upload). Data shape stays
// activityItems = [{ title, text, mediaIds[] }] (exported as detail.activities[].images).
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { patch } from './api.ts';
import { Icon, useToast } from './ui.tsx';
import { upload, type MediaItem } from './pages/Media.tsx';
import './activity-editor.css';

export type Activity = { title: string; text: string; when?: string; place?: string; mediaIds: string[] };
const MAX = 20, PHOTOS = 12, SHOWN = 3;
const TITLE_MAX = 160, TEXT_MAX = 800;
const IMAGE = /^image\/(jpeg|png|webp|avif|tiff)$/;

type Props = {
  items: Activity[]; onChange: (v: Activity[]) => void; ro: boolean; err?: string;
  media: Record<string, MediaItem>; addMedia: (m: MediaItem[]) => void;
  onPickPhotos: (index: number) => void; canEditMedia: boolean;
};

const move = <T,>(a: T[], from: number, to: number) => { const b = [...a]; const [x] = b.splice(from, 1); b.splice(to, 0, x); return b; };
const needs = (m?: MediaItem) => (!m ? null : !m.alt ? 'alt' : !m.rightsConfirmed ? 'rights' : null);

export function ActivityList({ items, onChange, ro, err, media, addMedia, onPickPhotos, canEditMedia }: Props) {
  // open/closed per card; cards with a title start closed, empty ones open
  const [open, setOpen] = useState<boolean[]>(() => items.map((a) => !a.title.trim()));
  useEffect(() => { setOpen((o) => (o.length === items.length ? o : items.map((a, i) => o[i] ?? !a.title.trim()))); }, [items.length]);
  const [drag, setDrag] = useState<number | null>(null); const [over, setOver] = useState<number | null>(null);

  const update = (i: number, v: Activity) => onChange(items.map((x, j) => (j === i ? v : x)));
  const reorder = (from: number, to: number) => { if (from === to || to < 0 || to >= items.length) return; onChange(move(items, from, to)); setOpen((o) => move(o, from, to)); };
  const remove = (i: number) => {
    const a = items[i];
    if ((a.title.trim() || a.text.trim() || a.mediaIds.length) && !confirm(`Remove “${a.title.trim() || `activity ${i + 1}`}”${a.mediaIds.length ? ` and its ${a.mediaIds.length} photo link${a.mediaIds.length === 1 ? '' : 's'}` : ''}? The photos stay in the Media Library.`)) return;
    onChange(items.filter((_, j) => j !== i)); setOpen((o) => o.filter((_, j) => j !== i));
  };
  const add = () => { onChange([...items, { title: '', text: '', when: '', place: '', mediaIds: [] }]); setOpen((o) => [...o, true]); };
  const allOpen = open.length > 0 && open.every(Boolean);

  if (!items.length) return <div className="ae-empty">
    <span className="ae-empty-ico" aria-hidden="true"><Icon n="image" /></span>
    <div><b>No activities yet</b><small>Add what actually happened: a workshop, a bootcamp, a field visit. Each activity can have its own photos.</small></div>
    {!ro && <button type="button" className="btn btn-primary btn-sm" onClick={add}><Icon n="plus" />Add the first activity</button>}
  </div>;

  return <div className="ae">
    <div className="ae-bar">
      <small className="count-hint">{items.length} of {MAX} activities</small>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(items.map(() => !allOpen))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
    </div>
    <ol className="ae-list">
      {items.map((a, i) => {
        const first = a.mediaIds.map((x) => media[x]).find(Boolean);
        const flags = a.mediaIds.map((x) => needs(media[x])).filter(Boolean);
        const alts = flags.filter((f) => f === 'alt').length, rights = flags.filter((f) => f === 'rights').length;
        const isOpen = !!open[i];
        return <li key={i} className={`ae-card${isOpen ? ' is-open' : ''}${drag === i ? ' is-drag' : ''}${over === i && drag !== null && drag !== i ? ' is-over' : ''}`}
          onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i); } }} onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => { if (drag !== null) { e.preventDefault(); reorder(drag, i); } setDrag(null); setOver(null); }}>
          <div className="ae-head">
            {!ro && <span className="ae-grip" draggable title="Drag to reorder" aria-hidden="true" onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `activity-${i}`); }} onDragEnd={() => { setDrag(null); setOver(null); }}>⋮⋮</span>}
            <button type="button" className="ae-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => o.map((x, j) => (j === i ? !x : x)))}>
              <span className="ae-n">{String(i + 1).padStart(2, '0')}</span>
              {first ? <img className="ae-thumb" src={first.url} alt="" /> : <span className="ae-thumb is-empty" aria-hidden="true"><Icon n="image" /></span>}
              <span className="ae-head-t"><b>{a.title.trim() || <em>Untitled activity</em>}</b>
                <small>{[a.when?.trim(), a.place?.trim()].filter(Boolean).join(' · ') || 'No date or place'} · {a.mediaIds.length ? `${a.mediaIds.length} photo${a.mediaIds.length === 1 ? '' : 's'}` : 'No photos'}</small></span>
              <span className="ae-chips">
                {alts > 0 && <span className="ae-chip bad">{alts} alt text</span>}
                {rights > 0 && <span className="ae-chip warn">{rights} rights</span>}
              </span>
              <Icon n="chev" className="ae-caret" />
            </button>
            {!ro && <span className="ae-tools">
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move activity ${i + 1} up`} disabled={i === 0} onClick={() => reorder(i, i - 1)}><Icon n="chev" style={{ transform: 'rotate(-90deg)' }} /></button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move activity ${i + 1} down`} disabled={i === items.length - 1} onClick={() => reorder(i, i + 1)}><Icon n="chev" style={{ transform: 'rotate(90deg)' }} /></button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove activity ${i + 1}`} onClick={() => remove(i)}><Icon n="x" /></button>
            </span>}
          </div>
          {isOpen && <div className="ae-body">
            <label className="field"><span className="pe-label">Title</span>
              <input className="input" value={a.title} maxLength={TITLE_MAX} disabled={ro} placeholder="e.g. Leadership bootcamp in Marrakech" onChange={(e) => update(i, { ...a, title: e.target.value })} />
              <span className="between"><small>{!a.title.trim() ? 'Required.' : 'Short and specific.'}</small><small className={`count-hint${a.title.length > TITLE_MAX * 0.9 ? ' near' : ''}`}>{a.title.length} / {TITLE_MAX}</small></span>
            </label>
            <div className="ae-meta">
              <label className="field"><span className="pe-label">When <em>· optional</em></span>
                <input className="input" value={a.when ?? ''} maxLength={40} disabled={ro} placeholder="e.g. April 2026, or 20 April 2026" onChange={(e) => update(i, { ...a, when: e.target.value })} /></label>
              <label className="field"><span className="pe-label">Place <em>· optional</em></span>
                <input className="input" value={a.place ?? ''} maxLength={80} disabled={ro} placeholder="e.g. Marrakech" onChange={(e) => update(i, { ...a, place: e.target.value })} /></label>
            </div>
            <small className="muted ae-meta-hint">The project page shows activities as a timeline: the date labels each step and the city is marked on the map.</small>
            <label className="field"><span className="pe-label">Description <em>· optional</em></span>
              <AutoText value={a.text} max={TEXT_MAX} disabled={ro} placeholder="What happened, who took part, what came out of it." onChange={(v) => update(i, { ...a, text: v })} />
              <span className="between"><small>Plain text. Use verified facts only.</small><small className={`count-hint${a.text.length > TEXT_MAX * 0.9 ? ' near' : ''}`}>{a.text.length} / {TEXT_MAX}</small></span>
            </label>
            <Gallery ids={a.mediaIds} media={media} ro={ro} label={`Activity ${i + 1}`} canEditMedia={canEditMedia} addMedia={addMedia}
              onChange={(ids) => update(i, { ...a, mediaIds: ids })} onPick={() => onPickPhotos(i)} />
          </div>}
        </li>;
      })}
    </ol>
    {err && <small className="err" role="alert">{err}</small>}
    {!ro && items.length < MAX && <button type="button" className="btn btn-sm ae-add" onClick={add}><Icon n="plus" />Add activity</button>}
  </div>;
}

function AutoText({ value, max, disabled, placeholder, onChange }: { value: string; max: number; disabled: boolean; placeholder: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = `${Math.max(72, t.scrollHeight + 2)}px`; } }, [value]);
  return <textarea ref={ref} className="textarea ae-auto" value={value} maxLength={max} disabled={disabled} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />;
}

/** An activity's photos as a gallery grid. First = main photo. */
function Gallery({ ids, media, ro, label, canEditMedia, addMedia, onChange, onPick }: {
  ids: string[]; media: Record<string, MediaItem>; ro: boolean; label: string; canEditMedia: boolean;
  addMedia: (m: MediaItem[]) => void; onChange: (ids: string[]) => void; onPick: () => void;
}) {
  const toast = useToast();
  const [drag, setDrag] = useState<number | null>(null); const [over, setOver] = useState<number | null>(null);
  const [filesOver, setFilesOver] = useState(false); const [uploading, setUploading] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const isFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  async function dropFiles(files: FileList) {
    const list = Array.from(files).filter((f) => IMAGE.test(f.type)).slice(0, PHOTOS - ids.length);
    if (!list.length) { toast('Drop JPEG, PNG, WebP, AVIF or TIFF images.', true); return; }
    setUploading(list.length);
    const added: MediaItem[] = [];
    for (const f of list) {
      try { added.push(await upload(f)); } catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); }
      setUploading((n) => n - 1);
    }
    if (added.length) { addMedia(added); onChange([...new Set([...ids, ...added.map((m) => m.id)])].slice(0, PHOTOS)); toast(`${added.length} photo${added.length === 1 ? '' : 's'} uploaded. Add alt text before review.`); }
  }

  const editItem = editing ? media[editing] : null;
  return <div className={`ae-gal${filesOver ? ' is-files' : ''}`} role="group" aria-label={`${label} photos`}
    onDragOver={(e) => { if (!ro && isFiles(e)) { e.preventDefault(); setFilesOver(true); } }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFilesOver(false); }}
    onDrop={(e) => { if (!ro && isFiles(e)) { e.preventDefault(); setFilesOver(false); dropFiles(e.dataTransfer.files); } }}>
    <div className="ae-gal-h">
      <span className="pe-label">Photos</span>
      <small className="count-hint">{ids.length} of {PHOTOS}{ids.length > SHOWN ? ` · the page shows ${SHOWN}, then +${ids.length - SHOWN}` : ''}</small>
    </div>
    {ids.length > 0 && <ol className="ae-grid">
      {ids.map((mid, i) => { const m = media[mid]; const flag = needs(m); return <li key={mid}
        className={`ae-tile${i >= SHOWN ? ' is-extra' : ''}${drag === i ? ' is-drag' : ''}${over === i && drag !== null && drag !== i ? ' is-over' : ''}`}
        draggable={!ro} onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', mid); }}
        onDragEnd={() => { setDrag(null); setOver(null); }}
        onDragOver={(e) => { if (drag !== null) { e.preventDefault(); e.stopPropagation(); setOver(i); } }}
        onDrop={(e) => { if (drag !== null) { e.preventDefault(); e.stopPropagation(); onChange(move(ids, drag, i)); } setDrag(null); setOver(null); }}>
        {m ? <img src={m.url} alt={m.alt || ''} draggable={false} /> : <span className="ae-tile-ph">Photo</span>}
        {i === 0 && <span className="ae-main">Main</span>}
        {flag === 'alt' && <span className="ae-flag bad" title="No alt text yet">Alt</span>}
        {flag === 'rights' && <span className="ae-flag warn" title="Usage rights not confirmed">Rights</span>}
        {!ro && <span className="ae-tile-tools">
          <button type="button" aria-label={`Move photo ${i + 1} earlier`} title="Move earlier" disabled={i === 0} onClick={() => onChange(move(ids, i, i - 1))}>‹</button>
          <button type="button" aria-label={`Move photo ${i + 1} later`} title="Move later" disabled={i === ids.length - 1} onClick={() => onChange(move(ids, i, i + 1))}>›</button>
          {i > 0 && <button type="button" aria-label={`Make photo ${i + 1} the main photo`} title="Make main" onClick={() => onChange(move(ids, i, 0))}>★</button>}
          {m && canEditMedia && <button type="button" aria-label={`Edit alt text of photo ${i + 1}`} title="Alt text and rights" onClick={() => setEditing(mid)}>✎</button>}
          <button type="button" aria-label={`Remove photo ${i + 1}`} title="Remove from this activity" onClick={() => onChange(ids.filter((x) => x !== mid))}>×</button>
        </span>}
      </li>; })}
    </ol>}
    {editItem && <AltEditor item={editItem} onClose={() => setEditing(null)} onSaved={(m) => { addMedia([m]); setEditing(null); toast('Photo details saved'); }} />}
    {!ro && <div className="ae-gal-add">
      {ids.length < PHOTOS && <button type="button" className="btn btn-sm" onClick={onPick}><Icon n="image" />{ids.length ? 'Add from library' : 'Add photos'}</button>}
      <small className="muted">{uploading ? `Uploading ${uploading}…` : ids.length < PHOTOS ? 'or drop image files here' : `Maximum ${PHOTOS} photos.`}</small>
    </div>}
  </div>;
}

/** Inline editor for a photo's alt text and usage rights; saves to the Media Library item. */
function AltEditor({ item, onClose, onSaved }: { item: MediaItem; onClose: () => void; onSaved: (m: MediaItem) => void }) {
  const [alt, setAlt] = useState(item.alt ?? ''); const [rights, setRights] = useState(!!item.rightsConfirmed);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { onSaved(await patch<MediaItem>(`/media/${item.id}`, { alt: alt.trim(), rightsConfirmed: rights })); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return <div className="ae-alt" role="dialog" aria-label="Photo details" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <img src={item.url} alt="" />
    <div className="ae-alt-f">
      <label className="field"><span className="pe-label">Alt text</span>
        <textarea className="textarea" rows={2} value={alt} maxLength={250} autoFocus onChange={(e) => setAlt(e.target.value)} placeholder="Describe what the photo shows" />
      </label>
      <label className="check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /><span>AFCD may publish it, and the people shown agreed</span></label>
      {err && <small className="err" role="alert">{err}</small>}
      <div className="ae-alt-b"><button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy || alt.trim().length < 3}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div>
  </div>;
}
