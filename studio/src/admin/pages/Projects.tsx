// Projects list: search, status tabs with counts that follow every filter, filters inside the column headers
// (category, pillars, status, on the website, updated) plus a panel for the rest (place, years, photos, editor),
// removable chips, a sort menu, saved views, an actions column (⋯, right-click, quick Edit / Open on website) and a
// bulk bar in the header. Every action calls a real, permission-checked server route; menus only offer what the
// user's role and the project's state allow. All filters live in the address bar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDuration } from '../projectFields.tsx';
import { api, post } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, STATUS_LABEL, ago, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { DataTable, EmptyState, FilterTabs, TableSkeleton, applyColFilters, setValues, statusFilter, updatedFilter, useListActions, type Column } from '../DataTable.tsx';

type Row = {
  id: string; name: string; slug: string; category: string; location: string; years: string; status: string; publishedRevisionId: string | null;
  hasDetailPage: boolean; updatedAt: string; updatedBy: string | null; createdBy: string | null; updatedByName: string | null; thumb: string | null; logoThumb?: string | null; sort: number;
  photoCount: number; photoIssues: number; pillars: { key: string; name: string; colour: string; isPrimary: boolean }[];
};

const TABS = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['approved', 'Approved'], ['archived', 'Archived']] as const;
const inTab = (f: string, r: Row) => (f === 'all' ? r.status !== 'archived' : f === 'live' ? !!r.publishedRevisionId : f === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === f);
const STATUS_ORDER: Record<string, number> = { in_review: 0, changes_requested: 1, approved: 2, draft: 3, published: 4, archived: 5 };
const WEB: Record<string, string> = { page: 'Own page', listing: 'Projects listing only', off: 'Not live' };
const webOf = (r: Row) => (!r.publishedRevisionId ? 'off' : r.hasDetailPage ? 'page' : 'listing');

// every filter, as it appears in the address bar (empty = not filtering). Lists of values are joined by "|".
const KEYS = ['status', 'q', 'cat', 'pillar', 'st', 'web', 'ufrom', 'uto', 'loc', 'yfrom', 'yto', 'photos', 'by', 'sort'] as const;
type K = typeof KEYS[number]; type F = Record<K, string>;
const DEFAULTS: F = { status: 'all', q: '', cat: '', pillar: '', st: '', web: '', ufrom: '', uto: '', loc: '', yfrom: '', yto: '', photos: '', by: '', sort: '' };
const readUrl = (): F => { const p = new URLSearchParams(location.search); return Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? DEFAULTS[k]])) as F; };
const toQuery = (f: F) => { const u = new URLSearchParams(); for (const k of KEYS) if (f[k] && f[k] !== DEFAULTS[k]) u.set(k, f[k]); return u.toString(); };
// column filter ↔ address bar keys
const COL: Record<string, K> = { name: 'cat', pillar: 'pillar', status: 'st', page: 'web' };

const SORTS: [string, string][] = [['', 'Listing order'], ['name:asc', 'Name A–Z'], ['name:desc', 'Name Z–A'], ['updated:asc', 'Recently updated'], ['updated:desc', 'Least recently updated'], ['status:asc', 'Status (needs action first)']];
const PHOTOS: Record<string, string> = { has: 'Has photos', none: 'No photos', issues: 'Missing alt text or rights' };
/** The years a project mentions ("2019–2021", "Since 2023"), as a range; null when it names none. */
const yearsOf = (s: string) => { const y = (s.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number); return y.length ? [Math.min(...y), Math.max(...y)] as const : null; };

type View = { name: string; query: string };
const VIEWS_KEY = 'studio.views.projects';
const loadViews = (): View[] => { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]'); } catch { return []; } };
const saveViews = (v: View[]) => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

export function ProjectsList() {
  const can = useCan(); const toast = useToast(); const me = useMe();
  const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState('');
  const [f, setFilters] = useState<F>(readUrl);
  const set = (k: K, v: string) => setFilters((s) => ({ ...s, [k]: v }));
  const [panel, setPanel] = useState(false);
  const [views, setViews] = useState<View[]>(loadViews);
  const [dupPick, setDupPick] = useState(false);
  const [mineOnly, setMineOnly] = useState(() => new URLSearchParams(location.search).get('mine') === '1');
  const load = () => api<Row[]>('/projects').then((r) => { setRows(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { const q = toQuery(f) + (mineOnly ? `${toQuery(f) ? '&' : ''}mine=1` : ''); history.replaceState(history.state, '', `${location.pathname}${q ? `?${q}` : ''}`); }, [f, mineOnly]);

  const all = rows ?? [];
  const opts = useMemo(() => {
    const pl = new Map<string, Row['pillars'][number]>(); all.forEach((r) => r.pillars.forEach((p) => pl.set(p.key, p)));
    const uniq = (xs: (string | null)[]) => [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { pillars: [...pl.values()].sort((a, b) => a.name.localeCompare(b.name)), locs: uniq(all.map((r) => r.location)), by: uniq(all.map((r) => r.updatedByName)) };
  }, [rows]);
  const pillarName = (k: string) => opts.pillars.find((p) => p.key === k)?.name ?? k;

  // ------------------------------------------------------------ actions (shared with the other lists)
  async function duplicate(r: Row) {
    try { const c = await post<{ id: string; name: string }>(`/projects/${r.id}/duplicate`); toast(`Created “${c.name}” as a draft`); navigate(`/studio/projects/${c.id}`); }
    catch (e) { toast((e as Error).message, true); }
  }
  const acts = useListActions<Row>({
    base: '/projects', noun: ['project', 'projects'], name: (r) => r.name, reload: load,
    can: { update: can('project.update'), approve: can('project.approve'), publish: can('project.publish'), archive: can('project.archive'), delete: can('project.archive') },
    edit: (r) => `/studio/projects/${r.id}`, liveUrl: (r) => me.siteUrl + (r.hasDetailPage ? `project-${r.slug}.html` : 'projects.html'),
    menu: (r) => (can('project.create') ? [{ label: 'Duplicate', icon: 'layers', hint: 'A new draft named “Copy of …”', run: () => duplicate(r) }] : []),
  });

  // ------------------------------------------------------------ columns (with their header filters)
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Project', sort: (r) => r.name, csv: (r) => r.name, filter: { type: 'set', title: 'Category', get: (r) => r.category },
      render: (r) => <div className="dt-main">
        <span className={`dt-thumb pjl-thumb${r.logoThumb ? ' is-logo' : ''}`}>{r.logoThumb ? <img src={r.logoThumb} alt="" loading="lazy" /> : r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Icon n="folder" />}</span>
        <span className="min-w-0"><Link className="title" to={`/studio/projects/${r.id}`}>{r.name}</Link>{projectStatus(r.years) && <span className={`pjl-st is-${projectStatus(r.years)!.toLowerCase()}`}><i />{projectStatus(r.years)}</span>}
          <span className="sub">{[r.category, r.location, r.years].filter(Boolean).join(' · ') || '—'}
            {r.photoIssues > 0 && <> · <span className="lt-photo" title="Photos missing alt text or confirmed rights"><Icon n="alert" />{r.photoIssues} photo{r.photoIssues === 1 ? '' : 's'} to complete</span></>}</span></span></div> },
    { key: 'pillar', header: 'Pillars', sort: (r) => r.pillars[0]?.name ?? 'zzz', csv: (r) => r.pillars.map((p) => p.name).join('; '), hideBelow: 900,
      filter: { type: 'set', title: 'Pillars', get: (r) => r.pillars.map((p) => p.key), options: opts.pillars.map((p) => ({ value: p.key, label: p.name, colour: p.colour })) },
      render: (r) => <div className="pills">{r.pillars.map((p) => <span key={p.key} className="pill" title={p.isPrimary ? 'Primary pillar' : 'Also linked'}><span className="dot" style={{ ['--c' as string]: p.colour }} />{p.name}{p.isPrimary && r.pillars.length > 1 ? ' ·' : ''}</span>)}</div> },
    { key: 'status', header: 'Status', sort: (r) => STATUS_ORDER[r.status] ?? 9, csv: (r) => r.status.replace('_', ' '), filter: statusFilter<Row>(),
      render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'page', header: 'On the website', sort: (r) => (r.publishedRevisionId ? (r.hasDetailPage ? 0 : 1) : 2), csv: (r) => (r.publishedRevisionId ? (r.hasDetailPage ? `project-${r.slug}.html` : 'listing only') : 'not live'), hideBelow: 1100,
      filter: { type: 'set', title: 'On the website', get: webOf, options: Object.entries(WEB).map(([value, label]) => ({ value, label })) },
      render: (r) => !r.publishedRevisionId ? <span className="sub">Not live</span> : r.hasDetailPage ? <span className="dt-page"><Icon n="globe" width={13} height={13} /><span className="mono">project-{r.slug}.html</span></span> : <span className="sub">Projects listing only</span> },
    { key: 'updated', header: 'Updated', sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, align: 'right', hideBelow: 700, filter: updatedFilter<Row>(),
      render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b>{r.updatedByName && <small>by {r.updatedByName}</small>}</span> },
  ];
  const colValues: Record<string, string> = { name: f.cat, pillar: f.pillar, status: f.st, page: f.web, updated: f.ufrom || f.uto ? `${f.ufrom}~${f.uto}` : '' };
  const onColFilter = (key: string, v: string) => {
    if (key === 'updated') { const [a = '', b = ''] = v.split('~'); setFilters((s) => ({ ...s, ufrom: a, uto: b })); }
    else if (COL[key]) set(COL[key], v);
  };

  // ------------------------------------------------------------ filtering (everything except the status tab, so tab counts follow)
  const q = f.q.trim().toLowerCase();
  const mine = (r: Row) => r.createdBy === me.user.id || r.updatedBy === me.user.id;
  const base = applyColFilters(all, columns, colValues).filter((r) => {
    if (q && !`${r.name} ${r.category} ${r.slug} ${r.location} ${r.years}`.toLowerCase().includes(q)) return false;
    if (f.loc && r.location.trim() !== f.loc) return false;
    if (f.yfrom || f.yto) { const y = yearsOf(r.years); if (!y || (f.yfrom && y[1] < Number(f.yfrom)) || (f.yto && y[0] > Number(f.yto))) return false; }
    if (f.photos === 'has' && !r.photoCount) return false;
    if (f.photos === 'none' && r.photoCount) return false;
    if (f.photos === 'issues' && !r.photoIssues) return false;
    if (f.by && (r.updatedByName ?? '') !== f.by) return false;
    if (mineOnly && !mine(r)) return false;
    return true;
  });
  const shown = base.filter((r) => inTab(f.status, r));

  // active filters as removable chips (header filters included)
  const each = (k: K, label: string, name: (v: string) => string = (v) => v) => setValues(f[k]).map((v) => ({ label, value: name(v), clear: () => set(k, setValues(f[k]).filter((x) => x !== v).join('|')) }));
  const chips: { label: string; value: string; clear: () => void }[] = [
    ...(mineOnly ? [{ label: 'Only', value: 'my work', clear: () => setMineOnly(false) }] : []),
    ...(f.q.trim() ? [{ label: 'Search', value: `“${f.q.trim()}”`, clear: () => set('q', '') }] : []),
    ...each('cat', 'Category'), ...each('pillar', 'Pillar', pillarName), ...each('st', 'Status', (v) => STATUS_LABEL[v] ?? v), ...each('web', 'Website', (v) => WEB[v] ?? v),
    ...(f.ufrom || f.uto ? [{ label: 'Updated', value: f.ufrom && f.uto ? `${f.ufrom} → ${f.uto}` : f.ufrom ? `since ${f.ufrom}` : `before ${f.uto}`, clear: () => setFilters((s) => ({ ...s, ufrom: '', uto: '' })) }] : []),
    ...(f.loc ? [{ label: 'Location', value: f.loc, clear: () => set('loc', '') }] : []),
    ...(f.yfrom || f.yto ? [{ label: 'Years', value: f.yfrom && f.yto ? `${f.yfrom}–${f.yto}` : f.yfrom ? `from ${f.yfrom}` : `until ${f.yto}`, clear: () => setFilters((s) => ({ ...s, yfrom: '', yto: '' })) }] : []),
    ...(f.photos ? [{ label: 'Photos', value: PHOTOS[f.photos] ?? f.photos, clear: () => set('photos', '') }] : []),
    ...(f.by ? [{ label: 'Updated by', value: f.by, clear: () => set('by', '') }] : []),
  ];
  const panelCount = [f.loc, f.yfrom || f.yto, f.photos, f.by].filter(Boolean).length;
  const clearAll = () => { setFilters((s) => ({ ...DEFAULTS, sort: s.sort })); setMineOnly(false); };

  // saved views: a few built in, plus the user's own (kept in this browser)
  const builtIn: { name: string; apply: Partial<F> }[] = [
    { name: 'Needs review', apply: { status: 'in_review' } },
    { name: 'Missing photo details', apply: { photos: 'issues' } },
    { name: 'Recently updated', apply: { sort: 'updated:asc' } },
  ];
  const current = toQuery(f);
  const applyView = (v: Partial<F>) => { setMineOnly(false); setFilters({ ...DEFAULTS, ...v }); };
  const [sk, sd] = f.sort.split(':');
  const sort = sk ? { key: sk, dir: (sd === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' } : null;

  const empty = all.length === 0
    ? <EmptyState icon="folder" text="No projects yet" sub="Projects appear on the website’s Projects page once they’re published." action={can('project.create') && <Link to="/studio/projects/new" className="btn btn-sm btn-primary"><Icon n="plus" />New project</Link>} />
    : f.status === 'archived' && !chips.length ? <EmptyState icon="archive" text="Nothing archived" sub="Archived projects are kept here, off the website, until they’re restored or deleted." />
    : <EmptyState icon="search" text="No projects match these filters" sub={chips.length ? 'Remove a filter, or clear them all.' : undefined} onClear={clearAll} />;

  return (
    <>
      <div className="page-h">
        <div><h1>Projects</h1><p>Every project on the website, linked to its strategic pillars.</p></div>
        {can('project.create') && <NewSplit onDuplicate={() => setDupPick(true)} />}
      </div>
      <section className="card">
        <div className="card-h dt-toolbar">
          <FilterTabs value={f.status} onChange={(v) => set('status', v)} tabs={TABS.map(([k, l]) => [k, l, base.filter((r) => inTab(k, r)).length])} />
          <div className="dt-tools">
            <button type="button" className={`btn btn-sm lt-btn${panel ? ' on' : ''}`} aria-expanded={panel} aria-controls="pj-filters" onClick={() => setPanel((p) => !p)} title="More filters: place, years, photos, editor"><Icon n="settings" />More filters{panelCount > 0 && <em>{panelCount}</em>}</button>
            <select className="select lt-sort" value={f.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort by">{SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}</select>
            <label className="search"><Icon n="search" /><span className="sr-only">Search projects</span><input className="input" placeholder="Search name, category, place" value={f.q} onChange={(e) => set('q', e.target.value)} />{f.q && <button type="button" className="dt-clear" onClick={() => set('q', '')} aria-label="Clear search">×</button>}</label>
          </div>
        </div>

        <div className="lt-views" role="group" aria-label="Saved views">
          <span>Views</span>
          <button type="button" className={`lt-view${mineOnly && f.status === 'draft' ? ' on' : ''}`} onClick={() => { const on = mineOnly && f.status === 'draft'; setFilters({ ...DEFAULTS, status: on ? 'all' : 'draft' }); setMineOnly(!on); }}>My drafts</button>
          {builtIn.map((v) => { const on = !mineOnly && current === toQuery({ ...DEFAULTS, ...v.apply }); return <button key={v.name} type="button" className={`lt-view${on ? ' on' : ''}`} onClick={() => applyView(on ? {} : v.apply)}>{v.name}</button>; })}
          {views.map((v) => <span key={v.name} className={`lt-view${!mineOnly && current === v.query ? ' on' : ''}`} role="button" tabIndex={0}
            onClick={() => { setMineOnly(false); setFilters({ ...DEFAULTS, ...Object.fromEntries(new URLSearchParams(v.query)) as Partial<F> }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}>{v.name}
            <button type="button" className="x" aria-label={`Remove the view ${v.name}`} onClick={(e) => { e.stopPropagation(); const n = views.filter((x) => x.name !== v.name); setViews(n); saveViews(n); }}>×</button></span>)}
          {current && !views.some((v) => v.query === current) && <button type="button" className="lt-view add" onClick={() => {
            const name = prompt('Name this view (kept in this browser):', '')?.trim().slice(0, 40); if (!name) return;
            const n = [...views.filter((v) => v.name !== name), { name, query: current }]; setViews(n); saveViews(n); toast(`Saved the view “${name}”`);
          }}><Icon n="plus" width={12} height={12} />Save this view</button>}
        </div>

        {panel && <div className="lt-panel" id="pj-filters">
          <label className="lt-f"><b>Location</b><select className="select" value={f.loc} onChange={(e) => set('loc', e.target.value)}><option value="">Anywhere</option>{opts.locs.map((c) => <option key={c}>{c}</option>)}</select></label>
          <div className="lt-f"><b>Years</b><div className="lt-range">
            <input className="input" type="number" inputMode="numeric" min={1990} max={2100} placeholder="From" aria-label="From year" value={f.yfrom} onChange={(e) => set('yfrom', e.target.value.slice(0, 4))} /><span>–</span>
            <input className="input" type="number" inputMode="numeric" min={1990} max={2100} placeholder="To" aria-label="To year" value={f.yto} onChange={(e) => set('yto', e.target.value.slice(0, 4))} /></div></div>
          <label className="lt-f"><b>Photos</b><select className="select" value={f.photos} onChange={(e) => set('photos', e.target.value)}><option value="">Any</option>{Object.entries(PHOTOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="lt-f"><b>Updated by</b><select className="select" value={f.by} onChange={(e) => set('by', e.target.value)}><option value="">Anyone</option>{opts.by.map((c) => <option key={c}>{c}</option>)}</select></label>
          <div className="lt-panel-f"><span className="muted">Category, pillars, status, website and update date filter from the column headers (the funnel icons).</span>
            <span style={{ display: 'flex', gap: 8 }}>{panelCount > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilters((s) => ({ ...s, loc: '', yfrom: '', yto: '', photos: '', by: '' }))}>Clear these</button>}<button type="button" className="btn btn-sm" onClick={() => setPanel(false)}>Done</button></span></div>
        </div>}

        {chips.length > 0 && <div className="lt-chips" aria-label="Active filters">
          {chips.map((c) => <span key={c.label + c.value} className="lt-chip"><i>{c.label}</i>{c.value}<button type="button" aria-label={`Remove filter: ${c.label} ${c.value}`} onClick={c.clear}>×</button></span>)}
          <button type="button" className="lt-clear" onClick={clearAll}>Clear all</button>
        </div>}

        {err ? <div className="card-b"><div className="notice n-bad">{err} <button className="btn btn-sm" onClick={load}>Try again</button></div></div> : !rows ? <TableSkeleton cols={5} /> :
          <DataTable id="projects" rows={shown} total={all.filter((r) => f.status === 'archived' || r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} actions={acts.bulk} csvName="afcd-projects"
            rowMenu={acts.rowMenu} sort={sort} onSort={(s) => set('sort', s ? `${s.key}:${s.dir}` : '')} filters={colValues} onFilter={onColFilter} filterRows={all.filter((r) => inTab(f.status, r))}
            onOpen={(r) => navigate(`/studio/projects/${r.id}`)} empty={empty} />}
      </section>

      {acts.dialog}
      {dupPick && <DuplicatePicker rows={all} onClose={() => setDupPick(false)} onPick={(r) => { setDupPick(false); duplicate(r); }} />}
    </>
  );
}

/** “New project” stays the main button; the caret offers a blank project or a copy of an existing one. */
function NewSplit({ onDuplicate }: { onDuplicate: () => void }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    ref.current?.querySelector<HTMLElement>('.split-menu button')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return <div className="split" ref={ref}>
    <Link to="/studio/projects/new" className="btn btn-primary"><Icon n="plus" />New project</Link>
    <button type="button" className="btn btn-primary split-caret" aria-label="More ways to create a project" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon n="chev" /></button>
    {open && <div className="split-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate('/studio/projects/new'); }}><Icon n="plus" /><span>New blank project<small>Start from an empty form</small></span></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onDuplicate(); }}><Icon n="layers" /><span>Duplicate an existing one…<small>Copies its text, pillars, photos and sections as a new draft</small></span></button>
    </div>}
  </div>;
}

function DuplicatePicker({ rows, onClose, onPick }: { rows: Row[]; onClose: () => void; onPick: (r: Row) => void }) {
  const [q, setQ] = useState('');
  const list = rows.filter((r) => !q || `${r.name} ${r.category} ${r.location}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return <Modal title="Duplicate a project" size="sm" onClose={onClose}>
    <div style={{ padding: '14px 16px 4px' }}><label className="search" style={{ width: '100%' }}><Icon n="search" /><span className="sr-only">Find a project</span><input autoFocus className="input" style={{ width: '100%' }} placeholder="Find a project" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
    <div className="lt-dup-list">{list.map((r) => <button key={r.id} type="button" onClick={() => onPick(r)}>
      <span className="dt-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : <Icon n="folder" />}</span><span><b>{r.name}</b><small>{[r.category, r.location, r.years].filter(Boolean).join(' · ') || '—'}</small></span></button>)}
      {!list.length && <p className="muted" style={{ padding: 12, margin: 0 }}>No project matches “{q}”.</p>}</div>
  </Modal>;
}

/** Ongoing / Completed / Upcoming from the duration, the same way the website labels it (src/content.py _status). */
function projectStatus(years: string): 'Ongoing' | 'Completed' | 'Upcoming' | null {
  const t = (years ?? '').trim(); if (!t) return null;
  if (/present|ongoing|today|now/i.test(t)) return 'Ongoing';
  const d = parseDuration(t); if (!d || !d.start) return null;
  const now = new Date().toISOString().slice(0, 7), start = d.start.slice(0, 7), end = d.ongoing ? '9999-12' : (d.end || d.start.slice(0, 4) + '-12').slice(0, 7);
  return end < now ? 'Completed' : start > now ? 'Upcoming' : 'Ongoing';
}
