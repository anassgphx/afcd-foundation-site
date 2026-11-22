// Visual page builder: block library + layers (left), live canvas with the real site styles (center), inspector (right).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

type Field = { key: string; label: string; type: string; max?: number; hint?: string; required?: boolean; options?: [string, string][]; itemLabel?: string; min?: number; fields?: Field[] };
type BlockDef = { type: string; version: number; label: string; group: string; description: string; fields: Field[]; defaults: Record<string, any> };
type Block = { id: string; type: string; v: number; hidden: boolean; props: Record<string, any> };
type Doc = { version: number; blocks: Block[] };
type Settings = { title: string; slug: string; description: string; navSection: string; noindex: boolean };
type PageData = Settings & { id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; doc: Doc; problems: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

const NAV_OPTIONS: [string, string][] = [['none', 'None'], ['about', 'About Us'], ['pillars', 'Our Pillars'], ['projects', 'Projects'], ['news', 'News & Stories'], ['partners', 'Partners'], ['involved', 'Get Involved'], ['contact', 'Contact']];
const DEVICES = [[1280, 'monitor', 'Desktop'], [820, 'tablet', 'Tablet'], [390, 'phone', 'Mobile']] as const;
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('');

export function Builder({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [page, setPage] = useState<PageData | null>(null);
  const [catalog, setCatalog] = useState<{ blocks: BlockDef[]; links: string[] } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [doc, setDoc] = useState<Doc>({ version: 1, blocks: [] });
  const [past, setPast] = useState<Doc[]>([]); const [future, setFuture] = useState<Doc[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [left, setLeft] = useState<'add' | 'layers'>('layers');
  const [device, setDevice] = useState(1280);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'publish' | 'unpublish' | 'changes' | 'approve' | 'preview'>(null);
  const [comment, setComment] = useState(''); const [previewUrl, setPreviewUrl] = useState('');
  const [html, setHtml] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = canvasBox.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el); return () => ro.disconnect();
  });
  const scale = Math.min(1, Math.max(0.2, (box.w - 8) / device));
  const canvasH = Math.max(400, box.h - 28);
  const defs = useMemo(() => new Map((catalog?.blocks ?? []).map((b) => [b.type, b])), [catalog]);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api<PageData>(`/pages/${id}`), catalog ? Promise.resolve(catalog) : api('/pages/catalog')]);
    setPage(p); setCatalog(c);
    setSettings({ title: p.title, slug: p.slug, description: p.description, navSection: p.navSection, noindex: p.noindex });
    setDoc(p.doc); setDirty(false); setPast([]); setFuture([]);
  }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);

  const status = page?.status ?? 'draft';
  const live = !!page?.publishedRevisionId;
  const locked = status === 'in_review' || status === 'archived';
  const editable = !locked && can('page.update');

  // ---- document edits with undo/redo
  const change = (next: Doc) => { setPast((p) => [...p.slice(-60), doc]); setFuture([]); setDoc(next); setDirty(true); };
  const undo = () => { if (!past.length) return; setFuture((f) => [doc, ...f]); setDoc(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setDirty(true); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, doc]); setDoc(future[0]); setFuture((f) => f.slice(1)); setDirty(true); };
  const setBlocks = (blocks: Block[]) => change({ ...doc, blocks });
  const updateProps = (bid: string, props: Record<string, any>) => setBlocks(doc.blocks.map((b) => (b.id === bid ? { ...b, props } : b)));
  const addBlock = (type: string) => {
    const d = defs.get(type)!; const nb: Block = { id: rid(), type, v: d.version, hidden: false, props: structuredClone(d.defaults) };
    const i = sel ? doc.blocks.findIndex((b) => b.id === sel) : -1;
    const blocks = [...doc.blocks]; blocks.splice(i >= 0 ? i + 1 : blocks.length, 0, nb);
    setBlocks(blocks); setSel(nb.id); setLeft('layers');
  };
  const move = (from: number, to: number) => { if (to < 0 || to >= doc.blocks.length || from === to) return; const b = [...doc.blocks]; const [x] = b.splice(from, 1); b.splice(to, 0, x); setBlocks(b); };
  const duplicate = (bid: string) => { const i = doc.blocks.findIndex((b) => b.id === bid); const copy = { ...structuredClone(doc.blocks[i]), id: rid() }; const b = [...doc.blocks]; b.splice(i + 1, 0, copy); setBlocks(b); setSel(copy.id); };
  const remove = (bid: string) => { setBlocks(doc.blocks.filter((b) => b.id !== bid)); if (sel === bid) setSel(null); };
  const toggleHidden = (bid: string) => setBlocks(doc.blocks.map((b) => (b.id === bid ? { ...b, hidden: !b.hidden } : b)));

  // ---- keyboard shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty && editable) save(); }
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
      if (mod && e.key.toLowerCase() === 'z' && !typing && editable) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { const f = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, [dirty]);

  // ---- live canvas (debounced server render of the unsaved document)
  useEffect(() => {
    if (!settings) return;
    const t = setTimeout(() => {
      post<{ html: string }>('/pages/canvas', { title: settings.title, description: settings.description, navSection: settings.navSection, doc }).then((r) => setHtml(r.html)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [doc, settings]);

  // Wire click-to-select and selection highlight inside the canvas document (same origin, no scripts in the canvas).
  const wire = useCallback(() => {
    const d = frame.current?.contentDocument; if (!d) return;
    d.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.blockId === sel);
      el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setSel(el.dataset.blockId!); };
    });
    d.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
  }, [sel]);
  useEffect(() => { wire(); const el = frame.current?.contentDocument?.querySelector(`[data-block-id="${sel}"]`); el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel, wire]);

  // ---- server actions
  async function save(): Promise<boolean> {
    if (!settings) return false;
    setBusy('save'); setErrors([]);
    try {
      const r = await put<{ problems: { message: string }[] }>(`/pages/${id}`, { ...settings, doc });
      await load(); toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved');
      if (r.problems?.length) setErrors(r.problems.map((p) => p.message));
      return true;
    } catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  function showErr(e: unknown) {
    if (e instanceof ApiError && e.details?.length) setErrors(e.details.map((d) => d.message)); else setErrors([e instanceof Error ? e.message : 'Something went wrong.']);
  }
  async function act(action: string, c = '') {
    if (dirty && !(await save())) return;
    setBusy(action);
    try { await post(`/pages/${id}/transition`, { action, comment: c }); await load(); setDialog(null); setComment(''); toast({ submit: 'Sent for review', approve: 'Approved. Ready to publish.', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/pages/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'Removed from the website'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/pages/${id}/preview`); setPreviewUrl(r.url); setDialog('preview'); } catch (e) { showErr(e); } finally { setBusy(''); }
  }

  if (!page || !settings || !catalog) return <Loading />;
  const selBlock = doc.blocks.find((b) => b.id === sel) ?? null;
  const selDef = selBlock ? defs.get(selBlock.type) : null;
  const groups = ['Structure', 'Text', 'Media', 'Content', 'Action'];

  return (
    <div className="builder">
      <div className="b-bar">
        <button className="btn btn-ghost icon-btn" onClick={() => navigate('/studio/pages')} aria-label="Back to pages"><Icon n="chev" style={{ transform: 'rotate(180deg)' }} /></button>
        <div className="b-title"><b>{settings.title || 'Untitled page'}</b><span className="mono muted">{settings.slug}.html</span></div>
        <span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} /></span>
        {dirty && <span className="muted" style={{ fontSize: 12 }}>Unsaved</span>}
        <span style={{ flex: 1 }} />
        <div className="seg" role="group" aria-label="Device">{DEVICES.map(([w, ic, l]) => <button key={w} className={device === w ? 'on' : ''} onClick={() => setDevice(w)} title={l} aria-label={l}><Icon n={ic} width={15} height={15} style={{ verticalAlign: -3 }} /></button>)}</div>
        <button className="btn btn-ghost icon-btn" onClick={undo} disabled={!past.length || !editable} title="Undo (⌘Z)" aria-label="Undo"><Icon n="undo" /></button>
        <button className="btn btn-ghost icon-btn" onClick={redo} disabled={!future.length || !editable} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon n="undo" style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
        {['draft', 'changes_requested'].includes(status) && can('page.update') && <button className="btn" onClick={() => act('submit')} disabled={!!busy}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('page.approve') && <><button className="btn" onClick={() => setDialog('changes')}>Request changes</button><button className="btn btn-ok" onClick={() => setDialog('approve')}><Icon n="check" />Approve</button></>}
        {status === 'approved' && can('page.publish') && <button className="btn btn-ok" onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
      </div>

      {errors.length > 0 && <div className="notice n-warn b-notice" role="alert"><div><b>Before this page can go to review</b><ul>{errors.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrors([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
      {locked && <div className="notice n-info b-notice">{status === 'in_review' ? 'In review: the layout is read-only. Withdraw it to edit.' : 'Archived. Restore it to edit.'}</div>}

      <div className="b-body">
        {/* ---------------- Left: library + layers */}
        <aside className="b-left">
          <div className="seg b-tabs"><button className={left === 'layers' ? 'on' : ''} onClick={() => setLeft('layers')}>Layers</button><button className={left === 'add' ? 'on' : ''} onClick={() => setLeft('add')} disabled={!editable}>Add block</button></div>
          {left === 'add' ? <div className="b-scroll">{groups.map((g) => <div key={g} className="b-group"><span>{g}</span>
            {catalog.blocks.filter((b) => b.group === g).map((b) => <button key={b.type} className="b-lib" onClick={() => addBlock(b.type)} title={b.description}><b>{b.label}</b><small>{b.description}</small></button>)}</div>)}
            <p className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>Blocks use AFCD’s approved designs. Custom HTML, CSS and scripts are not allowed.</p></div>
          : <ol className="b-scroll b-layers" aria-label="Page blocks">{doc.blocks.map((b, i) => (
            <li key={b.id} className={`b-layer${sel === b.id ? ' on' : ''}${b.hidden ? ' off' : ''}`} draggable={editable}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (editable) { e.preventDefault(); e.currentTarget.classList.add('drop'); } }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); move(Number(e.dataTransfer.getData('text/plain')), i); }}>
              <button className="b-layer-main" onClick={() => setSel(b.id)}><span className="b-grip" aria-hidden="true">⋮⋮</span><span className="min-w-0"><b>{defs.get(b.type)?.label ?? b.type}</b><small>{summary(b)}</small></span></button>
              {editable && <span className="b-layer-act">
                <button onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
                <button onClick={() => move(i, i + 1)} disabled={i === doc.blocks.length - 1} aria-label="Move down" title="Move down">↓</button>
                <button onClick={() => duplicate(b.id)} aria-label="Duplicate" title="Duplicate">⧉</button>
                <button onClick={() => toggleHidden(b.id)} aria-label={b.hidden ? 'Show' : 'Hide'} title={b.hidden ? 'Show on page' : 'Hide from page'}>{b.hidden ? '◌' : '◉'}</button>
                <button onClick={() => remove(b.id)} aria-label="Delete" title="Delete">×</button>
              </span>}
            </li>))}
            {doc.blocks.length === 0 && <li className="muted" style={{ padding: 12 }}>No blocks yet. Open “Add block”.</li>}
          </ol>}
        </aside>

        {/* ---------------- Center: canvas */}
        <div className="b-canvas" ref={canvasBox} onClick={() => setSel(null)}>
          {/* The page renders at the real device width and is scaled down to fit, so layouts match the live site. */}
          <div className="b-device" style={{ width: device * scale, height: canvasH }} onClick={(e) => e.stopPropagation()}>
            <iframe ref={frame} title="Page canvas" srcDoc={html} onLoad={wire} style={{ width: device, height: canvasH / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
          </div>
          <span className="b-zoom">{device}px · {Math.round(scale * 100)}%</span>
        </div>

        {/* ---------------- Right: inspector */}
        <aside className="b-right">
          {selBlock && selDef ? <>
            <div className="between b-insp-h"><div><small className="muted">Block</small><h2>{selDef.label}</h2></div><button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Page settings</button></div>
            <fieldset disabled={!editable} className="b-insp stack">
              {selDef.fields.length === 0 && <p className="muted">This block has no settings.</p>}
              {selDef.fields.map((f) => <FieldEditor key={f.key} f={f} value={selBlock.props[f.key]} links={catalog.links} onChange={(v) => updateProps(selBlock.id, { ...selBlock.props, [f.key]: v })} />)}
            </fieldset>
          </> : <>
            <div className="b-insp-h"><small className="muted">Page</small><h2>Page settings</h2></div>
            <fieldset disabled={!editable} className="b-insp stack">
              <Labeled label="Page title"><input className="input" maxLength={80} value={settings.title} onChange={(e) => { setSettings({ ...settings, title: e.target.value }); setDirty(true); }} aria-label="Page title" /></Labeled>
              <Labeled label="Address" hint={live ? 'A live page’s address cannot change here.' : undefined}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input className="input mono" aria-label="Address" disabled={live} value={settings.slug} onChange={(e) => { setSettings({ ...settings, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }); setDirty(true); }} /><span className="mono muted">.html</span></div></Labeled>
              <Labeled label="Search description" hint={`${settings.description.length} / 170 · shown in search results and when shared.`}><textarea className="textarea" style={{ minHeight: 70 }} maxLength={170} value={settings.description} onChange={(e) => { setSettings({ ...settings, description: e.target.value }); setDirty(true); }} aria-label="Search description" /></Labeled>
              <Labeled label="Highlighted menu item"><select className="select" value={settings.navSection} onChange={(e) => { setSettings({ ...settings, navSection: e.target.value }); setDirty(true); }} aria-label="Highlighted menu item">{NAV_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Labeled>
              <label className="check"><input type="checkbox" checked={settings.noindex} onChange={(e) => { setSettings({ ...settings, noindex: e.target.checked }); setDirty(true); }} /><span>Hide from search engines</span></label>
            </fieldset>
            <div className="b-insp stack" style={{ borderTop: '1px solid var(--line)' }}>
              <dl className="kv"><dt>Website</dt><dd>{live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'}</dd>{page.publishedAt && <><dt>Published</dt><dd>{fmtDate(page.publishedAt)}</dd></>}</dl>
              {live && <a className="btn btn-sm" href={me.siteUrl + settings.slug + '.html'} target="_blank" rel="noopener"><Icon n="ext" />Open live page</a>}
              {['in_review', 'approved'].includes(status) && can('page.update') && <button className="btn btn-sm btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
              {live && can('page.publish') && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
              {!live && status !== 'archived' && can('page.update') && <button className="btn btn-sm btn-ghost" onClick={() => { if (confirm('Archive this page?')) act('archive'); }}><Icon n="archive" />Archive</button>}
              {status === 'archived' && <button className="btn btn-sm" onClick={() => act('restore')}>Restore as draft</button>}
              {page.problems.length > 0 && status !== 'archived' && <div className="notice n-warn"><div><b>Before review</b><ul>{page.problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
              <small className="muted">History</small>
              <ol className="timeline">{page.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === page.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
                {can('page.update') && status !== 'in_review' && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/pages/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
                {page.history.comments.filter((c) => c.body).slice(0, 4).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}
              </ol>
            </div>
          </>}
        </aside>
      </div>

      {dialog === 'preview' && <Modal wide title="Preview · built with the real website templates" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Page preview" src={previewUrl} style={{ width: Math.min(device, window.innerWidth - 80) }} /></div></Modal>}
      {dialog === 'approve' && <Modal size="sm" title="Approve this page?" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve', comment)}>Approve</button></>}><div className="modal-b"><p style={{ marginTop: 0 }}>This version is frozen for publishing.</p><textarea className="textarea" aria-label="Note" placeholder="Note for the team (optional)" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
      {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim() || !!busy} onClick={() => act('request_changes', comment)}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" aria-label="What needs to change" autoFocus placeholder="What needs to change?" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
      {dialog === 'publish' && <Modal size="sm" title="Publish this page?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish now'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The site is rebuilt with the approved version of <span className="mono">{settings.slug}.html</span> and checked before this is confirmed. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
      {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The page is removed from the site and stays in Studio as a draft with its history.</p></div></Modal>}
    </div>
  );
}

function summary(b: Block) {
  const p = b.props;
  const s = p.title || p.text || p.body || p.q || (Array.isArray(p.items) ? `${p.items.length} items` : '') || '';
  return String(s).replace(/[*[\]()]/g, '').slice(0, 60) + (b.hidden ? ' · hidden' : '');
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
}

// ---------------------------------------------------------------- Field editors (driven by block metadata)
function FieldEditor({ f, value, onChange, links }: { f: Field; value: any; onChange: (v: any) => void; links: string[] }) {
  const [picker, setPicker] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaItem | null>(null);
  const [pillars, setPillars] = useState<{ key: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string; publishedRevisionId: string | null }[]>([]);
  useEffect(() => { if (f.type === 'pillar') api('/pillars').then(setPillars); if (f.type === 'projects') api('/projects').then(setProjects); }, [f.type]);
  useEffect(() => { if (f.type === 'media' && value) api<{ items: MediaItem[] }>('/media').then((r) => setMediaInfo(r.items.find((m) => m.id === value) ?? null)); else setMediaInfo(null); }, [f.type, value]);
  const req = f.required && (value === '' || value == null);
  const hint = f.hint || (f.max ? `${String(value ?? '').length} / ${f.max}` : '');
  const common = { 'aria-label': f.label, 'aria-invalid': req || undefined } as const;
  switch (f.type) {
    case 'text': return <Labeled label={f.label + (f.required ? '' : ' (optional)')} hint={hint}><input className="input" maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} /></Labeled>;
    case 'textarea': return <Labeled label={f.label + (f.required ? '' : ' (optional)')} hint={hint}><textarea className="textarea" maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} /></Labeled>;
    case 'richtext': return <RichText f={f} value={value ?? ''} onChange={onChange} />;
    case 'url': return <Labeled label={f.label + ' (optional)'} hint="A page of this site, https://…, mailto: or #section"><input className="input mono" list="site-links" maxLength={500} value={value ?? ''} onChange={(e) => onChange(e.target.value.trim())} {...common} /><datalist id="site-links">{links.map((l) => <option key={l} value={l} />)}</datalist></Labeled>;
    case 'select': return <Labeled label={f.label}><select className="select" value={value ?? f.options?.[0]?.[0]} onChange={(e) => onChange(e.target.value)} {...common}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Labeled>;
    case 'toggle': return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span>{f.label}</span></label>;
    case 'pillar': return <Labeled label={f.label} hint={f.hint}><select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common}><option value="">Choose a pillar</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Labeled>;
    case 'projects': return <Labeled label={f.label} hint={f.hint}><div className="b-checks">{projects.filter((p) => p.publishedRevisionId).map((p) => <label key={p.slug} className="check"><input type="checkbox" checked={(value ?? []).includes(p.slug)} onChange={(e) => onChange(e.target.checked ? [...(value ?? []), p.slug] : (value ?? []).filter((s: string) => s !== p.slug))} /><span>{p.name}</span></label>)}</div></Labeled>;
    case 'media': return <Labeled label={f.label} hint={mediaInfo && (!mediaInfo.alt || !mediaInfo.rightsConfirmed) ? 'This image still needs alt text or rights confirmation (Media Library).' : f.hint}>
      {value && mediaInfo ? <div className="thumb" style={{ width: '100%' }}><img src={mediaInfo.url} alt={mediaInfo.alt} /><button type="button" aria-label="Remove image" onClick={() => onChange(null)}>×</button></div> : <div className="muted">No image: a grey placeholder is shown.</div>}
      <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setPicker(true)}><Icon n="image" />{value ? 'Change image' : 'Choose image'}</button>
      {picker && <MediaPicker onClose={() => setPicker(false)} onPick={(m) => { onChange(m[0]?.id ?? null); setMediaInfo(m[0] ?? null); setPicker(false); }} />}
    </Labeled>;
    case 'list': {
      const items: any[] = Array.isArray(value) ? value : [];
      const set = (i: number, k: string, v: any) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
      const blank = Object.fromEntries((f.fields ?? []).map((x) => [x.key, '']));
      return <div className="field" role="group" aria-label={f.label}><span>{f.label}</span>
        {items.map((it, i) => <div key={i} className="b-item"><div className="between"><small className="muted">{f.itemLabel} {i + 1}</small><span className="b-layer-act" style={{ opacity: 1 }}>
          <button type="button" onClick={() => { if (i > 0) { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); } }} aria-label="Move up">↑</button>
          <button type="button" disabled={items.length <= (f.min ?? 0)} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${f.itemLabel}`}>×</button></span></div>
          {(f.fields ?? []).map((sf) => <FieldEditor key={sf.key} f={sf} value={it[sf.key]} links={links} onChange={(v) => set(i, sf.key, v)} />)}</div>)}
        {items.length < (f.max ?? 10) && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, blank])}><Icon n="plus" />Add {f.itemLabel?.toLowerCase()}</button>}
        {f.hint && <small>{f.hint}</small>}</div>;
    }
    default: return null;
  }
}

function RichText({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (a: string, b: string, placeholder: string) => {
    const el = ref.current!; const s = el.selectionStart, e = el.selectionEnd; const sel = value.slice(s, e) || placeholder;
    onChange(value.slice(0, s) + a + sel + b + value.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + a.length, s + a.length + sel.length); });
  };
  return <div className="field"><span>{f.label}{f.required ? '' : ' (optional)'}</span>
    <div className="b-rt"><button type="button" onClick={() => wrap('**', '**', 'bold text')} aria-label="Bold"><b>B</b></button><button type="button" onClick={() => wrap('*', '*', 'italic text')} aria-label="Italic"><i>I</i></button>
      <button type="button" onClick={() => wrap('[', '](about.html)', 'link text')} aria-label="Link">Link</button><button type="button" onClick={() => wrap('\n- ', '', 'list item')} aria-label="List">• List</button></div>
    <textarea ref={ref} className="textarea" style={{ minHeight: 140 }} maxLength={f.max} value={value} onChange={(e) => onChange(e.target.value)} aria-label={f.label} />
    <small>{f.hint ?? ''} {value.length} / {f.max}</small></div>;
}
