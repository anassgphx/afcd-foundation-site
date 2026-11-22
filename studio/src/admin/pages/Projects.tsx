// Projects list: search, filter by status and pillar, sorted table.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, ago, useCan } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';

type Row = { id: string; name: string; slug: string; category: string; status: string; publishedRevisionId: string | null; hasDetailPage: boolean; updatedAt: string; pillars: { key: string; name: string; colour: string; isPrimary: boolean }[] };

const FILTERS = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['approved', 'Approved'], ['archived', 'Archived']] as const;

export function ProjectsList() {
  const can = useCan();
  const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState<string>(() => new URLSearchParams(location.search).get('status') || 'all');
  const [pillar, setPillar] = useState('all');
  useEffect(() => { api<Row[]>('/projects').then(setRows).catch((e) => setErr(e.message)); }, []);
  const pillars = useMemo(() => { const m = new Map<string, Row['pillars'][number]>(); rows?.forEach((r) => r.pillars.forEach((p) => m.set(p.key, p))); return [...m.values()]; }, [rows]);
  const shown = (rows ?? []).filter((r) =>
    (f === 'all' ? r.status !== 'archived' : f === 'live' ? !!r.publishedRevisionId : f === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === f) &&
    (pillar === 'all' || r.pillars.some((p) => p.key === pillar)) &&
    (!q || `${r.name} ${r.category} ${r.slug}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="page-h">
        <div><h1>Projects</h1><p>Every project on the website, linked to its strategic pillars.</p></div>
        {can('project.create') && <Link to="/studio/projects/new" className="btn btn-primary"><Icon n="plus" />New project</Link>}
      </div>
      <section className="card">
        <div className="card-h">
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Status">{FILTERS.map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
            <select className="select" style={{ width: 'auto', height: 32 }} value={pillar} onChange={(e) => setPillar(e.target.value)} aria-label="Pillar">
              <option value="all">All pillars</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </div>
          <label className="search"><Icon n="search" /><span className="sr-only">Search projects</span><input className="input" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        {err ? <div className="card-b"><div className="notice n-bad">{err}</div></div> : !rows ? <Loading /> :
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Project</th><th>Pillars</th><th>Status</th><th>Page</th><th>Updated</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="empty">No projects match these filters.</td></tr>}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><Link className="title" to={`/studio/projects/${r.id}`}>{r.name}</Link><div className="sub">{r.category || '—'}</div></td>
                  <td><div className="pills">{r.pillars.map((p) => <span key={p.key} className="pill" title={p.isPrimary ? 'Primary pillar' : 'Also linked'}><span className="dot" style={{ ['--c' as string]: p.colour }} />{p.name}{p.isPrimary && r.pillars.length > 1 ? ' ·' : ''}</span>)}</div></td>
                  <td><div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div></td>
                  <td className="sub">{r.hasDetailPage ? <span className="mono">project-{r.slug}.html</span> : 'Listing only'}</td>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{ago(r.updatedAt)}</td>
                </tr>))}
            </tbody>
          </table></div>}
      </section>
    </>
  );
}
