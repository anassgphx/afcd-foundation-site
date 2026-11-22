// Pages list + "New page" with templates.
import { useEffect, useState, type FormEvent } from 'react';
import { api, post, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, navigate, useCan, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, workflowActions, type Column } from '../DataTable.tsx';
import { Loading } from './Dashboard.tsx';

type Row = { id: string; slug: string; title: string; status: string; publishedRevisionId: string | null; updatedAt: string };
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function PagesList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null); const [creating, setCreating] = useState(false);
  const [st, set] = useUrlState({ status: 'all', q: '' });
  const load = () => api<Row[]>('/pages').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const is = (k: string, r: Row) => (k === 'all' ? r.status !== 'archived' : k === 'live' ? !!r.publishedRevisionId : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => !st.q || `${r.title} ${r.slug}`.toLowerCase().includes(st.q.toLowerCase()));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['approved', 'Approved'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const columns: Column<Row>[] = [
    { key: 'title', header: 'Page', sort: (r) => r.title, csv: (r) => r.title, render: (r) => <div className="dt-main"><span className="dt-thumb"><Icon n="layers" /></span><span className="min-w-0"><Link className="title" to={`/studio/pages/${r.id}`}>{r.title}</Link><span className="sub">Built with the page builder</span></span></div> },
    { key: 'slug', header: 'Address', sort: (r) => r.slug, csv: (r) => `${r.slug}.html`, hideBelow: 800, render: (r) => <span className={r.publishedRevisionId ? 'dt-page' : 'sub'}>{r.publishedRevisionId && <Icon n="globe" width={13} height={13} />}<span className="mono">{r.slug}.html</span></span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 700, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  return <>
    <div className="page-h">
      <div><h1>Pages</h1><p>Pages built with the visual builder from AFCD’s approved blocks. Existing site pages stay managed by their templates.</p></div>
      {can('page.create') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon n="plus" />New page</button>}
    </div>
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search pages" />
      {!rows ? <Loading /> : <DataTable id="pages" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-pages"
        actions={workflowActions<Row>({ base: '/pages', noun: ['page', 'pages'], name: (r) => r.title, canUpdate: can('page.update'), reload: load, post, toast })}
        onOpen={(r) => navigate(`/studio/pages/${r.id}`)}
        empty={rows.length === 0 ? <EmptyState icon="layers" text="No builder pages yet. Create one from a template." /> : <EmptyState icon="layers" text="No pages match these filters" onClear={() => { set('q', ''); set('status', 'all'); }} />} />}
    </section>
    {creating && <NewPage onClose={() => setCreating(false)} />}
  </>;
}

function NewPage({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<{ id: string; label: string; description: string }[]>([]);
  const [f, setF] = useState({ title: '', slug: '', template: 'campaign' }); const [touched, setTouched] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/pages/catalog').then((c) => setTemplates(c.templates)); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const p = await post<{ id: string }>('/pages', f); navigate(`/studio/pages/${p.id}`); }
    catch (x) { setErr(x instanceof ApiError ? (x.details?.[0]?.message ?? x.message) : 'Could not create the page.'); setBusy(false); }
  }
  return <Modal title="New page" onClose={onClose}><form onSubmit={submit}>
    <div className="modal-b stack">
      <div className="row">
        <label className="field"><span>Page title</span><input className="input" autoFocus value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value, slug: touched ? f.slug : slugify(e.target.value) })} required /></label>
        <label className="field"><span>Address</span><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input className="input mono" aria-label="Address" value={f.slug} onChange={(e) => { setTouched(true); setF({ ...f, slug: slugify(e.target.value) }); }} required /><span className="mono muted">.html</span></div></label>
      </div>
      <div className="field"><span>Start from</span><div className="choice-grid">{templates.map((t) => (
        <label key={t.id} className={`choice${f.template === t.id ? ' on' : ''}`}><input type="radio" name="tpl" checked={f.template === t.id} onChange={() => setF({ ...f, template: t.id })} /><span><b>{t.label}</b><small>{t.description}</small></span></label>))}</div></div>
      {err && <div className="notice n-bad">{err}</div>}
    </div>
    <div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title || !f.slug}>{busy ? 'Creating…' : 'Create and open builder'}</button></div>
  </form></Modal>;
}
