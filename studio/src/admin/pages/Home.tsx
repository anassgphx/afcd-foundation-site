// Homepage editor (Studio V2): section navigator (left), live canvas of the real page (center), inspector (right).
// Sections are the homepage's own sections (move, hide, edit their marked fields) and blocks from the section library
// (add, duplicate, move, hide, remove, edit). The canvas is composed by the same code as the published build.
// Undo/redo cover every change; autosave keeps drafts; review and publishing are unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { DesignFields, FieldEditor, type BlockDef, type Design } from './Builder.tsx';
import { Loading } from './Dashboard.tsx';

type FieldDef = { key: string; type: 'text' | 'split' | 'rich' | 'link' | 'tail' | 'image'; section: string; sectionId: string | null; label: string; default: any };
type Entry = { kind: 'section'; id: string; hidden: boolean } | { kind: 'block'; id: string; type: string; v: number; hidden: boolean; props: Record<string, any>; design?: Design };
type Data = { fields: FieldDef[]; siteSections: { id: string; label: string }[]; layout: Entry[]; catalog: BlockDef[]; media: MediaItem[]; problems: string[];
  content: null | { id: string; status: string; values: Record<string, any>; layout: Entry[] | null; publishedRevisionId: string | null; publishedAt: string | null; updatedAt: string };
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
type State = { values: Record<string, any>; layout: Entry[] };
const DEVICES = [[1280, 'monitor', 'Desktop'], [820, 'tablet', 'Tablet'], [390, 'phone', 'Mobile']] as const;
const GROUPS = ['Live', 'Text', 'Media', 'Content', 'Action', 'Structure'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
const SECTION_ICON: Record<string, string> = { hero: 'image', 'who-we-are': 'users', purpose: 'heart', pillars: 'layers', projects: 'folder', impact: 'dash', news: 'log', events: 'calendar', partners: 'partner', 'get-involved': 'send' };

export function HomeEditor() {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [st, setSt] = useState<State>({ values: {}, layout: [] });
  const [past, setPast] = useState<State[]>([]); const [future, setFuture] = useState<State[]>([]);
  const [sel, setSel] = useState<string | null>('hero');
  const [tab, setTab] = useState<'content' | 'design'>('content');
  const [device, setDevice] = useState(1280);
  const [save, setSave] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');
  const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [media, setMedia] = useState<Record<string, MediaItem>>({});
  const [links, setLinks] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'image'; key: string } | { kind: 'library' | 'preview' | 'publish' | 'unpublish' | 'changes' | 'history' }>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');
  const [html, setHtml] = useState('');
  const base = useRef<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(el); return () => ro.disconnect(); });

  const load = useCallback(async () => {
    const [x, cat] = await Promise.all([api<Data>('/home'), api<{ links: string[] }>('/pages/catalog').catch(() => ({ links: [] }))]);
    setD(x); setLinks(cat.links); setSt({ values: x.content?.values ?? {}, layout: x.layout }); setPast([]); setFuture([]);
    setMedia(Object.fromEntries(x.media.map((m) => [m.id, m]))); base.current = x.content?.updatedAt ?? null; setSave('saved');
  }, []);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);

  const status = d?.content?.status ?? 'draft'; const live = !!d?.content?.publishedRevisionId;
  const editable = !!d && can('page.update') && status !== 'in_review';
  const defs = useMemo(() => new Map((d?.catalog ?? []).map((b) => [b.type, b])), [d]);
  const label = (e: Entry) => (e.kind === 'section' ? d?.siteSections.find((s) => s.id === e.id)?.label ?? e.id : defs.get(e.type)?.label ?? e.type);

  // ---- every change goes through here: undo history + unsaved state
  const change = (next: State) => { setPast((p) => [...p.slice(-80), st]); setFuture([]); setSt(next); setSave('unsaved'); };
  const undo = () => { if (!past.length) return; setFuture((f) => [st, ...f]); setSt(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setSave('unsaved'); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, st]); setSt(future[0]); setFuture((f) => f.slice(1)); setSave('unsaved'); };
  const setLayout = (layout: Entry[]) => change({ ...st, layout });
  const move = (from: number, to: number) => { if (to < 0 || to >= st.layout.length || from === to) return; const l = [...st.layout]; const [x] = l.splice(from, 1); l.splice(to, 0, x); setLayout(l); };
  const toggle = (id: string) => setLayout(st.layout.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)));
  const duplicate = (id: string) => { const i = st.layout.findIndex((e) => e.id === id); const e = st.layout[i]; if (e.kind !== 'block') return; const copy = { ...structuredClone(e), id: rid() }; const l = [...st.layout]; l.splice(i + 1, 0, copy); setLayout(l); setSel(copy.id); };
  const remove = (id: string) => { setLayout(st.layout.filter((e) => e.id !== id)); if (sel === id) setSel(null); toast('Section removed. Undo brings it back; older versions stay in History.'); };
  const addBlock = (type: string) => {
    const def = defs.get(type)!; const nb: Entry = { kind: 'block', id: rid(), type, v: def.version, hidden: false, props: structuredClone(def.defaults) };
    const i = sel ? st.layout.findIndex((e) => e.id === sel) : -1; const l = [...st.layout]; l.splice(i >= 0 ? i + 1 : l.length, 0, nb);
    setLayout(l); setSel(nb.id); setDialog(null);
  };
  const setField = (f: FieldDef, v: any) => { const n = { ...st.values }; if (v === null || same(v, f.default)) delete n[f.key]; else n[f.key] = v; change({ ...st, values: n }); };
  const setProps = (id: string, props: Record<string, any>) => setLayout(st.layout.map((e) => (e.id === id && e.kind === 'block' ? { ...e, props } : e)));

  // ---- live canvas: the real page with the unsaved working copy (debounced)
  useEffect(() => {
    if (!d) return;
    const t = setTimeout(() => { post<{ html: string }>('/home/canvas', { values: st.values, layout: st.layout }).then((r) => setHtml(r.html)).catch((e) => setErrs([e.message])); }, 250);
    return () => clearTimeout(t);
  }, [st, d]);
  const wire = useCallback(() => {
    const doc = frame.current?.contentDocument; if (!doc) return;
    doc.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.blockId === sel);
      el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setSel(el.dataset.blockId!); };
    });
  }, [sel]);
  useEffect(() => { wire(); frame.current?.contentDocument?.querySelector(`[data-block-id="${sel}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [sel, wire]);

  // ---- saving: explicit, and automatic 3 s after the last change (never over newer work, never while approved)
  const showErr = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? (e.details as { path: string; message: string }[]).map((x) => x.message) : [e instanceof Error ? e.message : 'Something went wrong.']);
  const doSave = useCallback(async (quiet = false): Promise<boolean> => {
    setSave('saving'); setErrs([]);
    try {
      const r = await put<{ updatedAt: string; problems: string[] }>('/home', { values: st.values, layout: st.layout, baseUpdatedAt: base.current });
      base.current = r.updatedAt; setSave('saved');
      const fresh = await api<Data>('/home'); setD(fresh); base.current = fresh.content?.updatedAt ?? null;
      if (!quiet) toast(live ? 'Draft saved. The live homepage is unchanged until you publish.' : 'Draft saved');
      return true;
    } catch (e) { setSave('failed'); showErr(e); return false; }
  }, [st, live]);
  useEffect(() => {
    if (save !== 'unsaved' || !editable || status === 'approved') return;
    const t = setTimeout(() => { doSave(true); }, 3000);
    return () => clearTimeout(t);
  }, [st, save, editable, status, doSave]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (save !== 'saved' && editable) doSave(); }
      if (mod && e.key.toLowerCase() === 'z' && !typing && editable) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (save === 'unsaved' || save === 'saving') e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [save]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (save !== 'saved' && !(await doSave(true))) return;
    setBusy(action); setErrs([]);
    try { await post('/home/transition', { action, ...extra }); await load(); setDialog(null); setComment(''); toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind); try { await post(`/home/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the homepage' : 'The homepage shows its original version again'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() { if (save !== 'saved' && !(await doSave(true))) return; setBusy('preview'); try { const r = await post<{ url: string }>('/home/preview'); setUrl(r.url); setDialog({ kind: 'preview' }); } catch (e) { showErr(e); } finally { setBusy(''); } }

  if (!d) return <Loading />;
  const scale = Math.min(1, Math.max(0.2, (size.w - 8) / device)); const canvasH = Math.max(400, size.h - 28);
  const selEntry = st.layout.find((e) => e.id === sel) ?? null;
  const nChanges = Object.keys(st.values).length + (same(st.layout, d.siteSections.map((s) => ({ kind: 'section', id: s.id, hidden: false }))) ? 0 : 1);
  const saveLabel = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Save failed' }[save];

  return <div className="builder">
    <div className="b-bar">
      <div className="b-title"><b>Homepage</b><span className="mono muted">index.html</span></div>
      <span className="pills">{live && status !== 'published' && <LiveBadge />}{d.content ? <Badge s={status} /> : <span className="pill">Original</span>}</span>
      <span className={`muted hp-save is-${save}`} role="status" style={{ fontSize: 12 }}>{saveLabel}</span>
      <span style={{ flex: 1 }} />
      <div className="seg" role="group" aria-label="Device">{DEVICES.map(([w, ic, l]) => <button key={w} className={device === w ? 'on' : ''} onClick={() => setDevice(w)} title={l} aria-label={l}><Icon n={ic} width={15} height={15} style={{ verticalAlign: -3 }} /></button>)}</div>
      <button className="btn btn-ghost icon-btn" onClick={undo} disabled={!past.length || !editable} title="Undo (⌘Z)" aria-label="Undo"><Icon n="undo" /></button>
      <button className="btn btn-ghost icon-btn" onClick={redo} disabled={!future.length || !editable} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon n="undo" style={{ transform: 'scaleX(-1)' }} /></button>
      <button className="btn btn-ghost" onClick={() => setDialog({ kind: 'history' })}><Icon n="clock" />History</button>
      <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
      {editable && <button className="btn" onClick={() => doSave()} disabled={save === 'saved' || save === 'saving'}><Icon n="save" />Save</button>}
      {d.content && ['draft', 'changes_requested'].includes(status) && can('page.update') && <button className="btn btn-primary" onClick={() => act('submit')} disabled={!!busy}><Icon n="send" />Submit for review</button>}
      {status === 'in_review' && can('page.approve') && <><button className="btn" onClick={() => setDialog({ kind: 'changes' })}>Request changes</button><button className="btn btn-ok" onClick={() => act('approve')} disabled={!!busy}><Icon n="check" />Approve</button></>}
      {status === 'approved' && can('page.publish') && <button className="btn btn-ok" onClick={() => setDialog({ kind: 'publish' })}><Icon n="rocket" />Publish</button>}
      {d.content && ['in_review', 'approved'].includes(status) && can('page.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw</button>}
    </div>
    {errs.length > 0 && <div className="notice n-warn b-notice" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {d.content && d.problems.length > 0 && ['draft', 'changes_requested'].includes(status) && save === 'saved' && <div className="notice n-info b-notice"><div><b>Before review:</b> {d.problems.join(' · ')}</div></div>}
    {status === 'in_review' && <div className="notice n-info b-notice">In review: read-only. Withdraw it to edit.</div>}

    <div className="b-body">
      <aside className="b-left">
        <div className="between" style={{ padding: '10px 12px 6px' }}><b style={{ fontSize: 13 }}>Sections</b>
          {editable && <button className="btn btn-sm btn-primary" onClick={() => setDialog({ kind: 'library' })}><Icon n="plus" />Add section</button>}</div>
        <ol className="b-scroll b-layers" aria-label="Homepage sections">{st.layout.map((e, i) => (
          <li key={e.id} className={`b-layer${sel === e.id ? ' on' : ''}${e.hidden ? ' off' : ''}`} draggable={editable}
            onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', String(i)); ev.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(ev) => { if (editable) { ev.preventDefault(); ev.currentTarget.classList.add('drop'); } }} onDragLeave={(ev) => ev.currentTarget.classList.remove('drop')}
            onDrop={(ev) => { ev.preventDefault(); ev.currentTarget.classList.remove('drop'); move(Number(ev.dataTransfer.getData('text/plain')), i); }}>
            <button className="b-layer-main" onClick={() => setSel(e.id)} aria-current={sel === e.id}>
              <span className="b-grip" aria-hidden="true">⋮⋮</span>
              <span className="hp-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <Icon n={e.kind === 'section' ? SECTION_ICON[e.id] ?? 'layers' : 'plus'} width={15} height={15} />
              <span className="min-w-0"><b>{label(e)}</b><small>{e.kind === 'section' ? 'Homepage section' : 'Added section'}{e.hidden ? ' · hidden' : ''}{e.kind === 'section' && d.fields.some((f) => f.sectionId === e.id && f.key in st.values) ? ' · edited' : ''}</small></span>
            </button>
            {editable && <span className="b-layer-act">
              <button onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${label(e)} up`} title="Move up">↑</button>
              <button onClick={() => move(i, i + 1)} disabled={i === st.layout.length - 1} aria-label={`Move ${label(e)} down`} title="Move down">↓</button>
              {e.kind === 'block' && <button onClick={() => duplicate(e.id)} aria-label={`Duplicate ${label(e)}`} title="Duplicate">⧉</button>}
              <button onClick={() => toggle(e.id)} aria-label={e.hidden ? `Show ${label(e)}` : `Hide ${label(e)}`} title={e.hidden ? 'Show on the homepage' : 'Hide from the homepage'}>{e.hidden ? '◌' : '◉'}</button>
              {e.kind === 'block' && <button onClick={() => remove(e.id)} aria-label={`Remove ${label(e)}`} title="Remove">×</button>}
            </span>}
          </li>))}
        </ol>
      </aside>

      <div className="b-canvas" ref={box} onClick={() => setSel(null)}>
        <div className="b-device" style={{ width: device * scale, height: canvasH }} onClick={(ev) => ev.stopPropagation()}>
          <iframe ref={frame} title="Homepage canvas" srcDoc={html} onLoad={wire} style={{ width: device, height: canvasH / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
        </div>
        <span className="b-zoom">{device}px · {Math.round(scale * 100)}% · click a section to edit it</span>
      </div>

      <aside className="b-right">
        {!selEntry ? <div className="b-scroll" style={{ padding: 16 }}><p className="muted">Select a section in the list or on the page.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>{nChanges ? `${nChanges} change${nChanges === 1 ? '' : 's'} from the original homepage.` : 'No changes from the original homepage.'}</p>
          {live && can('page.publish') && <button className="btn btn-ghost btn-danger btn-sm" onClick={() => setDialog({ kind: 'unpublish' })}>Show the original homepage</button>}</div>
        : <fieldset className="b-scroll b-insp stack" disabled={!editable}>
          <div><small className="muted">{selEntry.kind === 'section' ? 'Homepage section' : defs.get(selEntry.type)?.group}</small><h3 style={{ margin: '2px 0 0', fontSize: 16 }}>{label(selEntry)}</h3>
            {selEntry.kind === 'block' && <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>{defs.get(selEntry.type)?.description}</p>}</div>
          <label className="check"><input type="checkbox" checked={!selEntry.hidden} onChange={() => toggle(selEntry.id)} /><span>Show on the homepage</span></label>
          {selEntry.kind === 'section'
            ? <SectionFields fields={d.fields.filter((f) => f.sectionId === selEntry.id)} values={st.values} media={media} editable={editable} onChange={setField} onPickImage={(key) => setDialog({ kind: 'image', key })} />
            : <>
              <div className="seg ds-tabs" role="tablist">{(['content', 'design'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'content' ? 'Content' : 'Design'}</button>)}</div>
              {tab === 'design' ? <DesignFields value={selEntry.design} onChange={(d) => setLayout(st.layout.map((x) => (x.id === selEntry.id && x.kind === 'block' ? { ...x, design: d } : x)))} />
                : (defs.get(selEntry.type)?.fields ?? []).map((f) => <FieldEditor key={f.key} f={f} value={selEntry.props[f.key]} links={links} onChange={(v) => setProps(selEntry.id, { ...selEntry.props, [f.key]: v })} />)}</>}
        </fieldset>}
      </aside>
    </div>

    {dialog?.kind === 'library' && <SectionLibrary catalog={d.catalog} onPick={addBlock} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'image' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { const f = d.fields.find((x) => x.key === dialog.key)!; if (m[0]) { setMedia((x) => ({ ...x, [m[0].id]: m[0] })); setField(f, { mediaId: m[0].id }); } setDialog(null); }} />}
    {dialog?.kind === 'preview' && <Modal wide title="Preview · built by the real website build" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Homepage preview" src={url} style={{ width: Math.min(device, window.innerWidth - 80) }} /></div></Modal>}
    {dialog?.kind === 'history' && <Modal title="Homepage history" onClose={() => setDialog(null)}><div className="modal-b">
      {!d.content ? <p className="muted">No versions yet.</p> : <ol className="timeline">{d.history.revisions.map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === d.content!.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
        {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into a new draft? The live homepage does not change.`)) { try { await post(`/home/revisions/${r.id}/restore`); await load(); setDialog(null); toast('Revision restored as a draft'); } catch (e) { showErr(e); } } }}>Restore as a new draft</button>}</li>)}
        {d.history.comments.filter((x) => x.body).map((x) => <li key={x.id}><b>{x.kind.replace('_', ' ')}</b><q>{x.body}</q><small>{fmtDate(x.createdAt)}</small></li>)}</ol>}</div></Modal>}
    {dialog?.kind === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog?.kind === 'publish' && <Modal size="sm" title="Publish the homepage?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">index.html</span> with the approved version and checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog?.kind === 'unpublish' && <Modal size="sm" title="Show the original homepage?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Rebuilding…' : 'Show original'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The homepage is rebuilt exactly as written in the website. Your changes stay here as a draft.</p></div></Modal>}
  </div>;
}

function SectionFields({ fields, values, media, editable, onChange, onPickImage }: { fields: FieldDef[]; values: Record<string, any>; media: Record<string, MediaItem>; editable: boolean; onChange: (f: FieldDef, v: any) => void; onPickImage: (key: string) => void }) {
  if (!fields.length) return <p className="muted" style={{ fontSize: 13 }}>This section’s content comes from Studio records or the website’s design, so there is nothing to type here. You can move or hide it.</p>;
  // the hero has several slides: show each slide's fields together, under its own heading
  const groups = [...new Set(fields.map((f) => f.section))];
  if (groups.length > 1) return <>{groups.map((g) => <details key={g} className="hp-group" open={g === groups[0]}><summary>{g.replace(/^hero\.(\d+)$/, 'Slide $1')}</summary>
    <div className="stack"><SectionFields fields={fields.filter((f) => f.section === g)} values={values} media={media} editable={editable} onChange={onChange} onPickImage={onPickImage} /></div></details>)}</>;
  return <>{fields.map((f) => {
    const v = f.key in values ? values[f.key] : f.default; const changed = f.key in values;
    let control: React.ReactNode;
    if (f.type === 'split') control = <><input className="input" maxLength={90} value={v.main} onChange={(e) => onChange(f, { ...v, main: e.target.value })} aria-label={`${f.label}, main part`} /><input className="input" maxLength={90} value={v.soft} onChange={(e) => onChange(f, { ...v, soft: e.target.value })} aria-label={`${f.label}, lighter part`} placeholder="Lighter second part (optional)" /></>;
    else if (f.type === 'link') control = <><input className="input" maxLength={40} value={v.label} onChange={(e) => onChange(f, { ...v, label: e.target.value })} aria-label={`${f.label} text`} /><input className="input mono" maxLength={300} value={v.href} onChange={(e) => onChange(f, { ...v, href: e.target.value.trim() })} aria-label={`${f.label} link`} /></>;
    else if (f.type === 'image') { const m = v.mediaId ? media[v.mediaId] : null; control = <><div className="thumb" style={{ width: '100%' }}><img src={m ? m.url : '/studio/site/' + v.src} alt={m ? m.alt : v.alt} /></div>
      <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} disabled={!editable} onClick={() => onPickImage(f.key)}><Icon n="image" />Choose photo</button></>; }
    else if (f.type === 'rich' || String(v).length > 60) control = <textarea className="textarea" maxLength={f.type === 'rich' ? 700 : 300} value={v} onChange={(e) => onChange(f, e.target.value.replace(/\n/g, ' '))} aria-label={f.label} />;
    else control = <input className="input" maxLength={f.key.endsWith('.value') ? 24 : 240} value={v} onChange={(e) => onChange(f, e.target.value)} aria-label={f.label} />;
    return <div key={f.key} className={`field${changed ? ' hp-changed' : ''}`}><span>{f.label}{changed && <em className="hp-dot">edited</em>}</span>{control}
      {f.type === 'rich' && <small>**Double stars** highlight words, as on the page.</small>}
      {changed && editable && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto', justifySelf: 'start' }} onClick={() => onChange(f, null)}>Reset to the original</button>}</div>;
  })}</>;
}

function SectionLibrary({ catalog, onPick, onClose }: { catalog: BlockDef[]; onPick: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(''); const [g, setG] = useState('All');
  const shown = catalog.filter((b) => (g === 'All' || b.group === g) && (!q || `${b.label} ${b.description}`.toLowerCase().includes(q.toLowerCase())));
  return <Modal wide title="Add a section" onClose={onClose}><div className="modal-b stack">
    <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
      <div className="seg" role="group" aria-label="Category">{['All', ...GROUPS].map((x) => <button key={x} className={g === x ? 'on' : ''} onClick={() => setG(x)}>{x}</button>)}</div>
      <label className="search"><Icon n="search" /><span className="sr-only">Search sections</span><input className="input" autoFocus placeholder="Search sections" value={q} onChange={(e) => setQ(e.target.value)} /></label>
    </div>
    <ul className="hp-lib">{shown.map((b) => <li key={b.type}><button className="hp-lib-card" onClick={() => onPick(b.type)}>
      <span className="hp-lib-thumb" aria-hidden="true"><i /><i /><i /></span><b>{b.label}</b><small className="muted">{b.description}</small><span className="hp-lib-tag">{b.group}</span></button></li>)}
      {shown.length === 0 && <li className="muted">No section matches.</li>}</ul>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>Sections use AFCD’s approved designs and the site’s own styles. Custom HTML, CSS and scripts are not possible. The new section is added after the selected one.</p>
  </div></Modal>;
}
