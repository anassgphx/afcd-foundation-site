// Opportunities: calls for applications, volunteering, jobs, internships, consultancies and calls for partners.
// Each one gets its own page and appears on opportunities.html as Open, Opening soon or Closed (from its dates).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
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
  const can = useCan();
  const [rows, setRows] = useState<Row[] | null>(null); const [q, setQ] = useState(''); const [f, setF] = useState('all');
  useEffect(() => { api<Row[]>('/opportunities').then(setRows).catch(() => setRows([])); }, []);
  async function create() {
    const r = await post<{ id: string }>('/opportunities', { title: 'Untitled opportunity', slug: `opportunity-${Date.now().toString(36)}`, applyMethod: 'contact' });
    navigate(`/studio/opportunities/${r.id}`);
  }
  const shown = (rows ?? []).filter((r) => (f === 'all' ? r.status !== 'archived' : f === 'open' ? !!r.publishedRevisionId && stateOf(r) !== 'Closed' : f === 'closed' ? stateOf(r) === 'Closed' && r.status !== 'archived' : r.status === f)
    && (!q || r.title.toLowerCase().includes(q.toLowerCase())));
  return <>
    <div className="page-h"><div><h1>Opportunities</h1><p>Calls for applications, volunteering, internships, jobs and consultancies. They open and close on the website by their dates.</p></div>
      {can('opportunity.create') && <button className="btn btn-primary" onClick={create}><Icon n="plus" />New opportunity</button>}</div>
    {rows && !rows.some((r) => r.publishedRevisionId) && <div className="notice n-info"><div>Nothing is published yet, so the website has no Opportunities page. It appears at <span className="mono">opportunities.html</span> with the first published opportunity.</div></div>}
    <section className="card">
      <div className="card-h">
        <div className="seg" role="group" aria-label="Filter">{[['all', 'All'], ['open', 'Live & open'], ['closed', 'Closed'], ['in_review', 'In review'], ['draft', 'Drafts'], ['archived', 'Archived']].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        <label className="search"><Icon n="search" /><span className="sr-only">Search opportunities</span><input className="input" placeholder="Search opportunities" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {!rows ? <Loading /> : <div className="scroll-x"><table className="table">
        <thead><tr><th>Opportunity</th><th>Type</th><th>Deadline</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>{shown.length === 0 && <tr><td colSpan={5} className="empty">No opportunities here.</td></tr>}
          {shown.map((r) => <tr key={r.id}>
            <td><Link className="title" to={`/studio/opportunities/${r.id}`}>{r.title}</Link><div className="sub">{[r.pillarName, r.location, stateOf(r)].filter(Boolean).join(' · ')}</div></td>
            <td><span className="pill">{typeLabel(r.type)}</span></td>
            <td className="sub" style={{ whiteSpace: 'nowrap' }}>{r.deadline ? dateLabel(r.deadline) : 'Rolling'}</td>
            <td><div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div></td>
            <td className="sub">{ago(r.updatedAt)}</td></tr>)}</tbody>
      </table></div>}
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
    setDirty(false); setSlugTouched(!d.title.startsWith('Untitled') || !d.slug.startsWith('opportunity-'));
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
    <div className="page-h">
      <div><Link to="/studio/opportunities" className="muted" style={{ fontSize: 13 }}>← Opportunities</Link><h1>{f.title || 'Opportunity'}</h1>
        <p><span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} /><span className="pill">{state}</span></span><span className="mono muted" style={{ marginLeft: 8, fontSize: 12 }}>{file}</span>{dirty && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Unsaved</span>}</p></div>
      <div className="pills">
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
      </div>
    </div>
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {!editable && can('opportunity.update') && <div className="notice n-info"><div>{status === 'in_review' ? 'In review: read-only. Withdraw it to edit.' : 'Archived. Restore it to edit.'}</div></div>}

    <div className="side-layout">
      <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={!editable}>
        <section className="card stack" style={{ padding: 20 }}>
          <Fld label="Title"><input className="input" maxLength={140} value={f.title} onChange={(x) => set('title', x.target.value)} aria-label="Title" /></Fld>
          <Fld label="Short summary" hint={`${f.summary.length} / 320 · shown in the list and search results`}><textarea className="textarea" maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value.replace(/\n/g, ' '))} aria-label="Short summary" /></Fld>
          <div className="cols-2">
            <Fld label="Type"><select className="select" value={f.type} onChange={(x) => set('type', x.target.value)} aria-label="Type">{OPP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
            <Fld label="Pillar (optional)"><select className="select" value={f.pillarKey ?? ''} onChange={(x) => set('pillarKey', x.target.value || null)} aria-label="Pillar"><option value="">None</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Fld>
          </div>
          <Fld label="Description" hint="What it is, what people will do, how selection works. Blank line = new paragraph; ## Subheading, **bold**, [link](https://…) work."><textarea className="textarea" style={{ minHeight: 180 }} maxLength={20000} value={f.body} onChange={(x) => set('body', x.target.value)} aria-label="Description" /></Fld>
          <div className="cols-2">
            <Fld label="Who can apply" hint="One per line, up to 12."><Lines label="Who can apply" value={f.eligibility} max={12} onChange={(v) => set('eligibility', v)} /></Fld>
            <Fld label="What you get (optional)" hint="One per line, e.g. training, certificate, stipend."><Lines label="What you get" value={f.benefits} max={12} onChange={(v) => set('benefits', v)} /></Fld>
          </div>
        </section>
        <section className="card stack" style={{ padding: 20 }}>
          <div className="cols-2">
            <Fld label="Opens (optional)" hint="Before this date it shows as Opening soon."><input className="input" type="date" value={f.opensOn ?? ''} onChange={(x) => set('opensOn', x.target.value || null)} aria-label="Opens" /></Fld>
            <Fld label="Deadline" hint="Leave empty for rolling applications. Closes after this day (Morocco time)."><input className="input" type="date" value={f.deadline ?? ''} min={f.opensOn ?? undefined} onChange={(x) => set('deadline', x.target.value || null)} aria-label="Deadline" /></Fld>
          </div>
          <div className="cols-2">
            <Fld label="Location"><input className="input" maxLength={120} placeholder="e.g. Marrakech, Remote" value={f.location} onChange={(x) => set('location', x.target.value)} aria-label="Location" /></Fld>
            <Fld label="Commitment"><input className="input" maxLength={80} placeholder="e.g. 3 months, part-time" value={f.commitment} onChange={(x) => set('commitment', x.target.value)} aria-label="Commitment" /></Fld>
          </div>
          <Fld label="How to apply"><select className="select" value={f.applyMethod} onChange={(x) => set('applyMethod', x.target.value as Form['applyMethod'])} aria-label="How to apply">
            <option value="external">Online form (link)</option><option value="email">By email</option><option value="contact">Through the website contact form</option></select></Fld>
          {f.applyMethod === 'external' && <Fld label="Application link"><input className="input mono" maxLength={500} placeholder="https://…" value={f.applyUrl} onChange={(x) => set('applyUrl', x.target.value.trim())} aria-label="Application link" /></Fld>}
          {f.applyMethod === 'email' && <Fld label="Application email" hint="This address is shown publicly on the page."><input className="input mono" maxLength={160} placeholder="name@afcdteam.com" value={f.applyEmail} onChange={(x) => set('applyEmail', x.target.value.trim())} aria-label="Application email" /></Fld>}
          <div className="cols-2">
            <Fld label="Project (optional)" hint="Live projects only."><select className="select" value={f.projectSlug ?? ''} onChange={(x) => set('projectSlug', x.target.value || null)} aria-label="Project"><option value="">None</option>{projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Fld>
            <Fld label="Image (optional)">{f.heroMediaId && hero ? <div className="thumb" style={{ width: 160 }}><img src={hero.url} alt={hero.alt} /><button type="button" aria-label="Remove image" onClick={() => set('heroMediaId', null)}>×</button></div> : null}
              <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('hero')}><Icon n="image" />{f.heroMediaId ? 'Change' : 'Choose'} image</button></Fld>
          </div>
          <div className="cols-2">
            <Fld label="SEO title" hint={`${f.seoTitle.length} / 70 · empty = title`}><input className="input" maxLength={70} value={f.seoTitle} onChange={(x) => set('seoTitle', x.target.value)} aria-label="SEO title" /></Fld>
            <Fld label="Page address" hint={live ? 'A live opportunity’s address cannot change.' : undefined}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="mono muted">opportunity-</span><input className="input mono" aria-label="Page address" disabled={live} value={f.slug} onChange={(x) => { setSlugTouched(true); set('slug', slugify(x.target.value)); }} /></div></Fld>
          </div>
          <Fld label="Meta description" hint={`${f.seoDescription.length} / 170 · empty = summary`}><textarea className="textarea" maxLength={170} value={f.seoDescription} onChange={(x) => set('seoDescription', x.target.value)} aria-label="Meta description" /></Fld>
        </section>
      </fieldset>

      <section className="card stack side-panel" style={{ padding: 20 }}>
        <dl className="kv"><dt>Website</dt><dd>{live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'}</dd>{o.publishedAt && <><dt>Published</dt><dd>{fmtDate(o.publishedAt)}</dd></>}<dt>Applications</dt><dd>{state}{f.deadline ? ` · until ${dateLabel(f.deadline)}` : ' · rolling'}</dd></dl>
        {live && <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open live page</a>}
        {o.problems.length > 0 && status !== 'archived' && <div className="notice n-warn"><div><b>Before review</b><ul>{o.problems.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        {['draft', 'changes_requested'].includes(status) && can('opportunity.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('opportunity.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('opportunity.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('opportunity.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('opportunity.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('opportunity.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this opportunity?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('opportunity.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        <small className="muted">History</small>
        <ol className="timeline">{o.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === o.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
          {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/opportunities/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
          {o.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol>
      </section>
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
