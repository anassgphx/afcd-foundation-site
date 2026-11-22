// Top bar: breadcrumbs, search (⌘K), notifications and the user menu. Everything shown comes from the server and
// respects the signed-in user's permissions; nothing here is decorative.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.ts';
import { Icon, Link, ago, initials, navigate, useCan, useMe } from './ui.tsx';

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
  const parent = nav.find((n) => n.to !== '/studio/' && path.startsWith(n.to) && path !== n.to && n.label !== title);
  return <nav className="crumbs" aria-label="Breadcrumb">
    <Link to="/studio/">Studio</Link><Icon n="chev" width={14} height={14} />
    {parent && <><Link to={parent.to}>{parent.label}</Link><Icon n="chev" width={14} height={14} /></>}
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
    <button className="tb-search" onClick={() => setOpen(true)} aria-label="Search Studio" aria-haspopup="dialog"><Icon n="search" /><span>Search projects, stories, pages…</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd></button>
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
    ...hits.map((h) => ({ key: `h${h.id}`, label: h.title, sub: `${h.kind} · ${h.sub ?? ''} · ${h.status.replace('_', ' ')}`, href: h.href, icon: { Project: 'folder', Story: 'log', Event: 'calendar', Opportunity: 'spark', Partner: 'partner', Page: 'layers' }[h.kind] ?? 'search', group: 'Content' })),
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
      <Icon n="bell" />{unread > 0 && <em className="tb-dot">{unread > 9 ? '9+' : unread}</em>}</button>
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
export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const me = useMe(); const can = useCan(); const { open, setOpen, ref } = usePopover(); const [keys, setKeys] = useState(false);
  return <div className="tb-pop" ref={ref}>
    <button className="user-chip" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account menu for ${me.user.name}`}>
      <span className="avatar">{initials(me.user.name)}</span><span className="user-chip-t">{me.user.name}<small>{me.user.roleLabel}</small></span><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(90deg)' }} /></button>
    {open && <div className="tb-panel tb-user" role="menu">
      <div className="tb-user-h"><span className="avatar lg">{initials(me.user.name)}</span><span className="min-w-0"><b>{me.user.name}</b><small>{me.user.email}</small><span className="pill">{me.user.roleLabel}</span></span></div>
      <a role="menuitem" className="tb-mi" href={me.siteUrl} target="_blank" rel="noopener" onClick={() => setOpen(false)}><Icon n="ext" />View the website</a>
      {can('audit.read') && <button role="menuitem" className="tb-mi" onClick={() => { setOpen(false); navigate('/studio/activity'); }}><Icon n="log" />Activity log</button>}
      {can('users.read') && <button role="menuitem" className="tb-mi" onClick={() => { setOpen(false); navigate('/studio/users'); }}><Icon n="users" />Users &amp; roles</button>}
      <button role="menuitem" className="tb-mi" onClick={() => { setOpen(false); setKeys(true); }}><Icon n="dash" />Keyboard shortcuts</button>
      <div className="tb-sep" />
      <button role="menuitem" className="tb-mi danger" onClick={onLogout}><Icon n="logout" />Sign out</button>
    </div>}
    {keys && <div className="pal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setKeys(false); }}><div className="pal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ maxWidth: 440 }}>
      <div className="tb-panel-h"><b>Keyboard shortcuts</b><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setKeys(false)} aria-label="Close" autoFocus><Icon n="x" /></button></div>
      <dl className="tb-keys">{[[`${isMac ? '⌘' : 'Ctrl'} K  or  /`, 'Search and jump anywhere'], [`${isMac ? '⌘' : 'Ctrl'} S`, 'Save the open editor'], [`${isMac ? '⌘' : 'Ctrl'} Z`, 'Undo (page and homepage editors)'], [`${isMac ? '⇧ ⌘' : 'Shift Ctrl'} Z`, 'Redo'], ['Esc', 'Close a dialog or menu']].map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
    </div></div>}
  </div>;
}
