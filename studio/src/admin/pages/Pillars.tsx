// Pillars: AFCD's strategic pillars and the pages built from them (Our Pillars and one page per pillar).
// One master–detail screen: every pillar on the left (add, reorder), the selected pillar's editor on the right. On a
// phone the list and the editor are separate steps. Adding, editing and removing all go through review.
import { useCallback, useEffect, useState } from 'react';
import { api, del, post, put, ApiError } from '../api.ts';
import { Icon, Link, Modal, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, ListEditor, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import '../pillars.css';

type Row = { id: string; key: string; number: string; name: string; draftName: string; short: string; summary: string; colour: string; draftColour: string; publicFile: string;
  status: string; imported: boolean; mediaId: string | null; publishedRevisionId: string | null; updatedAt: string; projects: number; sort: number; removeRequested: boolean };

/** One compact status per row: where the pillar stands on the website, and whether a newer draft is waiting. */
function StatusLine({ r }: { r: Row }) {
  if (!r.imported) return <>Content not imported yet</>;
  const live = !!r.publishedRevisionId;
  const [tone, text] = r.removeRequested ? ['warn', r.status === 'approved' ? 'Removal approved' : 'Removal in review']
    : !live ? ['new', { draft: 'New · draft', changes_requested: 'New · changes requested', in_review: 'New · in review', approved: 'New · approved' }[r.status] ?? 'New']
    : r.status === 'published' ? ['live', 'Live']
    : ['live', { draft: 'Live · edits in draft', changes_requested: 'Live · changes requested', in_review: 'Live · edits in review', approved: 'Live · edits approved' }[r.status] ?? 'Live'];
  return <><span className={`pl-st pl-st-${tone}`} aria-hidden="true" />{text}</>;
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const WIDE = '(min-width: 900px)';
function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia(WIDE).matches);
  useEffect(() => { const m = matchMedia(WIDE); const k = () => setWide(m.matches); m.addEventListener('change', k); return () => m.removeEventListener('change', k); }, []);
  return wide;
}

export function PillarsScreen({ id }: { id?: string }) {
  const can = useCan(); const toast = useToast(); const wide = useWide();
  const [rows, setRows] = useState<Row[] | null>(null); const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [key, setKey] = useState(''); const [keyEdited, setKeyEdited] = useState(false); const [err, setErr] = useState('');
  const [order, setOrder] = useState<Row[] | null>(null); const [confirmOrder, setConfirmOrder] = useState(false);
  const load = useCallback(() => api<Row[]>('/pillars/records').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  // on a wide screen the detail pane is never empty: open the first pillar
  useEffect(() => { if (wide && !id && rows?.length) { const first = rows.find((r) => r.imported); if (first) navigate(`/studio/pillars/${first.id}`); } }, [wide, id, rows]);

  async function importContent() {
    setBusy('import');
    try { const r = await post<{ imported: number }>('/pillars/import'); toast(`Imported the content of ${r.imported} pillar${r.imported === 1 ? '' : 's'} from the current website`); await load(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(''); }
  }
  async function create() {
    setErr(''); setBusy('add');
    try { const r = await post<{ id: string }>('/pillars', { name: name.trim(), key }); setAdding(false); await load(); navigate(`/studio/pillars/${r.id}`); toast('Pillar added as a draft'); }
    catch (e) { setErr(e instanceof ApiError && e.details?.length ? e.details.map((d) => d.message).join(' ') : (e as Error).message); } finally { setBusy(''); }
  }
  async function saveOrder() {
    setBusy('order');
    try { const r = await post<{ rebuilt: boolean }>('/pillars/order', { ids: order!.map((x) => x.id) }); setOrder(null); setConfirmOrder(false); await load(); toast(r.rebuilt ? 'New order published and checked on Our Pillars' : 'Order saved'); }
    catch (e) { setConfirmOrder(false); toast((e as Error).message, true); } finally { setBusy(''); }
  }
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o!]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const missing = (rows ?? []).filter((r) => !r.imported).length;
  const shown = order ?? rows ?? [];
  const liveCount = (rows ?? []).filter((r) => r.publishedRevisionId).length;

  const list = <aside className="pl-master card" aria-label="All pillars">
    <div className="pl-master-h">
      <div><h1>Pillars</h1><p className="muted">{rows ? `${liveCount} on the website${rows.length > liveCount ? ` · ${rows.length - liveCount} not yet` : ''}` : ' '}</p></div>
      {can('pillar.create') && !order && missing === 0 && <button className="btn btn-primary btn-sm" onClick={() => { setName(''); setKey(''); setKeyEdited(false); setErr(''); setAdding(true); }}><Icon n="plus" />New pillar</button>}
    </div>
    {rows && missing > 0 && <div className="notice n-info pl-master-note"><div><b>{missing === rows.length ? 'The pillar pages are still written in the site’s code.' : `${missing} pillar${missing === 1 ? ' is' : 's are'} not in Studio yet.`}</b> Import their current text to edit it here. The website stays exactly as it is until someone publishes a change.
      {can('pillar.publish') && <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={!!busy} onClick={importContent}>{busy === 'import' ? 'Importing…' : 'Import current content'}</button>}</div></div>}
    {!rows ? <Loading /> : <ol className={`pl-items${order ? ' ordering' : ''}`}>
      {shown.map((r, i) => {
        const inner = <>
          <span className="pl-item-n" style={{ background: r.draftColour }}>{order ? String(i + 1).padStart(2, '0') : r.number}</span>
          <span className="pl-item-t"><b>{r.imported ? r.draftName : r.name}</b>
            <span className="pl-item-s"><StatusLine r={r} /></span></span>
        </>;
        return <li key={r.id} className={r.id === id ? 'on' : ''}>
          {order ? <div className="pl-item">{inner}<span className="pl-item-mv">
              <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.draftName} up`}>↑</button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === shown.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${r.draftName} down`}>↓</button></span></div>
            : r.imported ? <Link className="pl-item" to={`/studio/pillars/${r.id}`} aria-current={r.id === id ? 'page' : undefined}>{inner}</Link>
            : <div className="pl-item is-off">{inner}</div>}
        </li>;
      })}
    </ol>}
    {rows && rows.length > 1 && missing === 0 && can('pillar.publish') && <div className="pl-master-f">
      {order ? <><button className="btn btn-sm" onClick={() => setOrder(null)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={order.every((r, i) => r.id === rows[i].id)} onClick={() => setConfirmOrder(true)}>Save order…</button></>
        : <button className="btn btn-ghost btn-sm" onClick={() => setOrder([...rows])}><Icon n="menu" />Change order</button>}
    </div>}
    <p className="muted pl-foot">The homepage’s pillar section is edited in <Link to="/studio/home">Homepage</Link>, and the header’s pillar links in <Link to="/studio/menus">Menus</Link>. Projects choose their pillars in their own record.</p>
  </aside>;

  return <div className={`pl-md${id ? ' has-detail' : ''}`}>
    {(wide || !id) && list}
    {id ? <div className="pl-detail"><PillarEditor key={id} id={id} onChanged={load} /></div>
      : wide && rows && <div className="pl-detail pl-empty card"><Icon n="pillars" /><p>{missing ? 'Import the current pillar content to start.' : 'Choose a pillar.'}</p></div>}

    {adding && <Modal size="sm" title="New pillar" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" disabled={name.trim().length < 2 || !key || busy === 'add'} onClick={create}>{busy === 'add' ? 'Adding…' : 'Add as draft'}</button></>}>
      <div className="modal-b stack">
        <Field label="Name" hint="You can change it later."><input className="input" autoFocus maxLength={60} value={name} onChange={(e) => { setName(e.target.value); if (!keyEdited) setKey(slugify(e.target.value)); }} aria-label="Name" /></Field>
        <Field label="Page address" hint={<>The pillar’s page will be <span className="mono">{key || '…'}.html</span>. It cannot change once the pillar is added.</>}>
          <div className="pl-addr"><input className="input mono" maxLength={60} value={key} onChange={(e) => { setKey(slugify(e.target.value)); setKeyEdited(true); }} aria-label="Page address" /><span className="mono muted">.html</span></div></Field>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>It starts as a draft. It appears on the website, and can be linked from projects, stories and events, once it is reviewed and published. Add it to the homepage and the header menu in Homepage and Menus.</p>
        {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
      </div></Modal>}
    {confirmOrder && <Modal size="sm" title="Publish the new order?" onClose={() => !busy && setConfirmOrder(false)} footer={<><button className="btn" disabled={!!busy} onClick={() => setConfirmOrder(false)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={saveOrder}><Icon n="rocket" />{busy === 'order' ? 'Publishing and checking…' : 'Publish order'}</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>Pillar numbers follow the order (“Pillar 02 / {String(rows!.length).padStart(2, '0')}”). Our Pillars and every pillar page are rebuilt and checked. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
  </div>;
}

type Step = { title: string; text: string };
type Form = { name: string; short: string; summary: string; intro: string; colour: string; brand: string; highlights: string[]; approachTitle: string; approachSoft: string;
  view: string; principles: string[]; steps: Step[]; objectives: Step[]; activities: number[]; groups: number[]; extraActivities: string[]; extraGroups: string[];
  page: Record<PageKey, string>; mediaId: string | null; provenance: string };
type PageKey = 'flagshipLabel' | 'howTitle' | 'howSoft' | 'howDesc' | 'objectivesTitle' | 'objectivesSoft' | 'objectivesDesc' | 'projectsTitle' | 'projectsSoft' | 'projectsDesc' | 'relatedTitle' | 'relatedSoft' | 'ctaTitle' | 'ctaText';
/** The page's own texts: [key, label, max length, the site's wording when left empty]. Kept in step with src/content.py. */
const pageTexts = (name: string, short: string): [string, [PageKey, string, number, string, boolean?][]][] => [
  ['Overview', [['flagshipLabel', 'Flagship programmes label', 40, 'Flagship programmes']]],
  ['How we work', [['howTitle', 'Heading', 60, 'How this pillar'], ['howSoft', 'Heading, grey part', 60, 'comes to life.'], ['howDesc', 'Description', 200, 'The steps we follow and the activities we run under this pillar.', true]]],
  ['Objectives', [['objectivesTitle', 'Heading', 60, 'What this pillar'], ['objectivesSoft', 'Heading, grey part', 60, 'aims to achieve.'], ['objectivesDesc', 'Description', 200, 'What AFCD works toward under this pillar.', true]]],
  ['Projects', [['projectsTitle', 'Heading', 60, 'Projects in'], ['projectsSoft', 'Heading, grey part', 60, `${(short || 'youth').toLowerCase()}.`], ['projectsDesc', 'Description', 200, `Programmes AFCD runs under the ${name || 'pillar’s'} pillar.`, true]]],
  ['Related', [['relatedTitle', 'Heading', 60, 'Stories and events'], ['relatedSoft', 'Heading, grey part', 60, 'from this pillar.']]],
  ['Get involved band', [['ctaTitle', 'Heading', 80, 'Find your place in our work.'], ['ctaText', 'Text', 220, 'Volunteer, join a programme when calls open, or partner with us on this pillar.', true]]],
];
type Loaded = { id: string; key: string; number: string; publicFile: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; verifiedAt: string | null; removeRequested: boolean; usage: string[];
  content: Form | null; projects: { id: string; slug: string; name: string; live: boolean; primary: boolean }[]; media: MediaItem[]; problems: string[];
  lists: { activities: string[]; groups: string[] }; colours: { value: string; label: string }[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

export function PillarEditor({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [p, setP] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [photo, setPhoto] = useState<MediaItem | null>(null);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'photo' | 'preview' | 'publish' | 'changes' | 'remove' | 'delete'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    const d = await api<Loaded>(`/pillars/${id}`);
    setP(d); setF(d.content ? structuredClone(d.content) : null); setPhoto(d.media[0] ?? null); setDirty(false); onChanged?.();
  }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!p) return <Loading />;
  if (!f) return <><EditorHeader back={{ to: '/studio/pillars', label: 'Pillars' }} title={`Pillar ${p.number}`} status="draft" live={false} dirty={false} actions={null} />
    <div className="notice n-info"><div>This pillar’s content is not in Studio yet. Import it from the <Link to="/studio/pillars">Pillars</Link> list.</div></div></>;
  const status = p.status; const live = !!p.publishedRevisionId;
  const editable = can('pillar.update') && status !== 'in_review';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x!, [k]: v })); setDirty(true); };
  function showErr(e: unknown) { setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [e instanceof Error ? e.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/pillars/${id}`, f); await load(); toast(live ? 'Draft saved. The live pages are unchanged until you publish.' : 'Draft saved'); return true; }
    catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/pillars/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', request_removal: 'Removal sent for review' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function publish() {
    setBusy('publish');
    if (p!.removeRequested) {
      try { await post(`/pillars/${id}/publish`); toast(`Removed from the website; ${p!.publicFile} now redirects to Our Pillars`); onChanged?.(); navigate('/studio/pillars'); }
      catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
      return;
    }
    try { await post(`/pillars/${id}/publish`); await load(); setDialog(null); toast(`Published and verified on ${p!.publicFile} and Our Pillars`); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deleteDraft() {
    setBusy('delete');
    try { await del(`/pillars/${id}`); toast('Draft pillar deleted'); onChanged?.(); navigate('/studio/pillars'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/pillars/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (e) { showErr(e); } finally { setBusy(''); }
  }
  const toggle = (k: 'activities' | 'groups', i: number, on: boolean) => set(k, on ? [...f[k], i] : f[k].filter((x) => x !== i));
  const setStep = (i: number, v: Partial<Step>) => set('steps', f.steps.map((s, j) => (j === i ? { ...s, ...v } : s)));
  const moveStep = (i: number, d: -1 | 1) => { const s = [...f.steps]; [s[i], s[i + d]] = [s[i + d], s[i]]; set('steps', s); };
  const setObj = (i: number, v: Partial<Step>) => set('objectives', f.objectives.map((o, j) => (j === i ? { ...o, ...v } : o)));
  const moveObj = (i: number, d: -1 | 1) => { const o = [...f.objectives]; [o[i], o[i + d]] = [o[i + d], o[i]]; set('objectives', o); };
  const colourName = p.colours.find((c) => c.value === f.colour)?.label ?? f.colour;

  return <>
    <EditorHeader back={{ to: '/studio/pillars', label: 'Pillars' }} title={f.name} file={p.publicFile} status={status} live={live} dirty={dirty}
      extra={<span className="pill"><span className="pl-dot" style={{ background: f.colour }} aria-hidden="true" />Pillar {p.number}</span>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('pillar.update') && <button className="btn btn-primary" disabled={!!busy || p.problems.length > 0} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('pillar.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />{p.removeRequested ? 'Remove from website…' : 'Publish…'}</button>}
        {can('pillar.update') && !p.removeRequested && status !== 'in_review' && <button className="btn btn-ghost btn-danger" disabled={!!busy} onClick={() => setDialog(live ? 'remove' : 'delete')} title={live ? 'Take this pillar off the website (reviewed first)' : 'Delete this draft pillar'}><Icon n="x" />{live ? 'Remove…' : 'Delete…'}</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {p.removeRequested && <div className="notice n-warn"><div><b>Removal from the website {status === 'approved' ? 'approved' : 'requested'}.</b> Publishing takes this pillar off Our Pillars, turns <span className="mono">{p.publicFile}</span> into a redirect to <span className="mono">pillars.html</span> and deletes it from Studio. Withdraw to keep it.</div></div>}
    {!live && status !== 'in_review' && !p.removeRequested && <div className="notice n-info"><div>New pillar: not on the website yet. Its page will be <span className="mono">{p.publicFile}</span>, numbered in the list order.</div></div>}
    {status === 'in_review' && !p.removeRequested && can('pillar.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Pillar', icon: 'pillars', done: !!f.name },
        { id: 'text', label: 'Summary and introduction', icon: 'log', done: !!f.summary && !!f.intro },
        { id: 'objectives', label: 'Objectives', icon: 'check', optional: true, done: f.objectives.length ? true : undefined },
        { id: 'photo', label: 'Photo', icon: 'image', optional: true, done: f.mediaId ? true : undefined },
        { id: 'work', label: 'What we do', icon: 'users', optional: true, done: f.activities.length || f.groups.length || f.extraActivities.length || f.extraGroups.length ? true : undefined },
        { id: 'approach', label: 'Our approach', icon: 'layers', done: !!f.approachTitle && f.steps.length > 0 },
        { id: 'pagetexts', label: 'Page texts', icon: 'log', optional: true, done: Object.values(f.page).some(Boolean) ? true : undefined },
        { id: 'projects', label: 'Projects', icon: 'folder', optional: true, done: f.highlights.length || p.projects.length ? true : undefined },
        { id: 'internal', label: 'Internal', icon: 'lock', optional: true },
        { id: 'translations', label: 'Translations', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
      <fieldset className="ed-main" disabled={!editable}>
        <Section id="basics" title="Pillar" desc="Its name and colour on every page of the website.">
          <Field label="Name" span={2} count={[f.name.length, 60]} hint="Also used on project pages, story tags and the strategy page."><input className="input input-lg" maxLength={60} value={f.name} onChange={(x) => set('name', x.target.value)} aria-label="Name" /></Field>
          <Field label="Short name" count={[f.short.length, 20]} hint={<>One word, as in “Projects in <i>{(f.short || 'youth').toLowerCase()}</i>.”</>}><input className="input" maxLength={20} value={f.short} onChange={(x) => set('short', x.target.value)} aria-label="Short name" /></Field>
          <Field label="Accent colour" span={3} hint="One of the four colours of the site’s design.">
            <div className="pl-swatches" role="radiogroup" aria-label="Accent colour">
              {p.colours.map((c) => <label key={c.value} className={f.colour === c.value ? 'on' : ''}><input type="radio" name="colour" checked={f.colour === c.value} onChange={() => set('colour', c.value)} /><span className="pl-sw" style={{ background: c.value }} aria-hidden="true" /><span>{c.label}</span></label>)}
            </div></Field>
          <Field label="Programme brand" count={[f.brand.length, 40]} hint="Optional tag shown on the pillar page, e.g. Green Thumbs."><input className="input" maxLength={40} value={f.brand} onChange={(x) => set('brand', x.target.value)} aria-label="Programme brand" /></Field>
          <Field label="Page address" span={2} hint="Fixed, so links to this pillar keep working.">
            <div className="pl-fixed"><span className="mono">{p.publicFile}</span><span className="muted">·</span><span className="mono">pillars.html#{p.key}</span><span className="muted">· numbered by its place in the list</span>
              {live && <a className="btn btn-sm" href={me.siteUrl + p.publicFile} target="_blank" rel="noopener"><Icon n="ext" />Open</a>}</div></Field>
        </Section>
        <Section id="text" title="Summary and introduction" desc="Plain text. The site’s typography is applied automatically.">
          <Field label="Summary" span={3} count={[f.summary.length, 320]} hint="On the Our Pillars card, in the pillar page’s coloured overview, and in its search description.">
            <textarea className="textarea" rows={3} maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value)} aria-label="Summary" /></Field>
          <Field label="Page introduction" span={3} count={[f.intro.length, 200]} hint="The line under the pillar name at the top of its page.">
            <textarea className="textarea" rows={2} maxLength={200} value={f.intro} onChange={(x) => set('intro', x.target.value)} aria-label="Page introduction" /></Field>
        </Section>
        <Section id="objectives" title="Objectives" desc="Written here for this pillar only and shown on its page in this order. Nothing is taken from AFCD’s strategy page.">
          {f.objectives.length === 0 && <p className="muted s3" style={{ margin: 0 }}>No objectives yet. Until you add some, the pillar page says its objectives are being finalised.</p>}
          {f.objectives.length > 0 && <ol className="pl-steps s3">{f.objectives.map((o, i) => <li key={i}>
            <span className="pl-step-n">{String(i + 1).padStart(2, '0')}</span>
            <div className="pl-step-f"><input className="input" maxLength={140} value={o.title} placeholder="Objective (required)" onChange={(x) => setObj(i, { title: x.target.value })} aria-label={`Objective ${i + 1}`} aria-invalid={!o.title.trim()} />
              <textarea className="textarea" rows={2} maxLength={400} value={o.text} placeholder="Short explanation (optional)" onChange={(x) => setObj(i, { text: x.target.value })} aria-label={`Objective ${i + 1} explanation`} /></div>
            <span className="pl-step-a">
              <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === 0} onClick={() => moveObj(i, -1)} aria-label={`Move objective ${i + 1} up`}>↑</button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === f.objectives.length - 1} onClick={() => moveObj(i, 1)} aria-label={`Move objective ${i + 1} down`}>↓</button>
              <button type="button" className="btn btn-ghost icon-btn btn-sm" onClick={() => set('objectives', f.objectives.filter((_, j) => j !== i))} aria-label={`Remove objective ${i + 1}`}><Icon n="x" /></button></span>
          </li>)}</ol>}
          {f.objectives.length < 6 ? <button type="button" className="btn btn-sm s3" style={{ justifySelf: 'start' }} onClick={() => set('objectives', [...f.objectives, { title: '', text: '' }])}><Icon n="plus" />Add an objective</button>
            : <p className="muted s3" style={{ margin: 0, fontSize: 12.5 }}>6 objectives is the maximum.</p>}
        </Section>
        <Section id="photo" title="Photo" desc="The big picture in the pillar page’s overview. Without one, the page shows the cover photo of this pillar’s first live project that has one. Alt text and usage rights are checked before review.">
          <div className="ed-media s3">
            {f.mediaId && photo ? <div className="ed-media-img pl-photo"><img src={photo.url} alt={photo.alt} /><button type="button" className="btn btn-sm" onClick={() => set('mediaId', null)}><Icon n="x" />Remove</button></div>
              : <button type="button" className="ed-drop" onClick={() => setDialog('photo')}><Icon n="image" /><b>Choose a photo</b><small>From the media library.</small></button>}
            {f.mediaId && photo && <div className="pl-photo-meta">
              <span className={photo.alt ? 'ok' : 'warn'}><Icon n={photo.alt ? 'check' : 'alert'} width={14} height={14} />{photo.alt ? `Alt text: “${photo.alt}”` : 'No alt text yet'}</span>
              <span className={photo.rightsConfirmed ? 'ok' : 'warn'}><Icon n={photo.rightsConfirmed ? 'check' : 'alert'} width={14} height={14} />{photo.rightsConfirmed ? 'Usage rights confirmed' : 'Usage rights not confirmed'}</span>
              <span className="pl-photo-actions"><button type="button" className="btn btn-sm" onClick={() => setDialog('photo')}><Icon n="image" />Change</button><Link className="btn btn-sm" to="/studio/media">Edit in media library</Link></span>
            </div>}
          </div>
        </Section>
        <Section id="work" title="What we do" desc="Pick from AFCD’s shared lists (the same wording on every page), then add anything only this pillar does. Numbered in the order they appear.">
          {p.lists.activities.length === 0 && <p className="muted s3" style={{ margin: 0 }}>The site’s lists could not be read.</p>}
          {p.lists.activities.length > 0 && <Field label="Activities" span={3}><div className="pl-picks">{p.lists.activities.map((a, i) => { const at = f.activities.indexOf(i); return <label key={i} className={at >= 0 ? 'on' : ''}><input type="checkbox" checked={at >= 0} onChange={(e) => toggle('activities', i, e.target.checked)} /><span className="pl-pick-n">{at >= 0 ? String(at + 1).padStart(2, '0') : ''}</span><span>{a}</span></label>; })}</div></Field>}
          {p.lists.groups.length > 0 && <Field label="Who we work with" span={3}><div className="pl-picks">{p.lists.groups.map((g, i) => { const at = f.groups.indexOf(i); return <label key={i} className={at >= 0 ? 'on' : ''}><input type="checkbox" checked={at >= 0} onChange={(e) => toggle('groups', i, e.target.checked)} /><span className="pl-pick-n">{at >= 0 ? String(at + 1).padStart(2, '0') : ''}</span><span>{g}</span></label>; })}</div></Field>}
                  <Field label="Other activities" span={3} hint="Only for this pillar. Shown after the ones picked above. Up to 6."><ListEditor value={f.extraActivities} onChange={(v) => set('extraActivities', v)} label="Other activities" max={6} placeholder="e.g. Youth climate hackathons" disabled={!editable} /></Field>
          <Field label="Other participant groups" span={3} hint="Only for this pillar. Up to 6."><ListEditor value={f.extraGroups} onChange={(v) => set('extraGroups', v)} label="Other participant groups" max={6} placeholder="e.g. University students" disabled={!editable} /></Field>
        </Section>
        <Section id="approach" title="Our approach" desc="The dark band in the middle of the pillar page.">
          <Field label="Heading" span={2} hint="Written in black."><input className="input" maxLength={60} value={f.approachTitle} onChange={(x) => set('approachTitle', x.target.value)} aria-label="Heading" /></Field>
          <Field label="Heading, second part" hint="Optional, written in grey."><input className="input" maxLength={60} value={f.approachSoft} onChange={(x) => set('approachSoft', x.target.value)} aria-label="Heading, second part" /></Field>
          <p className="pl-title-prev s3" aria-label="Heading preview">{f.approachTitle} <span>{f.approachSoft}</span></p>
          <Field label="Our perspective" span={3} count={[f.view.length, 500]}><textarea className="textarea" rows={3} maxLength={500} value={f.view} onChange={(x) => set('view', x.target.value)} aria-label="Our perspective" /></Field>
          <Field label="Guiding principles" span={3} hint="Up to 6 short phrases."><ListEditor value={f.principles} onChange={(v) => set('principles', v)} label="Guiding principles" max={6} placeholder="e.g. Youth-led" disabled={!editable} /></Field>
          <div className="field ed-f s3"><span className="ed-lbl">Steps</span>
            <ol className="pl-steps">{f.steps.map((s, i) => <li key={i}>
              <span className="pl-step-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="pl-step-f"><input className="input" maxLength={40} value={s.title} placeholder="Step title" onChange={(x) => setStep(i, { title: x.target.value })} aria-label={`Step ${i + 1} title`} />
                <textarea className="textarea" rows={2} maxLength={200} value={s.text} placeholder="What happens in this step" onChange={(x) => setStep(i, { text: x.target.value })} aria-label={`Step ${i + 1} text`} /></div>
              <span className="pl-step-a">
                <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label={`Move step ${i + 1} up`}>↑</button>
                <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === f.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label={`Move step ${i + 1} down`}>↓</button>
                <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={f.steps.length === 1} onClick={() => set('steps', f.steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}><Icon n="x" /></button></span>
            </li>)}</ol>
            {f.steps.length < 6 && <button type="button" className="btn btn-sm" onClick={() => set('steps', [...f.steps, { title: '', text: '' }])}><Icon n="plus" />Add a step</button>}
          </div>
        </Section>
        <Section id="pagetexts" title="Page texts" desc="Headings and texts of the pillar page. Leave a field empty to keep the site’s wording, shown in grey.">
          {pageTexts(f.name, f.short).map(([group, fields]) => <div key={group} className="field ed-f s3 pl-pt"><span className="ed-lbl">{group}</span>
            <div className="pl-pt-grid">{fields.map(([k, label, max, def, long]) => <label key={k} className={`field${long ? ' pl-pt-long' : ''}`}><span>{label}</span>
              {long ? <textarea className="textarea" rows={2} maxLength={max} value={f.page[k]} placeholder={def} onChange={(x) => set('page', { ...f.page, [k]: x.target.value })} />
                : <input className="input" maxLength={max} value={f.page[k]} placeholder={def} onChange={(x) => set('page', { ...f.page, [k]: x.target.value })} />}</label>)}</div></div>)}
        </Section>
        <Section id="projects" title="Projects" desc="What the website lists for this pillar.">
          <Field label="Programmes on the Our Pillars card" span={3} hint="Text only, shown as tags on this pillar’s card and page. They are not linked to project records and do not add projects to the pillar. Up to 8."><ListEditor value={f.highlights} onChange={(v) => set('highlights', v)} label="Programmes on the Our Pillars card" max={8} placeholder="Programme name" disabled={!editable} /></Field>
          <div className="field ed-f s3"><span className="ed-lbl">Linked projects</span>
            {p.projects.length === 0 ? <p className="muted" style={{ margin: 0 }}>No project is linked to this pillar yet.</p>
              : <ul className="pl-projects">{p.projects.map((x) => <li key={x.id}><Link to={`/studio/projects/${x.id}`}>{x.name}</Link>{x.primary && <span className="pill">Main pillar</span>}{!x.live && <span className="pill">Not live</span>}</li>)}</ul>}
            {p.projects.length > 0 && !p.projects.some((x) => x.live) && <p style={{ margin: '6px 0 0', color: 'var(--warn)' }}>None of these projects is published, so the pillar page says “No projects are published under this pillar yet”. Publish one of them to list it there.</p>}
            <small>The pillar page lists the live projects linked here. A project chooses its pillars in its own record.</small></div>
        </Section>
        <Section id="internal" title="Internal" desc="Not shown on the website.">
          <Field label="Source" span={3} hint="Where this content comes from."><input className="input" maxLength={300} value={f.provenance} onChange={(x) => set('provenance', x.target.value)} aria-label="Source" /></Field>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of this pillar’s pages. Reviewed and published on the Translations screen.">
        <RecordTranslations noun="pillar" dirty={status !== 'published'} files={[p.publicFile, 'pillars.html']} fields={[{ label: 'Name', value: f.name }, { label: 'Summary', value: f.summary }, { label: 'Page introduction', value: f.intro },
          ...f.objectives.flatMap((o) => [{ label: 'Objective', value: o.title }, { label: 'Objective explanation', value: o.text }]), { label: 'Approach heading', value: f.approachTitle }, { label: 'Our perspective', value: f.view }, ...f.principles.map((x) => ({ label: 'Guiding principle', value: x })), ...f.steps.flatMap((s) => [{ label: 'Step title', value: s.title }, { label: 'Step text', value: s.text }]),
          ...f.extraActivities.map((x) => ({ label: 'Activity', value: x })), ...f.extraGroups.map((x) => ({ label: 'Participant group', value: x })),
          ...pageTexts(f.name, f.short).flatMap(([, fs]) => fs.filter(([k]) => f.page[k]).map(([k, label]) => ({ label: `Page text: ${label}`, value: f.page[k] })))]} />
      </Section>
      </div>
      <WorkflowPanel status={status} live={live} problems={p.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'], ['Colour', colourName], ...(p.publishedAt ? [['Published', fmtDate(p.publishedAt)] as [string, string]] : []), ...(p.verifiedAt ? [['Last approved', fmtDate(p.verifiedAt)] as [string, string]] : [])]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + p.publicFile} target="_blank" rel="noopener"><Icon n="ext" />Open the pillar page</a>}
        {['draft', 'changes_requested'].includes(status) && can('pillar.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('pillar.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('pillar.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('pillar.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />{p.removeRequested ? 'Keep it (withdraw removal)' : 'Withdraw to draft'}</button>}
        {live && !p.removeRequested && ['draft', 'changes_requested', 'published'].includes(status) && can('pillar.update') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('remove')}>Remove from website…</button>}
        {!live && status !== 'in_review' && can('pillar.update') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('delete')}><Icon n="x" />Delete draft pillar</button>}
        {(p.history.revisions.length > 0 || p.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{p.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === p.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && r.id !== p.history.revisions[0]?.id && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/pillars/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {p.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>

    {dialog === 'photo' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setPhoto(m[0]); set('mediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title={`Preview · ${p.publicFile} with this draft`} onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Pillar preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'remove' && <Modal size="sm" title="Remove this pillar from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button>{p.usage.length === 0 && <button className="btn btn-primary" disabled={!!busy || dirty} onClick={() => act('request_removal')}>Send removal for review</button>}</>}>
      <div className="modal-b stack">{p.usage.length ? <><p style={{ margin: 0 }}>Studio won’t remove a pillar that other content still uses, so nothing is left pointing at a missing pillar. Open each one and choose another pillar for it, then come back:</p><ul className="pl-usage">{p.usage.map((u) => <li key={u}>{u}</li>)}</ul></>
        : <p style={{ margin: 0 }}>No project, story, event or objective uses this pillar. A reviewer approves the removal, then publishing takes the pillar off Our Pillars, turns <span className="mono">{p.publicFile}</span> into a redirect to <span className="mono">pillars.html</span> and deletes it from Studio. Its revisions go with it.{dirty ? ' Save or discard your changes first.' : ''}</p>}</div></Modal>}
    {dialog === 'delete' && <Modal size="sm" title="Delete this draft pillar?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button>{p.usage.length === 0 && <button className="btn pl-btn-danger" disabled={!!busy} onClick={deleteDraft}>{busy === 'delete' ? 'Deleting…' : 'Delete permanently'}</button>}</>}>
      <div className="modal-b">{p.usage.length ? <><p style={{ margin: 0 }}>Other content still uses this pillar:</p><ul className="pl-usage">{p.usage.map((u) => <li key={u}>{u}</li>)}</ul></>
        : <p style={{ margin: 0 }}>It was never on the website and nothing links to it. The draft and its history are deleted and cannot be restored.</p>}</div></Modal>}
    {dialog === 'publish' && p.removeRequested && <Modal size="sm" title="Remove from the website now?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn pl-btn-danger" disabled={!!busy} onClick={publish}>{busy ? 'Removing and checking…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds Our Pillars without it, turns <span className="mono">{p.publicFile}</span> into a redirect to <span className="mono">pillars.html</span>, checks the result, then deletes the pillar from Studio.</p></div></Modal>}
    {dialog === 'publish' && !p.removeRequested && <Modal size="sm" title="Publish this pillar?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={publish}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{p.publicFile}</span>, <span className="mono">pillars.html</span> and the pages that name this pillar, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
  </>;
}
