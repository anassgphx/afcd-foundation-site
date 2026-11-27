// Shared data table for Studio lists: sortable columns, filters inside the column headers, row selection with a bulk
// bar that takes the header's place, an actions column (⋯ menu, right-click, inline quick actions on hover),
// comfortable/compact density, sticky header, keyboard navigation (↑ ↓ to move, Enter to open, Space to select,
// Shift+F10 for the row menu), results count and CSV export. Lists declare which columns filter and which actions
// they support; every action calls a real, permission-checked server route.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { del, post } from './api.ts';
import { Icon, Modal, STATUS_LABEL, navigate, useToast } from './ui.tsx';
import './list-tools.css';

/** A column filter: a checkbox list of values, or a date range. Values live in the address bar. */
export type ColFilter<T> =
  | { type: 'set'; title?: string; get: (row: T) => string | string[]; options?: { value: string; label: string; colour?: string }[]; label?: (v: string) => string; colour?: (v: string) => string | undefined }
  | { type: 'date'; title?: string; get: (row: T) => string | null | undefined };
export type Column<T> = {
  key: string; header: string; render: (row: T) => ReactNode;
  sort?: (row: T) => string | number;          // sortable when given
  csv?: (row: T) => string;                    // included in CSV export when given
  filter?: ColFilter<T>;                       // filter icon in the header when given
  width?: string; align?: 'right'; hideBelow?: number;   // hide the column on narrow screens (px)
};
/** A bulk action. `why` explains, per selected row it doesn't apply to, why that row is skipped (shown as a tooltip). */
export type BulkAction<T> = { label: string; icon: string; danger?: boolean; applies: (row: T) => boolean; why?: (row: T) => string; run: (rows: T[]) => Promise<void> };
/** One entry of a row's ⋯ / right-click menu. `quick` ones also show inline when the row is hovered. */
export type RowAction = { label: string; icon: string; run: () => void; danger?: boolean; hint?: string; sep?: boolean; quick?: boolean };
type Sort = { key: string; dir: 'asc' | 'desc' };

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

// ---------------------------------------------------------------- column filters
/** Filter values: a set is values joined by "|", a date range is "from~to" (either side may be empty). */
export const setValues = (v: string | undefined) => (v ? v.split('|').filter(Boolean) : []);
const asList = (x: string | string[]) => (Array.isArray(x) ? x : [x]).map((s) => (s ?? '').trim()).filter(Boolean);
export function applyColFilters<T>(rows: T[], columns: Column<T>[], values: Record<string, string>): T[] {
  const active = columns.filter((c) => c.filter && values[c.key]);
  if (!active.length) return rows;
  return rows.filter((r) => active.every((c) => {
    const f = c.filter!; const v = values[c.key];
    if (f.type === 'set') { const want = setValues(v); return !want.length || asList(f.get(r)).some((x) => want.includes(x)); }
    const [a, b] = v.split('~'); const d = (f.get(r) ?? '').slice(0, 10);
    if (!a && !b) return true; if (!d) return false;
    return (!a || d >= a) && (!b || d <= b);
  }));
}
const filterCount = (f: ColFilter<unknown>, v: string | undefined) => (!v ? 0 : f.type === 'set' ? setValues(v).length : v.replace('~', '') ? 1 : 0);

export function DataTable<T>({ id, rows, total, rowKey, columns, onOpen, actions = [], empty, initialSort, csvName, rowMenu, sorters = {}, sort: sortProp, onSort, filters: filtersProp, onFilter, filterRows }: {
  id: string; rows: T[]; total: number; rowKey: (r: T) => string; columns: Column<T>[]; onOpen?: (r: T) => void;
  actions?: BulkAction<T>[]; empty: ReactNode; initialSort?: Sort; csvName?: string;
  rowMenu?: (r: T) => RowAction[];                                  // actions column: ⋯ button, right-click, quick actions
  sorters?: Record<string, (r: T) => string | number>;              // extra sort keys that have no column (e.g. listing order)
  sort?: Sort | null; onSort?: (s: Sort | null) => void;            // controlled sort, when the list has its own sort menu
  filters?: Record<string, string>; onFilter?: (key: string, value: string) => void;   // controlled column filters
  filterRows?: T[];                                                 // rows the filter popovers count from (default: rows)
}) {
  const url = new URLSearchParams(location.search);
  const sortOf = (k: string) => columns.find((c) => c.key === k)?.sort ?? sorters[k];
  const [ownSort, setOwnSort] = useState<Sort | null>(() => {
    const s = url.get('sort'); if (!s) return initialSort ?? null;
    const [key, dir] = s.split(':'); return sortOf(key) ? { key, dir: dir === 'desc' ? 'desc' : 'asc' } : initialSort ?? null;
  });
  const controlled = onSort !== undefined;
  const sort = controlled ? sortProp ?? null : ownSort;
  const setSort = (s: Sort | null) => (controlled ? onSort!(s) : setOwnSort(s));
  // column filters: the list's own state when given, otherwise kept here (in the address bar as f.<column>)
  const [ownFilters, setOwnFilters] = useState<Record<string, string>>(() => Object.fromEntries(columns.filter((c) => c.filter && url.get(`f.${c.key}`)).map((c) => [c.key, url.get(`f.${c.key}`)!])));
  const filters = onFilter ? filtersProp ?? {} : ownFilters;
  const setFilter = (k: string, v: string) => (onFilter ? onFilter(k, v) : setOwnFilters((s) => ({ ...s, [k]: v })));
  const [fpop, setFpop] = useState<{ key: string; x: number; y: number; from: HTMLElement } | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number; items: RowAction[]; from: HTMLElement | null } | null>(null);
  const [dense, setDense] = useState(() => store.get(`studio.dense.${id}`) === '1');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [focus, setFocus] = useState(-1);
  const body = useRef<HTMLTableSectionElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => { const r = () => setWidth(window.innerWidth); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  const cols = columns.filter((c) => !c.hideBelow || width >= c.hideBelow);

  // keep the sort and the column filters in the address bar, so a view can be shared or reloaded
  useEffect(() => {
    const u = new URL(location.href);
    if (!controlled) { if (sort && !(initialSort && sort.key === initialSort.key && sort.dir === initialSort.dir)) u.searchParams.set('sort', `${sort.key}:${sort.dir}`); else u.searchParams.delete('sort'); }
    if (!onFilter) for (const c of columns) if (c.filter) { const v = ownFilters[c.key]; if (v && v.replace('~', '')) u.searchParams.set(`f.${c.key}`, v); else u.searchParams.delete(`f.${c.key}`); }
    history.replaceState(history.state, '', u);
  }, [sort?.key, sort?.dir, ownFilters]);

  const filtered = useMemo(() => applyColFilters(rows, columns, filters), [rows, columns, filters]);
  const sorted = useMemo(() => {
    const f = sort && sortOf(sort.key);
    if (!f) return filtered;
    const m = sort!.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' })) * m; });
  }, [filtered, sort?.key, sort?.dir, columns]);
  // drop selected rows that are no longer shown (filters changed)
  useEffect(() => { const keys = new Set(sorted.map(rowKey)); setSel((s) => { const n = new Set([...s].filter((k) => keys.has(k))); return n.size === s.size ? s : n; }); }, [sorted]);

  const toggleSort = (k: string) => setSort(!sort || sort.key !== k ? { key: k, dir: 'asc' } : sort.dir === 'asc' ? { key: k, dir: 'desc' } : null);
  const openMenu = (r: T, x: number, y: number, from: HTMLElement | null) => { const items = rowMenu?.(r) ?? []; if (items.length) setMenu({ key: rowKey(r), x, y, items, from }); };
  const allOn = sorted.length > 0 && sorted.every((r) => sel.has(rowKey(r)));
  const someOn = !allOn && sorted.some((r) => sel.has(rowKey(r)));
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const chosen = sorted.filter((r) => sel.has(rowKey(r)));
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => { if (head.current) head.current.indeterminate = someOn; }, [someOn, chosen.length]);
  const hasFilters = columns.some((c) => c.filter && filterCount(c.filter as ColFilter<unknown>, filters[c.key]));

  const key = (e: React.KeyboardEvent, i: number, r: T) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, Math.min(sorted.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); setFocus(n); body.current?.querySelectorAll<HTMLElement>('tr')[n]?.focus(); }
    if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen(r); }
    if (e.key === ' ' && actions.length) { e.preventDefault(); toggle(rowKey(r)); }
    if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && rowMenu) { e.preventDefault(); const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(r, b.right - 250, b.bottom, e.currentTarget as HTMLElement); }
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
  // bulk actions that apply to at least one selected row; the tooltip says which rows are skipped and why
  const bulk = actions.map((a) => {
    const n = chosen.filter(a.applies).length;
    const skipped = chosen.filter((r) => !a.applies(r));
    const reasons = [...new Set(skipped.map((r) => a.why?.(r)).filter(Boolean))];
    const tip = skipped.length ? `Skips ${skipped.length} of ${chosen.length}${reasons.length ? `: ${reasons.join(' · ')}` : ''}` : undefined;
    return { a, n, tip };
  }).filter((b) => b.n > 0);
  const canCsv = columns.some((c) => c.csv);
  const actsCol = !!rowMenu;

  return <div className={`dt${dense ? ' dense' : ''}${chosen.length ? ' selecting' : ''}`}>
    <div className="scroll-x dt-scroll"><table className="table dt-table" aria-rowcount={sorted.length}>
      <thead>{chosen.length > 0 ? <tr className="dt-bulkrow">
        <th className="dt-check"><input ref={head} type="checkbox" aria-label={allOn ? 'Clear selection' : 'Select all shown'} checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(sorted.map(rowKey)))} /></th>
        <th colSpan={cols.length + 1}><div className="dt-bulkh" role="region" aria-label="Selection actions">
          <b>{chosen.length} selected</b>
          {bulk.map(({ a, n, tip }) => <button key={a.label} type="button" className={`btn btn-sm${a.danger ? ' btn-danger' : ''}`} disabled={!!busy} onClick={() => run(a)} title={tip}>
            <Icon n={a.icon} />{busy === a.label ? 'Working…' : `${a.label}${n !== chosen.length ? ` (${n})` : ''}`}</button>)}
          {!bulk.length && actions.length > 0 && <span className="dt-bulk-none">No action applies to all of these. Select fewer, or similar items.</span>}
          <span className="dt-bulk-r">
            {canCsv && <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv}><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export CSV</button>}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Clear selection</button>
          </span>
        </div></th>
      </tr> : <tr>
        {actions.length > 0 && <th className="dt-check"><input ref={head} type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(sorted.map(rowKey)))} /></th>}
        {cols.map((c) => { const n = c.filter ? filterCount(c.filter as ColFilter<unknown>, filters[c.key]) : 0; return <th key={c.key} style={{ width: c.width, textAlign: c.align }} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined}>
          <span className={`dt-th${c.align === 'right' ? ' r' : ''}`}>
            {c.sort ? <button type="button" className={`dt-sort${sort?.key === c.key ? ' on' : ''}`} onClick={() => toggleSort(c.key)}>{c.header}<span className="dt-arrow" aria-hidden="true">{sort?.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button> : c.header}
            {c.filter && <button type="button" className={`dt-fbtn${n ? ' on' : ''}${fpop?.key === c.key ? ' open' : ''}`} aria-haspopup="dialog" aria-expanded={fpop?.key === c.key}
              aria-label={`Filter by ${(c.filter.title ?? c.header).toLowerCase()}${n ? ` (${n} active)` : ''}`}
              onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); setFpop(fpop?.key === c.key ? null : { key: c.key, x: b.left - 8, y: b.bottom + 6, from: e.currentTarget }); }}>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8-1.4V8.4Z" /></svg>{n > 0 && <em>{n}</em>}</button>}
          </span></th>; })}
        <th className={actsCol ? 'dt-acts' : 'dt-go'}>{actsCol ? <span className="sr-only">Actions</span> : null}</th>
      </tr>}</thead>
      <tbody ref={body}>
        {sorted.length === 0 && <tr><td colSpan={cols.length + 2} className="empty">{hasFilters && rows.length ? <div className="dt-empty"><Icon n="search" /><b>No rows match the column filters</b>
          <span className="dt-empty-a"><button className="btn btn-sm" onClick={() => columns.forEach((c) => c.filter && filters[c.key] && setFilter(c.key, ''))}>Clear column filters</button></span></div> : empty}</td></tr>}
        {sorted.map((r, i) => { const k = rowKey(r); const on = sel.has(k); const quick = rowMenu ? rowMenu(r).filter((a) => a.quick).slice(0, 2) : [];
          return <tr key={k} tabIndex={0} className={`dt-row${onOpen ? '' : ' static'}${on ? ' sel' : ''}${focus === i ? ' kb' : ''}${menu?.key === k ? ' menu' : ''}`} aria-selected={actions.length ? on : undefined}
          onKeyDown={(e) => key(e, i, r)} onFocus={() => setFocus(i)}
          onClick={(e) => { if (!onOpen || (e.target as HTMLElement).closest('a,button,input,label,select')) return; onOpen(r); }}
          onContextMenu={rowMenu ? (e) => { if ((e.target as HTMLElement).closest('a,input')) return; e.preventDefault(); openMenu(r, e.clientX, e.clientY, e.currentTarget); } : undefined}>
          {actions.length > 0 && <td className="dt-check"><input type="checkbox" checked={on} onChange={() => toggle(k)} aria-label="Select row" /></td>}
          {cols.map((c, ci) => <td key={c.key} style={{ textAlign: c.align }} className={ci === 0 ? 'dt-c0' : undefined} data-label={ci === 0 ? undefined : c.header}>{c.render(r)}</td>)}
          {actsCol ? <td className="dt-acts"><span className="dt-acts-in">
            {quick.map((a) => <button key={a.label} type="button" className="dt-quick" title={a.label} aria-label={a.label} onClick={a.run}><Icon n={a.icon} width={15} height={15} /></button>)}
            <button type="button" className={`dt-dots${menu?.key === k ? ' on' : ''}`} aria-label="Actions" aria-haspopup="menu" aria-expanded={menu?.key === k} title="Actions (or right-click the row)"
              onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); menu?.key === k ? setMenu(null) : openMenu(r, b.right - 250, b.bottom + 4, e.currentTarget); }}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15.5" cy="10" r="1.5" /></svg></button>
          </span></td> : <td className="dt-go">{onOpen && <Icon n="chev" width={15} height={15} />}</td>}
        </tr>; })}
      </tbody>
    </table></div>
    <div className="dt-foot">
      <span className="muted">{sorted.length === total ? `${total} ${total === 1 ? 'item' : 'items'}` : `Showing ${sorted.length} of ${total}`}</span>
      <span className="dt-foot-r">
        {canCsv && <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} title="Download the shown rows (or the selection) as CSV"><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export CSV</button>}
        <span className="seg dt-density" role="group" aria-label="Row spacing"><button className={!dense ? 'on' : ''} onClick={() => { setDense(false); store.set(`studio.dense.${id}`, '0'); }}>Comfortable</button><button className={dense ? 'on' : ''} onClick={() => { setDense(true); store.set(`studio.dense.${id}`, '1'); }}>Compact</button></span>
      </span>
    </div>
    {menu && <RowMenu {...menu} onClose={(back) => { if (back) menu.from?.focus(); setMenu(null); }} />}
    {fpop && (() => { const c = columns.find((x) => x.key === fpop.key)!; return <FilterPop col={c} rows={filterRows ?? rows} value={filters[c.key] ?? ''} x={fpop.x} y={fpop.y}
      onChange={(v) => setFilter(c.key, v)} onClose={(back) => { if (back) fpop.from.focus(); setFpop(null); }} />; })()}
  </div>;
}

/** Keeps a fixed popover on screen and closes it on outside click, resize or scroll. */
function usePopover(ref: React.RefObject<HTMLDivElement | null>, x: number, y: number, onClose: (back: boolean) => void, focusSel: string) {
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  useEffect(() => {
    const el = ref.current!; const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, innerWidth - w - 8)), top: y + h > innerHeight - 8 ? Math.max(8, y - h - 8) : y, ready: true });
    el.querySelector<HTMLElement>(focusSel)?.focus();
    const away = (e: Event) => { if (!el.contains(e.target as Node)) onClose(false); };
    const off = (e: Event) => { if (e.type === 'scroll' && el.contains(e.target as Node)) return; onClose(false); };
    document.addEventListener('mousedown', away, true); document.addEventListener('contextmenu', away, true); addEventListener('resize', off); addEventListener('scroll', off, true);
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('contextmenu', away, true); removeEventListener('resize', off); removeEventListener('scroll', off, true); };
  }, [x, y]);
  return { left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' as const : 'hidden' as const };
}

/** The row actions popover: arrow keys / Home / End, Escape returns focus to where it was opened. */
function RowMenu({ x, y, items, onClose }: { x: number; y: number; items: RowAction[]; onClose: (back: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePopover(ref, x, y, onClose, '[role=menuitem]');
  const keys = (e: React.KeyboardEvent) => {
    const all = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]')]; const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); all[(n + all.length) % all.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(true); }
  };
  return <div ref={ref} className="dt-menu" role="menu" style={style} onKeyDown={keys}>
    {items.map((a) => <div key={a.label} role="none">{a.sep && <hr role="separator" />}
      <button type="button" role="menuitem" tabIndex={-1} className={a.danger ? 'danger' : ''} onClick={() => { onClose(false); a.run(); }}>
        <Icon n={a.icon} width={15} height={15} /><span>{a.label}{a.hint && <small>{a.hint}</small>}</span></button></div>)}
  </div>;
}

/** The column filter popover: a checkbox list (with counts, and a search when long) or a date range with presets. */
function FilterPop<T>({ col, rows, value, x, y, onChange, onClose }: { col: Column<T>; rows: T[]; value: string; x: number; y: number; onChange: (v: string) => void; onClose: (back: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null); const f = col.filter!;
  const style = usePopover(ref, x, y, onClose, 'input');
  const [q, setQ] = useState('');
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(true); } };
  const title = f.title ?? col.header;
  if (f.type === 'date') {
    const [a = '', b = ''] = value.split('~');
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const back = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return iso(d); };
    const presets: [string, string][] = [['Last 7 days', `${back(7)}~`], ['Last 30 days', `${back(30)}~`], ['Last 90 days', `${back(90)}~`], ['This year', `${new Date().getFullYear()}-01-01~`]];
    return <div ref={ref} className="dt-fpop" role="dialog" aria-label={`Filter by ${title}`} style={style} onKeyDown={keys}>
      <div className="dt-fpop-h"><b>{title}</b>{value.replace('~', '') && <button type="button" onClick={() => onChange('')}>Clear</button>}</div>
      <div className="dt-fpop-range"><label><span>From</span><input className="input" type="date" value={a} max={b || undefined} onChange={(e) => onChange(`${e.target.value}~${b}`)} /></label>
        <label><span>To</span><input className="input" type="date" value={b} min={a || undefined} onChange={(e) => onChange(`${a}~${e.target.value}`)} /></label></div>
      <div className="dt-fpop-presets">{presets.map(([l, v]) => <button key={l} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(value === v ? '' : v)}>{l}</button>)}</div>
    </div>;
  }
  const picked = setValues(value);
  const counts = new Map<string, number>(); rows.forEach((r) => asList(f.get(r)).forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1)));
  const opts = f.options ?? [...counts.keys()].sort((m, n) => (f.label?.(m) ?? m).localeCompare(f.label?.(n) ?? n)).map((v) => ({ value: v, label: f.label?.(v) ?? v, colour: f.colour?.(v) }));
  const list = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const flip = (v: string) => onChange((picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]).join('|'));
  return <div ref={ref} className="dt-fpop" role="dialog" aria-label={`Filter by ${title}`} style={style} onKeyDown={keys}>
    <div className="dt-fpop-h"><b>{title}</b>{picked.length > 0 && <button type="button" onClick={() => onChange('')}>Clear</button>}</div>
    {opts.length > 8 && <input className="input dt-fpop-q" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Find a ${title.toLowerCase()}`} />}
    <div className="dt-fpop-list">
      {list.map((o) => <label key={o.value} className="dt-fpop-opt"><input type="checkbox" checked={picked.includes(o.value)} onChange={() => flip(o.value)} />
        {o.colour && <span className="dot" style={{ ['--c' as string]: o.colour }} />}<span className="l">{o.label}</span><span className="n">{counts.get(o.value) ?? 0}</span></label>)}
      {!list.length && <p className="muted">{opts.length ? 'Nothing matches.' : 'No values yet.'}</p>}
    </div>
  </div>;
}

/** Placeholder rows while a list loads, shaped like the table (thumbnail + two lines, then short cells). */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return <div className="dt dt-skel" aria-busy="true" aria-label="Loading">
    <div className="dt-skel-h">{Array.from({ length: cols }, (_, i) => <span key={i} className="skeleton" style={{ width: i ? 60 : 110 }} />)}</div>
    {Array.from({ length: rows }, (_, r) => <div key={r} className="dt-skel-r" style={{ opacity: 1 - r * 0.12 }}>
      <span className="skeleton dt-skel-t" />
      <span className="dt-skel-l"><span className="skeleton" style={{ width: `${55 + ((r * 17) % 30)}%` }} /><span className="skeleton" style={{ width: `${30 + ((r * 11) % 25)}%`, height: 9 }} /></span>
      {Array.from({ length: cols - 1 }, (_, i) => <span key={i} className="skeleton dt-skel-c" />)}
    </div>)}
  </div>;
}

// ---------------------------------------------------------------- shared filters for common columns
/** Status column filter (labels from the status badges). */
export const statusFilter = <T extends { status: string }>(): ColFilter<T> => ({ type: 'set', title: 'Status', get: (r) => r.status, label: (v) => STATUS_LABEL[v] ?? v.replace('_', ' ') });
/** Updated column filter (date range). */
export const updatedFilter = <T extends { updatedAt: string }>(): ColFilter<T> => ({ type: 'date', title: 'Updated', get: (r) => r.updatedAt });

// ---------------------------------------------------------------- list actions (row menu + bulk bar + delete dialog)
type Item = { id: string; status: string; publishedRevisionId: string | null };
const DELETABLE = ['draft', 'changes_requested', 'archived'];
const ARCHIVABLE = ['draft', 'changes_requested', 'approved', 'in_review'];
export const canDelete = (r: Item) => !r.publishedRevisionId && DELETABLE.includes(r.status);
const whyNotDelete = (r: Item) => (r.publishedRevisionId ? 'Live items must be unpublished first' : ['in_review', 'approved', 'scheduled'].includes(r.status) ? 'Items in review must be withdrawn first' : 'Can’t be deleted in this state');

/** The actions a list supports, from the user's permissions and each item's state: the ⋯ row menu (with Edit and
 *  Open on the website as quick actions), the bulk actions with reasons for skipped items, and the delete dialog. */
export function useListActions<T extends Item>(o: {
  base: string; noun: [string, string]; name: (r: T) => string; reload: () => Promise<unknown>;
  can: { update: boolean; approve?: boolean; publish?: boolean; archive?: boolean; delete?: boolean; preview?: boolean };
  edit: (r: T) => string; liveUrl?: (r: T) => string | null;
  menu?: (r: T) => RowAction[];             // extra row actions after Preview (e.g. Duplicate)
}) {
  const toast = useToast();
  const [deleting, setDeleting] = useState<T[] | null>(null);
  const { base, noun, name, can } = o;
  const word = (n: number) => (n === 1 ? noun[0] : noun[1]);
  const runAll = (label: string, done: string, fn: (r: T) => Promise<unknown>) => async (sel: T[]) => {
    let ok = 0; const failed: string[] = [];
    for (const r of sel) { try { await fn(r); ok++; } catch (e) { failed.push(`${name(r)}: ${(e as Error).message}`); } }
    await o.reload();
    if (ok) toast(`${ok} ${word(ok)} ${done}`);
    if (failed.length) toast(`${label} failed for ${failed.length}: ${failed.slice(0, 2).join(' · ')}${failed.length > 2 ? ' …' : ''}`, true);
  };
  const tr = (action: string) => (r: T) => post(`${base}/${r.id}/transition`, { action });
  const submit = runAll('Submit', 'sent for review', tr('submit'));
  const approve = runAll('Approve', 'approved', tr('approve'));
  const publish = runAll('Publish', 'published to the website', (r) => post(`${base}/${r.id}/publish`));
  const unpublishNow = runAll('Unpublish', 'removed from the website', (r) => post(`${base}/${r.id}/unpublish`));
  const archiveNow = runAll('Archive', 'archived', tr('archive'));
  const restore = runAll('Restore', 'restored as drafts', tr('restore'));
  const unpublish = async (sel: T[]) => { if (confirm(sel.length === 1 ? `Remove “${name(sel[0])}” from the website? It stays in Studio as a draft.` : `Remove ${sel.length} ${noun[1]} from the website? They stay in Studio as drafts.`)) await unpublishNow(sel); };
  const archive = async (sel: T[]) => { if (confirm(`Archive ${sel.length === 1 ? `“${name(sel[0])}”` : `${sel.length} ${noun[1]}`}? Archived items can be restored later.`)) await archiveNow(sel); };
  function preview(r: T) {
    const w = window.open('', '_blank');   // opened now, so the browser doesn't block it after the request
    post<{ url: string }>(`${base}/${r.id}/preview`).then((p) => { if (w) w.location.href = p.url; else location.href = p.url; }).catch((e) => { w?.close(); toast((e as Error).message, true); });
  }
  const isDraft = (r: T) => ['draft', 'changes_requested'].includes(r.status);
  const archivable = (r: T) => !r.publishedRevisionId && ARCHIVABLE.includes(r.status);

  const bulk: BulkAction<T>[] = [
    ...(can.update ? [{ label: 'Submit for review', icon: 'send', applies: isDraft, why: (r: T) => (r.status === 'in_review' ? 'Already in review' : 'Only drafts can be sent for review'), run: submit }] : []),
    ...(can.approve ? [{ label: 'Approve', icon: 'checkcircle', applies: (r: T) => r.status === 'in_review', why: () => 'Only items in review can be approved', run: approve }] : []),
    ...(can.publish ? [
      { label: 'Publish', icon: 'rocket', applies: (r: T) => r.status === 'approved', why: () => 'Only approved items can be published', run: publish },
      { label: 'Unpublish', icon: 'eyeoff', applies: (r: T) => !!r.publishedRevisionId, why: () => 'Not on the website', run: unpublish },
    ] : []),
    ...(can.archive ? [
      { label: 'Archive', icon: 'archive', applies: archivable, why: (r: T) => (r.publishedRevisionId ? 'Live items must be unpublished first' : r.status === 'archived' ? 'Already archived' : 'Can’t be archived in this state'), run: archive },
      { label: 'Restore', icon: 'undo', applies: (r: T) => r.status === 'archived', why: () => 'Not archived', run: restore },
    ] : []),
    ...(can.delete ? [{ label: 'Delete', icon: 'x', danger: true, applies: canDelete as (r: T) => boolean, why: whyNotDelete, run: async (sel: T[]) => setDeleting(sel) }] : []),
  ];

  const rowMenu = (r: T): RowAction[] => {
    const live = !!r.publishedRevisionId; const url = live ? o.liveUrl?.(r) ?? null : null;
    const out: RowAction[] = [{ label: can.update ? 'Edit' : 'Open', icon: 'log', quick: true, run: () => navigate(o.edit(r)) }];
    if (url) out.push({ label: 'Open on the website', icon: 'ext', quick: true, run: () => window.open(url, '_blank', 'noopener') });
    if (can.preview !== false) out.push({ label: 'Preview', icon: 'eye', hint: live && r.status !== 'published' ? 'Shows the unpublished changes' : undefined, run: () => preview(r) });
    out.push(...(o.menu?.(r) ?? []));
    const flow: RowAction[] = [];
    if (can.update && isDraft(r)) flow.push({ label: 'Submit for review', icon: 'send', run: () => submit([r]) });
    if (can.approve && r.status === 'in_review') flow.push({ label: 'Approve', icon: 'checkcircle', run: () => approve([r]) });
    if (can.publish && r.status === 'approved') flow.push({ label: live ? 'Publish changes' : 'Publish', icon: 'rocket', hint: live ? 'Replaces the live version' : 'Puts it on the website', run: () => publish([r]) });
    if (can.publish && live) flow.push({ label: 'Unpublish', icon: 'eyeoff', hint: 'Takes it off the website', run: () => unpublish([r]) });
    if (can.archive && archivable(r)) flow.push({ label: 'Archive', icon: 'archive', run: () => archive([r]) });
    if (can.archive && r.status === 'archived') flow.push({ label: 'Restore', icon: 'undo', hint: 'Back to drafts', run: () => restore([r]) });
    if (flow.length) { flow[0].sep = true; out.push(...flow); }
    if (can.delete && canDelete(r)) out.push({ label: 'Delete…', icon: 'x', danger: true, sep: true, hint: 'Permanently, after you confirm', run: () => setDeleting([r]) });
    return out;
  };

  const dialog = deleting && <DeleteDialog names={deleting.map(name)} noun={noun} onClose={() => setDeleting(null)} run={async () => {
    let ok = 0; const failed: string[] = [];
    for (const r of deleting) { try { await del(`${base}/${r.id}`); ok++; } catch (e) { failed.push(`${name(r)}: ${(e as Error).message}`); } }
    setDeleting(null); await o.reload();
    if (ok) toast(`${ok} ${word(ok)} deleted`);
    if (failed.length) toast(failed.slice(0, 2).join(' · '), true);
  }} />;
  return { bulk, rowMenu, dialog, preview };
}

/** Permanent delete: lists the names, says it can't be undone, and asks for the name (one item) or DELETE (several). */
export function DeleteDialog({ names, noun, onClose, run }: { names: string[]; noun: [string, string]; onClose: () => void; run: () => Promise<void> }) {
  const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false);
  const one = names.length === 1; const want = one ? names[0].trim() : 'DELETE';
  const match = one ? typed.trim().toLowerCase() === want.toLowerCase() : typed.trim() === want;
  const go = async () => { if (!match || busy) return; setBusy(true); try { await run(); } finally { setBusy(false); } };
  return <Modal title={one ? `Delete this ${noun[0]}?` : `Delete ${names.length} ${noun[1]}?`} size="sm" onClose={onClose}
    footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={!match || busy} onClick={go}>{busy ? 'Deleting…' : one ? `Delete ${noun[0]}` : `Delete ${names.length} ${noun[1]}`}</button></>}>
    <div className="lt-del">
      <p>{one ? <>“<b>{names[0]}</b>” will be deleted permanently, with its versions and links. This can’t be undone.</> : <>These {noun[1]} will be deleted permanently, with their versions and links. This can’t be undone.</>}</p>
      {!one && <ul>{names.slice(0, 8).map((n, i) => <li key={i}>{n}</li>)}{names.length > 8 && <li>and {names.length - 8} more</li>}</ul>}
      <p className="lt-keep"><Icon n="image" />Photos and files stay in the Media Library.</p>
      <label style={{ display: 'grid', gap: 6 }}><span>{one ? <>Type the name, <b>{want}</b>, to confirm</> : <>Type <b>DELETE</b> to confirm</>}</span>
        <input autoFocus className="input" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} autoComplete="off" /></label>
    </div>
  </Modal>;
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
    { label: 'Submit for review', icon: 'send', applies: (r) => ['draft', 'changes_requested'].includes(r.status), why: (r) => (r.status === 'in_review' ? 'Already in review' : 'Only drafts can be sent for review'), run: run('submit', 'sent for review') },
    { label: 'Archive', icon: 'archive', applies: (r) => !r.publishedRevisionId && ARCHIVABLE.includes(r.status), why: (r) => (r.publishedRevisionId ? 'Live items must be unpublished first' : r.status === 'archived' ? 'Already archived' : 'Can’t be archived in this state'),
      run: async (sel) => { if (confirm(`Archive ${sel.length} ${sel.length === 1 ? opts.noun[0] : opts.noun[1]}? They can be restored later.`)) await run('archive', 'archived')(sel); } },
    { label: 'Restore', icon: 'undo', applies: (r) => r.status === 'archived', why: () => 'Not archived', run: run('restore', 'restored as drafts') },
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

export const EmptyState = ({ icon, text, sub, onClear, action }: { icon: string; text: string; sub?: string; onClear?: () => void; action?: ReactNode }) =>
  <div className="dt-empty"><Icon n={icon} /><b>{text}</b>{sub && <span className="muted">{sub}</span>}
    {(onClear || action) && <span className="dt-empty-a">{onClear && <button className="btn btn-sm" onClick={onClear}>Clear filters</button>}{action}</span>}</div>;
