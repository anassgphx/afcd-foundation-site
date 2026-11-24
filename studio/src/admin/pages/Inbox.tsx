// Inbox: messages sent through the website's contact form, and the newsletter sign-up list.
// Three panes (filters · list · reading pane) that collapse to one pane at a time on a phone. Personal data: the page
// is for forms.read; changing anything needs forms.manage. Studio sends no email: "Reply by email" opens a mail app.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../inbox.css';
import { api, del, patch, post, put } from '../api.ts';
import { Icon, Link, Modal, ago, fmtDate, initials, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column } from '../DataTable.tsx';
import { Field } from '../Editor.tsx';
import { Loading } from './Dashboard.tsx';

type Status = 'new' | 'in_progress' | 'replied' | 'closed';
type View = 'all' | 'unread' | 'mine' | 'starred' | 'spam' | 'archived' | 'newsletter';
type Counts = { total: number; unread: number };
type FormInfo = { key: 'contact' | 'newsletter'; label: string; site: string; settings: { enabled: boolean; retentionDays: number; closedRetentionMonths: number | null } };
type Summary = { views: Record<Exclude<View, 'newsletter'>, Counts>; topics: { topic: string; total: number; unread: number }[]; statuses: Record<Status, number>; subscribers: number; forms: FormInfo[] };
type Row = { id: string; topic: string; name: string; email: string; status: Status; page: string; createdAt: string; preview: string; unread: boolean; starred: boolean; spam: boolean; spamReason: string | null; archived: boolean; assignedTo: string | null; assigneeName: string | null };
type Ev = { id: string; kind: string; body: string; meta: Record<string, any> | null; at: string; actorId: string | null; actorName: string | null };
type Msg = Omit<Row, 'preview'> & { phone: string; org: string; message: string; consentAt: string | null; archivedAt: string | null; closedAt: string | null; events: Ev[] };
type Person = { id: string; name: string };
type MailInfo = { ready: boolean; fromEmail: string; fromName: string };
type MailSettings = { enabled: boolean; host: string; port: number; security: 'starttls' | 'tls' | 'none'; user: string; fromName: string; fromEmail: string; replyTo: string; hasPassword: boolean; ready: boolean; updatedAt: string | null; updatedBy: string | null; keySource: 'env' | 'data-folder' };

export const STATUSES: [Status, string][] = [['new', 'New'], ['in_progress', 'In progress'], ['replied', 'Replied'], ['closed', 'Closed']];
const SLABEL = Object.fromEntries(STATUSES) as Record<Status, string>;
const SPAM_WHY: Record<string, string> = {
  honeypot: 'It filled in the hidden anti-bot field.', too_fast: 'It was sent faster than a person can type.',
  rate_limit: 'Many messages came from the same connection within 10 minutes.', manual: 'A teammate marked it as spam.', legacy: 'It was in spam before the Inbox update.',
};
const SORTS: [string, string][] = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['unread', 'Unread first'], ['sender', 'Sender A–Z']];
const PAGE = 50;

/** Signals the sidebar badge to refresh after a change here. */
const pingBadge = () => window.dispatchEvent(new Event('studio:inbox'));

// Small glyphs the shared icon set doesn't have (stroke, 20px grid, like ui.tsx).
const G: Record<string, string> = {
  star: 'M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z',
  reply: 'M8 5 3 10l5 5M3 10h9a5 5 0 0 1 5 5v1',
  shield: 'M10 2.5 4 5v4.5c0 3.6 2.6 6.6 6 7.5 3.4-.9 6-3.9 6-7.5V5l-6-2.5ZM7.5 10l2 2 3.5-4',
  dot: 'M10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', back: 'M12 5 7 10l5 5', tag: 'M3 3h7l7 7-7 7-7-7V3ZM7 7h.01',
  user: 'M10 10a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM4 17c.6-3.2 3-5 6-5s5.4 1.8 6 5',
  note: 'M4 3h9l3 3v11H4V3ZM7 8h6M7 11h6M7 14h3', filter: 'M3 4h14l-5.5 6.5V16l-3-1.5v-4L3 4Z', gear: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
};
const Glyph = ({ n, solid, ...p }: { n: string; solid?: boolean } & Omit<React.SVGProps<SVGSVGElement>, "fill">) => (G[n]
  ? <svg viewBox="0 0 20 20" fill={solid ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d={G[n]} /></svg>
  : <Icon n={n} {...p} />);

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';
const replySubject = (m: Msg) => `Re: ${m.topic || 'Your message'} · AFCD Foundation`;
function replyBody(m: Msg, max = 800) {
  const quoted = m.message.slice(0, max).split('\n').map((l) => `> ${l}`).join('\n');
  return `Hello ${firstName(m.name)},\n\nThank you for contacting AFCD Foundation.\n\n\n\nBest regards,\nAFCD Foundation\n\n---\nOn ${fmtDate(m.createdAt)}, ${m.name} wrote:\n${quoted}`;
}
function mailto(m: Msg) {
  return `mailto:${encodeURIComponent(m.email).replace('%40', '@')}?subject=${encodeURIComponent(replySubject(m))}&body=${encodeURIComponent(replyBody(m))}`;
}

// ================================================================ Page
export function InboxPage() {
  const can = useCan(); const toast = useToast();
  const [st, set] = useUrlState({ view: 'all', topic: '', status: '', q: '', sort: 'newest', m: '' });
  const view = st.view as View;
  const [sum, setSum] = useState<Summary | null>(null);
  const [settings, setSettings] = useState(false);
  const loadSum = useCallback(() => api<Summary>('/inbox/summary').then(setSum).catch((e) => toast(e.message, true)), []);
  const [mail, setMail] = useState<MailInfo>({ ready: false, fromEmail: '', fromName: '' });
  const loadMail = useCallback(() => api<MailInfo>('/inbox/mail').then(setMail).catch(() => undefined), []);
  useEffect(() => { loadSum(); loadMail(); }, [loadSum, loadMail]);
  // new mail arrives while the page is open: refresh when the tab comes back into view
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') { loadSum(); window.dispatchEvent(new Event('studio:inbox-refresh')); } }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, [loadSum]);
  const changed = useCallback(() => { loadSum(); pingBadge(); }, [loadSum]);
  if (!sum) return <Loading />;
  const contact = sum.forms.find((f) => f.key === 'contact')!;
  const choose = (k: string, v: string) => { set(k, v); set('m', ''); };

  return <div className="ix-page">
    <div className="page-h ix-head">
      <div><h1>Inbox</h1><p>Messages and sign-ups from the website. Visible to administrators only; views and exports are logged.</p></div>
      <div className="pills">
        {can('forms.manage') && view !== 'newsletter' && <a className="btn" href={`/studio/api/inbox/export.csv?${new URLSearchParams({ view, topic: st.topic, status: st.status, q: st.q, sort: st.sort })}`} download onClick={() => setTimeout(loadSum, 800)}><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export CSV</a>}
        {can('forms.manage') && <button className="btn" onClick={() => setSettings(true)}><Glyph n="gear" />Settings</button>}
      </div>
    </div>
    {!contact.settings.enabled && <div className="notice n-warn ix-notice"><div>The contact form is paused: the website asks people to email contact@afcdteam.com instead.</div></div>}

    <div className={`ix${st.m ? ' ix-reading' : ''}${view === 'newsletter' ? ' ix-subs' : ''}`}>
      <Filters sum={sum} st={st} choose={choose} />
      {view === 'newsletter'
        ? <Subscribers onChange={changed} />
        : <Mail st={st} set={set} sum={sum} onChange={changed} mail={mail} onSetupMail={() => setSettings(true)} />}
    </div>
    {settings && <SettingsDialog forms={sum.forms} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); loadSum(); loadMail(); toast('Settings saved'); }} />}
  </div>;
}

// ================================================================ Filters pane
function Filters({ sum, st, choose }: { sum: Summary; st: Record<string, string>; choose: (k: string, v: string) => void }) {
  const item = (v: View, label: string, icon: string, c: Counts | number, unreadBadge = false) => {
    const on = st.view === v && (v === 'newsletter' || (!st.topic && !st.status));
    const n = typeof c === 'number' ? c : unreadBadge ? c.unread : c.total;
    return <button key={v} className={`ix-f${on ? ' on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => { choose('view', v); choose('topic', ''); choose('status', ''); }}>
      <Glyph n={icon} /><span>{label}</span>{n > 0 && <em className={unreadBadge ? 'ix-badge' : ''}>{n}</em>}</button>;
  };
  return <nav className="ix-filters" aria-label="Inbox folders">
    <div className="ix-fgroup">
      {item('all', 'All messages', 'inbox', sum.views.all, true)}
      {item('unread', 'Unread', 'dot', sum.views.unread.total)}
      {item('mine', 'Assigned to me', 'user', sum.views.mine, true)}
      {item('starred', 'Starred', 'star', sum.views.starred.total)}
    </div>
    <div className="ix-fgroup"><span className="ix-flabel">Type</span>
      {sum.topics.filter((t) => t.total > 0).length === 0 && <small className="muted ix-fnone">No messages yet</small>}
      {sum.topics.filter((t) => t.total > 0).map((t) => { const on = st.topic === t.topic; return <button key={t.topic} className={`ix-f${on ? ' on' : ''}`} onClick={() => { choose('view', 'all'); choose('status', ''); choose('topic', on ? '' : t.topic); }}>
        <Glyph n="tag" /><span>{t.topic}</span><em className={t.unread ? 'ix-badge' : ''}>{t.unread || t.total}</em></button>; })}
    </div>
    <div className="ix-fgroup"><span className="ix-flabel">Status</span>
      {STATUSES.map(([k, l]) => { const on = st.status === k; return <button key={k} className={`ix-f${on ? ' on' : ''}`} onClick={() => { choose('view', 'all'); choose('topic', ''); choose('status', on ? '' : k); }}>
        <span className={`ix-sdot s-${k}`} aria-hidden="true" /><span>{l}</span>{sum.statuses[k] > 0 && <em>{sum.statuses[k]}</em>}</button>; })}
    </div>
    <div className="ix-fgroup">
      {item('spam', 'Spam', 'shield', sum.views.spam)}
      {item('archived', 'Archived', 'archive', sum.views.archived)}
    </div>
    <div className="ix-fgroup"><span className="ix-flabel">Newsletter</span>
      {item('newsletter', 'Subscribers', 'mail', sum.subscribers)}
    </div>
  </nav>;
}

// ================================================================ List + reading pane
function Mail({ st, set, sum, onChange, mail, onSetupMail }: { st: Record<string, string>; set: (k: string, v: string) => void; sum: Summary; onChange: () => void; mail: MailInfo; onSetupMail: () => void }) {
  const can = useCan(); const toast = useToast();
  const [q, setQ] = useState(st.q);
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null);
  const [more, setMore] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => { if (q !== st.q) { set('q', q); set('m', ''); } }, 250); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => new URLSearchParams({ view: st.view, topic: st.topic, status: st.status, q: st.q, sort: st.sort }).toString(), [st.view, st.topic, st.status, st.q, st.sort]);
  const load = useCallback(async (keep = 0) => {
    const r = await api<{ total: number; rows: Row[] }>(`/inbox/messages?${params}&limit=${Math.max(PAGE, keep)}`);
    setData(r);
  }, [params]);
  useEffect(() => { setData(null); setSel(new Set()); load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const f = () => { load(data?.rows.length ?? 0).catch(() => undefined); }; window.addEventListener('studio:inbox-refresh', f); return () => window.removeEventListener('studio:inbox-refresh', f); }, [load, data?.rows.length]);
  useEffect(() => { api<Person[]>('/inbox/people').then(setPeople).catch(() => undefined); }, []);
  const rows = data?.rows ?? [];
  const reload = useCallback(async () => { await load(rows.length); onChange(); }, [load, rows.length, onChange]);
  const patchRow = (id: string, p: Partial<Row>) => setData((d) => d && { ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });

  async function loadMore() {
    setMore(true);
    try { const r = await api<{ total: number; rows: Row[] }>(`/inbox/messages?${params}&limit=${PAGE}&offset=${rows.length}`); setData((d) => d && { total: r.total, rows: [...d.rows, ...r.rows] }); }
    catch (e) { toast((e as Error).message, true); } finally { setMore(false); }
  }
  async function bulk(flag: string, ids: string[], done: string) {
    try { const r = await post<{ changed: number }>('/inbox/flag', { ids, flag }); setSel(new Set()); await reload(); toast(`${r.changed} ${r.changed === 1 ? 'message' : 'messages'} ${done}`); if (ids.includes(st.m) && ['archive', 'unarchive', 'spam', 'not_spam'].includes(flag)) set('m', ''); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function remove(ids: string[]) {
    try { const r = await post<{ deleted: number }>('/inbox/delete', { ids }); setConfirmDel(null); setSel(new Set()); if (ids.includes(st.m)) set('m', ''); await reload(); toast(`${r.deleted} deleted permanently`); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function star(r: Row) {
    patchRow(r.id, { starred: !r.starred });
    try { await post(`/inbox/messages/${r.id}/star`, { starred: !r.starred }); onChange(); } catch (e) { patchRow(r.id, { starred: r.starred }); toast((e as Error).message, true); }
  }
  const open = (id: string) => { set('m', id); patchRow(id, { unread: false }); };

  // keyboard: j/k or ↓/↑ move, s star, e archive, u mark unread, / search — not while typing
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,select,[contenteditable],.modal')) return;
      const i = rows.findIndex((r) => r.id === st.m);
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'j' || e.key === 'k') {
        const n = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'j' ? 1 : -1)))];
        if (n) { e.preventDefault(); open(n.id); listRef.current?.querySelector<HTMLElement>(`[data-id="${n.id}"]`)?.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      const cur = rows[i]; if (!cur) return;
      if (e.key === 's') star(cur);
      if (e.key === 'e' && can('forms.manage')) bulk(cur.archived ? 'unarchive' : 'archive', [cur.id], cur.archived ? 'moved to the inbox' : 'archived');
      if (e.key === 'u' && can('forms.manage')) { bulk('unread', [cur.id], 'marked unread'); set('m', ''); }
    };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [rows, st.m]);

  const chosen = rows.filter((r) => sel.has(r.id));
  const allOn = rows.length > 0 && chosen.length === rows.length;
  const title = st.topic || (st.status ? SLABEL[st.status as Status] : { all: 'All messages', unread: 'Unread', mine: 'Assigned to me', starred: 'Starred', spam: 'Spam', archived: 'Archived', newsletter: '' }[st.view as View]);
  const filtered = !!(st.q || st.topic || st.status);

  return <>
    <section className="ix-list" aria-label="Messages">
      <div className="ix-list-h">
        <div className="ix-list-t"><h2>{title}</h2><small className="muted">{data ? `${data.total} ${data.total === 1 ? 'message' : 'messages'}` : '…'}</small></div>
        <div className="ix-list-tools">
          <label className="search ix-search"><Icon n="search" /><span className="sr-only">Search messages</span>
            <input ref={searchRef} className="input" placeholder="Search name, email, text" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" className="dt-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}</label>
          <select className="select ix-sort" value={st.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        {can('forms.manage') && rows.length > 0 && <div className={`ix-bulk${chosen.length ? ' on' : ''}`}>
          <label className="check" title="Select all shown"><input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allOn; }} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all shown messages" /></label>
          {chosen.length ? <>
            <b>{chosen.length} selected</b>
            <button className="btn btn-sm btn-ghost" onClick={() => bulk('read', [...sel], 'marked read')}>Mark read</button>
            {st.view === 'archived' ? <button className="btn btn-sm btn-ghost" onClick={() => bulk('unarchive', [...sel], 'moved to the inbox')}>Unarchive</button>
              : st.view !== 'spam' && <button className="btn btn-sm btn-ghost" onClick={() => bulk('archive', [...sel], 'archived')}><Icon n="archive" />Archive</button>}
            {st.view === 'spam' ? <button className="btn btn-sm btn-ghost" onClick={() => bulk('not_spam', [...sel], 'moved to the inbox')}>Not spam</button>
              : <button className="btn btn-sm btn-ghost" onClick={() => bulk('spam', [...sel], 'moved to spam')}><Glyph n="shield" />Spam</button>}
            {st.view !== 'spam' && <button className="btn btn-sm btn-ghost" onClick={() => bulk('close', [...sel], 'closed')}>Close</button>}
            <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmDel([...sel])}>Delete</button>
          </> : <small className="muted">Select messages for bulk actions · <kbd>j</kbd>/<kbd>k</kbd> to move</small>}
        </div>}
      </div>
      {!data ? <div className="ix-skel">{[0, 1, 2, 3, 4].map((i) => <div key={i}><div className="skeleton" style={{ width: '40%' }} /><div className="skeleton" style={{ width: '85%' }} /></div>)}</div>
        : rows.length === 0 ? <EmptyState icon="inbox" text={filtered ? 'No messages match.' : st.view === 'spam' ? 'No spam. Suspicious messages land here instead of being lost.' : st.view === 'unread' ? 'You’re all caught up.' : 'No messages here yet.'}
          onClear={filtered ? () => { setQ(''); set('q', ''); set('topic', ''); set('status', ''); } : undefined} />
        : <ul className="ix-rows" ref={listRef}>
          {rows.map((r) => <li key={r.id} data-id={r.id} className={`ix-row${r.id === st.m ? ' on' : ''}${r.unread ? ' unread' : ''}${sel.has(r.id) ? ' sel' : ''}`}>
            {can('forms.manage') && <input type="checkbox" className="ix-check" checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-label={`Select message from ${r.name}`} />}
            <button className="ix-row-main" onClick={() => open(r.id)} aria-current={r.id === st.m ? 'true' : undefined}>
              <span className="ix-av" aria-hidden="true">{initials(r.name || r.email)}</span>
              <span className="ix-row-b">
                <span className="ix-row-top">{r.unread && <span className="ix-unread" aria-label="Unread" />}<b className="ix-name">{r.name || r.email}</b><time className="muted" dateTime={r.createdAt} title={fmtDate(r.createdAt)}>{ago(r.createdAt)}</time></span>
                <span className="ix-prev">{r.preview.split('\n')[0]}</span>
                <span className="ix-row-meta"><span className="ix-chip">{r.topic}</span>{r.status !== 'new' && <span className={`ix-st s-${r.status}`}>{SLABEL[r.status]}</span>}
                  {r.spam && <span className="ix-st s-spam">Spam</span>}{r.assigneeName && <span className="ix-who" title={`Assigned to ${r.assigneeName}`}>{initials(r.assigneeName)}</span>}</span>
              </span>
            </button>
            <button className={`ix-star${r.starred ? ' on' : ''}`} onClick={() => star(r)} aria-pressed={r.starred} aria-label={r.starred ? 'Unstar' : 'Star'} title={r.starred ? 'Unstar (s)' : 'Star (s)'}><Glyph n="star" solid={r.starred} /></button>
          </li>)}
          {data.total > rows.length && <li className="ix-more"><button className="btn btn-sm" disabled={more} onClick={loadMore}>{more ? 'Loading…' : `Load ${Math.min(PAGE, data.total - rows.length)} more`}</button></li>}
        </ul>}
    </section>
    <section className="ix-read" aria-label="Message">
      {st.m ? <Reader key={st.m} id={st.m} people={people} onBack={() => set('m', '')} onChanged={async (p) => { if (p) patchRow(st.m, p); await reload(); }} onDelete={() => setConfirmDel([st.m])} onGone={() => set('m', '')} onOpened={onChange} mail={mail} onSetupMail={onSetupMail} />
        : <div className="ix-read-empty"><Icon n="mail" /><b>{sum.views.unread.total ? `${sum.views.unread.total} unread` : 'Nothing selected'}</b><small className="muted">Choose a message to read it. Use <kbd>j</kbd> and <kbd>k</kbd> to move through the list.</small></div>}
    </section>
    {confirmDel && <Modal size="sm" title={confirmDel.length === 1 ? 'Delete this message?' : `Delete ${confirmDel.length} messages?`} onClose={() => setConfirmDel(null)}
      footer={<><button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button><button className="btn btn-primary" onClick={() => remove(confirmDel)}>Delete permanently</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>The message{confirmDel.length === 1 ? '' : 's'}, notes and history are deleted for good, for example after a request to erase personal data. This can’t be undone. Archive instead if you only want {confirmDel.length === 1 ? 'it' : 'them'} out of the way.</p></div></Modal>}
  </>;
}

// ================================================================ Reading pane
function Reader({ id, people, onBack, onChanged, onDelete, onGone, onOpened, mail, onSetupMail }: { id: string; people: Person[]; onBack: () => void; onChanged: (p?: Partial<Row>) => Promise<void>; onDelete: () => void; onGone: () => void; onOpened: () => void; mail: MailInfo; onSetupMail: () => void }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [m, setM] = useState<Msg | null>(null);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState('');
  const [nudge, setNudge] = useState(false);
  const [composing, setComposing] = useState(false);
  const [template, setTemplate] = useState('');
  // reply templates (Settings → Email templates) offered as one-click starts
  const [tpls, setTpls] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api<{ templates: { id: string; name: string }[] }>('/settings/templates').then((r) => setTpls(r.templates)).catch(() => {}); }, []);
  // r = reply (when typing nowhere)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key !== 'r' || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (mail.ready && can('forms.manage')) { e.preventDefault(); setTemplate(''); setComposing(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [mail.ready]);
  const load = useCallback(() => api<Msg>(`/inbox/messages/${id}`).then(setM), [id]);
  useEffect(() => { load().then(onOpened).catch((e) => { toast(e.message, true); onGone(); }); }, [load]);
  // on a phone the reader replaces the list: start at the top of the message
  useEffect(() => { if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo(0, 0); }, [id]);   // opening marks it read: refresh counts
  const manage = can('forms.manage');
  async function run(label: string, f: () => Promise<unknown>, msg?: string, p?: Partial<Row>) {
    setBusy(label);
    try { await f(); await load(); await onChanged(p); if (msg) toast(msg); } catch (e) { toast((e as Error).message, true); } finally { setBusy(''); }
  }
  if (!m) return <div className="ix-read-b"><div className="skeleton" style={{ width: '50%', height: 22 }} /><div className="skeleton" style={{ width: '30%' }} /><div className="skeleton" style={{ height: 120 }} /></div>;
  const setStatus = (s: Status) => run('status', () => patch(`/inbox/messages/${m.id}`, { status: s }), `Marked ${SLABEL[s].toLowerCase()}`, { status: s });
  const flag = (f: string, msg: string) => run(f, () => post('/inbox/flag', { ids: [m.id], flag: f }), msg);
  const facts: [string, ReactNode][] = [
    ['Email', <a href={`mailto:${m.email}`} className="mono">{m.email}</a>],
    ...(m.phone ? [['Phone', <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`}>{m.phone}</a>] as [string, ReactNode]] : []),
    ...(m.org ? [['Organisation', m.org] as [string, ReactNode]] : []),
    ['Received', <time dateTime={m.createdAt}>{fmtDate(m.createdAt)}</time>],
    ['Source page', <span className="mono">{m.page || 'contact.html'}</span>],
    ['Consent', m.consentAt ? `Agreed to the privacy notice · ${fmtDate(m.consentAt)}` : '—'],
  ];

  // the conversation in time order: the message, then replies, notes and status changes as they happened
  const thread = [...m.events].sort((a, b) => a.at.localeCompare(b.at));
  const canReply = manage && mail.ready && !m.spam;
  const settingsAdmin = can('settings.admin');
  const openReply = (tpl = '') => { setTemplate(tpl); setComposing(true); setNudge(false); };

  return <article className="ix-read-b ix-r2">
    <div className="ix-read-top">
      <button className="btn btn-ghost btn-sm ix-back" onClick={onBack}><Glyph n="back" />Messages</button>
      <div className="ix-read-actions" role="toolbar" aria-label="Message actions">
        {canReply && !composing && <button className="btn btn-sm btn-primary ix-top-reply" onClick={() => openReply()} title="Reply (r)"><Glyph n="reply" />Reply</button>}
        <button className={`btn btn-ghost icon-btn ix-star${m.starred ? ' on' : ''}`} aria-pressed={m.starred} title={m.starred ? 'Unstar (s)' : 'Star (s)'} aria-label={m.starred ? 'Unstar' : 'Star'}
          onClick={() => run('star', () => post(`/inbox/messages/${m.id}/star`, { starred: !m.starred }), undefined, { starred: !m.starred })}><Glyph n="star" solid={m.starred} /></button>
        {manage && <>
          <button className="btn btn-ghost icon-btn" title="Mark unread (u)" aria-label="Mark unread" onClick={() => run('unread', () => post('/inbox/flag', { ids: [m.id], flag: 'unread' }), 'Marked unread').then(onBack)}><Glyph n="dot" /></button>
          {!m.spam && <button className="btn btn-ghost icon-btn" title={m.archived ? 'Move to inbox (e)' : 'Archive (e)'} aria-label={m.archived ? 'Move to inbox' : 'Archive'} disabled={!!busy} onClick={() => flag(m.archived ? 'unarchive' : 'archive', m.archived ? 'Moved to the inbox' : 'Archived')}><Icon n={m.archived ? 'undo' : 'archive'} /></button>}
          <button className="btn btn-ghost icon-btn" title={m.spam ? 'Not spam' : 'Mark as spam'} aria-label={m.spam ? 'Not spam' : 'Mark as spam'} disabled={!!busy} onClick={() => flag(m.spam ? 'not_spam' : 'spam', m.spam ? 'Moved to the inbox' : 'Moved to spam')}><Glyph n="shield" /></button>
          <button className="btn btn-ghost icon-btn btn-danger" title="Delete permanently" aria-label="Delete permanently" onClick={onDelete}><Icon n="x" /></button>
        </>}
      </div>
    </div>

    {m.spam && <div className="notice n-warn"><div><b>In spam.</b> {SPAM_WHY[m.spamReason ?? ''] ?? ''} {manage && <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => flag('not_spam', 'Moved to the inbox')}>Not spam</button>}</div></div>}
    {m.archived && !m.spam && <div className="notice n-info"><div>Archived {m.archivedAt ? ago(m.archivedAt) : ''}. It stays searchable and is deleted with the retention rules.</div></div>}

    <header className="ix-head">
      <div className="ix-head-k"><span className="ix-chip">{m.topic || 'Message'}</span><span className={`ix-st s-${m.status}`}><span className={`ix-sdot s-${m.status}`} aria-hidden="true" />{SLABEL[m.status]}</span>{m.assigneeName && <span className="ix-chip">Assigned to {m.assignedTo === me.user.id ? 'you' : m.assigneeName}</span>}</div>
      <h2>{m.topic ? `${m.topic} · ${m.name || m.email}` : (m.name || m.email)}</h2>
    </header>

    <div className="ix-r2-grid">
      <div className="ix-conv">
        <ol className="ix-thread" aria-label="Conversation">
          <li className="ix-msg in">
            <div className="ix-msg-h"><span className="ix-av" aria-hidden="true">{initials(m.name || m.email)}</span>
              <span className="ix-msg-who"><b>{m.name || m.email}</b><small className="muted">{m.email} · via the website</small></span>
              <time className="muted" dateTime={m.createdAt} title={fmtDate(m.createdAt)}>{ago(m.createdAt)}</time></div>
            <div className="ix-msg-b">{m.message}</div>
          </li>
          {thread.map((e) => e.kind === 'email_sent' ? <li key={e.id} className="ix-msg out">
              <div className="ix-msg-h"><span className="ix-av ix-av-me" aria-hidden="true">{initials(e.actorName ?? 'AFCD')}</span>
                <span className="ix-msg-who"><b>{e.actorId === me.user.id ? 'You' : e.actorName ?? 'Former teammate'} replied</b><small className="muted">From {String(e.meta?.from ?? '')} to {String(e.meta?.to ?? '')}</small></span>
                <time className="muted" dateTime={e.at} title={fmtDate(e.at)}>{ago(e.at)}</time></div>
              <div className="ix-msg-s">{String(e.meta?.subject ?? '')}</div>
              <div className="ix-msg-b">{e.body}</div>
            </li>
            : e.kind === 'note' ? <li key={e.id} className="ix-msg note">
              <div className="ix-msg-h"><span className="ix-note-tag">Internal note</span><span className="ix-msg-who"><b>{e.actorName ?? 'Former teammate'}</b></span>
                <time className="muted" dateTime={e.at} title={fmtDate(e.at)}>{ago(e.at)}</time>
                {manage && e.actorId === me.user.id && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => run('delnote', () => del(`/inbox/messages/${m.id}/notes/${e.id}`), 'Note deleted')}>Delete</button>}</div>
              <div className="ix-msg-b">{e.body}</div>
            </li>
            : <li key={e.id} className="ix-sys"><span className="ix-ev-dot" aria-hidden="true" /><span><b>{e.actorName ?? (e.actorId ? 'Former teammate' : 'Studio')}</b> {describe(e)} <time className="muted" title={fmtDate(e.at)}>· {ago(e.at)}</time></span></li>)}
        </ol>

        {composing ? <Composer m={m} mail={mail} template={template} onCancel={() => setComposing(false)} onSent={async (marked) => { setComposing(false); await load(); await onChanged(marked && m.status !== 'closed' ? { status: 'replied' } : undefined); toast(`Reply sent to ${m.email}`); }} />
          : canReply ? <div className="ix-quick">
            <button type="button" className="ix-quick-box" onClick={() => openReply()}><span className="ix-av ix-av-me" aria-hidden="true">{initials(me.user.name)}</span><span>Reply to {firstName(m.name) || m.email}…</span><kbd>r</kbd></button>
            {tpls.length > 0 && <div className="ix-quick-t" aria-label="Start from a template"><span className="muted">Start from:</span>{tpls.slice(0, 6).map((t) => <button key={t.id} type="button" className="ix-tchip" onClick={() => openReply(t.id)}>{t.name}</button>)}</div>}
            <small className="muted">Sent from {mail.fromEmail}. The reply stays in this conversation. <a href={mailto(m)} className="ix-link" onClick={() => { post(`/inbox/messages/${m.id}/reply`).then(load).catch(() => undefined); if (m.status !== 'replied' && m.status !== 'closed') setNudge(true); }}>Use your email app instead</a></small>
          </div>
          : m.spam ? null
          : <div className="ix-setup">
            <span className="ix-setup-ic" aria-hidden="true"><Glyph n="send" /></span>
            <div className="ix-setup-t"><b>Reply from Studio</b>
              <p className="muted">{manage ? 'Email sending isn’t set up yet. Once an administrator connects the foundation’s mailbox (server, sender address and password, about two minutes), you can answer here and every reply is kept in this conversation.' : 'Only Inbox managers can reply.'}</p>
              <div className="ix-setup-a">
                {manage && (settingsAdmin ? <Link to="/studio/settings/email" className="btn btn-sm btn-primary"><Icon n="send" />Set up email sending</Link> : <span className="muted">Ask an administrator to set up email sending in Settings → Email &amp; SMTP.</span>)}
                {manage && <a className="btn btn-sm" href={mailto(m)} onClick={() => { post(`/inbox/messages/${m.id}/reply`).then(load).catch(() => undefined); if (m.status !== 'replied' && m.status !== 'closed') setNudge(true); }}><Glyph n="reply" />Reply in your email app</a>}
              </div></div>
          </div>}
        {nudge && <div className="notice n-info ix-nudge" role="status"><div>Sent your reply? <button className="btn btn-sm btn-primary" onClick={() => { setNudge(false); setStatus('replied'); }}>Mark as replied</button> <button className="btn btn-sm btn-ghost" onClick={() => setNudge(false)}>Not yet</button></div></div>}

        {manage && <form className="ix-note-form" onSubmit={(e) => { e.preventDefault(); if (note.trim()) run('note', () => post(`/inbox/messages/${m.id}/notes`, { body: note }), 'Note added').then(() => setNote('')); }}>
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={2} placeholder="Add an internal note for the team. It is never sent." aria-label="Internal note"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
          {note.trim() && <div className="ix-note-f"><small className="muted">⌘/Ctrl + Enter to add</small><button className="btn btn-sm" disabled={busy === 'note'}>{busy === 'note' ? 'Adding…' : 'Add note'}</button></div>}
        </form>}
      </div>

      <aside className="ix-side" aria-label="Details">
        <div className="ix-side-b">
          <span className="ix-side-k">Status</span>
          <div className="ix-stlist" role="group" aria-label="Status">{STATUSES.map(([k, l]) => <button key={k} type="button" className={m.status === k ? 'on' : ''} aria-pressed={m.status === k} disabled={!manage || !!busy} onClick={() => m.status !== k && setStatus(k)}><span className={`ix-sdot s-${k}`} aria-hidden="true" />{l}</button>)}</div>
        </div>
        <label className="ix-side-b"><span className="ix-side-k">Assigned to</span>
          <select className="select" aria-label="Assigned to" value={m.assignedTo ?? ''} disabled={!manage || !!busy} onChange={(e) => run('assign', () => patch(`/inbox/messages/${m.id}`, { assignedTo: e.target.value || null }), e.target.value ? 'Assigned' : 'Unassigned')}>
            <option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.id === me.user.id ? `${p.name} (me)` : p.name}</option>)}
            {m.assignedTo && !people.some((p) => p.id === m.assignedTo) && <option value={m.assignedTo}>{m.assigneeName ?? 'Former teammate'}</option>}</select></label>
        <dl className="ix-side-b ix-sfacts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </aside>
    </div>
  </article>;
}

function describe(e: Ev) {
  const m = e.meta ?? {};
  switch (e.kind) {
    case 'status': return <>changed the status{m.from ? <> from <i>{SLABEL[m.from as Status] ?? m.from}</i></> : null} to <i>{SLABEL[m.to as Status] ?? m.to}</i></>;
    case 'assign': return m.to ? <>assigned it to <i>{m.name ?? 'a teammate'}</i></> : <>removed the assignee</>;
    case 'archive': return 'archived it'; case 'unarchive': return 'moved it back to the inbox';
    case 'spam': return 'marked it as spam'; case 'not_spam': return 'marked it as not spam';
    case 'reply': return 'opened a reply in their email app';
    case 'email_sent': return 'sent a reply';
    default: return e.kind;
  }
}

// ================================================================ Reply composer (sends through the saved SMTP server)
function Composer({ m, mail, template, onCancel, onSent }: { m: Msg; mail: MailInfo; template?: string; onCancel: () => void; onSent: (markedReplied: boolean) => Promise<void> }) {
  const toast = useToast();
  const draftKey = `studio.reply.${m.id}`;
  const initial = { subject: replySubject(m), body: replyBody(m, 4000) };
  const [d, setD] = useState<{ subject: string; body: string }>(() => { try { const x = localStorage.getItem(draftKey); if (x) return JSON.parse(x); } catch { /* private mode */ } return initial; });
  const [mark, setMark] = useState(m.status !== 'closed');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = d.subject !== initial.subject || d.body !== initial.body;
  // keep an unsent draft in this browser, so a reload or a misclick doesn't lose it
  useEffect(() => { try { if (dirty) localStorage.setItem(draftKey, JSON.stringify(d)); else localStorage.removeItem(draftKey); } catch { /* private mode */ } }, [d]);
  useEffect(() => { const t = bodyRef.current; if (!t) return; t.focus(); const i = t.value.indexOf('\n\n\n'); if (i > 0) t.setSelectionRange(i + 2, i + 2); }, []);
  const clear = () => { try { localStorage.removeItem(draftKey); } catch { /* private mode */ } };
  // reply templates (Settings → Email templates), filled in on the server with this message's name and topic
  const [tpls, setTpls] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api<{ templates: { id: string; name: string }[] }>('/settings/templates').then((r) => setTpls(r.templates)).catch(() => {}); }, []);
  useEffect(() => { if (template) applyTemplate(template, true); }, [template]);
  async function applyTemplate(id: string, quiet = false) {
    if (!id || (!quiet && dirty && !confirm('Replace your text with this template?'))) return;
    try { const r = await post<{ subject: string; body: string }>(`/inbox/messages/${m.id}/template/${id}`); setD({ subject: r.subject, body: `${r.body}\n\n---\nOn ${fmtDate(m.createdAt)}, ${m.name} wrote:\n${m.message.slice(0, 4000).split('\n').map((l) => `> ${l}`).join('\n')}` }); bodyRef.current?.focus(); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function send() {
    setErr(''); setBusy(true);
    try { await post(`/inbox/messages/${m.id}/send`, { subject: d.subject, body: d.body, markReplied: mark }); clear(); await onSent(mark); }
    catch (e) { setErr((e as Error).message); toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return <form className="ix-compose" aria-label="Reply" onSubmit={(e) => { e.preventDefault(); if (!busy) send(); }}>
    <div className="ix-compose-row"><span>From</span><b>{mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail}</b></div>
    <div className="ix-compose-row"><span>To</span><b>{m.name} &lt;{m.email}&gt;</b></div>
    {tpls.length > 0 && <label className="ix-compose-row"><span>Template</span><select className="select" value="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Use a reply template"><option value="">Use a template…</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    <label className="ix-compose-row"><span>Subject</span><input className="input" value={d.subject} maxLength={200} onChange={(e) => setD({ ...d, subject: e.target.value })} required /></label>
    <textarea ref={bodyRef} className="textarea ix-compose-body" value={d.body} maxLength={20000} onChange={(e) => setD({ ...d, body: e.target.value })} aria-label="Reply text" required
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy) send(); } if (e.key === 'Escape' && !dirty) onCancel(); }} />
    {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
    <div className="ix-compose-f">
      <label className="check"><input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} /><span>Mark as replied</span></label>
      <span className="ix-compose-btns">
        <button type="button" className="btn btn-ghost" onClick={() => { if (!dirty || confirm('Discard this reply?')) { clear(); onCancel(); } }}>{dirty ? 'Discard' : 'Cancel'}</button>
        <button className="btn btn-primary" disabled={busy || !d.subject.trim() || !d.body.trim()}><Icon n="send" />{busy ? 'Sending…' : 'Send'}</button>
      </span>
    </div>
    <small className="muted">⌘/Ctrl + Enter to send. Plain text. The reply and its text are kept in this message’s history.</small>
  </form>;
}

// ================================================================ Newsletter subscribers
type Sub = { id: string; email: string; status: 'subscribed' | 'unsubscribed'; source: string; consentAt: string; unsubscribedAt: string | null; createdAt: string };
function Subscribers({ onChange }: { onChange: () => void }) {
  const can = useCan(); const toast = useToast();
  const [st, set] = useUrlState({ subs: 'subscribed', sq: '' });
  const [q, setQ] = useState(st.sq);
  const [data, setData] = useState<{ rows: Sub[]; counts: { subscribed: number; unsubscribed: number } } | null>(null);
  const [delSub, setDelSub] = useState<Sub | null>(null);
  useEffect(() => { const t = setTimeout(() => set('sq', q), 250); return () => clearTimeout(t); }, [q]);
  const load = useCallback(() => api<typeof data>(`/inbox/subscribers?${new URLSearchParams({ status: st.subs === 'all' ? '' : st.subs, q: st.sq })}`).then(setData), [st.subs, st.sq]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  async function act(s: Sub, a: 'unsubscribe' | 'delete') {
    try { await post(`/inbox/subscribers/${s.id}/${a}`); setDelSub(null); await load(); onChange(); toast(a === 'delete' ? 'Subscriber deleted' : `${s.email} unsubscribed`); } catch (e) { toast((e as Error).message, true); }
  }
  const cols: Column<Sub>[] = [
    { key: 'email', header: 'Email', render: (s) => <span className="mono">{s.email}</span>, sort: (s) => s.email },
    { key: 'status', header: 'Status', render: (s) => <span className={`ix-st ${s.status === 'subscribed' ? 's-replied' : 's-closed'}`}>{s.status === 'subscribed' ? 'Subscribed' : `Unsubscribed${s.unsubscribedAt ? ` · ${ago(s.unsubscribedAt)}` : ''}`}</span>, sort: (s) => s.status },
    { key: 'date', header: 'Signed up', render: (s) => <span className="sub" title={fmtDate(s.consentAt)}>{fmtDate(s.consentAt)}</span>, sort: (s) => s.consentAt, hideBelow: 640 },
    { key: 'src', header: 'From page', render: (s) => <span className="sub mono">{s.source || '—'}</span>, sort: (s) => s.source, hideBelow: 860 },
    ...(can('forms.manage') ? [{ key: 'act', header: '', align: 'right' as const, render: (s: Sub) => <span className="ix-sub-act">{s.status === 'subscribed' && <button className="btn btn-ghost btn-sm" onClick={() => act(s, 'unsubscribe')}>Unsubscribe</button>}<button className="btn btn-ghost btn-sm btn-danger" onClick={() => setDelSub(s)}>Delete</button></span> }] : []),
  ];
  return <section className="ix-subs-b card">
    <div className="ix-subs-h">
      <div><h2>Newsletter subscribers</h2><p className="muted">No mailing service is connected: export the subscribed addresses as CSV for your mailing tool. Unsubscribed people are never exported.</p></div>
      {can('forms.manage') && <a className="btn" href="/studio/api/inbox/subscribers/export.csv" download><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export subscribed</a>}
    </div>
    <ListToolbar tabs={[['subscribed', 'Subscribed', data?.counts.subscribed ?? 0], ['unsubscribed', 'Unsubscribed', data?.counts.unsubscribed ?? 0], ['all', 'All', (data?.counts.subscribed ?? 0) + (data?.counts.unsubscribed ?? 0)]]}
      value={st.subs} onChange={(v) => set('subs', v)} q={q} setQ={setQ} placeholder="Search email" />
    {!data ? <Loading /> : <DataTable id="inbox-subs" rows={data.rows} total={data.rows.length} rowKey={(s) => s.id} columns={cols} initialSort={{ key: 'date', dir: 'desc' }}
      empty={<EmptyState icon="mail" text={st.sq ? 'No subscriber matches.' : 'No subscribers here yet.'} onClear={st.sq ? () => setQ('') : undefined} />}
      actions={can('forms.manage') ? [{ label: 'Unsubscribe', icon: 'x', applies: (s) => s.status === 'subscribed', run: async (sel) => { for (const s of sel.filter((x) => x.status === 'subscribed')) await post(`/inbox/subscribers/${s.id}/unsubscribe`); await load(); onChange(); toast(`${sel.length} unsubscribed`); } }] : []} />}
    {delSub && <Modal size="sm" title="Delete this subscriber?" onClose={() => setDelSub(null)} footer={<><button className="btn" onClick={() => setDelSub(null)}>Cancel</button><button className="btn btn-primary" onClick={() => act(delSub, 'delete')}>Delete permanently</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}><span className="mono">{delSub.email}</span> is removed for good, for example after a request to erase their data. To stop emails but keep the record, unsubscribe instead.</p></div></Modal>}
  </section>;
}

// ================================================================ Settings
function SettingsDialog({ forms, onClose, onSaved }: { forms: FormInfo[]; onClose: () => void; onSaved: () => void }) {
  const me = useMe(); const toast = useToast();
  const [v, setV] = useState(() => Object.fromEntries(forms.map((f) => [f.key, { ...f.settings }])) as Record<string, FormInfo['settings']>);
  const [mail, setMail] = useState<MailSettings | null>(null); const [pw, setPw] = useState<string | undefined>(undefined);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(''); const [tested, setTested] = useState('');
  useEffect(() => { api<MailSettings>('/inbox/mail/settings').then(setMail).catch((e) => setErr(e.message)); }, []);
  const up = (k: string, p: Partial<FormInfo['settings']>) => setV((x) => ({ ...x, [k]: { ...x[k], ...p } }));
  const um = (p: Partial<MailSettings>) => setMail((x) => x && { ...x, ...p });
  const mailBody = () => mail && { enabled: mail.enabled, host: mail.host, port: mail.port, security: mail.security, user: mail.user, fromName: mail.fromName, fromEmail: mail.fromEmail, replyTo: mail.replyTo, ...(pw !== undefined ? { password: pw } : {}) };
  async function saveMail() { if (!mail) return; const r = await put<MailSettings>('/inbox/mail/settings', mailBody()); setMail(r); setPw(undefined); }
  async function save() {
    setErr(''); setBusy('save');
    try {
      for (const f of forms) await put(`/inbox/settings/${f.key}`, { enabled: v[f.key].enabled, retentionDays: v[f.key].retentionDays, ...(f.key === 'contact' ? { closedRetentionMonths: v[f.key].closedRetentionMonths } : {}) });
      await saveMail(); onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  }
  async function test() {
    setErr(''); setTested(''); setBusy('test');
    try { await saveMail(); const r = await post<{ to: string }>('/inbox/mail/test', {}); setTested(`Test email sent to ${r.to}. Check that inbox (and its spam folder).`); toast('Test email sent'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  }
  const PORTS = { starttls: 587, tls: 465, none: 25 } as const;
  const c = v.contact;
  return <Modal title="Inbox settings" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button></>}>
    <div className="modal-b stack ix-settings">
      <fieldset className="ix-smtp"><legend>Email sending (SMTP) {mail && <span className={`ix-st ${mail.ready ? 's-replied' : 's-closed'}`}>{mail.ready ? 'On' : 'Off'}</span>}</legend>
        {!mail ? <div className="skeleton" style={{ height: 120 }} /> : <>
          <p className="muted" style={{ margin: 0 }}>Lets your team answer website messages from the Inbox. Use the SMTP details from your email provider (for example Google Workspace, Microsoft 365 or your host). Replies are plain text.</p>
          <label className="check"><input type="checkbox" checked={mail.enabled} onChange={(e) => um({ enabled: e.target.checked })} /><span><b>Send replies from Studio</b></span></label>
          <div className="ix-grid">
            <Field label="SMTP server"><input className="input" aria-label="SMTP server" value={mail.host} placeholder="smtp.example.org" autoComplete="off" spellCheck={false} onChange={(e) => um({ host: e.target.value.trim() })} /></Field>
            <Field label="Security"><select className="select" aria-label="Security" value={mail.security} onChange={(e) => { const s = e.target.value as MailSettings['security']; um({ security: s, port: Object.values(PORTS).includes(mail.port as 25) ? PORTS[s] : mail.port }); }}>
              <option value="starttls">STARTTLS (usually port 587)</option><option value="tls">SSL/TLS (usually port 465)</option><option value="none">None (local relay only)</option></select></Field>
            <Field label="Port"><input className="input" aria-label="Port" type="number" min={1} max={65535} value={mail.port} onChange={(e) => um({ port: Number(e.target.value) })} /></Field>
            <Field label="Username" hint="Often the full email address."><input className="input" aria-label="Username" value={mail.user} autoComplete="off" spellCheck={false} onChange={(e) => um({ user: e.target.value })} /></Field>
            <Field label="Password" hint={mail.hasPassword && pw === undefined ? <>A password is saved (encrypted). <button type="button" className="ix-link" onClick={() => setPw('')}>Remove it</button></> : 'For Google or Microsoft accounts, use an app password.'}>
              <input className="input" aria-label="SMTP password" type="password" autoComplete="new-password" value={pw ?? ''} placeholder={mail.hasPassword ? '•••••••• (unchanged)' : ''} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Sender name"><input className="input" aria-label="Sender name" value={mail.fromName} maxLength={100} onChange={(e) => um({ fromName: e.target.value })} /></Field>
            <Field label="Sender email" hint="Must be an address your SMTP account may send from."><input className="input" aria-label="Sender email" type="email" value={mail.fromEmail} placeholder="contact@afcdteam.com" onChange={(e) => um({ fromEmail: e.target.value.trim() })} /></Field>
            <Field label="Reply-to (optional)" hint="Where answers to your replies go, if not the sender email."><input className="input" aria-label="Reply-to (optional)" type="email" value={mail.replyTo} onChange={(e) => um({ replyTo: e.target.value.trim() })} /></Field>
          </div>
          {mail.security === 'none' && mail.host && !/^(localhost|127\.0\.0\.1)$/.test(mail.host) && <div className="notice n-warn"><div>Without encryption the password and messages cross the network in clear text. Use STARTTLS or SSL/TLS for any external server.</div></div>}
          <div className="ix-smtp-f">
            <button type="button" className="btn" disabled={!!busy || !mail.enabled} onClick={test} title={mail.enabled ? `Saves these settings and sends a test to ${me.user.email}` : 'Switch sending on first'}>{busy === 'test' ? 'Sending…' : 'Save and send a test email'}</button>
            <small className="muted">{mail.updatedAt ? `Last changed ${ago(mail.updatedAt)}${mail.updatedBy ? ` by ${mail.updatedBy}` : ''}.` : 'Not set up yet.'}{mail.keySource === 'data-folder' ? ' The password is encrypted with a key in Studio’s data folder.' : ''}</small>
          </div>
          {tested && <div className="notice n-info" role="status"><div>{tested}</div></div>}
        </>}
      </fieldset>
      {forms.map((f) => <fieldset key={f.key}><legend>{f.label} <small className="muted">· {f.site}</small></legend>
        <label className="check"><input type="checkbox" checked={v[f.key].enabled} onChange={(e) => up(f.key, { enabled: e.target.checked })} /><span><b>Accept new submissions</b><br /><small className="muted">When paused, the website asks people to email contact@afcdteam.com instead.</small></span></label>
        <Field label="Delete every submission after (days)" hint={f.key === 'contact' ? 'Spam is deleted after 30 days.' : 'The subscriber list itself is kept until people unsubscribe or are deleted.'}>
          <input className="input" aria-label="Delete every submission after (days)" type="number" min={30} max={1825} value={v[f.key].retentionDays} onChange={(e) => up(f.key, { retentionDays: Number(e.target.value) })} /></Field>
      </fieldset>)}
      {c && <fieldset><legend>Closed messages</legend>
        <label className="check"><input type="checkbox" checked={c.closedRetentionMonths != null} onChange={(e) => up('contact', { closedRetentionMonths: e.target.checked ? 6 : null })} /><span><b>Delete closed messages sooner</b><br /><small className="muted">Personal data is kept only as long as needed. Notes, replies and history are deleted with the message.</small></span></label>
        {c.closedRetentionMonths != null && <Field label="Months after closing"><input className="input" aria-label="Months after closing" type="number" min={1} max={60} value={c.closedRetentionMonths} onChange={(e) => up('contact', { closedRetentionMonths: Number(e.target.value) })} /></Field>}
      </fieldset>}
      <div className="notice n-info"><div>The website sends forms here only when it is built with <span className="mono">FORMS_ENDPOINT</span> set to this Studio’s address. Retention runs every 15 minutes while Studio is running.</div></div>
      {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
    </div>
  </Modal>;
}
