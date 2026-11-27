// Publishing history and activity log; Users & roles is in Users.tsx.
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { api, patch, post } from '../api.ts';
import { Badge, Icon, Link, Modal, ago, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column } from '../DataTable.tsx';
import { Loading } from './Dashboard.tsx';

type PublicState = { checked: boolean; built: string | null; live: string | null; match: boolean | null; error: string | null; at: string };
/** What the job's log says about the public copy (written by the check after each delivery, modules/publish/public-check.ts). */
function publicOf(j: any): { label: string; tone: 'ok' | 'bad' | 'muted' } {
  if (j.status !== 'succeeded') return { label: '—', tone: 'muted' };
  if (/^Public site: serving/m.test(j.log ?? '')) return { label: 'Confirmed', tone: 'ok' };
  if (/^Public site: NOT serving/m.test(j.log ?? '')) return { label: 'Not reached', tone: 'bad' };
  return { label: j.finishedAt && Date.now() - Date.parse(j.finishedAt) < 5 * 60_000 ? 'Checking…' : 'Not checked', tone: 'muted' };
}

export function Publishing() {
  const [jobs, setJobs] = useState<any[] | null>(null); const [open, setOpen] = useState<any>(null);
  const [pub, setPub] = useState<PublicState | null>(null); const [checking, setChecking] = useState(false);
  const check = () => { setChecking(true); api<PublicState>('/publish-jobs/public').then(setPub).catch(() => setPub(null)).finally(() => setChecking(false)); };
  useEffect(() => { api<any[]>('/publish-jobs').then(setJobs).catch(() => setJobs([])); check(); }, []);
  return <>
    <div className="page-h"><div><h1>Publishing</h1><p>Every delivery to the public website. A job succeeds once the built pages are checked; the Public column says whether visitors then got them.</p></div></div>
    {pub && <section className={`notice ${!pub.checked ? 'n-info' : pub.match ? 'n-ok' : 'n-bad'}`} style={{ marginBottom: 16 }}><div>
      <b>{!pub.checked ? 'Public site not checked' : pub.match ? 'The public site serves the latest build' : 'The public site does not serve the latest build yet'}</b>
      <p style={{ margin: '4px 0 0' }}>{!pub.checked ? (pub.error ?? 'This Studio has no separate public site to check (a local or test setup).')
        : pub.match ? `Build ${pub.built}, checked ${fmtDate(pub.at)}.`
        : `${pub.error ?? `Built ${pub.built}, public ${pub.live ?? 'unknown'}.`} Right after a publish this is normal for about a minute; if it lasts, the site sync on the server needs checking.`}</p>
      <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check again'}</button></div></section>}
    <section className="card">{!jobs ? <Loading /> : jobs.length === 0 ? <div className="empty">No publishing activity yet.</div> :
      <div className="scroll-x"><table className="table"><thead><tr><th>Job</th><th>Status</th><th>Public</th><th>Started</th><th>Finished</th><th /></tr></thead><tbody>{jobs.map((j) => { const p = publicOf(j); return (
        <tr key={j.id}><td>{j.kind.replaceAll('_', ' ')}{j.error && <div className="sub" style={{ color: 'var(--bad)' }}>{j.error}</div>}</td><td><Badge s={j.status} /></td>
          <td className="sub" style={{ color: p.tone === 'ok' ? 'var(--ok)' : p.tone === 'bad' ? 'var(--bad)' : undefined }}>{p.label}</td>
          <td className="sub">{fmtDate(j.createdAt)}</td><td className="sub">{fmtDate(j.finishedAt)}</td>
          <td><button className="btn btn-sm btn-ghost" onClick={() => setOpen(j)}>Log</button></td></tr>); })}</tbody></table></div>}</section>
    {open && <Modal title="Build log" onClose={() => setOpen(null)}><div className="modal-b"><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{open.log || 'No output.'}</pre></div></Modal>}
  </>;
}

export function ActivityLog() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>('/audit?limit=200').then(setRows).catch(() => setRows([])); }, []);
  return <>
    <div className="page-h"><div><h1>Activity log</h1><p>Append-only record of sign-ins, edits, approvals and publishing.</p></div></div>
    <section className="card">{!rows ? <Loading /> : <div className="scroll-x"><table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id}><td className="sub" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.at)}</td><td>{r.actorEmail ?? <span className="muted">system</span>}</td><td><span className="mono">{r.action}</span></td><td>{r.summary}</td></tr>)}
    </tbody></table></div>}</section>
  </>;
}

// Users & roles lives in its own file (accounts, roles, passwords).
export { Users } from './Users.tsx';
