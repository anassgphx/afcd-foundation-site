// Program activities editor (project editor › Activities): collapsible, reorderable activity cards, each with a photo
// gallery (drag to reorder, first photo = main, inline alt text and rights, drop files to upload). Data shape stays
// activityItems = [{ title, text, mediaIds[] }] (exported as detail.activities[].images).
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { patch } from './api.ts';
import { Icon, useToast } from './ui.tsx';
import { upload, type MediaItem } from './pages/Media.tsx';
import './activity-editor.css';

export type Activity = { title: string; text: string; when?: string; whenEnd?: string; place?: string; mediaIds: string[]; publicationSlugs?: string[] };
export type PubOpt = { id: string; slug: string; title: string; type: string; status: string; publishedRevisionId: string | null };
const PUB_TYPES: Record<string, string> = { report: 'Report', study: 'Study', policy_brief: 'Policy brief', guide: 'Guide', annual_report: 'Annual report', toolkit: 'Toolkit', other: 'Publication' };
const MAX = 20, PHOTOS = 12, SHOWN = 3;
const TITLE_MAX = 160, TEXT_MAX = 800;
const IMAGE = /^image\/(jpeg|png|webp|avif|tiff)$/;
/** The activity's date for the calendar (YYYY-MM-DD). Reads dates typed before the calendar existed: 28/06/2025, 28-06-2025, 2025-06-28. */
export function whenIso(v?: string) {
  const t = (v ?? '').trim(); let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t); if (m) return t;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t); if (!m) return '';
  const d = +m[1], mo = +m[2]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "28 Jun 2025" for the card header, "28–30 Jun 2025" or "30 Jun – 2 Jul 2025" for several days; other text as it was typed. */
export function whenLabel(v?: string, end?: string) {
  const iso = whenIso(v); if (!iso) return v?.trim() ?? '';
  const [y, mo, d] = iso.split('-').map(Number); const one = `${d} ${MONTHS[mo - 1]} ${y}`;
  const e = whenIso(end); if (!e || e <= iso) return one;
  const [y2, mo2, d2] = e.split('-').map(Number);
  if (y2 !== y) return `${one} – ${d2} ${MONTHS[mo2 - 1]} ${y2}`;
  if (mo2 !== mo) return `${d} ${MONTHS[mo - 1]} – ${d2} ${MONTHS[mo2 - 1]} ${y}`;
  return `${d}–${d2} ${MONTHS[mo - 1]} ${y}`;
}

type Props = {
  items: Activity[]; onChange: (v: Activity[]) => void; ro: boolean; err?: string;
  media: Record<string, MediaItem>; addMedia: (m: MediaItem[]) => void;
  onPickPhotos: (index: number) => void; canEditMedia: boolean; publications?: PubOpt[];
};

const move = <T,>(a: T[], from: number, to: number) => { const b = [...a]; const [x] = b.splice(from, 1); b.splice(to, 0, x); return b; };
const needs = (m?: MediaItem) => (!m ? null : !m.rightsConfirmed ? 'rights' : null);

export function ActivityList({ items, onChange, ro, err, media, addMedia, onPickPhotos, canEditMedia, publications = [] }: Props) {
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
  const add = () => { onChange([...items, { title: '', text: '', when: '', whenEnd: '', place: '', mediaIds: [] }]); setOpen((o) => [...o, true]); };
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
        const rights = flags.filter((f) => f === 'rights').length;
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
                <small>{[whenLabel(a.when, a.whenEnd), a.place?.trim()].filter(Boolean).join(' · ') || 'No date or place'} · {a.mediaIds.length ? `${a.mediaIds.length} photo${a.mediaIds.length === 1 ? '' : 's'}` : 'No photos'}</small></span>
              <span className="ae-chips">
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
              <div className="field"><span className="pe-label">When <em>· optional</em></span>
                <div className="ae-dates">
                  <label><small>From</small>
                    <input className="input" type="date" value={whenIso(a.when)} disabled={ro} aria-label="First day of the activity"
                      onChange={(e) => { const v = e.target.value; update(i, { ...a, when: v, whenEnd: !v ? '' : a.whenEnd && whenIso(a.whenEnd) && whenIso(a.whenEnd) < v ? v : a.whenEnd }); }} /></label>
                  <label><small>To <em>· if more than 1 day</em></small>
                    <input className="input" type="date" value={whenIso(a.whenEnd)} min={whenIso(a.when) || undefined} disabled={ro || !whenIso(a.when)} aria-label="Last day of the activity"
                      onChange={(e) => update(i, { ...a, whenEnd: e.target.value })} /></label>
                </div>
                {a.when && !whenIso(a.when) && <small className="ae-when-old">Saved as “{a.when}”. Pick the date to replace it.</small>}</div>
              <label className="field"><span className="pe-label">Place <em>· optional</em></span>
                <input className="input" value={a.place ?? ''} maxLength={80} disabled={ro} placeholder="e.g. Marrakech" onChange={(e) => update(i, { ...a, place: e.target.value })} /></label>
            </div>
            <label className="field"><span className="pe-label">Description <em>· optional</em></span>
              <AutoText value={a.text} max={TEXT_MAX} disabled={ro} placeholder="What happened, who took part, what came out of it." onChange={(v) => update(i, { ...a, text: v })} />
              <span className="between"><small>Plain text. Use verified facts only.</small><small className={`count-hint${a.text.length > TEXT_MAX * 0.9 ? ' near' : ''}`}>{a.text.length} / {TEXT_MAX}</small></span>
            </label>
            <ActivityPubs value={a.publicationSlugs ?? []} all={publications} ro={ro} onChange={(v) => update(i, { ...a, publicationSlugs: v })} />
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
    if (added.length) { addMedia(added); onChange([...new Set([...ids, ...added.map((m) => m.id)])].slice(0, PHOTOS)); toast(`${added.length} photo${added.length === 1 ? '' : 's'} uploaded. Confirm usage rights before review.`); }
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

/** Publications from this activity (reports, policy briefs…): chosen from Studio → Publications; only published ones show on the website. */
function ActivityPubs({ value, all, ro, onChange }: { value: string[]; all: PubOpt[]; ro: boolean; onChange: (v: string[]) => void }) {
  const chosen = value.map((sl) => all.find((p) => p.slug === sl) ?? { id: sl, slug: sl, title: sl, type: 'other', status: '', publishedRevisionId: null });
  const left = all.filter((p) => !value.includes(p.slug)).sort((a, b) => a.title.localeCompare(b.title));
  const live = left.filter((p) => p.publishedRevisionId), draft = left.filter((p) => !p.publishedRevisionId);
  return <div className="field ae-pubs"><span className="pe-label">Publications <em>· optional</em></span>
    {chosen.length > 0 && <ul className="ae-pub-chips">{chosen.map((p) => <li key={p.slug}><span className="ae-pub-doc" aria-hidden="true" /><b>{p.title}</b><small>{PUB_TYPES[p.type] ?? 'Publication'}</small>
      {!p.publishedRevisionId && <em title="Not published yet, so it isn't shown on the website">not published</em>}
      {!ro && <button type="button" aria-label={`Remove ${p.title}`} onClick={() => onChange(value.filter((x) => x !== p.slug))}>×</button>}</li>)}</ul>}
    {!ro && <select className="select ae-pub-select" value="" disabled={!left.length || value.length >= 6} onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label="Link a publication">
      <option value="">{!all.length ? 'No publications yet: add them in Publications' : left.length ? 'Link a publication from this activity…' : 'All publications are linked'}</option>
      {live.length > 0 && <optgroup label="Published">{live.map((p) => <option key={p.slug} value={p.slug}>{p.title} · {PUB_TYPES[p.type] ?? 'Publication'}</option>)}</optgroup>}
      {draft.length > 0 && <optgroup label="Not published yet (hidden on the website)">{draft.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</optgroup>}
    </select>}
    <small>Shown under the activity on the project page, and in the project’s Publications section.</small>
  </div>;
}
