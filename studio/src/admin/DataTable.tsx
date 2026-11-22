// Shared data table for Studio lists: sortable columns, row selection with bulk actions, comfortable/compact density,
// sticky header, keyboard navigation (↑ ↓ to move, Enter to open, Space to select), results count and CSV export.
// Bulk actions are supplied by each list and must call real server actions; the table only collects the selection.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui.tsx';

export type Column<T> = {
  key: string; header: string; render: (row: T) => ReactNode;
  sort?: (row: T) => string | number;          // sortable when given
  csv?: (row: T) => string;                    // included in CSV export when given
  width?: string; align?: 'right'; hideBelow?: number;   // hide the column on narrow screens (px)
};
export type BulkAction<T> = { label: string; icon: string; danger?: boolean; applies: (row: T) => boolean; run: (rows: T[]) => Promise<void> };

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export function DataTable<T>({ id, rows, total, rowKey, columns, onOpen, actions = [], empty, initialSort, csvName }: {
  id: string; rows: T[]; total: number; rowKey: (r: T) => string; columns: Column<T>[]; onOpen?: (r: T) => void;
  actions?: BulkAction<T>[]; empty: ReactNode; initialSort?: { key: string; dir: 'asc' | 'desc' }; csvName?: string;
}) {
  const url = new URLSearchParams(location.search);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(() => {
    const s = url.get('sort'); if (!s) return initialSort ?? null;
    const [key, dir] = s.split(':'); return columns.some((c) => c.key === key && c.sort) ? { key, dir: dir === 'desc' ? 'desc' : 'asc' } : initialSort ?? null;
  });
  const [dense, setDense] = useState(() => store.get(`studio.dense.${id}`) === '1');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [focus, setFocus] = useState(-1);
  const body = useRef<HTMLTableSectionElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => { const r = () => setWidth(window.innerWidth); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  const cols = columns.filter((c) => !c.hideBelow || width >= c.hideBelow);

  // keep the sort in the address bar, so a sorted view can be shared or reloaded
  useEffect(() => {
    const u = new URL(location.href);
    if (sort && !(initialSort && sort.key === initialSort.key && sort.dir === initialSort.dir)) u.searchParams.set('sort', `${sort.key}:${sort.dir}`); else u.searchParams.delete('sort');
    history.replaceState(history.state, '', u);
  }, [sort]);

  const sorted = useMemo(() => {
    const c = sort && columns.find((x) => x.key === sort.key);
    if (!c?.sort) return rows;
    const f = c.sort; const m = sort!.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' })) * m; });
  }, [rows, sort, columns]);
  // drop selected rows that are no longer shown (filters changed)
  useEffect(() => { const keys = new Set(sorted.map(rowKey)); setSel((s) => new Set([...s].filter((k) => keys.has(k)))); }, [sorted]);

  const toggleSort = (k: string) => setSort((s) => (!s || s.key !== k ? { key: k, dir: 'asc' } : s.dir === 'asc' ? { key: k, dir: 'desc' } : null));
  const allOn = sorted.length > 0 && sorted.every((r) => sel.has(rowKey(r)));
  const someOn = !allOn && sorted.some((r) => sel.has(rowKey(r)));
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const chosen = sorted.filter((r) => sel.has(rowKey(r)));
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => { if (head.current) head.current.indeterminate = someOn; }, [someOn]);

  const key = (e: React.KeyboardEvent, i: number, r: T) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, Math.min(sorted.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); setFocus(n); body.current?.querySelectorAll<HTMLElement>('tr')[n]?.focus(); }
    if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen(r); }
    if (e.key === ' ' && actions.length) { e.preventDefault(); toggle(rowKey(r)); }
  };
  async function run(a: BulkAction<T>) {
    const target = chosen.filter(a.applies); if (!target.length) return;
    setBusy(a.label); try { await a.run(target); setSel(new Set()); } finally { setBusy(''); }
  }
  function exportCsv() {
    const cs = columns.filter((c) => c.csv);
    const cell = (v: string) => { let s = v ?? ''; if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = '﻿' + [cs.map((c) => c.header), ...(chosen.length ? chosen : sorted).map((r) => cs.map((c) => c.csv!(r)))].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `${csvName ?? id}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return <div className={`dt${dense ? ' dense' : ''}`}>
    <div className="scroll-x dt-scroll"><table className="table dt-table" aria-rowcount={sorted.length}>
      <thead><tr>
        {actions.length > 0 && <th className="dt-check"><input ref={head} type="checkbox" aria-label={allOn ? 'Clear selection' : 'Select all shown'} checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(sorted.map(rowKey)))} /></th>}
        {cols.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align }} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined}>
          {c.sort ? <button type="button" className={`dt-sort${sort?.key === c.key ? ' on' : ''}`} onClick={() => toggleSort(c.key)}>{c.header}<span className="dt-arrow" aria-hidden="true">{sort?.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button> : c.header}</th>)}
        <th className="dt-go" aria-label="Open" />
      </tr></thead>
      <tbody ref={body}>
        {sorted.length === 0 && <tr><td colSpan={cols.length + 2} className="empty">{empty}</td></tr>}
        {sorted.map((r, i) => { const k = rowKey(r); const on = sel.has(k); return <tr key={k} tabIndex={0} className={`dt-row${onOpen ? '' : ' static'}${on ? ' sel' : ''}${focus === i ? ' kb' : ''}`} aria-selected={actions.length ? on : undefined}
          onKeyDown={(e) => key(e, i, r)} onFocus={() => setFocus(i)}
          onClick={(e) => { if (!onOpen || (e.target as HTMLElement).closest('a,button,input,label,select')) return; onOpen(r); }}>
          {actions.length > 0 && <td className="dt-check"><input type="checkbox" checked={on} onChange={() => toggle(k)} aria-label="Select row" /></td>}
          {cols.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.render(r)}</td>)}
          <td className="dt-go">{onOpen && <Icon n="chev" width={15} height={15} />}</td>
        </tr>; })}
      </tbody>
    </table></div>
    <div className="dt-foot">
      <span className="muted">{sorted.length === total ? `${total} ${total === 1 ? 'item' : 'items'}` : `Showing ${sorted.length} of ${total}`}</span>
      <span className="dt-foot-r">
        {columns.some((c) => c.csv) && <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} title="Download the shown rows (or the selection) as CSV"><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export CSV</button>}
        <span className="seg dt-density" role="group" aria-label="Row spacing"><button className={!dense ? 'on' : ''} onClick={() => { setDense(false); store.set(`studio.dense.${id}`, '0'); }}>Comfortable</button><button className={dense ? 'on' : ''} onClick={() => { setDense(true); store.set(`studio.dense.${id}`, '1'); }}>Compact</button></span>
      </span>
    </div>
    <div className={`dt-bulk${chosen.length ? ' on' : ''}`} role="region" aria-label="Selection actions" aria-hidden={!chosen.length}>
      <b>{chosen.length} selected</b>
      {actions.map((a) => { const n = chosen.filter(a.applies).length; return <button key={a.label} type="button" className={`btn btn-sm${a.danger ? ' btn-danger' : ''}`} disabled={!n || !!busy} tabIndex={chosen.length ? 0 : -1} onClick={() => run(a)} title={n ? undefined : 'Does not apply to the selected items'}>
        <Icon n={a.icon} />{busy === a.label ? 'Working…' : `${a.label}${n && n !== chosen.length ? ` (${n})` : ''}`}</button>; })}
      <button type="button" className="btn btn-sm btn-ghost" tabIndex={chosen.length ? 0 : -1} onClick={() => setSel(new Set())}>Clear</button>
    </div>
  </div>;
}

/** Status filter tabs with counts. */
export function FilterTabs({ value, onChange, tabs }: { value: string; onChange: (v: string) => void; tabs: [string, string, number][] }) {
  return <div className="seg dt-tabs" role="tablist" aria-label="Filter">{tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}<em>{n}</em></button>)}</div>;
}

/** The standard workflow actions for a list: submit for review, archive (not live) and restore. Each runs the module's
 *  real transition endpoint per row; the server checks permissions and states, and failures are reported per item. */
export function workflowActions<T extends { id: string; status: string; publishedRevisionId: string | null }>(opts: {
  base: string; noun: [string, string]; name: (r: T) => string; canUpdate: boolean; reload: () => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>; toast: (m: string, bad?: boolean) => void;
}): BulkAction<T>[] {
  if (!opts.canUpdate) return [];
  const run = (action: string, done: string) => async (sel: T[]) => {
    let ok = 0; const failed: string[] = [];
    for (const r of sel) { try { await opts.post(`${opts.base}/${r.id}/transition`, { action }); ok++; } catch (e) { failed.push(`${opts.name(r)}: ${(e as Error).message}`); } }
    await opts.reload();
    if (ok) opts.toast(`${ok} ${ok === 1 ? opts.noun[0] : opts.noun[1]} ${done}`);
    if (failed.length) opts.toast(failed.slice(0, 3).join(' · '), true);
  };
  return [
    { label: 'Submit for review', icon: 'send', applies: (r) => ['draft', 'changes_requested'].includes(r.status), run: run('submit', 'sent for review') },
    { label: 'Archive', icon: 'archive', danger: true, applies: (r) => !r.publishedRevisionId && ['draft', 'changes_requested', 'approved', 'in_review'].includes(r.status),
      run: async (sel) => { if (confirm(`Archive ${sel.length} ${sel.length === 1 ? opts.noun[0] : opts.noun[1]}? They can be restored later.`)) await run('archive', 'archived')(sel); } },
    { label: 'Restore', icon: 'undo', applies: (r) => r.status === 'archived', run: run('restore', 'restored as drafts') },
  ];
}

/** Toolbar row shared by the lists: status tabs on the left, filters and search on the right. */
export function ListToolbar({ tabs, value, onChange, q, setQ, placeholder, children }: { tabs: [string, string, number][]; value: string; onChange: (v: string) => void; q: string; setQ: (v: string) => void; placeholder: string; children?: ReactNode }) {
  return <div className="card-h dt-toolbar">
    <FilterTabs value={value} onChange={onChange} tabs={tabs} />
    <div className="dt-tools">{children}
      <label className="search"><Icon n="search" /><span className="sr-only">{placeholder}</span><input className="input" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />{q && <button type="button" className="dt-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}</label>
    </div>
  </div>;
}

/** Keeps list filters in the address bar (so a view can be reloaded or shared). */
export function useUrlState(defaults: Record<string, string>) {
  const p = new URLSearchParams(location.search);
  const [state, setState] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, p.get(k) ?? d])));
  useEffect(() => {
    const u = new URL(location.href);
    for (const [k, d] of Object.entries(defaults)) { const v = state[k]?.trim(); if (v && v !== d) u.searchParams.set(k, v); else u.searchParams.delete(k); }
    history.replaceState(history.state, '', u);
  }, [state]);
  return [state, (k: string, v: string) => setState((s) => ({ ...s, [k]: v }))] as const;
}

export const EmptyState = ({ icon, text, onClear }: { icon: string; text: string; onClear?: () => void }) =>
  <div className="dt-empty"><Icon n={icon} /><b>{text}</b>{onClear && <button className="btn btn-sm" onClick={onClear}>Clear filters</button>}</div>;
