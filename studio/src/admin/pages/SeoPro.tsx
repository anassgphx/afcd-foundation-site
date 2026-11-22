// SEO Pro: master dashboard, Google Search Console workspace and the Google connection center.
// Every Google number comes from rows Search Console returned and Studio stored; when there is no data, the UI says so
// (no zeroes standing in for missing data). Studio's own checks are labelled as build-audit results.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Icon, Link, Modal, ago, fmtDate, navigate, useCan, useToast } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';
import { DataTable, EmptyState, ListToolbar } from '../DataTable.tsx';
import { SEV, SEV_ORDER, SevBadge, tone, type AuditV2, type Issue } from './Seo.tsx';

// ---------------------------------------------------------------- data types (mirrors of the API)
type Conn = { status: string; accountEmail: string | null; scopes: string[]; property: string | null; permissionLevel: string | null; connectedAt: string; lastSyncAt: string | null; lastSyncedDate: string | null; lastError: string | null };
type Job = { id: string; kind: string; status: string; progress: number; message: string; attempts: number; maxAttempts: number; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; runAfter: string; result: Record<string, unknown> | null };
type Coverage = { property: string; from: string | null; to: string | null; days: number; importedAt: string | null } | null;
type GStatus = { setup: { configured: boolean; missing: string[]; keyError: string | null; redirectUri: string }; settings: { backfillDays: number; retentionDays: number; autoSync: boolean };
  connection: Conn | null; usage: Record<string, { used: number; limit: number }>; coverage: Coverage; jobs: Job[] };
type Point = { date: string; clicks: number; impressions: number; position: number };
type Totals = { clicks: number; impressions: number; ctr: number | null; position: number | null };
type Ov = { coverage: Coverage; current: { series: Point[]; totals: Totals; days: number } | null; previous: { series: Point[]; totals: Totals; days: number } | null };
type Row = { key: string; clicks: number; impressions: number; ctr: number; position: number | null };
type Mover = { key: string; clicks: number; prevClicks: number; impressions: number; prevImpressions: number; position: number | null; prevPosition: number | null; delta: number };
type Movers = { method: string; winners: Mover[]; losers: Mover[] };
type Inspection = { id: string; url: string; verdict: string | null; coverageState: string | null; indexingState: string | null; lastCrawlTime: string | null; googleCanonical: string | null; userCanonical: string | null; createdAt: string; link: string | null };

// ---------------------------------------------------------------- formatting
const nf = new Intl.NumberFormat('en-GB'); const cf = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const num = (n: number) => (n >= 10000 ? cf.format(n) : nf.format(n));
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`);
const posf = (n: number | null) => (n === null ? '—' : n.toFixed(1));
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?[^/]+/, '') || '/';
const DEVICES = [['', 'All devices'], ['MOBILE', 'Mobile'], ['DESKTOP', 'Desktop'], ['TABLET', 'Tablet']] as const;

/** Change against the previous period, coloured by whether the change is good (lower position is better). */
function Delta({ cur, prev, kind }: { cur: number | null; prev: number | null | undefined; kind: 'count' | 'ratio' | 'position' }) {
  if (cur === null || prev === null || prev === undefined) return null;
  const d = cur - prev; if (Math.abs(d) < (kind === 'count' ? 1 : kind === 'ratio' ? 0.0005 : 0.05)) return <span className="sp-delta">no change</span>;
  const good = kind === 'position' ? d < 0 : d > 0;
  const txt = kind === 'count' ? `${d > 0 ? '+' : '−'}${num(Math.abs(d))}` : kind === 'ratio' ? `${d > 0 ? '+' : '−'}${(Math.abs(d) * 100).toFixed(1)} pt` : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
  return <span className={`sp-delta ${good ? 'up' : 'down'}`}>{good ? '▲' : '▼'} {txt}</span>;
}

// ---------------------------------------------------------------- one-measure line chart (crosshair + tooltip, table view)
type Series = { name: string; values: { x: string; y: number | null }[]; dashed?: boolean };
export function LineChart({ series, fmt, height = 180, label, invert = false, xLabel = day }: { series: Series[]; fmt: (n: number) => string; height?: number; label: string; invert?: boolean; xLabel?: (x: string) => string }) {
  const box = useRef<HTMLDivElement>(null); const [w, setW] = useState(600); const [hover, setHover] = useState<number | null>(null); const [table, setTable] = useState(false);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const main = series[0]; const n = main.values.length;
  const all = series.flatMap((s) => s.values.map((v) => v.y)).filter((v): v is number => v !== null);
  if (!n || !all.length) return <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No data for this period.</p>;
  const pad = { l: 44, r: 12, t: 10, b: 24 }; const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  let lo = Math.min(...all), hi = Math.max(...all); if (!invert) lo = Math.min(0, lo); if (hi === lo) hi = lo + 1;
  const ticks = [0, 0.5, 1].map((t) => lo + (hi - lo) * t);
  const xs = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const ys = (v: number) => pad.t + (invert ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo)) * ih;
  const path = (s: Series) => s.values.map((v, i) => (v.y === null ? '' : `${i && s.values[i - 1]?.y !== null ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v.y).toFixed(1)}`)).join('');
  const onMove = (e: React.MouseEvent) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); };
  const labelsAt = n <= 1 ? [0] : [0, Math.round((n - 1) / 2), n - 1];
  return <div className="sp-chart" ref={box}>
    {series.length > 1 && <div className="sp-legend">{series.map((s) => <span key={s.name}><i className={s.dashed ? 'dash' : ''} />{s.name}</span>)}</div>}
    {table ? <div className="scroll-x" style={{ maxHeight: height + 40 }}><table className="table"><thead><tr><th>Date</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
      <tbody>{main.values.map((v, i) => <tr key={v.x}><td>{xLabel(v.x)}</td>{series.map((s) => <td key={s.name}>{s.values[i]?.y === null || s.values[i] === undefined ? '—' : fmt(s.values[i].y!)}</td>)}</tr>)}</tbody></table></div>
      : <svg width={w} height={height} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => <g key={i}><line x1={pad.l} x2={w - pad.r} y1={ys(t)} y2={ys(t)} className="sp-grid" /><text x={pad.l - 6} y={ys(t) + 4} className="sp-axis" textAnchor="end">{fmt(t)}</text></g>)}
        {labelsAt.map((i) => <text key={i} x={xs(i)} y={height - 6} className="sp-axis" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{xLabel(main.values[i].x)}</text>)}
        {series.slice().reverse().map((s) => <path key={s.name} d={path(s)} className={`sp-line${s.dashed ? ' dash' : ''}`} />)}
        {hover !== null && <><line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={pad.t + ih} className="sp-cross" />
          {series.map((s) => s.values[hover]?.y !== null && s.values[hover] ? <circle key={s.name} cx={xs(hover)} cy={ys(s.values[hover].y!)} r={4} className={`sp-dot${s.dashed ? ' dash' : ''}`} /> : null)}</>}
      </svg>}
    {hover !== null && !table && <div className="sp-tip" style={{ left: Math.min(xs(hover) + 10, w - 170) }}>
      <b>{xLabel(main.values[hover].x)}</b>{series.map((s) => <span key={s.name}>{s.name}: <b>{s.values[hover]?.y === null || !s.values[hover] ? '—' : fmt(s.values[hover].y!)}</b></span>)}</div>}
    <button className="sp-tablebtn" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show as table'}</button>
  </div>;
}

// ---------------------------------------------------------------- shared state: Google status + the date range
function useGoogle() {
  const [s, setS] = useState<GStatus | null>(null);
  const load = useCallback(() => api<GStatus>('/seo/google/status').then(setS), []);
  useEffect(() => { load().catch(() => setS(null)); }, [load]);
  return { s, load };
}
type RangeState = { days: number; device: string; country: string; compare: boolean };
function useRange(cov: Coverage) {
  const [r, setR] = useState<RangeState>({ days: 28, device: '', country: '', compare: true });
  const to = cov?.to ?? null; const from = to ? (cov!.from && addDays(to, -(r.days - 1)) < cov!.from ? cov!.from : addDays(to, -(r.days - 1))) : null;
  const qs = from && to ? `from=${from}&to=${to}${r.device ? `&device=${r.device}` : ''}${r.country ? `&country=${r.country}` : ''}` : null;
  return { r, setR, from, to, qs };
}
function RangeBar({ rs, countries, showFilters = true }: { rs: ReturnType<typeof useRange>; countries?: Row[]; showFilters?: boolean }) {
  const { r, setR, from, to } = rs;
  return <div className="sp-range">
    <div className="seg" role="group" aria-label="Period">{[7, 28, 90].map((d) => <button key={d} className={r.days === d ? 'on' : ''} onClick={() => setR({ ...r, days: d })}>{d} days</button>)}</div>
    <label className="check"><input type="checkbox" checked={r.compare} onChange={(e) => setR({ ...r, compare: e.target.checked })} /> Compare with previous period</label>
    {showFilters && <>
      <select className="select" aria-label="Device" value={r.device} onChange={(e) => setR({ ...r, device: e.target.value, country: '' })}>{DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select className="select" aria-label="Country" value={r.country} onChange={(e) => setR({ ...r, country: e.target.value, device: '' })}>
        <option value="">All countries</option>{(countries ?? []).map((c) => <option key={c.key} value={c.key}>{c.key.toUpperCase()}</option>)}</select></>}
    {from && to && <span className="muted" style={{ fontSize: 12 }}>{day(from)} – {day(to)} {to && <>· final Google data</>}</span>}
  </div>;
}

// ---------------------------------------------------------------- Master dashboard (Overview)
export function MasterOverview({ a, issues, history }: { a: AuditV2; issues: Issue[]; history: { at: string; scores: Record<string, number> | null }[] }) {
  const { s } = useGoogle(); const rs = useRange(s?.coverage ?? null);
  const [ov, setOv] = useState<Ov | null>(null); const [mv, setMv] = useState<{ pages: Movers; queries: Movers } | null>(null);
  const [pagesRows, setPagesRows] = useState<Row[] | null>(null); const [insp, setInsp] = useState<Inspection[] | null>(null); const [jobs, setJobs] = useState<Job[] | null>(null);
  const [mvTab, setMvTab] = useState<'pages' | 'queries'>('pages'); const [schemaLive, setSchemaLive] = useState<boolean | null>(null);
  const hasData = !!s?.coverage?.to;
  useEffect(() => {
    api<Job[]>('/seo/jobs').then(setJobs).catch(() => setJobs([]));
    api<{ published: { _revision?: string } | null }>('/seo/schema').then((x) => setSchemaLive(!!x.published?._revision)).catch(() => setSchemaLive(null));
  }, []);
  useEffect(() => {
    if (!hasData || !rs.qs) return;
    api<Ov>(`/seo/gsc/overview?${rs.qs}&compare=${rs.r.compare ? 1 : 0}`).then(setOv);
    api<{ pages: Movers; queries: Movers }>(`/seo/gsc/movers?from=${rs.from}&to=${rs.to}`).then(setMv);
    api<Row[]>(`/seo/gsc/pages?from=${rs.from}&to=${rs.to}`).then(setPagesRows);
    api<Inspection[]>('/seo/gsc/inspections').then(setInsp);
  }, [hasData, rs.qs, rs.r.compare]);

  // Studio build audit (internal checks)
  const open = issues.filter((i) => i.status !== 'resolved');
  const broken = new Set(open.filter((i) => i.code === 'tech.broken-links').map((i) => i.file)).size;
  const orphans = new Set(open.filter((i) => i.code === 'link.orphan').map((i) => i.file)).size;
  const indexable = a.pages.filter((p) => p.inSitemap && p.canonicalOk).length;
  const warnings = (a.counts?.high ?? 0) + (a.counts?.medium ?? 0);
  const trend = history.filter((h) => h.scores).slice(0, 20).reverse();
  // work queue: issue groups ranked by severity and reach, plus Search Console opportunities (real impressions, low CTR)
  const groups = [...open.reduce((m, i) => m.set(i.code, [...(m.get(i.code) ?? []), i]), new Map<string, Issue[]>()).values()]
    .filter((g) => g[0].severity !== 'info').sort((x, y) => SEV_ORDER.indexOf(x[0].severity) - SEV_ORDER.indexOf(y[0].severity) || y.length - x.length);
  const opps = (pagesRows ?? []).filter((p) => p.impressions >= 100 && p.ctr < 0.02).sort((x, y) => y.impressions - x.impressions).slice(0, 3);
  const cur = ov?.current?.totals ?? null; const prev = rs.r.compare ? ov?.previous?.totals : null;
  const series = (k: 'clicks' | 'impressions'): Series[] => {
    const c = ov?.current?.series ?? []; const p = ov?.previous?.series ?? [];
    return [{ name: 'This period', values: c.map((x) => ({ x: x.date, y: x[k] })) }, ...(rs.r.compare && p.length ? [{ name: 'Previous period', dashed: true, values: c.map((x, i) => ({ x: x.date, y: p[i]?.[k] ?? null })) }] : [])];
  };
  const verdicts = (insp ?? []).reduce((m, i) => m.set(i.verdict ?? 'UNKNOWN', (m.get(i.verdict ?? 'UNKNOWN') ?? 0) + 1), new Map<string, number>());
  const gscState = !s ? 'loading' : !s.setup.configured ? 'setup' : !s.connection ? 'off' : s.connection.status !== 'connected' ? 'error' : !s.connection.property ? 'property' : !hasData ? 'syncing' : 'ok';
  const gscMsg: Record<string, [string, string]> = {
    setup: ['Google is not set up on this Studio', 'An administrator adds the Google OAuth client to Studio’s settings, then connects Search Console.'],
    off: ['Search Console is not connected', 'Connect it in Integrations to see clicks, impressions and positions from Google.'],
    error: ['Search Console needs to be reconnected', 'Google stopped accepting Studio’s access. Reconnect it in Integrations.'],
    property: ['Choose a Search Console property', 'The Google account is connected; pick the afcdfoundation.org property in Integrations.'],
    syncing: ['Waiting for the first import', 'Studio is importing Search Console data in the background.'],
  };

  return <div className="stack sp" style={{ gap: 16 }}>
    {hasData && <RangeBar rs={rs} showFilters={false} />}
    {/* KPI strip: internal checks and Google data side by side, each labelled with its source */}
    <div className="sp-kpis">
      <div className="sp-kgroup"><span className="sp-src">Studio build audit · {ago(a.at)}</span>
        <div className="sp-krow">
          <Kpi label="Technical health" value={a.scores ? String(a.scores.technical) : '—'} color={a.scores ? tone(a.scores.technical) : undefined} hint="Studio’s score, not Google’s" />
          <Kpi label="Indexable pages" value={`${indexable}`} hint={`of ${a.pages.length} in the build`} />
          <Kpi label="Critical errors" value={String(a.counts?.critical ?? 0)} color={(a.counts?.critical ?? 0) ? SEV.critical.c : undefined} to="/studio/seo/issues" />
          <Kpi label="Warnings" value={String(warnings)} color={warnings ? SEV.medium.c : undefined} hint="high + medium" to="/studio/seo/issues" />
          <Kpi label="Broken links" value={String(broken)} hint="pages with broken links" />
          <Kpi label="Orphan pages" value={String(orphans)} />
        </div></div>
      <div className="sp-kgroup"><span className="sp-src">Google Search Console{s?.coverage?.importedAt ? ` · imported ${ago(s.coverage.importedAt)}` : ''}</span>
        {gscState === 'ok' && cur ? <div className="sp-krow">
          <Kpi label="Clicks" value={num(cur.clicks)} delta={<Delta cur={cur.clicks} prev={prev?.clicks} kind="count" />} />
          <Kpi label="Impressions" value={num(cur.impressions)} delta={<Delta cur={cur.impressions} prev={prev?.impressions} kind="count" />} />
          <Kpi label="Average CTR" value={pct(cur.ctr)} delta={<Delta cur={cur.ctr} prev={prev?.ctr} kind="ratio" />} />
          <Kpi label="Avg position" value={posf(cur.position)} hint="Google’s average, not a live rank" delta={<Delta cur={cur.position} prev={prev?.position} kind="position" />} />
        </div> : gscState === 'loading' || (gscState === 'ok' && !ov) ? <div className="sp-krow"><Kpi label="Loading" value="…" /></div>
          : <Link to="/studio/seo/integrations" className="sp-kempty"><Icon n="globe" width={18} height={18} /><span><b>{gscMsg[gscState][0]}</b><small>{gscMsg[gscState][1]}</small></span><Icon n="chev" width={14} height={14} /></Link>}
      </div>
      <div className="sp-kgroup sp-ksmall"><span className="sp-src">Google Analytics 4</span>
        <div className="sp-kempty is-static"><span><b>Not connected</b><small>Organic sessions and key events appear once GA4 is added. They are never mixed with Search Console clicks.</small></span></div></div>
    </div>

    <div className="sp-grid2">
      <section className="card"><div className="card-h"><h2>Search performance</h2>{hasData && <Link to="/studio/seo/search-console" className="btn btn-sm btn-ghost">Search Console</Link>}</div>
        <div className="sp-body">{hasData && ov?.current ? <><LineChart label="Clicks per day" series={series('clicks')} fmt={(v) => num(Math.round(v))} />
          <p className="muted sp-note">Clicks per day from Google Search Console ({ov.current.days} days). Impressions are on the Search Console page, on their own scale.</p></>
          : <p className="muted sp-empty">{gscState === 'ok' ? 'Loading…' : 'Appears when Search Console data has been imported. Nothing is estimated.'}</p>}</div></section>
      <section className="card"><div className="card-h"><h2>Technical health over time</h2></div>
        <div className="sp-body">{trend.length > 1 ? <><LineChart label="Technical health score per audit" series={[{ name: 'Technical health', values: trend.map((h) => ({ x: h.at, y: h.scores!.technical })) }]} fmt={(v) => String(Math.round(v))} xLabel={(x) => new Date(x).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
          <p className="muted sp-note">Studio build audits ({trend.length}). Higher is better; it is Studio’s own measure.</p></>
          : <p className="muted sp-empty">Run the build audit a few times to see a trend.</p>}</div></section>
    </div>

    <div className="sp-grid2">
      <section className="card"><div className="card-h"><h2>Winning and losing</h2>
        <div className="seg" role="tablist">{(['pages', 'queries'] as const).map((t) => <button key={t} role="tab" aria-selected={mvTab === t} className={mvTab === t ? 'on' : ''} onClick={() => setMvTab(t)}>{t === 'pages' ? 'Pages' : 'Queries'}</button>)}</div></div>
        {!hasData || !mv ? <p className="muted sp-empty">{hasData ? 'Loading…' : 'Needs Search Console data for this period and the one before it.'}</p> : <>
          <div className="sp-movers"><MoverList title="Gaining clicks" rows={mv[mvTab].winners} kind={mvTab} /><MoverList title="Losing clicks" rows={mv[mvTab].losers} kind={mvTab} /></div>
          <p className="muted sp-note" style={{ padding: '0 16px 14px' }}>{mv[mvTab].method}</p></>}
      </section>
      <section className="card"><div className="card-h"><h2>Work queue</h2><Link to="/studio/seo/issues" className="btn btn-sm btn-ghost">All issues</Link></div>
        {groups.length === 0 && !opps.length ? <div className="db-clear"><Icon n="check" /><div><b>Nothing waiting</b><small>No open issues above “info”.</small></div></div>
          : <ul className="db-list">
            {groups.slice(0, 6).map((g) => <li key={g[0].code}><Link to={`/studio/seo/issues?code=${g[0].code}`} className="db-row"><SevBadge s={g[0].severity} />
              <span className="min-w-0"><b>{g[0].rule?.title ?? g[0].code}</b><small>{g.length} page{g.length === 1 ? '' : 's'} · build audit · {g[0].rule?.kind === 'heuristic' ? 'recommendation' : 'standard check'}</small></span><Icon n="chev" width={14} height={14} /></Link></li>)}
            {opps.map((p) => <li key={p.key}><a className="db-row" href="#" onClick={(e) => { e.preventDefault(); navigate(`/studio/seo/search-console?view=pages&page=${encodeURIComponent(p.key)}`); }}><span className="sev" style={{ ['--c' as string]: '#2563eb' }}>Opportunity</span>
              <span className="min-w-0"><b>Low click-through on {short(p.key)}</b><small>{num(p.impressions)} impressions, {pct(p.ctr)} CTR · Search Console · review its title and description</small></span><Icon n="chev" width={14} height={14} /></a></li>)}
          </ul>}
      </section>
    </div>

    <div className="sp-grid4">
      <section className="card sp-mini"><h3>Indexing <small>URL Inspection</small></h3>
        {!insp?.length ? <p className="muted">{gscState === 'ok' ? 'No addresses inspected yet. Inspect pages in Search Console → Index status.' : 'Needs Search Console.'}</p>
          : <ul className="sp-facts">{[...verdicts].map(([v, c]) => <li key={v}><span>{v === 'PASS' ? 'Indexed (last known)' : v === 'NEUTRAL' ? 'Not indexed' : v === 'FAIL' ? 'Problem reported' : v}</span><b>{c}</b></li>)}</ul>}
        <small className="muted">Google’s indexed version, not a live test.</small></section>
      <section className="card sp-mini"><h3>Structured data</h3>
        <ul className="sp-facts"><li><span>Studio markup</span><b>{schemaLive === null ? '—' : schemaLive ? 'Published' : 'Not published'}</b></li>
          <li><span>Pages with markup errors</span><b>{a.pages.filter((p) => p.schemaErrors.length).length}</b></li></ul>
        <Link to="/studio/seo/schema" className="btn btn-sm btn-ghost">Schema studio</Link></section>
      <section className="card sp-mini"><h3>Core Web Vitals</h3><p className="muted">Not connected. Field data (CrUX) and lab tests (PageSpeed) will appear here once added; nothing is estimated.</p></section>
      <section className="card sp-mini"><h3>Background jobs</h3>
        {!jobs?.length ? <p className="muted">No jobs yet.</p> : <ul className="sp-facts">{jobs.slice(0, 4).map((j) => <li key={j.id}><span>{j.kind === 'gsc_sync' ? 'Search Console sync' : j.kind} · {ago(j.createdAt)}</span><b className={`sp-job is-${j.status}`}>{j.status === 'running' ? `${j.progress}%` : j.status}</b></li>)}</ul>}
        <Link to="/studio/seo/integrations" className="btn btn-sm btn-ghost">Integrations</Link></section>
    </div>
  </div>;
}
function Kpi({ label, value, hint, color, delta, to }: { label: string; value: string; hint?: string; color?: string; delta?: React.ReactNode; to?: string }) {
  const body = <><small>{label}</small><b style={color ? { color } : undefined}>{value}</b>{delta}{hint && <span className="sp-hint">{hint}</span>}</>;
  return to ? <Link to={to} className="sp-kpi is-link">{body}</Link> : <div className="sp-kpi">{body}</div>;
}
function MoverList({ title, rows, kind }: { title: string; rows: Mover[]; kind: 'pages' | 'queries' }) {
  return <div><h4>{title}</h4>{!rows.length ? <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>None above the threshold.</p>
    : <ol>{rows.map((r) => <li key={r.key}><span className="min-w-0" title={r.key}>{kind === 'pages' ? short(r.key) : r.key}</span><b className={r.delta > 0 ? 'up' : 'down'}>{r.delta > 0 ? '+' : '−'}{num(Math.abs(r.delta))}</b><small>{num(r.prevClicks)} → {num(r.clicks)}</small></li>)}</ol>}</div>;
}

// ---------------------------------------------------------------- Search Console workspace
export function SearchConsoleView() {
  const { s } = useGoogle(); const rs = useRange(s?.coverage ?? null);
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState(params.get('view') ?? 'performance');
  const [ov, setOv] = useState<Ov | null>(null); const [rows, setRows] = useState<Row[] | null>(null); const [bd, setBd] = useState<{ countries: Row[]; devices: Row[] } | null>(null);
  const [mv, setMv] = useState<{ pages: Movers; queries: Movers } | null>(null); const [minImp, setMinImp] = useState(20);
  const [page, setPage] = useState<string | null>(params.get('page')); const [q, setQ] = useState('');
  const hasData = !!s?.coverage?.to;
  useEffect(() => { if (hasData && rs.from) api<{ countries: Row[]; devices: Row[] }>(`/seo/gsc/breakdown?from=${rs.from}&to=${rs.to}`).then(setBd); }, [hasData, rs.from, rs.to]);
  useEffect(() => {
    if (!hasData || !rs.qs) return; setRows(null);
    if (view === 'performance') api<Ov>(`/seo/gsc/overview?${rs.qs}&compare=${rs.r.compare ? 1 : 0}`).then(setOv);
    if (view === 'queries' || view === 'pages') api<Row[]>(`/seo/gsc/${view}?from=${rs.from}&to=${rs.to}`).then(setRows);
    if (view === 'movers') api<{ pages: Movers; queries: Movers }>(`/seo/gsc/movers?from=${rs.from}&to=${rs.to}&min=${minImp}`).then(setMv);
  }, [hasData, view, rs.qs, rs.r.compare, minImp]);
  if (!s) return <Loading />;
  if (!hasData) return <section className="card"><div className="dt-empty"><Icon n="globe" /><b>{!s.setup.configured ? 'Google is not set up on this Studio' : !s.connection ? 'Search Console is not connected' : !s.connection.property ? 'Choose a Search Console property' : 'No Search Console data imported yet'}</b>
    <small>Clicks, impressions, CTR and average position come only from Google’s API. {s.connection?.property ? 'The first import runs in the background; check its progress in Integrations.' : ''}</small>
    <Link to="/studio/seo/integrations" className="btn btn-sm" style={{ marginTop: 8 }}>Open Integrations</Link></div></section>;
  const VIEWS: [string, string][] = [['performance', 'Performance'], ['queries', 'Queries'], ['pages', 'Pages'], ['breakdown', 'Countries & devices'], ['movers', 'Winners & losers'], ['index', 'Index status']];
  const filtered = (rows ?? []).filter((r) => !q || r.key.toLowerCase().includes(q.toLowerCase()));
  const cols = (kind: 'query' | 'page') => [
    { key: 'k', header: kind === 'query' ? 'Query' : 'Page', sort: (r: Row) => r.key, csv: (r: Row) => r.key, render: (r: Row) => kind === 'page' ? <span className="mono" title={r.key}>{short(r.key)}</span> : <span>{r.key}</span> },
    { key: 'c', header: 'Clicks', sort: (r: Row) => r.clicks, csv: (r: Row) => String(r.clicks), align: 'right' as const, render: (r: Row) => num(r.clicks) },
    { key: 'i', header: 'Impressions', sort: (r: Row) => r.impressions, csv: (r: Row) => String(r.impressions), align: 'right' as const, render: (r: Row) => num(r.impressions) },
    { key: 't', header: 'CTR', sort: (r: Row) => r.ctr, csv: (r: Row) => r.ctr.toFixed(4), align: 'right' as const, render: (r: Row) => pct(r.ctr) },
    { key: 'p', header: 'Avg position', sort: (r: Row) => r.position ?? 999, csv: (r: Row) => r.position?.toFixed(2) ?? '', align: 'right' as const, render: (r: Row) => posf(r.position) },
  ];
  return <div className="stack sp" style={{ gap: 12 }}>
    <div className="sp-sub">{VIEWS.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); history.replaceState(null, '', `?view=${k}`); }}>{l}</button>)}</div>
    {view !== 'index' && <RangeBar rs={rs} countries={bd?.countries} showFilters={view === 'performance'} />}
    {view === 'performance' && (!ov?.current ? <Loading /> : <>
      <div className="sp-krow card" style={{ padding: 0 }}>
        <Kpi label="Clicks" value={num(ov.current.totals.clicks)} delta={<Delta cur={ov.current.totals.clicks} prev={rs.r.compare ? ov.previous?.totals.clicks : null} kind="count" />} />
        <Kpi label="Impressions" value={num(ov.current.totals.impressions)} delta={<Delta cur={ov.current.totals.impressions} prev={rs.r.compare ? ov.previous?.totals.impressions : null} kind="count" />} />
        <Kpi label="Average CTR" value={pct(ov.current.totals.ctr)} delta={<Delta cur={ov.current.totals.ctr} prev={rs.r.compare ? ov.previous?.totals.ctr : null} kind="ratio" />} />
        <Kpi label="Avg position" value={posf(ov.current.totals.position)} hint="Google’s average, not a live rank" delta={<Delta cur={ov.current.totals.position} prev={rs.r.compare ? ov.previous?.totals.position : null} kind="position" />} />
      </div>
      {(['clicks', 'impressions'] as const).map((k) => <section key={k} className="card"><div className="card-h"><h2>{k === 'clicks' ? 'Clicks' : 'Impressions'} per day</h2></div><div className="sp-body">
        <LineChart label={`${k} per day`} fmt={(v) => num(Math.round(v))} height={160}
          series={[{ name: 'This period', values: ov.current!.series.map((x) => ({ x: x.date, y: x[k] })) }, ...(rs.r.compare && ov.previous?.series.length ? [{ name: 'Previous period', dashed: true, values: ov.current!.series.map((x, i) => ({ x: x.date, y: ov.previous!.series[i]?.[k] ?? null })) }] : [])]} /></div></section>)}
      <section className="card"><div className="card-h"><h2>Average position per day</h2></div><div className="sp-body">
        <LineChart label="Average position per day" invert fmt={(v) => v.toFixed(1)} height={140} series={[{ name: 'Avg position', values: ov.current.series.map((x) => ({ x: x.date, y: x.position })) }]} />
        <p className="muted sp-note">Lower is better (axis reversed). Google’s average position for the impressions of each day; it is not a live ranking.</p></div></section>
    </>)}
    {(view === 'queries' || view === 'pages') && <section className="card">
      <ListToolbar tabs={[['all', view === 'queries' ? 'Queries' : 'Pages', rows?.length ?? 0]]} value="all" onChange={() => {}} q={q} setQ={setQ} placeholder={`Search ${view}`} />
      {!rows ? <Loading /> : <DataTable id={`gsc-${view}`} rows={filtered} total={rows.length} rowKey={(r) => r.key} columns={cols(view === 'queries' ? 'query' : 'page')} csvName={`afcd-gsc-${view}-${rs.from}-${rs.to}`}
        onOpen={view === 'pages' ? (r) => setPage(r.key) : undefined} empty={<EmptyState icon="search" text="No rows for this period" />} />}
      <p className="muted sp-note" style={{ padding: '0 16px 14px' }}>{view === 'queries' ? 'Google leaves out rare (anonymized) queries, so these rows add up to less than the site totals.' : 'Click a page to see its history and the queries it appeared for.'} Up to 500 rows; export as CSV.</p>
    </section>}
    {view === 'breakdown' && <div className="sp-grid2">{(['countries', 'devices'] as const).map((k) => <section key={k} className="card"><div className="card-h"><h2>{k === 'countries' ? 'Countries' : 'Devices'}</h2></div>
      {!bd ? <Loading /> : <DataTable id={`gsc-${k}`} rows={bd[k]} total={bd[k].length} rowKey={(r) => r.key} csvName={`afcd-gsc-${k}`} empty={<EmptyState icon="globe" text="No rows" />}
        columns={[{ key: 'k', header: k === 'countries' ? 'Country' : 'Device', sort: (r: Row) => r.key, csv: (r: Row) => r.key, render: (r: Row) => k === 'countries' ? r.key.toUpperCase() : r.key[0] + r.key.slice(1).toLowerCase() }, ...cols('query').slice(1)]} />}</section>)}</div>}
    {view === 'movers' && <section className="card"><div className="card-h"><h2>Winners and losers</h2>
      <label className="sp-inline">Minimum impressions <input className="input" type="number" min={1} max={10000} value={minImp} onChange={(e) => setMinImp(Math.max(1, Number(e.target.value) || 1))} style={{ width: 90 }} /></label></div>
      {!mv ? <Loading /> : <>{(['pages', 'queries'] as const).map((k) => <Fragment key={k}><h3 className="sp-h3">{k === 'pages' ? 'Pages' : 'Queries'}</h3><div className="sp-movers"><MoverList title="Gaining clicks" rows={mv[k].winners} kind={k} /><MoverList title="Losing clicks" rows={mv[k].losers} kind={k} /></div></Fragment>)}
        <p className="muted sp-note" style={{ padding: '0 16px 14px' }}>{mv.pages.method}</p></>}</section>}
    {view === 'index' && <IndexStatus usage={s.usage.urlInspection} />}
    {page && rs.from && <PageHistory url={page} from={rs.from} to={rs.to!} onClose={() => setPage(null)} />}
  </div>;
}

function PageHistory({ url, from, to, onClose }: { url: string; from: string; to: string; onClose: () => void }) {
  const [d, setD] = useState<{ series: Point[]; queries: Row[] } | null>(null);
  useEffect(() => { api<{ series: Point[]; queries: Row[] }>(`/seo/gsc/page?url=${encodeURIComponent(url)}&from=${from}&to=${to}`).then(setD); }, [url, from, to]);
  return <Modal wide title={<span className="mono">{short(url)}</span>} onClose={onClose}><div className="modal-b stack" style={{ gap: 14, overflow: 'auto' }}>
    {!d ? <Loading /> : <>
      <LineChart label="Clicks per day for this page" series={[{ name: 'Clicks', values: d.series.map((x) => ({ x: x.date, y: x.clicks })) }]} fmt={(v) => num(Math.round(v))} />
      <LineChart label="Impressions per day for this page" series={[{ name: 'Impressions', values: d.series.map((x) => ({ x: x.date, y: x.impressions })) }]} fmt={(v) => num(Math.round(v))} height={140} />
      <h3 className="sp-h3" style={{ padding: 0 }}>Queries this page appeared for</h3>
      <DataTable id="gsc-page-q" rows={d.queries} total={d.queries.length} rowKey={(r) => r.key} csvName="afcd-gsc-page-queries" empty={<EmptyState icon="search" text="No query rows for this page" />}
        columns={[{ key: 'k', header: 'Query', sort: (r: Row) => r.key, csv: (r: Row) => r.key, render: (r: Row) => r.key },
          { key: 'c', header: 'Clicks', sort: (r: Row) => r.clicks, csv: (r: Row) => String(r.clicks), align: 'right', render: (r: Row) => num(r.clicks) },
          { key: 'i', header: 'Impressions', sort: (r: Row) => r.impressions, csv: (r: Row) => String(r.impressions), align: 'right', render: (r: Row) => num(r.impressions) },
          { key: 'p', header: 'Avg position', sort: (r: Row) => r.position ?? 999, csv: (r: Row) => r.position?.toFixed(2) ?? '', align: 'right', render: (r: Row) => posf(r.position) }]} />
      <a className="btn btn-sm" href={url} target="_blank" rel="noopener">Open the page</a>
    </>}</div></Modal>;
}

function IndexStatus({ usage }: { usage?: { used: number; limit: number } }) {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Inspection[] | null>(null); const [url, setUrl] = useState('https://afcdfoundation.org/'); const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  const load = () => api<Inspection[]>('/seo/gsc/inspections').then(setRows);
  useEffect(() => { load(); }, []);
  async function run() { setBusy(true); try { await post('/seo/gsc/inspect', { url }); await load(); toast('Inspected: Google’s last known version'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } }
  const shown = (rows ?? []).filter((r) => !q || r.url.includes(q));
  return <section className="card">
    <div className="card-h"><div><h2 style={{ margin: 0, fontSize: 15 }}>Index status (URL Inspection)</h2><p className="muted" style={{ margin: '2px 0 0', fontSize: 12.5 }}>What Google knows about its indexed version of a page. It is not a live test and does not request indexing.</p></div>
      {usage && <span className="muted" style={{ fontSize: 12 }}>{usage.used} / {usage.limit} inspections today</span>}</div>
    {can('seo.update') && <form className="sp-inspect" onSubmit={(e) => { e.preventDefault(); run(); }}>
      <input className="input mono" aria-label="Address to inspect" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Asking Google…' : 'Inspect'}</button></form>}
    <ListToolbar tabs={[['all', 'Inspected', rows?.length ?? 0]]} value="all" onChange={() => {}} q={q} setQ={setQ} placeholder="Search addresses" />
    {!rows ? <Loading /> : <DataTable id="gsc-inspect" rows={shown} total={rows.length} rowKey={(r) => r.id} csvName="afcd-url-inspection" empty={<EmptyState icon="search" text="No inspections yet" />} columns={[
      { key: 'u', header: 'Address', sort: (r) => r.url, csv: (r) => r.url, render: (r) => <span className="mono" title={r.url}>{short(r.url)}</span> },
      { key: 'v', header: 'Google says', sort: (r) => r.coverageState ?? '', csv: (r) => r.coverageState ?? '', render: (r) => <span className="dt-state"><span className="dot" style={{ ['--c' as string]: r.verdict === 'PASS' ? '#16a34a' : r.verdict === 'FAIL' ? '#dc2626' : '#a8a29e' }} />{r.coverageState ?? r.verdict ?? '—'}</span> },
      { key: 'c', header: 'Last crawl', sort: (r) => r.lastCrawlTime ?? '', csv: (r) => r.lastCrawlTime ?? '', hideBelow: 900, render: (r) => <span className="sub">{r.lastCrawlTime ? fmtDate(r.lastCrawlTime) : '—'}</span> },
      { key: 'k', header: 'Canonical (Google / declared)', csv: (r) => `${r.googleCanonical ?? ''} | ${r.userCanonical ?? ''}`, hideBelow: 1100, render: (r) => <span className={r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical ? '' : 'sub'}>{r.googleCanonical ? short(r.googleCanonical) : '—'}{r.googleCanonical !== r.userCanonical ? ` / ${r.userCanonical ? short(r.userCanonical) : '—'}` : ' (same)'}</span> },
      { key: 'w', header: 'Checked', sort: (r) => r.createdAt, csv: (r) => r.createdAt, render: (r) => <span className="sub">{ago(r.createdAt)}</span> },
      { key: 'l', header: '', render: (r) => r.link ? <a className="btn btn-sm btn-ghost" href={r.link} target="_blank" rel="noopener">In Search Console</a> : null },
    ]} />}
  </section>;
}

// ---------------------------------------------------------------- Integrations (Google connection center)
export function Integrations() {
  const can = useCan(); const toast = useToast(); const { s, load } = useGoogle();
  const [props, setProps] = useState<{ siteUrl: string; permissionLevel: string; usable: boolean }[] | null>(null); const [busy, setBusy] = useState(''); const [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState<GStatus['settings'] | null>(null);
  const params = new URLSearchParams(location.search); const [flash] = useState<{ ok?: boolean; err?: string }>({ ok: params.get('gsc') === 'connected', err: params.get('gsc_error') ?? undefined });
  useEffect(() => { if (flash.ok || flash.err) history.replaceState(null, '', '/studio/seo/integrations'); }, []);
  useEffect(() => { if (s) setForm(s.settings); }, [s?.settings.backfillDays, s?.settings.retentionDays, s?.settings.autoSync]);
  const c = s?.connection; const running = s?.jobs.some((j) => j.status === 'running' || j.status === 'queued');
  useEffect(() => { if (c?.status === 'connected' && can('seo.publish')) api<typeof props>('/seo/google/properties').then(setProps).catch(() => setProps(null)); }, [c?.status, c?.accountEmail]);
  useEffect(() => { if (!running) return; const t = setInterval(load, 3000); return () => clearInterval(t); }, [running, load]);
  async function act(label: string, fn: () => Promise<unknown>, ok?: string) { setBusy(label); try { await fn(); await load(); if (ok) toast(ok); } catch (e) { toast((e as Error).message, true); } finally { setBusy(''); } }
  if (!s) return <Loading />;
  const st = !s.setup.configured ? ['Not set up', '#a8a29e'] : !c ? ['Not connected', '#a8a29e'] : c.status !== 'connected' ? ['Needs reconnecting', '#dc2626'] : !c.property ? ['Choose a property', '#d97706'] : ['Connected', '#16a34a'];
  return <div className="stack sp" style={{ gap: 16 }}>
    {flash.ok && <div className="notice n-ok"><div>Search Console is connected. {can('seo.publish') ? 'Choose the property below.' : ''}</div></div>}
    {flash.err && <div className="notice n-bad"><div>{flash.err}</div></div>}
    <section className="card sp-int">
      <div className="card-h"><div className="sp-int-h"><span className="sp-logo">G</span><div><h2 style={{ margin: 0, fontSize: 15 }}>Google Search Console</h2><small className="muted">Clicks, impressions, CTR, average position and URL Inspection · read-only access</small></div></div>
        <span className="dt-state"><span className="dot" style={{ ['--c' as string]: st[1] }} />{st[0]}</span></div>
      <div className="sp-int-b">
        {!s.setup.configured ? <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>An administrator sets up Google once on the server. Nothing is connected until then, and Studio never shows Google numbers without a real connection.</p>
          <ol className="seo-steps">
            <li>In AFCD’s Google Cloud project, enable the <b>Google Search Console API</b> and create an OAuth client of type <b>Web application</b>.</li>
            <li>Add this authorized redirect URI: <code className="mono">{s.setup.redirectUri}</code></li>
            <li>Put the client ID and secret, and a new encryption key, in <span className="mono">studio/.env</span>{s.setup.missing.length ? <> (missing: <span className="mono">{s.setup.missing.join(', ')}</span>)</> : null}, then restart Studio. See <span className="mono">studio/.env.example</span>.</li>
          </ol>
          {s.setup.keyError && <div className="notice n-bad"><div>{s.setup.keyError}</div></div>}
        </div> : !c ? <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, maxWidth: 620 }}>Connect with a Google account that has access to the afcdfoundation.org property. Studio asks only for read-only Search Console access and your email address; it stores the access encrypted on the server.</p>
          {can('seo.publish') ? <button className="btn btn-primary" disabled={!!busy} onClick={() => act('connect', async () => { const r = await post<{ url: string }>('/seo/google/connect'); location.href = r.url; })}><Icon n="globe" />Connect with Google</button>
            : <span className="muted">An administrator connects Google.</span>}
        </div> : <>
          {c.status !== 'connected' && <div className="notice n-bad"><div><b>{c.lastError ?? 'Access stopped working.'}</b></div>{can('seo.publish') && <button className="btn btn-sm" onClick={() => act('connect', async () => { const r = await post<{ url: string }>('/seo/google/connect'); location.href = r.url; })}>Reconnect</button>}</div>}
          <dl className="kv sp-kv">
            <dt>Account</dt><dd>{c.accountEmail ?? '—'}</dd>
            <dt>Access</dt><dd>{c.scopes.includes('https://www.googleapis.com/auth/webmasters.readonly') ? 'Search Console, read-only' : c.scopes.join(', ')}</dd>
            <dt>Property</dt><dd>{can('seo.publish') && props ? <select className="select" value={c.property ?? ''} disabled={!!busy} onChange={(e) => act('prop', () => put('/seo/google/property', { siteUrl: e.target.value }), 'Property saved. The first import has started.')}>
              <option value="" disabled>Choose a property</option>{props.map((p) => <option key={p.siteUrl} value={p.siteUrl} disabled={!p.usable}>{p.siteUrl}{p.usable ? ` · ${p.permissionLevel.replace('site', '').toLowerCase()}` : ' · not verified for this account'}</option>)}</select>
              : c.property ?? 'Not chosen'}{c.permissionLevel && <small className="muted"> · {c.permissionLevel}</small>}</dd>
            <dt>Connected</dt><dd>{fmtDate(c.connectedAt)}</dd>
            <dt>Last sync</dt><dd>{c.lastSyncAt ? `${fmtDate(c.lastSyncAt)} · data up to ${c.lastSyncedDate}` : 'Not yet'}</dd>
            <dt>Next sync</dt><dd>{!c.property ? '—' : s.settings.autoSync ? (c.lastSyncAt ? `Automatically, about ${fmtDate(new Date(new Date(c.lastSyncAt).getTime() + 20 * 3600_000))}` : 'Soon (first import)') : 'Automatic sync is off'}</dd>
            <dt>Today’s requests</dt><dd>{Object.entries(s.usage).map(([k, u]) => `${k === 'urlInspection' ? 'URL inspections' : 'Search Analytics'} ${u.used} / ${u.limit}`).join(' · ')}</dd>
          </dl>
          <div className="pills" style={{ marginTop: 12 }}>
            {can('seo.update') && c.property && c.status === 'connected' && <button className="btn" disabled={!!busy || running} onClick={() => act('sync', () => post('/seo/google/sync'), 'Sync queued')}><Icon n="undo" style={{ transform: 'scaleX(-1)' }} />{running ? 'Sync in progress' : 'Sync now'}</button>}
            {can('seo.publish') && <button className="btn btn-ghost btn-danger" disabled={!!busy} onClick={() => setConfirm(true)}>Disconnect</button>}
          </div>
        </>}
      </div>
      {c && form && can('seo.publish') && <form className="sp-int-set" onSubmit={(e) => { e.preventDefault(); act('settings', () => put('/seo/google/settings', form), 'Sync settings saved'); }}>
        <label>Import the last <input className="input" type="number" min={7} max={486} value={form.backfillDays} onChange={(e) => setForm({ ...form, backfillDays: Number(e.target.value) })} /> days</label>
        <label>Keep data for <input className="input" type="number" min={30} max={486} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })} /> days</label>
        <label className="check"><input type="checkbox" checked={form.autoSync} onChange={(e) => setForm({ ...form, autoSync: e.target.checked })} /> Sync every day</label>
        <button className="btn btn-sm" disabled={!!busy || JSON.stringify(form) === JSON.stringify(s.settings)}>Save</button>
        <small className="muted">Google keeps about 16 months (486 days). Days become final after 2–3 days; Studio imports final days only.</small>
      </form>}
      {!!s.jobs.length && <div className="sp-jobs"><b>Sync history</b><ul>{s.jobs.map((j) => <li key={j.id}>
        <span className={`sp-job is-${j.status}`}>{j.status}</span>
        <span className="min-w-0"><span>{j.status === 'running' ? j.message || 'Starting…' : j.status === 'succeeded' ? (j.result?.days !== undefined ? `${j.result.days} day${j.result.days === 1 ? '' : 's'} · ${num(Number(j.result.rows ?? 0))} rows${j.result.from ? ` · ${j.result.from} – ${j.result.to}` : ''}` : String(j.result?.note ?? 'Done')) : j.error ?? j.message}</span>
          <small className="muted">{ago(j.createdAt)} · attempt {j.attempts} of {j.maxAttempts}{j.status === 'queued' && new Date(j.runAfter) > new Date() ? ` · next try ${fmtDate(j.runAfter)}` : ''}</small></span>
        {j.status === 'running' && <span className="sp-prog"><i style={{ width: `${j.progress}%` }} /></span>}
        {(j.status === 'running' || j.status === 'queued') && can('seo.update') && <button className="btn btn-sm btn-ghost" onClick={() => act('cancel', () => post(`/seo/jobs/${j.id}/cancel`), 'Cancelled')}>Cancel</button>}
      </li>)}</ul></div>}
    </section>
    <section className="card"><div className="card-h"><h2>Other sources</h2></div>
      <ul className="sp-others">
        {[['Google Analytics 4', 'Sessions, engagement and key events from the GA4 Data API. Kept apart from Search Console clicks.'],
          ['PageSpeed Insights / CrUX', 'Core Web Vitals per page: field data and lab tests, labelled separately.'],
          ['Google Trends', 'Only through an authorized API; otherwise topics are researched by hand.'],
          ['Rank data provider', 'Optional licensed provider for tracked keywords. Studio never scrapes Google.']].map(([t, d]) => <li key={t}><b>{t}</b><small>{d}</small><span className="muted">Not available yet</span></li>)}
      </ul></section>
    {confirm && <Modal size="sm" title="Disconnect Search Console?" onClose={() => setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'disc'} onClick={() => act('disc', async () => { const r = await post<{ revoked: boolean }>('/seo/google/disconnect'); setConfirm(false); if (!r.revoked) toast('Disconnected here. Google could not be reached to revoke access; remove AFCD Studio in your Google account.', true); }, 'Disconnected and access revoked at Google')}>Disconnect</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>Studio revokes its access at Google and deletes the stored tokens. Imported data stays for reports until it reaches the retention limit.</p></div></Modal>}
  </div>;
}
