// Menus: the website's main menu (desktop dropdowns and phone menu), its main button and the footer link columns.
// Edits are drafts; the site changes only after review and publishing (the design itself stays in the site's partials).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, post, put } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, ago, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { useDirtyGuard } from '../Editor.tsx';
import { Loading } from './Dashboard.tsx';
import '../menus.css';

type Link = { label: string; href: string };
type PanelLink = { title: string; desc: string; href: string; dot?: string };
type Panel = { title: string; text: string; all: Link; links: PanelLink[]; feature: { photo: string; kicker: string; title: string; href: string } | null; prompt: string; pills: Link[] };
type Item = { label: string; key: string; id?: string; href?: string; phone: Link[]; panel?: Panel };
type Menu = { version: 1; header: { items: Item[]; cta: Link; phoneExtra: Link[] }; footer: { columns: { title: string; aria?: string; links: (Link & { dot?: string })[] }[] } };
type View = { status: string; draft: Menu; published: Menu | null; revision: string | null; publishedAt: string | null; updatedAt: string | null; updatedByName: string | null; submittedBy: string | null; pending: boolean; linkIssues: { path: string; message: string }[]; pages: { file: string; title: string }[]; navKeys: string[] };
type Sel = number | 'cta' | 'phone';

const KEY_LABEL: Record<string, string> = { none: 'No highlight', home: 'Homepage', about: 'About pages', pillars: 'Pillar pages', projects: 'Project pages', news: 'News & Stories', events: 'Events', partners: 'Partners', contact: 'Contact', involved: 'Get Involved' };
const SWATCHES = ['#FFB2B9', '#A8DDFB', '#82E591', '#FBE38A', '#C4B5FD', '#FDBA74'];
const two = (n: number) => String(n).padStart(2, '0');
const move = <T,>(a: T[], i: number, j: number) => { if (j < 0 || j >= a.length || i === j) return a; const n = [...a]; const [x] = n.splice(i, 1); n.splice(j, 0, x); return n; };

/** What changed between the published menus and the draft, in plain words. */
function changes(pub: Menu | null, d: Menu): string[] {
  if (!pub) return [];
  const out: string[] = [];
  const pi = pub.header.items, di = d.header.items;
  const key = (x: Item) => x.id ?? x.href ?? x.label;
  di.forEach((x) => {
    const was = pi.find((y) => key(y) === key(x)) ?? pi.find((y) => y.label === x.label);
    if (!was) { out.push(`Added “${x.label}” to the main menu`); return; }
    if (was.label !== x.label) out.push(`Renamed “${was.label}” to “${x.label}”`);
    if (!was.panel !== !x.panel) out.push(`“${x.label}” is now ${x.panel ? 'a dropdown' : 'a plain link'}`);
    if (!x.panel && was.href !== x.href) out.push(`“${x.label}” now goes to ${x.href}`);
    if (x.panel && was.panel && JSON.stringify(x.panel) !== JSON.stringify(was.panel)) out.push(`Edited the “${x.label}” dropdown`);
    if (JSON.stringify(x.phone) !== JSON.stringify(was.phone)) out.push(`Edited the phone links of “${x.label}”`);
    if (was.key !== x.key) out.push(`“${x.label}” is now highlighted on ${KEY_LABEL[x.key] ?? x.key}`);
  });
  pi.forEach((y) => { if (!di.find((x) => key(x) === key(y)) && !di.find((x) => x.label === y.label)) out.push(`Removed “${y.label}” from the main menu`); });
  const order = (a: Item[]) => a.map(key).filter((k) => pi.some((y) => key(y) === k) && di.some((x) => key(x) === k)).join('|');
  if (order(pi) !== order(di)) out.push('Changed the order of the main menu');
  if (JSON.stringify(pub.header.cta) !== JSON.stringify(d.header.cta)) out.push(`Main button: “${d.header.cta.label}” → ${d.header.cta.href}`);
  if (JSON.stringify(pub.header.phoneExtra) !== JSON.stringify(d.header.phoneExtra)) out.push('Edited the phone-only links');
  d.footer.columns.forEach((c, i) => { if (JSON.stringify(c) !== JSON.stringify(pub.footer.columns[i])) out.push(`Edited the footer column “${c.title}”`); });
  return out;
}

/** A link field: suggests the site's pages and shows the page it points to. */
function Href({ value, onChange, pages, label, disabled }: { value: string; onChange: (v: string) => void; pages: View['pages']; label: string; disabled?: boolean }) {
  const page = pages.find((p) => p.file === value.split('#')[0]);
  const ext = /^https:\/\//.test(value), other = /^(#|mailto:|tel:)/.test(value);
  const bad = !!value && !page && !ext && !other;
  return <div className="mn-href">
    <span className={`mn-href-in${bad ? ' bad' : ''}`}><Icon n={ext ? 'ext' : 'globe'} width={13} height={13} />
      <input className="mono" list="mn-pages" value={value} disabled={disabled} placeholder="Choose a page…" aria-label={label} aria-invalid={bad} onChange={(e) => onChange(e.target.value.trim())} /></span>
    <small className={bad ? 'bad' : ''}>{!value ? 'Pick a page, or paste a full https:// link' : page ? `${page.title}${value.includes('#') ? ` · section ${value.split('#')[1]}` : ''}` : ext ? 'External site' : other ? 'Section, email or phone link' : 'Not a page of this site'}</small>
  </div>;
}

function RowActs({ i, n, onMove, onRemove, noun, canRemove = true }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void; noun: string; canRemove?: boolean }) {
  return <span className="mn-acts">
    <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${noun} up`} disabled={i === 0} onClick={() => onMove(i - 1)}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(-90deg)' }} /></button>
    <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${noun} down`} disabled={i === n - 1} onClick={() => onMove(i + 1)}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(90deg)' }} /></button>
    <button type="button" className="btn btn-ghost icon-btn btn-sm mn-del" aria-label={`Remove ${noun}`} disabled={!canRemove} onClick={onRemove}><Icon n="x" width={13} height={13} /></button>
  </span>;
}

/** Badge that is a number by default, or a colour dot (pillars). Click to choose. */
function DotBadge({ n, dot, onChange, disabled }: { n: number; dot?: string; onChange: (d?: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <span className="mn-dotpick">
    <button type="button" className="mn-badge" disabled={disabled} aria-label={dot ? 'Change the dot colour' : 'Use a colour dot instead of the number'} aria-expanded={open} onClick={() => setOpen(!open)}>{dot ? <i style={{ background: dot }} /> : two(n)}</button>
    {open && <span className="mn-pop" role="dialog" aria-label="Badge">
      <button type="button" className={!dot ? 'on' : ''} onClick={() => { onChange(undefined); setOpen(false); }}>{two(n)}</button>
      {SWATCHES.map((c) => <button key={c} type="button" className={dot?.toLowerCase() === c.toLowerCase() ? 'on' : ''} aria-label={`Dot ${c}`} onClick={() => { onChange(c); setOpen(false); }}><i style={{ background: c }} /></button>)}
    </span>}
  </span>;
}

/** Rows of { label, href } with reorder and remove. */
function Links({ rows, onChange, pages, max, noun, disabled, dots }: { rows: (Link & { dot?: string })[]; onChange: (r: (Link & { dot?: string })[]) => void; pages: View['pages']; max: number; noun: string; disabled?: boolean; dots?: boolean }) {
  return <div className="mn-links">
    {rows.length === 0 && <p className="mn-empty">No {noun}s yet.</p>}
    {rows.map((r, i) => <div key={i} className={`mn-link${dots ? ' dots' : ''}`}>
      {dots && <DotBadge n={i + 1} dot={r.dot} disabled={disabled} onChange={(d) => onChange(rows.map((x, j) => (j === i ? (d ? { ...x, dot: d } : { label: x.label, href: x.href }) : x)))} />}
      <input className="input" value={r.label} disabled={disabled} maxLength={60} placeholder="Label" aria-label={`${noun} ${i + 1} label`} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
      <Href value={r.href} pages={pages} disabled={disabled} label={`${noun} ${i + 1} link`} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, href: v } : x)))} />
      {!disabled && <RowActs i={i} n={rows.length} noun={`${noun} ${i + 1}`} onMove={(to) => onChange(move(rows, i, to))} onRemove={() => onChange(rows.filter((_, j) => j !== i))} />}
    </div>)}
    {!disabled && rows.length < max && <button type="button" className="btn btn-sm mn-add" onClick={() => onChange([...rows, { label: '', href: '' }])}><Icon n="plus" />Add {noun}</button>}
  </div>;
}

function Group({ title, summary, open, onToggle, children }: { title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className={`mn-group${open ? ' open' : ''}`}>
    <button type="button" className="mn-group-h" aria-expanded={open} onClick={onToggle}><Icon n="chev" width={14} height={14} /><b>{title}</b><span>{summary}</span></button>
    {open && <div className="mn-group-b">{children}</div>}
  </section>;
}

export function MenusPage() {
  const toast = useToast(); const can = useCan(); const me = useMe();
  const [v, setV] = useState<View | null>(null); const [m, setM] = useState<Menu | null>(null);
  const [tab, setTab] = useState<'header' | 'footer'>('header'); const [sel, setSel] = useState<Sel>(0);
  const [view, setView] = useState<'desktop' | 'phone'>('desktop');
  const [open, setOpen] = useState<Record<string, boolean>>({ links: true });
  const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<{ path: string; message: string }[]>([]);
  const [dialog, setDialog] = useState<'changes' | 'publish' | 'review' | null>(null); const [comment, setComment] = useState('');
  const [drag, setDrag] = useState<number | null>(null); const [over, setOver] = useState<number | null>(null);
  const saveRef = useRef<() => void>(() => {});
  const take = (x: View) => { setV(x); setM(structuredClone(x.draft)); setErrs([]); };
  useEffect(() => { api<View>('/menus').then(take).catch((e) => toast(e.message, true)); }, []);
  const dirty = !!v && !!m && JSON.stringify(m) !== JSON.stringify(v.draft);
  useDirtyGuard(dirty);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const hdrNum = useMemo(() => { let n = 0; return (m?.header.items ?? []).map((it) => (it.panel ? ++n : 0)); }, [m]);
  const diff = useMemo(() => (v && m ? changes(v.published, m) : []), [v, m]);
  if (!v || !m) return <Loading />;

  const status = v.status; const editable = can('page.update') && !['in_review', 'approved'].includes(status);
  const items = m.header.items;
  const idx = typeof sel === 'number' ? Math.min(sel, items.length - 1) : -1;
  const it = idx >= 0 ? items[idx] : null;
  const setItems = (next: Item[]) => setM({ ...m, header: { ...m.header, items: next } });
  const setIt = (patch: Partial<Item>) => setItems(items.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const setPanel = (patch: Partial<Panel>) => it?.panel && setIt({ panel: { ...it.panel, ...patch } });
  const selfReview = v.submittedBy === me.user.id && me.user.role !== 'super_admin';
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  async function run(label: string, fn: () => Promise<void>, done: string) {
    setBusy(label); setErrs([]);
    try { await fn(); setDialog(null); setComment(''); toast(done); }
    catch (e) { setDialog(null); if (e instanceof ApiError && e.details?.length) setErrs(e.details as { path: string; message: string }[]); toast((e as Error).message, true); }
    finally { setBusy(''); }
  }
  const save = () => run('save', async () => take(await put<View>('/menus', m)), 'Draft saved. The website changes only after review and publishing.');
  saveRef.current = () => { if (dirty && editable && !busy) save(); };
  const act = (action: string, done: string) => run(action, async () => { if (dirty) take(await put<View>('/menus', m)); take(await post<View>('/menus/transition', { action, comment })); }, done);
  const publish = () => run('publish', async () => { await post('/menus/publish'); take(await api<View>('/menus')); }, 'Menus published and checked on every page');
  const discard = () => { if (!confirm('Discard all menu changes and go back to what the website shows?')) return; run('discard', async () => take(await post<View>('/menus/discard')), 'Back to the published menus'); };
  const addItem = (kind: 'link' | 'dropdown') => {
    const next: Item = kind === 'link' ? { label: 'New link', key: 'none', href: '', phone: [] }
      : { label: 'New menu', key: 'none', phone: [], panel: { title: '', text: '', all: { label: '', href: '' }, links: [{ title: '', desc: '', href: '' }], feature: null, prompt: '', pills: [] } };
    setItems([...items, next]); setSel(items.length);
  };
  const dropTo = (to: number) => { if (drag === null) return; const from = drag; setItems(move(items, from, to)); if (idx === from) setSel(to); setDrag(null); setOver(null); };

  const phoneRows = [...items.map((x) => ({ label: x.label, sub: x.panel ? (x.phone.length ? x.phone : x.panel.links.map((l) => ({ label: l.title, href: l.href }))) : null })), ...m.header.phoneExtra.map((x) => ({ label: x.label, sub: null }))];

  return <div className="mn">
    <datalist id="mn-pages">{v.pages.map((p) => <option key={p.file} value={p.file}>{p.title}</option>)}</datalist>

    <div className="mn-head">
      <div className="mn-head-t">
        <h1>Menus</h1>
        <span className="pills">{v.revision && status !== 'published' && <LiveBadge />}<Badge s={status} /></span>
        <span className={`mn-save${dirty ? ' dirty' : ''}`} role="status">{busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : v.pending ? `${diff.length || 'Some'} change${diff.length === 1 ? '' : 's'} not on the website yet` : 'Same as the website'}</span>
      </div>
      <div className="mn-actions">
        {(diff.length > 0) && <button className="btn btn-ghost" onClick={() => setDialog('review')}><Icon n="log" />What changed</button>}
        {editable && (dirty || v.pending) && <button className="btn btn-ghost" disabled={!!busy} onClick={dirty ? () => take(v) : discard}>{dirty ? 'Undo edits' : 'Discard draft'}</button>}
        {editable && dirty && <button className="btn btn-primary" disabled={!!busy} onClick={save} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {editable && !dirty && v.pending && ['draft', 'changes_requested'].includes(status) && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit', 'Sent for review')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('page.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}><Icon n="undo" />Withdraw</button>}
        {status === 'in_review' && can('page.approve') && <><button className="btn" disabled={!!busy} onClick={() => setDialog('changes')}>Request changes</button>
          <button className="btn btn-primary" disabled={!!busy || selfReview} title={selfReview ? 'Someone other than the author must review' : undefined} onClick={() => act('approve', 'Approved')}><Icon n="check" />Approve</button></>}
        {status === 'approved' && can('page.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}>Withdraw</button>}
        {status === 'approved' && can('page.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="globe" />Publish…</button>}
      </div>
    </div>
    <p className="mn-meta muted">The website’s main menu, phone menu and footer links. Changes stay in Studio until they are reviewed and published; the design does not change. {v.revision && v.publishedAt ? `Last published ${fmtDate(v.publishedAt)}.` : ''}{v.updatedAt ? ` Edited ${ago(v.updatedAt)}${v.updatedByName ? ` by ${v.updatedByName}` : ''}.` : ''}</p>

    {status === 'changes_requested' && <div className="notice n-warn"><div>A reviewer asked for changes. Update the menus, then send them for review again.</div></div>}
    {(status === 'in_review' || status === 'approved') && <div className="notice n-info"><div>{status === 'in_review' ? 'The menus are in review, so they are read-only.' : 'Approved and ready to publish.'} Withdraw them to make more edits.</div></div>}
    {errs.length > 0 && <div className="notice n-bad" role="alert"><div><b>Fix these before saving:</b><ul>{errs.map((e, i) => <li key={i}>{e.path ? <><span className="mono">{e.path}</span>: </> : null}{e.message}</li>)}</ul></div></div>}

    <div className="seg mn-tabs" role="tablist" aria-label="Menu">
      <button role="tab" aria-selected={tab === 'header'} className={tab === 'header' ? 'on' : ''} onClick={() => setTab('header')}><Icon n="menu" width={15} height={15} />Main menu</button>
      <button role="tab" aria-selected={tab === 'footer'} className={tab === 'footer' ? 'on' : ''} onClick={() => setTab('footer')}><Icon n="layers" width={15} height={15} />Footer</button>
    </div>

    {tab === 'header' && <div className="mn-grid">
      <aside className="mn-side">
        <section className="card mn-list">
          <div className="mn-list-h"><b>Menu items</b><span className="muted">{items.length} / 9 · drag to reorder</span></div>
          <ol>{items.map((x, i) => <li key={i} className={`${i === idx ? 'on' : ''}${over === i && drag !== null && drag !== i ? ' over' : ''}${drag === i ? ' dragging' : ''}`}
            draggable={editable} onDragStart={() => setDrag(i)} onDragEnd={() => { setDrag(null); setOver(null); }} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDrop={(e) => { e.preventDefault(); dropTo(i); }}>
            {editable && <span className="mn-grip" aria-hidden="true">⋮⋮</span>}
            <button type="button" className="mn-item" onClick={() => setSel(i)} aria-current={i === idx}>
              <span className="min-w-0"><b>{x.label || 'Untitled'}</b><small>{x.panel ? `Dropdown · ${x.panel.links.length} link${x.panel.links.length === 1 ? '' : 's'}` : x.href || 'No link yet'}</small></span>
              {x.panel && <Icon n="chev" width={12} height={12} style={{ transform: 'rotate(90deg)', color: 'var(--faint)' }} />}
            </button>
            {editable && <RowActs i={i} n={items.length} noun={x.label} canRemove={items.length > 1} onMove={(to) => { setItems(move(items, i, to)); if (idx === i) setSel(to); }}
              onRemove={() => { if (confirm(`Remove “${x.label}” from the menu?`)) { setItems(items.filter((_, j) => j !== i)); setSel(Math.max(0, i - 1)); } }} />}
          </li>)}</ol>
          {editable && items.length < 9 && <div className="mn-add-row"><button type="button" className="btn btn-sm" onClick={() => addItem('link')}><Icon n="plus" />Link</button><button type="button" className="btn btn-sm" onClick={() => addItem('dropdown')}><Icon n="plus" />Dropdown</button></div>}
          <div className="mn-list-sep">Also in the menu</div>
          <button type="button" className={`mn-special${sel === 'cta' ? ' on' : ''}`} onClick={() => setSel('cta')}><span className="mn-cta-chip">{m.header.cta.label || 'Button'} ↗</span><span className="min-w-0"><b>Main button</b><small>{m.header.cta.href || 'No link yet'}</small></span></button>
          <button type="button" className={`mn-special${sel === 'phone' ? ' on' : ''}`} onClick={() => setSel('phone')}><Icon n="phone" width={16} height={16} /><span className="min-w-0"><b>Phone-only links</b><small>{m.header.phoneExtra.length ? m.header.phoneExtra.map((x) => x.label).join(', ') : 'None'}</small></span></button>
        </section>
      </aside>

      <div className="mn-main">
        <section className="card mn-preview" aria-label="Preview">
          <div className="mn-preview-h"><span className="mn-cap">Preview</span>
            <div className="seg" role="tablist" aria-label="Preview size">
              <button role="tab" aria-selected={view === 'desktop'} className={view === 'desktop' ? 'on' : ''} onClick={() => setView('desktop')}><Icon n="monitor" width={14} height={14} />Desktop</button>
              <button role="tab" aria-selected={view === 'phone'} className={view === 'phone' ? 'on' : ''} onClick={() => setView('phone')}><Icon n="phone" width={14} height={14} />Phone</button>
            </div></div>
          {view === 'desktop' ? <>
            <div className="mn-bar">
              <span className="mn-logo">AFCD</span>
              <span className="mn-capsule">{items.map((x, i) => <button key={i} type="button" className={i === idx ? 'on' : ''} onClick={() => setSel(i)}>{x.label || 'Untitled'}{x.panel && <Icon n="chev" width={11} height={11} style={{ transform: 'rotate(90deg)' }} />}</button>)}</span>
              {m.header.cta.label && <button type="button" className={`mn-cta${sel === 'cta' ? ' on' : ''}`} onClick={() => setSel('cta')}>{m.header.cta.label} ↗</button>}
            </div>
            {it?.panel && <div className="mn-mega" aria-label={`Preview of the ${it.label} dropdown`}>
              <div className="mn-mega-intro"><span className="mn-k">{two(hdrNum[idx])} / {it.label}</span><b>{it.panel.title || 'Dropdown title'}</b><p>{it.panel.text}</p>{it.panel.all.label && <span className="mn-all">{it.panel.all.label} ↗</span>}</div>
              <ul className="mn-mega-links">{it.panel.links.map((l, i) => <li key={i}><span className="mn-badge sm">{l.dot ? <i style={{ background: l.dot }} /> : two(i + 1)}</span><span><b>{l.title || 'Link title'}</b><small>{l.desc}</small></span></li>)}</ul>
              {it.panel.feature ? <div className="mn-mega-feat"><span className="mn-ph">Photo · {it.panel.feature.photo || it.panel.feature.title}</span><span className="mn-k">{it.panel.feature.kicker}</span><b>{it.panel.feature.title} ↗</b></div> : <div />}
              {it.panel.pills.length > 0 && <div className="mn-mega-bar"><span>{it.panel.prompt}</span><span>{it.panel.pills.map((p, i) => <em key={i}>{p.label} ↗</em>)}</span></div>}
            </div>}
          </> : <div className="mn-phone">
            <div className="mn-phone-f">
              <div className="mn-phone-top"><span className="mn-logo">AFCD</span><span className="mn-x">×</span></div>
              {phoneRows.map((r, i) => <div key={i} className={`mn-prow${i === idx ? ' on' : ''}`}><span>{r.label || 'Untitled'}</span>{r.sub && <em>+</em>}
                {r.sub && i === idx && <div className="mn-psub">{r.sub.map((s, j) => <span key={j}>{s.label}</span>)}</div>}</div>)}
              {m.header.cta.label && <div className="mn-phone-cta">{m.header.cta.label}</div>}
            </div>
            <p className="muted">Select an item to open its phone links here.</p>
          </div>}
        </section>

        <section className="card mn-edit">
          <fieldset disabled={!editable}>
            {sel === 'cta' && <>
              <div className="mn-edit-h"><div><h2>Main button</h2><p className="muted">The black button at the end of the menu, and at the bottom of the phone menu.</p></div></div>
              <div className="mn-row2">
                <label className="field"><span>Label</span><input className="input" value={m.header.cta.label} maxLength={30} placeholder="e.g. Get Involved" onChange={(e) => setM({ ...m, header: { ...m.header, cta: { ...m.header.cta, label: e.target.value } } })} /></label>
                <div className="field"><span>Goes to</span><Href value={m.header.cta.href} pages={v.pages} label="Main button link" onChange={(h) => setM({ ...m, header: { ...m.header, cta: { ...m.header.cta, href: h } } })} /></div>
              </div>
            </>}
            {sel === 'phone' && <>
              <div className="mn-edit-h"><div><h2>Phone-only links</h2><p className="muted">Shown in the phone menu after the main items, for links that do not need a place in the desktop menu (e.g. Contact).</p></div></div>
              <Links rows={m.header.phoneExtra} pages={v.pages} max={6} noun="link" disabled={!editable} onChange={(r) => setM({ ...m, header: { ...m.header, phoneExtra: r } })} />
            </>}
            {it && <>
              <div className="mn-edit-h">
                <div><span className="mn-k">Item {idx + 1} of {items.length}</span><h2>{it.label || 'Untitled'}</h2></div>
                <div className="seg" role="radiogroup" aria-label="Type">
                  <button type="button" role="radio" aria-checked={!it.panel} className={!it.panel ? 'on' : ''} onClick={() => it.panel && setIt({ panel: undefined, href: it.panel.all.href || it.panel.links[0]?.href || '' })}>Link</button>
                  <button type="button" role="radio" aria-checked={!!it.panel} className={it.panel ? 'on' : ''} onClick={() => !it.panel && setIt({ panel: { title: '', text: '', all: { label: '', href: it.href ?? '' }, links: [{ title: it.label, desc: '', href: it.href ?? '' }], feature: null, prompt: '', pills: [] }, href: undefined })}>Dropdown</button>
                </div>
              </div>
              <div className="mn-row2">
                <label className="field"><span>Label in the menu</span><input className="input" value={it.label} maxLength={40} onChange={(e) => setIt({ label: e.target.value })} /></label>
                <label className="field"><span>Highlighted on</span><select className="select" value={it.key} onChange={(e) => setIt({ key: e.target.value })}>{v.navKeys.map((k) => <option key={k} value={k}>{KEY_LABEL[k] ?? k}</option>)}</select></label>
              </div>
              {!it.panel && <div className="field"><span>Goes to</span><Href value={it.href ?? ''} pages={v.pages} label="Link" onChange={(h) => setIt({ href: h })} /></div>}

              {it.panel && <div className="mn-groups">
                <Group title="Intro" summary={it.panel.title || 'No title yet'} open={!!open.intro} onToggle={() => toggle('intro')}>
                  <label className="field"><span>Title</span><input className="input" value={it.panel.title} maxLength={80} onChange={(e) => setPanel({ title: e.target.value })} placeholder="e.g. Local roots. Shared purpose." /></label>
                  <label className="field"><span>Short text</span><textarea className="textarea" rows={2} value={it.panel.text} maxLength={200} onChange={(e) => setPanel({ text: e.target.value.replace(/\n/g, ' ') })} /></label>
                  <div className="mn-row2">
                    <label className="field"><span>“See all” link label</span><input className="input" value={it.panel.all.label} maxLength={40} placeholder="e.g. About AFCD" onChange={(e) => setPanel({ all: { ...it.panel!.all, label: e.target.value } })} /></label>
                    <div className="field"><span>“See all” goes to</span><Href value={it.panel.all.href} pages={v.pages} label="See all link" onChange={(h) => setPanel({ all: { ...it.panel!.all, href: h } })} /></div>
                  </div>
                </Group>

                <Group title="Links" summary={`${it.panel.links.length} of 8`} open={!!open.links} onToggle={() => toggle('links')}>
                  <p className="mn-help">Numbered automatically. Click a badge to show a colour dot instead (as for the pillars).</p>
                  <div className="mn-plinks">{it.panel.links.map((l, i) => <div key={i} className="mn-plink">
                    <DotBadge n={i + 1} dot={l.dot} disabled={!editable} onChange={(d) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? (d ? { ...x, dot: d } : { title: x.title, desc: x.desc, href: x.href }) : x)) })} />
                    <div className="mn-plink-f">
                      <input className="input" value={l.title} maxLength={60} placeholder="Title" aria-label={`Link ${i + 1} title`} onChange={(e) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                      <input className="input" value={l.desc} maxLength={120} placeholder="One-line description" aria-label={`Link ${i + 1} description`} onChange={(e) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })} />
                      <Href value={l.href} pages={v.pages} label={`Link ${i + 1} address`} onChange={(h) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, href: h } : x)) })} />
                    </div>
                    {editable && <RowActs i={i} n={it.panel!.links.length} noun={`link ${i + 1}`} canRemove={it.panel!.links.length > 1} onMove={(to) => setPanel({ links: move(it.panel!.links, i, to) })} onRemove={() => setPanel({ links: it.panel!.links.filter((_, j) => j !== i) })} />}
                  </div>)}</div>
                  {editable && it.panel.links.length < 8 && <button type="button" className="btn btn-sm mn-add" onClick={() => setPanel({ links: [...it.panel!.links, { title: '', desc: '', href: '' }] })}><Icon n="plus" />Add link</button>}
                </Group>

                <Group title="Featured card" summary={it.panel.feature ? it.panel.feature.title || 'Untitled card' : 'None'} open={!!open.feature} onToggle={() => toggle('feature')}>
                  {it.panel.feature ? <>
                    <div className="mn-row2">
                      <label className="field"><span>Small label</span><input className="input" value={it.panel.feature.kicker} maxLength={40} placeholder="e.g. Featured project" onChange={(e) => setPanel({ feature: { ...it.panel!.feature!, kicker: e.target.value } })} /></label>
                      <label className="field"><span>Photo placeholder</span><input className="input" value={it.panel.feature.photo} maxLength={80} placeholder="What the photo shows" onChange={(e) => setPanel({ feature: { ...it.panel!.feature!, photo: e.target.value } })} /></label>
                    </div>
                    <label className="field"><span>Title</span><input className="input" value={it.panel.feature.title} maxLength={90} onChange={(e) => setPanel({ feature: { ...it.panel!.feature!, title: e.target.value } })} /></label>
                    <div className="field"><span>Goes to</span><Href value={it.panel.feature.href} pages={v.pages} label="Featured card link" onChange={(h) => setPanel({ feature: { ...it.panel!.feature!, href: h } })} /></div>
                    {editable && <button type="button" className="btn btn-sm btn-ghost mn-add" onClick={() => setPanel({ feature: null })}><Icon n="x" />Remove the featured card</button>}
                  </> : editable ? <button type="button" className="btn btn-sm mn-add" onClick={() => setPanel({ feature: { photo: '', kicker: '', title: '', href: '' } })}><Icon n="plus" />Add a featured card</button> : <p className="mn-empty">No featured card.</p>}
                </Group>

                <Group title="Action bar" summary={it.panel.pills.length ? `${it.panel.pills.length} button${it.panel.pills.length === 1 ? '' : 's'}` : 'None'} open={!!open.pills} onToggle={() => toggle('pills')}>
                  <label className="field"><span>Prompt</span><input className="input" value={it.panel.prompt} maxLength={80} placeholder="e.g. Want to be part of it?" onChange={(e) => setPanel({ prompt: e.target.value })} /></label>
                  <Links rows={it.panel.pills} pages={v.pages} max={4} noun="button" disabled={!editable} onChange={(r) => setPanel({ pills: r })} />
                </Group>

                <Group title="Phone menu" summary={`${(it.phone.length || it.panel.links.length)} link${(it.phone.length || it.panel.links.length) === 1 ? '' : 's'}${it.phone.length ? '' : ' · same as the dropdown'}`} open={!!open.phone} onToggle={() => toggle('phone')}>
                  <p className="mn-help">What “{it.label}” shows when it is opened on a phone.</p>
                  <Links rows={it.phone} pages={v.pages} max={12} noun="phone link" disabled={!editable} onChange={(r) => setIt({ phone: r })} />
                  {editable && <button type="button" className="btn btn-sm btn-ghost mn-add" onClick={() => setIt({ phone: [...(it.panel!.all.href ? [{ label: 'Overview', href: it.panel!.all.href }] : []), ...it.panel!.links.map((l) => ({ label: l.title, href: l.href }))] })}><Icon n="undo" />Same as the dropdown links</button>}
                </Group>
              </div>}
            </>}
          </fieldset>
        </section>
      </div>
    </div>}

    {tab === 'footer' && <>
      <section className="card mn-foot-prev" aria-label="Footer preview">
        <span className="mn-cap">Preview · footer</span>
        <div className="mn-foot-dark">{m.footer.columns.map((c, i) => <div key={i}><span className="mn-fh"><em>{two(i + 1)}</em>{c.title}</span>{c.links.map((l, j) => <span key={j} className="mn-fl">{l.dot && <i style={{ background: l.dot }} />}{l.label || 'Link'}</span>)}</div>)}
          <div className="mn-fc"><span className="mn-fh"><em>{two(m.footer.columns.length + 1)}</em>Contact</span><span className="mn-fl muted">As written in the site design</span></div></div>
      </section>
      <div className="mn-foot">
        {m.footer.columns.map((c, ci) => <section key={ci} className="card mn-col">
          <div className="mn-col-h"><span className="mn-k">{two(ci + 1)}</span><input className="input" value={c.title} disabled={!editable} maxLength={40} aria-label={`Footer column ${ci + 1} title`} onChange={(e) => setM({ ...m, footer: { columns: m.footer.columns.map((x, j) => (j === ci ? { ...x, title: e.target.value } : x)) } })} /></div>
          <Links rows={c.links} pages={v.pages} max={10} noun="link" dots disabled={!editable} onChange={(r) => setM({ ...m, footer: { columns: m.footer.columns.map((x, j) => (j === ci ? { ...x, links: r } : x)) } })} />
        </section>)}
      </div>
    </>}

    {dialog === 'review' && <Modal size="sm" title="What changed since the website" onClose={() => setDialog(null)} footer={<button className="btn" onClick={() => setDialog(null)}>Close</button>}>
      <div className="modal-b">{dirty && <p className="muted" style={{ marginTop: 0 }}>Includes edits that are not saved yet.</p>}<ul className="mn-diff">{diff.map((d, i) => <li key={i}>{d}</li>)}</ul></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', 'Changes requested')}>Send to author</button></>}>
      <div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish the menus" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'publish'} onClick={publish}>{busy === 'publish' ? 'Publishing and checking…' : 'Publish to the website'}</button></>}>
      <div className="modal-b"><p style={{ marginTop: 0 }}>Every page is rebuilt with these menus and checked before anything is recorded. If the build or the check fails, the site is restored.</p>{diff.length > 0 && <><b style={{ fontSize: 13 }}>Changes</b><ul className="mn-diff">{diff.map((d, i) => <li key={i}>{d}</li>)}</ul></>}</div></Modal>}
  </div>;
}
