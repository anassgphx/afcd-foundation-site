// Users & roles: who can use Studio and what each role may do. Administrators (users.manage) add people, edit their
// details and role, set a password or email them a link to choose one, and deactivate accounts. The server enforces it all.
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { api, patch, post, ApiError } from '../api.ts';
import { Icon, Modal, ago, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column } from '../DataTable.tsx';
import { Loading } from './Dashboard.tsx';
import '../account.css';

type Role = { id: string; label: string; description: string; permissions: string[] };
type UserRow = { id: string; email: string; name: string; role: string; active: boolean; lastLoginAt: string | null };
type Data = { users: UserRow[]; roles: Role[]; mailReady: boolean };
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const errText = (e: unknown) => (e instanceof ApiError && e.details?.length ? e.details.map((d) => d.message).join(' ') : (e as Error).message);

/** A random, readable password of 20 characters (letters and digits, no look-alikes). */
export function generatePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const v = crypto.getRandomValues(new Uint32Array(20));
  return [...v].map((n) => abc[n % abc.length]).join('').replace(/(.{5})(?=.)/g, '$1-');
}

export function PasswordInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return <div className="pw-field"><input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus={autoFocus} />
    <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}><Icon n={show ? 'eyeoff' : 'eye'} width={17} height={17} /></button></div>;
}

export function Users() {
  const me = useMe(); const can = useCan(); const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [dlg, setDlg] = useState<null | { kind: 'add' } | { kind: 'edit' | 'password'; u: UserRow }>(null);
  const [st, set] = useUrlState({ status: 'active', role: 'all', q: '' });
  const load = () => api<Data>('/users').then(setD);
  useEffect(() => { load(); }, []);
  async function change(id: string, body: Record<string, unknown>, done = 'User updated') { try { await patch(`/users/${id}`, body); toast(done); load(); } catch (e) { toast(errText(e), true); } }
  async function sendLink(u: UserRow) { try { await post(`/users/${u.id}/password-link`); toast(`Link sent to ${u.email}. It works once, for 3 days.`); } catch (e) { toast(errText(e), true); } }
  const roleLabel = (r: string) => d?.roles.find((x) => x.id === r)?.label ?? r;
  const is = (k: string, u: UserRow) => (k === 'active' ? u.active : k === 'inactive' ? !u.active : true);
  const base = (d?.users ?? []).filter((u) => (st.role === 'all' || u.role === st.role) && (!st.q || `${u.name} ${u.email}`.toLowerCase().includes(st.q.toLowerCase())));
  const shown = base.filter((u) => is(st.status, u));
  const tabs: [string, string, number][] = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([k, l]) => [k, l, base.filter((u) => is(k, u)).length]);
  const manage = (u: UserRow) => can('users.manage') && u.id !== me.user.id;
  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', sort: (u) => u.name, csv: (u) => u.name, render: (u) => <div className="dt-main"><span className="avatar">{initials(u.name)}</span><span className="min-w-0"><b>{u.name}{u.id === me.user.id ? ' (you)' : ''}</b><span className="sub">{u.email}</span></span></div> },
    { key: 'role', header: 'Role', sort: (u) => roleLabel(u.role), csv: (u) => roleLabel(u.role), render: (u) => <span className="pill" title={d?.roles.find((r) => r.id === u.role)?.description}>{roleLabel(u.role)}</span> },
    { key: 'last', header: 'Last sign-in', sort: (u) => (u.lastLoginAt ? -new Date(u.lastLoginAt).getTime() : 0), csv: (u) => u.lastLoginAt ?? 'never', hideBelow: 800, render: (u) => <span className="sub">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</span> },
    { key: 'access', header: 'Access', sort: (u) => (u.active ? 0 : 1), csv: (u) => (u.active ? 'active' : 'inactive'), align: 'right',
      render: (u) => <span className="dt-state"><span className="dot" style={{ ['--c' as string]: u.active ? '#16a34a' : '#a8a29e' }} />{u.active ? 'Active' : 'Inactive'}</span> },
  ];
  const counts = (r: string) => (d?.users ?? []).filter((u) => u.role === r && u.active).length;
  return <>
    <div className="page-h"><div><h1>Users & roles</h1><p>Who can use Studio and what they may do. Permissions are enforced by the server.</p></div>{can('users.manage') && <button className="btn btn-primary" onClick={() => setDlg({ kind: 'add' })}><Icon n="plus" />Add user</button>}</div>
    {d && can('users.manage') && !d.mailReady && <div className="notice n-info"><div>Email sending isn’t set up, so Studio can’t send “forgot password” or welcome links yet. Set it up in <b>Settings → Email</b>. Meanwhile you can set passwords here.</div></div>}
    <div className="grid">
      <section className="card">
        <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search name or email">
          <select className="select" value={st.role} onChange={(e) => set('role', e.target.value)} aria-label="Role"><option value="all">All roles</option>{d?.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </ListToolbar>
        {!d ? <Loading /> : <DataTable id="users" rows={shown} total={d.users.length} rowKey={(u) => u.id} columns={columns} csvName="afcd-studio-users" initialSort={{ key: 'name', dir: 'asc' }}
          onOpen={(u) => { if (manage(u)) setDlg({ kind: 'edit', u }); }}
          rowMenu={(u) => manage(u) ? [
            { label: 'Edit details and role', icon: 'users', run: () => setDlg({ kind: 'edit', u }), quick: true },
            { label: 'Set a new password', icon: 'lock', run: () => setDlg({ kind: 'password', u }) },
            ...(d.mailReady && u.active ? [{ label: 'Email a password link', icon: 'mail', run: () => void sendLink(u) }] : []),
            { label: u.active ? 'Deactivate' : 'Reactivate', icon: u.active ? 'x' : 'undo', danger: u.active, sep: true, run: () => change(u.id, { active: !u.active }, u.active ? 'Deactivated: signed out everywhere' : 'Reactivated') },
          ] : []}
          empty={<EmptyState icon="users" text="No users match these filters" onClear={() => { set('q', ''); set('role', 'all'); set('status', 'all'); }} />} />}
      </section>
      {d && <section className="card"><div className="card-h"><h2>Roles</h2><span className="muted">What each role can do</span></div>
        <div className="role-list">{d.roles.map((r) => { const g = groupPerms(r.permissions); return <details key={r.id} className="role-row">
          <summary><span><b>{r.label}</b><span className="role-count">{counts(r.id)} {counts(r.id) === 1 ? 'person' : 'people'}</span><span className="role-desc" style={{ display: 'block' }}>{r.description}</span></span></summary>
          <dl className="role-perms">{g.map(([area, acts]) => <Fragment key={area}><dt>{area}</dt><dd>{acts.join(', ')}</dd></Fragment>)}</dl>
        </details>; })}</div></section>}
    </div>
    {dlg?.kind === 'add' && d && <AddUser roles={d.roles} mailReady={d.mailReady} onClose={() => setDlg(null)} onDone={() => { setDlg(null); load(); }} />}
    {dlg?.kind === 'edit' && d && <EditUser u={dlg.u} roles={d.roles} onClose={() => setDlg(null)} onPassword={() => setDlg({ kind: 'password', u: dlg.u })} onDone={() => { setDlg(null); load(); }} />}
    {dlg?.kind === 'password' && d && <SetPassword u={dlg.u} mailReady={d.mailReady} onClose={() => setDlg(null)} onSendLink={() => { void sendLink(dlg.u); setDlg(null); }} />}
  </>;
}

// Permission keys (project.publish…) grouped by area, in plain words, for the role overview
const AREA: Record<string, string> = { project: 'Projects', page: 'Pages', news: 'News & stories', partner: 'Partners', pillar: 'Pillars', about: 'Site pages', event: 'Events',
  opportunity: 'Opportunities', publication: 'Publications', forms: 'Inbox', seo: 'SEO', translation: 'Translations', media: 'Media library', users: 'Users', settings: 'Settings',
  site: 'Website', audit: 'Activity log', menu: 'Menus', home: 'Homepage', apply: 'Applications', dashboard: 'Dashboard' };
function groupPerms(perms: string[]): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const p of perms) { const [a, ...rest] = p.split('.'); const k = AREA[a] ?? a.charAt(0).toUpperCase() + a.slice(1); m.set(k, [...(m.get(k) ?? []), rest.join(' ').replace(/_/g, ' ') || 'all']); }
  return [...m];
}

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string; onChange: (v: string) => void }) {
  return <div className="role-pick" role="radiogroup" aria-label="Role">{roles.map((r) => <label key={r.id} className="role-opt">
    <input type="radio" name="role" value={r.id} checked={value === r.id} onChange={() => onChange(r.id)} /><span><b>{r.label}</b><span className="role-desc">{r.description}</span></span></label>)}</div>;
}

function AddUser({ roles, mailReady, onClose, onDone }: { roles: Role[]; mailReady: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', role: 'content_editor', password: '' });
  const [how, setHow] = useState<'link' | 'password'>(mailReady ? 'link' : 'password');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await post('/users', { name: f.name, email: f.email, role: f.role, ...(how === 'link' ? { sendLink: true } : { password: f.password }) });
      toast(how === 'link' ? `User added. ${f.email} got an email to choose a password.` : 'User added. Share the password with them privately.'); onDone();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  return <Modal title="Add user" onClose={onClose}><form onSubmit={submit}><div className="modal-b stack">
    <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} autoFocus /></label>
      <label className="field"><span>Email</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
    </div>
    <div className="field"><span>Role</span><RolePicker roles={roles} value={f.role} onChange={(role) => setF({ ...f, role })} /></div>
    <div className="field"><span>Password</span>
      <div className="role-pick">
        <label className="role-opt"><input type="radio" name="how" checked={how === 'link'} disabled={!mailReady} onChange={() => setHow('link')} /><span><b>Email them a link to choose their own</b><span className="role-desc">{mailReady ? 'Recommended. The link works once, for 3 days.' : 'Needs email sending (Settings → Email).'}</span></span></label>
        <label className="role-opt"><input type="radio" name="how" checked={how === 'password'} onChange={() => setHow('password')} /><span><b>Set a temporary password</b><span className="role-desc">You share it with them privately. They can change it from their account menu.</span></span></label>
      </div></div>
    {how === 'password' && <div className="field"><span>Temporary password</span><div className="pw-gen"><div style={{ flex: 1 }}><PasswordInput label="Temporary password" value={f.password} onChange={(password) => setF({ ...f, password })} /></div>
      <button type="button" className="btn" onClick={() => setF({ ...f, password: generatePassword() })}>Generate</button></div><small className="muted">At least 12 characters.</small></div>}
    {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
  </div><div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button></div></form></Modal>;
}

function EditUser({ u, roles, onClose, onDone, onPassword }: { u: UserRow; roles: Role[]; onClose: () => void; onDone: () => void; onPassword: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: u.name, email: u.email, role: u.role });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== (u as Record<string, unknown>)[k]));
    if (!Object.keys(body).length) { onClose(); return; }
    try { await patch(`/users/${u.id}`, body); toast('User updated'); onDone(); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  return <Modal title="Edit user" onClose={onClose}><form onSubmit={submit}><div className="modal-b stack">
    <div className="um-head"><span className="avatar">{initials(u.name)}</span><span><b>{u.name}</b><small>{u.lastLoginAt ? `Last signed in ${ago(u.lastLoginAt)}` : 'Has never signed in'}</small></span></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></label>
      <label className="field"><span>Email</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
    </div>
    <div className="field"><span>Role</span><RolePicker roles={roles} value={f.role} onChange={(role) => setF({ ...f, role })} /></div>
    <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={onPassword}><Icon n="lock" />Password…</button>
    {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
  </div><div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div></form></Modal>;
}

function SetPassword({ u, mailReady, onClose, onSendLink }: { u: UserRow; mailReady: boolean; onClose: () => void; onSendLink: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 12) { setErr('Use at least 12 characters.'); return; }
    setBusy(true);
    try { await post(`/users/${u.id}/password`, { password: pw }); toast(`Password changed for ${u.name}. They were signed out; share it with them privately.`); onClose(); }
    catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  return <Modal size="sm" title={`Password for ${u.name}`} onClose={onClose}><form onSubmit={submit}><div className="modal-b stack">
    {mailReady && u.active && <><button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={onSendLink}><Icon n="mail" />Email {u.email} a link instead</button>
      <small className="muted">Recommended: they choose their own password and you never see it.</small><hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '4px 0' }} /></>}
    <div className="field"><span>New password</span><div className="pw-gen"><div style={{ flex: 1 }}><PasswordInput label="New password" value={pw} onChange={setPw} autoFocus /></div>
      <button type="button" className="btn" onClick={() => setPw(generatePassword())}>Generate</button></div>
      <small className="muted">At least 12 characters. They are signed out everywhere and sign in again with it.</small></div>
    {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
  </div><div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button></div></form></Modal>;
}

/** Your own password, from the account menu. */
export function ChangeMyPassword({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 12) { setErr('Use at least 12 characters.'); return; }
    if (pw !== pw2) { setErr('The two new passwords are not the same.'); return; }
    setBusy(true);
    try { await post('/me/password', { current: cur, password: pw }); toast('Password changed. You were signed out on your other devices.'); onClose(); }
    catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  return <Modal size="sm" title="Change your password" onClose={onClose}><form onSubmit={submit}><div className="modal-b stack">
    <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus required /></label>
    <div className="field"><span>New password</span><PasswordInput label="New password" value={pw} onChange={setPw} /><small className="muted">At least 12 characters. A short sentence works well.</small></div>
    <div className="field"><span>Type the new password again</span><PasswordInput label="Type the new password again" value={pw2} onChange={setPw2} /></div>
    {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
  </div><div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div></form></Modal>;
}
