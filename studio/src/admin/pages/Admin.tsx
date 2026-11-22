// Approval queue, publishing history, activity log and users.
import { useEffect, useState, type FormEvent } from 'react';
import { api, patch, post } from '../api.ts';
import { Badge, Icon, Link, Modal, ago, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column } from '../DataTable.tsx';
import { Loading } from './Dashboard.tsx';

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
  const [d, setD] = useState<{ users: UserRow[]; roles: { id: string; label: string; permissions: string[] }[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [st, set] = useUrlState({ status: 'active', role: 'all', q: '' });
  const load = () => api('/users').then(setD);
  useEffect(() => { load(); }, []);
  async function change(id: string, body: Record<string, unknown>) { try { await patch(`/users/${id}`, body); toast('User updated'); load(); } catch (e) { toast((e as Error).message, true); } }
  const roleLabel = (r: string) => d?.roles.find((x) => x.id === r)?.label ?? r;
  const is = (k: string, u: UserRow) => (k === 'active' ? u.active : k === 'inactive' ? !u.active : true);
  const base = (d?.users ?? []).filter((u) => (st.role === 'all' || u.role === st.role) && (!st.q || `${u.name} ${u.email}`.toLowerCase().includes(st.q.toLowerCase())));
  const shown = base.filter((u) => is(st.status, u));
  const tabs: [string, string, number][] = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([k, l]) => [k, l, base.filter((u) => is(k, u)).length]);
  const manage = (u: UserRow) => can('users.manage') && u.id !== me.user.id;
  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', sort: (u) => u.name, csv: (u) => u.name, render: (u) => <div className="dt-main"><span className="avatar">{u.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span><span className="min-w-0"><b>{u.name}{u.id === me.user.id ? ' (you)' : ''}</b><span className="sub">{u.email}</span></span></div> },
    { key: 'role', header: 'Role', sort: (u) => roleLabel(u.role), csv: (u) => roleLabel(u.role), render: (u) => manage(u) && d ? <select className="select" style={{ width: 'auto', height: 32 }} value={u.role} onChange={(e) => change(u.id, { role: e.target.value })} aria-label={`Role of ${u.name}`}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select> : <span className="pill">{roleLabel(u.role)}</span> },
    { key: 'last', header: 'Last sign-in', sort: (u) => (u.lastLoginAt ? -new Date(u.lastLoginAt).getTime() : 0), csv: (u) => u.lastLoginAt ?? 'never', hideBelow: 800, render: (u) => <span className="sub">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</span> },
    { key: 'access', header: 'Access', sort: (u) => (u.active ? 0 : 1), csv: (u) => (u.active ? 'active' : 'inactive'), align: 'right',
      render: (u) => manage(u) ? <button className="btn btn-sm" onClick={() => change(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Reactivate'}</button> : <span className="dt-state"><span className="dot" style={{ ['--c' as string]: u.active ? '#16a34a' : '#a8a29e' }} />{u.active ? 'Active' : 'Inactive'}</span> },
  ];
  return <>
    <div className="page-h"><div><h1>Users & Roles</h1><p>Who can edit, review and publish. Permissions are enforced by the server.</p></div>{can('users.manage') && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon n="plus" />Add user</button>}</div>
    <div className="grid">
      <section className="card">
        <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search name or email">
          <select className="select" value={st.role} onChange={(e) => set('role', e.target.value)} aria-label="Role"><option value="all">All roles</option>{d?.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </ListToolbar>
        {!d ? <Loading /> : <DataTable id="users" rows={shown} total={d.users.length} rowKey={(u) => u.id} columns={columns} csvName="afcd-studio-users" initialSort={{ key: 'name', dir: 'asc' }}
          empty={<EmptyState icon="users" text="No users match these filters" onClear={() => { set('q', ''); set('role', 'all'); set('status', 'all'); }} />} />}
      </section>
      {d && <section className="card"><div className="card-h"><h2>What each role can do</h2></div><div className="scroll-x"><table className="table"><tbody>{d.roles.map((r) => <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}><b>{r.label}</b></td><td><div className="pills">{r.permissions.map((p) => <span key={p} className="pill mono">{p}</span>)}</div></td></tr>)}</tbody></table></div></section>}
    </div>
    {adding && d && <AddUser roles={d.roles} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
  </>;
}
type UserRow = { id: string; email: string; name: string; role: string; active: boolean; lastLoginAt: string | null };

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
