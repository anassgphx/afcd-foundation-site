// Pillars: the four strategic pillars and the pages built from them (Our Pillars and one page per pillar).
// The set of pillars, their numbers and their page addresses are fixed; editors change the content through review.
import { useCallback, useEffect, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, ListEditor, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { DataTable, EmptyState, type Column } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import '../pillars.css';

type Row = { id: string; key: string; number: string; name: string; draftName: string; short: string; summary: string; colour: string; draftColour: string; publicFile: string;
  status: string; imported: boolean; mediaId: string | null; publishedRevisionId: string | null; updatedAt: string; projects: number };

export function PillarsList() {
  const can = useCan(); const toast = useToast(); const me = useMe();
  const [rows, setRows] = useState<Row[] | null>(null); const [busy, setBusy] = useState(false);
  const load = () => api<Row[]>('/pillars/records').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function importContent() {
    setBusy(true);
    try { const r = await post<{ imported: number }>('/pillars/import'); toast(`Imported the content of ${r.imported} pillar${r.imported === 1 ? '' : 's'} from the current website`); await load(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const missing = (rows ?? []).filter((r) => !r.imported).length;
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Pillar', sort: (r) => r.number, csv: (r) => r.draftName, render: (r) => <div className="dt-main"><span className="dt-thumb pl-num-thumb" style={{ background: r.draftColour }}>{r.number}</span><span className="min-w-0">
      {r.imported ? <Link className="title" to={`/studio/pillars/${r.id}`}>{r.draftName}</Link> : <span className="title">{r.name}</span>}<span className="sub pl-sum">{r.imported ? r.summary : 'Content not imported yet'}</span></span></div> },
    { key: 'page', header: 'Page', hideBelow: 900, sort: (r) => r.publicFile, csv: (r) => r.publicFile, render: (r) => <a className="mono sub" href={me.siteUrl + r.publicFile} target="_blank" rel="noopener">{r.publicFile}</a> },
    { key: 'projects', header: 'Live projects', align: 'right', hideBelow: 700, sort: (r) => -r.projects, csv: (r) => String(r.projects), render: (r) => <span className="sub">{r.projects || '—'}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => r.imported ? <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> : <span className="sub">—</span> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => r.imported ? <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> : <span className="sub">—</span> },
  ];
  return <>
    <div className="page-h"><div><h1>Pillars</h1><p>The four pillars of AFCD’s work: the Our Pillars page and one page per pillar. Changes reach the website only after review and publishing.</p></div></div>
    {rows && missing > 0 && <div className="notice n-info"><div><b>{missing === rows.length ? 'The pillar pages are still written in the site’s code.' : `${missing} pillar${missing === 1 ? ' is' : 's are'} not in Studio yet.`}</b> Import their current text to edit it here. The website stays exactly as it is until someone publishes a change.</div>
      {can('pillar.publish') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={importContent}>{busy ? 'Importing…' : 'Import current content'}</button>}</div>}
    <section className="card">
      {!rows ? <Loading /> : <DataTable id="pillars" rows={rows} total={rows.length} rowKey={(r) => r.id} columns={columns} csvName="afcd-pillars"
        onOpen={(r) => r.imported && navigate(`/studio/pillars/${r.id}`)} empty={<EmptyState icon="pillars" text="No pillars" />} />}
    </section>
    <p className="muted pl-foot">The homepage’s pillar section is edited in <Link to="/studio/home">Homepage</Link>, and the header’s pillar links in <Link to="/studio/menus">Menus</Link>. Projects choose their pillars in their own record.</p>
  </>;
}

type Step = { title: string; text: string };
type Form = { name: string; short: string; summary: string; intro: string; colour: string; brand: string; highlights: string[]; approachTitle: string; approachSoft: string;
  view: string; principles: string[]; steps: Step[]; activities: number[]; groups: number[]; mediaId: string | null; provenance: string };
type Loaded = { id: string; key: string; number: string; publicFile: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; verifiedAt: string | null;
  content: Form | null; projects: { id: string; slug: string; name: string; live: boolean; primary: boolean }[]; media: MediaItem[]; problems: string[];
  lists: { activities: string[]; groups: string[] }; colours: { value: string; label: string }[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

export function PillarEditor({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [p, setP] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [photo, setPhoto] = useState<MediaItem | null>(null);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'photo' | 'preview' | 'publish' | 'changes'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    const d = await api<Loaded>(`/pillars/${id}`);
    setP(d); setF(d.content ? structuredClone(d.content) : null); setPhoto(d.media[0] ?? null); setDirty(false);
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
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function publish() {
    setBusy('publish');
    try { await post(`/pillars/${id}/publish`); await load(); setDialog(null); toast(`Published and verified on ${p!.publicFile} and Our Pillars`); }
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
  const colourName = p.colours.find((c) => c.value === f.colour)?.label ?? f.colour;

  return <>
    <EditorHeader back={{ to: '/studio/pillars', label: 'Pillars' }} title={f.name} file={p.publicFile} status={status} live={live} dirty={dirty}
      extra={<span className="pill"><span className="pl-dot" style={{ background: f.colour }} aria-hidden="true" />Pillar {p.number} / 04</span>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('pillar.update') && <button className="btn btn-primary" disabled={!!busy || p.problems.length > 0} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('pillar.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('pillar.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Pillar', icon: 'pillars', done: !!f.name },
        { id: 'text', label: 'Summary and introduction', icon: 'log', done: !!f.summary && !!f.intro },
        { id: 'photo', label: 'Photo', icon: 'image', optional: true, done: f.mediaId ? true : undefined },
        { id: 'work', label: 'What we do', icon: 'users', optional: true, done: f.activities.length || f.groups.length ? true : undefined },
        { id: 'approach', label: 'Our approach', icon: 'layers', done: !!f.approachTitle && f.steps.length > 0 },
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
            <div className="pl-fixed"><span className="mono">{p.publicFile}</span><span className="muted">·</span><span className="mono">pillars.html#{p.key}</span><span className="muted">· Pillar {p.number} / 04</span>
              {live && <a className="btn btn-sm" href={me.siteUrl + p.publicFile} target="_blank" rel="noopener"><Icon n="ext" />Open</a>}</div></Field>
        </Section>
        <Section id="text" title="Summary and introduction" desc="Plain text. The site’s typography is applied automatically.">
          <Field label="Summary" span={3} count={[f.summary.length, 320]} hint="On the Our Pillars card, in the pillar page’s coloured overview, and in its search description.">
            <textarea className="textarea" rows={3} maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value)} aria-label="Summary" /></Field>
          <Field label="Page introduction" span={3} count={[f.intro.length, 200]} hint="The line under the pillar name at the top of its page.">
            <textarea className="textarea" rows={2} maxLength={200} value={f.intro} onChange={(x) => set('intro', x.target.value)} aria-label="Page introduction" /></Field>
        </Section>
        <Section id="photo" title="Photo" desc="Shown in the pillar page’s overview. Without a photo the page keeps its placeholder. Alt text and usage rights are checked before review.">
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
        <Section id="work" title="What we do" desc="Chosen from AFCD’s shared lists, so the wording stays the same on every page. Numbered in the order they appear.">
          {p.lists.activities.length === 0 && <p className="muted s3" style={{ margin: 0 }}>The site’s lists could not be read.</p>}
          {p.lists.activities.length > 0 && <Field label="Activities" span={3}><div className="pl-picks">{p.lists.activities.map((a, i) => { const at = f.activities.indexOf(i); return <label key={i} className={at >= 0 ? 'on' : ''}><input type="checkbox" checked={at >= 0} onChange={(e) => toggle('activities', i, e.target.checked)} /><span className="pl-pick-n">{at >= 0 ? String(at + 1).padStart(2, '0') : ''}</span><span>{a}</span></label>; })}</div></Field>}
          {p.lists.groups.length > 0 && <Field label="Who we work with" span={3}><div className="pl-picks">{p.lists.groups.map((g, i) => { const at = f.groups.indexOf(i); return <label key={i} className={at >= 0 ? 'on' : ''}><input type="checkbox" checked={at >= 0} onChange={(e) => toggle('groups', i, e.target.checked)} /><span className="pl-pick-n">{at >= 0 ? String(at + 1).padStart(2, '0') : ''}</span><span>{g}</span></label>; })}</div></Field>}
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
        <Section id="projects" title="Projects" desc="What the website lists for this pillar.">
          <Field label="Programmes on the Our Pillars card" span={3} hint="Names shown as tags on this pillar’s card. Up to 8."><ListEditor value={f.highlights} onChange={(v) => set('highlights', v)} label="Programmes on the Our Pillars card" max={8} placeholder="Programme name" disabled={!editable} /></Field>
          <div className="field ed-f s3"><span className="ed-lbl">Linked projects</span>
            {p.projects.length === 0 ? <p className="muted" style={{ margin: 0 }}>No project is linked to this pillar yet.</p>
              : <ul className="pl-projects">{p.projects.map((x) => <li key={x.id}><Link to={`/studio/projects/${x.id}`}>{x.name}</Link>{x.primary && <span className="pill">Main pillar</span>}{!x.live && <span className="pill">Not live</span>}</li>)}</ul>}
            <small>The pillar page lists the live projects linked here. A project chooses its pillars in its own record.</small></div>
        </Section>
        <Section id="internal" title="Internal" desc="Not shown on the website.">
          <Field label="Source" span={3} hint="Where this content comes from."><input className="input" maxLength={300} value={f.provenance} onChange={(x) => set('provenance', x.target.value)} aria-label="Source" /></Field>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of this pillar’s pages. Reviewed and published on the Translations screen.">
        <RecordTranslations noun="pillar" dirty={status !== 'published'} files={[p.publicFile, 'pillars.html']} fields={[{ label: 'Name', value: f.name }, { label: 'Summary', value: f.summary }, { label: 'Page introduction', value: f.intro },
          { label: 'Approach heading', value: f.approachTitle }, { label: 'Our perspective', value: f.view }, ...f.principles.map((x) => ({ label: 'Guiding principle', value: x })), ...f.steps.flatMap((s) => [{ label: 'Step title', value: s.title }, { label: 'Step text', value: s.text }])]} />
      </Section>
      </div>
      <WorkflowPanel status={status} live={live} problems={p.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'], ['Colour', colourName], ...(p.publishedAt ? [['Published', fmtDate(p.publishedAt)] as [string, string]] : []), ...(p.verifiedAt ? [['Last approved', fmtDate(p.verifiedAt)] as [string, string]] : [])]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + p.publicFile} target="_blank" rel="noopener"><Icon n="ext" />Open the pillar page</a>}
        {['draft', 'changes_requested'].includes(status) && can('pillar.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('pillar.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('pillar.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('pillar.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {(p.history.revisions.length > 0 || p.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{p.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === p.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && r.id !== p.history.revisions[0]?.id && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/pillars/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {p.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>

    {dialog === 'photo' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setPhoto(m[0]); set('mediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title={`Preview · ${p.publicFile} with this draft`} onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Pillar preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this pillar?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={publish}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{p.publicFile}</span>, <span className="mono">pillars.html</span> and the pages that name this pillar, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
  </>;
}
