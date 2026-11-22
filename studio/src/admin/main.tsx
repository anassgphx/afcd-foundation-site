// AFCD Studio admin app: session gate, shell (sidebar + top bar) and routes.
import React, { StrictMode, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import { api, post, setCsrf, ApiError } from './api.ts';
import { Icon, Link, MeCtx, ToastHost, initials, navigate, useCan, useMe, usePath, type Me } from './ui.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { ProjectsList } from './pages/Projects.tsx';
import { ProjectEditor } from './pages/ProjectEditor.tsx';
import { PagesList } from './pages/PagesList.tsx';
import { Builder } from './pages/Builder.tsx';
import { NewsList, ArticleEditor } from './pages/News.tsx';
import { PartnersList, PartnerEditor } from './pages/Partners.tsx';
import { EventsList, EventEditor } from './pages/Events.tsx';
import { OpportunitiesList, OpportunityEditor } from './pages/Opportunities.tsx';
import { FormsPage } from './pages/Forms.tsx';
import { SeoPage } from './pages/Seo.tsx';
import { TranslationsPage } from './pages/Translations.tsx';
import { MenusPage } from './pages/Menus.tsx';
import { HomeEditor } from './pages/Home.tsx';
import { Breadcrumbs, Notifications, SearchButton, UserMenu, useRecent, type NavLink } from './Topbar.tsx';
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
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(''); const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  useEffect(() => { api<{ siteUrl: string }>('/public-config').then((c) => setSiteUrl(c.siteUrl)).catch(() => {}); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    const fe: typeof fieldErr = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = 'Enter the email address of your Studio account.';
    if (!password) fe.password = 'Enter your password.';
    setFieldErr(fe);
    if (fe.email || fe.password) return;
    setBusy(true);
    try { await post('/auth/login', { email: email.trim(), password }); onDone(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not sign in. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  const FEATURES: [string, string, string][] = [
    ['users', 'Youth Empowerment', 'Young people building leadership, civic skills and local initiatives.'],
    ['heart', 'Women’s Empowerment', 'Confidence, learning and opportunities for women in community life.'],
    ['leaf', 'Environment and Climate', 'Community action and dialogue on Morocco’s climate priorities.'],
    ['monitor', 'Digital Inclusion and Innovation', 'Digital skills, AI, science and emerging technologies for all.'],
  ];
  useEffect(() => { const prev = document.title; document.title = 'AFCD Portal · Sign in'; return () => { document.title = prev; }; }, []);
  return (
    <main className="auth">
      <section className="auth-brand" aria-label="AFCD Portal">
        <div className="auth-motif" aria-hidden="true" />
        <div className="auth-line" aria-hidden="true" />
        <div className="auth-glow" aria-hidden="true" />
        <img className="auth-logo" src="/studio/brand/afcd-logo-white.png" alt="AFCD Foundation" width="1525" height="318" />
        <div className="auth-copy">
          <span className="auth-kicker"><span className="auth-dot" aria-hidden="true" />AFCD Portal</span>
          <h1>AFCD Foundation <span>Portal.</span></h1>
          <p>Sign in to manage our work across four pillars, from projects and stories to events and media.</p>
        </div>
        <ul className="auth-features" aria-label="Our four pillars">{FEATURES.map(([ic, t, d]) => <li key={t}><span className="auth-ico"><Icon n={ic} /></span><b>{t}</b><small>{d}</small></li>)}</ul>
        <small className="auth-foot">© {new Date().getFullYear()} AFCD Foundation · Marrakech, Morocco</small>
      </section>

      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate aria-describedby={err ? 'auth-err' : undefined}>
          <h2>Sign in</h2>
          <p className="auth-sub">Use your AFCD Portal account.</p>
          <label className="auth-field">
            <span>Email</span>
            <span className={`auth-in${fieldErr.email ? ' bad' : ''}`}><Icon n="mail" />
              <input type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setFieldErr((f) => ({ ...f, email: undefined })); }}
                aria-invalid={!!fieldErr.email} aria-describedby={fieldErr.email ? 'err-email' : undefined} placeholder="you@afcdteam.com" autoFocus required /></span>
            {fieldErr.email && <small id="err-email" className="auth-err-t">{fieldErr.email}</small>}
          </label>
          <label className="auth-field">
            <span>Password</span>
            <span className={`auth-in${fieldErr.password ? ' bad' : ''}`}><Icon n="lock" />
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setFieldErr((f) => ({ ...f, password: undefined })); }}
                aria-invalid={!!fieldErr.password} aria-describedby={fieldErr.password ? 'err-pw' : undefined} required />
              <button type="button" className="auth-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}><Icon n={show ? 'eyeoff' : 'eye'} /></button></span>
            {fieldErr.password && <small id="err-pw" className="auth-err-t">{fieldErr.password}</small>}
          </label>
          {err && <div id="auth-err" className="auth-alert" role="alert"><Icon n="alert" />{err}</div>}
          <button className="auth-btn" disabled={busy}>{busy ? <><span className="auth-spin" aria-hidden="true" />Signing in…</> : <>Sign in<span className="auth-btn-arr" aria-hidden="true">→</span></>}</button>
          <p className="auth-note">Access is for AFCD staff. Ask an administrator for an account.</p>
          {siteUrl && <a className="auth-back" href={siteUrl}>← Back to website</a>}
        </form>
      </section>
    </main>
  );
}

type NavItem = { to: string; label: string; icon: string; perm: string; match?: RegExp };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ to: '/studio/', label: 'Dashboard', icon: 'dash', perm: 'dashboard.read', match: /^\/studio\/?$/ }] },
  { group: 'Website', items: [{ to: '/studio/home', label: 'Homepage', icon: 'home', perm: 'page.read', match: /^\/studio\/home/ }, { to: '/studio/pages', label: 'Pages', icon: 'layers', perm: 'page.read', match: /^\/studio\/pages/ },
    { to: '/studio/menus', label: 'Menus', icon: 'menu', perm: 'page.read', match: /^\/studio\/menus/ },
    { to: '/studio/seo', label: 'SEO', icon: 'search', perm: 'seo.read', match: /^\/studio\/seo/ },
    { to: '/studio/translations', label: 'Translations', icon: 'globe', perm: 'translation.read', match: /^\/studio\/translations/ }] },
  { group: 'Content', items: [
    { to: '/studio/projects', label: 'Projects', icon: 'folder', perm: 'project.read', match: /^\/studio\/projects/ },
    { to: '/studio/news', label: 'News & Stories', icon: 'log', perm: 'news.read', match: /^\/studio\/news/ },
    { to: '/studio/events', label: 'Events', icon: 'calendar', perm: 'event.read', match: /^\/studio\/events/ },
    { to: '/studio/opportunities', label: 'Opportunities', icon: 'spark', perm: 'opportunity.read', match: /^\/studio\/opportunities/ },
    { to: '/studio/partners', label: 'Partners', icon: 'partner', perm: 'partner.read', match: /^\/studio\/partners/ },
  ] },
  { group: 'Media', items: [{ to: '/studio/media', label: 'Media Library', icon: 'image', perm: 'media.read' }] },
  { group: 'Inbox', items: [{ to: '/studio/forms', label: 'Forms', icon: 'mail', perm: 'forms.read', match: /^\/studio\/forms/ }] },
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
  // the active-page highlight glides to the selected item (measured after every navigation and resize)
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ top: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => { const nav = navRef.current; const el = nav?.querySelector<HTMLElement>('a.on'); if (!nav || !el) { setInd(null); return; } const a = el.getBoundingClientRect(), n = nav.getBoundingClientRect(); setInd({ top: a.top - n.top, h: a.height }); };
    measure();
    // the layout settles after fonts load, the menu fades in, or the sidebar collapses: measure again whenever it changes size
    const ro = new ResizeObserver(measure); if (navRef.current) ro.observe(navRef.current);
    const t = setTimeout(measure, 400);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [path, collapsed, queue]);
  const links: NavLink[] = NAV.flatMap((g) => g.items.filter((i) => can(i.perm)).map((i) => ({ to: i.to, label: i.label, icon: i.icon, perm: i.perm, group: g.group })));
  useRecent(path, links);
  const page = route(path);
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${mobile ? ' mobile-open' : ''}`}>
      <aside className="side" aria-label="Studio navigation">
        <Link to="/studio/" className="brand" aria-label="AFCD Studio, dashboard"><img className="brand-logo" src="/studio/brand/afcd-logo.png" alt="AFCD Foundation" width="640" height="133" /><img className="brand-sym" src="/studio/brand/afcd-mark.png" alt="AFCD" width="30" height="30" /><span className="brand-tag">Studio</span></Link>
        <nav className="nav" ref={navRef}>
          <span className="nav-ind" aria-hidden="true" style={ind ? { transform: `translateY(${ind.top}px)`, height: ind.h, opacity: 1 } : { opacity: 0 }} />
          {NAV.map((g) => {
            const items = g.items.filter((i) => can(i.perm));
            if (!items.length) return null;
            return <div className="nav-group" key={g.group}><span className="nav-label">{g.group}</span>
              {items.map((i) => <Link key={i.to} to={i.to} className={isOn(i) ? 'on' : ''} aria-current={isOn(i) ? 'page' : undefined} title={i.label}>
                <Icon n={i.icon} /><span className="nav-text">{i.label}</span>{i.to.endsWith('approvals') && queue > 0 && <em className="count">{queue}</em>}
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
          <Breadcrumbs path={path} title={page.title} nav={links} />
          <div className="top-right">
            <SearchButton nav={links} />
            <Notifications path={path} />
            <UserMenu onLogout={onLogout} />
          </div>
        </header>
        <main className={`content${page.full ? ' content-full' : ''}`} id="main">{page.el}</main>
      </div>
      {mobile && <div className="overlay" style={{ zIndex: 30, background: 'rgba(0,0,0,.25)' }} onClick={() => setMobile(false)} />}
    </div>
  );
}

function route(path: string): { title: string; el: React.ReactElement; full?: boolean } {
  if (path.startsWith('/studio/home')) return { title: 'Homepage', el: <HomeEditor />, full: true };
  if (path.startsWith('/studio/seo')) return { title: 'SEO', el: <SeoPage key={path} /> };
  if (path.startsWith('/studio/translations')) return { title: 'Translations', el: <TranslationsPage /> };
  if (path.startsWith('/studio/menus')) return { title: 'Menus', el: <MenusPage /> };
  if (path.startsWith('/studio/forms')) return { title: 'Forms', el: <FormsPage /> };
  const op = path.match(/^\/studio\/opportunities\/([0-9a-f-]{36})$/);
  if (op) return { title: 'Opportunity', el: <OpportunityEditor key={op[1]} id={op[1]} /> };
  if (path.startsWith('/studio/opportunities')) return { title: 'Opportunities', el: <OpportunitiesList /> };
  const ev = path.match(/^\/studio\/events\/([0-9a-f-]{36})$/);
  if (ev) return { title: 'Event', el: <EventEditor key={ev[1]} id={ev[1]} /> };
  if (path.startsWith('/studio/events')) return { title: 'Events', el: <EventsList /> };
  const pt = path.match(/^\/studio\/partners\/([0-9a-f-]{36})$/);
  if (pt) return { title: 'Partner', el: <PartnerEditor key={pt[1]} id={pt[1]} /> };
  if (path.startsWith('/studio/partners')) return { title: 'Partners', el: <PartnersList /> };
  const nw = path.match(/^\/studio\/news\/([0-9a-f-]{36})$/);
  if (nw) return { title: 'Story', el: <ArticleEditor key={nw[1]} id={nw[1]} />, full: true };
  if (path.startsWith('/studio/news')) return { title: 'News & Stories', el: <NewsList /> };
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
