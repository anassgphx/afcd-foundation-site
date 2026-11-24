// Partners: canonical organisation records (one per organisation), with logo, links to projects and the review workflow.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column, TableSkeleton, statusFilter, updatedFilter, useListActions } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

const SCOPES: [string, string][] = [['international', 'International'], ['national', 'National'], ['local', 'Local']];
const scopeLabel = (s: string) => SCOPES.find((x) => x[0] === s)?.[1] ?? s;
/** Initials as the Partners page shows them when there is no logo (same rule as the site generator). */
const initials = (name: string) => name.replace(/[()]/g, '').split(/\s+/).filter((x) => /^\p{L}/u.test(x) && !['of', 'in', 'for', 'the', 'and'].includes(x.toLowerCase())).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const nameKey = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const SCOPE_INFO: Record<string, string> = { international: 'Embassies, international NGOs, foundations and networks.', national: 'Moroccan institutions, associations and companies.', local: 'Communes and local groups in Al Haouz and Marrakech.' };
const thisYear = new Date().getFullYear();
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

type Row = { id: string; slug: string; name: string; scope: string; category: string; current: boolean; status: string; sort: number; logoMediaId: string | null; websiteUrl: string; publishedRevisionId: string | null; updatedAt: string; projects: number };

export function PartnersList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null); const [st, set] = useUrlState({ status: 'all', q: '' }); const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [scope, setScope] = useState('national'); const [err, setErr] = useState('');
  const load = () => api<Row[]>('/partners').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const me = useMe();
  const acts = useListActions<Row>({
    base: '/partners', noun: ['partner', 'partners'], name: (r) => r.name, reload: load,
    can: { update: can('partner.update'), approve: can('partner.approve'), publish: can('partner.publish'), archive: can('partner.update'), delete: can('partner.publish') },
    edit: (r) => `/studio/partners/${r.id}`, liveUrl: () => me.siteUrl + 'partners.html',
  });
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
    { key: 'scope', header: 'Scope', filter: { type: 'set', title: 'Scope', get: (r) => r.scope, label: scopeLabel }, sort: (r) => r.scope, csv: (r) => scopeLabel(r.scope), render: (r) => <span className="pill">{scopeLabel(r.scope)}</span> },
    { key: 'projects', header: 'Projects', sort: (r) => -r.projects, csv: (r) => String(r.projects), align: 'right', hideBelow: 900, render: (r) => <span className="sub">{r.projects || '—'}</span> },
    { key: 'status', header: 'Status', filter: statusFilter<Row>(), sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'updated', header: 'Updated', filter: updatedFilter<Row>(), align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
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
      {!rows ? <TableSkeleton /> : <DataTable id="partners" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-partners"
        actions={acts.bulk} rowMenu={acts.rowMenu}
        onOpen={(r) => navigate(`/studio/partners/${r.id}`)}
        empty={<EmptyState icon="partner" text="No partners match these filters" onClear={st.q || st.status !== 'all' ? () => { set('q', ''); set('status', 'all'); } : undefined} />} />}
    </section>
    {adding && <Modal size="sm" title="Add a partner" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" disabled={name.trim().length < 2} onClick={create}>Add</button></>}>
      <div className="modal-b stack">
        <Fld label="Organisation name" hint="Use the organisation’s official name. Studio blocks duplicates."><input className="input" autoFocus maxLength={140} value={name} onChange={(e) => setName(e.target.value)} aria-label="Organisation name" /></Fld>
        <Fld label="Scope"><select className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Fld>
        {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
      </div></Modal>}
    {acts.dialog}
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
  const [others, setOthers] = useState<{ id: string; name: string; category?: string }[]>([]);

  const load = useCallback(async () => {
    const [d, pr, all] = await Promise.all([api<Loaded>(`/partners/${id}`), api('/projects'), api<{ id: string; name: string; category?: string }[]>('/partners')]);
    setOthers(all.filter((x) => x.id !== id));
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
  const key = nameKey(f.name);
  const dupe = key.length > 2 ? others.find((o) => nameKey(o.name) === key) : undefined;
  const similar = !dupe && key.length > 4 ? others.find((o) => { const k = nameKey(o.name); return k.length > 4 && (k.includes(key) || key.includes(k)); }) : undefined;
  const site = (() => { try { const u = new URL(f.websiteUrl); return u.protocol === 'https:' || u.protocol === 'http:' ? u : null; } catch { return null; } })();
  const siteIssue = !f.websiteUrl ? '' : !site ? 'Use a full address starting with https://' : site.protocol === 'http:' ? 'Prefer the secure https:// address if the site has one.' : '';
  const years = f.sinceYear && f.sinceYear <= thisYear ? thisYear - f.sinceYear : null;
  const types = [...new Set([...others.map((o) => (o.category ?? '').trim()).filter(Boolean), 'Embassy', 'Foundation', 'Association', 'International NGO', 'University', 'Commune', 'Company', 'Network'])].sort();
  const projLeft = projects.filter((x) => !f.projectSlugs.includes(x.slug)).sort((a, b) => a.name.localeCompare(b.name));
  const logoShape = logo ? shapeOf(logo.width, logo.height) : null;
  async function trimLogo(undo = false) {
    if (!logo) return;
    setBusy('trim');
    try {
      const r = undo ? await post<MediaItem>(`/media/${logo.id}/crop`, { crop: null }) : await post<MediaItem & { trimmed: boolean }>(`/media/${logo.id}/trim`);
      setLogo({ ...logo, ...r, url: `${r.url}?v=${Date.now()}` });
      toast(undo ? 'Trim undone: the whole image is used again' : (r as { trimmed?: boolean }).trimmed ? `Trimmed to ${r.width}×${r.height}. Publish the partner to update the website.` : 'Nothing to trim: the margins are already small');
    } catch (e) { showErr(e); } finally { setBusy(''); }
  }
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
    <EditorHeader back={{ to: '/studio/partners', label: 'Partners' }} title={f.name} status={status} live={live} dirty={dirty}
      extra={<span className="pill">{SCOPES.find((x) => x[0] === f.scope)?.[1]}</span>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('partner.update') && <button className="btn btn-primary" disabled={!!busy || p.problems.length > 0} title={p.problems.length ? `${p.problems.length} thing${p.problems.length === 1 ? '' : 's'} to do first (see the publishing panel)` : undefined} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('partner.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('partner.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Organisation', icon: 'partner', done: !!f.name },
        { id: 'about', label: 'About the partnership', icon: 'log', optional: true, done: f.description || f.websiteUrl ? true : undefined },
        { id: 'logo', label: 'Logo', icon: 'image', optional: true, done: f.logoMediaId ? true : undefined },
        { id: 'projects', label: 'Projects', icon: 'folder', optional: true, done: f.projectSlugs.length ? true : undefined },
        { id: 'internal', label: 'Internal', icon: 'lock', optional: true },
        { id: 'translations', label: 'Translations', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
      <fieldset className="ed-main" disabled={!editable}>
        <Section id="basics" title="Organisation" desc="One record per organisation. Use its official name.">
          <div className="pt-top s3">
            <div className="pt-name">
              <Field label="Organisation name" count={[f.name.length, 140]} hint="Its official name, as the organisation writes it."><input className="input input-lg" maxLength={140} value={f.name} onChange={(x) => set('name', x.target.value)} aria-label="Organisation name" /></Field>
              {dupe && <p className="pt-warn" role="alert"><Icon n="alert" width={14} height={14} /><span>Another partner already has this name: <Link to={`/studio/partners/${dupe.id}`}>{dupe.name}</Link>. Keep one record per organisation.</span></p>}
              {similar && <p className="pt-note"><Icon n="alert" width={14} height={14} /><span>Similar name already listed: <Link to={`/studio/partners/${similar.id}`}>{similar.name}</Link>. Is it the same organisation?</span></p>}
            </div>
            <div className="pt-prev" aria-label="Preview on the Partners page">
              <span className="op-cap">On the Partners page</span>
              <PartnerCard f={f} logo={f.logoMediaId ? logo : null} projects={projects} />
            </div>
          </div>
          <Field label="Scope" span={3} hint="Groups the partner on the website."><div className="ed-choice">
            {SCOPES.map(([v, l]) => <label key={v} className={f.scope === v ? 'on' : ''}><input type="radio" name="scope" checked={f.scope === v} onChange={() => set('scope', v)} /><b>{l}</b><small>{SCOPE_INFO[v]}</small></label>)}</div></Field>
          <Field label="Type of organisation" span={2} hint="Pick one in use, or type a new one."><input className="input" list="pt-types" maxLength={60} value={f.category} placeholder="e.g. Embassy, Foundation, Association" onChange={(x) => set('category', x.target.value)} aria-label="Type of organisation" />
            <datalist id="pt-types">{types.map((x) => <option key={x} value={x} />)}</datalist></Field>
          <Field label="Partnership"><div className="seg pt-seg" role="radiogroup" aria-label="Partnership">
            <button type="button" role="radio" aria-checked={f.current} className={f.current ? 'on' : ''} onClick={() => set('current', true)}>Current</button>
            <button type="button" role="radio" aria-checked={!f.current} className={!f.current ? 'on' : ''} onClick={() => set('current', false)}>Past</button></div></Field>
        </Section>
        <Section id="about" title="About the partnership" desc="Only facts AFCD can confirm.">
          <Field label="What we do together" span={3} count={[f.description.length, 400]}><textarea className="textarea" rows={3} maxLength={400} value={f.description} onChange={(x) => set('description', x.target.value)} aria-label="What we do together" /></Field>
          <Field label="Website" span={2} hint={siteIssue ? <span className="pt-hint-warn">{siteIssue}</span> : site ? <>Links to <b>{site.hostname.replace(/^www\./, '')}</b></> : 'Their official site, if they have one.'}>
            <div className="pt-url"><input className="input mono" maxLength={300} placeholder="https://…" value={f.websiteUrl} onChange={(x) => set('websiteUrl', x.target.value.trim())} aria-label="Website" aria-invalid={!!siteIssue && !site} />
              {site && <a className="btn btn-sm" href={site.href} target="_blank" rel="noopener noreferrer"><Icon n="ext" />Open</a>}</div></Field>
          <Field label="Partner since" hint={f.sinceYear && f.sinceYear > thisYear ? <span className="pt-hint-warn">That year is in the future.</span> : years !== null ? (years === 0 ? 'Since this year' : `${years} year${years === 1 ? '' : 's'} of partnership`) : 'Year the partnership started.'}>
            <input className="input" type="number" min={2000} max={thisYear} placeholder="Year" value={f.sinceYear ?? ''} onChange={(x) => set('sinceYear', x.target.value ? Number(x.target.value) : null)} aria-label="Partner since" /></Field>
        </Section>
        <Section id="logo" title="Logo" desc="Only with the partner’s permission; confirm the rights in the Media Library. Without a logo the site shows initials.">
          {f.logoMediaId && logo ? <div className="pt-logo-ed s3">
            <div className="pt-logo-stage"><img src={logo.url} alt={logo.alt} /></div>
            <div className="pt-logo-info">
              <b>{logoShape === 'is-square' ? 'Square logo' : logoShape === 'is-mid' ? 'Medium logo' : 'Wide logo'}</b>
              <small>{logo.width}×{logo.height} px · the website sizes it by its shape so every logo looks equally weighted.</small>
              {(!logo.alt || !logo.rightsConfirmed) && <small className="pt-hint-warn">{!logo.alt ? 'Add alt text (usually the organisation name)' : 'Confirm AFCD may use it (permission from the partner)'} in the Media Library before review.</small>}
              <div className="pt-logo-actions">
                <button type="button" className="btn btn-sm" disabled={!!busy || !can('media.update')} onClick={() => trimLogo()} title="Crop away empty transparent or white margins"><Icon n="image" />{busy === 'trim' ? 'Trimming…' : 'Trim empty margins'}</button>
                {(logo as MediaItem & { crop?: unknown }).crop ? <button type="button" className="btn btn-sm btn-ghost" disabled={!!busy || !can('media.update')} onClick={() => trimLogo(true)}>Undo trim</button> : null}
                <button type="button" className="btn btn-sm" onClick={() => setDialog('logo')}>Change</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('logoMediaId', null)}><Icon n="x" />Remove</button>
              </div>
            </div>
          </div>
            : <button type="button" className="ed-drop s3" onClick={() => setDialog('logo')}><Icon n="image" /><b>Choose a logo</b><small>From the media library. A transparent PNG works best; empty margins are trimmed automatically.</small></button>}
        </Section>
        <Section id="projects" title="Projects with this partner" desc="Live projects only.">
          {projects.length === 0 ? <p className="muted s3" style={{ margin: 0 }}>No live projects yet. Projects appear here once they are published.</p> : <div className="pt-projs s3">
            {f.projectSlugs.length > 0 && <ul className="pt-pchips">{f.projectSlugs.map((sl) => <li key={sl}><Icon n="folder" width={14} height={14} /><span>{projects.find((x) => x.slug === sl)?.name ?? sl}</span>
              <button type="button" aria-label="Remove this project" onClick={() => set('projectSlugs', f.projectSlugs.filter((x) => x !== sl))}>×</button></li>)}</ul>}
            <select className="select pt-pselect" value="" disabled={!projLeft.length} onChange={(e) => e.target.value && set('projectSlugs', [...f.projectSlugs, e.target.value])} aria-label="Add a project">
              <option value="">{projLeft.length ? 'Add a project…' : 'All live projects are linked'}</option>
              {projLeft.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            </select>
            <small className="muted">Shown on the partner’s card on the website, as links to the project pages.</small>
          </div>}
        </Section>
        <Section id="internal" title="Internal" desc="Not shown on the website.">
          <Field label="Source" span={2} hint="Where these details come from."><input className="input" maxLength={300} value={f.provenance} onChange={(x) => set('provenance', x.target.value)} aria-label="Source" /></Field>
          <Field label="Order" hint="Lower comes first."><input className="input" type="number" min={0} max={10000} value={f.sort} onChange={(x) => set('sort', Number(x.target.value) || 0)} aria-label="Order" /></Field>
          <Field label="Record key" span={3} hint={live ? 'A live partner’s key cannot change.' : 'Used for links and to prevent duplicates.'}><input className="input mono" disabled={live} value={f.slug} onChange={(x) => set('slug', slugify(x.target.value))} aria-label="Record key" /></Field>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of this partner. Reviewed and published on the Translations screen.">
        <RecordTranslations noun="partner" dirty={status !== 'published'} files={[]} fields={[{ label: 'Organisation name', value: f.name }, { label: 'Category', value: f.category }, { label: 'About the partnership', value: f.description }]} />
      </Section>
      </div>
      <WorkflowPanel status={status} live={live} problems={p.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'], ...(p.publishedAt ? [['Published', fmtDate(p.publishedAt)] as [string, string]] : []), ...(p.verifiedAt ? [['Last approved', fmtDate(p.verifiedAt)] as [string, string]] : [])]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + 'partners.html'} target="_blank" rel="noopener"><Icon n="ext" />Open Our Partners</a>}
        {['draft', 'changes_requested'].includes(status) && can('partner.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('partner.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('partner.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('partner.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('partner.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('partner.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this record?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('partner.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        {(p.history.revisions.length > 0 || p.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{p.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === p.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/partners/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {p.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
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

/** Same rule as the website (src/content.py logo_shape): square logos tallest, wide ones shortest. */
function shapeOf(w: number, h: number) { const r = w && h ? w / h : 2; return r < 1.35 ? 'is-square' : r < 2.6 ? 'is-mid' : 'is-wide'; }

/** The partner's card as the Partners page shows it, from the form as it is now. */
function PartnerCard({ f, logo, projects }: { f: Form; logo: MediaItem | null; projects: { slug: string; name: string }[] }) {
  const linked = f.projectSlugs.map((sl) => projects.find((x) => x.slug === sl)?.name).filter(Boolean) as string[];
  let site: URL | null = null; try { site = new URL(f.websiteUrl); } catch { site = null; }
  return <div className="ptc">
    <div className="ptc-stage">{logo ? <img className={shapeOf(logo.width, logo.height)} src={logo.url} alt="" /> : <span className="ptc-ini">{initials(f.name) || '?'}</span>}</div>
    <div className="ptc-body">
      <span className="ptc-scope">{scopeLabel(f.scope)}{f.category ? ` · ${f.category}` : ''}</span>
      <b>{f.name || 'Organisation name'}</b>
      <span className="ptc-meta"><i>{f.current ? 'Current partner' : 'Past partner'}</i>{f.sinceYear ? <i>since {f.sinceYear}</i> : null}</span>
      {f.description.trim() && <p>{f.description}</p>}
      {linked.length > 0 && <span className="ptc-projs"><em>Projects</em>{linked.map((n) => <u key={n}>{n}</u>)}</span>}
      {site?.protocol === 'https:' && <span className="ptc-web">Website ↗</span>}
    </div>
  </div>;
}
