// AFCD Studio admin app: session gate, shell (sidebar + top bar) and routes.
import React, { StrictMode, Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import './design-system.css';
import { api, post, setCsrf, ApiError } from './api.ts';
import { Icon, Link, MeCtx, ToastHost, initials, navigate, useCan, useMe, usePath, type Me } from './ui.tsx';
import { Dashboard, Loading } from './pages/Dashboard.tsx';
import { Breadcrumbs, Notifications, SearchButton, UserMenu, useRecent, type NavLink } from './Topbar.tsx';
import { NAV, Sidebar } from './Sidebar.tsx';

// Screens load on demand: the first visit downloads the shell and the dashboard only. Each screen is its own file,
// fetched the first time it is opened, and all of them are fetched in the background once Studio is idle.
const SCREENS = {
  projects: () => import('./pages/Projects.tsx'), projectEditor: () => import('./pages/ProjectEditor.tsx'), pagesList: () => import('./pages/PagesList.tsx'),
  builder: () => import('./pages/Builder.tsx'), news: () => import('./pages/News.tsx'), partners: () => import('./pages/Partners.tsx'), pillars: () => import('./pages/Pillars.tsx'), about: () => import('./pages/About.tsx'),
  events: () => import('./pages/Events.tsx'), opportunities: () => import('./pages/Opportunities.tsx'), publications: () => import('./pages/Publications.tsx'), inbox: () => import('./pages/Inbox.tsx'), seo: () => import('./pages/Seo.tsx'),
  translations: () => import('./pages/Translations.tsx'), menus: () => import('./pages/Menus.tsx'), home: () => import('./pages/Home.tsx'), media: () => import('./pages/Media.tsx'),
  admin: () => import('./pages/Admin.tsx'), approvals: () => import('./pages/Approvals.tsx'),
  open: () => import('./pages/OpenPage.tsx'), settings: () => import('./pages/Settings.tsx'),
  applyOverview: () => import('./apply/Overview.tsx'), applyCalls: () => import('./apply/Calls.tsx'), applyForms: () => import('./apply/Forms.tsx'), applySubmissions: () => import('./apply/Submissions.tsx'), applyEvaluation: () => import('./apply/Evaluation.tsx'), applySelection: () => import('./apply/Selection.tsx'),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const screen = <K extends keyof typeof SCREENS>(k: K, name: string) => lazy(() => SCREENS[k]().then((m) => ({ default: (m as any)[name] as React.ComponentType<any> })));
const ProjectsList = screen('projects', 'ProjectsList'), ProjectEditor = screen('projectEditor', 'ProjectEditor'), PagesList = screen('pagesList', 'PagesList');
const Builder = screen('builder', 'Builder'), NewsList = screen('news', 'NewsList'), ArticleEditor = screen('news', 'ArticleEditor');
const PartnersList = screen('partners', 'PartnersList'), PartnerEditor = screen('partners', 'PartnerEditor'), PillarsScreen = screen('pillars', 'PillarsScreen'), AboutEditor = screen('about', 'AboutEditor');
const EventsList = screen('events', 'EventsList'), EventEditor = screen('events', 'EventEditor'), OpportunitiesList = screen('opportunities', 'OpportunitiesList');
const OpportunityEditor = screen('opportunities', 'OpportunityEditor'), InboxPage = screen('inbox', 'InboxPage'), SeoPage = screen('seo', 'SeoPage');
const TranslationsPage = screen('translations', 'TranslationsPage'), MenusPage = screen('menus', 'MenusPage'), HomeEditor = screen('home', 'HomeEditor');
const MediaLibrary = screen('media', 'MediaLibrary'), Publishing = screen('admin', 'Publishing'), ActivityLog = screen('admin', 'ActivityLog'), Users = screen('admin', 'Users');
const ApprovalsPage = screen('approvals', 'ApprovalsPage');
const ApplyOverview = screen('applyOverview', 'ApplyOverview'), CallsList = screen('applyCalls', 'CallsList'), CallEditor = screen('applyCalls', 'CallEditor');
const FormsList = screen('applyForms', 'FormsList'), CallFormBuilder = screen('applyForms', 'CallFormBuilder'), TemplatesPage = screen('applyForms', 'TemplatesPage'), TemplateBuilder = screen('applyForms', 'TemplateBuilder');
const SubmissionsList = screen('applySubmissions', 'SubmissionsList'), SubmissionDetail = screen('applySubmissions', 'SubmissionDetail');
const EvaluationPage = screen('applyEvaluation', 'EvaluationPage'), ReviewScreen = screen('applyEvaluation', 'ReviewScreen'), ShortlistsPage = screen('applySelection', 'ShortlistsPage'), DecisionsPage = screen('applySelection', 'DecisionsPage');
const PublicationsList = screen('publications', 'PublicationsList'), PublicationEditor = screen('publications', 'PublicationEditor');
const OpenPage = screen('open', 'OpenPage');
const SettingsPage = screen('settings', 'SettingsPage');
let warmed = false;
function warmScreens() {   // fetch every screen in the background after the first render, so later navigation is instant
  if (warmed) return; warmed = true;
  const go = () => Object.values(SCREENS).forEach((f) => { f().catch(() => {}); });
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = () => api<Me>('/me').then((m) => { setCsrf(m.csrf, m.user.id); setMe(m); }).catch(() => setMe(null));
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

function Shell({ onLogout }: { onLogout: () => void }) {
  const me = useMe(); const can = useCan(); const path = usePath();
  const [collapsed, setCollapsed] = useState(() => localStorageGet('studio.side') === '1');
  const [mobile, setMobile] = useState(false);
  useEffect(() => { setMobile(false); }, [path]);
  useEffect(() => { warmScreens(); }, []);
  // Inbox unread badge: on navigation, when the Inbox changes something, and every 2 minutes while Studio is open
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!can('forms.read')) return;
    const f = () => { api<{ unread: number }>('/inbox/unread').then((r) => setUnread(r.unread)).catch(() => {}); };
    f(); window.addEventListener('studio:inbox', f); const t = setInterval(f, 120_000);
    return () => { window.removeEventListener('studio:inbox', f); clearInterval(t); };
  }, [path]);
  const links: NavLink[] = NAV.flatMap((g) => g.items.filter((i) => can(i.perm)).map((i) => ({ to: i.to, label: i.label, icon: i.icon, perm: i.perm, group: g.group })));
  useRecent(path, links);
  const page = route(path);
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${mobile ? ' mobile-open' : ''}`}>
      <Sidebar path={path} collapsed={collapsed} unread={unread} onCloseMobile={() => setMobile(false)}
        onToggle={() => { const v = !collapsed; setCollapsed(v); localStorageSet('studio.side', v ? '1' : '0'); }} />
      <div className="main">
        <header className="top">
          <button className="btn btn-ghost icon-btn mobile-menu" onClick={() => setMobile((v) => !v)} aria-label="Open navigation" aria-expanded={mobile}><Icon n="menu" /></button>
          <Breadcrumbs path={path} title={page.title} nav={links} />
          <div className="top-right">
            <SearchButton nav={links} />
            <Notifications path={path} />
            <UserMenu onLogout={onLogout} />
          </div>
        </header>
        <main className={`content${page.full ? ' content-full' : ''}`} id="main"><Suspense fallback={<Loading />}>{page.el}</Suspense></main>
      </div>
      {mobile && <div className="overlay" style={{ zIndex: 30, background: 'rgba(0,0,0,.25)' }} onClick={() => setMobile(false)} />}
    </div>
  );
}

function route(path: string): { title: string; el: React.ReactElement; full?: boolean } {
  if (path.startsWith('/studio/open')) return { title: 'Opening the editor', el: <OpenPage key={location.search} /> };
  if (path.startsWith('/studio/home')) return { title: 'Homepage', el: <HomeEditor key="home" />, full: true };
  if (path.startsWith('/studio/contact')) return { title: 'Contact page', el: <HomeEditor key="contact" path="/page-text/contact.html" />, full: true };
  if (path.startsWith('/studio/seo')) return { title: 'SEO', el: <SeoPage key={path} /> };
  if (path.startsWith('/studio/translations')) return { title: 'Translations', el: <TranslationsPage /> };
  if (path.startsWith('/studio/menus')) return { title: 'Menus', el: <MenusPage /> };
  if (path.startsWith('/studio/inbox') || path.startsWith('/studio/forms')) return { title: 'Inbox', el: <InboxPage /> };
  const af = path.match(/^\/studio\/apply\/calls\/([0-9a-f-]{36})\/form$/);
  if (af) return { title: 'Application form', el: <CallFormBuilder key={af[1]} callId={af[1]} />, full: true };
  const at = path.match(/^\/studio\/apply\/templates\/([0-9a-f-]{36})$/);
  if (at) return { title: 'Template', el: <TemplateBuilder key={at[1]} id={at[1]} />, full: true };
  if (path.startsWith('/studio/apply/templates')) return { title: 'Templates', el: <TemplatesPage /> };
  if (path.startsWith('/studio/apply/forms')) return { title: 'Form builder', el: <FormsList /> };
  const as = path.match(/^\/studio\/apply\/submissions\/([0-9a-f-]{36})$/);
  if (as) return { title: 'Application', el: <SubmissionDetail key={as[1]} id={as[1]} /> };
  if (path.startsWith('/studio/apply/submissions')) return { title: 'Submissions', el: <SubmissionsList /> };
  const ar = path.match(/^\/studio\/apply\/reviews\/([0-9a-f-]{36})$/);
  if (ar) return { title: 'Review', el: <ReviewScreen key={ar[1]} id={ar[1]} /> };
  if (path.startsWith('/studio/apply/evaluation')) return { title: 'Review & evaluation', el: <EvaluationPage /> };
  if (path.startsWith('/studio/apply/shortlists')) return { title: 'Shortlists', el: <ShortlistsPage /> };
  if (path.startsWith('/studio/apply/decisions')) return { title: 'Decisions', el: <DecisionsPage /> };
  const ac = path.match(/^\/studio\/apply\/calls\/([0-9a-f-]{36})$/);
  if (ac) return { title: 'Call', el: <CallEditor key={ac[1]} id={ac[1]} /> };
  if (path.startsWith('/studio/apply/calls')) return { title: 'Calls', el: <CallsList /> };
  if (/^\/studio\/apply\/?$/.test(path)) return { title: 'Applications', el: <ApplyOverview /> };
  const op = path.match(/^\/studio\/opportunities\/([0-9a-f-]{36})$/);
  if (op) return { title: 'Opportunity', el: <OpportunityEditor key={op[1]} id={op[1]} /> };
  if (path.startsWith('/studio/opportunities')) return { title: 'Opportunities', el: <OpportunitiesList /> };
  const pb = path.match(/^\/studio\/publications\/([0-9a-f-]{36})$/);
  if (pb) return { title: 'Publication', el: <PublicationEditor key={pb[1]} id={pb[1]} /> };
  if (path.startsWith('/studio/publications')) return { title: 'Publications', el: <PublicationsList /> };
  const ev = path.match(/^\/studio\/events\/([0-9a-f-]{36})$/);
  if (ev) return { title: 'Event', el: <EventEditor key={ev[1]} id={ev[1]} /> };
  if (path.startsWith('/studio/events')) return { title: 'Events', el: <EventsList /> };
  // site pages (Our Story, Mission & Vision, Strategy, Our Team, Partners texts) live under Pages; /studio/about/… is the older address
  const ab = path.match(/^\/studio\/(?:pages\/site|about)\/([a-z-]+|[0-9a-f-]{36})$/);
  if (ab) return { title: 'Pages', el: <AboutEditor key={ab[1]} refKey={ab[1]} />, full: true };
  if (path.startsWith('/studio/about')) return { title: 'Pages', el: <PagesList /> };
  const pl = path.match(/^\/studio\/pillars\/([0-9a-f-]{36})$/);
  if (pl) return { title: 'Pillar', el: <PillarsScreen key="pillars" id={pl[1]} /> };
  if (path.startsWith('/studio/pillars')) return { title: 'Pillars', el: <PillarsScreen key="pillars" /> };
  const pt = path.match(/^\/studio\/partners\/([0-9a-f-]{36})$/);
  if (pt) return { title: 'Partner', el: <PartnerEditor key={pt[1]} id={pt[1]} /> };
  if (path.startsWith('/studio/partners')) return { title: 'Partners', el: <PartnersList /> };
  const nw = path.match(/^\/studio\/news\/([0-9a-f-]{36})$/);
  if (nw) return { title: 'Story', el: <ArticleEditor key={nw[1]} id={nw[1]} />, full: true };
  if (path.startsWith('/studio/news')) return { title: 'News & stories', el: <NewsList /> };
  const pg = path.match(/^\/studio\/pages\/([0-9a-f-]{36})$/);
  if (pg) return { title: 'Page builder', el: <Builder key={pg[1]} id={pg[1]} />, full: true };
  if (path.startsWith('/studio/pages')) return { title: 'Pages', el: <PagesList /> };
  const m = path.match(/^\/studio\/projects\/([0-9a-f-]{36}|new)$/);
  if (m) return { title: m[1] === 'new' ? 'New project' : 'Edit project', el: <ProjectEditor key={m[1]} id={m[1]} /> };
  if (path.startsWith('/studio/projects')) return { title: 'Projects', el: <ProjectsList /> };
  if (path.startsWith('/studio/media')) return { title: 'Media library', el: <MediaLibrary /> };
  if (path.startsWith('/studio/approvals')) return { title: 'Approval queue', el: <ApprovalsPage /> };
  if (path.startsWith('/studio/publishing')) return { title: 'Publishing', el: <Publishing /> };
  if (path.startsWith('/studio/activity')) return { title: 'Activity log', el: <ActivityLog /> };
  if (path.startsWith('/studio/users')) return { title: 'Users & roles', el: <Users /> };
  if (path.startsWith('/studio/settings')) return { title: 'Settings', el: <SettingsPage /> };
  if (path !== '/studio/' && path !== '/studio') { setTimeout(() => navigate('/studio/')); }
  return { title: 'Dashboard', el: <Dashboard /> };
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
