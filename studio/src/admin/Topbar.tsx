// Top bar: breadcrumbs, search (⌘K), notifications and the user menu. Everything shown comes from the server and
// respects the signed-in user's permissions; nothing here is decorative.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.ts';
import { Icon, Link, ago, initials, navigate, useCan, useMe } from './ui.tsx';
import './account-menu.css';
import './topbar.css';
import { NavIcon } from './navIcons.tsx';
import { NAV_SHORTCUTS } from './Sidebar.tsx';

export type NavLink = { to: string; label: string; icon: string; perm: string; group: string };
type Hit = { kind: string; id: string; title: string; sub: string; href: string; status: string };
type Note = { id: string; kind: 'review' | 'publish' | 'changes' | 'failed' | 'forms'; title: string; sub: string; href: string; at: string };
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Closes a popover on outside click and Escape. */
function usePopover() {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);
  return { open, setOpen, ref };
}

export function Breadcrumbs({ path, title, nav }: { path: string; title: string; nav: NavLink[] }) {
  // the most specific section wins (/studio/apply/calls/… is under Calls, not the Applications overview)
  const parent = nav.filter((n) => n.to !== '/studio/' && path.startsWith(n.to) && path !== n.to && n.label !== title).sort((a, b) => b.to.length - a.to.length)[0];
  return <nav className="crumbs" aria-label="Breadcrumb">
    <Link to="/studio/">Studio</Link><NavIcon n="chevRight" width={14} height={14} className="tb-crumb-sep" />
    {parent && <><Link to={parent.to}>{parent.label}</Link><NavIcon n="chevRight" width={14} height={14} className="tb-crumb-sep" /></>}
    <b aria-current="page">{title}</b>
  </nav>;
}

// ---------------------------------------------------------------- Search (command palette)
export function SearchButton({ nav }: { nav: NavLink[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '') && !(e.target as HTMLElement)?.isContentEditable) { e.preventDefault(); setOpen(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return <>
    <button className="tb-search" onClick={() => setOpen(true)} aria-label="Search Studio" aria-haspopup="dialog"><NavIcon n="find" /><span>Search projects, stories, pages…</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd></button>
    {open && <Palette nav={nav} onClose={() => setOpen(false)} />}
  </>;
}

function Palette({ nav, onClose }: { nav: NavLink[]; onClose: () => void }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState<Hit[]>([]); const [loading, setLoading] = useState(false); const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    setLoading(true);
    const t = setTimeout(() => { api<Hit[]>(`/search?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])).finally(() => setLoading(false)); }, 180);
    return () => clearTimeout(t);
  }, [q]);
  const recent: string[] = useMemo(() => { try { return JSON.parse(store.get('studio.recent') ?? '[]'); } catch { return []; } }, []);
  const pages = nav.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase()) || n.group.toLowerCase().includes(q.toLowerCase()));
  const items: { key: string; label: string; sub: string; href: string; icon: string; group: string }[] = [
    ...(!q ? recent.map((h) => nav.find((n) => n.to === h)).filter(Boolean).slice(0, 4).map((n) => ({ key: `r${n!.to}`, label: n!.label, sub: n!.group, href: n!.to, icon: n!.icon, group: 'Recent' })) : []),
    ...hits.map((h) => ({ key: `h${h.id}`, label: h.title, sub: `${h.kind} · ${h.sub ?? ''} · ${h.status.replace('_', ' ')}`, href: h.href, icon: { Project: 'folder', Story: 'log', Event: 'calendar', Opportunity: 'spark', Publication: 'book', Partner: 'partner', Page: 'layers' }[h.kind] ?? 'search', group: 'Content' })),
    ...pages.slice(0, q ? 6 : 12).map((n) => ({ key: `n${n.to}`, label: n.label, sub: n.group, href: n.to, icon: n.icon, group: 'Go to' })),
  ];
  useEffect(() => { setI(0); }, [q, hits.length]);
  const go = (href: string) => { onClose(); navigate(href); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    if (e.key === 'Enter' && items[i]) { e.preventDefault(); go(items[i].href); }
    if (e.key === 'Escape') onClose();
  };
  let lastGroup = '';
  return <div className="pal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="pal" role="dialog" aria-modal="true" aria-label="Search Studio">
      <div className="pal-in"><Icon n="search" /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Search content or jump to a section" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={items[i] ? `pal-${i}` : undefined} />{loading && <span className="muted" style={{ fontSize: 12 }}>Searching…</span>}<kbd>Esc</kbd></div>
      <ul className="pal-list" id="pal-list" role="listbox">
        {items.map((it, idx) => { const head = it.group !== lastGroup ? (lastGroup = it.group) : null; return <li key={it.key} role="presentation">
          {head && <div className="pal-group">{head}</div>}
          <button id={`pal-${idx}`} role="option" aria-selected={idx === i} className={`pal-item${idx === i ? ' on' : ''}`} onMouseEnter={() => setI(idx)} onClick={() => go(it.href)}>
            <span className="pal-ico"><Icon n={it.icon} /></span><span className="min-w-0"><b>{it.label}</b><small>{it.sub}</small></span><Icon n="chev" width={14} height={14} /></button></li>; })}
        {q.trim().length >= 2 && !loading && !items.length && <li className="pal-empty">Nothing matches “{q}”.</li>}
      </ul>
      <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>/</kbd> or <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd> search anywhere</span></div>
    </div>
  </div>;
}

/** Remembers recently opened sections for the palette. */
export function useRecent(path: string, nav: NavLink[]) {
  useEffect(() => {
    const n = nav.find((x) => (x.to === '/studio/' ? path === x.to : path.startsWith(x.to))); if (!n) return;
    let list: string[] = []; try { list = JSON.parse(store.get('studio.recent') ?? '[]'); } catch { /* ignore */ }
    store.set('studio.recent', JSON.stringify([n.to, ...list.filter((x) => x !== n.to)].slice(0, 6)));
  }, [path]);
}

// ---------------------------------------------------------------- Notifications
const NOTE_ICON: Record<Note['kind'], string> = { review: 'inbox', publish: 'rocket', changes: 'undo', failed: 'alert', forms: 'mail' };
export function Notifications({ path }: { path: string }) {
  const me = useMe(); const { open, setOpen, ref } = usePopover();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const seenKey = `studio.notes.seen.${me.user.id}`;
  const [seen, setSeen] = useState(() => store.get(seenKey) ?? '');
  const load = useCallback(() => api<Note[]>('/notifications').then(setNotes).catch(() => {}), []);
  useEffect(() => { load(); }, [load, path]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  const unread = (notes ?? []).filter((n) => n.at > seen).length;
  const markRead = () => { const now = new Date().toISOString(); store.set(seenKey, now); setSeen(now); };
  return <div className="tb-pop" ref={ref}>
    <button className="btn btn-ghost icon-btn tb-bell" onClick={() => { setOpen(!open); load(); }} aria-expanded={open} aria-haspopup="true" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} title="Notifications">
      <NavIcon n="bell" />{unread > 0 && <em className="tb-dot">{unread > 9 ? '9+' : unread}</em>}</button>
    {open && <div className="tb-panel tb-notes" role="dialog" aria-label="Notifications">
      <div className="tb-panel-h"><b>Notifications</b>{unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markRead}>Mark all as read</button>}</div>
      {!notes ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : notes.length === 0
        ? <div className="tb-empty"><Icon n="check" /><b>You’re all caught up</b><small>Reviews, publishing problems and new messages appear here.</small></div>
        : <ul>{notes.map((n) => <li key={n.id}><button className={`tb-note${n.at > seen ? ' new' : ''} k-${n.kind}`} onClick={() => { setOpen(false); navigate(n.href); }}>
          <span className="tb-note-ico"><Icon n={NOTE_ICON[n.kind]} /></span><span className="min-w-0"><b>{n.title}</b><small>{n.sub}</small><small className="muted">{ago(n.at)}</small></span></button></li>)}</ul>}
    </div>}
  </div>;
}

// ---------------------------------------------------------------- User menu
// Only real destinations: each item is a screen the user's role can open, or a Studio feature that exists.
type MenuItem = { key: string; label: string; icon: string; hint?: React.ReactNode; run: () => void; href?: string };
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable); };

export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const me = useMe(); const can = useCan();
  const [open, setOpen] = useState(false); const [keys, setKeys] = useState(false);
  // phones get a bottom sheet; it lives on <body> because the top bar's backdrop blur would trap a fixed element
  const [sheet, setSheet] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const mq = matchMedia('(max-width: 640px)'); const f = () => setSheet(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  const wrap = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); }, []);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  // outside click closes; on open, focus the first item
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !menu.current?.contains(t)) close(false); };
    document.addEventListener('mousedown', click);
    items()[0]?.focus();
    return () => document.removeEventListener('mousedown', click);
  }, [open, close]);
  // "?" opens the shortcuts anywhere outside a text field
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '?' && !e.metaKey && !e.ctrlKey && !typing(e.target)) { e.preventDefault(); setOpen(false); setKeys(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    const list = items(); const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') go(at + 1); else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab' && at >= 0) close(false);
  };
  const to = (path: string) => () => { close(false); navigate(path); };
  const mod = isMac ? '⌘' : 'Ctrl';
  const groups: { label: string; items: MenuItem[] }[] = [
    { label: 'Workspace', items: [
      can('users.read') && { key: 'users', label: 'Users & roles', icon: 'users', run: to('/studio/users') },
      can('audit.read') && { key: 'activity', label: 'Activity log', icon: 'log', run: to('/studio/activity') },
      can('dashboard.read') && { key: 'publishing', label: 'Publishing history', icon: 'rocket', run: to('/studio/publishing') },
    ].filter(Boolean) as MenuItem[] },
    { label: 'Help', items: [
      { key: 'search', label: 'Search Studio', icon: 'search', hint: <kbd>{mod} K</kbd>, run: () => { close(false); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); } },
      { key: 'keys', label: 'Keyboard shortcuts', icon: 'dash', hint: <kbd>?</kbd>, run: () => { close(false); setKeys(true); } },
      ...(me.siteUrl ? [{ key: 'site', label: 'View the website', icon: 'globe', hint: <Icon n="ext" className="am-ext" aria-hidden="true" />, href: me.siteUrl, run: () => close(false) }] : []),
    ] },
  ].filter((g) => g.items.length);

  return <div className="tb-pop am" ref={wrap} onKeyDown={onKey}>
    <button ref={trigger} className="user-chip am-trigger" onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}
      aria-expanded={open} aria-haspopup="menu" aria-controls={open ? 'am-menu' : undefined} aria-label={`Account menu for ${me.user.name}`}>
      <span className="avatar">{initials(me.user.name)}</span><span className="user-chip-t">{me.user.name}<small>{me.user.roleLabel}</small></span><NavIcon n="chevDown" width={15} height={15} className="am-caret" /></button>
    {open && (sheet ? (x: React.ReactNode) => createPortal(<div className="am-sheet">{x}</div>, document.body) : (x: React.ReactNode) => x)(<>
      <div className="am-scrim" aria-hidden="true" onMouseDown={() => close(false)} />
      <div className="am-menu" id="am-menu" role="menu" aria-label="Account" ref={menu}>
        <div className="am-head">
          <span className="am-avatar" aria-hidden="true">{initials(me.user.name)}<i title="Signed in" /></span>
          <span className="am-who"><b>{me.user.name}</b><small>{me.user.email}</small><span className="am-role">{me.user.roleLabel}</span></span>
        </div>
        {groups.map((g) => <div key={g.label} className="am-group" role="group" aria-label={g.label}>
          <div className="am-label" aria-hidden="true">{g.label}</div>
          {g.items.map((it) => it.href
            ? <a key={it.key} role="menuitem" tabIndex={-1} className="am-item" href={it.href} target="_blank" rel="noopener" onClick={it.run}><Icon n={it.icon} /><span>{it.label}<span className="sr-only"> (opens in a new tab)</span></span>{it.hint && <span className="am-hint">{it.hint}</span>}</a>
            : <button key={it.key} role="menuitem" tabIndex={-1} className="am-item" onClick={it.run}><Icon n={it.icon} /><span>{it.label}</span>{it.hint && <span className="am-hint" aria-hidden="true">{it.hint}</span>}</button>)}
        </div>)}
        <div className="am-sep" role="separator" />
        <button role="menuitem" tabIndex={-1} className="am-item am-danger" onClick={() => { close(false); onLogout(); }}><Icon n="logout" /><span>Sign out</span></button>
      </div>
    </>)}
    {keys && <ShortcutsDialog onClose={() => { setKeys(false); trigger.current?.focus(); }} />}
  </div>;
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const can = useCan();
  const jumps = NAV_SHORTCUTS.filter((j) => can(j.perm));
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const mod = isMac ? '⌘' : 'Ctrl';
  return <div className="pal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="pal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ maxWidth: 440 }}>
    <div className="tb-panel-h"><b>Keyboard shortcuts</b><button className="btn btn-ghost icon-btn btn-sm" onClick={onClose} aria-label="Close" autoFocus><Icon n="x" /></button></div>
    <dl className="tb-keys">{[[`${mod} K  or  /`, 'Search and jump anywhere'], ['?', 'Show these shortcuts'], [`${mod} S`, 'Save the open editor'], [`${mod} Z`, 'Undo (page and homepage editors)'], [`${isMac ? '⇧ ⌘' : 'Shift Ctrl'} Z`, 'Redo'], ['↑ ↓', 'Move through menus and search results'], ['Esc', 'Close a dialog or menu'], ...jumps.map((j) => [`G  ${j.key.toUpperCase()}`, `Go to ${j.label}`])].map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
  </div></div>;
}
