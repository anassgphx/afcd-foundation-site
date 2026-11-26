// Homepage editor (Studio V2): section navigator (left), live canvas of the real page (center), inspector (right).
// Sections are the homepage's own sections (move, hide, edit their marked fields) and blocks from the section library
// (add, duplicate, move, hide, remove, edit). The canvas is composed by the same code as the published build.
// Undo/redo cover every change; autosave keeps drafts; review and publishing are unchanged.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { DesignFields, FieldEditor, type BlockDef, type Design } from './Builder.tsx';
/** Longest plain text a homepage field takes; matches TEXT_MAX in modules/home/service.ts. */
const TEXT_MAX = 800;
import { Loading } from './Dashboard.tsx';

type FieldDef = { key: string; type: 'text' | 'split' | 'rich' | 'link' | 'tail' | 'image' | 'stories'; section: string; sectionId: string | null; label: string; default: any };
type Entry = { kind: 'section'; id: string; hidden: boolean } | { kind: 'block'; id: string; type: string; v: number; hidden: boolean; props: Record<string, any>; design?: Design };
type PageInfo = { file: string; label: string; noun: string; layout: boolean };
const HOME_PAGE: PageInfo = { file: 'index.html', label: 'Homepage', noun: 'homepage', layout: true };
type Data = { page?: PageInfo; fields: FieldDef[]; siteSections: { id: string; label: string }[]; layout: Entry[]; catalog: BlockDef[]; media: MediaItem[]; problems: string[]; issues?: Issue[];
  content: null | { id: string; status: string; values: Record<string, any>; layout: Entry[] | null; publishedRevisionId: string | null; publishedAt: string | null; updatedAt: string };
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
type State = { values: Record<string, any>; layout: Entry[] };
const DEVICES = [[1280, 'monitor', 'Desktop'], [820, 'tablet', 'Tablet'], [390, 'phone', 'Mobile']] as const;
const GROUPS = ['Live', 'Text', 'Media', 'Content', 'Action', 'Structure'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
const SECTION_ICON: Record<string, string> = { hero: 'image', 'who-we-are': 'users', purpose: 'heart', pillars: 'layers', projects: 'folder', impact: 'dash', news: 'log', events: 'calendar', partners: 'partner', 'get-involved': 'send' };

/** `path` is the page's API ('/home', '/page-text/contact.html'); pages without a layout only edit their marked text. */
export function HomeEditor({ path = '/home' }: { path?: string }) {
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
  const [dialog, setDialog] = useState<null | { kind: 'image'; key: string; story?: number } | { kind: 'library'; at?: number } | { kind: 'preview' | 'publish' | 'unpublish' | 'changes' | 'history' }>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);   // ⋯ actions menu of a section
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');
  const [html, setHtml] = useState('');
  const base = useRef<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [focusKey, setFocusKey] = useState<{ key: string; n: number } | null>(null);   // field clicked in the canvas
  const [issuesOpen, setIssuesOpen] = useState(false);
  const scrollY = useRef(0);
  const fromCanvas = useRef(false);
  const actionsRef = useRef<(id: string) => Act[]>(() => []); const runActRef = useRef<(id: string, a: string) => void>(() => {});
  const labelRef = useRef<(id: string) => string>((id) => id); const scaleRef = useRef(1);   // canvas scroll, kept across reloads so typing never jumps the page back to the top
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(el); return () => ro.disconnect(); });

  const load = useCallback(async () => {
    const [x, cat] = await Promise.all([api<Data>(path), api<{ links: string[] }>('/pages/catalog').catch(() => ({ links: [] }))]);
    setD(x); setLinks(cat.links); setSt({ values: x.content?.values ?? {}, layout: x.layout }); setPast([]); setFuture([]);
    setMedia(Object.fromEntries(x.media.map((m) => [m.id, m]))); base.current = x.content?.updatedAt ?? null; setSave('saved');
  }, [path]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);

  const P = d?.page ?? HOME_PAGE; const layoutOn = P.layout;
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
  const remove = (id: string) => { setLayout(st.layout.filter((e) => e.id !== id)); if (sel === id) setSel(null); toast('Section deleted from the draft. ⌘Z brings it back.'); };
  const addBlock = (type: string, at?: number) => {
    const def = defs.get(type)!; const nb: Entry = { kind: 'block', id: rid(), type, v: def.version, hidden: false, props: structuredClone(def.defaults) };
    const i = sel ? st.layout.findIndex((e) => e.id === sel) : -1; const l = [...st.layout]; l.splice(at ?? (i >= 0 ? i + 1 : l.length), 0, nb);
    setLayout(l); setSel(nb.id); setDialog(null);
  };
  /** Every action a section offers, in one place: the ⋯ menu, the canvas toolbar and the keyboard use the same list.
   *  Site sections come from the page code: they can be hidden and restored, not deleted or copied. Nothing here
   *  publishes; every action edits the draft. */
  const actionsFor = (id: string): Act[] => {
    const i = st.layout.findIndex((e) => e.id === id); const e = st.layout[i]; if (!e) return [];
    const site = e.kind === 'section'; const off = !editable ? `Read-only: this version is in review or you cannot edit the ${P.noun}.` : undefined;
    const editAct: Act = { id: 'edit', label: 'Edit', icon: 'edit', kbd: '↵', run: () => { setSel(id); setTimeout(() => document.querySelector<HTMLElement>('.b-right input, .b-right textarea, .b-right select')?.focus(), 80); } };
    if (!layoutOn) return [editAct];   // this page's sections stay as written: only their text is edited
    return [
      editAct,
      { id: 'above', label: 'Add section above', icon: 'plus', off, run: () => setDialog({ kind: 'library', at: i }) },
      { id: 'below', label: 'Add section below', icon: 'plus', off, run: () => setDialog({ kind: 'library', at: i + 1 }) },
      { id: 'dup', label: 'Duplicate', icon: 'copy', kbd: '⌘D', off: off ?? (site ? 'Site sections are built from the page code and cannot be copied. Add a section from the library instead.' : undefined), run: () => duplicate(id) },
      { id: 'up', label: 'Move up', icon: 'up', kbd: '⌥↑', off: off ?? (i === 0 ? 'Already first.' : undefined), run: () => move(i, i - 1) },
      { id: 'down', label: 'Move down', icon: 'down', kbd: '⌥↓', off: off ?? (i === st.layout.length - 1 ? 'Already last.' : undefined), run: () => move(i, i + 1) },
      { id: 'hide', label: e.hidden ? (site ? 'Restore on the homepage' : 'Show on the homepage') : 'Hide from the homepage', icon: e.hidden ? 'eye' : 'eyeoff', kbd: 'H', off, run: () => { toggle(id); toast(e.hidden ? `${label(e)} is back on the homepage draft` : `${label(e)} hidden in the draft. ⌘Z undoes it.`); } },
      site
        ? { id: 'del', label: e.hidden ? 'Already hidden' : 'Delete (hides it)', icon: 'trash', kbd: '⌫', danger: true, off: off ?? (e.hidden ? 'Site sections cannot be deleted; this one is already hidden. Use Restore to bring it back.' : undefined), run: () => { toggle(id); toast(`Site sections cannot be deleted, so ${label(e)} is hidden instead. Restore brings it back.`); } }
        : { id: 'del', label: 'Delete', icon: 'trash', kbd: '⌫', danger: true, off, run: () => remove(id) },
    ];
  };
  const runAct = (id: string, act: string) => { const a = actionsFor(id).find((x) => x.id === act); if (a && !a.off) a.run(); else if (a?.off) toast(a.off, true); };
  const setField = (f: FieldDef, v: any) => { const n = { ...st.values }; if (v === null || same(v, f.default)) delete n[f.key]; else n[f.key] = v; change({ ...st, values: n }); };
  const setProps = (id: string, props: Record<string, any>) => setLayout(st.layout.map((e) => (e.id === id && e.kind === 'block' ? { ...e, props } : e)));

  // ---- live canvas: the real page with the unsaved working copy (debounced)
  useEffect(() => {
    if (!d) return;
    const t = setTimeout(() => { post<{ html: string }>(`${path}/canvas`, { values: st.values, layout: st.layout }).then((r) => setHtml(r.html)).catch((e) => setErrs([e.message])); }, 250);
    return () => clearTimeout(t);
  }, [st, d]);
  const wire = useCallback(() => {
    const doc = frame.current?.contentDocument; if (!doc) return;
    doc.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.blockId === sel);
      el.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        // a click on a text or photo of the page opens that exact field in the inspector
        const f = (e.target as HTMLElement).closest<HTMLElement>('[data-sf]');
        if (el.dataset.blockId !== sel) fromCanvas.current = true; setSel(el.dataset.blockId!);
        if (f && el.contains(f)) setFocusKey((x) => ({ key: f.dataset.sf!, n: (x?.n ?? 0) + 1 }));
      };
    });
    // toolbar on the selected section in the canvas (same actions as the ⋯ menu)
    doc.querySelectorAll('.sx-bar').forEach((x) => x.remove());
    const host = sel ? doc.querySelector<HTMLElement>(`[data-block-id="${sel}"]`) : null;
    if (host) {
      const bar = doc.createElement('div'); bar.className = 'sx-bar'; bar.style.zoom = String(1 / scaleRef.current);
      const name = doc.createElement('span'); name.className = 'sx-name'; name.textContent = labelRef.current(sel!); bar.append(name);
      for (const a of actionsRef.current(sel!).filter((x) => x.id !== 'edit')) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = `sx-btn${a.danger ? ' sx-danger' : ''}`; b.textContent = SX_GLYPH[a.id] ?? '•';
        b.title = a.off ?? `${a.label}${a.kbd ? ` (${a.kbd})` : ''}`; b.setAttribute('aria-label', a.label); if (a.off) b.setAttribute('aria-disabled', 'true');
        b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); runActRef.current(sel!, a.id); };
        bar.append(b);
      }
      host.append(bar);
    }
    doc.onkeydown = (ev) => keysRef.current(ev, /INPUT|TEXTAREA|SELECT/.test((ev.target as HTMLElement)?.tagName ?? ''));
    doc.querySelectorAll<HTMLElement>('[data-sf]').forEach((el) => el.classList.toggle('sf-on', el.dataset.sf === focusKey?.key && !!el.closest(`[data-block-id="${sel}"]`)));
    const win = frame.current?.contentWindow; if (win) win.onscroll = () => { scrollY.current = win.scrollY; };
  }, [sel, focusKey, st.layout, editable]);
  const pending = useRef(false);   // a section picked before the canvas finished loading
  const reveal = useCallback(() => {
    const el = frame.current?.contentDocument?.querySelector<HTMLElement>(`[data-block-id="${sel}"]`); const win = frame.current?.contentWindow;
    if (!el || !win) { pending.current = true; return; }
    const top = Math.max(0, Math.round(el.getBoundingClientRect().top + win.scrollY));
    win.scrollTo({ top, behavior: 'instant' as ScrollBehavior }); scrollY.current = top;   // smooth scrolling stalls inside the scaled canvas
  }, [sel]);
  useEffect(() => { wire(); }, [wire]);
  // scroll to a section picked in the list; a click on the page itself leaves the view where it is
  useEffect(() => { if (fromCanvas.current) fromCanvas.current = false; else reveal(); }, [sel]);
  const onFrameLoad = useCallback(() => { const w = frame.current?.contentWindow; const y = scrollY.current;
    const put = () => w?.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    put(); requestAnimationFrame(put); wire();
    if (pending.current) { pending.current = false; reveal(); } }, [wire, reveal]);
  // focus and flash the inspector field that matches the clicked text or photo
  useEffect(() => {
    if (!focusKey) return;
    const t = setTimeout(() => {
      const box = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(focusKey.key)}"]`); if (!box) return;
      box.closest('details')?.setAttribute('open', '');
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      box.querySelector<HTMLElement>('input,textarea,button')?.focus({ preventScroll: true });
      box.classList.remove('hp-flash'); void box.offsetWidth; box.classList.add('hp-flash');
    }, 60);
    return () => clearTimeout(t);
  }, [focusKey]);

  // ---- saving: explicit, and automatic 3 s after the last change (never over newer work, never while approved)
  const showErr = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? (e.details as { path: string; message: string }[]).map((x) => x.message) : [e instanceof Error ? e.message : 'Something went wrong.']);
  const doSave = useCallback(async (quiet = false): Promise<boolean> => {
    setSave('saving'); setErrs([]);
    try {
      const r = await put<{ updatedAt: string; problems: string[] }>(path, { values: st.values, layout: st.layout, baseUpdatedAt: base.current });
      base.current = r.updatedAt; setSave('saved');
      const fresh = await api<Data>(path); setD(fresh); base.current = fresh.content?.updatedAt ?? null;
      if (!quiet) toast(live ? `Draft saved. The live ${P.noun} is unchanged until you publish.` : 'Draft saved. Submit it for review when it is ready.');
      return true;
    } catch (e) { setSave('failed'); showErr(e); return false; }
  }, [st, live, path, P.noun]);
  useEffect(() => {
    if (save !== 'unsaved' || !editable || status === 'approved') return;
    const t = setTimeout(() => { doSave(true); }, 3000);
    return () => clearTimeout(t);
  }, [st, save, editable, status, doSave]);
  // section shortcuts (also inside the canvas): ⌥↑ ⌥↓ move, ⌘D duplicate, H hide, ⌫ delete, ↵ edit
  const sectionKeys = (e: KeyboardEvent, typing: boolean) => {
    if (typing || !sel || dialog) return; const mod = e.metaKey || e.ctrlKey; const k = e.key;
    const act = e.altKey && k === 'ArrowUp' ? 'up' : e.altKey && k === 'ArrowDown' ? 'down' : mod && k.toLowerCase() === 'd' ? 'dup'
      : !mod && !e.altKey && k.toLowerCase() === 'h' ? 'hide' : !mod && (k === 'Delete' || k === 'Backspace') ? 'del' : null;
    if (act) { e.preventDefault(); runAct(sel, act); }
  };
  const keysRef = useRef(sectionKeys); keysRef.current = sectionKeys;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (save !== 'saved' && editable) doSave(); }
      if (mod && e.key.toLowerCase() === 'z' && !typing && editable) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      sectionKeys(e, typing);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (save === 'unsaved' || save === 'saving') e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [save]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (save !== 'saved' && !(await doSave(true))) return;
    setBusy(action); setErrs([]);
    try { await post(`${path}/transition`, { action, ...extra }); await load(); setDialog(null); setComment(''); toast({ submit: 'Sent for review. Reviewers are notified; it can be published once approved.', approve: 'Approved. It is ready to publish.', request_changes: 'Sent back to the author with your note.', withdraw: 'Back to draft. You can edit it again.' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind); try { await post(`${path}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? `Published and verified on the ${P.noun}` : `The ${P.noun} shows its original version again`); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() { if (save !== 'saved' && !(await doSave(true))) return; setBusy('preview'); try { const r = await post<{ url: string }>(`${path}/preview`); setUrl(r.url); setDialog({ kind: 'preview' }); } catch (e) { showErr(e); } finally { setBusy(''); } }

  actionsRef.current = actionsFor; runActRef.current = runAct; labelRef.current = (id) => { const e = st.layout.find((x) => x.id === id); return e ? label(e) : id; };
  if (!d) return <Loading />;
  // one quiet status chip in the header instead of a banner; banners are kept for things that need action
  const reviewable = d.content && ['draft', 'changes_requested'].includes(status);
  const nothing = d.problems.length === 1 && /nothing is changed/i.test(d.problems[0]);
  const chip: { text: string; tone: 'muted' | 'ok' | 'warn' | 'info'; tip?: string } | null =
    status === 'in_review' ? { text: 'In review · read-only', tone: 'info', tip: 'Withdraw it to edit.' }
    : status === 'approved' ? { text: 'Approved · ready to publish', tone: 'ok' }
    : !reviewable || save !== 'saved' ? null
    : nothing || !d.content ? { text: 'No changes', tone: 'muted', tip: 'Edit a section to start a draft.' }
    : d.problems.length ? { text: `${d.problems.length} to fix before review`, tone: 'warn' }
    : { text: 'Ready for review', tone: 'ok' };
  const scale = Math.min(1, Math.max(0.1, (size.w - 8) / device)); const canvasH = Math.max(400, size.h - 28); scaleRef.current = scale;
  const selEntry = st.layout.find((e) => e.id === sel) ?? null;
  // problems from the last save, each with its place: shown on the chip, as dots on the sections, and as a list
  const issues = chip?.tone === 'warn' ? (d.issues ?? d.problems.map((message) => ({ message, section: null, field: null }))) : [];
  const issuesIn = (id: string) => issues.filter((i) => i.section === id).length;
  const where = (i: Issue) => {
    const e = i.section ? st.layout.find((x) => x.id === i.section) : null;
    if (!e) return 'Whole page';
    const f = i.field ? d.fields.find((x) => x.key === i.field) : null;
    const prop = !f && i.field && e.kind === 'block' ? defs.get(e.type)?.fields.find((x) => x.key === i.field)?.label : null;
    const slide = f?.section.match(/^hero\.(\d+)$/)?.[1];
    return [label(e), slide && `Slide ${slide}`, f?.label ?? prop, i.item !== undefined && `item ${i.item + 1}`].filter(Boolean).join(' · ');
  };
  const goTo = (i: Issue) => {
    setIssuesOpen(false); if (!i.section) return;
    if (sel !== i.section) setSel(i.section); else reveal();
    setTab('content');
    if (i.field) setFocusKey((x) => ({ key: i.field!, n: (x?.n ?? 0) + 1 }));
  };
  const nChanges = Object.keys(st.values).length + (!layoutOn || same(st.layout, d.siteSections.map((s) => ({ kind: 'section', id: s.id, hidden: false }))) ? 0 : 1);
  const saveLabel = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Save failed' }[save];

  return <div className="builder">
    <div className="b-bar">
      <div className="b-title"><b>{P.label}</b><span className="mono muted">{P.file}</span></div>
      <span className="pills">{live && status !== 'published' && <LiveBadge />}{d.content ? <Badge s={status} /> : <span className="pill">Original</span>}</span>
      <span className={`muted hp-save is-${save}`} role="status" style={{ fontSize: 12 }}>{saveLabel}</span>
      {chip && (chip.tone === 'warn'
        ? <span className="b-issues"><button className="b-chip is-warn" aria-expanded={issuesOpen} aria-haspopup="dialog" onClick={() => setIssuesOpen(!issuesOpen)}><Icon n="alert" width={13} height={13} />{chip.text}</button>
          {issuesOpen && <IssueList issues={issues} where={where} onGo={goTo} onClose={() => setIssuesOpen(false)} />}</span>
        : <span className={`b-chip is-${chip.tone}`} title={chip.tip}>{chip.text}</span>)}
      <span style={{ flex: 1 }} />
      <div className="seg" role="group" aria-label="Device">{DEVICES.map(([w, ic, l]) => <button key={w} className={device === w ? 'on' : ''} onClick={() => setDevice(w)} title={l} aria-label={l}><Icon n={ic} width={15} height={15} style={{ verticalAlign: -3 }} /></button>)}</div>
      <button className="btn btn-ghost icon-btn" onClick={undo} disabled={!past.length || !editable} title="Undo (⌘Z)" aria-label="Undo"><Icon n="undo" /></button>
      <button className="btn btn-ghost icon-btn" onClick={redo} disabled={!future.length || !editable} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon n="undo" style={{ transform: 'scaleX(-1)' }} /></button>
      <button className="btn btn-ghost" onClick={() => setDialog({ kind: 'history' })}><Icon n="clock" />History</button>
      <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
      {editable && <button className="btn" onClick={() => doSave()} disabled={save === 'saved' || save === 'saving'}><Icon n="save" />Save</button>}
      {d.content && ['draft', 'changes_requested'].includes(status) && can('page.update') && <button className="btn btn-primary" onClick={() => act('submit')} disabled={!!busy || (save === 'saved' && d.problems.length > 0)} title={save === 'saved' && d.problems.length ? d.problems.join(' · ') : undefined}><Icon n="send" />Submit for review</button>}
      {status === 'in_review' && can('page.approve') && <><button className="btn" onClick={() => setDialog({ kind: 'changes' })}>Request changes</button><button className="btn btn-ok" onClick={() => act('approve')} disabled={!!busy}><Icon n="check" />Approve</button></>}
      {status === 'approved' && can('page.publish') && <button className="btn btn-ok" onClick={() => setDialog({ kind: 'publish' })}><Icon n="rocket" />Publish</button>}
      {d.content && ['in_review', 'approved'].includes(status) && can('page.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw</button>}
    </div>
    {errs.length > 0 && <div className="notice n-warn b-notice" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'changes_requested' && <div className="notice n-warn b-notice" role="status"><div><b>Changes requested.</b> Update the {P.noun}, then submit it for review again.{d.history.comments.filter((x) => x.kind === 'request_changes' && x.body).slice(-1).map((x) => <q key={x.id} style={{ marginLeft: 6 }}>{x.body}</q>)}</div></div>}

    <div className="b-body">
      <aside className="b-left">
        <div className="between" style={{ padding: '10px 12px 6px' }}><b style={{ fontSize: 13 }}>Sections</b>
          {editable && layoutOn && <button className="btn btn-sm btn-primary" onClick={() => setDialog({ kind: 'library' })}><Icon n="plus" /><span className="b-add-t">Add section</span></button>}</div>
        <ol className="b-scroll b-layers" aria-label={`${P.label} sections`}>{st.layout.map((e, i) => (
          <li key={e.id} className={`b-layer${sel === e.id ? ' on' : ''}${e.hidden ? ' off' : ''}`} draggable={editable && layoutOn}
            onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', String(i)); ev.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(ev) => { if (editable && layoutOn) { ev.preventDefault(); ev.currentTarget.classList.add('drop'); } }} onDragLeave={(ev) => ev.currentTarget.classList.remove('drop')}
            onDrop={(ev) => { ev.preventDefault(); ev.currentTarget.classList.remove('drop'); move(Number(ev.dataTransfer.getData('text/plain')), i); }}>
            {issuesIn(e.id) > 0 && <i className="b-warn" title={`${issuesIn(e.id)} to fix in this section`} aria-label={`${issuesIn(e.id)} to fix`} />}
            <button className="b-layer-main" data-tip={label(e)} onClick={() => { if (sel === e.id) reveal(); else setSel(e.id); }} aria-current={sel === e.id}>
              <span className="b-grip" aria-hidden="true">⋮⋮</span>
              <span className="hp-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <Icon n={e.kind === 'section' ? SECTION_ICON[e.id] ?? 'layers' : 'plus'} width={15} height={15} />
              <span className="min-w-0"><b>{label(e)}</b><small>{e.kind === 'section' ? `${P.label} section` : 'Added section'}{e.hidden ? ' · hidden' : ''}{e.kind === 'section' && d.fields.some((f) => f.sectionId === e.id && f.key in st.values) ? ' · edited' : ''}</small></span>
            </button>
            {layoutOn && <span className="b-layer-act">
              <button className="b-more" aria-label={`More actions for ${label(e)}`} aria-haspopup="menu" aria-expanded={menu?.id === e.id}
                onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setMenu(menu?.id === e.id ? null : { id: e.id, x: r.right, y: r.bottom + 4 }); }}>⋯</button>
            </span>}
          </li>))}
        </ol>
      </aside>

      <div className="b-canvas" ref={box} onClick={() => setSel(null)}>
        <div className="b-device" style={{ width: device * scale, height: canvasH }} onClick={(ev) => ev.stopPropagation()}>
          <iframe ref={frame} title={`${P.label} canvas`} srcDoc={html} onLoad={onFrameLoad} style={{ width: device, height: canvasH / scale, zoom: scale }} />
        </div>
        <span className="b-zoom">{device}px · {Math.round(scale * 100)}% · click any text or photo to edit it</span>
      </div>

      <aside className="b-right">
        {!selEntry ? <div className="b-scroll" style={{ padding: 16 }}><p className="muted">Select a section in the list or on the page.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>{nChanges ? `${nChanges} change${nChanges === 1 ? '' : 's'} from the original ${P.noun}.` : `No changes from the original ${P.noun}.`}</p>
          {live && can('page.publish') && <button className="btn btn-ghost btn-danger btn-sm" onClick={() => setDialog({ kind: 'unpublish' })}>Show the original {P.noun}</button>}</div>
        : <fieldset className="b-scroll b-insp stack" disabled={!editable}>
          <div><small className="muted">{selEntry.kind === 'section' ? `${P.label} section` : defs.get(selEntry.type)?.group}</small><h3 style={{ margin: '2px 0 0', fontSize: 16 }}>{label(selEntry)}</h3>
            {selEntry.kind === 'block' && <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>{defs.get(selEntry.type)?.description}</p>}</div>
          {layoutOn && <label className="check"><input type="checkbox" checked={!selEntry.hidden} onChange={() => toggle(selEntry.id)} /><span>Show on the homepage</span></label>}
          {selEntry.kind === 'section'
            ? <SectionFields fields={d.fields.filter((f) => f.sectionId === selEntry.id)} values={st.values} media={media} editable={editable} onChange={setField} onPickImage={(key, story) => setDialog({ kind: 'image', key, story })} />
            : <>
              <div className="seg ds-tabs" role="tablist">{(['content', 'design'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'content' ? 'Content' : 'Design'}</button>)}</div>
              {tab === 'design' ? <DesignFields value={selEntry.design} onChange={(d) => setLayout(st.layout.map((x) => (x.id === selEntry.id && x.kind === 'block' ? { ...x, design: d } : x)))} />
                : (defs.get(selEntry.type)?.fields ?? []).map((f) => <div key={f.key} data-field={f.key}><FieldEditor f={f} value={selEntry.props[f.key]} links={links} onChange={(v) => setProps(selEntry.id, { ...selEntry.props, [f.key]: v })} /></div>)}</>}
        </fieldset>}
      </aside>
    </div>

    {dialog?.kind === 'library' && <SectionLibrary catalog={d.catalog} onPick={(t) => addBlock(t, dialog.at)} onClose={() => setDialog(null)} />}
    {menu && <ActionMenu x={menu.x} y={menu.y} acts={actionsFor(menu.id)} onRun={(a) => { setMenu(null); runAct(menu.id, a); }} onClose={() => setMenu(null)} />}
    {dialog?.kind === 'image' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { const f = d.fields.find((x) => x.key === dialog.key)!; if (m[0]) { setMedia((x) => ({ ...x, [m[0].id]: m[0] }));
      // a participant story's photo, or a whole image field
      if (dialog.story !== undefined) { const list = [...(st.values[f.key] ?? f.default)]; list[dialog.story] = { ...list[dialog.story], image: { mediaId: m[0].id } }; setField(f, list); }
      else setField(f, { mediaId: m[0].id }); } setDialog(null); }} />}
    {dialog?.kind === 'preview' && <Modal wide title="Preview · built by the real website build" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title={`${P.label} preview`} src={url} style={{ width: Math.min(device, window.innerWidth - 80) }} /></div></Modal>}
    {dialog?.kind === 'history' && <Modal title={`${P.label} history`} onClose={() => setDialog(null)}><div className="modal-b">
      {!d.content ? <p className="muted">No versions yet.</p> : <ol className="timeline">{d.history.revisions.map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === d.content!.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
        {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into a new draft? The live ${P.noun} does not change.`)) { try { await post(`${path}/revisions/${r.id}/restore`); await load(); setDialog(null); toast('Revision restored as a draft'); } catch (e) { showErr(e); } } }}>Restore as a new draft</button>}</li>)}
        {d.history.comments.filter((x) => x.body).map((x) => <li key={x.id}><b>{x.kind.replace('_', ' ')}</b><q>{x.body}</q><small>{fmtDate(x.createdAt)}</small></li>)}</ol>}</div></Modal>}
    {dialog?.kind === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog?.kind === 'publish' && <Modal size="sm" title={`Publish the ${P.noun}?`} onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{P.file}</span> with the approved version and checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog?.kind === 'unpublish' && <Modal size="sm" title={`Show the original ${P.noun}?`} onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Rebuilding…' : 'Show original'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The {P.noun} is rebuilt exactly as written in the website. Your changes stay here as a draft.</p></div></Modal>}
  </div>;
}

// panel sub-group headings (fields.ts gives these sections sub-groups)
const GROUP_LABEL: Record<string, string> = { purpose: 'Section header', 'purpose.mission': 'Our mission', 'purpose.vision': 'Our vision', 'purpose.values': 'Our values' };

// same limits as the server (modules/home/service.ts HEAD_MAX) for the numbered section headers
const HEAD_MAX: Record<string, number> = { num: 4, label: 60, meta: 60 };

function SectionFields({ fields, values, media, editable, onChange, onPickImage }: { fields: FieldDef[]; values: Record<string, any>; media: Record<string, MediaItem>; editable: boolean; onChange: (f: FieldDef, v: any) => void; onPickImage: (key: string, story?: number) => void }) {
  if (!fields.length) return <p className="muted" style={{ fontSize: 13 }}>This section’s content comes from Studio records or the website’s design, so there is nothing to type here. You can move or hide it.</p>;
  // the hero has several slides: show each slide's fields together, under its own heading
  const groups = [...new Set(fields.map((f) => f.section))];
  if (groups.length > 1) return <>{groups.map((g) => <details key={g} className="hp-group" open={g === groups[0]}><summary>{GROUP_LABEL[g] ?? g.replace(/^hero\.(\d+)$/, 'Slide $1')}</summary>
    <div className="stack"><SectionFields fields={fields.filter((f) => f.section === g)} values={values} media={media} editable={editable} onChange={onChange} onPickImage={onPickImage} /></div></details>)}</>;
  return <>{fields.map((f) => {
    const v = f.key in values ? values[f.key] : f.default; const changed = f.key in values;
    let control: React.ReactNode;
    if (f.type === 'split') control = <><input className="input" maxLength={90} value={v.main} onChange={(e) => onChange(f, { ...v, main: e.target.value })} aria-label={`${f.label}, main part`} /><input className="input" maxLength={90} value={v.soft} onChange={(e) => onChange(f, { ...v, soft: e.target.value })} aria-label={`${f.label}, lighter part`} placeholder="Lighter second part (optional)" /></>;
    else if (f.type === 'link') control = <><input className="input" maxLength={40} value={v.label} onChange={(e) => onChange(f, { ...v, label: e.target.value })} aria-label={`${f.label} text`} /><input className="input mono" maxLength={300} value={v.href} onChange={(e) => onChange(f, { ...v, href: e.target.value.trim() })} aria-label={`${f.label} link`} /></>;
    else if (f.type === 'image') { const m = v?.mediaId ? media[v.mediaId] : null; const src = m ? m.url : v?.src ? '/studio/site/' + v.src : null;   // a placeholder tile has no photo yet
      control = <>{src ? <div className="thumb" style={{ width: '100%' }}><img src={src} alt={m ? m.alt : v.alt} /></div>
        : <div className="thumb" style={{ width: '100%', aspectRatio: '4 / 3', display: 'grid', placeItems: 'center', color: 'var(--muted, #78716C)', fontSize: 13 }}>No photo yet</div>}
      <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} disabled={!editable} onClick={() => onPickImage(f.key)}><Icon n="image" />Choose photo</button></>; }
    else if (f.type === 'stories') control = <StoriesField value={v} media={media} editable={editable} onChange={(x) => onChange(f, x)} onPickImage={(i) => onPickImage(f.key, i)} />;
    else if (f.type === 'rich' || String(v).length > 60) control = <><textarea className="textarea" rows={Math.min(10, Math.max(3, Math.ceil(String(v).length / 45)))} maxLength={f.type === 'rich' ? 700 : TEXT_MAX} value={v} onChange={(e) => onChange(f, e.target.value.replace(/\n/g, ' '))} aria-label={f.label} />
      <small className="muted" style={{ justifySelf: 'end' }}>{String(v).length}/{f.type === 'rich' ? 700 : TEXT_MAX}{f.type !== 'rich' && String(v).length > 180 ? ' · long text is shown smaller on the page' : ''}</small></>;
    else control = <input className="input" maxLength={HEAD_MAX[f.key.match(/\.head\.(num|label|meta)$/)?.[1] ?? ''] ?? (f.key.endsWith('.value') ? 24 : TEXT_MAX)} value={v} onChange={(e) => onChange(f, e.target.value)} aria-label={f.label} />;
    return <div key={f.key} data-field={f.key} className={`field${changed ? ' hp-changed' : ''}`}><span>{f.label}{changed && <em className="hp-dot">edited</em>}</span>{control}
      {f.type === 'rich' && <small>**Double stars** highlight words, as on the page.</small>}
      {changed && f.type !== 'image' && f.type !== 'stories' && <small>The French and Arabic pages show this English text until it is translated on the Translations page.</small>}
      {changed && editable && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto', justifySelf: 'start' }} onClick={() => onChange(f, null)}>Reset to the original</button>}</div>;
  })}</>;
}

type StoryImage = { mediaId: string } | { src: string; alt: string; w: number; h: number; fx: number; fy: number };
type Story = { quote: string; name: string; role: string; caption: string; image?: StoryImage; sample?: boolean };
const STORIES_MAX = 8;   // same limit as the server (modules/home/service.ts)
/** Participant stories: one card per story, in carousel order. Add, edit, move and delete; at least one stays. */
function StoriesField({ value, media, editable, onChange, onPickImage }: { value: Story[]; media: Record<string, MediaItem>; editable: boolean; onChange: (v: Story[]) => void; onPickImage: (i: number) => void }) {
  const set = (i: number, patch: Partial<Story>) => onChange(value.map((s, j) => {
    if (j !== i) return s;
    const n = { ...s, ...patch };
    if ('quote' in patch || 'name' in patch) delete n.sample;   // writing a real quote or name makes it a real story
    return n;
  }));
  const move = (i: number, d: number) => { const l = [...value]; const [x] = l.splice(i, 1); l.splice(i + d, 0, x); onChange(l); };
  const del = (i: number) => { if (confirm(`Delete story ${i + 1}${value[i].name ? ` (${value[i].name})` : ''} from the draft? Undo (⌘Z) brings it back.`)) onChange(value.filter((_s, j) => j !== i)); };
  return <div className="stack" style={{ gap: 10 }}>
    <small className="muted">The carousel shows these stories in this order. Its progress bars and the “01 / {String(value.length).padStart(2, '0')}” counter follow the list.</small>
    {value.map((s, i) => <div key={i} className="card" style={{ padding: 10, display: 'grid', gap: 6 }}>
      <div className="between"><b style={{ fontSize: 13 }}>Story {i + 1}{s.sample && <em className="hp-dot" style={{ marginLeft: 6 }}>sample</em>}</b>
        <span style={{ display: 'flex', gap: 2 }}>
          <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={!editable || i === 0} onClick={() => move(i, -1)} aria-label={`Move story ${i + 1} up`} title="Move up">↑</button>
          <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={!editable || i === value.length - 1} onClick={() => move(i, 1)} aria-label={`Move story ${i + 1} down`} title="Move down">↓</button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" disabled={!editable || value.length <= 1} onClick={() => del(i)} aria-label={`Delete story ${i + 1}`} title={value.length <= 1 ? 'Keep at least one story' : 'Delete'}>Delete</button>
        </span></div>
      {s.sample && <small className="muted">Sample text: replace it with a real participant’s words or delete this story before review.</small>}
      <textarea className="textarea" maxLength={300} value={s.quote} onChange={(e) => set(i, { quote: e.target.value.replace(/\n/g, ' ') })} aria-label={`Story ${i + 1} quote`} placeholder="Quote" />
      <input className="input" maxLength={80} value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Story ${i + 1} name`} placeholder="Name" />
      <input className="input" maxLength={120} value={s.role} onChange={(e) => set(i, { role: e.target.value })} aria-label={`Story ${i + 1} programme and date`} placeholder="Programme · date (optional)" />
      <StoryPhoto story={s} i={i} media={media} editable={editable} onPick={() => onPickImage(i)} onRemove={() => { const n = { ...s }; delete n.image; onChange(value.map((x, j) => (j === i ? n : x))); }} />
      {!s.image && <input className="input" maxLength={80} value={s.caption} onChange={(e) => set(i, { caption: e.target.value })} aria-label={`Story ${i + 1} photo note`} placeholder="Photo note on the placeholder (optional)" />}
    </div>)}
    <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} disabled={!editable || value.length >= STORIES_MAX} title={value.length >= STORIES_MAX ? `At most ${STORIES_MAX} stories` : undefined}
      onClick={() => onChange([...value, { quote: '', name: '', role: '', caption: '' }])}><Icon n="plus" />Add story</button>
  </div>;
}

/** A story's photo: a Media Library pick (its alt text and focal point are edited there, once, for every page that uses
 *  it) or the photo written in the page. Without one the slide shows the grey placeholder. */
function StoryPhoto({ story, i, media, editable, onPick, onRemove }: { story: Story; i: number; media: Record<string, MediaItem>; editable: boolean; onPick: () => void; onRemove: () => void }) {
  const im = story.image;
  const m = im && 'mediaId' in im ? media[im.mediaId] : null;
  const src = m ? m.url : im && 'src' in im ? '/studio/site/' + im.src : null;
  const alt = m ? m.alt : im && 'alt' in im ? im.alt : '';
  const pos = m ? [m.focalX, m.focalY] : im && 'fx' in im ? [im.fx, im.fy] : [50, 50];
  return <div style={{ display: 'grid', gap: 6 }}>
    {src ? <>
      <div className="thumb" style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden' }}><img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${pos[0]}% ${pos[1]}%` }} /></div>
      <small className="muted">{alt ? <>Alt text: “{alt}”</> : <b>No alt text yet.</b>} · Focus {Math.round(pos[0])}% {Math.round(pos[1])}%{m ? ' · edit both in the Media Library' : ' · photo from the website'}</small>
    </> : <small className="muted">No photo: the slide shows a grey placeholder.</small>}
    <span style={{ display: 'flex', gap: 6 }}>
      <button type="button" className="btn btn-sm" disabled={!editable} onClick={onPick} aria-label={`Choose a photo for story ${i + 1}`}><Icon n="image" />{src ? 'Change photo' : 'Choose photo'}</button>
      {src && <button type="button" className="btn btn-ghost btn-sm" disabled={!editable} onClick={onRemove} aria-label={`Remove the photo of story ${i + 1}`}>Remove photo</button>}
    </span>
  </div>;
}

type Issue = { message: string; section: string | null; field: string | null; item?: number };

/** What to fix before review: each problem with its place; a click opens that section and its field. */
function IssueList({ issues, where, onGo, onClose }: { issues: Issue[]; where: (i: Issue) => string; onGo: (i: Issue) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const out = (e: MouseEvent) => { const t = e.target as Element; if (!ref.current?.contains(t) && !t.closest?.('.b-issues')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key, true); };
  }, []);
  return <div ref={ref} className="b-issue-list" role="dialog" aria-label="To fix before review">
    <b className="b-issue-h">To fix before review</b>
    <ul>{issues.map((i, n) => <li key={n}>
      {i.section ? <button onClick={() => onGo(i)}><small>{where(i)}</small><span>{i.message}</span><Icon n="chev" width={13} height={13} /></button>
        : <div className="b-issue-page"><small>{where(i)}</small><span>{i.message}</span></div>}
    </li>)}</ul>
  </div>;
}

type Act = { id: string; label: string; icon: string; kbd?: string; danger?: boolean; off?: string; run: () => void };
const SX_GLYPH: Record<string, string> = { above: '+↑', below: '+↓', dup: '⧉', up: '↑', down: '↓', hide: '◉', del: '🗑' };

/** The ⋯ menu of a section: every action, its shortcut, and why an action is unavailable. */
function ActionMenu({ x, y, acts, onRun, onClose }: { x: number; y: number; acts: Act[]; onRun: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([aria-disabled])')?.focus();
    const out = (e: MouseEvent) => { const t = e.target as Element; if (!ref.current?.contains(t) && !t.closest?.('.b-more')) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const b = [...ref.current!.querySelectorAll<HTMLElement>('button')]; const i = b.indexOf(document.activeElement as HTMLElement); b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length]?.focus(); }
    };
    setTimeout(() => document.addEventListener('mousedown', out)); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key, true); };
  }, []);
  const top = Math.min(y, window.innerHeight - 340), left = Math.max(8, x - 240);
  return <div ref={ref} className="b-menu" role="menu" style={{ top, left }}>
    {acts.map((a, i) => <Fragment key={a.id}>
      {(a.id === 'above' || a.id === 'dup' || a.id === 'hide') && i > 0 && <hr />}
      <button role="menuitem" className={a.danger ? 'danger' : ''} aria-disabled={a.off ? true : undefined} title={a.off} onClick={() => (a.off ? undefined : onRun(a.id))}>
        <span>{a.label}</span>{a.kbd && <kbd>{a.kbd}</kbd>}
      </button>
      {a.off && (a.id === 'dup' || a.id === 'del') && <small className="b-menu-why">{a.off}</small>}
    </Fragment>)}
  </div>;
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
