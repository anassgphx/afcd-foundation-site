// Menus: the website's main menu (desktop dropdowns and phone menu), its main button and the footer link columns.
// Edits are drafts; the site changes only after review and publishing (the design itself stays in the site's partials).
import { useEffect, useMemo, useState } from 'react';
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
type View = { status: string; draft: Menu; revision: string | null; publishedAt: string | null; updatedAt: string | null; updatedByName: string | null; submittedBy: string | null; pending: boolean; linkIssues: { path: string; message: string }[]; pages: { file: string; title: string }[]; navKeys: string[] };

const KEY_LABEL: Record<string, string> = { none: 'No highlight', home: 'Homepage', about: 'About pages', pillars: 'Pillar pages', projects: 'Project pages', news: 'News & Stories', events: 'Events', partners: 'Partners', contact: 'Contact', involved: 'Get Involved' };
const two = (n: number) => String(n).padStart(2, '0');
const move = <T,>(a: T[], i: number, d: number) => { const n = [...a]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; };

/** A link field: suggests the site's pages and shows the page it points to. */
function Href({ value, onChange, pages, label, disabled }: { value: string; onChange: (v: string) => void; pages: View['pages']; label: string; disabled?: boolean }) {
  const page = pages.find((p) => p.file === value.split('#')[0]);
  const ext = /^https:\/\//.test(value);
  return <div className="mn-href">
    <input className="input mono" list="mn-pages" value={value} disabled={disabled} placeholder="about.html or https://…" aria-label={label} onChange={(e) => onChange(e.target.value.trim())} />
    <small className={value && !page && !ext && !/^(#|mailto:|tel:)/.test(value) ? 'bad' : ''}>{!value ? 'Choose a page or paste a link' : page ? `→ ${page.title}${value.includes('#') ? ` · section ${value.split('#')[1]}` : ''}` : ext ? '→ External site (opens their page)' : /^(#|mailto:|tel:)/.test(value) ? '→ Section, email or phone link' : 'Not a page of this site'}</small>
  </div>;
}

/** Rows of { label, href } with reorder and remove. */
function Links({ rows, onChange, pages, max, noun, disabled, dots }: { rows: (Link & { dot?: string })[]; onChange: (r: (Link & { dot?: string })[]) => void; pages: View['pages']; max: number; noun: string; disabled?: boolean; dots?: boolean }) {
  return <div className="mn-links">
    {rows.map((r, i) => <div key={i} className="mn-link">
      {dots && <input type="color" className="mn-dot" value={r.dot ?? '#e7e5e4'} disabled={disabled} aria-label={`${noun} ${i + 1} colour`} title="Dot colour (pillars)" onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, dot: e.target.value } : x)))} />}
      <input className="input" value={r.label} disabled={disabled} maxLength={60} placeholder="Label" aria-label={`${noun} ${i + 1} label`} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
      <Href value={r.href} pages={pages} disabled={disabled} label={`${noun} ${i + 1} link`} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, href: v } : x)))} />
      {!disabled && <span className="mn-row-acts">
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => onChange(move(rows, i, -1))}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(-90deg)' }} /></button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => onChange(move(rows, i, 1))}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(90deg)' }} /></button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon n="x" width={13} height={13} /></button>
      </span>}
    </div>)}
    {!disabled && rows.length < max && <button type="button" className="btn btn-sm mn-add" onClick={() => onChange([...rows, { label: '', href: '' }])}><Icon n="plus" />Add {noun}</button>}
  </div>;
}

export function MenusPage() {
  const toast = useToast(); const can = useCan(); const me = useMe();
  const [v, setV] = useState<View | null>(null); const [m, setM] = useState<Menu | null>(null);
  const [tab, setTab] = useState<'header' | 'footer'>('header'); const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<{ path: string; message: string }[]>([]);
  const [dialog, setDialog] = useState<'changes' | 'publish' | null>(null); const [comment, setComment] = useState('');
  const take = (x: View) => { setV(x); setM(structuredClone(x.draft)); setErrs([]); };
  useEffect(() => { api<View>('/menus').then(take).catch((e) => toast(e.message, true)); }, []);
  const dirty = !!v && !!m && JSON.stringify(m) !== JSON.stringify(v.draft);
  useDirtyGuard(dirty);
  const hdrNum = useMemo(() => { let n = 0; return (m?.header.items ?? []).map((it) => (it.panel ? ++n : 0)); }, [m]);
  if (!v || !m) return <Loading />;

  const status = v.status; const editable = can('page.update') && !['in_review', 'approved'].includes(status);
  const items = m.header.items; const it = items[Math.min(sel, items.length - 1)];
  const setItems = (next: Item[]) => setM({ ...m, header: { ...m.header, items: next } });
  const setIt = (patch: Partial<Item>) => setItems(items.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
  const setPanel = (patch: Partial<Panel>) => it.panel && setIt({ panel: { ...it.panel, ...patch } });
  const selfReview = v.submittedBy === me.user.id && me.user.role !== 'super_admin';

  async function run(label: string, fn: () => Promise<void>, done: string) {
    setBusy(label); setErrs([]);
    try { await fn(); setDialog(null); setComment(''); toast(done); }
    catch (e) { setDialog(null); if (e instanceof ApiError && e.details?.length) setErrs(e.details as { path: string; message: string }[]); toast((e as Error).message, true); }
    finally { setBusy(''); }
  }
  const save = () => run('save', async () => take(await put<View>('/menus', m)), 'Draft saved. The website changes only after review and publishing.');
  const act = (action: string, done: string) => run(action, async () => { if (dirty) take(await put<View>('/menus', m)); take(await post<View>('/menus/transition', { action, comment })); }, done);
  const publish = () => run('publish', async () => { await post('/menus/publish'); take(await api<View>('/menus')); }, 'Menus published and checked on every page');
  const discard = () => { if (!confirm('Discard all menu changes and go back to what the website shows?')) return; run('discard', async () => take(await post<View>('/menus/discard')), 'Back to the published menus'); };
  const addItem = (kind: 'link' | 'dropdown') => {
    const next: Item = kind === 'link' ? { label: 'New link', key: 'none', href: '', phone: [] }
      : { label: 'New menu', key: 'none', phone: [], panel: { title: '', text: '', all: { label: '', href: '' }, links: [{ title: '', desc: '', href: '' }], feature: null, prompt: '', pills: [] } };
    setItems([...items, next]); setSel(items.length);
  };

  return <div className="mn">
    <datalist id="mn-pages">{v.pages.map((p) => <option key={p.file} value={p.file}>{p.title}</option>)}</datalist>
    <div className="page-h">
      <div><h1>Menus</h1><p>The website’s main menu, phone menu and footer links. Changes are drafts until they are reviewed and published; the design stays the same.</p></div>
      <div className="mn-actions">
        <span className="pills">{v.revision && status !== 'published' && <LiveBadge />}<Badge s={status} /></span>
        <span className={`mn-save${dirty ? ' dirty' : ''}`}>{dirty ? 'Unsaved changes' : v.pending ? 'Draft differs from the website' : 'Same as the website'}</span>
        {editable && (dirty || v.pending) && <button className="btn btn-ghost" disabled={!!busy} onClick={dirty ? () => take(v) : discard}>{dirty ? 'Undo edits' : 'Discard draft'}</button>}
        {editable && dirty && <button className="btn btn-primary" disabled={!!busy} onClick={save}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {editable && !dirty && v.pending && ['draft', 'changes_requested'].includes(status) && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit', 'Sent for review')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('page.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}><Icon n="undo" />Withdraw</button>}
        {status === 'in_review' && can('page.approve') && <><button className="btn" disabled={!!busy} onClick={() => setDialog('changes')}>Request changes</button>
          <button className="btn btn-primary" disabled={!!busy || selfReview} title={selfReview ? 'Someone other than the author must review' : undefined} onClick={() => act('approve', 'Approved')}><Icon n="check" />Approve</button></>}
        {status === 'approved' && can('page.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}>Withdraw</button>}
        {status === 'approved' && can('page.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="globe" />Publish…</button>}
      </div>
    </div>

    {status === 'changes_requested' && <div className="notice n-warn"><div>A reviewer asked for changes. Update the menus, then send them for review again.</div></div>}
    {(status === 'in_review' || status === 'approved') && <div className="notice n-info"><div>{status === 'in_review' ? 'The menus are in review, so they are read-only.' : 'Approved and ready to publish.'} Withdraw them to make more edits.</div></div>}
    {errs.length > 0 && <div className="notice n-bad" role="alert"><div><b>Fix these before saving:</b><ul>{errs.map((e, i) => <li key={i}>{e.path ? <><span className="mono">{e.path}</span>: </> : null}{e.message}</li>)}</ul></div></div>}
    <p className="mn-meta muted">{v.revision ? `Published ${v.publishedAt ? fmtDate(v.publishedAt) : ''}` : 'The website shows the menus written in its design files.'}{v.updatedAt ? ` · last edit ${ago(v.updatedAt)}${v.updatedByName ? ` by ${v.updatedByName}` : ''}` : ''}</p>

    <div className="seg mn-tabs" role="tablist" aria-label="Menu">
      <button role="tab" aria-selected={tab === 'header'} className={tab === 'header' ? 'on' : ''} onClick={() => setTab('header')}><Icon n="menu" width={15} height={15} />Main menu</button>
      <button role="tab" aria-selected={tab === 'footer'} className={tab === 'footer' ? 'on' : ''} onClick={() => setTab('footer')}><Icon n="layers" width={15} height={15} />Footer</button>
    </div>

    {tab === 'header' && <>
      <section className="card mn-preview" aria-label="Preview of the menu bar">
        <span className="mn-cap">Preview · desktop menu</span>
        <div className="mn-bar">
          <span className="mn-logo">AFCD</span>
          <span className="mn-capsule">{items.map((x, i) => <button key={i} type="button" className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>{x.label || 'Untitled'}{x.panel && <Icon n="chev" width={11} height={11} style={{ transform: 'rotate(90deg)' }} />}</button>)}</span>
          {m.header.cta.label && <span className="mn-cta">{m.header.cta.label} ↗</span>}
        </div>
        {it?.panel && <div className="mn-mega" aria-label={`Preview of the ${it.label} dropdown`}>
          <div className="mn-mega-intro"><span className="mn-k">{two(hdrNum[sel])} / {it.label}</span><b>{it.panel.title || 'Dropdown title'}</b><p>{it.panel.text}</p>{it.panel.all.label && <span className="mn-all">{it.panel.all.label} ↗</span>}</div>
          <ul className="mn-mega-links">{it.panel.links.map((l, i) => <li key={i}><span className="mn-badge">{l.dot ? <i style={{ background: l.dot }} /> : two(i + 1)}</span><span><b>{l.title || 'Link title'}</b><small>{l.desc}</small></span></li>)}</ul>
          {it.panel.feature && <div className="mn-mega-feat"><span className="mn-ph">Photo · {it.panel.feature.photo || it.panel.feature.title}</span><span className="mn-k">{it.panel.feature.kicker}</span><b>{it.panel.feature.title} ↗</b></div>}
          {it.panel.pills.length > 0 && <div className="mn-mega-bar"><span>{it.panel.prompt}</span><span>{it.panel.pills.map((p, i) => <em key={i}>{p.label} ↗</em>)}</span></div>}
        </div>}
      </section>

      <div className="mn-grid">
        <aside className="card mn-list">
          <div className="mn-list-h"><b>Menu items</b><span className="muted">{items.length} / 9</span></div>
          <ol>{items.map((x, i) => <li key={i} className={i === sel ? 'on' : ''}>
            <button type="button" className="mn-item" onClick={() => setSel(i)} aria-current={i === sel}>
              <span className="mn-item-n">{i + 1}</span><span className="min-w-0"><b>{x.label || 'Untitled'}</b><small>{x.panel ? `Dropdown · ${x.panel.links.length} link${x.panel.links.length === 1 ? '' : 's'}` : x.href || 'No link yet'}</small></span>
            </button>
            {editable && <span className="mn-row-acts">
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${x.label} up`} disabled={i === 0} onClick={() => { setItems(move(items, i, -1)); setSel(i - 1); }}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(-90deg)' }} /></button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${x.label} down`} disabled={i === items.length - 1} onClick={() => { setItems(move(items, i, 1)); setSel(i + 1); }}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(90deg)' }} /></button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove ${x.label}`} disabled={items.length === 1} onClick={() => { if (confirm(`Remove “${x.label}” from the menu?`)) { setItems(items.filter((_, j) => j !== i)); setSel(Math.max(0, i - 1)); } }}><Icon n="x" width={13} height={13} /></button>
            </span>}
          </li>)}</ol>
          {editable && items.length < 9 && <div className="mn-add-row"><button type="button" className="btn btn-sm" onClick={() => addItem('link')}><Icon n="plus" />Link</button><button type="button" className="btn btn-sm" onClick={() => addItem('dropdown')}><Icon n="plus" />Dropdown</button></div>}
          <div className="mn-side-sec">
            <b>Main button</b><small className="muted">The black button at the end of the menu, also at the bottom of the phone menu.</small>
            <input className="input" value={m.header.cta.label} disabled={!editable} maxLength={30} placeholder="Label" aria-label="Main button label" onChange={(e) => setM({ ...m, header: { ...m.header, cta: { ...m.header.cta, label: e.target.value } } })} />
            <Href value={m.header.cta.href} pages={v.pages} disabled={!editable} label="Main button link" onChange={(h) => setM({ ...m, header: { ...m.header, cta: { ...m.header.cta, href: h } } })} />
          </div>
          <div className="mn-side-sec">
            <b>Phone menu only</b><small className="muted">Extra links shown in the phone menu after the items above.</small>
            <Links rows={m.header.phoneExtra} pages={v.pages} max={6} noun="link" disabled={!editable} onChange={(r) => setM({ ...m, header: { ...m.header, phoneExtra: r } })} />
          </div>
        </aside>

        {it && <section className="card mn-edit">
          <fieldset disabled={!editable}>
            <div className="mn-edit-h"><h2>{it.label || 'Untitled'}</h2>
              <div className="seg" role="radiogroup" aria-label="Type">
                <button type="button" role="radio" aria-checked={!it.panel} className={!it.panel ? 'on' : ''} onClick={() => it.panel && setIt({ panel: undefined, href: it.panel.all.href || it.panel.links[0]?.href || '' })}>Link</button>
                <button type="button" role="radio" aria-checked={!!it.panel} className={it.panel ? 'on' : ''} onClick={() => !it.panel && setIt({ panel: { title: '', text: '', all: { label: '', href: it.href ?? '' }, links: [{ title: it.label, desc: '', href: it.href ?? '' }], feature: null, prompt: '', pills: [] }, href: undefined })}>Dropdown</button>
              </div>
            </div>
            <div className="mn-row2">
              <label className="field"><span>Label in the menu</span><input className="input" value={it.label} maxLength={40} onChange={(e) => setIt({ label: e.target.value })} /></label>
              <label className="field"><span>Highlighted on</span><select className="select" value={it.key} onChange={(e) => setIt({ key: e.target.value })}>{v.navKeys.map((k) => <option key={k} value={k}>{KEY_LABEL[k] ?? k}</option>)}</select></label>
            </div>
            {!it.panel && <label className="field"><span>Goes to</span><Href value={it.href ?? ''} pages={v.pages} label="Link" onChange={(h) => setIt({ href: h })} /></label>}

            {it.panel && <>
              <h3 className="mn-h3">Intro <small>left side of the dropdown</small></h3>
              <label className="field"><span>Title</span><input className="input" value={it.panel.title} maxLength={80} onChange={(e) => setPanel({ title: e.target.value })} placeholder="e.g. Local roots. Shared purpose." /></label>
              <label className="field"><span>Short text</span><textarea className="textarea" rows={2} value={it.panel.text} maxLength={200} onChange={(e) => setPanel({ text: e.target.value.replace(/\n/g, ' ') })} /></label>
              <div className="mn-row2">
                <label className="field"><span>“See all” link label</span><input className="input" value={it.panel.all.label} maxLength={40} placeholder="e.g. About AFCD" onChange={(e) => setPanel({ all: { ...it.panel!.all, label: e.target.value } })} /></label>
                <label className="field"><span>“See all” goes to</span><Href value={it.panel.all.href} pages={v.pages} label="See all link" onChange={(h) => setPanel({ all: { ...it.panel!.all, href: h } })} /></label>
              </div>

              <h3 className="mn-h3">Links <small>{it.panel.links.length} / 8 · numbered automatically; a colour shows a dot instead (pillars)</small></h3>
              <div className="mn-plinks">{it.panel.links.map((l, i) => <div key={i} className="mn-plink">
                <span className="mn-badge">{l.dot ? <i style={{ background: l.dot }} /> : two(i + 1)}</span>
                <div className="mn-plink-f">
                  <input className="input" value={l.title} maxLength={60} placeholder="Title" aria-label={`Link ${i + 1} title`} onChange={(e) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <input className="input" value={l.desc} maxLength={120} placeholder="One-line description" aria-label={`Link ${i + 1} description`} onChange={(e) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })} />
                  <Href value={l.href} pages={v.pages} label={`Link ${i + 1} address`} onChange={(h) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, href: h } : x)) })} />
                </div>
                {editable && <span className="mn-row-acts col">
                  <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move link ${i + 1} up`} disabled={i === 0} onClick={() => setPanel({ links: move(it.panel!.links, i, -1) })}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(-90deg)' }} /></button>
                  <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move link ${i + 1} down`} disabled={i === it.panel!.links.length - 1} onClick={() => setPanel({ links: move(it.panel!.links, i, 1) })}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(90deg)' }} /></button>
                  <label className="mn-color" title="Dot colour instead of a number"><input type="color" value={l.dot ?? '#e7e5e4'} onChange={(e) => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { ...x, dot: e.target.value } : x)) })} aria-label={`Link ${i + 1} dot colour`} /></label>
                  {l.dot && <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Use a number for link ${i + 1}`} title="Use a number" onClick={() => setPanel({ links: it.panel!.links.map((x, j) => (j === i ? { title: x.title, desc: x.desc, href: x.href } : x)) })}>#</button>}
                  <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove link ${i + 1}`} disabled={it.panel!.links.length === 1} onClick={() => setPanel({ links: it.panel!.links.filter((_, j) => j !== i) })}><Icon n="x" width={13} height={13} /></button>
                </span>}
              </div>)}</div>
              {editable && it.panel.links.length < 8 && <button type="button" className="btn btn-sm mn-add" onClick={() => setPanel({ links: [...it.panel!.links, { title: '', desc: '', href: '' }] })}><Icon n="plus" />Add link</button>}

              <h3 className="mn-h3">Featured card <small>right side, optional</small></h3>
              {it.panel.feature ? <>
                <div className="mn-row2">
                  <label className="field"><span>Small label</span><input className="input" value={it.panel.feature.kicker} maxLength={40} placeholder="e.g. Featured project" onChange={(e) => setPanel({ feature: { ...it.panel!.feature!, kicker: e.target.value } })} /></label>
                  <label className="field"><span>Photo placeholder</span><input className="input" value={it.panel.feature.photo} maxLength={80} placeholder="What the photo shows" onChange={(e) => setPanel({ feature: { ...it.panel!.feature!, photo: e.target.value } })} /></label>
                </div>
                <label className="field"><span>Title</span><input className="input" value={it.panel.feature.title} maxLength={90} onChange={(e) => setPanel({ feature: { ...it.panel!.feature!, title: e.target.value } })} /></label>
                <label className="field"><span>Goes to</span><Href value={it.panel.feature.href} pages={v.pages} label="Featured card link" onChange={(h) => setPanel({ feature: { ...it.panel!.feature!, href: h } })} /></label>
                {editable && <button type="button" className="btn btn-sm btn-ghost mn-add" onClick={() => setPanel({ feature: null })}><Icon n="x" />Remove featured card</button>}
              </> : editable && <button type="button" className="btn btn-sm mn-add" onClick={() => setPanel({ feature: { photo: '', kicker: '', title: '', href: '' } })}><Icon n="plus" />Add a featured card</button>}

              <h3 className="mn-h3">Action bar <small>bottom of the dropdown, optional</small></h3>
              <label className="field"><span>Prompt</span><input className="input" value={it.panel.prompt} maxLength={80} placeholder="e.g. Want to be part of it?" onChange={(e) => setPanel({ prompt: e.target.value })} /></label>
              <Links rows={it.panel.pills} pages={v.pages} max={4} noun="button" disabled={!editable} onChange={(r) => setPanel({ pills: r })} />

              <h3 className="mn-h3">Phone menu <small>links shown when “{it.label}” is opened on a phone</small></h3>
              <Links rows={it.phone} pages={v.pages} max={12} noun="phone link" disabled={!editable} onChange={(r) => setIt({ phone: r })} />
              {editable && <button type="button" className="btn btn-sm btn-ghost mn-add" onClick={() => setIt({ phone: [...(it.panel!.all.href ? [{ label: 'Overview', href: it.panel!.all.href }] : []), ...it.panel!.links.map((l) => ({ label: l.title, href: l.href }))] })}><Icon n="undo" />Same as the dropdown links</button>}
            </>}
          </fieldset>
        </section>}
      </div>
    </>}

    {tab === 'footer' && <div className="mn-foot">
      {m.footer.columns.map((c, ci) => <section key={ci} className="card mn-col">
        <div className="mn-col-h"><span className="mn-k">{two(ci + 1)}</span><input className="input" value={c.title} disabled={!editable} maxLength={40} aria-label={`Footer column ${ci + 1} title`} onChange={(e) => setM({ ...m, footer: { columns: m.footer.columns.map((x, j) => (j === ci ? { ...x, title: e.target.value } : x)) } })} /></div>
        <Links rows={c.links} pages={v.pages} max={10} noun="link" dots disabled={!editable} onChange={(r) => setM({ ...m, footer: { columns: m.footer.columns.map((x, j) => (j === ci ? { ...x, links: r } : x)) } })} />
      </section>)}
      <p className="muted mn-foot-note">The fourth footer column (contact details) and the newsletter stay as written in the site design.</p>
    </div>}

    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', 'Changes requested')}>Send to author</button></>}>
      <div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish the menus" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'publish'} onClick={publish}>{busy === 'publish' ? 'Publishing and checking…' : 'Publish to the website'}</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>Every page is rebuilt with these menus and checked before anything is recorded. If the build or the check fails, the site is restored.</p></div></Modal>}
  </div>;
}
