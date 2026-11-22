// Approval Queue: everything waiting for review, approval or publishing, across every kind of content.
// Actions use each item's own workflow endpoints, so the same rules apply as in its editor (no self-approval, reasons
// required when sending back, publishing checks the built site).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, post } from '../api.ts';
import { Badge, Icon, Link, ago, fmtDate, initials, useCan, useMe, useToast } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';
import '../approvals.css';

type Item = { uid: string; type: string; label: string; id: string; title: string; status: string; href: string; api: string; submittedBy: { id: string; name: string } | null; at: string; live: boolean; own: boolean; canApprove: boolean; canPublish: boolean; blocked: string | null };
type Change = { path: string; before: string | null; after: string | null };
type Diff = { kind: 'new' | 'changed' | 'same'; changes: Change[]; note?: string; submitted?: { number: number; at: string }; live?: { number: number; at: string } | null };
type Tab = 'review' | 'publish' | 'back' | 'mine' | 'all';

const ICON: Record<string, string> = { project: 'folder', story: 'log', event: 'calendar', opportunity: 'spark', partner: 'partner', page: 'layers', homepage: 'home', seo: 'search', translation: 'globe', menu: 'menu', schema: 'search' };
const hours = (at: string) => (Date.now() - Date.parse(at)) / 36e5;
const age = (at: string) => { const h = hours(at); return h >= 168 ? 'old' : h >= 48 ? 'late' : ''; };
const yn = (v: string | null) => (v === 'true' ? 'Yes' : v === 'false' ? 'No' : v);
const nice = (p: string) => p.split('.').map((x) => (/^\d+$/.test(x) ? `#${x}` : x.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase()))).join(' › ');

/** Word-level diff for short texts: removed words struck through, added words highlighted. */
function WordDiff({ a, b }: { a: string | null; b: string | null }) {
  if (a === null) return <span className="aq-add">{b}</span>;
  if (b === null) return <span className="aq-del">{a}</span>;
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  if (x.length * y.length > 250000) return <><span className="aq-del">{a}</span> <span className="aq-add">{b}</span></>;
  const L = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: string; k: 's' | 'a' | 'd' }[] = []; let i = 0, j = 0;
  while (i < x.length && j < y.length) { if (x[i] === y[j]) { out.push({ t: x[i], k: 's' }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: x[i++], k: 'd' }); else out.push({ t: y[j++], k: 'a' }); }
  while (i < x.length) out.push({ t: x[i++], k: 'd' }); while (j < y.length) out.push({ t: y[j++], k: 'a' });
  return <>{out.map((p, n) => (p.k === 's' ? <Fragment key={n}>{p.t}</Fragment> : <span key={n} className={p.k === 'a' ? 'aq-add' : 'aq-del'}>{p.t}</span>))}</>;
}

export function ApprovalsPage() {
  const toast = useToast(); const can = useCan(); const me = useMe();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [tab, setTab] = useState<Tab>('review'); const [type, setType] = useState(''); const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null); const [cursor, setCursor] = useState(0);
  const [diff, setDiff] = useState<Diff | null>(null); const [busy, setBusy] = useState('');
  const [comment, setComment] = useState(''); const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(() => api<Item[]>('/review-queue').then((r) => { setRows(r); setPicked((p) => new Set([...p].filter((u) => r.some((x) => x.uid === u && x.canPublish)))); }).catch((e) => toast(e.message, true)), []);
  useEffect(() => { load(); }, [load]);

  const count = useMemo(() => {
    const r = rows ?? [];
    return { review: r.filter((x) => x.status === 'in_review' && (x.canApprove || x.blocked)).length, publish: r.filter((x) => x.canPublish).length, back: r.filter((x) => x.status === 'changes_requested').length, mine: r.filter((x) => x.own).length, all: r.length };
  }, [rows]);
  const shown = useMemo(() => (rows ?? []).filter((x) => {
    if (tab === 'review' && !(x.status === 'in_review' && (x.canApprove || x.blocked))) return false;
    if (tab === 'publish' && !x.canPublish) return false;
    if (tab === 'back' && x.status !== 'changes_requested') return false;
    if (tab === 'mine' && !x.own) return false;
    if (type && x.type !== type) return false;
    if (q && !`${x.title} ${x.label} ${x.submittedBy?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, tab, type, q]);
  const open = (rows ?? []).find((x) => x.uid === openId) ?? null;
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, shown.length - 1))); }, [shown.length]);
  useEffect(() => {
    setDiff(null); setAsking(false); setComment('');
    if (open) api<Diff>(`/review-queue/${open.type}/${encodeURIComponent(open.id)}/diff`).then(setDiff).catch(() => setDiff({ kind: 'new', changes: [], note: 'Could not load the changes.' }));
  }, [openId]);

  async function act(it: Item, action: 'approve' | 'request_changes' | 'publish', text = '') {
    setBusy(action);
    try {
      if (action === 'publish') await post(`${it.api}/publish`); else await post(`${it.api}/transition`, { action, comment: text });
      toast(action === 'approve' ? `Approved: ${it.title}` : action === 'publish' ? `Published and verified: ${it.title}` : `Sent back to ${it.submittedBy?.name ?? 'the author'}`);
      setAsking(false); setComment(''); await load();
    } catch (e) { toast(e instanceof ApiError ? e.message : (e as Error).message, true); }
    finally { setBusy(''); }
  }
  async function publishPicked() {
    const list = (rows ?? []).filter((x) => picked.has(x.uid) && x.canPublish);
    if (!list.length || !confirm(`Publish ${list.length} approved item${list.length === 1 ? '' : 's'}? Each one rebuilds the site and is checked before it is recorded.`)) return;
    setBusy('bulk'); let ok = 0; const failed: string[] = [];
    for (const it of list) { try { await post(`${it.api}/publish`); ok++; } catch (e) { failed.push(`${it.title}: ${(e as Error).message}`); } }
    setBusy(''); setPicked(new Set()); await load();
    if (ok) toast(`${ok} item${ok === 1 ? '' : 's'} published and verified`);
    if (failed.length) toast(failed.slice(0, 2).join(' · '), true);
  }

  // keyboard: j/k move, Enter opens, a approves, r asks for changes, Esc closes
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(shown.length - 1, c + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === 'Enter' && shown[cursor]) { e.preventDefault(); setOpenId(shown[cursor].uid); }
      else if (e.key === 'Escape') setOpenId(null);
      else if (e.key === 'a' && open?.canApprove && !busy) { e.preventDefault(); act(open, 'approve'); }
      else if (e.key === 'r' && open?.canApprove) { e.preventDefault(); setAsking(true); setTimeout(() => commentRef.current?.focus(), 0); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [shown, cursor, open, busy]);
  useEffect(() => { document.querySelector(`[data-uid="${shown[cursor]?.uid}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  if (!rows) return <Loading />;
  const types = [...new Map(rows.map((x) => [x.type, x.label])).entries()];
  const TABS: [Tab, string, number, string][] = [['review', 'Needs your review', count.review, 'check'], ['publish', 'Ready to publish', count.publish, 'rocket'], ['back', 'Sent back', count.back, 'undo'], ['mine', 'My submissions', count.mine, 'send'], ['all', 'All', count.all, 'inbox']];
  const EMPTY: Record<Tab, [string, string]> = {
    review: ['Nothing waiting for your review', 'When an editor submits a story, event, project or any other change, it appears here for someone else to check.'],
    publish: ['Nothing ready to publish', 'Approved changes appear here. Publishing rebuilds the website and checks every page.'],
    back: ['Nothing sent back', 'Changes a reviewer returned to their author, with the reason, appear here.'],
    mine: ['You have nothing in review', 'What you submit for review appears here until it is published.'],
    all: ['The queue is empty', 'Everything is either a draft or already on the website.'],
  };
  const pickable = shown.filter((x) => x.canPublish);

  return <div className={`aq${open ? ' has-panel' : ''}`}>
    <div className="page-h">
      <div><h1>Approval Queue</h1><p>Everything moving through review, across all content. Someone other than the author approves; publishing rebuilds the site and checks it.</p></div>
      <button className="btn btn-ghost" onClick={() => load()}><Icon n="undo" />Refresh</button>
    </div>

    <div className="aq-tabs" role="tablist" aria-label="Queue">
      {TABS.map(([k, l, n, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={`aq-tab${tab === k ? ' on' : ''}${k === 'review' && n > 0 ? ' hot' : ''}`} onClick={() => { setTab(k); setCursor(0); }}>
        <Icon n={ic} width={16} height={16} /><span>{l}</span><b>{n}</b></button>)}
    </div>

    <div className="aq-body">
      <section className="card aq-list">
        <div className="aq-tools">
          <label className="search"><Icon n="search" /><span className="sr-only">Search</span><input className="input" placeholder="Search title or author" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <span style={{ flex: 1 }} />
          {pickable.length > 0 && <>
            <label className="check aq-all"><input type="checkbox" checked={pickable.every((x) => picked.has(x.uid))} onChange={(e) => setPicked(e.target.checked ? new Set(pickable.map((x) => x.uid)) : new Set())} /><span>Select all approved</span></label>
            <button className="btn btn-primary btn-sm" disabled={!picked.size || !!busy} onClick={publishPicked}><Icon n="rocket" />{busy === 'bulk' ? 'Publishing…' : `Publish ${picked.size || ''}`.trim()}</button>
          </>}
        </div>
        {shown.length === 0 ? <div className="aq-empty"><span className="aq-empty-i"><Icon n={TABS.find((x) => x[0] === tab)![3]} width={22} height={22} /></span><b>{EMPTY[tab][0]}</b><p>{EMPTY[tab][1]}</p>{(q || type) && <button className="btn btn-sm" onClick={() => { setQ(''); setType(''); }}>Clear filters</button>}</div>
          : <ol className="aq-rows" role="listbox" aria-label="Items">{shown.map((x, i) => <li key={x.uid} data-uid={x.uid} role="option" aria-selected={openId === x.uid} className={`aq-row${openId === x.uid ? ' open' : ''}${cursor === i ? ' cur' : ''}`} onClick={() => { setCursor(i); setOpenId(x.uid); }}>
            <span className="aq-pick" onClick={(e) => e.stopPropagation()}>{x.canPublish && <input type="checkbox" aria-label={`Select ${x.title}`} checked={picked.has(x.uid)} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(x.uid) : n.delete(x.uid); return n; })} />}</span>
            <span className="aq-type" title={x.label}><Icon n={ICON[x.type] ?? 'log'} width={16} height={16} /></span>
            <span className="aq-main"><b>{x.title}</b><small>{x.label}{x.live ? ' · live version on the website' : ' · new, not on the website yet'}</small></span>
            <span className="aq-who">{x.submittedBy ? <><span className="avatar sm">{initials(x.submittedBy.name)}</span><span>{x.own ? 'You' : x.submittedBy.name}</span></> : <span className="muted">—</span>}</span>
            <span className={`aq-age ${age(x.at)}`} title={fmtDate(x.at)}>{ago(x.at)}</span>
            <span className="aq-st"><Badge s={x.status} /></span>
          </li>)}</ol>}
        <div className="aq-keys muted"><kbd>j</kbd><kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>a</kbd> approve · <kbd>r</kbd> request changes · <kbd>Esc</kbd> close</div>
      </section>

      {open && <aside className="card aq-panel" aria-label={`Review ${open.title}`}>
        <div className="aq-p-h">
          <span className="aq-type lg"><Icon n={ICON[open.type] ?? 'log'} width={18} height={18} /></span>
          <div className="min-w-0"><span className="aq-k">{open.label}</span><h2>{open.title}</h2>
            <div className="aq-p-meta"><Badge s={open.status} />{open.submittedBy && <span>by {open.own ? 'you' : open.submittedBy.name}</span>}<span title={fmtDate(open.at)}>{ago(open.at)}</span></div></div>
          <button className="btn btn-ghost icon-btn" aria-label="Close" onClick={() => setOpenId(null)}><Icon n="x" /></button>
        </div>
        <Link to={open.href} className="btn btn-sm aq-open"><Icon n="ext" />Open in editor</Link>

        <div className="aq-diff">
          <div className="aq-diff-h"><b>What changed</b>{diff && <span className="muted">{diff.kind === 'new' ? 'New, compared with nothing on the website' : diff.kind === 'same' ? '' : `${diff.changes.length} field${diff.changes.length === 1 ? '' : 's'}${diff.live ? ` · compared with version ${diff.live.number} on the website` : ''}`}</span>}</div>
          {!diff ? <p className="muted">Loading the changes…</p>
            : diff.note && !diff.changes.length ? <p className="muted">{diff.note}</p>
            : diff.changes.length === 0 ? <p className="muted">No differences with what the website shows.</p>
            : <ul className="aq-changes">{diff.changes.slice(0, 60).map((c) => <li key={c.path}>
              <span className="aq-path">{nice(c.path)}</span>
              <div className="aq-val">{diff.kind === 'new' || c.before === null ? <span className="aq-add">{yn(c.after)}</span> : c.after === null ? <span className="aq-del">{yn(c.before)}</span> : <WordDiff a={yn(c.before)} b={yn(c.after)} />}</div>
            </li>)}{diff.changes.length > 60 && <li className="muted">…and {diff.changes.length - 60} more. Open the editor to see everything.</li>}</ul>}
        </div>

        <div className="aq-acts">
          {open.blocked && <p className="aq-blocked"><Icon n="lock" width={14} height={14} />{open.blocked}</p>}
          {open.status === 'in_review' && !open.canApprove && !open.blocked && <p className="muted" style={{ margin: 0 }}>Your role cannot approve {open.label.toLowerCase()} changes.</p>}
          {open.canApprove && !asking && <div className="aq-btns">
            <button className="btn btn-primary" disabled={!!busy} onClick={() => act(open, 'approve')}><Icon n="check" />{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            <button className="btn" disabled={!!busy} onClick={() => { setAsking(true); setTimeout(() => commentRef.current?.focus(), 0); }}>Request changes</button></div>}
          {open.canApprove && asking && <div className="aq-ask">
            <label className="field"><span>What needs to change? <em className="muted">Sent to {open.submittedBy?.name ?? 'the author'}</em></span>
              <textarea ref={commentRef} className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Be specific: which text, and what to do." /></label>
            <div className="aq-btns"><button className="btn btn-primary" disabled={!comment.trim() || !!busy} onClick={() => act(open, 'request_changes', comment)}>Send back</button><button className="btn btn-ghost" onClick={() => setAsking(false)}>Cancel</button></div>
          </div>}
          {open.canPublish && <button className="btn btn-primary" disabled={!!busy} onClick={() => { if (confirm(`Publish “${open.title}” to the website now?`)) act(open, 'publish'); }}><Icon n="rocket" />{busy === 'publish' ? 'Publishing and checking…' : 'Publish now'}</button>}
          {open.status === 'approved' && !open.canPublish && <p className="muted" style={{ margin: 0 }}>Approved. A website administrator publishes it.</p>}
          {open.status === 'changes_requested' && <p className="muted" style={{ margin: 0 }}>Sent back to {open.own ? 'you' : open.submittedBy?.name ?? 'the author'}. It returns here when it is submitted again. The reviewer’s comment is in the editor’s history.</p>}
          {!can('audit.read') ? null : <p className="aq-foot muted">Every decision is recorded in the Activity log.</p>}
        </div>
      </aside>}
    </div>
    <span hidden>{me.user.id}</span>
  </div>;
}
