// Events: the public calendar. Real events only; each gets its own page and appears on Events (upcoming or past).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, workflowActions, type Column } from '../DataTable.tsx';
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
  const today = todayMa();
  const up = (r: Row) => (r.endDate ?? r.startDate) >= today;
  async function create() {
    const r = await post<{ id: string }>('/events', { title: 'Untitled event', slug: `event-${Date.now().toString(36)}`, startDate: today, registration: 'contact' });
    navigate(`/studio/events/${r.id}`);
  }
  const is = (k: string, r: Row) => (k === 'upcoming' ? up(r) && r.status !== 'archived' : k === 'past' ? !up(r) && r.status !== 'archived' : k === 'live' ? !!r.publishedRevisionId : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => !st.q || `${r.title} ${r.location}`.toLowerCase().includes(st.q.toLowerCase()));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['upcoming', 'Upcoming'], ['past', 'Past'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', sort: (r) => r.startDate, csv: (r) => r.startDate + (r.endDate ? ` – ${r.endDate}` : ''), render: (r) => { const d = new Date(`${r.startDate}T12:00:00Z`); return <span className="dt-date"><b>{d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</b><small>{d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</small></span>; }, width: '84px' },
    { key: 'title', header: 'Event', sort: (r) => r.title, csv: (r) => r.title, render: (r) => <div className="min-w-0"><Link className="title" to={`/studio/events/${r.id}`}>{r.title}</Link><div className="sub">{[r.pillarName, r.online ? (r.location ? `${r.location} · Online` : 'Online') : r.location, r.endDate && r.endDate !== r.startDate ? `until ${dateLabel(r.endDate)}` : ''].filter(Boolean).join(' · ') || 'No pillar or place yet'}</div></div> },
    { key: 'kind', header: 'Type', sort: (r) => r.kind, csv: (r) => r.kind, hideBelow: 900, render: (r) => <span className="pill">{r.kind}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} />{!up(r) && <span className="pill">Past</span>}</div> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  const live = (rows ?? []).filter((r) => r.publishedRevisionId).length;
  return <>
    <div className="page-h"><div><h1>Events</h1><p>Workshops, trainings, community days and online sessions. Events move from Upcoming to Past on their own after the last day.</p></div>
      {can('event.create') && <button className="btn btn-primary" onClick={create}><Icon n="plus" />New event</button>}</div>
    {rows && live === 0 && <div className="notice n-info"><div>The Events page currently shows <b>sample events</b>. They are replaced by your real calendar as soon as the first event is published here.</div></div>}
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search events or places" />
      {!rows ? <Loading /> : <DataTable id="events" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-events"
        initialSort={{ key: 'date', dir: st.status === 'upcoming' ? 'asc' : 'desc' }}
        actions={workflowActions<Row>({ base: '/events', noun: ['event', 'events'], name: (r) => r.title, canUpdate: can('event.update'), reload: load, post, toast })}
        onOpen={(r) => navigate(`/studio/events/${r.id}`)}
        empty={<EmptyState icon="calendar" text={st.status === 'upcoming' ? 'No upcoming events' : 'No events match these filters'} onClear={st.q ? () => set('q', '') : undefined} />} />}
    </section>
  </>;
}

type Form = { title: string; slug: string; kind: string; summary: string; body: string; startDate: string; endDate: string | null; timeLabel: string; location: string; online: boolean; pillarKey: string | null; projectSlug: string | null; posterMediaId: string | null; agenda: { title: string; text: string }[]; audience: string[]; registration: 'none' | 'contact' | 'external'; registrationUrl: string; recapArticleSlug: string | null; seoTitle: string; seoDescription: string };
const KEYS: (keyof Form)[] = ['title', 'slug', 'kind', 'summary', 'body', 'startDate', 'endDate', 'timeLabel', 'location', 'online', 'pillarKey', 'projectSlug', 'posterMediaId', 'agenda', 'audience', 'registration', 'registrationUrl', 'recapArticleSlug', 'seoTitle', 'seoDescription'];
type Loaded = Form & { id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; media: MediaItem[]; problems: string[]; kinds: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

export function EventEditor({ id }: { id: string }) {
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
    setDirty(false); setSlugTouched(!d.title.startsWith('Untitled') || !d.slug.startsWith('event-'));
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
    <div className="page-h">
      <div><Link to="/studio/events" className="muted" style={{ fontSize: 13 }}>← Events</Link><h1>{f.title || 'Event'}</h1>
        <p><span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} /><span className="pill">{past ? 'Past' : 'Upcoming'}</span></span><span className="mono muted" style={{ marginLeft: 8, fontSize: 12 }}>{file}</span>{dirty && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Unsaved</span>}</p></div>
      <div className="pills">
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
      </div>
    </div>
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {!editable && can('event.update') && <div className="notice n-info"><div>{status === 'in_review' ? 'In review: read-only. Withdraw it to edit.' : 'Archived. Restore it to edit.'}</div></div>}

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(280px,1fr)', gap: 16, alignItems: 'start' }} className="ev-grid">
      <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }} disabled={!editable}>
        <section className="card stack" style={{ padding: 20 }}>
          <Fld label="Title"><input className="input" maxLength={140} value={f.title} onChange={(x) => set('title', x.target.value)} aria-label="Title" /></Fld>
          <Fld label="Short description" hint={`${f.summary.length} / 320 · shown in the calendar and search results`}><textarea className="textarea" maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value.replace(/\n/g, ' '))} aria-label="Short description" /></Fld>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Type"><select className="select" value={f.kind} onChange={(x) => set('kind', x.target.value)} aria-label="Type">{e.kinds.map((k) => <option key={k}>{k}</option>)}</select></Fld>
            <Fld label="Pillar"><select className="select" value={f.pillarKey ?? ''} onChange={(x) => set('pillarKey', x.target.value || null)} aria-label="Pillar"><option value="">Choose…</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Fld>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Fld label="Date"><input className="input" type="date" value={f.startDate} onChange={(x) => set('startDate', x.target.value)} aria-label="Date" /></Fld>
            <Fld label="Ends (optional)" hint="For events over several days."><input className="input" type="date" value={f.endDate ?? ''} min={f.startDate} onChange={(x) => set('endDate', x.target.value || null)} aria-label="End date" /></Fld>
            <Fld label="Time" hint="e.g. 10:00 – 13:00, Full day"><input className="input" maxLength={60} value={f.timeLabel} onChange={(x) => set('timeLabel', x.target.value)} aria-label="Time" /></Fld>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'end' }}>
            <Fld label="Place" hint="Town or venue as people should read it."><input className="input" maxLength={120} value={f.location} onChange={(x) => set('location', x.target.value)} aria-label="Place" /></Fld>
            <label className="check" style={{ paddingBottom: 18 }}><input type="checkbox" checked={f.online} onChange={(x) => set('online', x.target.checked)} /><span>Online</span></label>
          </div>
          <Fld label="About this event" hint="Optional. Blank line = new paragraph; ## Subheading, **bold**, [link](https://…) work."><textarea className="textarea" style={{ minHeight: 140 }} maxLength={20000} value={f.body} onChange={(x) => set('body', x.target.value)} aria-label="About this event" /></Fld>
        </section>
        <section className="card stack" style={{ padding: 20 }}>
          <Fld label="Agenda" hint="Optional. Leave empty to hide the agenda.">
            {f.agenda.map((a, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8 }}>
              <input className="input" maxLength={80} placeholder="e.g. 10:00 Welcome" value={a.title} onChange={(x) => set('agenda', f.agenda.map((y, j) => j === i ? { ...y, title: x.target.value } : y))} aria-label={`Agenda item ${i + 1}`} />
              <input className="input" maxLength={240} placeholder="What happens" value={a.text} onChange={(x) => set('agenda', f.agenda.map((y, j) => j === i ? { ...y, text: x.target.value } : y))} aria-label={`Agenda item ${i + 1} details`} />
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove item" onClick={() => set('agenda', f.agenda.filter((_, j) => j !== i))}><Icon n="x" /></button></div>)}
            {f.agenda.length < 12 && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => set('agenda', [...f.agenda, { title: '', text: '' }])}><Icon n="plus" />Add agenda item</button>}</Fld>
          <Fld label="Who it’s for" hint="One per line, up to 8. Leave empty to hide."><textarea className="textarea" value={f.audience.join('\n')} onChange={(x) => set('audience', x.target.value.split('\n').map((s) => s.trimStart()).filter((s, i, arr) => s || i === arr.length - 1).slice(0, 8))} onBlur={() => set('audience', f.audience.map((s) => s.trim()).filter(Boolean))} aria-label="Who it’s for" /></Fld>
          <Fld label="Poster" hint="Square images work best. Without one, a placeholder is shown.">
            {f.posterMediaId && poster ? <div className="thumb" style={{ width: 160 }}><img src={poster.url} alt={poster.alt} /><button type="button" aria-label="Remove poster" onClick={() => set('posterMediaId', null)}>×</button></div> : <div className="muted">No poster</div>}
            <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('poster')}><Icon n="image" />{f.posterMediaId ? 'Change' : 'Choose'} poster</button></Fld>
        </section>
        <section className="card stack" style={{ padding: 20 }}>
          <Fld label="Registration"><select className="select" value={f.registration} onChange={(x) => set('registration', x.target.value as Form['registration'])} aria-label="Registration">
            <option value="contact">Register interest through the contact form</option><option value="external">Link to an external registration form</option><option value="none">No registration (open event)</option></select></Fld>
          {f.registration === 'external' && <Fld label="Registration link"><input className="input mono" maxLength={500} placeholder="https://…" value={f.registrationUrl} onChange={(x) => set('registrationUrl', x.target.value.trim())} aria-label="Registration link" /></Fld>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Project (optional)" hint="Live projects only."><select className="select" value={f.projectSlug ?? ''} onChange={(x) => set('projectSlug', x.target.value || null)} aria-label="Project"><option value="">None</option>{projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Fld>
            <Fld label="Recap story (optional)" hint="Shown once the event has passed."><select className="select" value={f.recapArticleSlug ?? ''} onChange={(x) => set('recapArticleSlug', x.target.value || null)} aria-label="Recap story"><option value="">None</option>{stories.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}</select></Fld>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="SEO title" hint={`${f.seoTitle.length} / 70 · empty = title`}><input className="input" maxLength={70} value={f.seoTitle} onChange={(x) => set('seoTitle', x.target.value)} aria-label="SEO title" /></Fld>
            <Fld label="Page address" hint={live ? 'A live event’s address cannot change.' : undefined}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="mono muted">event-</span><input className="input mono" aria-label="Page address" disabled={live} value={f.slug} onChange={(x) => { setSlugTouched(true); set('slug', slugify(x.target.value)); }} /></div></Fld>
          </div>
          <Fld label="Meta description" hint={`${f.seoDescription.length} / 170 · empty = short description`}><textarea className="textarea" maxLength={170} value={f.seoDescription} onChange={(x) => set('seoDescription', x.target.value)} aria-label="Meta description" /></Fld>
        </section>
      </fieldset>

      <section className="card stack" style={{ padding: 20, position: 'sticky', top: 16 }}>
        <dl className="kv"><dt>Website</dt><dd>{live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'}</dd>{e.publishedAt && <><dt>Published</dt><dd>{fmtDate(e.publishedAt)}</dd></>}<dt>Calendar</dt><dd>{past ? 'Past event' : 'Upcoming'}</dd></dl>
        {live && <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open live event</a>}
        {e.problems.length > 0 && status !== 'archived' && <div className="notice n-warn"><div><b>Before review</b><ul>{e.problems.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        {['draft', 'changes_requested'].includes(status) && can('event.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('event.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('event.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('event.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('event.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('event.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this event?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('event.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        <small className="muted">History</small>
        <ol className="timeline">{e.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === e.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
          {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/events/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
          {e.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol>
      </section>
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
