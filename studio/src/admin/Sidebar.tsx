// Studio sidebar: workspace header, permission-filtered navigation with real counts, pinned footer.
// Counts come from the server only: the review queue (items waiting on this user) and the Inbox unread total.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { Link, navigate, useCan, useMe } from './ui.tsx';
import { NavIcon } from './navIcons.tsx';
import './sidebar.css';

export type NavItem = { to: string; label: string; icon: string; perm: string; match?: RegExp; key?: string };
// `key`: the second key of a "g then key" shortcut (listed in the Keyboard shortcuts dialog)
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ to: '/studio/', label: 'Dashboard', icon: 'dash', perm: 'dashboard.read', match: /^\/studio\/?$/, key: 'd' }] },
  { group: 'Content', items: [
    { to: '/studio/projects', label: 'Projects', icon: 'folder', perm: 'project.read', match: /^\/studio\/projects/, key: 'p' },
    { to: '/studio/news', label: 'News & stories', icon: 'log', perm: 'news.read', match: /^\/studio\/news/, key: 'n' },
    { to: '/studio/events', label: 'Events', icon: 'calendar', perm: 'event.read', match: /^\/studio\/events/, key: 'e' },
    { to: '/studio/opportunities', label: 'Opportunities', icon: 'spark', perm: 'opportunity.read', match: /^\/studio\/opportunities/, key: 'o' },
    { to: '/studio/publications', label: 'Publications', icon: 'book', perm: 'publication.read', match: /^\/studio\/publications/ },
    { to: '/studio/pillars', label: 'Pillars', icon: 'pillars', perm: 'pillar.read', match: /^\/studio\/pillars/ },
    { to: '/studio/partners', label: 'Partners', icon: 'partner', perm: 'partner.read', match: /^\/studio\/partners/ },
    { to: '/studio/media', label: 'Media library', icon: 'image', perm: 'media.read', match: /^\/studio\/media/, key: 'm' },
  ] },
  { group: 'Website', items: [
    { to: '/studio/home', label: 'Homepage', icon: 'home', perm: 'page.read', match: /^\/studio\/home/, key: 'h' },
    { to: '/studio/contact', label: 'Contact page', icon: 'mail', perm: 'page.read', match: /^\/studio\/contact/ },
    { to: '/studio/pages', label: 'Pages', icon: 'layers', perm: 'page.read', match: /^\/studio\/(pages|about)/ },
    { to: '/studio/menus', label: 'Menus', icon: 'menu', perm: 'page.read', match: /^\/studio\/menus/ },
    { to: '/studio/seo', label: 'SEO', icon: 'search', perm: 'seo.read', match: /^\/studio\/seo/, key: 's' },
    { to: '/studio/translations', label: 'Translations', icon: 'languages', perm: 'translation.read', match: /^\/studio\/translations/, key: 't' },
  ] },
  // AFCD Apply (docs/adr/0004-afcd-apply.md): four places, each call a workspace with tabs, applicants one pipeline
  { group: 'Applications', items: [
    { to: '/studio/apply', label: 'Overview', icon: 'gauge', perm: 'apply.submission.read', match: /^\/studio\/apply\/?$/ },
    { to: '/studio/apply/calls', label: 'Calls', icon: 'megaphone', perm: 'apply.read', match: /^\/studio\/apply\/calls/ },
    { to: '/studio/apply/applicants', label: 'Applicants', icon: 'idcard', perm: 'apply.submission.read', match: /^\/studio\/apply\/applicants/ },
    { to: '/studio/apply/reviews', label: 'My reviews', icon: 'clipboard', perm: 'apply.review', match: /^\/studio\/apply\/reviews/ },
    { to: '/studio/apply/messages', label: 'Messages', icon: 'send', perm: 'apply.message', match: /^\/studio\/apply\/messages/ },
  ] },
  { group: 'Workflow', items: [
    { to: '/studio/inbox', label: 'Inbox', icon: 'inbox', perm: 'forms.read', match: /^\/studio\/(inbox|forms)/, key: 'i' },
    { to: '/studio/approvals', label: 'Approval queue', icon: 'checkcircle', perm: 'project.read', match: /^\/studio\/approvals/, key: 'a' },
    { to: '/studio/publishing', label: 'Publishing', icon: 'rocket', perm: 'dashboard.read', match: /^\/studio\/publishing/ },
  ] },
  { group: 'Administration', items: [
    { to: '/studio/users', label: 'Users & roles', icon: 'users', perm: 'users.read', match: /^\/studio\/users/ },
    { to: '/studio/activity', label: 'Activity log', icon: 'history', perm: 'audit.read', match: /^\/studio\/activity/ },
    { to: '/studio/settings', label: 'Settings', icon: 'settings', perm: 'settings.read', match: /^\/studio\/settings/ },
  ] },
];

const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable); };

type QueueItem = { status: string; canApprove: boolean; canPublish: boolean };

export function Sidebar({ path, collapsed, onToggle, unread, onCloseMobile }: { path: string; collapsed: boolean; onToggle: () => void; unread: number; onCloseMobile: () => void }) {
  const me = useMe(); const can = useCan();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm)) })).filter((g) => g.items.length);
  const isOn = (i: NavItem) => (i.match ? i.match.test(path) : path.startsWith(i.to));

  // review queue: what is waiting on this user (to review, or approved and theirs to publish)
  const [queue, setQueue] = useState(0);
  useEffect(() => {
    if (!can('project.read')) return;
    api<QueueItem[]>('/review-queue').then((r) => setQueue(r.filter((x) => (x.status === 'in_review' && x.canApprove) || (x.status === 'approved' && x.canPublish)).length)).catch(() => {});
  }, [path]);

  // Applications: new applications nobody has looked at, and reviews assigned to this user that are not final yet
  const [fresh, setFresh] = useState(0); const [toReview, setToReview] = useState(0);
  useEffect(() => {
    if (can('apply.submission.read')) api<{ status: Record<string, number> }>('/apply/submissions/counts').then((r) => setFresh(r.status.submitted ?? 0)).catch(() => {});
    if (can('apply.review')) api<{ status: string }[]>('/apply/my-reviews').then((r) => setToReview(r.filter((x) => !['final', 'conflict'].includes(x.status)).length)).catch(() => {});
  }, [path]);

  // "g" then a letter jumps to a section (only sections this role can open)
  useEffect(() => {
    let armed = 0;
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (armed && Date.now() - armed < 1200) {
        armed = 0;
        const hit = groups.flatMap((g) => g.items).find((i) => i.key === e.key.toLowerCase());
        if (hit) { e.preventDefault(); navigate(hit.to); }
        return;
      }
      if (e.key === 'g') armed = Date.now();
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [groups.map((g) => g.items.length).join()]);

  // the active-row highlight glides to the selected item
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ top: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => { const nav = navRef.current; const el = nav?.querySelector<HTMLElement>('a[aria-current="page"]'); if (!nav || !el) { setInd(null); return; } setInd({ top: el.offsetTop, h: el.offsetHeight }); };
    measure();
    // re-measure when the nav or the active row changes size (row height differs on phones, after a rotation, etc.)
    const ro = new ResizeObserver(measure); if (navRef.current) ro.observe(navRef.current);
    const active = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]'); if (active) ro.observe(active);
    addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { ro.disconnect(); removeEventListener('resize', measure); };
  }, [path, collapsed, queue, unread, fresh, toReview]);

  const badge = (i: NavItem) => {
    if (i.to === '/studio/apply/applicants' && fresh > 0) return <em className="sb-count" aria-label={`${fresh} new`}>{fresh > 99 ? '99+' : fresh}</em>;
    if (i.to === '/studio/apply/reviews' && toReview > 0) return <em className="sb-count" aria-label={`${toReview} to finish`}>{toReview > 99 ? '99+' : toReview}</em>;
    if (i.to === '/studio/approvals' && queue > 0) return <em className="sb-count" aria-label={`${queue} waiting for you`}>{queue > 99 ? '99+' : queue}</em>;
    if (i.to === '/studio/inbox' && unread > 0) return <em className="sb-count sb-unread" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</em>;
    return null;
  };

  return <><div className="sb-scrim" aria-hidden="true" onClick={onCloseMobile} />
  <aside className="side sb" aria-label="Studio navigation">
    <div className="sb-head">
      <Link to="/studio/" className="brand sb-brand" aria-label="AFCD Studio, dashboard">
        <img className="brand-logo" src="/studio/brand/afcd-logo.png" alt="" width="640" height="133" />
        <img className="brand-sym" src="/studio/brand/afcd-mark.png" alt="" width="30" height="30" />
      </Link>
      <div className="sb-ws"><span className="sb-ws-name">Studio</span><span className="sb-ws-role" title="Your role">{me.user.roleLabel}</span>{LOCAL && <span className="sb-env" title="Studio is running on this computer">Local</span>}</div>
    </div>

    <nav className="nav sb-nav" ref={navRef} aria-label="Sections">
      <span className="nav-ind sb-ind" aria-hidden="true" style={ind ? { transform: `translateY(${ind.top}px)`, height: ind.h, opacity: 1 } : { opacity: 0 }} />
      {groups.map((g) => <div className="nav-group sb-group" key={g.group} role="group" aria-labelledby={`sb-${g.group}`}>
        {g.group !== 'Overview' && <span className="nav-label sb-label" id={`sb-${g.group}`}>{g.group}</span>}
        {g.items.map((i) => { const on = isOn(i); return <Link key={i.to} to={i.to} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} title={collapsed ? i.label : undefined}>
          <NavIcon n={i.icon} /><span className="nav-text">{i.label}</span>{badge(i) ?? (i.key && !collapsed && <kbd className="sb-kbd" aria-hidden="true" title={`Shortcut: G then ${i.key.toUpperCase()}`}>G {i.key.toUpperCase()}</kbd>)}
        </Link>; })}
      </div>)}
    </nav>

    <div className="side-foot sb-foot">
      <a href={me.siteUrl} target="_blank" rel="noopener" className="sb-foot-btn" title={collapsed ? 'View website (opens in a new tab)' : undefined}>
        <NavIcon n="globe" /><span className="nav-text">View website</span><NavIcon n="ext" className="sb-ext" /><span className="sr-only"> (opens in a new tab)</span>
      </a>
      <button type="button" className="sb-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed}>
        <NavIcon n={collapsed ? 'sideOpen' : 'side'} />
      </button>
    </div>
  </aside></>;
}

/** The "g then key" shortcuts, for the Keyboard shortcuts dialog. */
export const NAV_SHORTCUTS = NAV.flatMap((g) => g.items.filter((i) => i.key).map((i) => ({ key: i.key!, label: i.label, perm: i.perm })));
