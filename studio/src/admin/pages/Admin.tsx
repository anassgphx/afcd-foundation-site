// Approval queue, publishing history, activity log and users.
import { useEffect, useState, type FormEvent } from 'react';
import { api, patch, post } from '../api.ts';
import { Badge, Link, Modal, ago, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';

export function ApprovalQueue() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>('/projects').then((p) => setRows(p.filter((x) => ['in_review', 'approved', 'changes_requested'].includes(x.status)))).catch(() => setRows([])); }, []);
  const groups = [['in_review', 'Waiting for review'], ['approved', 'Approved, ready to publish'], ['changes_requested', 'Sent back to authors']] as const;
  return <>
    <div className="page-h"><div><h1>Approval Queue</h1><p>Content moving through review. Approvers cannot approve their own submissions.</p></div></div>
    {!rows ? <Loading /> : <div className="grid">{groups.map(([s, label]) => {
      const list = rows.filter((r) => r.status === s);
      return <section className="card" key={s}><div className="card-h"><h2>{label}</h2><span className="muted">{list.length}</span></div>
        {list.length === 0 ? <div className="empty">Nothing here.</div> : <table className="table"><tbody>{list.map((r) => (
          <tr key={r.id}><td><Link className="title" to={`/studio/projects/${r.id}`}>{r.name}</Link><div className="sub">{r.pillars.map((p: any) => p.name).join(' · ')}</div></td>
            <td style={{ width: 1 }}><Badge s={r.status} /></td><td className="sub" style={{ width: 1, whiteSpace: 'nowrap' }}>{ago(r.updatedAt)}</td></tr>))}</tbody></table>}
      </section>; })}</div>}
  </>;
}

export function Publishing() {
  const [jobs, setJobs] = useState<any[] | null>(null); const [open, setOpen] = useState<any>(null);
  useEffect(() => { api<any[]>('/publish-jobs').then(setJobs).catch(() => setJobs([])); }, []);
  return <>
    <div className="page-h"><div><h1>Publishing</h1><p>Every delivery to the public website. A job only succeeds after the built pages are checked.</p></div></div>
    <section className="card">{!jobs ? <Loading /> : jobs.length === 0 ? <div className="empty">No publishing activity yet.</div> :
      <div className="scroll-x"><table className="table"><thead><tr><th>Job</th><th>Status</th><th>Started</th><th>Finished</th><th /></tr></thead><tbody>{jobs.map((j) => (
        <tr key={j.id}><td>{j.kind.replaceAll('_', ' ')}{j.error && <div className="sub" style={{ color: 'var(--bad)' }}>{j.error}</div>}</td><td><Badge s={j.status} /></td>
          <td className="sub">{fmtDate(j.createdAt)}</td><td className="sub">{fmtDate(j.finishedAt)}</td>
          <td><button className="btn btn-sm btn-ghost" onClick={() => setOpen(j)}>Log</button></td></tr>))}</tbody></table></div>}</section>
    {open && <Modal title="Build log" onClose={() => setOpen(null)}><div className="modal-b"><pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{open.log || 'No output.'}</pre></div></Modal>}
  </>;
}

export function ActivityLog() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>('/audit?limit=200').then(setRows).catch(() => setRows([])); }, []);
  return <>
    <div className="page-h"><div><h1>Activity Log</h1><p>Append-only record of sign-ins, edits, approvals and publishing.</p></div></div>
    <section className="card">{!rows ? <Loading /> : <div className="scroll-x"><table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id}><td className="sub" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.at)}</td><td>{r.actorEmail ?? <span className="muted">system</span>}</td><td><span className="mono">{r.action}</span></td><td>{r.summary}</td></tr>)}
    </tbody></table></div>}</section>
  </>;
}

export function Users() {
  const me = useMe(); const can = useCan(); const toast = useToast();
  const [d, setD] = useState<{ users: any[]; roles: { id: string; label: string; permissions: string[] }[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api('/users').then(setD);
  useEffect(() => { load(); }, []);
  async function change(id: string, body: Record<string, unknown>) { try { await patch(`/users/${id}`, body); toast('User updated'); load(); } catch (e) { toast((e as Error).message, true); } }
  return <>
    <div className="page-h"><div><h1>Users & Roles</h1><p>Who can edit, review and publish. Permissions are enforced by the server.</p></div>{can('users.manage') && <button className="btn btn-primary" onClick={() => setAdding(true)}>Add user</button>}</div>
    <div className="grid">
      <section className="card">{!d ? <Loading /> : <div className="scroll-x"><table className="table"><thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Access</th></tr></thead><tbody>{d.users.map((u) => (
        <tr key={u.id}><td><b>{u.name}</b><div className="sub">{u.email}</div></td>
          <td>{can('users.manage') && u.id !== me.user.id ? <select className="select" style={{ width: 'auto' }} value={u.role} onChange={(e) => change(u.id, { role: e.target.value })}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select> : d.roles.find((r) => r.id === u.role)?.label}</td>
          <td className="sub">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
          <td>{can('users.manage') && u.id !== me.user.id ? <button className="btn btn-sm" onClick={() => change(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Reactivate'}</button> : <span className="pill">{u.active ? 'Active' : 'Inactive'}</span>}</td></tr>))}</tbody></table></div>}</section>
      {d && <section className="card"><div className="card-h"><h2>What each role can do</h2></div><div className="scroll-x"><table className="table"><tbody>{d.roles.map((r) => <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}><b>{r.label}</b></td><td><div className="pills">{r.permissions.map((p) => <span key={p} className="pill mono">{p}</span>)}</div></td></tr>)}</tbody></table></div></section>}
    </div>
    {adding && d && <AddUser roles={d.roles} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
  </>;
}

function AddUser({ roles, onClose, onDone }: { roles: { id: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', role: 'content_editor', password: '' }); const [err, setErr] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setErr(''); try { await post('/users', f); toast('User added. Share the password with them securely.'); onDone(); } catch (x) { setErr((x as Error).message); } }
  return <Modal size="sm" title="Add user" onClose={onClose}><form onSubmit={submit}><div className="modal-b stack">
    <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
    <label className="field"><span>Email</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
    <label className="field"><span>Role</span><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
    <label className="field"><span>Temporary password</span><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={12} required /><small className="muted">At least 12 characters.</small></label>
    {err && <div className="notice n-bad">{err}</div>}
  </div><div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Add user</button></div></form></Modal>;
}
