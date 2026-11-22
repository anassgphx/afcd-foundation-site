// AFCD Studio admin app: session gate, shell (sidebar + top bar) and routes.
import React, { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import { api, post, setCsrf, ApiError } from './api.ts';
import { Icon, Link, MeCtx, ToastHost, initials, navigate, useCan, useMe, usePath, type Me } from './ui.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { ProjectsList } from './pages/Projects.tsx';
import { ProjectEditor } from './pages/ProjectEditor.tsx';
import { PagesList } from './pages/PagesList.tsx';
import { Builder } from './pages/Builder.tsx';
import { MediaLibrary } from './pages/Media.tsx';
import { ApprovalQueue, Publishing, ActivityLog, Users } from './pages/Admin.tsx';

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = () => api<Me>('/me').then((m) => { setCsrf(m.csrf); setMe(m); }).catch(() => setMe(null));
  useEffect(() => { load(); }, []);
  if (me === undefined) return <div className="login"><div className="skeleton" style={{ width: 160 }} /></div>;
  if (me === null) return <Login onDone={load} />;
  return <MeCtx.Provider value={me}><ToastHost><Shell onLogout={() => { post('/auth/logout').finally(() => setMe(null)); }} /></ToastHost></MeCtx.Provider>;
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/auth/login', { email, password }); onDone(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand-mark">AF</div>
        <h1>Sign in to AFCD Studio</h1>
        <p>Manage the AFCD Foundation website.</p>
        <div className="stack">
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {err && <div className="notice n-bad" role="alert">{err}</div>}
          <button className="btn btn-primary" disabled={busy} style={{ height: 38 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </main>
  );
}

type NavItem = { to: string; label: string; icon: string; perm: string; match?: RegExp };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ to: '/studio/', label: 'Dashboard', icon: 'dash', perm: 'dashboard.read', match: /^\/studio\/?$/ }] },
  { group: 'Website', items: [{ to: '/studio/pages', label: 'Pages', icon: 'layers', perm: 'page.read', match: /^\/studio\/pages/ }] },
  { group: 'Content', items: [{ to: '/studio/projects', label: 'Projects', icon: 'folder', perm: 'project.read', match: /^\/studio\/projects/ }] },
  { group: 'Media', items: [{ to: '/studio/media', label: 'Media Library', icon: 'image', perm: 'media.read' }] },
  { group: 'Workflow', items: [
    { to: '/studio/approvals', label: 'Approval Queue', icon: 'inbox', perm: 'project.read' },
    { to: '/studio/publishing', label: 'Publishing', icon: 'globe', perm: 'dashboard.read' },
  ] },
  { group: 'Administration', items: [
    { to: '/studio/users', label: 'Users & Roles', icon: 'users', perm: 'users.read' },
    { to: '/studio/activity', label: 'Activity Log', icon: 'log', perm: 'audit.read' },
  ] },
];

function Shell({ onLogout }: { onLogout: () => void }) {
  const me = useMe(); const can = useCan(); const path = usePath();
  const [collapsed, setCollapsed] = useState(() => localStorageGet('studio.side') === '1');
  const [mobile, setMobile] = useState(false);
  const [queue, setQueue] = useState(0);
  useEffect(() => { setMobile(false); }, [path]);
  useEffect(() => { if (can('project.read')) api('/projects').then((p: any[]) => setQueue(p.filter((x) => x.status === 'in_review' || x.status === 'approved').length)).catch(() => {}); }, [path]);
  const isOn = (i: NavItem) => (i.match ? i.match.test(path) : path.startsWith(i.to));
  const page = route(path);
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${mobile ? ' mobile-open' : ''}`}>
      <aside className="side" aria-label="Studio navigation">
        <div className="brand"><span className="brand-mark">AF</span><span className="brand-text">AFCD Studio<small>Website management</small></span></div>
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => can(i.perm));
            if (!items.length) return null;
            return <div className="nav-group" key={g.group}><span>{g.group}</span>
              {items.map((i) => <Link key={i.to} to={i.to} className={isOn(i) ? 'on' : ''} aria-current={isOn(i) ? 'page' : undefined} title={i.label}>
                <Icon n={i.icon} /><span>{i.label}</span>{i.to.endsWith('approvals') && queue > 0 && <em className="count">{queue}</em>}
              </Link>)}
            </div>;
          })}
        </nav>
        <div className="side-foot">
          <a href="/" onClick={(e) => { e.preventDefault(); window.open(me.siteUrl, '_blank', 'noopener'); }} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }} title="Open the public website">
            <Icon n="ext" /><span className="brand-text">View website</span>
          </a>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <button className="btn btn-ghost icon-btn mobile-menu" onClick={() => setMobile((v) => !v)} aria-label="Open navigation"><Icon n="menu" /></button>
          <button className="btn btn-ghost icon-btn" onClick={() => { const v = !collapsed; setCollapsed(v); localStorageSet('studio.side', v ? '1' : '0'); }} aria-label="Collapse navigation" title="Collapse navigation"><Icon n="side" /></button>
          <div className="crumbs"><span>Studio</span><Icon n="chev" width={14} height={14} /><b>{page.title}</b></div>
          <div className="top-right">
            <div className="user-chip" title={me.user.email}><span className="avatar">{initials(me.user.name)}</span><span>{me.user.name}<br /><small>{me.user.roleLabel}</small></span></div>
            <button className="btn btn-ghost icon-btn" onClick={onLogout} aria-label="Sign out" title="Sign out"><Icon n="logout" /></button>
          </div>
        </header>
        <main className={`content${page.full ? ' content-full' : ''}`} id="main">{page.el}</main>
      </div>
      {mobile && <div className="overlay" style={{ zIndex: 30, background: 'rgba(0,0,0,.25)' }} onClick={() => setMobile(false)} />}
    </div>
  );
}

function route(path: string): { title: string; el: React.ReactElement; full?: boolean } {
  const pg = path.match(/^\/studio\/pages\/([0-9a-f-]{36})$/);
  if (pg) return { title: 'Page builder', el: <Builder key={pg[1]} id={pg[1]} />, full: true };
  if (path.startsWith('/studio/pages')) return { title: 'Pages', el: <PagesList /> };
  const m = path.match(/^\/studio\/projects\/([0-9a-f-]{36}|new)$/);
  if (m) return { title: m[1] === 'new' ? 'New project' : 'Edit project', el: <ProjectEditor key={m[1]} id={m[1]} /> };
  if (path.startsWith('/studio/projects')) return { title: 'Projects', el: <ProjectsList /> };
  if (path.startsWith('/studio/media')) return { title: 'Media Library', el: <MediaLibrary /> };
  if (path.startsWith('/studio/approvals')) return { title: 'Approval Queue', el: <ApprovalQueue /> };
  if (path.startsWith('/studio/publishing')) return { title: 'Publishing', el: <Publishing /> };
  if (path.startsWith('/studio/activity')) return { title: 'Activity Log', el: <ActivityLog /> };
  if (path.startsWith('/studio/users')) return { title: 'Users & Roles', el: <Users /> };
  if (path !== '/studio/' && path !== '/studio') { setTimeout(() => navigate('/studio/')); }
  return { title: 'Dashboard', el: <Dashboard /> };
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
