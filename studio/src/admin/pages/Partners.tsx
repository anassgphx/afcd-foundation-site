// Partners: canonical organisation records (one per organisation), with logo, links to projects and the review workflow.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, workflowActions, type Column } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

const SCOPES: [string, string][] = [['international', 'International'], ['national', 'National'], ['local', 'Local']];
const scopeLabel = (s: string) => SCOPES.find((x) => x[0] === s)?.[1] ?? s;
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

type Row = { id: string; slug: string; name: string; scope: string; category: string; current: boolean; status: string; sort: number; logoMediaId: string | null; websiteUrl: string; publishedRevisionId: string | null; updatedAt: string; projects: number };

export function PartnersList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null); const [st, set] = useUrlState({ status: 'all', q: '' }); const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [scope, setScope] = useState('national'); const [err, setErr] = useState('');
  const load = () => api<Row[]>('/partners').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function create() {
    setErr('');
    try { const r = await post<{ id: string }>('/partners', { name: name.trim(), slug: slugify(name) || `partner-${Date.now().toString(36)}`, scope }); navigate(`/studio/partners/${r.id}`); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the partner.'); }
  }
  async function importList() {
    setBusy(true);
    try { const r = await post<{ imported: number; skipped: number }>('/partners/import'); toast(`Imported ${r.imported} partners from the current website`); await load(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const is = (k: string, r: Row) => (k === 'all' ? r.status !== 'archived' : k === 'live' ? !!r.publishedRevisionId : ['international', 'national', 'local'].includes(k) ? r.scope === k && r.status !== 'archived' : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => !st.q || `${r.name} ${r.category}`.toLowerCase().includes(st.q.toLowerCase()));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['all', 'All'], ['international', 'International'], ['national', 'National'], ['local', 'Local'], ['in_review', 'In review'], ['draft', 'Drafts'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const initials = (n: string) => n.replace(/[()]/g, '').split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w) && !['of', 'in', 'for', 'the', 'and'].includes(w.toLowerCase())).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Organisation', sort: (r) => r.name, csv: (r) => r.name, render: (r) => <div className="dt-main"><span className="dt-thumb dt-initials">{initials(r.name)}</span><span className="min-w-0">
      <Link className="title" to={`/studio/partners/${r.id}`}>{r.name}</Link><span className="sub">{[r.category, r.current ? '' : 'Past partner', r.logoMediaId ? 'Logo' : 'No logo', r.websiteUrl ? 'Website' : ''].filter(Boolean).join(' · ')}</span></span></div> },
    { key: 'scope', header: 'Scope', sort: (r) => r.scope, csv: (r) => scopeLabel(r.scope), render: (r) => <span className="pill">{scopeLabel(r.scope)}</span> },
    { key: 'projects', header: 'Projects', sort: (r) => -r.projects, csv: (r) => String(r.projects), align: 'right', hideBelow: 900, render: (r) => <span className="sub">{r.projects || '—'}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  const missingLogo = (rows ?? []).filter((r) => r.publishedRevisionId && !r.logoMediaId).length;
  return <>
    <div className="page-h"><div><h1>Partners</h1><p>One record per organisation. Changes reach the Our Partners page only after review and publishing.</p></div>
      {can('partner.create') && <button className="btn btn-primary" onClick={() => { setName(''); setErr(''); setAdding(true); }}><Icon n="plus" />Add partner</button>}</div>
    {rows && rows.length === 0 && <div className="notice n-info"><div><b>No partner records yet.</b> The website shows its built-in list of {''}partners. Import it to manage those organisations here; nothing changes on the website until something is published.</div>
      {can('partner.publish') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={importList}>{busy ? 'Importing…' : 'Import current list'}</button>}</div>}
    {missingLogo > 0 && <div className="notice n-info"><div>{missingLogo} live partners show initials instead of a logo. Add a logo only with the partner’s permission.</div></div>}
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search partners" />
      {!rows ? <Loading /> : <DataTable id="partners" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-partners"
        actions={workflowActions<Row>({ base: '/partners', noun: ['partner', 'partners'], name: (r) => r.name, canUpdate: can('partner.update'), reload: load, post, toast })}
        onOpen={(r) => navigate(`/studio/partners/${r.id}`)}
        empty={<EmptyState icon="partner" text="No partners match these filters" onClear={st.q || st.status !== 'all' ? () => { set('q', ''); set('status', 'all'); } : undefined} />} />}
    </section>
    {adding && <Modal size="sm" title="Add a partner" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" disabled={name.trim().length < 2} onClick={create}>Add</button></>}>
      <div className="modal-b stack">
        <Fld label="Organisation name" hint="Use the organisation’s official name. Studio blocks duplicates."><input className="input" autoFocus maxLength={140} value={name} onChange={(e) => setName(e.target.value)} aria-label="Organisation name" /></Fld>
        <Fld label="Scope"><select className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
        {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
      </div></Modal>}
  </>;
}

type Form = { name: string; slug: string; scope: string; category: string; description: string; websiteUrl: string; sinceYear: number | null; current: boolean; logoMediaId: string | null; projectSlugs: string[]; sort: number; provenance: string };
const KEYS: (keyof Form)[] = ['name', 'slug', 'scope', 'category', 'description', 'websiteUrl', 'sinceYear', 'current', 'logoMediaId', 'projectSlugs', 'sort', 'provenance'];
type Loaded = Form & { id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; verifiedAt: string | null; media: MediaItem[]; problems: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

export function PartnerEditor({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [p, setP] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [logo, setLogo] = useState<MediaItem | null>(null);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'logo' | 'preview' | 'publish' | 'unpublish' | 'changes'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    const [d, pr] = await Promise.all([api<Loaded>(`/partners/${id}`), api('/projects')]);
    setP(d); setF(Object.fromEntries(KEYS.map((k) => [k, (d as any)[k]])) as Form); setLogo(d.media[0] ?? null);
    setProjects(pr.filter((x: any) => x.publishedRevisionId)); setDirty(false);
  }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!p || !f) return <Loading />;
  const status = p.status; const live = !!p.publishedRevisionId;
  const editable = can('partner.update') && !['in_review', 'archived'].includes(status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x!, [k]: v })); setDirty(true); };
  function showErr(e: unknown) { setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [e instanceof Error ? e.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/partners/${id}`, f); await load(); toast(live ? 'Draft saved. The live listing is unchanged until you publish.' : 'Draft saved'); return true; }
    catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/partners/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/partners/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on Our Partners' : 'Removed from Our Partners'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/partners/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (e) { showErr(e); } finally { setBusy(''); }
  }

  return <>
    <div className="page-h">
      <div><Link to="/studio/partners" className="muted" style={{ fontSize: 13 }}>← Partners</Link><h1>{f.name || 'Partner'}</h1>
        <p><span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} /></span>{dirty && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Unsaved</span>}</p></div>
      <div className="pills">
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
      </div>
    </div>
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {!editable && can('partner.update') && <div className="notice n-info"><div>{status === 'in_review' ? 'In review: read-only. Withdraw it to edit.' : 'Archived. Restore it to edit.'}</div></div>}

    <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(280px,1fr)', gap: 16, alignItems: 'start' }}>
      <fieldset className="card stack" style={{ padding: 20, border: 0, margin: 0 }} disabled={!editable}>
        <Fld label="Organisation name"><input className="input" maxLength={140} value={f.name} onChange={(e) => set('name', e.target.value)} aria-label="Organisation name" /></Fld>
        <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Fld label="Scope" hint="Groups the partner on the website."><select className="select" value={f.scope} onChange={(e) => set('scope', e.target.value)} aria-label="Scope">{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
          <Fld label="Type of organisation" hint="e.g. Embassy, Foundation, Association"><input className="input" maxLength={60} value={f.category} onChange={(e) => set('category', e.target.value)} aria-label="Type of organisation" /></Fld>
        </div>
        <Fld label="What we do together" hint={`${f.description.length} / 400 · only facts AFCD can confirm`}><textarea className="textarea" maxLength={400} value={f.description} onChange={(e) => set('description', e.target.value)} aria-label="What we do together" /></Fld>
        <div className="row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Fld label="Website"><input className="input mono" maxLength={300} placeholder="https://…" value={f.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value.trim())} aria-label="Website" /></Fld>
          <Fld label="Partner since"><input className="input" type="number" min={2000} max={2100} placeholder="Year" value={f.sinceYear ?? ''} onChange={(e) => set('sinceYear', e.target.value ? Number(e.target.value) : null)} aria-label="Partner since" /></Fld>
        </div>
        <label className="check"><input type="checkbox" checked={f.current} onChange={(e) => set('current', e.target.checked)} /><span><b>Current partnership</b><br /><small className="muted">Untick for organisations that supported past programmes.</small></span></label>
        <Fld label="Logo" hint="Upload logos only with the partner’s permission, then confirm rights in Media. Without a logo the site shows initials.">
          {f.logoMediaId && logo ? <div className="thumb" style={{ width: 180, background: '#fff' }}><img src={logo.url} alt={logo.alt} style={{ objectFit: 'contain' }} /><button type="button" aria-label="Remove logo" onClick={() => set('logoMediaId', null)}>×</button></div> : <div className="muted">No logo</div>}
          <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('logo')}><Icon n="image" />{f.logoMediaId ? 'Change' : 'Choose'} logo</button></Fld>
        <Fld label="Projects with this partner" hint="Live projects only."><div className="b-checks">{projects.map((x) => <label key={x.slug} className="check"><input type="checkbox" checked={f.projectSlugs.includes(x.slug)} onChange={(e) => set('projectSlugs', e.target.checked ? [...f.projectSlugs, x.slug] : f.projectSlugs.filter((s) => s !== x.slug))} /><span>{x.name}</span></label>)}</div></Fld>
        <div className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Fld label="Order" hint="Lower comes first."><input className="input" type="number" min={0} max={10000} value={f.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} aria-label="Order" /></Fld>
          <Fld label="Source (internal)" hint="Where these details come from. Not shown on the website."><input className="input" maxLength={300} value={f.provenance} onChange={(e) => set('provenance', e.target.value)} aria-label="Source" /></Fld>
        </div>
        <Fld label="Record key" hint={live ? 'A live partner’s key cannot change.' : 'Used for links and to prevent duplicates.'}><input className="input mono" disabled={live} value={f.slug} onChange={(e) => set('slug', slugify(e.target.value))} aria-label="Record key" /></Fld>
      </fieldset>

      <section className="card stack" style={{ padding: 20 }}>
        <dl className="kv"><dt>Website</dt><dd>{live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'}</dd>{p.publishedAt && <><dt>Published</dt><dd>{fmtDate(p.publishedAt)}</dd></>}{p.verifiedAt && <><dt>Last approved</dt><dd>{fmtDate(p.verifiedAt)}</dd></>}</dl>
        {live && <a className="btn btn-sm" href={me.siteUrl + 'partners.html'} target="_blank" rel="noopener"><Icon n="ext" />Open Our Partners</a>}
        {p.problems.length > 0 && status !== 'archived' && <div className="notice n-warn"><div><b>Before review</b><ul>{p.problems.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        {['draft', 'changes_requested'].includes(status) && can('partner.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('partner.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('partner.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('partner.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('partner.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('partner.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this partner?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('partner.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        <small className="muted">History</small>
        <ol className="timeline">{p.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === p.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
          {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/partners/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
          {p.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol>
      </section>
    </div>

    {dialog === 'logo' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setLogo(m[0]); set('logoMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title="Preview · Our Partners with this draft" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Partners preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this partner?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">partners.html</span> and checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The organisation is removed from Our Partners. It stays in Studio as a draft with its history.</p></div></Modal>}
  </>;
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
}
