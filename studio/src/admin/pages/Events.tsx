// Events: the public calendar. Real events only; each gets its own page and appears on Events (upcoming or past).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { useSite } from '../site.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column, TableSkeleton, statusFilter, updatedFilter, useListActions } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const todayMa = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

type Row = { id: string; slug: string; title: string; kind: string; startDate: string; endDate: string | null; location: string; online: boolean; status: string; publishedRevisionId: string | null; updatedAt: string; pillarName: string | null; pillarColour: string | null };

export function EventsList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [st, set] = useUrlState({ status: 'upcoming', q: '' });
  const load = () => api<Row[]>('/events').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const me = useMe();
  const acts = useListActions<Row>({
    base: '/events', noun: ['event', 'events'], name: (r) => r.title, reload: load,
    can: { update: can('event.update'), approve: can('event.approve'), publish: can('event.publish'), archive: can('event.update'), delete: can('event.publish') },
    edit: (r) => `/studio/events/${r.id}`, liveUrl: (r) => me.siteUrl + `event-${r.slug}.html`,
  });
  const today = todayMa();
  const up = (r: Row) => (r.endDate ?? r.startDate) >= today;
  async function create() {
    const r = await post<{ id: string }>('/events', { title: 'Untitled event', slug: `untitled-${Date.now().toString(36)}`, startDate: today, registration: 'contact' });
    navigate(`/studio/events/${r.id}`);
  }
  const is = (k: string, r: Row) => (k === 'upcoming' ? up(r) && r.status !== 'archived' : k === 'past' ? !up(r) && r.status !== 'archived' : k === 'live' ? !!r.publishedRevisionId : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => !st.q || `${r.title} ${r.location}`.toLowerCase().includes(st.q.toLowerCase()));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['upcoming', 'Upcoming'], ['past', 'Past'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', filter: { type: 'date', title: 'Date', get: (r) => r.startDate }, sort: (r) => r.startDate, csv: (r) => r.startDate + (r.endDate ? ` – ${r.endDate}` : ''), render: (r) => { const d = new Date(`${r.startDate}T12:00:00Z`); return <span className="dt-date"><b>{d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</b><small>{d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</small></span>; }, width: '84px' },
    { key: 'title', header: 'Event', sort: (r) => r.title, csv: (r) => r.title, render: (r) => <div className="min-w-0"><Link className="title" to={`/studio/events/${r.id}`}>{r.title}</Link><div className="sub">{[r.pillarName, r.online ? (r.location ? `${r.location} · Online` : 'Online') : r.location, r.endDate && r.endDate !== r.startDate ? `until ${dateLabel(r.endDate)}` : ''].filter(Boolean).join(' · ') || 'No pillar or place yet'}</div></div> },
    { key: 'kind', header: 'Type', filter: { type: 'set', title: 'Type', get: (r) => r.kind }, sort: (r) => r.kind, csv: (r) => r.kind, hideBelow: 900, render: (r) => <span className="pill">{r.kind}</span> },
    { key: 'status', header: 'Status', filter: statusFilter<Row>(), sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} />{!up(r) && <span className="pill">Past</span>}</div> },
    { key: 'updated', header: 'Updated', filter: updatedFilter<Row>(), align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  const live = (rows ?? []).filter((r) => r.publishedRevisionId).length;
  return <>
    <div className="page-h"><div><h1>Events</h1><p>Workshops, trainings, community days and online sessions. Events move from Upcoming to Past on their own after the last day.</p></div>
      {can('event.create') && <button className="btn btn-primary" onClick={create}><Icon n="plus" />New event</button>}</div>
    {rows && live === 0 && <div className="notice n-info"><div>The Events page currently shows <b>sample events</b>. They are replaced by your real calendar as soon as the first event is published here.</div></div>}
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search events or places" />
      {!rows ? <TableSkeleton /> : <DataTable id="events" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-events"
        initialSort={{ key: 'date', dir: st.status === 'upcoming' ? 'asc' : 'desc' }}
        actions={acts.bulk} rowMenu={acts.rowMenu}
        onOpen={(r) => navigate(`/studio/events/${r.id}`)}
        empty={<EmptyState icon="calendar" text={st.status === 'upcoming' ? 'No upcoming events' : 'No events match these filters'} onClear={st.q ? () => set('q', '') : undefined} />} />}
    </section>
    {acts.dialog}
  </>;
}

type Form = { title: string; slug: string; kind: string; summary: string; body: string; startDate: string; endDate: string | null; timeLabel: string; location: string; online: boolean; pillarKey: string | null; projectSlug: string | null; posterMediaId: string | null; agenda: { title: string; text: string }[]; audience: string[]; registration: 'none' | 'contact' | 'external'; registrationUrl: string; recapArticleSlug: string | null; seoTitle: string; seoDescription: string };
const KEYS: (keyof Form)[] = ['title', 'slug', 'kind', 'summary', 'body', 'startDate', 'endDate', 'timeLabel', 'location', 'online', 'pillarKey', 'projectSlug', 'posterMediaId', 'agenda', 'audience', 'registration', 'registrationUrl', 'recapArticleSlug', 'seoTitle', 'seoDescription'];
type Loaded = Form & { id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; media: MediaItem[]; problems: string[]; kinds: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

export function EventEditor({ id }: { id: string }) {
  const site = useSite();
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [e, setE] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [poster, setPoster] = useState<MediaItem | null>(null);
  const [pillars, setPillars] = useState<{ key: string; name: string; colour: string }[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [stories, setStories] = useState<{ slug: string; title: string }[]>([]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'poster' | 'preview' | 'publish' | 'unpublish' | 'changes'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState(''); const [slugTouched, setSlugTouched] = useState(true);

  const load = useCallback(async () => {
    const [d, pl, pr, nw] = await Promise.all([api<Loaded>(`/events/${id}`), api('/pillars'), api('/projects'), can('news.read') ? api('/news') : Promise.resolve([])]);
    setE(d); setF(Object.fromEntries(KEYS.map((k) => [k, (d as any)[k]])) as Form); setPoster(d.media[0] ?? null);
    setPillars(pl); setProjects(pr.filter((x: any) => x.publishedRevisionId)); setStories(nw.filter((x: any) => x.publishedRevisionId));
    setDirty(false); setSlugTouched(!d.title.startsWith('Untitled') || !(d.slug.startsWith('untitled-') || d.slug.startsWith('event-')));
  }, [id]);
  useEffect(() => { load().catch((err) => toast(err.message, true)); }, [load]);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (ev: BeforeUnloadEvent) => { if (dirty) ev.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!e || !f) return <Loading />;
  const status = e.status; const live = !!e.publishedRevisionId;
  const editable = can('event.update') && !['in_review', 'archived'].includes(status);
  const past = (f.endDate ?? f.startDate) < todayMa();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => { const n = { ...x!, [k]: v }; if (k === 'title' && !slugTouched && !live) n.slug = slugify(String(v)) || x!.slug; return n; }); setDirty(true); };
  function showErr(err: unknown) { setErrs(err instanceof ApiError && err.details?.length ? err.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [err instanceof Error ? err.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/events/${id}`, f); await load(); toast(live ? 'Draft saved. The live event is unchanged until you publish.' : 'Draft saved'); return true; }
    catch (err) { showErr(err); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/events/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (err) { setDialog(null); showErr(err); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/events/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'Removed from the website'); }
    catch (err) { setDialog(null); showErr(err); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/events/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (err) { showErr(err); } finally { setBusy(''); }
  }
  const file = `event-${f.slug}.html`;

  return <>
    <EditorHeader back={{ to: '/studio/events', label: 'Events' }} title={f.title} file={live ? file : undefined} status={status} live={live} dirty={dirty}
      extra={<span className="pill">{past ? 'Past' : 'Upcoming'}</span>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('event.update') && <button className="btn btn-primary" disabled={!!busy || e.problems.length > 0} title={e.problems.length ? `${e.problems.length} thing${e.problems.length === 1 ? '' : 's'} to do first (see the publishing panel)` : undefined} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('event.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('event.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}

    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Basics', icon: 'log', done: !!(f.title && f.summary && f.pillarKey) },
        { id: 'when', label: 'Date & place', icon: 'calendar', done: !!(f.startDate && f.timeLabel && (f.location || f.online)) },
        { id: 'details', label: 'Details', icon: 'layers', optional: true, done: !!(f.body || f.agenda.length || f.audience.length) || undefined },
        { id: 'media', label: 'Poster', icon: 'image', optional: true, done: f.posterMediaId ? true : undefined },
        { id: 'join', label: 'Registration & links', icon: 'send', done: f.registration !== 'external' || !!f.registrationUrl },
        { id: 'seo', label: 'Search & address', icon: 'search', optional: true, done: f.seoTitle || f.seoDescription ? true : undefined },
        { id: 'translations', label: 'Translations', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
      <fieldset className="ed-main" disabled={!editable}>
        <Section id="basics" title="Basics" desc="What people see first in the calendar and in search results.">
          <Field label="Title" span={3} count={[f.title.length, 140]}><input className="input input-lg" maxLength={140} value={f.title} onChange={(x) => set('title', x.target.value)} aria-label="Title" placeholder="e.g. Climate workshop for young leaders" /></Field>
          <Field label="Short description" span={3} count={[f.summary.length, 320]} hint="One or two sentences: what, who for, why it matters."><textarea className="textarea" rows={3} maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value.replace(/\n/g, ' '))} aria-label="Short description" /></Field>
          <Field label="Type"><select className="select" value={f.kind} onChange={(x) => set('kind', x.target.value)} aria-label="Type">{e.kinds.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Pillar" span={2}><select className="select" value={f.pillarKey ?? ''} onChange={(x) => set('pillarKey', x.target.value || null)} aria-label="Pillar"><option value="">Choose a pillar…</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field>
        </Section>
        <Section id="when" title="Date & place" desc="Events move from Upcoming to Past on their own after the last day (Morocco time).">
          <Field label="Date"><input className="input" type="date" value={f.startDate} onChange={(x) => set('startDate', x.target.value)} aria-label="Date" /></Field>
          <Field label="Ends" hint="Only for events over several days."><input className="input" type="date" value={f.endDate ?? ''} min={f.startDate} onChange={(x) => set('endDate', x.target.value || null)} aria-label="End date" /></Field>
          <Field label="Time" hint="e.g. 10:00 – 13:00, or Full day"><input className="input" maxLength={60} value={f.timeLabel} onChange={(x) => set('timeLabel', x.target.value)} aria-label="Time" /></Field>
          <Field label="Place" span={2} hint="Town or venue, as people should read it."><input className="input" maxLength={120} value={f.location} onChange={(x) => set('location', x.target.value)} aria-label="Place" placeholder="e.g. Ait Ourir community hall" /></Field>
          <Field label="Format"><label className="ed-toggle"><input type="checkbox" checked={f.online} onChange={(x) => set('online', x.target.checked)} /><span>Online event</span></label></Field>
        </Section>
        <Section id="details" title="Details" desc="Optional. Sections left empty are hidden on the event page.">
          <Field label="About this event" span={3} hint="Blank line = new paragraph · ## Subheading · **bold** · [link](https://…)"><textarea className="textarea" style={{ minHeight: 150 }} maxLength={20000} value={f.body} onChange={(x) => set('body', x.target.value)} aria-label="About this event" /></Field>
          <Field label="Agenda" span={3}>
            <ol className="ed-list">{f.agenda.map((a, i) => <li key={i}><span className="ed-list-n">{i + 1}</span>
              <input className="input" maxLength={80} placeholder="10:00 Welcome" value={a.title} onChange={(x) => set('agenda', f.agenda.map((y, j) => j === i ? { ...y, title: x.target.value } : y))} aria-label={`Agenda item ${i + 1}`} />
              <input className="input" maxLength={240} placeholder="What happens" value={a.text} onChange={(x) => set('agenda', f.agenda.map((y, j) => j === i ? { ...y, text: x.target.value } : y))} aria-label={`Agenda item ${i + 1} details`} />
              <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Remove item" onClick={() => set('agenda', f.agenda.filter((_, j) => j !== i))}><Icon n="x" /></button></li>)}</ol>
            {f.agenda.length < 12 && <button type="button" className="btn btn-sm ed-add" onClick={() => set('agenda', [...f.agenda, { title: '', text: '' }])}><Icon n="plus" />Add agenda item</button>}</Field>
          <Field label="Who it’s for" span={3} hint="One per line, up to 8."><textarea className="textarea" rows={3} value={f.audience.join('\n')} onChange={(x) => set('audience', x.target.value.split('\n').map((s) => s.trimStart()).filter((s, i, arr) => s || i === arr.length - 1).slice(0, 8))} onBlur={() => set('audience', f.audience.map((s) => s.trim()).filter(Boolean))} aria-label="Who it’s for" /></Field>
        </Section>
        <Section id="media" title="Poster" desc="Square images work best. Without one, a neutral placeholder is shown.">
          <div className="ed-media s3">
            {f.posterMediaId && poster ? <div className="ed-media-img"><img src={poster.url} alt={poster.alt} /><button type="button" className="btn btn-sm" onClick={() => set('posterMediaId', null)}><Icon n="x" />Remove</button></div>
              : <button type="button" className="ed-drop" onClick={() => setDialog('poster')}><Icon n="image" /><b>Choose a poster</b><small>From the media library. It needs confirmed rights before review.</small></button>}
            {f.posterMediaId && <button type="button" className="btn btn-sm" onClick={() => setDialog('poster')}><Icon n="image" />Change poster</button>}
          </div>
        </Section>
        <Section id="join" title="Registration & links">
          <Field label="How people register" span={3}><div className="ed-choice">
            {([['contact', 'Contact form', 'They send a message; you confirm by email.'], ['external', 'Registration link', 'An external form, e.g. Google Forms.'], ['none', 'No registration', 'Open event: just show up.']] as const).map(([v, l, d]) =>
              <label key={v} className={f.registration === v ? 'on' : ''}><input type="radio" name="reg" checked={f.registration === v} onChange={() => set('registration', v)} /><b>{l}</b><small>{d}</small></label>)}</div></Field>
          {f.registration === 'external' && <Field label="Registration link" span={3}><input className="input mono" maxLength={500} placeholder="https://…" value={f.registrationUrl} onChange={(x) => set('registrationUrl', x.target.value.trim())} aria-label="Registration link" /></Field>}
          <Field label="Project" hint="Live projects only."><select className="select" value={f.projectSlug ?? ''} onChange={(x) => set('projectSlug', x.target.value || null)} aria-label="Project"><option value="">None</option>{projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <Field label="Recap story" span={2} hint="Shown on the event page once it has passed."><select className="select" value={f.recapArticleSlug ?? ''} onChange={(x) => set('recapArticleSlug', x.target.value || null)} aria-label="Recap story"><option value="">None</option>{stories.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}</select></Field>
        </Section>
        <Section id="seo" title="Search & address" desc="Optional. Empty fields use the title and short description.">
          <Field label="SEO title" span={2} count={[f.seoTitle.length, 70]}><input className="input" maxLength={70} value={f.seoTitle} onChange={(x) => set('seoTitle', x.target.value)} aria-label="SEO title" placeholder={f.title} /></Field>
          <Field label="Page address" hint={live ? 'A live event’s address cannot change.' : undefined}><div className="ed-slug"><span>event-</span><input className="input mono" aria-label="Page address" disabled={live} value={f.slug} onChange={(x) => { setSlugTouched(true); set('slug', slugify(x.target.value)); }} /></div></Field>
          <Field label="Meta description" span={3} count={[f.seoDescription.length, 170]}><textarea className="textarea" rows={2} maxLength={170} value={f.seoDescription} onChange={(x) => set('seoDescription', x.target.value)} aria-label="Meta description" placeholder={f.summary} /></Field>
          <div className="serp s3"><div className="serp-url">{site.host} › {file}</div><div className="serp-title">{(f.seoTitle || f.title || 'Event title').slice(0, 65)} · Events · AFCD Foundation</div><div className="serp-desc">{(f.seoDescription || f.summary || 'Short description of the event.').slice(0, 160)}</div></div>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of this event. Reviewed and published on the Translations screen.">
        <RecordTranslations noun="event" dirty={status !== 'published'} files={f.slug ? [`event-${f.slug}.html`] : []} fields={[{ label: 'Event title', value: f.title }, { label: 'Summary', value: f.summary }, ...f.body.split(/\n{2,}/).map((x) => ({ label: 'Description', value: x.replace(/^[>#-]+\s*/, '') })), { label: 'Location', value: f.location }, { label: 'Time', value: f.timeLabel }, ...f.agenda.flatMap((a) => [{ label: 'Programme step', value: a.title }, { label: 'Programme step text', value: a.text }]), ...f.audience.map((x) => ({ label: 'Who should attend', value: x })), { label: 'SEO title', value: f.seoTitle }, { label: 'Meta description', value: f.seoDescription }]} />
      </Section>
      </div>

      <WorkflowPanel status={status} live={live} problems={e.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'], ...(e.publishedAt ? [['Published', fmtDate(e.publishedAt)] as [string, string]] : []), ['Calendar', past ? 'Past event' : 'Upcoming']]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open live event</a>}
        {['draft', 'changes_requested'].includes(status) && can('event.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('event.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('event.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('event.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('event.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('event.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this event?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('event.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        {(e.history.revisions.length > 0 || e.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{e.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === e.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/events/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {e.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>

    {dialog === 'poster' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setPoster(m[0]); set('posterMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title="Preview · the real event page" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Event preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(x) => setComment(x.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this event?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{file}</span> and the Events page, then checks the result.{live ? '' : ' If this is the first event published from Studio, the sample events are replaced by your real calendar.'} Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The event page and its calendar entry are removed. It stays in Studio as a draft with its history.</p></div></Modal>}
  </>;
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
}
