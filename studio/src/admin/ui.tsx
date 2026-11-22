// Shared UI: icons, status badges, toasts, modal, router helpers, session context.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------- Session
export type Me = { user: { id: string; email: string; name: string; role: string; roleLabel: string }; permissions: string[]; csrf: string; siteUrl: string };
export const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const useCan = () => { const me = useMe(); return (p: string) => me.permissions.includes(p); };

// ---------------------------------------------------------------- Router (history API under /studio/)
export function navigate(to: string) { history.pushState(null, '', to); window.dispatchEvent(new Event('studio:nav')); window.scrollTo(0, 0); }
export function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const f = () => setP(location.pathname); window.addEventListener('popstate', f); window.addEventListener('studio:nav', f); return () => { window.removeEventListener('popstate', f); window.removeEventListener('studio:nav', f); }; }, []);
  return p;
}
export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Record<string, unknown>) {
  return <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(to); }} {...rest}>{children}</a>;
}

// ---------------------------------------------------------------- Toasts
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), bad ? 7000 : 3500);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`}>{t.text}</div>)}</div></ToastCtx.Provider>;
}

// ---------------------------------------------------------------- Modal
export function Modal({ title, onClose, children, footer, size, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm'; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${size === 'sm' ? ' modal-sm' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={wide ? { width: 'min(1400px, 100%)', height: 'calc(100vh - 40px)' } : undefined}>
        <div className="modal-h"><h2>{title}</h2><span style={{ flex: 1 }} /><button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><Icon n="x" /></button></div>
        {children}
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Status
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved', published: 'Published', archived: 'Archived',
  succeeded: 'Succeeded', failed: 'Failed', running: 'Running',
};
export const Badge = ({ s, label }: { s: string; label?: string }) => <span className={`badge b-${s}`}>{label ?? STATUS_LABEL[s] ?? s}</span>;
export const LiveBadge = () => <span className="badge b-live">Live</span>;

export const fmtDate = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const ago = (d: string | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
export const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

// ---------------------------------------------------------------- Icons (stroke, 20px grid)
const PATHS: Record<string, string> = {
  home: 'M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1V9.5Z',
  folder: 'M2.5 5.5a1 1 0 0 1 1-1h4l1.5 2h7.5a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5.5Z',
  image: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5h.01',
  check: 'M4 10.5 8 14.5 16 6',
  inbox: 'M3 11h4l1 2h4l1-2h4M4.5 4h11l1.5 7v5H3v-5l1.5-7Z',
  upload: 'M10 13V4M6 8l4-4 4 4M4 13v3h12v-3',
  globe: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM3 10h14M10 3c2 2.2 2.8 4.6 2.8 7S12 14.8 10 17c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3Z',
  log: 'M5 4h10v12H5zM8 8h4M8 11h4M8 14h2',
  users: 'M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 16c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5M13 4.5a2.5 2.5 0 0 1 0 4.5M15 11.8c1.4.6 2.3 2 2.5 4.2',
  plus: 'M10 4v12M4 10h12', x: 'M5 5l10 10M15 5 5 15', search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM17 17l-3.5-3.5',
  eye: 'M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10ZM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  send: 'M17 3 9 11M17 3l-5 14-3-6-6-3 14-5Z', save: 'M4 3h10l3 3v11H4zM7 3v4h6V3M7 17v-5h7v5',
  rocket: 'M10 13.5 6.5 10c1-4 4-7 8.5-7 0 4.5-3 7.5-7 8.5ZM6.5 10l-2.5.5L3 13l3 1M10 13.5l-.5 2.5L7 17l-1-3M12.5 7.5h.01',
  undo: 'M7 7H13a4 4 0 0 1 0 8H8M7 7l3-3M7 7l3 3', archive: 'M3 4h14v4H3zM4.5 8v8h11V8M8 11h4',
  menu: 'M3 6h14M3 10h14M3 14h14', logout: 'M12 4h4v12h-4M8 14l-4-4 4-4M4 10h9',
  chev: 'm7 5 5 5-5 5', dash: 'M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z',
  monitor: 'M3 4h14v10H3zM7 17h6M10 14v3', tablet: 'M5 3h10v14H5zM9 15h2', phone: 'M7 3h6v14H7zM9.5 15h1',
  ext: 'M11 3h6v6M17 3l-8 8M14 11v5H4V6h5', alert: 'M10 3 2 17h16L10 3ZM10 8v4M10 14.5h.01', clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 6v4l3 2',
  pin: 'M10 17s5-4.6 5-8.5a5 5 0 0 0-10 0c0 3.9 5 8.5 5 8.5ZM10 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', layers: 'M10 3 3 7l7 4 7-4-7-4ZM3 11l7 4 7-4',
  side: 'M3 4h14v12H3zM8 4v12',
  mail: 'M3 5h14v10H3zM3.5 5.5 10 10.5l6.5-5',
  partner: 'M2.5 9 6 5.5l3 1.5 2-1 2 1 4.5 3M2.5 9l4.5 5 1.5-1M17.5 10l-4.5 4.5-3-2.5M9 7l-2 2.5 1.5 1 2.5-2',
  heart: 'M10 16.5s-6-3.6-6-8a3.3 3.3 0 0 1 6-1.9 3.3 3.3 0 0 1 6 1.9c0 4.4-6 8-6 8Z',
  leaf: 'M4 16c0-7 4.5-11 12-12 0 7.5-4 12-11 12M4 16l6-6',
  lock: 'M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 6 0V9M10 12.5v1.5',
  eyeoff: 'M3 3l14 14M8.2 5a8 8 0 0 1 1.8-.2c5 0 8 5.2 8 5.2a14 14 0 0 1-2.3 2.8M12.1 12.2A2.5 2.5 0 0 1 7.8 8M5.4 6.6C3.4 8 2 10 2 10s3 5.5 8 5.5a7.6 7.6 0 0 0 3.2-.7',
};
export function Icon({ n, ...p }: { n: string } & React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d={PATHS[n] ?? ''} /></svg>;
}
