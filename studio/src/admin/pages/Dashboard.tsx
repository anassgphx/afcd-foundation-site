// Dashboard: actionable, database-backed overview. No invented metrics.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, ago, fmtDate, useCan, useMe } from '../ui.tsx';

type Data = {
  counts: Record<string, number>; live: number; pendingEdits: number; mediaTotal: number; mediaNeedsRights: number; failed24h: number;
  recent: { id: string; name: string; status: string; updatedAt: string; live: boolean }[];
  queue: { id: string; name: string; status: string; updatedAt: string }[];
  jobs: { id: string; kind: string; status: string; createdAt: string; error: string | null }[];
};

export function Dashboard() {
  const me = useMe(); const can = useCan();
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<Data>('/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="notice n-bad">{err}</div>;
  const n = (k: string) => d?.counts[k] ?? 0;
  const hour = new Date().getHours();
  return (
    <>
      <div className="page-h">
        <div><h1>Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {me.user.name.split(' ')[0]}</h1><p>What needs attention on the AFCD Foundation website.</p></div>
        {can('project.create') && <Link to="/studio/projects/new" className="btn btn-primary"><Icon n="plus" />New project</Link>}
      </div>
      {d?.failed24h ? <div className="notice n-bad" style={{ marginBottom: 14 }}><Icon n="alert" width={16} />{d.failed24h} publishing job{d.failed24h > 1 ? 's' : ''} failed in the last 24 hours. <Link to="/studio/publishing">See details</Link></div> : null}
      <div className="kpis">
        <Kpi to="/studio/projects?status=live" label="Live projects" v={d?.live} />
        <Kpi to="/studio/projects?status=draft" label="Drafts" v={d && n('draft') + n('changes_requested')} sub={d?.pendingEdits ? `${d.pendingEdits} with unpublished edits` : undefined} />
        <Kpi to="/studio/approvals" label="Awaiting review" v={d && n('in_review')} />
        <Kpi to="/studio/approvals" label="Approved, not published" v={d && n('approved')} />
        <Kpi to="/studio/media" label="Media items" v={d?.mediaTotal} sub={d?.mediaNeedsRights ? `${d.mediaNeedsRights} need alt text or rights` : 'All ready to publish'} />
      </div>
      <div className="two">
        <section className="card">
          <div className="card-h"><h2>Recently edited</h2><Link to="/studio/projects" className="btn btn-sm btn-ghost">All projects</Link></div>
          {!d ? <Loading /> : d.recent.length === 0 ? <div className="empty">Nothing edited yet.</div> :
            <table className="table"><tbody>{d.recent.map((r) => (
              <tr key={r.id}><td><Link className="title" to={`/studio/projects/${r.id}`}>{r.name}</Link></td>
                <td style={{ width: 1, whiteSpace: 'nowrap' }}><span className="pills">{r.live && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></span></td>
                <td className="sub" style={{ width: 1, whiteSpace: 'nowrap' }}>{ago(r.updatedAt)}</td></tr>))}</tbody></table>}
        </section>
        <div className="grid">
          <section className="card">
            <div className="card-h"><h2>Needs a decision</h2><Link to="/studio/approvals" className="btn btn-sm btn-ghost">Queue</Link></div>
            {!d ? <Loading /> : d.queue.length === 0 ? <div className="empty">Nothing waiting for review or publishing.</div> :
              <table className="table"><tbody>{d.queue.map((r) => (
                <tr key={r.id}><td><Link className="title" to={`/studio/projects/${r.id}`}>{r.name}</Link><div className="sub">waiting {ago(r.updatedAt).replace(' ago', '')}</div></td><td style={{ width: 1 }}><Badge s={r.status} /></td></tr>))}</tbody></table>}
          </section>
          <section className="card">
            <div className="card-h"><h2>Website delivery</h2><Link to="/studio/publishing" className="btn btn-sm btn-ghost">History</Link></div>
            {!d ? <Loading /> : d.jobs.length === 0 ? <div className="empty">No publishing activity yet.</div> :
              <table className="table"><tbody>{d.jobs.map((j) => (
                <tr key={j.id}><td>{j.kind.replace('_', ' ').replace('_', ' ')}<div className="sub">{fmtDate(j.createdAt)}</div></td><td style={{ width: 1 }}><Badge s={j.status} /></td></tr>))}</tbody></table>}
          </section>
        </div>
      </div>
    </>
  );
}

function Kpi({ to, label, v, sub }: { to: string; label: string; v: number | undefined | null; sub?: string }) {
  return <Link to={to} className="kpi"><span>{label}</span><b>{v ?? '–'}</b>{sub && <small>{sub}</small>}</Link>;
}
export const Loading = () => <div className="card-b stack"><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '50%' }} /></div>;
