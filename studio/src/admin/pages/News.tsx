// News & Stories: list + distraction-free writing workspace with details, links, media, SEO and publishing.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, workflowActions, type Column } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import '../writer.css';

export const TYPES: [string, string][] = [['programme_news', 'Programme news'], ['participant_story', 'Participant story'], ['call_for_applications', 'Call for applications'], ['event_recap', 'Event recap']];
const typeLabel = (t: string) => TYPES.find((x) => x[0] === t)?.[1] ?? t;
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const today = () => new Date().toISOString().slice(0, 10);

type Row = { id: string; slug: string; title: string; type: string; status: string; publishDate: string; featured: boolean; externalUrl: string; scheduledAt: string | null; publishedRevisionId: string | null; updatedAt: string; pillars: { name: string; colour: string }[] };

export function NewsList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [st, set] = useUrlState({ status: 'all', type: 'all', q: '' });
  const load = () => api<Row[]>('/news').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function create() {
    const r = await post<{ id: string }>('/news', { title: 'Untitled story', slug: `story-${Date.now().toString(36)}`, publishDate: today() });
    navigate(`/studio/news/${r.id}`);
  }
  const is = (k: string, r: Row) => (k === 'all' ? r.status !== 'archived' : k === 'live' ? !!r.publishedRevisionId : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => (st.type === 'all' || r.type === st.type) && (!st.q || `${r.title} ${r.slug}`.toLowerCase().includes(st.q.toLowerCase())));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['scheduled', 'Scheduled'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const columns: Column<Row>[] = [
    { key: 'title', header: 'Story', sort: (r) => r.title, csv: (r) => r.title, render: (r) => <div className="dt-main"><span className="dt-thumb"><Icon n="log" /></span><span className="min-w-0">
      <Link className="title" to={`/studio/news/${r.id}`}>{r.title}</Link><span className="sub">{[r.pillars.map((p) => p.name).join(' · ') || 'No pillar yet', r.featured && 'Featured', r.externalUrl && 'Old blog link'].filter(Boolean).join(' · ')}</span></span></div> },
    { key: 'type', header: 'Type', sort: (r) => typeLabel(r.type), csv: (r) => typeLabel(r.type), hideBelow: 900, render: (r) => <span className="pill">{typeLabel(r.type)}</span> },
    { key: 'date', header: 'Date', sort: (r) => r.publishDate, csv: (r) => r.publishDate, render: (r) => <span className="sub" style={{ whiteSpace: 'nowrap' }}>{r.publishDate}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} label={r.status === 'scheduled' && r.scheduledAt ? `Scheduled · ${fmtDate(r.scheduledAt)}` : undefined} /></div> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  return <>
    <div className="page-h"><div><h1>News & Stories</h1><p>Programme news, participant stories, calls for applications and event recaps.</p></div>
      {can('news.create') && <button className="btn btn-primary" onClick={create}><Icon n="plus" />New story</button>}</div>
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search stories">
        <select className="select" value={st.type} onChange={(e) => set('type', e.target.value)} aria-label="Type"><option value="all">All types</option>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </ListToolbar>
      {!rows ? <Loading /> : <DataTable id="news" rows={shown} total={base.filter((r) => is('all', r)).length} rowKey={(r) => r.id} columns={columns} csvName="afcd-stories" initialSort={{ key: 'date', dir: 'desc' }}
        actions={workflowActions<Row>({ base: '/news', noun: ['story', 'stories'], name: (r) => r.title, canUpdate: can('news.update'), reload: load, post, toast })}
        onOpen={(r) => navigate(`/studio/news/${r.id}`)}
        empty={<EmptyState icon="log" text="No stories match these filters" onClear={st.q || st.type !== 'all' || st.status !== 'all' ? () => { set('q', ''); set('type', 'all'); set('status', 'all'); } : undefined} />} />}
    </section>
  </>;
}

type Form = { title: string; slug: string; excerpt: string; body: string; type: string; tags: string[]; authorName: string; authorRole: string; publishDate: string; featured: boolean; externalUrl: string; heroMediaId: string | null; galleryMediaIds: string[]; pillarKeys: string[]; projectSlugs: string[]; seoTitle: string; seoDescription: string };
type Loaded = Form & { id: string; status: string; scheduledAt: string | null; publishedRevisionId: string | null; publishedAt: string | null; media: MediaItem[]; problems: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
const KEYS: (keyof Form)[] = ['title', 'slug', 'excerpt', 'body', 'type', 'tags', 'authorName', 'authorRole', 'publishDate', 'featured', 'externalUrl', 'heroMediaId', 'galleryMediaIds', 'pillarKeys', 'projectSlugs', 'seoTitle', 'seoDescription'];

export function ArticleEditor({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [a, setA] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [media, setMedia] = useState<Record<string, MediaItem>>({});
  const [pillars, setPillars] = useState<{ key: string; name: string; colour: string }[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [tab, setTab] = useState<'details' | 'links' | 'media' | 'seo' | 'translations' | 'publish'>('details');
  const [trOpen, setTrOpen] = useState(false);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'hero' | 'gallery' | 'preview' | 'publish' | 'unpublish' | 'changes' | 'schedule'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState(''); const [when, setWhen] = useState('');
  const [slugTouched, setSlugTouched] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const [d, p, pr] = await Promise.all([api<Loaded>(`/news/${id}`), api('/pillars'), api('/projects')]);
    setA(d); setF(Object.fromEntries(KEYS.map((k) => [k, (d as any)[k]])) as Form);
    setMedia(Object.fromEntries(d.media.map((m) => [m.id, m]))); setPillars(p); setProjects(pr.filter((x: any) => x.publishedRevisionId));
    setDirty(false); setSlugTouched(!d.title.startsWith('Untitled') || !d.slug.startsWith('story-'));
  }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!a || !f) return <Loading />;
  const status = a.status; const live = !!a.publishedRevisionId;
  const editable = can('news.update') && !['in_review', 'scheduled', 'archived'].includes(status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => { const n = { ...x!, [k]: v }; if (k === 'title' && !slugTouched && !live) n.slug = slugify(String(v)) || x!.slug; return n; }); setDirty(true); };
  const words = f.body.split(/\s+/).filter(Boolean).length;

  function showErr(e: unknown) { setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [e instanceof Error ? e.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/news/${id}`, f); await load(); toast(live ? 'Draft saved. The live story is unchanged until you publish.' : 'Draft saved'); return true; }
    catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/news/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', schedule: 'Scheduled', unschedule: 'Unscheduled', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/news/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'Removed from the website'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/news/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (e) { showErr(e); } finally { setBusy(''); }
  }
  const wrap = (pre: string, post_: string, ph: string) => {
    const el = bodyRef.current!; const s = el.selectionStart, e = el.selectionEnd; const sel = f.body.slice(s, e) || ph;
    set('body', f.body.slice(0, s) + pre + sel + post_ + f.body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + pre.length, s + pre.length + sel.length); });
  };
  const file = f.externalUrl ? null : `news-${f.slug}.html`;
  const onBodyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); wrap('**', '**', 'bold text'); }
    else if (k === 'i') { e.preventDefault(); wrap('*', '*', 'italic text'); }
    else if (k === 'k') { e.preventDefault(); wrap('[', '](about.html)', 'link text'); }
  };
  const problems = a.problems;
  const canSubmit = ['draft', 'changes_requested'].includes(status) && can('news.update');
  const canPublish = status === 'approved' && can('news.publish');
  const hero = f.heroMediaId ? media[f.heroMediaId] : null;
  const TABS = [['details', 'Details', 'log'], ['links', 'Links', 'layers'], ['media', 'Media', 'image'], ['seo', 'SEO', 'search'], ['translations', 'FR · AR', 'globe'], ['publish', 'Publish', 'rocket']] as const;

  return <div className="writer">
    <div className="b-bar wr-bar">
      <button className="btn btn-ghost icon-btn" onClick={() => navigate('/studio/news')} aria-label="Back to stories"><Icon n="chev" style={{ transform: 'rotate(180deg)' }} /></button>
      <div className="b-title"><b>{f.title || 'Untitled story'}</b><span className="mono muted">{file ?? 'Links to the old blog'}</span></div>
      <span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} label={status === 'scheduled' && a.scheduledAt ? `Scheduled · ${fmtDate(a.scheduledAt)}` : undefined} /></span>
      <span className={`wr-save${dirty ? ' dirty' : ''}`} role="status">{busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <span style={{ flex: 1 }} />
      <span className="wr-stats" title="Reading time at about 200 words a minute">{words.toLocaleString('en-GB')} word{words === 1 ? '' : 's'} · {Math.max(1, Math.round(words / 200))} min read</span>
      <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
      {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
      {!dirty && canSubmit && <button className="btn btn-primary" disabled={!!busy || problems.length > 0} title={problems.length ? `${problems.length} thing${problems.length === 1 ? '' : 's'} to fix first (see Publish)` : undefined} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
      {!dirty && canPublish && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
    </div>
    {errs.length > 0 && <div className="notice n-warn b-notice" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {!editable && can('news.update') && <div className="notice n-info b-notice">{status === 'in_review' ? 'In review: read-only. Withdraw it to edit.' : status === 'scheduled' ? 'Scheduled: read-only. Unschedule it to edit.' : status === 'archived' ? 'Archived. Restore it to edit.' : ''}</div>}

    <div className="w-body">
      <fieldset className="w-paper" disabled={!editable}>
        {hero ? <figure className="wr-cover"><img src={hero.url} alt={hero.alt} />
            {editable && <span className="wr-cover-acts"><button type="button" className="btn btn-sm" onClick={() => setDialog('hero')}><Icon n="image" />Change</button><button type="button" className="btn btn-sm" onClick={() => set('heroMediaId', null)}>Remove</button></span>}</figure>
          : editable && <button type="button" className="wr-cover-add" onClick={() => setDialog('hero')}><Icon n="image" /><span><b>Add a cover photo</b><small>Shown at the top of the story and on its card. Without one, a neutral placeholder is used.</small></span></button>}
        <textarea className="w-title" rows={1} maxLength={160} placeholder="Story title" value={f.title} onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))} aria-label="Title" />
        <button type="button" className="wr-meta" onClick={() => setTab('details')} title="Edit in Details">
          <span>{typeLabel(f.type)}</span><span>{f.publishDate ? new Date(`${f.publishDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'No date'}</span>
          <span>{f.authorName ? `By ${f.authorName}${f.authorRole ? `, ${f.authorRole}` : ''}` : 'No author yet'}</span>{f.tags.length > 0 && <span>{f.tags.slice(0, 3).join(', ')}</span>}
        </button>
        <div className="wr-excerpt">
          <textarea className="w-excerpt" rows={2} maxLength={320} placeholder="A one or two sentence summary for cards and search results" value={f.excerpt} onChange={(e) => set('excerpt', e.target.value.replace(/\n/g, ' '))} aria-label="Summary" />
          <small className={f.excerpt.length > 160 ? 'warn' : ''}>{f.excerpt.length} / 160 recommended{f.excerpt.length > 160 ? ' · search results cut it here' : ''}</small>
        </div>
        <div className="w-tools wr-tools" role="toolbar" aria-label="Formatting">
          <span className="wr-group"><button type="button" onClick={() => wrap('\n\n## ', '\n\n', 'Subheading')} aria-label="Subheading">H2</button></span>
          <span className="wr-group"><button type="button" onClick={() => wrap('**', '**', 'bold text')} aria-label="Bold" aria-keyshortcuts="Meta+B" title="Bold · ⌘B"><b>B</b></button>
            <button type="button" onClick={() => wrap('*', '*', 'italic text')} aria-label="Italic" aria-keyshortcuts="Meta+I" title="Italic · ⌘I"><i>I</i></button>
            <button type="button" onClick={() => wrap('[', '](about.html)', 'link text')} aria-label="Link" aria-keyshortcuts="Meta+K" title="Link · ⌘K"><Icon n="ext" width={14} height={14} />Link</button></span>
          <span className="wr-group"><button type="button" onClick={() => wrap('\n\n> ', '\n\n', 'A quote from a participant')} aria-label="Quote">“ Quote</button>
            <button type="button" onClick={() => wrap('\n\n- ', '\n', 'List item')} aria-label="Bulleted list">• List</button></span>
          <span className="wr-hint">Blank line = new paragraph · ⌘S saves</span>
        </div>
        <textarea ref={bodyRef} className="w-text" placeholder={f.externalUrl ? 'This story links to the old blog. Write it here to publish it on the new site, then clear the old-blog link.' : 'Write the story…'} value={f.body} maxLength={30000} onChange={(e) => set('body', e.target.value)} onKeyDown={onBodyKey} aria-label="Story text" />
      </fieldset>

      <aside className="w-side">
        {problems.length > 0 && ['draft', 'changes_requested'].includes(status) && <button type="button" className="wr-ready" onClick={() => setTab('publish')}>
          <span className="wr-ready-n">{problems.length}</span><span><b>{problems.length === 1 ? '1 thing' : `${problems.length} things`} before review</b><small>{problems[0]}{problems.length > 1 ? ` · +${problems.length - 1} more` : ''}</small></span><Icon n="chev" width={14} height={14} /></button>}
        {problems.length === 0 && ['draft', 'changes_requested'].includes(status) && <div className="wr-ready ok"><span className="wr-ready-n"><Icon n="check" width={13} height={13} /></span><span><b>Ready for review</b><small>Everything a reviewer needs is filled in.</small></span></div>}
        <div className="wr-tabs" role="tablist" aria-label="Story settings">{TABS.map(([k, l, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
          <Icon n={ic} width={16} height={16} /><span>{l}</span>{k === 'publish' && problems.length > 0 && ['draft', 'changes_requested'].includes(status) && <i className="wr-dot" aria-label={`${problems.length} to fix`} />}</button>)}</div>
        <fieldset className="b-insp stack" disabled={!editable && tab !== 'publish' && tab !== 'translations'}>
          {tab === 'details' && <>
            <Fld label="Type"><select className="select" value={f.type} onChange={(e) => set('type', e.target.value)} aria-label="Type">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
            <Fld label="Date shown"><input className="input" type="date" value={f.publishDate} onChange={(e) => set('publishDate', e.target.value)} aria-label="Date shown" /></Fld>
            <div className="row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Fld label="Author"><input className="input" maxLength={80} value={f.authorName} onChange={(e) => set('authorName', e.target.value)} aria-label="Author" placeholder="Name" /></Fld>
              <Fld label="Author role"><input className="input" maxLength={120} value={f.authorRole} onChange={(e) => set('authorRole', e.target.value)} aria-label="Author role" placeholder="e.g. Participant" /></Fld>
            </div>
            <Fld label="Topics" hint="Comma-separated, up to 8."><input className="input" value={f.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8))} aria-label="Topics" /></Fld>
            <label className="check"><input type="checkbox" checked={f.featured} onChange={(e) => set('featured', e.target.checked)} /><span><b>Feature on News & Stories</b><br /><small className="muted">Shown large at the top of the listing.</small></span></label>
            <Fld label="Page address" hint={live ? 'A live story’s address cannot change.' : undefined}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="mono muted">news-</span><input className="input mono" aria-label="Page address" disabled={live} value={f.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} /></div></Fld>
            <Fld label="Old blog link" hint="Only for stories that still live on the old blog. Leave empty to publish here."><input className="input mono" value={f.externalUrl} onChange={(e) => set('externalUrl', e.target.value.trim())} aria-label="Old blog link" placeholder="https://…" /></Fld>
          </>}
          {tab === 'links' && <>
            <Fld label="Pillars" hint="The first one ticked is the main pillar.">{pillars.map((p) => <label key={p.key} className="check"><input type="checkbox" checked={f.pillarKeys.includes(p.key)} onChange={(e) => set('pillarKeys', e.target.checked ? [...f.pillarKeys, p.key] : f.pillarKeys.filter((k) => k !== p.key))} /><span><span className="dot" style={{ ['--c' as string]: p.colour, marginRight: 6 }} />{p.name}{f.pillarKeys[0] === p.key ? ' · main' : ''}</span></label>)}</Fld>
            <Fld label="Related projects" hint="Live projects only; shown at the end of the story."><div className="b-checks">{projects.map((p) => <label key={p.slug} className="check"><input type="checkbox" checked={f.projectSlugs.includes(p.slug)} onChange={(e) => set('projectSlugs', e.target.checked ? [...f.projectSlugs, p.slug] : f.projectSlugs.filter((s) => s !== p.slug))} /><span>{p.name}</span></label>)}</div></Fld>
          </>}
          {tab === 'media' && <>
            <Fld label="Hero photo">{f.heroMediaId && media[f.heroMediaId] ? <div className="thumb" style={{ width: '100%' }}><img src={media[f.heroMediaId].url} alt={media[f.heroMediaId].alt} /><button type="button" aria-label="Remove hero photo" onClick={() => set('heroMediaId', null)}>×</button></div> : <div className="muted">No photo: a placeholder is shown.</div>}
              <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('hero')}><Icon n="image" />{f.heroMediaId ? 'Change' : 'Choose'} photo</button></Fld>
            <Fld label="Gallery" hint="Shown under the story."><div className="thumbs">{f.galleryMediaIds.map((m) => media[m] && <div key={m} className="thumb"><img src={media[m].url} alt={media[m].alt} /><button type="button" aria-label="Remove" onClick={() => set('galleryMediaIds', f.galleryMediaIds.filter((x) => x !== m))}>×</button></div>)}</div>
              <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('gallery')}><Icon n="plus" />Add photos</button></Fld>
          </>}
          {tab === 'seo' && <>
            <Fld label="SEO title" hint={`${f.seoTitle.length} / 70 · empty = story title`}><input className="input" maxLength={70} value={f.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} aria-label="SEO title" /></Fld>
            <Fld label="Meta description" hint={`${f.seoDescription.length} / 170 · empty = summary`}><textarea className="textarea" maxLength={170} value={f.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} aria-label="Meta description" /></Fld>
            <div className="card" style={{ padding: 12, background: 'var(--sunken)' }}><small className="muted">Search result preview</small><div style={{ color: '#1a0dab', fontSize: 16 }}>{f.seoTitle || f.title} · AFCD Foundation</div><div style={{ color: '#006621', fontSize: 12 }}>afcdfoundation.org › {file ?? 'news.html'}</div><div style={{ fontSize: 12.5 }}>{(f.seoDescription || f.excerpt).slice(0, 160)}</div></div>
          </>}
          {tab === 'translations' && <>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>French and Arabic of this story: its title, summary and text as the website shows them. Reviewed and published on the Translations screen.</p>
            <button type="button" className="btn" onClick={() => setTrOpen(true)}><Icon n="globe" />Open translations</button>
          </>}
          {tab === 'publish' && <>
            <dl className="kv"><dt>Website</dt><dd>{live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'}</dd>{a.publishedAt && <><dt>Published</dt><dd>{fmtDate(a.publishedAt)}</dd></>}{a.scheduledAt && <><dt>Scheduled</dt><dd>{fmtDate(a.scheduledAt)}</dd></>}</dl>
            {live && <a className="btn btn-sm" href={f.externalUrl || me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open live story</a>}
            {a.problems.length > 0 && !['archived', 'scheduled'].includes(status) && <div className="notice n-warn"><div><b>Before review</b><ul>{a.problems.map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
            {['draft', 'changes_requested'].includes(status) && can('news.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
            {status === 'in_review' && can('news.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
            {status === 'approved' && can('news.publish') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish now</button><button className="btn" onClick={() => { setWhen(''); setDialog('schedule'); }}><Icon n="clock" />Schedule…</button></>}
            {status === 'scheduled' && can('news.publish') && <button className="btn" disabled={!!busy} onClick={() => act('unschedule')}>Unschedule</button>}
            {['in_review', 'approved'].includes(status) && can('news.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
            {live && can('news.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
            {!live && !['archived', 'scheduled'].includes(status) && can('news.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this story?')) act('archive'); }}><Icon n="archive" />Archive</button>}
            {status === 'archived' && can('news.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
            <small className="muted">History</small>
            <ol className="timeline">{a.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === a.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
              {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/news/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
              {a.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol>
          </>}
        </fieldset>
      </aside>
    </div>

    {dialog === 'hero' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setMedia((x) => ({ ...x, [m[0].id]: m[0] })); set('heroMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'gallery' && <MediaPicker multiple onClose={() => setDialog(null)} onPick={(m) => { setMedia((x) => ({ ...x, ...Object.fromEntries(m.map((i) => [i.id, i])) })); set('galleryMediaIds', [...new Set([...f.galleryMediaIds, ...m.map((i) => i.id)])].slice(0, 12)); setDialog(null); }} />}
    {trOpen && <Modal wide title={`Languages · ${f.title || 'Story'}`} onClose={() => setTrOpen(false)}><div className="modal-b" style={{ overflow: 'auto' }}>
      <RecordTranslations noun="story" dirty={status !== 'published'} files={f.externalUrl || !f.slug ? [] : [`news-${f.slug}.html`]} fields={[{ label: 'Story title', value: f.title }, { label: 'Summary', value: f.excerpt }, ...f.body.split(/\n{2,}/).map((x) => ({ label: 'Story text', value: x.replace(/^[>#-]+\s*/, '') })), { label: 'SEO title', value: f.seoTitle }, { label: 'Meta description', value: f.seoDescription }]} />
    </div></Modal>}
    {dialog === 'preview' && <Modal wide title="Preview · the real story page" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Story preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'schedule' && <Modal size="sm" title="Schedule publishing" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!when || !!busy} onClick={() => act('schedule', { at: new Date(when).toISOString() })}>Schedule</button></>}>
      <div className="modal-b stack"><Fld label="Publish on" hint="Your local time. Studio must be running at that time; the result appears on the Publishing page."><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Publish on" /></Fld></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this story?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish now'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds {file ? <span className="mono">{file}</span> : 'the listing card'} and News &amp; Stories, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The story page and its card are removed. It stays in Studio as a draft with its history.</p></div></Modal>}
  </div>;
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
}
