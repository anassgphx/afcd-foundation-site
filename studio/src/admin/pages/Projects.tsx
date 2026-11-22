// Projects list: a full data table with search, status tabs with counts, pillar filter, sorting, selection with
// bulk workflow actions (real transitions, permission-checked on the server), density, CSV export and keyboard use.
import { useEffect, useMemo, useState } from 'react';
import { api, post } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, ago, navigate, useCan, useToast } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';
import { DataTable, FilterTabs, type BulkAction, type Column } from '../DataTable.tsx';

type Row = { id: string; name: string; slug: string; category: string; location: string; years: string; status: string; publishedRevisionId: string | null; hasDetailPage: boolean; updatedAt: string; updatedByName: string | null; thumb: string | null; pillars: { key: string; name: string; colour: string; isPrimary: boolean }[] };

const FILTERS = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['approved', 'Approved'], ['archived', 'Archived']] as const;
const matches = (f: string, r: Row) => (f === 'all' ? r.status !== 'archived' : f === 'live' ? !!r.publishedRevisionId : f === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === f);
const STATUS_ORDER: Record<string, number> = { in_review: 0, changes_requested: 1, approved: 2, draft: 3, published: 4, archived: 5 };

export function ProjectsList() {
  const can = useCan(); const toast = useToast();
  const params = new URLSearchParams(location.search);
  const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [f, setF] = useState<string>(params.get('status') || 'all');
  const [pillar, setPillar] = useState(params.get('pillar') || 'all');
  const load = () => api<Row[]>('/projects').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  // filters live in the address bar, so a filtered view can be reloaded or shared
  useEffect(() => {
    const u = new URL(location.href);
    for (const [k, v, d] of [['status', f, 'all'], ['pillar', pillar, 'all'], ['q', q.trim(), '']] as const) { if (v && v !== d) u.searchParams.set(k, v); else u.searchParams.delete(k); }
    history.replaceState(history.state, '', u);
  }, [f, pillar, q]);
  const pillars = useMemo(() => { const m = new Map<string, Row['pillars'][number]>(); rows?.forEach((r) => r.pillars.forEach((p) => m.set(p.key, p))); return [...m.values()]; }, [rows]);
  const base = (rows ?? []).filter((r) => (pillar === 'all' || r.pillars.some((p) => p.key === pillar)) && (!q || `${r.name} ${r.category} ${r.slug} ${r.location}`.toLowerCase().includes(q.toLowerCase())));
  const shown = base.filter((r) => matches(f, r));

  const transitionAll = (action: string, done: string) => async (sel: Row[]) => {
    let ok = 0; const failed: string[] = [];
    for (const r of sel) { try { await post(`/projects/${r.id}/transition`, { action }); ok++; } catch (e) { failed.push(`${r.name}: ${(e as Error).message}`); } }
    await load();
    if (ok) toast(`${ok} project${ok === 1 ? '' : 's'} ${done}`);
    if (failed.length) toast(failed.slice(0, 3).join(' · '), true);
  };
  const actions: BulkAction<Row>[] = [
    ...(can('project.update') ? [{ label: 'Submit for review', icon: 'send', applies: (r: Row) => ['draft', 'changes_requested'].includes(r.status), run: transitionAll('submit', 'sent for review') }] : []),
    ...(can('project.archive') ? [{ label: 'Archive', icon: 'archive', danger: true, applies: (r: Row) => !r.publishedRevisionId && ['draft', 'changes_requested', 'approved', 'in_review'].includes(r.status), run: async (sel: Row[]) => { if (confirm(`Archive ${sel.length} project${sel.length === 1 ? '' : 's'}? They can be restored later.`)) await transitionAll('archive', 'archived')(sel); } }] : []),
    ...(can('project.archive') ? [{ label: 'Restore', icon: 'undo', applies: (r: Row) => r.status === 'archived', run: transitionAll('restore', 'restored as drafts') }] : []),
  ];
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Project', sort: (r) => r.name, csv: (r) => r.name, render: (r) => <div className="dt-main">
      <span className="dt-thumb">{r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Icon n="folder" />}</span>
      <span className="min-w-0"><Link className="title" to={`/studio/projects/${r.id}`}>{r.name}</Link><span className="sub">{[r.category, r.location, r.years].filter(Boolean).join(' · ') || '—'}</span></span></div> },
    { key: 'pillar', header: 'Pillars', sort: (r) => r.pillars[0]?.name ?? 'zzz', csv: (r) => r.pillars.map((p) => p.name).join('; '), hideBelow: 900,
      render: (r) => <div className="pills">{r.pillars.map((p) => <span key={p.key} className="pill" title={p.isPrimary ? 'Primary pillar' : 'Also linked'}><span className="dot" style={{ ['--c' as string]: p.colour }} />{p.name}{p.isPrimary && r.pillars.length > 1 ? ' ·' : ''}</span>)}</div> },
    { key: 'status', header: 'Status', sort: (r) => STATUS_ORDER[r.status] ?? 9, csv: (r) => r.status.replace('_', ' '), render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'page', header: 'On the website', sort: (r) => (r.publishedRevisionId ? (r.hasDetailPage ? 0 : 1) : 2), csv: (r) => (r.publishedRevisionId ? (r.hasDetailPage ? `project-${r.slug}.html` : 'listing only') : 'not live'), hideBelow: 1100,
      render: (r) => !r.publishedRevisionId ? <span className="sub">Not live</span> : r.hasDetailPage ? <span className="dt-page"><Icon n="globe" width={13} height={13} /><span className="mono">project-{r.slug}.html</span></span> : <span className="sub">Projects listing only</span> },
    { key: 'updated', header: 'Updated', sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, align: 'right', hideBelow: 700,
      render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b>{r.updatedByName && <small>by {r.updatedByName}</small>}</span> },
  ];
  return (
    <>
      <div className="page-h">
        <div><h1>Projects</h1><p>Every project on the website, linked to its strategic pillars.</p></div>
        {can('project.create') && <Link to="/studio/projects/new" className="btn btn-primary"><Icon n="plus" />New project</Link>}
      </div>
      <section className="card">
        <div className="card-h dt-toolbar">
          <FilterTabs value={f} onChange={setF} tabs={FILTERS.map(([k, l]) => [k, l, base.filter((r) => matches(k, r)).length])} />
          <div className="dt-tools">
            <select className="select" value={pillar} onChange={(e) => setPillar(e.target.value)} aria-label="Pillar">
              <option value="all">All pillars</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
            <label className="search"><Icon n="search" /><span className="sr-only">Search projects</span><input className="input" placeholder="Search name, category, place" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button type="button" className="dt-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}</label>
          </div>
        </div>
        {err ? <div className="card-b"><div className="notice n-bad">{err}</div></div> : !rows ? <Loading /> :
          <DataTable id="projects" rows={shown} total={(rows ?? []).filter((r) => f === 'archived' || r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} actions={actions} csvName="afcd-projects"
            onOpen={(r) => navigate(`/studio/projects/${r.id}`)}
            empty={<div className="dt-empty"><Icon n="folder" /><b>No projects match these filters</b>{(q || pillar !== 'all' || f !== 'all') && <button className="btn btn-sm" onClick={() => { setQ(''); setPillar('all'); setF('all'); }}>Clear filters</button>}</div>} />}
      </section>
    </>
  );
}
