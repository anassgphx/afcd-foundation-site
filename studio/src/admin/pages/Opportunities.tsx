// Opportunities: calls for applications, volunteering, jobs, internships, consultancies and calls for partners.
// Each one gets its own page and appears on opportunities.html as Open, Opening soon or Closed (from its dates).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, workflowActions, type Column } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

export const OPP_TYPES: [string, string][] = [['call_for_applications', 'Call for applications'], ['volunteering', 'Volunteering'], ['internship', 'Internship'], ['job', 'Job'], ['consultancy', 'Consultancy'], ['call_for_partners', 'Call for partners']];
const typeLabel = (t: string) => OPP_TYPES.find((x) => x[0] === t)?.[1] ?? t;
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const todayMa = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const stateOf = (o: { opensOn: string | null; deadline: string | null }) => { const t = todayMa(); return o.deadline && o.deadline < t ? 'Closed' : o.opensOn && o.opensOn > t ? 'Opening soon' : 'Open'; };

type Row = { id: string; slug: string; title: string; type: string; deadline: string | null; opensOn: string | null; location: string; status: string; publishedRevisionId: string | null; updatedAt: string; pillarName: string | null };

export function OpportunitiesList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [st, set] = useUrlState({ status: 'all', type: 'all', q: '' });
  const load = () => api<Row[]>('/opportunities').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function create() {
    const r = await post<{ id: string }>('/opportunities', { title: 'Untitled opportunity', slug: `untitled-${Date.now().toString(36)}`, applyMethod: 'contact' });
    navigate(`/studio/opportunities/${r.id}`);
  }
  const is = (k: string, r: Row) => (k === 'all' ? r.status !== 'archived' : k === 'open' ? !!r.publishedRevisionId && stateOf(r) !== 'Closed' : k === 'closed' ? stateOf(r) === 'Closed' && r.status !== 'archived' : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => (st.type === 'all' || r.type === st.type) && (!st.q || `${r.title} ${r.location}`.toLowerCase().includes(st.q.toLowerCase())));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['all', 'All'], ['open', 'Live & open'], ['closed', 'Closed'], ['draft', 'Drafts'], ['in_review', 'In review'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const tone = (s: string) => (s === 'Open' ? '#16a34a' : s === 'Opening soon' ? '#f59e0b' : '#a8a29e');
  const columns: Column<Row>[] = [
    { key: 'title', header: 'Opportunity', sort: (r) => r.title, csv: (r) => r.title, render: (r) => <div className="dt-main"><span className="dt-thumb"><Icon n="spark" /></span><span className="min-w-0">
      <Link className="title" to={`/studio/opportunities/${r.id}`}>{r.title}</Link><span className="sub">{[r.pillarName, r.location].filter(Boolean).join(' · ') || '—'}</span></span></div> },
    { key: 'type', header: 'Type', sort: (r) => typeLabel(r.type), csv: (r) => typeLabel(r.type), hideBelow: 900, render: (r) => <span className="pill">{typeLabel(r.type)}</span> },
    { key: 'state', header: 'Applications', sort: (r) => stateOf(r), csv: (r) => stateOf(r), render: (r) => <span className="dt-state"><span className="dot" style={{ ['--c' as string]: tone(stateOf(r)) }} />{stateOf(r)}</span> },
    { key: 'deadline', header: 'Deadline', sort: (r) => r.deadline ?? '9999', csv: (r) => r.deadline ?? 'rolling', render: (r) => <span className="sub" style={{ whiteSpace: 'nowrap' }}>{r.deadline ? dateLabel(r.deadline) : 'Rolling'}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 1100, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  return <>
    <div className="page-h"><div><h1>Opportunities</h1><p>Calls for applications, volunteering, internships, jobs and consultancies. They open and close on the website by their dates.</p></div>
      {can('opportunity.create') && <button className="btn btn-primary" onClick={create}><Icon n="plus" />New opportunity</button>}</div>
    {rows && !rows.some((r) => r.publishedRevisionId) && <div className="notice n-info"><div>Nothing is published yet, so the website has no Opportunities page. It appears at <span className="mono">opportunities.html</span> with the first published opportunity.</div></div>}
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search opportunities">
        <select className="select" value={st.type} onChange={(e) => set('type', e.target.value)} aria-label="Type"><option value="all">All types</option>{OPP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </ListToolbar>
      {!rows ? <Loading /> : <DataTable id="opportunities" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-opportunities" initialSort={{ key: 'deadline', dir: 'asc' }}
        actions={workflowActions<Row>({ base: '/opportunities', noun: ['opportunity', 'opportunities'], name: (r) => r.title, canUpdate: can('opportunity.update'), reload: load, post, toast })}
        onOpen={(r) => navigate(`/studio/opportunities/${r.id}`)}
        empty={<EmptyState icon="spark" text="No opportunities match these filters" onClear={st.q || st.type !== 'all' || st.status !== 'all' ? () => { set('q', ''); set('type', 'all'); set('status', 'all'); } : undefined} />} />}
    </section>
  </>;
}

type Form = { title: string; slug: string; type: string; summary: string; body: string; eligibility: string[]; benefits: string[]; location: string; commitment: string; opensOn: string | null; deadline: string | null; applyMethod: 'external' | 'email' | 'contact'; applyUrl: string; applyEmail: string; pillarKey: string | null; projectSlug: string | null; heroMediaId: string | null; seoTitle: string; seoDescription: string };
const KEYS: (keyof Form)[] = ['title', 'slug', 'type', 'summary', 'body', 'eligibility', 'benefits', 'location', 'commitment', 'opensOn', 'deadline', 'applyMethod', 'applyUrl', 'applyEmail', 'pillarKey', 'projectSlug', 'heroMediaId', 'seoTitle', 'seoDescription'];
type Loaded = Form & { id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; media: MediaItem[]; problems: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

function Lines({ value, onChange, label, max }: { value: string[]; onChange: (v: string[]) => void; label: string; max: number }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => { if (text.split('\n').map((s) => s.trim()).filter(Boolean).join('\n') !== value.join('\n')) setText(value.join('\n')); }, [value]);
  return <textarea className="textarea" aria-label={label} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, max)); }} />;
}

export function OpportunityEditor({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [o, setO] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [hero, setHero] = useState<MediaItem | null>(null);
  const [pillars, setPillars] = useState<{ key: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'hero' | 'preview' | 'publish' | 'unpublish' | 'changes'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState(''); const [slugTouched, setSlugTouched] = useState(true);

  const load = useCallback(async () => {
    const [d, pl, pr] = await Promise.all([api<Loaded>(`/opportunities/${id}`), api('/pillars'), api('/projects')]);
    setO(d); setF(Object.fromEntries(KEYS.map((k) => [k, (d as any)[k]])) as Form); setHero(d.media[0] ?? null);
    setPillars(pl); setProjects(pr.filter((x: any) => x.publishedRevisionId));
    setDirty(false); setSlugTouched(!d.title.startsWith('Untitled') || !(d.slug.startsWith('untitled-') || d.slug.startsWith('opportunity-')));
  }, [id]);
  useEffect(() => { load().catch((err) => toast(err.message, true)); }, [load]);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (ev: BeforeUnloadEvent) => { if (dirty) ev.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!o || !f) return <Loading />;
  const status = o.status; const live = !!o.publishedRevisionId;
  const editable = can('opportunity.update') && !['in_review', 'archived'].includes(status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => { const n = { ...x!, [k]: v }; if (k === 'title' && !slugTouched && !live) n.slug = slugify(String(v)) || x!.slug; return n; }); setDirty(true); };
  function showErr(err: unknown) { setErrs(err instanceof ApiError && err.details?.length ? err.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [err instanceof Error ? err.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/opportunities/${id}`, f); await load(); toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved'); return true; }
    catch (err) { showErr(err); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/opportunities/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (err) { setDialog(null); showErr(err); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/opportunities/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'Removed from the website'); }
    catch (err) { setDialog(null); showErr(err); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/opportunities/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (err) { showErr(err); } finally { setBusy(''); }
  }
  const file = `opportunity-${f.slug}.html`;
  const state = stateOf(f);

  return <>
    <EditorHeader back={{ to: '/studio/opportunities', label: 'Opportunities' }} title={f.title} file={live ? file : undefined} status={status} live={live} dirty={dirty}
      extra={<span className="pill">{state}</span>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('opportunity.update') && <button className="btn btn-primary" disabled={!!busy || o.problems.length > 0} title={o.problems.length ? `${o.problems.length} thing${o.problems.length === 1 ? '' : 's'} to do first (see the publishing panel)` : undefined} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('opportunity.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('opportunity.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Basics', icon: 'log', done: !!(f.title && f.summary) },
        { id: 'description', label: 'Description', icon: 'layers', done: f.body.trim().split(/\s+/).filter(Boolean).length >= 20 && f.eligibility.length > 0 },
        { id: 'dates', label: 'Dates & place', icon: 'calendar', done: true },
        { id: 'apply', label: 'How to apply', icon: 'send', done: f.applyMethod === 'contact' || (f.applyMethod === 'external' ? !!f.applyUrl : !!f.applyEmail) },
        { id: 'links', label: 'Links & image', icon: 'image', optional: true, done: f.heroMediaId || f.projectSlug || f.pillarKey ? true : undefined },
        { id: 'seo', label: 'Search & address', icon: 'search', optional: true, done: f.seoTitle || f.seoDescription ? true : undefined },
        { id: 'translations', label: 'Translations', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
      <fieldset className="ed-main" disabled={!editable}>
        <Section id="basics" title="Basics" desc="What people see in the list of opportunities and in search results.">
          <Field label="Title" span={3} count={[f.title.length, 140]}><input className="input input-lg" maxLength={140} value={f.title} onChange={(x) => set('title', x.target.value)} aria-label="Title" placeholder="e.g. Call for applications: Youth Climate Fellows 2027" /></Field>
          <Field label="Short summary" span={3} count={[f.summary.length, 320]}><textarea className="textarea" rows={3} maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value.replace(/\n/g, ' '))} aria-label="Short summary" /></Field>
          <Field label="Type"><select className="select" value={f.type} onChange={(x) => set('type', x.target.value)} aria-label="Type">{OPP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Pillar" span={2} hint="Optional."><select className="select" value={f.pillarKey ?? ''} onChange={(x) => set('pillarKey', x.target.value || null)} aria-label="Pillar"><option value="">None</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field>
        </Section>
        <Section id="description" title="Description" desc="What it is, what people will do, and how selection works.">
          <Field label="Description" span={3} hint="Blank line = new paragraph · ## Subheading · **bold** · [link](https://…)"><textarea className="textarea" style={{ minHeight: 170 }} maxLength={20000} value={f.body} onChange={(x) => set('body', x.target.value)} aria-label="Description" /></Field>
          <Field label="Who can apply" span={2} hint="One per line, up to 12. Required."><Lines label="Who can apply" value={f.eligibility} max={12} onChange={(v) => set('eligibility', v)} /></Field>
          <Field label="What you get" hint="Optional, one per line."><Lines label="What you get" value={f.benefits} max={12} onChange={(v) => set('benefits', v)} /></Field>
        </Section>
        <Section id="dates" title="Dates & place" desc="It opens and closes on the website by these dates (Morocco time).">
          <Field label="Opens" hint="Empty = open now."><input className="input" type="date" value={f.opensOn ?? ''} onChange={(x) => set('opensOn', x.target.value || null)} aria-label="Opens" /></Field>
          <Field label="Deadline" hint="Empty = rolling applications."><input className="input" type="date" value={f.deadline ?? ''} min={f.opensOn ?? undefined} onChange={(x) => set('deadline', x.target.value || null)} aria-label="Deadline" /></Field>
          <Field label="Commitment"><input className="input" maxLength={80} placeholder="e.g. 3 months, part-time" value={f.commitment} onChange={(x) => set('commitment', x.target.value)} aria-label="Commitment" /></Field>
          <Field label="Location" span={3}><input className="input" maxLength={120} placeholder="e.g. Marrakech, or Remote" value={f.location} onChange={(x) => set('location', x.target.value)} aria-label="Location" /></Field>
        </Section>
        <Section id="apply" title="How to apply">
          <Field label="Application method" span={3}><div className="ed-choice">
            {([['external', 'Online form', 'A link to your application form.'], ['email', 'By email', 'The address is shown on the page.'], ['contact', 'Contact form', 'Through the website, with the right topic.']] as const).map(([v, l, d]) =>
              <label key={v} className={f.applyMethod === v ? 'on' : ''}><input type="radio" name="apply" checked={f.applyMethod === v} onChange={() => set('applyMethod', v)} /><b>{l}</b><small>{d}</small></label>)}</div></Field>
          {f.applyMethod === 'external' && <Field label="Application link" span={3}><input className="input mono" maxLength={500} placeholder="https://…" value={f.applyUrl} onChange={(x) => set('applyUrl', x.target.value.trim())} aria-label="Application link" /></Field>}
          {f.applyMethod === 'email' && <Field label="Application email" span={3} hint="Shown publicly on the page."><input className="input mono" maxLength={160} placeholder="name@afcdteam.com" value={f.applyEmail} onChange={(x) => set('applyEmail', x.target.value.trim())} aria-label="Application email" /></Field>}
        </Section>
        <Section id="links" title="Links & image" desc="Optional.">
          <Field label="Project" hint="Live projects only."><select className="select" value={f.projectSlug ?? ''} onChange={(x) => set('projectSlug', x.target.value || null)} aria-label="Project"><option value="">None</option>{projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <div className="ed-media s2" style={{ gridColumn: 'span 2' }}>
            {f.heroMediaId && hero ? <div className="ed-media-img"><img src={hero.url} alt={hero.alt} /><button type="button" className="btn btn-sm" onClick={() => set('heroMediaId', null)}><Icon n="x" />Remove</button></div>
              : <button type="button" className="ed-drop" onClick={() => setDialog('hero')}><Icon n="image" /><b>Choose an image</b><small>Optional, from the media library.</small></button>}
            {f.heroMediaId && <button type="button" className="btn btn-sm" onClick={() => setDialog('hero')}><Icon n="image" />Change image</button>}
          </div>
        </Section>
        <Section id="seo" title="Search & address" desc="Optional. Empty fields use the title and summary.">
          <Field label="SEO title" span={2} count={[f.seoTitle.length, 70]}><input className="input" maxLength={70} value={f.seoTitle} onChange={(x) => set('seoTitle', x.target.value)} aria-label="SEO title" placeholder={f.title} /></Field>
          <Field label="Page address" hint={live ? 'A live opportunity’s address cannot change.' : undefined}><div className="ed-slug"><span>opportunity-</span><input className="input mono" aria-label="Page address" disabled={live} value={f.slug} onChange={(x) => { setSlugTouched(true); set('slug', slugify(x.target.value)); }} /></div></Field>
          <Field label="Meta description" span={3} count={[f.seoDescription.length, 170]}><textarea className="textarea" rows={2} maxLength={170} value={f.seoDescription} onChange={(x) => set('seoDescription', x.target.value)} aria-label="Meta description" placeholder={f.summary} /></Field>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of this opportunity. Reviewed and published on the Translations screen.">
        <RecordTranslations noun="opportunity" dirty={status !== 'published'} files={f.slug ? [`opportunity-${f.slug}.html`] : []} fields={[{ label: 'Title', value: f.title }, { label: 'Summary', value: f.summary }, ...f.body.split(/\n{2,}/).map((x) => ({ label: 'Description', value: x.replace(/^[>#-]+\s*/, '') })), ...f.eligibility.map((x) => ({ label: 'Who can apply', value: x })), ...f.benefits.map((x) => ({ label: 'What you get', value: x })), { label: 'Location', value: f.location }, { label: 'Commitment', value: f.commitment }, { label: 'SEO title', value: f.seoTitle }, { label: 'Meta description', value: f.seoDescription }]} />
      </Section>
      </div>
      <WorkflowPanel status={status} live={live} problems={o.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'], ...(o.publishedAt ? [['Published', fmtDate(o.publishedAt)] as [string, string]] : []), ['Applications', `${state}${f.deadline ? ` · until ${dateLabel(f.deadline)}` : ' · rolling'}`]]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open live page</a>}
        {['draft', 'changes_requested'].includes(status) && can('opportunity.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('opportunity.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('opportunity.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('opportunity.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('opportunity.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('opportunity.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this record?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('opportunity.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        {(o.history.revisions.length > 0 || o.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{o.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === o.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/opportunities/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {o.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>

    {dialog === 'hero' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setHero(m[0]); set('heroMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title="Preview · the real opportunity page" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Opportunity preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(x) => setComment(x.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this opportunity?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Builds <span className="mono">{file}</span> and <span className="mono">opportunities.html</span>, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The page and its listing are removed. It stays in Studio as a draft with its history.</p></div></Modal>}
  </>;
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
}
