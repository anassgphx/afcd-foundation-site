// Media Library: every image of the website with where it is used, what it still needs (alt text, credit, rights),
// duplicates, an upload queue, replace-in-place, bulk edits and a detail panel with a focal-point picker.
// The picker modal (MediaPicker) used by the editors is at the bottom and keeps its own lighter list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, del, patch, post, ApiError } from '../api.ts';
import { Icon, Modal, fmtDate, ago, navigate, useCan, useMe, useToast } from '../ui.tsx';
import '../media.css';

export type MediaItem = {
  id: string; originalName: string; url: string; large?: string; width: number; height: number; bytes: number; mime: string;
  alt: string; caption: string; credit: string; rightsConfirmed: boolean; focalX: number; focalY: number; createdAt: string; usedBy?: number;
};
type Use = { kind: string; title: string; href: string; where: string; live: boolean };
type LibItem = MediaItem & {
  quality?: Level; webBytes?: number;
  crop?: { x: number; y: number; w: number; h: number } | null;
  tags: string[]; storageKey: string; updatedAt: string; uploadedByName: string | null; licence: string; rightsExpiresOn: string | null;
  usedOn: Use[]; issues: ('alt' | 'credit' | 'rights' | 'expired')[]; duplicateOf: { ids: string[]; exact: boolean } | null;
};

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/tiff';
const ready = (m: MediaItem) => !!m.alt && m.rightsConfirmed;
const mb = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const fmt = (mime: string) => mime.replace('image/', '').replace('jpeg', 'JPEG').toUpperCase();
/** "IMG_2041-final (1).JPG" → "IMG 2041 final (1)": no extension, separators as spaces. */
const cleanName = (n: string) => n.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || n;
const orient = (m: MediaItem) => Math.abs(m.width - m.height) / Math.max(m.width, m.height) < 0.06 ? 'square' : m.width > m.height ? 'landscape' : 'portrait';
const pages = (m: LibItem) => new Set(m.usedOn.map((u) => u.href)).size;
/** A replaced file keeps its name, so the address carries a version and the browser does not show the old one from its cache. */
const stamp = (m: LibItem): LibItem => { const v = `?v=${Date.parse(m.updatedAt)}`; return { ...m, url: m.url + v, large: m.large ? m.large + v : m.large }; };
const fileOf = (m: MediaItem) => (m.large ?? m.url).split('?')[0].split('/').pop();
type Level = 'best' | 'balanced' | 'smaller';
const LEVEL: Record<Level, { l: string; d: string }> = {
  best: { l: 'Best quality', d: 'Sharpest, largest files. Used for new uploads; right for slider and full-width photos.' },
  balanced: { l: 'Balanced', d: 'Lighter, little visible difference on most photos. Good for cards and small images.' },
  smaller: { l: 'Smaller', d: 'Fastest pages. Fine detail can look slightly soft.' },
};
/** Runs the compression and returns a short "2.4 MB → 1.6 MB (−33%)" line. */
async function compress(ids: string[], level: Level) {
  const r = await post<{ before: number; after: number; items: { error?: string }[] }>('/media/optimise', { ids, level });
  const pct = r.before ? Math.round((1 - r.after / r.before) * 100) : 0;
  const errs = r.items.filter((x) => x.error).length;
  return `${mb(r.before)} → ${mb(r.after)} (${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%)${errs ? `. ${errs} could not be compressed (original file missing).` : ''}`;
}
const ISSUE: Record<string, string> = { alt: 'Needs alt text', credit: 'Needs credit', rights: 'Needs rights', expired: 'Rights expired' };
const today = () => new Date().toISOString().slice(0, 10);
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

// small icons this screen needs that the shared set does not have
const P: Record<string, string> = {
  crop: 'M6 2v12h12M2 6h12v12',
  copy: 'M7 7h9v9H7zM4 13V4h9', download: 'M10 3v10M6 9l4 4 4-4M4 16h12', replace: 'M4 8a6 6 0 0 1 11-2M16 3v3h-3M16 12a6 6 0 0 1-11 2M4 17v-3h3',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10', grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z', list: 'M4 5h12M4 10h12M4 15h12',
  tag: 'M3 10V3h7l7 7-7 7zM7 7h.01', dup: 'M6 6h10v10H6zM4 14V4h10', back: 'M12 4l-6 6 6 6', link: 'M8 12l4-4M7 9l-2 2a3 3 0 0 0 4 4l2-2M13 11l2-2a3 3 0 0 0-4-4L9 7',
};
const MI = ({ n, size = 16 }: { n: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>;

/** Sends one file with upload progress (fetch has none). */
function sendFile(url: string, file: File, csrf: string, onProgress: (p: number) => void) {
  return new Promise<any>((res, rej) => {
    const x = new XMLHttpRequest(); const fd = new FormData(); fd.append('file', file);
    x.open('POST', url); x.withCredentials = true; x.setRequestHeader('X-CSRF-Token', csrf);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { let d: any = {}; try { d = JSON.parse(x.responseText); } catch { /* not json */ } x.status < 300 ? res(d) : rej(new ApiError(x.status, d.error || 'Upload failed')); };
    x.onerror = () => rej(new ApiError(0, 'Network error. Check the connection and retry.'));
    x.send(fd);
  });
}

async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

// ================================================================= Library
type Job = { id: string; file: File; p: number; state: 'wait' | 'up' | 'done' | 'err'; error?: string; replaceOf?: string; cropAfter?: boolean };
type CropTarget = { id: string; name: string; crop: LibItem['crop']; fresh?: boolean };
type Filter = 'all' | 'needs' | 'used' | 'unused' | 'dupes' | 'trash';
type TrashItem = { row: LibItem; deletedAt: string; deletedBy: string | null; usedOn: Use[]; reattach: number; thumb: string | null };
type Sort = 'new' | 'name' | 'size' | 'used';

export function MediaLibrary() {
  const can = useCan(); const toast = useToast(); const me = useMe();
  const [items, setItems] = useState<LibItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<Filter>('all');
  const [type, setType] = useState('all'); const [shape, setShape] = useState('all');
  const [sort, setSort] = useState<Sort>((store.get('media.sort') as Sort) || 'new');
  const [view, setView] = useState<'grid' | 'list'>(store.get('media.view') === 'list' ? 'list' : 'grid');
  const [size, setSize] = useState<'s' | 'm' | 'l'>((store.get('media.size') as 's') || 'm');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(location.search).get('id'));
  const [cursor, setCursor] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const [confirmDel, setConfirmDel] = useState<LibItem[] | null>(null);
  const [cropFor, setCropFor] = useState<CropTarget | null>(null);
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null); const replaceInput = useRef<HTMLInputElement>(null); const replaceTarget = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [trash, setTrash] = useState<TrashItem[]>([]);
  const loadTrash = useCallback(() => api<{ items: TrashItem[] }>('/media/trash').then((r) => setTrash(r.items)).catch(() => { /* the library still works */ }), []);
  const load = useCallback(() => { loadTrash(); return api<{ items: LibItem[] }>('/media/library').then((r) => { setItems(r.items.map(stamp)); setFailed(false); }).catch(() => { setFailed(true); setItems((x) => x ?? []); }); }, [loadTrash]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { store.set('media.sort', sort); store.set('media.view', view); store.set('media.size', size); }, [sort, view, size]);
  useEffect(() => { const u = new URL(location.href); if (openId) u.searchParams.set('id', openId); else u.searchParams.delete('id'); history.replaceState(null, '', u); }, [openId]);

  const types = useMemo(() => [...new Set((items ?? []).map((m) => m.mime))].sort(), [items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const l = (items ?? []).filter((m) =>
      (!s || [m.originalName, m.alt, m.caption, m.credit, ...m.tags].some((x) => x.toLowerCase().includes(s)))
      && (filter === 'all' || (filter === 'needs' ? m.issues.length > 0 : filter === 'used' ? m.usedOn.length > 0 : filter === 'unused' ? m.usedOn.length === 0 : !!m.duplicateOf))
      && (type === 'all' || m.mime === type) && (shape === 'all' || orient(m) === shape));
    const by: Record<Sort, (a: LibItem, b: LibItem) => number> = {
      new: (a, b) => b.createdAt.localeCompare(a.createdAt), name: (a, b) => cleanName(a.originalName).localeCompare(cleanName(b.originalName), undefined, { numeric: true }),
      size: (a, b) => b.bytes - a.bytes, used: (a, b) => pages(b) - pages(a) || b.createdAt.localeCompare(a.createdAt),
    };
    return l.sort(by[sort]);
  }, [items, q, filter, type, shape, sort]);
  const counts = useMemo(() => { const l = items ?? []; return { all: l.length, needs: l.filter((m) => m.issues.length).length, used: l.filter((m) => m.usedOn.length).length, unused: l.filter((m) => !m.usedOn.length).length, dupes: l.filter((m) => m.duplicateOf).length , trash: trash.length }; }, [items, trash]);
  const open = items?.find((m) => m.id === openId) ?? null;
  const filtered = !!q || filter !== 'all' || type !== 'all' || shape !== 'all';

  function openItem(id: string | null) {
    if (id === openId) return;
    if (dirty.current && !confirm('Discard the unsaved changes to this image?')) return;
    dirty.current = false; setOpenId(id);
  }
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ---- uploads: a queue with progress, two at a time, retry on failure
  const enqueue = (files: FileList | File[], replaceOf?: string) => {
    const list = [...files].filter((f) => f.type === '' || ACCEPT.includes(f.type) || /\.(jpe?g|png|webp|avif|tiff?)$/i.test(f.name));
    const skipped = files.length - list.length;
    if (skipped) toast(`${skipped} file${skipped > 1 ? 's are' : ' is'} not an image Studio accepts (JPEG, PNG, WebP, AVIF or TIFF).`, true);
    setJobs((j) => [...j.filter((x) => x.state !== 'done'), ...list.slice(0, replaceOf ? 1 : 50).map((file) => ({ id: crypto.randomUUID(), file, p: 0, state: 'wait' as const, replaceOf, cropAfter: !replaceOf && list.length === 1 && can('media.update') }))]);
  };
  useEffect(() => {
    const running = jobs.filter((j) => j.state === 'up').length;
    const next = jobs.filter((j) => j.state === 'wait').slice(0, Math.max(0, 2 - running));
    if (!next.length) return;
    setJobs((js) => js.map((j) => next.some((n) => n.id === j.id) ? { ...j, state: 'up' } : j));
    for (const j of next) {
      const url = j.replaceOf ? `/studio/api/media/${j.replaceOf}/replace` : '/studio/api/media';
      sendFile(url, j.file, me.csrf, (p) => setJobs((js) => js.map((x) => x.id === j.id ? { ...x, p } : x)))
        .then((row) => {
          setJobs((js) => js.map((x) => x.id === j.id ? { ...x, p: 1, state: 'done' } : x));
          if (j.replaceOf) toast('File replaced. Every page keeps using this image and shows the new file from its next publish. Confirm the rights again for the new file.');
          else if (row?.id) { setOpenId((o) => o ?? row.id); if (j.cropAfter) setCropFor({ id: row.id, name: row.originalName ?? j.file.name, crop: null, fresh: true }); }
          load();
        })
        .catch((e) => setJobs((js) => js.map((x) => x.id === j.id ? { ...x, state: 'err', error: (e as Error).message } : x)));
    }
  }, [jobs, me.csrf, load, toast]);
  const doneCount = jobs.filter((j) => j.state === 'done' && !j.replaceOf).length;
  useEffect(() => { if (jobs.length && jobs.every((j) => j.state === 'done') && doneCount) { toast(`${doneCount} image${doneCount > 1 ? 's' : ''} uploaded. Add alt text, credit and rights before using ${doneCount > 1 ? 'them' : 'it'} on the website.`); } }, [jobs, doneCount, toast]);

  // ---- page-wide drop target
  useEffect(() => {
    if (!can('media.upload')) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDrag(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDrag(false); };
    const drop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; setDrag(false); if (e.dataTransfer?.files.length) enqueue(e.dataTransfer.files); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  // ---- actions shared by cards, rows and the panel
  const act = {
    copy: async (m: LibItem) => {
      const file = fileOf(m);
      const live = m.usedOn.some((u) => u.live);
      const url = live ? `${me.siteUrl.replace(/\/$/, '')}/assets/media/${file}` : new URL(`/studio/media-file/${file}`, location.origin).href;
      toast(await copy(url) ? (live ? 'Website address of the image copied.' : 'Studio link copied. It works for signed-in staff; the website address exists once a published page uses the image.') : 'Could not copy. Your browser blocked the clipboard.');
    },
    download: (m: LibItem) => { const a = document.createElement('a'); a.href = `/studio/api/media/${m.id}/original`; a.download = ''; document.body.append(a); a.click(); a.remove(); },
    replace: (m: LibItem) => { replaceTarget.current = m.id; replaceInput.current?.click(); },
    remove: (l: LibItem[]) => setConfirmDel(l),
    crop: (m: LibItem) => setCropFor({ id: m.id, name: m.originalName, crop: m.crop ?? null }),
  };

  // ---- keyboard: arrows move, Space selects, Enter opens
  function columns() { const g = gridRef.current; if (!g || view === 'list') return 1; return getComputedStyle(g).gridTemplateColumns.split(' ').length || 1; }
  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest('button:not(.ml-card), input, a')) return;
    const n = shown.length; if (!n) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns(), Home: -n, End: n }[e.key];
    if (step !== undefined) { e.preventDefault(); const i = Math.min(n - 1, Math.max(0, cursor + step)); setCursor(i); (gridRef.current?.querySelectorAll<HTMLElement>('[data-card]')[i])?.focus(); return; }
    const m = shown[cursor]; if (!m) return;
    if (e.key === ' ') { e.preventDefault(); toggle(m.id); }
    else if (e.key === 'Enter') { e.preventDefault(); openItem(m.id); }
    else if (e.key === 'Escape') { setSel(new Set()); }
  }

  useEffect(() => {
    if (!sel.size) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.overlay') && !(e.target as HTMLElement).closest('input, textarea')) setSel(new Set()); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sel.size]);
  const selItems = (items ?? []).filter((m) => sel.has(m.id));
  return (
    <div className={`ml${open ? ' has-panel' : ''}`}>
      <div className="page-h">
        <div><h1>Media Library</h1><p>Every image of the website with its alt text, credit, usage rights and where it appears.</p></div>
        {can('media.upload') && <button className="btn btn-primary" onClick={() => fileInput.current?.click()}><Icon n="upload" /> Upload</button>}
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) enqueue(e.target.files); e.target.value = ''; }} />
        <input ref={replaceInput} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && replaceTarget.current) enqueue([f], replaceTarget.current); e.target.value = ''; }} />
      </div>

      <div className="ml-filters" role="tablist" aria-label="Show">
        {([['all', 'All'], ['needs', 'Needs info'], ['used', 'In use'], ['unused', 'Unused'], ['dupes', 'Duplicates'], ['trash', 'Recently deleted']] as [Filter, string][]).map(([k, l]) =>
          (k !== 'dupes' || counts.dupes > 0) && (k !== 'trash' || trash.length > 0) && <button key={k} role="tab" aria-selected={filter === k} className={`ml-chip${filter === k ? ' on' : ''}${k === 'needs' && counts.needs ? ' warn' : ''}`} onClick={() => setFilter(k)}>{l}<b>{counts[k]}</b></button>)}
      </div>

      <div className="ml-body">
        <section className="card ml-main">
          <div className="ml-tools">
            <label className="search"><Icon n="search" /><span className="sr-only">Search media</span><input className="input" placeholder="Search name, alt text, credit or tag" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <select className="select" aria-label="File type" value={type} onChange={(e) => setType(e.target.value)}><option value="all">All types</option>{types.map((t) => <option key={t} value={t}>{fmt(t)}</option>)}</select>
            <select className="select" aria-label="Orientation" value={shape} onChange={(e) => setShape(e.target.value)}><option value="all">Any shape</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="square">Square</option></select>
            <select className="select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="new">Newest first</option><option value="name">Name</option><option value="size">Largest files</option><option value="used">Most used</option></select>
            <span className="ml-count">{filter === 'trash' ? `${trash.length} recently deleted` : items ? <>{filtered ? `${shown.length} of ${items.length}` : `${items.length} image${items.length === 1 ? '' : 's'}`}{counts.needs > 0 && <> · <button className="ml-count-l" onClick={() => setFilter('needs')}>{counts.needs} need{counts.needs === 1 ? 's' : ''} info</button></>}</> : '…'}</span>
            <div className="ml-seg" role="group" aria-label="Layout">
              <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')} title="Grid"><MI n="grid" /></button>
              <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')} title="List"><MI n="list" /></button>
            </div>
            {view === 'grid' && <div className="ml-seg ml-size" role="group" aria-label="Thumbnail size">
              {(['s', 'm', 'l'] as const).map((s) => <button key={s} className={size === s ? 'on' : ''} aria-pressed={size === s} onClick={() => setSize(s)} title={{ s: 'Small', m: 'Medium', l: 'Large' }[s]}>{s.toUpperCase()}</button>)}
            </div>}
          </div>

          {sel.size > 0 && <BulkBar items={selItems} onClear={() => setSel(new Set())} onSelectAll={() => setSel(new Set(shown.map((m) => m.id)))} allSelected={shown.every((m) => sel.has(m.id))} onDone={load} onDelete={() => act.remove(selItems)} />}

          {failed && <div className="ml-err">Could not load the library. <button className="btn btn-sm" onClick={load}>Try again</button></div>}
          {filter === 'trash' ? <TrashList items={trash} onRestored={load} />
            : !items ? <Skeleton size={size} />
            : items.length === 0 ? <EmptyLibrary onPick={() => fileInput.current?.click()} canUpload={can('media.upload')} />
            : shown.length === 0 ? <div className="ml-empty"><div className="ml-empty-i"><Icon n="search" /></div><b>No images match</b><p>Try another search or clear the filters.</p><button className="btn btn-sm" onClick={() => { setQ(''); setFilter('all'); setType('all'); setShape('all'); }}>Clear filters</button></div>
            : <div ref={gridRef} className={view === 'grid' ? `ml-grid sz-${size}` : 'ml-list'} role="listbox" aria-multiselectable="true" aria-label="Images" onKeyDown={onKey}>
              {view === 'list' && <div className="ml-lh" aria-hidden="true"><span /><span>Image</span><span>Size</span><span>Used on</span><span>Needs</span><span>Uploaded</span><span /></div>}
              {shown.map((m, i) => <Card key={m.id} m={m} list={view === 'list'} on={open?.id === m.id} picked={sel.has(m.id)} tab={i === cursor}
                onFocus={() => setCursor(i)} onOpen={() => openItem(m.id)} onPick={() => toggle(m.id)} act={act} can={can} />)}
            </div>}
          {items && items.length > 0 && <div className="ml-keys muted"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Space</kbd> select · <kbd>Enter</kbd> open · drop files anywhere to upload</div>}
        </section>

        {open && <aside className="ml-side">
          <Detail key={open.id} m={open} all={items ?? []} onClose={() => openItem(null)} onOpen={openItem} onDirty={(d) => { dirty.current = d; }}
            onSaved={(r) => { setItems((x) => x?.map((i) => i.id === r.id ? { ...i, ...r } : i) ?? null); load(); }} act={act} />
        </aside>}
      </div>

      {jobs.length > 0 && <UploadQueue jobs={jobs} onRetry={(id) => setJobs((js) => js.map((j) => j.id === id ? { ...j, state: 'wait', p: 0, error: undefined } : j))}
        onDismiss={() => setJobs((js) => js.filter((j) => j.state === 'up' || j.state === 'wait'))} onOpen={() => { /* newest upload is opened when it finishes */ }} />}
      {drag && <div className="ml-drop-over" aria-hidden="true"><div><MI n="download" size={30} /><b>Drop to upload</b><small>JPEG, PNG, WebP, AVIF or TIFF. Location data is removed.</small></div></div>}
      {cropFor && <CropDialog t={cropFor} onClose={() => setCropFor(null)} onSaved={() => { setCropFor(null); load(); }} />}
      {confirmDel && <DeleteDialog list={confirmDel} onClose={() => setConfirmDel(null)} onDone={(ids) => { setConfirmDel(null); setSel((s) => { const n = new Set(s); ids.forEach((x) => n.delete(x)); return n; }); if (openId && ids.includes(openId)) { dirty.current = false; setOpenId(null); } load(); }} />}
    </div>
  );
}

type Acts = { copy: (m: LibItem) => void; download: (m: LibItem) => void; replace: (m: LibItem) => void; remove: (l: LibItem[]) => void; crop: (m: LibItem) => void };

function Badges({ m, max = 3 }: { m: LibItem; max?: number }) {
  // most useful first: missing alt text and rights, then duplicates, then a missing credit
  const b: { k: string; l: string; c: string }[] = [
    ...m.issues.filter((i) => i !== 'credit').map((i) => ({ k: i, l: ISSUE[i], c: 'warn' })),
    ...(m.duplicateOf ? [{ k: 'dup', l: m.duplicateOf.exact ? 'Duplicate' : 'Looks similar', c: 'info' }] : []),
    ...(m.issues.includes('credit') ? [{ k: 'credit', l: ISSUE.credit, c: 'soft' }] : []),
  ];
  const n = pages(m);
  b.push(n ? { k: 'use', l: `Used on ${n} page${n > 1 ? 's' : ''}`, c: m.usedOn.some((u) => u.live) ? 'ok' : 'plain' } : { k: 'unused', l: 'Unused', c: 'plain' });
  return <>{b.slice(0, max).map((x) => <span key={x.k} className={`ml-b ${x.c}`}>{x.l}</span>)}{b.length > max && <span className="ml-b plain">+{b.length - max}</span>}</>;
}

function Card({ m, list, on, picked, tab, onFocus, onOpen, onPick, act, can }: { m: LibItem; list: boolean; on: boolean; picked: boolean; tab: boolean; onFocus: () => void; onOpen: () => void; onPick: () => void; act: Acts; can: (p: string) => boolean }) {
  const name = cleanName(m.originalName);
  const tools = <div className="ml-acts" onClick={(e) => e.stopPropagation()}>
    <button title="Copy URL" aria-label={`Copy URL of ${name}`} onClick={() => act.copy(m)}><MI n="copy" /></button>
    <button title="Download original" aria-label={`Download ${name}`} onClick={() => act.download(m)}><MI n="download" /></button>
    {can('media.update') && <button title="Crop" aria-label={`Crop ${name}`} onClick={() => act.crop(m)}><MI n="crop" /></button>}
    {can('media.update') && <button title="Replace file" aria-label={`Replace the file of ${name}`} onClick={() => act.replace(m)}><MI n="replace" /></button>}
    {can('media.delete') && <button className="bad" title={m.usedOn.length ? 'Delete (a placeholder shows where it is used)' : 'Delete'} aria-label={`Delete ${name}`} onClick={() => act.remove([m])}><MI n="trash" /></button>}
  </div>;
  const check = <label className="ml-pick" onClick={(e) => e.stopPropagation()} title="Select"><input type="checkbox" checked={picked} onChange={onPick} tabIndex={-1} aria-label={`Select ${name}`} /></label>;
  const common = { 'data-card': '', role: 'option', 'aria-selected': picked, tabIndex: tab ? 0 : -1, onFocus, onClick: onOpen, title: m.originalName } as const;
  if (list) return <div {...common} className={`ml-row${on ? ' on' : ''}${picked ? ' picked' : ''}`}>
    {check}
    <span className="ml-row-n"><img src={m.url} alt="" loading="lazy" style={{ objectPosition: `${m.focalX}% ${m.focalY}%` }} /><span><b>{name}</b><small>{m.alt || <em>No alt text</em>}</small></span></span>
    <span className="ml-dim">{m.width}×{m.height}<small>{mb(m.bytes)} · {fmt(m.mime)}</small></span>
    <span className="ml-dim">{pages(m) ? `${pages(m)} page${pages(m) > 1 ? 's' : ''}` : <span className="muted">Unused</span>}{m.usedOn.some((u) => u.live) && <small className="ok">Live</small>}</span>
    <span className="ml-row-b">{m.issues.length ? m.issues.map((i) => <span key={i} className={`ml-b ${i === 'credit' ? 'soft' : 'warn'}`}>{ISSUE[i].replace('Needs ', '').replace(/^./, (c) => c.toUpperCase())}</span>) : <span className="ml-b ok">Ready</span>}</span>
    <span className="ml-dim muted">{ago(m.createdAt)}</span>
    {tools}
  </div>;
  return <div {...common} className={`ml-card${on ? ' on' : ''}${picked ? ' picked' : ''}`}>
    <div className="ml-thumb"><img src={m.url} alt="" loading="lazy" style={{ objectPosition: `${m.focalX}% ${m.focalY}%` }} />{check}{tools}</div>
    <div className="ml-meta"><b>{name}</b><small>{m.width}×{m.height} · {mb(m.bytes)}</small><div className="ml-badges"><Badges m={m} /></div></div>
  </div>;
}

function Skeleton({ size }: { size: string }) {
  return <div className={`ml-grid sz-${size}`} aria-busy="true" aria-label="Loading images">{Array.from({ length: 12 }, (_, i) => <div key={i} className="ml-card ml-sk"><div className="ml-thumb skeleton" /><div className="ml-meta"><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '40%', height: 10 }} /></div></div>)}</div>;
}

function EmptyLibrary({ onPick, canUpload }: { onPick: () => void; canUpload: boolean }) {
  return <div className="ml-empty">
    <div className="ml-empty-i"><Icon n="image" /></div><b>No images yet</b>
    <p>Photos uploaded here can be used on projects, stories, events, partners and pages. Studio resizes them for the website and removes location data.</p>
    {canUpload && <button className="ml-dropzone" onClick={onPick}><Icon n="upload" /><span><b>Drop images here or choose files</b><small>JPEG, PNG, WebP, AVIF or TIFF</small></span></button>}
  </div>;
}

function UploadQueue({ jobs, onRetry, onDismiss }: { jobs: Job[]; onRetry: (id: string) => void; onDismiss: () => void; onOpen: () => void }) {
  const [min, setMin] = useState(false);
  const active = jobs.filter((j) => j.state === 'up' || j.state === 'wait').length; const errs = jobs.filter((j) => j.state === 'err').length;
  return <div className="ml-queue" role="status" aria-live="polite">
    <div className="ml-q-h"><b>{active ? `Uploading ${active} of ${jobs.length}…` : errs ? `${errs} upload${errs > 1 ? 's' : ''} failed` : 'Uploads finished'}</b>
      <button className="btn btn-ghost btn-sm" onClick={() => setMin(!min)}>{min ? 'Show' : 'Hide'}</button>
      {!active && <button className="btn btn-ghost icon-btn btn-sm" aria-label="Close" onClick={onDismiss}><Icon n="x" /></button>}</div>
    {!min && <ul>{jobs.map((j) => <li key={j.id} className={j.state}>
      <span className="ml-q-n" title={j.file.name}>{j.replaceOf ? 'Replace: ' : ''}{j.file.name}<small>{j.state === 'err' ? j.error : j.state === 'done' ? 'Done' : j.state === 'wait' ? 'Waiting' : j.p >= 1 ? 'Processing…' : `${Math.round(j.p * 100)}%`} · {mb(j.file.size)}</small></span>
      {j.state === 'err' ? <button className="btn btn-sm" onClick={() => onRetry(j.id)}>Retry</button> : j.state === 'done' ? <Icon n="check" /> : null}
      <i style={{ width: `${(j.state === 'done' ? 1 : j.p) * 100}%` }} />
    </li>)}</ul>}
  </div>;
}

// ================================================================= Bulk
function BulkBar({ items, allSelected, onClear, onSelectAll, onDone, onDelete }: { items: LibItem[]; allSelected: boolean; onClear: () => void; onSelectAll: () => void; onDone: () => void; onDelete: () => void }) {
  const can = useCan(); const toast = useToast();
  const [mode, setMode] = useState<null | 'tags' | 'credit' | 'licence' | 'compress'>(null); const [lvl, setLvl] = useState<Level>('balanced'); const [v, setV] = useState(''); const [until, setUntil] = useState(''); const [busy, setBusy] = useState(false);
  const unused = items.filter((m) => !m.usedOn.length).length;
  async function run(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { const r = await post<{ updated: number }>('/media/bulk', { ids: items.map((m) => m.id), ...body }); toast(`${msg} on ${r.updated} image${r.updated === 1 ? '' : 's'}.`); setMode(null); setV(''); onDone(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return <div className="ml-bulk" role="region" aria-label="Bulk actions">
    <button className="btn btn-ghost icon-btn btn-sm" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}><Icon n="x" /></button>
    <b>{items.length} selected</b>
    {!allSelected && <button className="btn btn-ghost btn-sm" onClick={onSelectAll}>Select all shown</button>}
    <span className="ml-bulk-sp" />
    <div className="ml-bulk-a">
    {mode === 'compress' ? <form className="ml-bulk-f" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { toast(`Compressed ${items.length} image${items.length > 1 ? 's' : ''}: ${await compress(items.map((m) => m.id), lvl)}. Pages use the new copies from their next publish.`); setMode(null); onDone(); } catch (er) { toast((er as Error).message, true); } finally { setBusy(false); } }}>
      <select className="select" value={lvl} onChange={(e) => setLvl(e.target.value as Level)} aria-label="Compression level">{(Object.keys(LEVEL) as Level[]).map((k) => <option key={k} value={k}>{LEVEL[k].l}</option>)}</select>
      <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Compressing…' : 'Compress'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
    </form> : mode ? <form className="ml-bulk-f" onSubmit={(e) => { e.preventDefault(); if (mode === 'tags') { const tags = v.split(',').map((x) => x.trim()).filter(Boolean); if (tags.length) run({ addTags: tags }, `Added ${tags.length > 1 ? 'tags' : `tag “${tags[0]}”`}`); } else if (mode === 'licence') run({ licence: v.trim(), rightsExpiresOn: until || null }, v.trim() ? `Licence “${v.trim()}”${until ? ` until ${until}` : ''} set` : 'Licence cleared'); else run({ credit: v.trim() }, v.trim() ? 'Credit set' : 'Credit cleared'); }}>
      <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={mode === 'tags' ? 200 : 200} list={mode === 'licence' ? 'ml-licences-b' : undefined} placeholder={mode === 'tags' ? 'Tags, separated by commas' : mode === 'licence' ? 'Licence, e.g. Used with permission' : 'Photographer or source'} aria-label={mode === 'tags' ? 'Tags to add' : mode === 'licence' ? 'Licence' : 'Credit'} />
      {mode === 'licence' && <><datalist id="ml-licences-b">{['AFCD own photo', 'Used with permission', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC0 / public domain', 'Partner photo'].map((x) => <option key={x} value={x} />)}</datalist>
        <input className="input ml-bulk-d" type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Rights end (optional)" title="Rights end (optional)" /></>}
      <button className="btn btn-primary btn-sm" disabled={busy}>{mode === 'tags' ? 'Add' : 'Set'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Cancel</button>
    </form> : can('media.update') && <>
      <button className="btn btn-sm" onClick={() => { setMode('tags'); setV(''); }}><MI n="tag" size={14} /> Add tags</button>
      <button className="btn btn-sm" onClick={() => { setMode('credit'); setV(''); }}>Set credit</button>
      <button className="btn btn-sm" onClick={() => { setMode('licence'); setV(''); setUntil(''); }}>Set licence</button>
      <button className="btn btn-sm" onClick={() => { setMode('compress'); setLvl('balanced'); }} title="Make the website copies lighter for faster pages. Originals are kept.">Compress</button>
      <button className="btn btn-sm" disabled={busy} onClick={() => { if (confirm(`Confirm usage rights and consent for ${items.length} image${items.length > 1 ? 's' : ''}? Only do this if AFCD may publish all of them and the people shown agreed.`)) run({ rightsConfirmed: true }, 'Rights confirmed'); }}>Confirm rights</button>
    </>}
    {!mode && can('media.delete') && <button className="btn btn-sm btn-danger" onClick={onDelete} title={unused < items.length ? `${items.length - unused} of them are in use: a placeholder shows there` : ''}><MI n="trash" size={14} /> Delete {items.length}</button>}
    </div>
  </div>;
}

function DeleteDialog({ list, onClose, onDone }: { list: LibItem[]; onClose: () => void; onDone: (ids: string[]) => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  // every selected image is deleted, in use or not; where one was used, a placeholder shows instead
  const inUse = list.filter((m) => m.usedOn.length);
  const live = inUse.some((m) => m.usedOn.some((u) => u.live));
  async function run() {
    setBusy(true); const gone: string[] = [];
    for (const m of list) { try { await del(`/media/${m.id}${m.usedOn.length ? '?force=1' : ''}`); gone.push(m.id); } catch (e) { toast(`${cleanName(m.originalName)}: ${(e as Error).message}`, true); } }
    setBusy(false);
    if (gone.length) toast(`${gone.length} image${gone.length > 1 ? 's' : ''} deleted${inUse.length ? ', with a placeholder where they were used' : ''}. Restore from Recently deleted within 30 days.`);
    onDone(gone);
  }
  const one = list.length === 1;
  return <Modal size="sm" title={one ? 'Delete this image?' : `Delete ${list.length} images?`} onClose={onClose} footer={<>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn ml-del-btn" disabled={busy} onClick={run} autoFocus>{busy ? 'Deleting…' : one ? 'Delete' : `Delete ${list.length}`}</button></>}>
    <div className="modal-b stack">
      {inUse.length > 0 && <div className="ml-info"><b>{one ? 'A placeholder will show where it is used:' : `${inUse.length} of them ${inUse.length > 1 ? 'are' : 'is'} in use. A placeholder will show there:`}</b>
        <ul>{inUse.slice(0, 6).flatMap((m) => m.usedOn.slice(0, one ? 8 : 3).map((u, i) => <li key={m.id + i}>{!one && <>{cleanName(m.originalName)} → </>}{u.kind === u.title ? u.title : `${u.kind}: ${u.title}`} <span className="muted">({u.where})</span></li>))}</ul>
        {inUse.length > 6 && <small className="muted">and {inUse.length - 6} more</small>}
        {live && <small className="muted">The website keeps the current photo until the next publish.</small>}</div>}
      <p className="muted" style={{ margin: 0 }}>You can restore {one ? 'it' : 'them'} from <b>Recently deleted</b> for 30 days{inUse.length ? ', back in the same places' : ''}.</p>
    </div>
  </Modal>;
}

function TrashList({ items, onRestored }: { items: TrashItem[]; onRestored: () => void }) {
  const can = useCan(); const toast = useToast(); const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return <div className="ml-empty"><div className="ml-empty-i"><MI n="trash" /></div><b>Nothing deleted recently</b><p>Deleted images stay here for 30 days.</p></div>;
  async function restore(it: TrashItem) {
    setBusy(it.row.id);
    try {
      const r = await post<{ restored: number; notRestored: number }>(`/media/trash/${it.row.id}/restore`, {});
      toast(r.notRestored ? `${cleanName(it.row.originalName)} restored. ${r.notRestored} place${r.notRestored > 1 ? 's were' : ' was'} edited since, so choose the photo there again.` : `${cleanName(it.row.originalName)} restored${r.restored ? ' and put back where it was used' : ''}.`);
      onRestored();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }
  return <div className="ml-trash">
    <p className="muted ml-none">Images deleted in the last 30 days. After that they are removed for good.</p>
    <ul>{items.map((it) => { const left = Math.max(0, 30 - Math.floor((Date.now() - Date.parse(it.deletedAt)) / 864e5)); return <li key={it.row.id}>
      {it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <span className="ml-trash-ph" />}
      <span className="ml-trash-n"><b title={it.row.originalName}>{cleanName(it.row.originalName)}</b>
        <small>Deleted {ago(it.deletedAt)}{it.deletedBy ? ` by ${it.deletedBy}` : ''} · {left} day{left === 1 ? '' : 's'} left{it.usedOn.length ? ` · was used in ${it.usedOn.length} place${it.usedOn.length > 1 ? 's' : ''}` : ''}</small></span>
      {can('media.delete') && <button className="btn btn-sm" disabled={busy === it.row.id} onClick={() => restore(it)}>{busy === it.row.id ? 'Restoring…' : 'Restore'}</button>}
    </li>; })}</ul>
  </div>;
}

// ================================================================= Compression
/** Compression of the website copies: pick a level and it is applied at once (from the original, so it can be changed back). */
function Compression({ m, ro, onDone }: { m: LibItem; ro: boolean; onDone: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState<Level | null>(null);
  const cur = m.quality ?? 'best';
  async function go(l: Level) {
    if (l === cur || busy) return;
    setBusy(l);
    try { toast(`${LEVEL[l].l}: ${await compress([m.id], l)}. Pages use the new copies from their next publish.`); onDone(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }
  return <div className="ml-compress">
    <div className="ml-compress-h"><b>Compression</b>{m.webBytes !== undefined && <span className="muted">{mb(m.webBytes)} on the website</span>}</div>
    <div className="ml-seg ml-levels" role="radiogroup" aria-label="Compression">
      {(Object.keys(LEVEL) as Level[]).map((k) => <button key={k} role="radio" aria-checked={cur === k} className={cur === k ? 'on' : ''} disabled={ro || !!busy} title={LEVEL[k].d} onClick={() => go(k)}>{busy === k ? 'Working…' : LEVEL[k].l}</button>)}
    </div>
    <small className="muted">{LEVEL[cur].d} The original upload is kept.</small>
  </div>;
}

// ================================================================= Crop
const RATIOS: [string, number | null | 'orig'][] = [['Free', null], ['Original', 'orig'], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9], ['3:2', 3 / 2], ['4:5', 4 / 5]];
type Box = { x: number; y: number; w: number; h: number };   // in original pixels

/** Crop on the original: drag the frame, pull its corners, or zoom; pick a ratio. The original file is never changed. */
function CropDialog({ t, onClose, onSaved }: { t: CropTarget; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; b: Box } | null>(null);
  const src = `/studio/api/media/${t.id}/source`;

  const clamp = (b: Box, n = nat!): Box => {
    const w = Math.max(16, Math.min(b.w, n.w)), h = Math.max(16, Math.min(b.h, n.h));
    return { w: Math.round(w), h: Math.round(h), x: Math.round(Math.min(Math.max(0, b.x), n.w - w)), y: Math.round(Math.min(Math.max(0, b.y), n.h - h)) };
  };
  /** Largest box of ratio r that fits, scaled by z (0..1), centred on (cx, cy). */
  const fit = (r: number | null, z: number, c?: { x: number; y: number }, n = nat!): Box => {
    let w = n.w, h = n.h;
    if (r) { if (n.w / n.h > r) w = n.h * r; else h = n.w / r; }
    w *= z; h *= z;
    const cx = c?.x ?? n.w / 2, cy = c?.y ?? n.h / 2;
    return clamp({ x: cx - w / 2, y: cy - h / 2, w, h }, n);
  };
  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const n = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }; setNat(n);
    setBox(t.crop ? clamp(t.crop, n) : { x: 0, y: 0, w: n.w, h: n.h });
  }
  const zoom = box && nat ? (() => { const full = fit(ratio ?? box.w / box.h, 1); return Math.max(0.1, Math.min(1, box.w / full.w)); })() : 1;
  function pickRatio(r: number | null | 'orig') {
    const v = r === 'orig' ? nat!.w / nat!.h : r; setRatio(v);
    if (v && box) setBox(fit(v, 1, { x: box.x + box.w / 2, y: box.y + box.h / 2 }));
  }
  const scale = () => (stage.current ? nat!.w / stage.current.getBoundingClientRect().width : 1);
  function down(e: React.PointerEvent, mode: string) {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, b: box! };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current; if (!d || !nat) return;
    const k = scale(); const dx = (e.clientX - d.sx) * k, dy = (e.clientY - d.sy) * k; const b = d.b;
    if (d.mode === 'move') { setBox(clamp({ ...b, x: b.x + dx, y: b.y + dy })); return; }
    // corners: the opposite corner stays put
    const left = d.mode.includes('w'), top = d.mode.includes('n');
    const ax = left ? b.x + b.w : b.x, ay = top ? b.y + b.h : b.y;
    let w = Math.max(16, left ? b.w - dx : b.w + dx), h = Math.max(16, top ? b.h - dy : b.h + dy);
    w = Math.min(w, left ? ax : nat.w - ax); h = Math.min(h, top ? ay : nat.h - ay);
    if (ratio) { if (w / h > ratio) w = h * ratio; else h = w / ratio; }
    setBox(clamp({ x: left ? ax - w : ax, y: top ? ay - h : ay, w, h }));
  }
  function key(e: React.KeyboardEvent) {
    if (!box) return; const st = e.shiftKey ? 50 : 10;
    const v = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (v) { e.preventDefault(); setBox(clamp({ ...box, x: box.x + v[0], y: box.y + v[1] })); }
  }
  const whole = !!box && !!nat && box.x === 0 && box.y === 0 && box.w === nat.w && box.h === nat.h;
  async function save(crop: Box | null) {
    setBusy(true);
    try { await post(`/media/${t.id}/crop`, { crop }); toast(crop ? 'Cropped. The original is kept: you can re-crop or reset it any time. Pages show the new crop from their next publish.' : 'Crop removed: the whole image is used again.'); onSaved(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return <Modal title={t.fresh ? 'Crop the new image?' : `Crop ${cleanName(t.name)}`} onClose={onClose} footer={<>
    {t.crop && <button className="btn btn-ghost" disabled={busy} onClick={() => save(null)} style={{ marginRight: 'auto' }}>Reset to original</button>}
    <button className="btn" onClick={onClose}>{t.fresh ? 'Skip' : 'Cancel'}</button>
    <button className="btn btn-primary" disabled={busy || !box || (whole && !t.crop)} onClick={() => save(whole ? null : box)}>{busy ? 'Saving…' : 'Save crop'}</button></>}>
    <div className="modal-b stack ml-cropper">
      <div className="ml-ratios" role="group" aria-label="Aspect ratio">{RATIOS.map(([l, r]) => { const v = r === 'orig' ? (nat ? nat.w / nat.h : -1) : r; const on = v === ratio || (v === null && ratio === null);
        return <button key={l} className={`ml-chip${on ? ' on' : ''}`} aria-pressed={on} disabled={!nat} onClick={() => pickRatio(r)}>{l}</button>; })}</div>
      <div className="ml-crop-stage-w">
        {failed ? <p className="muted">The original file could not be loaded, so this image cannot be cropped.</p> :
        <div ref={stage} className="ml-crop-stage" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <img src={src} alt="" draggable={false} onLoad={onLoad} onError={() => setFailed(true)} />
          {box && nat && <div className="ml-crop-box" tabIndex={0} role="group" aria-label={`Crop frame, ${box.w} by ${box.h} pixels. Arrow keys move it.`} onKeyDown={key}
            style={{ left: pct(box.x, nat.w), top: pct(box.y, nat.h), width: pct(box.w, nat.w), height: pct(box.h, nat.h) }} onPointerDown={(e) => down(e, 'move')}>
            <i className="g1" /><i className="g2" />
            {['nw', 'ne', 'sw', 'se'].map((c) => <b key={c} className={`h ${c}`} onPointerDown={(e) => down(e, c)} />)}
          </div>}
        </div>}
      </div>
      <div className="ml-crop-foot">
        <label className="ml-zoom"><span>Zoom</span><input type="range" min={10} max={100} value={Math.round((1.1 - zoom) * 100)} disabled={!box}
          onChange={(e) => { if (!box) return; const z = 1.1 - Number(e.target.value) / 100; setBox(fit(ratio ?? box.w / box.h, Math.min(1, Math.max(0.1, z)), { x: box.x + box.w / 2, y: box.y + box.h / 2 })); }} /></label>
        <small className="muted">{box ? `${box.w} × ${box.h} px` : 'Loading…'}{nat && box && box.w < 960 ? ' · small for a wide photo on the website' : ''}</small>
      </div>
      <small className="muted">{t.fresh ? 'Optional. Skip keeps the image as uploaded. ' : ''}The original stays as it is: you can re-crop or reset later. Alt text, credit and rights are kept.</small>
    </div>
  </Modal>;
}

// ================================================================= Detail panel
function Detail({ m, all, onClose, onOpen, onDirty, onSaved, act }: { m: LibItem; all: LibItem[]; onClose: () => void; onOpen: (id: string) => void; onDirty: (d: boolean) => void; onSaved: (m: Partial<LibItem> & { id: string }) => void; act: Acts }) {
  const can = useCan(); const toast = useToast();
  const init = { alt: m.alt, caption: m.caption, credit: m.credit, rightsConfirmed: m.rightsConfirmed, licence: m.licence ?? '', rightsExpiresOn: m.rightsExpiresOn ?? null, focalX: m.focalX, focalY: m.focalY, tags: m.tags };
  const [f, setF] = useState(init); const [busy, setBusy] = useState(false); const [tag, setTag] = useState('');
  const ro = !can('media.update');
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    try { const r = await patch<MediaItem>(`/media/${m.id}`, f); onDirty(false); onSaved({ ...r, tags: f.tags, licence: f.licence, rightsExpiresOn: f.rightsExpiresOn }); toast('Image details saved.'); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && dirty && !ro) { e.preventDefault(); save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  const addTag = (raw: string) => { const l = raw.split(',').map((x) => x.trim().slice(0, 40)).filter(Boolean); if (l.length) set('tags', [...new Set([...f.tags, ...l])].slice(0, 20)); setTag(''); };
  const altWarn = /^(an? )?(image|photo|picture|photograph) of\b/i.test(f.alt.trim()) ? 'Screen readers already say it is an image: start with what it shows.' : f.alt.trim() && f.alt.trim().length < 8 ? 'Very short. Say who or what is in the photo, and where if it matters.' : '';
  const dups = (m.duplicateOf?.ids ?? []).map((id) => all.find((x) => x.id === id)).filter(Boolean) as LibItem[];
  const groups = Object.entries(m.usedOn.reduce<Record<string, Use[]>>((a, u) => { (a[u.href] ??= []).push(u); return a; }, {}));

  return <section className="card ml-panel" aria-label={`Details of ${cleanName(m.originalName)}`}>
    <div className="ml-p-h">
      <button className="btn btn-ghost icon-btn ml-back" onClick={onClose} aria-label="Back to the library"><MI n="back" /></button>
      <div className="ml-p-t"><h2 title={m.originalName}>{cleanName(m.originalName)}</h2><small>{m.width}×{m.height} · {mb(m.bytes)} · {fmt(m.mime)}</small></div>
      <button className="btn btn-ghost icon-btn ml-close" onClick={onClose} aria-label="Close details"><Icon n="x" /></button>
    </div>

    <Focal m={m} x={f.focalX} y={f.focalY} ro={ro} onChange={(x, y) => setF((v) => ({ ...v, focalX: x, focalY: y }))} />

    <div className="ml-quick">
      <button className="btn btn-sm" onClick={() => act.copy(m)}><MI n="copy" size={14} /> Copy URL</button>
      <button className="btn btn-sm" onClick={() => act.download(m)}><MI n="download" size={14} /> Original</button>
      {!ro && <button className="btn btn-sm" onClick={() => act.crop(m)} title="Crop. The original is kept, so you can change or undo it later."><MI n="crop" size={14} /> {m.crop ? 'Re-crop' : 'Crop'}</button>}
      {!ro && <button className="btn btn-sm" onClick={() => act.replace(m)} title="Upload a new file in its place. Every page keeps using it."><MI n="replace" size={14} /> Replace</button>}
    </div>

    <Compression m={m} ro={ro} onDone={() => onSaved({ id: m.id })} />

    {m.issues.length > 0 && <div className="ml-todo"><b>Before this image goes on the website</b><ul>
      {m.issues.includes('alt') && <li className={f.alt.trim() ? 'done' : ''}>Describe it in the alt text</li>}
      {m.issues.includes('credit') && <li className={f.credit.trim() ? 'done' : ''}>Credit the photographer or source</li>}
      {m.issues.includes('rights') && <li className={f.rightsConfirmed ? 'done' : ''}>Confirm usage rights and consent</li>}
      {m.issues.includes('expired') && <li className={!f.rightsExpiresOn || f.rightsExpiresOn >= today() ? 'done' : ''}>The usage right ended on {fmtDate(m.rightsExpiresOn!)}: renew it or stop using the image</li>}
    </ul></div>}

    <div className="ml-fields">
      <label className="field"><span>Alt text <em className="muted">· {f.alt.length}/250</em></span>
        <textarea className="textarea" rows={3} value={f.alt} maxLength={250} disabled={ro} onChange={(e) => set('alt', e.target.value)} placeholder="Who or what the photo shows, and where if it matters" />
        <small className={altWarn ? 'ml-hint warn' : 'ml-hint'}>{altWarn || 'What someone who cannot see the photo needs to know. Required before publishing.'}</small></label>
      <label className="field"><span>Caption <em className="muted">· optional, shown under the photo</em></span><input className="input" value={f.caption} maxLength={500} disabled={ro} onChange={(e) => set('caption', e.target.value)} /></label>
      <label className="field"><span>Credit</span><input className="input" value={f.credit} maxLength={200} disabled={ro} onChange={(e) => set('credit', e.target.value)} placeholder="Photographer or source" /></label>
      <label className={`check ml-rights${f.rightsConfirmed ? ' on' : ''}`}><input type="checkbox" checked={f.rightsConfirmed} disabled={ro} onChange={(e) => set('rightsConfirmed', e.target.checked)} />
        <span><b>Usage rights and consent confirmed</b><small className="muted">AFCD may publish this image, and people who can be identified agreed to appear in it.</small></span></label>
      <div className="ml-two">
        <label className="field"><span>Licence <em className="muted">· optional</em></span><input className="input" list="ml-licences" value={f.licence} maxLength={120} disabled={ro} onChange={(e) => set('licence', e.target.value)} placeholder="e.g. AFCD own photo" />
          <datalist id="ml-licences">{['AFCD own photo', 'Used with permission', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC0 / public domain', 'Partner photo'].map((x) => <option key={x} value={x} />)}</datalist></label>
        <label className="field"><span>Rights end <em className="muted">· optional</em></span><input className="input" type="date" value={f.rightsExpiresOn ?? ''} disabled={ro} onChange={(e) => set('rightsExpiresOn', e.target.value || null)} />
          {f.rightsExpiresOn && f.rightsExpiresOn < today() && <small className="ml-hint warn">This date has passed.</small>}</label>
      </div>
      <div className="field"><span>Tags</span>
        <div className="ml-tags">{f.tags.map((t) => <span key={t} className="ml-tag">{t}{!ro && <button aria-label={`Remove tag ${t}`} onClick={() => set('tags', f.tags.filter((x) => x !== t))}><Icon n="x" width={12} height={12} /></button>}</span>)}
          {!ro && <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={f.tags.length ? 'Add…' : 'Add tags, e.g. event, school'} aria-label="Add a tag"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tag); } else if (e.key === 'Backspace' && !tag && f.tags.length) set('tags', f.tags.slice(0, -1)); }} onBlur={() => tag && addTag(tag)} />}</div></div>
    </div>

    <div className="ml-sec"><h3>Used on {groups.length > 0 && <span className="muted">· {groups.length} page{groups.length > 1 ? 's' : ''}</span>}</h3>
      {groups.length ? <ul className="ml-uses">{groups.map(([href, l]) => <li key={href}><a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}><b>{l[0].title}</b><small>{l[0].kind} · {[...new Set(l.map((u) => u.where))].join(', ')}</small></a>{l.some((u) => u.live) && <span className="ml-b ok">Live</span>}</li>)}</ul>
        : <p className="muted ml-none">Not used anywhere yet. Choose it from a project, story, event or page editor.</p>}</div>

    {dups.length > 0 && <div className="ml-sec"><h3>{m.duplicateOf!.exact ? 'Same file uploaded again' : 'Looks like'}</h3>
      <p className="muted ml-none">{m.duplicateOf!.exact ? 'These are byte-for-byte copies. Keep one and delete the unused copies.' : 'These look nearly identical (resized or recompressed). Check before keeping both.'}</p>
      <div className="ml-dups">{dups.map((d) => <button key={d.id} onClick={() => onOpen(d.id)} title={d.originalName}><img src={d.url} alt="" /><small>{d.usedOn.length ? `In use` : 'Unused'}</small></button>)}</div></div>}

    <dl className="ml-kv">
      <dt>Dimensions</dt><dd>{m.width} × {m.height} px ({orient(m)})</dd>
      <dt>File</dt><dd>{fmt(m.mime)} · {mb(m.bytes)} original</dd>
      {m.webBytes !== undefined && <><dt>On the website</dt><dd>{mb(m.webBytes)} in all sizes · {LEVEL[m.quality ?? 'best'].l}</dd></>}
      {(m.licence || m.rightsExpiresOn) && <><dt>Rights</dt><dd>{[m.licence, m.rightsExpiresOn ? `until ${fmtDate(m.rightsExpiresOn)}` : ''].filter(Boolean).join(' · ')}</dd></>}
      <dt>Uploaded</dt><dd>{fmtDate(m.createdAt)}{m.uploadedByName ? ` by ${m.uploadedByName}` : ''}</dd>
      {m.updatedAt !== m.createdAt && <><dt>Last changed</dt><dd>{fmtDate(m.updatedAt)}</dd></>}
    </dl>

    <div className="ml-p-f">
      {can('media.delete') && <button className="btn btn-ghost btn-danger btn-sm" onClick={() => act.remove([m])} title={m.usedOn.length ? 'Delete. A placeholder shows where it is used.' : ''}><MI n="trash" size={14} /> Delete</button>}
      <span style={{ flex: 1 }} />
      {!ro && <>{dirty && <button className="btn btn-ghost btn-sm" onClick={() => setF(init)}>Discard</button>}
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : dirty ? 'Save details' : 'Saved'}</button></>}
    </div>
  </section>;
}

/** Click, drag or use the arrow keys to set the point the website keeps in view when it crops the image (object-position). */
function Focal({ m, x, y, ro, onChange }: { m: LibItem; x: number; y: number; ro: boolean; onChange: (x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null); const dragging = useRef(false);
  const at = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); onChange(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))), Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)))); };
  const src = m.large ?? m.url;
  return <div className="ml-focal-w">
    <div ref={box} className={`ml-focal${ro ? ' ro' : ''}`} style={{ aspectRatio: `${m.width} / ${m.height}` }}
      tabIndex={ro ? -1 : 0} role={ro ? undefined : 'slider'} aria-label="Focal point" aria-valuetext={`${x}% from the left, ${y}% from the top`}
      onPointerDown={(e) => { if (ro) return; dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (dragging.current) at(e); }} onPointerUp={() => { dragging.current = false; }}
      onKeyDown={(e) => { if (ro) return; const d = e.shiftKey ? 10 : 2; const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key]; if (v) { e.preventDefault(); onChange(Math.min(100, Math.max(0, x + v[0])), Math.min(100, Math.max(0, y + v[1]))); } }}>
      <img src={src} alt="" draggable={false} />
      <i style={{ left: `${x}%`, top: `${y}%` }} />
    </div>
    <div className="ml-crops" aria-hidden="true">{[['16 / 9', 'Wide'], ['4 / 3', 'Card'], ['1 / 1', 'Square'], ['4 / 5', 'Tall']].map(([r, l]) => <figure key={r}><div style={{ aspectRatio: r }}><img src={m.url} alt="" style={{ objectPosition: `${x}% ${y}%` }} /></div><figcaption>{l}</figcaption></figure>)}</div>
    <small className="muted">{ro ? 'Focal point used when the website crops this photo.' : 'Click or drag on the photo to choose what stays in view when the website crops it.'}</small>
  </div>;
}

// ================================================================= Picker (used by the editors)
export async function upload(file: File): Promise<MediaItem> {
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
    <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) go(e.target.files); e.target.value = ''; }} />
  </div>;
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
