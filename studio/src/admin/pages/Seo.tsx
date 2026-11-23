// SEO studio: an audit of what the built website shows to search engines and link previews, and reviewed SEO
// settings for the site's template pages. Pages managed elsewhere in Studio link to their own editor.
import { useCallback, useEffect, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { useSite } from '../site.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import { DataTable, EmptyState, FilterTabs, ListToolbar, type Column } from '../DataTable.tsx';
import { Integrations, MasterOverview, SearchConsoleView } from './SeoPro.tsx';

type Owner = { kind: string; id?: string; label: string };
const EDIT: Record<string, (o: Owner) => string | null> = {
  project: (o) => o.id ? `/studio/projects/${o.id}` : null, story: (o) => o.id ? `/studio/news/${o.id}` : null, event: (o) => o.id ? `/studio/events/${o.id}` : null,
  opportunity: (o) => o.id ? `/studio/opportunities/${o.id}` : '/studio/opportunities', page: (o) => o.id ? `/studio/pages/${o.id}` : null,
};
export const tone = (n: number) => (n >= 90 ? '#16a34a' : n >= 70 ? '#ca8a04' : '#dc2626');

export function SeoPage() {
  const path = location.pathname;
  const file = path.match(/^\/studio\/seo\/pages\/([a-z0-9-]+\.html)$/)?.[1];
  if (file) return <SeoEditor key={file} file={file} />;
  const tab = (path.match(/^\/studio\/seo\/([a-z-]+)/)?.[1] ?? 'overview') as Tab;
  return <SeoHome tab={TABS.some((t) => t[0] === tab) ? tab : 'overview'} />;
}

// ---------------------------------------------------------------- SEO Intelligence workspace
type Tab = 'overview' | 'audit' | 'issues' | 'indexability' | 'links' | 'schema' | 'redirects' | 'pages' | 'search-console' | 'integrations';
// workspaces grouped by job: diagnose (Studio's checks), measure (Google), optimize (what Studio publishes), settings
const GROUPS: [string, [Tab, string][]][] = [
  ['', [['overview', 'Overview']]],
  ['Diagnose', [['audit', 'Site audit'], ['issues', 'Issues'], ['indexability', 'Indexability'], ['links', 'Internal links']]],
  ['Google', [['search-console', 'Search Console']]],
  ['Optimize', [['schema', 'Structured data'], ['redirects', 'Redirects'], ['pages', 'Page settings']]],
  ['Settings', [['integrations', 'Integrations']]],
];
const TABS: [Tab, string][] = GROUPS.flatMap(([, t]) => t);
const NO_AUDIT: Tab[] = ['search-console', 'integrations', 'redirects'];
export type Sev = 'critical' | 'high' | 'medium' | 'low' | 'info';
type Rule = { code: string; severity: Sev; category: string; kind: 'standard' | 'heuristic'; title: string; why: string; fix: string };
export type Issue = { id: string; code: string; file: string; severity: Sev; category: string; evidence: string[]; status: 'open' | 'reviewed' | 'resolved'; firstSeen: string; lastSeen: string; resolvedAt: string | null; note: string; reviewer: string | null; rule: Rule | null; owner: Owner };
export type AuditPage = { file: string; url: string; title: string; description: string; words: number; inSitemap: boolean; robots: string; canonical: string; canonicalOk: boolean; lang: string; inbound: number; inboundFrom: string[]; linksOut: number; schema: string[]; schemaErrors: string[]; h1: string; owner: Owner; score: number };
export type AuditV2 = { id: string; kind?: string; at: string; production?: boolean; score: number; scores?: Record<string, number>; counts?: Record<Sev, number>; pages: AuditPage[]; redirects?: { file: string; to: string }[] };
export const SEV: Record<Sev, { label: string; c: string }> = { critical: { label: 'Critical', c: '#b91c1c' }, high: { label: 'High', c: '#dc2626' }, medium: { label: 'Medium', c: '#d97706' }, low: { label: 'Low', c: '#2563eb' }, info: { label: 'Info', c: '#78716c' } };
const CATS: [string, string][] = [['technical', 'Technical health'], ['metadata', 'Metadata'], ['content', 'Content checklist'], ['structured', 'Structured data'], ['linking', 'Internal linking'], ['performance', 'Performance (build)']];
export const editorFor = (o: Owner, file: string) => (o.kind === 'template' ? `/studio/seo/pages/${file}` : EDIT[o.kind]?.(o) ?? null);
export const SevBadge = ({ s }: { s: Sev }) => <span className="sev" style={{ ['--c' as string]: SEV[s].c }}>{SEV[s].label}</span>;

function SeoHome({ tab }: { tab: Tab }) {
  const toast = useToast(); const can = useCan();
  const [data, setData] = useState<{ last: AuditV2 | null; history: { at: string; score: number; scores: Record<string, number> | null; counts: Record<string, number> }[] } | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const [a, i] = await Promise.all([api('/seo/audit'), api<Issue[]>('/seo/issues')]); setData(a); setIssues(i); }, []);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  async function run() { setBusy(true); try { await post('/seo/audit'); await load(); toast('Build audit finished'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } }
  const a = data?.last ?? null; const v2 = !!a?.scores;
  return <>
    <div className="page-h"><div><h1>SEO Intelligence</h1><p>Technical health, Google performance and actionable optimization.</p></div>
      <div className="pills"><Link to="/studio/seo/integrations" className="btn"><Icon n="globe" />Integrations</Link>{can('seo.read') && <button className="btn btn-primary" disabled={busy} onClick={run}><Icon n="search" />{busy ? 'Auditing the build…' : 'Run build audit'}</button>}</div></div>
    <nav className="seo-tabs sp-nav" aria-label="SEO sections">{GROUPS.map(([g, tabs]) => <div key={g || 'top'} className="sp-navg">{g && <span>{g}</span>}
      {tabs.map(([k, l]) => <Link key={k} to={k === 'overview' ? '/studio/seo' : `/studio/seo/${k}`} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}>{l}</Link>)}</div>)}</nav>
    {a && !NO_AUDIT.includes(tab) && <div className="seo-kind"><span className="seo-kind-tag">Build audit</span><span>Checked the pages the website build produced {ago(a.at)}{v2 && !a.production ? ' · preview build (every page is noindex on purpose)' : ''}. This is not Google’s view of the public site.</span></div>}
    {tab === 'redirects' ? <Redirects />
      : tab === 'search-console' ? <SearchConsoleView />
      : tab === 'integrations' ? <Integrations />
      : !data || !issues ? <Loading /> : !a ? <section className="card"><div className="dt-empty"><Icon n="search" /><b>No audit yet</b><small>Run a build audit to check every page.</small></div></section>
      : !v2 ? <section className="card"><div className="dt-empty"><Icon n="search" /><b>Your last audit used the previous engine</b><small>Run a build audit to see the new detailed findings.</small></div></section>
      : tab === 'overview' ? <MasterOverview a={a} issues={issues} history={data.history} />
      : tab === 'audit' ? <SiteAudit a={a} issues={issues} />
      : tab === 'issues' ? <Issues issues={issues} onChange={load} />
      : tab === 'indexability' ? <Indexability a={a} />
      : tab === 'links' ? <InternalLinks a={a} />
      : tab === 'schema' ? <Schema a={a} />
      : <PagesView />}
  </>;
}

export const SEV_ORDER: Sev[] = ['critical', 'high', 'medium', 'low', 'info'];

function SiteAudit({ a, issues }: { a: AuditV2; issues: Issue[] }) {
  const [f, setF] = useState('issues'); const [q, setQ] = useState('');
  const open = issues.filter((i) => i.status !== 'resolved');
  const per = (file: string) => open.filter((i) => i.file === file && i.severity !== 'info');
  const rows = a.pages.filter((p) => (f === 'all' || (f === 'issues' ? per(p.file).length > 0 : f === 'passed' ? per(p.file).length === 0 : per(p.file).some((i) => i.severity === f))) && (!q || `${p.title} ${p.file}`.toLowerCase().includes(q.toLowerCase())));
  const cols: Column<AuditPage>[] = [
    { key: 'score', header: 'Score', sort: (p) => p.score, csv: (p) => String(p.score), width: '80px', render: (p) => <span className="seo-pill" style={{ ['--c' as string]: tone(p.score) }}>{p.score}</span> },
    { key: 'page', header: 'Page', sort: (p) => p.title || p.file, csv: (p) => p.file, render: (p) => <div className="min-w-0"><b className="title">{p.title || p.file}</b><div className="sub mono">{p.file}</div></div> },
    { key: 'issues', header: 'Issues', sort: (p) => -per(p.file).length, csv: (p) => per(p.file).map((i) => i.rule?.title ?? i.code).join('; '), render: (p) => { const l = per(p.file); return l.length ? <div className="pills">{SEV_ORDER.filter((s) => l.some((i) => i.severity === s)).map((s) => <span key={s} className="sev" style={{ ['--c' as string]: SEV[s].c }}>{l.filter((i) => i.severity === s).length} {SEV[s].label.toLowerCase()}</span>)}</div> : <span className="muted">Passed</span>; } },
    { key: 'words', header: 'Words', sort: (p) => p.words, csv: (p) => String(p.words), align: 'right', hideBelow: 1000, render: (p) => <span className="sub">{p.words}</span> },
    { key: 'edit', header: 'Edit in', render: (p) => { const to = editorFor(p.owner, p.file); return to ? <Link to={to} className="btn btn-sm">{p.owner.kind === 'template' ? 'SEO settings' : `${p.owner.kind[0].toUpperCase()}${p.owner.kind.slice(1)} editor`}</Link> : <span className="muted">{p.owner.kind === 'sample' ? 'Website code' : p.owner.label}</span>; } },
  ];
  return <section className="card">
    <ListToolbar tabs={[['issues', 'With issues', a.pages.filter((p) => per(p.file).length).length], ['critical', 'Critical', a.pages.filter((p) => per(p.file).some((i) => i.severity === 'critical')).length], ['high', 'High', a.pages.filter((p) => per(p.file).some((i) => i.severity === 'high')).length], ['passed', 'Passed', a.pages.filter((p) => !per(p.file).length).length], ['all', 'All', a.pages.length]]}
      value={f} onChange={setF} q={q} setQ={setQ} placeholder="Search pages" />
    <DataTable id="seo-audit" rows={rows} total={a.pages.length} rowKey={(p) => p.file} columns={cols} csvName="afcd-seo-audit" initialSort={{ key: 'score', dir: 'asc' }}
      onOpen={(p) => navigate(`/studio/seo/issues?file=${p.file}`)} empty={<EmptyState icon="check" text="No pages here" />} />
  </section>;
}

function Issues({ issues, onChange }: { issues: Issue[]; onChange: () => void }) {
  const can = useCan(); const toast = useToast();
  const params = new URLSearchParams(location.search);
  const [status, setStatus] = useState('open'); const [sev, setSev] = useState('all'); const [cat, setCat] = useState('all');
  const [code, setCode] = useState(params.get('code') ?? ''); const [file] = useState(params.get('file') ?? '');
  const [sel, setSel] = useState<string | null>(null);
  const shown = issues.filter((i) => (status === 'all' || (status === 'open' ? i.status !== 'resolved' : i.status === status)) && (sev === 'all' || i.severity === sev) && (cat === 'all' || i.category === cat) && (!code || i.code === code) && (!file || i.file === file));
  const groups = [...shown.reduce((m, i) => m.set(i.code, [...(m.get(i.code) ?? []), i]), new Map<string, Issue[]>()).values()].sort((x, y) => SEV_ORDER.indexOf(x[0].severity) - SEV_ORDER.indexOf(y[0].severity) || y.length - x.length);
  const g = groups.find((x) => x[0].code === sel) ?? null;
  async function review(i: Issue, reviewed: boolean) { try { await post(`/seo/issues/${i.id}/review`, { reviewed }); await onChange(); toast(reviewed ? 'Marked as reviewed. It still counts until the next audit no longer finds it.' : 'Reopened'); } catch (e) { toast((e as Error).message, true); } }
  return <div className="seo-issues-wrap">
    <section className="card">
      <div className="card-h dt-toolbar">
        <FilterTabs value={status} onChange={setStatus} tabs={[['open', 'Open', issues.filter((i) => i.status !== 'resolved').length], ['reviewed', 'Reviewed', issues.filter((i) => i.status === 'reviewed').length], ['resolved', 'Resolved', issues.filter((i) => i.status === 'resolved').length], ['all', 'All', issues.length]]} />
        <div className="dt-tools">
          <select className="select" value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Severity"><option value="all">All severities</option>{SEV_ORDER.map((s) => <option key={s} value={s}>{SEV[s].label}</option>)}</select>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Area"><option value="all">All areas</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {(code || file) && <button className="btn btn-sm" onClick={() => { setCode(''); history.replaceState(null, '', '/studio/seo/issues'); location.reload(); }}>Clear {file ? `page ${file}` : 'issue'} filter</button>}
        </div>
      </div>
      {groups.length === 0 ? <EmptyState icon="check" text="Nothing here" /> : <ul className="db-list">{groups.map((gr) => <li key={gr[0].code}><button className={`db-row seo-irow${sel === gr[0].code ? ' on' : ''}`} onClick={() => setSel(gr[0].code)}>
        <SevBadge s={gr[0].severity} /><span className="min-w-0"><b>{gr[0].rule?.title ?? gr[0].code}</b><small>{gr.length} page{gr.length === 1 ? '' : 's'} · {CATS.find((c) => c[0] === gr[0].category)?.[1]} · {gr[0].rule?.kind === 'heuristic' ? 'Recommendation' : 'Standard check'}</small></span><Icon n="chev" width={14} height={14} /></button></li>)}</ul>}
    </section>
    {g && <aside className="seo-drawer" role="dialog" aria-label="Issue details">
      <div className="seo-drawer-h"><div><SevBadge s={g[0].severity} /><h2>{g[0].rule?.title}</h2><small className="muted">{CATS.find((c) => c[0] === g[0].category)?.[1]} · {g[0].rule?.kind === 'heuristic' ? 'Recommendation based on good practice' : 'Standard check'}</small></div><button className="btn btn-ghost icon-btn" onClick={() => setSel(null)} aria-label="Close"><Icon n="x" /></button></div>
      <div className="seo-drawer-b">
        <h3>Why it matters</h3><p>{g[0].rule?.why}</p>
        <h3>What to do</h3><p>{g[0].rule?.fix}</p>
        <h3>Affected pages ({g.length})</h3>
        <ul className="seo-aff">{g.map((i) => { const to = editorFor(i.owner, i.file); return <li key={i.id}>
          <div className="between"><b className="mono">{i.file}</b>{to && <Link to={to} className="btn btn-sm">Open editor</Link>}</div>
          {i.evidence.length > 0 && <ul className="seo-ev">{i.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>}
          <small className="muted">First found {fmtDate(i.firstSeen)} · last seen {ago(i.lastSeen)} · {i.status === 'resolved' ? `resolved ${i.resolvedAt ? ago(i.resolvedAt) : ''} (no longer found)` : i.status === 'reviewed' ? `reviewed${i.reviewer ? ` by ${i.reviewer}` : ''}` : 'open'}</small>
          {can('seo.update') && i.status !== 'resolved' && (i.status === 'reviewed' ? <button className="btn btn-ghost btn-sm" onClick={() => review(i, false)}>Reopen</button>
            : i.severity !== 'critical' && <button className="btn btn-ghost btn-sm" onClick={() => review(i, true)}>Mark as reviewed</button>)}
        </li>; })}</ul>
        <p className="muted" style={{ fontSize: 12 }}>An issue is resolved only when an audit no longer finds it. “Reviewed” records that someone looked at it; it does not change any score. Critical issues cannot be set aside.</p>
      </div>
    </aside>}
  </div>;
}

function Indexability({ a }: { a: AuditV2 }) {
  const cat = (p: AuditPage) => (!p.canonicalOk && p.canonical ? 'Canonical points elsewhere' : !p.inSitemap ? 'Excluded (not in sitemap / noindex)' : a.production && /noindex/.test(p.robots) ? 'Noindex' : 'Listed for indexing');
  const cats = ['Listed for indexing', 'Excluded (not in sitemap / noindex)', 'Canonical points elsewhere', 'Noindex'];
  const [f, setF] = useState('all'); const [q, setQ] = useState('');
  const rows = a.pages.filter((p) => (f === 'all' || cat(p) === f) && (!q || `${p.title} ${p.file}`.toLowerCase().includes(q.toLowerCase())));
  const red = (a.redirects ?? []).filter((r) => !q || `${r.file} ${r.to}`.toLowerCase().includes(q.toLowerCase()));
  return <section className="card">
    {!a.production && <div className="notice n-info" style={{ margin: 16 }}><div><b>Preview build.</b> Every page carries noindex on purpose, so this view shows what the production build will list (from the sitemap and canonicals). Google’s own index status is only available through Search Console.</div></div>}
    <ListToolbar tabs={[['all', 'All', a.pages.length], ...cats.map((c) => [c, c.split(' (')[0], a.pages.filter((p) => cat(p) === c).length] as [string, string, number]), ['redirected', 'Redirected', (a.redirects ?? []).length]]} value={f} onChange={setF} q={q} setQ={setQ} placeholder="Search pages" />
    {f === 'redirected' ? <DataTable id="seo-index-red" rows={red} total={(a.redirects ?? []).length} rowKey={(r) => r.file} csvName="afcd-redirected" columns={[
      { key: 'from', header: 'Old address', sort: (r) => r.file, csv: (r) => r.file, render: (r) => <b className="title mono">{r.file}</b> },
      { key: 'state', header: 'Status (build audit)', render: () => <span className="dt-state"><span className="dot" style={{ ['--c' as string]: '#2563eb' }} />Redirected</span> },
      { key: 'to', header: 'Goes to', sort: (r) => r.to, csv: (r) => r.to, render: (r) => <span className="mono sub">{r.to}</span> },
    ]} empty={<EmptyState icon="globe" text="No redirect pages in this build" />} /> : <DataTable id="seo-index" rows={rows} total={a.pages.length} rowKey={(p) => p.file} csvName="afcd-indexability" columns={[
      { key: 'page', header: 'Page', sort: (p) => p.file, csv: (p) => p.file, render: (p) => <div><b className="title">{p.title || p.file}</b><div className="sub mono">{p.url}</div></div> },
      { key: 'state', header: 'Status (build audit)', sort: (p) => cat(p), csv: (p) => cat(p), render: (p) => <span className="dt-state"><span className="dot" style={{ ['--c' as string]: cat(p) === 'Listed for indexing' ? '#16a34a' : '#a8a29e' }} />{cat(p)}</span> },
      { key: 'canon', header: 'Canonical', sort: (p) => (p.canonicalOk ? 0 : 1), csv: (p) => p.canonical, hideBelow: 1100, render: (p) => <span className={p.canonicalOk ? 'sub' : ''}>{p.canonicalOk ? 'Self' : p.canonical || 'Missing'}</span> },
      { key: 'lang', header: 'Language', sort: (p) => p.lang, csv: (p) => p.lang, hideBelow: 900, render: (p) => <span className="sub">{p.lang || 'Missing'}</span> },
    ]} empty={<EmptyState icon="globe" text="No pages here" />} />}
  </section>;
}

function InternalLinks({ a }: { a: AuditV2 }) {
  const [q, setQ] = useState(''); const [f, setF] = useState('all');
  const rows = a.pages.filter((p) => p.file !== '404.html' && (f === 'all' || (f === 'weak' ? p.inbound <= 1 && p.file !== 'index.html' : p.inbound === 0 && p.file !== 'index.html')) && (!q || `${p.title} ${p.file}`.toLowerCase().includes(q.toLowerCase())));
  const base = a.pages.filter((p) => p.file !== '404.html');
  return <section className="card">
    <ListToolbar tabs={[['all', 'All pages', base.length], ['weak', 'One link or fewer', base.filter((p) => p.inbound <= 1 && p.file !== 'index.html').length], ['none', 'No links in content', base.filter((p) => p.inbound === 0 && p.file !== 'index.html').length]]} value={f} onChange={setF} q={q} setQ={setQ} placeholder="Search pages" />
    <DataTable id="seo-links" rows={rows} total={base.length} rowKey={(p) => p.file} csvName="afcd-internal-links" initialSort={{ key: 'in', dir: 'asc' }} columns={[
      { key: 'page', header: 'Page', sort: (p) => p.file, csv: (p) => p.file, render: (p) => <div><b className="title">{p.title || p.file}</b><div className="sub mono">{p.file}</div></div> },
      { key: 'in', header: 'Linked from (content)', sort: (p) => p.inbound, csv: (p) => String(p.inbound), render: (p) => <div><b>{p.inbound}</b>{p.inboundFrom.length > 0 && <div className="sub">{p.inboundFrom.slice(0, 4).join(', ')}{p.inbound > 4 ? '…' : ''}</div>}</div> },
      { key: 'out', header: 'Links out', sort: (p) => p.linksOut, csv: (p) => String(p.linksOut), align: 'right', hideBelow: 900, render: (p) => <span className="sub">{p.linksOut}</span> },
    ]} empty={<EmptyState icon="check" text="No pages here" />} />
    <p className="muted" style={{ fontSize: 12, padding: '0 16px 14px', margin: 0 }}>Counts links inside page content (the menu and footer are excluded, since they link everywhere). Suggestions for new links come in a later step and are always reviewed by a person; Studio never inserts links into approved text.</p>
  </section>;
}

function Schema({ a }: { a: AuditV2 }) {
  const rows = a.pages;
  return <><SchemaStudio /><section className="card">
    <div className="card-h"><div><h2 style={{ margin: 0, fontSize: 15 }}>Found in the build</h2><p className="muted" style={{ margin: '2px 0 0', fontSize: 12.5 }}>What the last build audit read from every page.</p></div></div>
    <DataTable id="seo-schema" rows={rows} total={rows.length} rowKey={(p) => p.file} csvName="afcd-structured-data" columns={[
      { key: 'page', header: 'Page', sort: (p) => p.file, csv: (p) => p.file, render: (p) => <div><b className="title">{p.title || p.file}</b><div className="sub mono">{p.file}</div></div> },
      { key: 'types', header: 'Structured data found', sort: (p) => p.schema.join(','), csv: (p) => p.schema.join('; '), render: (p) => p.schema.length ? <div className="pills">{p.schema.map((t, i) => <span key={i} className="pill mono">{t}</span>)}</div> : <span className="muted">None</span> },
      { key: 'err', header: 'Valid', sort: (p) => p.schemaErrors.length, csv: (p) => (p.schemaErrors.length ? 'errors' : 'ok'), render: (p) => p.schemaErrors.length ? <span className="sev" style={{ ['--c' as string]: SEV.high.c }}>Cannot be read</span> : <span className="dt-state"><span className="dot" style={{ ['--c' as string]: '#16a34a' }} />OK</span> },
    ]} empty={<EmptyState icon="layers" text="No pages" />} />
    <p className="muted" style={{ fontSize: 12, padding: '0 16px 14px', margin: 0 }}>Read from the built pages: Organization and WebSite on the homepage, breadcrumbs on inner pages. Test a public page with Google’s <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Rich Results Test</a>. Structured data can help search engines understand a page; it does not guarantee rich results.</p>
  </section></>;
}

type OrgForm = { alternateName: string; legalName: string; description: string; email: string; telephone: string; foundingDate: string; sameAs: string[] };
type SchemaSet = { organization: OrgForm; articles: boolean; events: boolean };
type Gen = { kind: 'Article' | 'Event'; file: string; title: string; ld: Record<string, unknown>; check: { errors: string[]; warnings: string[] } };
type SchemaView = { buildSupport: boolean; status: string | null; draft: SchemaSet; published: (SchemaSet & { _revision?: string }) | null; publishedAt: string | null; updatedAt: string | null; updatedByName: string | null; submittedBy: string | null;
  organization: { built: Record<string, unknown> | null; preview: Record<string, unknown> | null }; generated: Gen[] };
const ORG_FIELDS: [keyof Omit<OrgForm, 'sameAs'>, string, string, number][] = [
  ['alternateName', 'Short name', 'e.g. AFCD', 60], ['legalName', 'Legal name', 'Registered name of the association', 160], ['email', 'Public email', 'contact@…', 120],
  ['telephone', 'Public phone', '+212 …', 24], ['foundingDate', 'Founded (year)', '2007', 4]];

function SchemaStudio() {
  const toast = useToast(); const can = useCan(); const me = useMe();
  const [v, setV] = useState<SchemaView | null>(null); const [f, setF] = useState<SchemaSet | null>(null); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'changes' | 'publish' | 'unpublish' | null>(null); const [comment, setComment] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const take = (x: SchemaView) => { setV(x); setF(structuredClone(x.draft)); };
  useEffect(() => { api<SchemaView>('/seo/schema').then(take).catch((e) => toast(e.message, true)); }, []);
  if (!v || !f) return <section className="card" style={{ marginBottom: 16 }}><Loading /></section>;
  const status = v.status ?? 'draft'; const editable = can('seo.update') && !['in_review', 'approved'].includes(status);
  const dirty = JSON.stringify(f) !== JSON.stringify(v.draft); const live = !!v.published?._revision;
  const fail = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? (e.details as { path: string; message: string }[]).map((d) => d.message) : [(e as Error).message]);
  async function run(label: string, fn: () => Promise<unknown>, done: string) { setBusy(label); setErrs([]); try { await fn(); setDialog(null); setComment(''); toast(done); } catch (e) { setDialog(null); fail(e); } finally { setBusy(''); } }
  const clean = () => ({ ...f, organization: { ...f.organization, sameAs: f.organization.sameAs.filter(Boolean) } });
  const save = () => run('save', async () => take(await put<SchemaView>('/seo/schema', clean())), 'Draft saved. Nothing changes on the site until it is reviewed and published.');
  const act = (action: string, done: string) => run(action, async () => { if (dirty) take(await put<SchemaView>('/seo/schema', clean())); take(await post<SchemaView>('/seo/schema/transition', { action, comment })); }, done);
  const deliver = (kind: 'publish' | 'unpublish') => run(kind, async () => { await post(`/seo/schema/${kind}`); take(await api<SchemaView>('/seo/schema')); },
    kind === 'publish' ? 'Published and verified on the website' : 'Removed. The homepage shows the markup written in the website’s build again.');
  const org = f.organization; const setOrg = (k: keyof OrgForm, val: unknown) => setF({ ...f, organization: { ...org, [k]: val } });
  const genBad = v.generated.filter((g) => g.check.errors.length).length;
  return <section className="card sch" style={{ marginBottom: 16 }}>
    <div className="card-h">
      <div><h2 style={{ margin: 0, fontSize: 15 }}>Schema studio</h2><p className="muted" style={{ margin: '2px 0 0', fontSize: 12.5 }}>Reviewed structured data for the public site. Changes go live only after review and publishing.</p></div>
      <div className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} />{v.updatedAt && <span className="muted" style={{ fontSize: 12 }}>Edited {ago(v.updatedAt)}{v.updatedByName ? ` by ${v.updatedByName}` : ''}</span>}</div>
    </div>
    {errs.length > 0 && <div className="notice n-bad" style={{ margin: '0 16px 12px' }}><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
    {!v.buildSupport && <div className="notice n-info" style={{ margin: '0 16px 12px' }}><div><b>Publishing is not available yet.</b> The website build (build.mjs) does not read Studio’s structured data file yet. You can edit, review and approve settings now; they can be published once the build is connected.</div></div>}
    {status === 'changes_requested' && <div className="notice n-warn" style={{ margin: '0 16px 12px' }}><div>A reviewer asked for changes. Update the settings, then send them for review again.</div></div>}
    <div className="sch-grid">
      <fieldset className="sch-form" disabled={!editable}>
        <h3>Organization profile <small className="muted">homepage · NGO</small></h3>
        <p className="muted sch-help">Leave a field empty to keep what the website already says. Only public contact details belong here: tax identifiers, CNSS numbers and internal registration records are never published.</p>
        <div className="sch-fields">
          {ORG_FIELDS.map(([k, l, ph, max]) => <label key={k} className="field"><span>{l}</span><input className="input" maxLength={max} placeholder={String(v.organization.built?.[k] ?? ph)} value={org[k]} onChange={(e) => setOrg(k, e.target.value)} /></label>)}
          <label className="field s2"><span>Description <em className={org.description.length > 290 ? 'near' : ''} style={{ fontStyle: 'normal', float: 'right', fontSize: 11.5 }}>{org.description.length} / 320</em></span>
            <textarea className="textarea" maxLength={320} placeholder={String(v.organization.built?.description ?? '')} value={org.description} onChange={(e) => setOrg('description', e.target.value.replace(/\n/g, ' '))} /></label>
          <label className="field s2"><span>Official profiles (sameAs)</span>
            <textarea className="textarea mono" rows={3} placeholder={((v.organization.built?.sameAs as string[] | undefined) ?? []).join('\n')} value={org.sameAs.join('\n')} onChange={(e) => setOrg('sameAs', e.target.value.split('\n').map((x) => x.trim()).filter((x, i, arr) => x || i === arr.length - 1))} />
            <small>One https:// address per line: the foundation’s own social and directory pages.</small></label>
        </div>
        <h3 style={{ marginTop: 18 }}>Generated markup</h3>
        <label className="check"><input type="checkbox" checked={f.articles} onChange={(e) => setF({ ...f, articles: e.target.checked })} /> <span><b>Article</b> on each published story page</span></label>
        <label className="check"><input type="checkbox" checked={f.events} onChange={(e) => setF({ ...f, events: e.target.checked })} /> <span><b>Event</b> on each published event page</span></label>
      </fieldset>
      <div className="sch-prev">
        <div className="between"><b style={{ fontSize: 13 }}>Homepage preview</b><span className="muted" style={{ fontSize: 11.5 }}>current build + this draft</span></div>
        {v.organization.preview ? <pre className="sch-json">{JSON.stringify(v.organization.preview, (k, val) => (k === '' ? val : val), 2).replace(/\n$/, '')}</pre> : <p className="muted">Build the website once to see the homepage markup.</p>}
        {dirty && <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>Save to refresh the preview.</p>}
      </div>
    </div>
    <div className="sch-gen">
      <div className="between" style={{ padding: '0 16px 8px' }}><b style={{ fontSize: 13 }}>Markup for published stories and events · {v.generated.length}</b>{genBad > 0 && <span className="sev" style={{ ['--c' as string]: SEV.high.c }}>{genBad} left out until fixed</span>}</div>
      {v.generated.length === 0 ? <p className="muted" style={{ padding: '0 16px 12px', margin: 0, fontSize: 12.5 }}>No stories or events are published through Studio yet. Markup appears here when they are.</p>
        : <ul className="sch-list">{v.generated.map((g) => <li key={g.file}>
          <button className="sch-row" onClick={() => setOpen(open === g.file ? null : g.file)} aria-expanded={open === g.file}>
            <span className="pill mono">{g.kind}</span><span className="min-w-0"><b>{g.title}</b><small className="mono">{g.file}</small></span>
            <span className="dt-state">{g.check.errors.length ? <><span className="dot" style={{ ['--c' as string]: '#dc2626' }} />{g.check.errors[0]}</> : g.check.warnings.length ? <><span className="dot" style={{ ['--c' as string]: '#d97706' }} />{g.check.warnings[0]}</> : <><span className="dot" style={{ ['--c' as string]: '#16a34a' }} />Valid</>}</span>
            {((g.kind === 'Article' && !f.articles) || (g.kind === 'Event' && !f.events)) && <span className="muted" style={{ fontSize: 11.5 }}>switched off</span>}
          </button>
          {open === g.file && <pre className="sch-json">{JSON.stringify(g.ld, null, 2)}</pre>}
        </li>)}</ul>}
    </div>
    <div className="sch-actions">
      <span className="muted" style={{ fontSize: 12 }}>{live ? `Live since ${fmtDate(v.publishedAt!)}` : 'Not on the website yet: the site shows the markup written in its build.'}</span>
      <span style={{ flex: 1 }} />
      {editable && <button className="btn" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
      {editable && can('seo.update') && (status === 'draft' || status === 'changes_requested' || status === 'published') && <button className="btn btn-primary" disabled={!!busy || (!dirty && (status === 'published' || !v.status))} onClick={() => act('submit', 'Sent for review')}>Submit for review</button>}
      {status === 'in_review' && can('seo.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}>Withdraw</button>}
      {status === 'in_review' && can('seo.approve') && <><button className="btn" disabled={!!busy} onClick={() => setDialog('changes')}>Request changes</button>
        <button className="btn btn-primary" disabled={!!busy || (v.submittedBy === me.user.id && me.user.role !== 'super_admin')} title={v.submittedBy === me.user.id && me.user.role !== 'super_admin' ? 'Someone other than the author must review' : undefined} onClick={() => act('approve', 'Approved')}>Approve</button></>}
      {status === 'approved' && can('seo.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}>Withdraw</button>}
      {status === 'approved' && can('seo.publish') && <button className="btn btn-primary" disabled={!!busy || !v.buildSupport} title={v.buildSupport ? undefined : 'The website build does not read structured data from Studio yet'} onClick={() => setDialog('publish')}><Icon n="globe" />Publish</button>}
      {live && can('seo.publish') && <button className="btn btn-ghost" disabled={!!busy} onClick={() => setDialog('unpublish')}>Remove from site</button>}
    </div>
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', 'Changes requested')}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish structured data" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'publish'} onClick={() => deliver('publish')}>{busy === 'publish' ? 'Publishing and verifying…' : 'Publish to the website'}</button></>}>
      <div className="modal-b"><p style={{ marginTop: 0 }}>The website is rebuilt with these settings and every page is checked before it is recorded. If anything fails, the site is restored.</p>{genBad > 0 && <p className="muted">{genBad} item{genBad === 1 ? '' : 's'} with errors will be left out.</p>}</div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove Studio’s structured data" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'unpublish'} onClick={() => deliver('unpublish')}>{busy === 'unpublish' ? 'Removing…' : 'Remove'}</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>The homepage goes back to the organization markup written in the website’s build, and story and event pages lose their generated markup. The draft stays in Studio.</p></div></Modal>}
  </section>;
}

// ---------------------------------------------------------------- Redirects
type Redirect = { id: string; source: string; destination: string; code: number; reason: string; status: 'draft' | 'active' | 'disabled'; published: { source: string; destination: string; code: number } | null; publishedAt: string | null; updatedAt: string; updatedByName: string | null; live: boolean; pending: null | 'new' | 'edited' | 'removal' };
type RForm = { source: string; destination: string; code: number; reason: string };
const CODES: [number, string][] = [[301, '301 · Moved permanently'], [302, '302 · Moved temporarily'], [308, '308 · Permanent (keeps form data)'], [307, '307 · Temporary (keeps form data)']];
const rState = (r: Redirect): [string, string] => r.pending === 'new' ? ['Not live yet', '#d97706'] : r.pending === 'edited' ? ['Edited, live version differs', '#d97706'] : r.pending === 'removal' ? ['Will be removed', '#dc2626'] : r.status === 'disabled' ? ['Disabled', '#a8a29e'] : r.live ? ['Live', '#16a34a'] : ['Published, page missing', '#dc2626'];

function Redirects() {
  const toast = useToast(); const can = useCan();
  const [rows, setRows] = useState<Redirect[] | null>(null); const [q, setQ] = useState(''); const [f, setF] = useState('all');
  const [edit, setEdit] = useState<{ id?: string; form: RForm } | null>(null); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState('');
  const load = useCallback(() => api<Redirect[]>('/seo/redirects').then(setRows).catch((e) => toast(e.message, true)), []);
  useEffect(() => { load(); }, [load]);
  const pending = (rows ?? []).filter((r) => r.pending);
  const match = (r: Redirect) => (f === 'all' || (f === 'live' ? r.live && !r.pending : f === 'pending' ? !!r.pending : r.status === 'disabled')) && (!q || `${r.source} ${r.destination} ${r.reason}`.toLowerCase().includes(q.toLowerCase()));
  async function act(r: Redirect, kind: 'disable' | 'enable' | 'delete') {
    setBusy(r.id);
    try { kind === 'delete' ? await api(`/seo/redirects/${r.id}`, { method: 'DELETE' }) : await post(`/seo/redirects/${r.id}/${kind}`); await load();
      toast(kind === 'delete' ? 'Redirect deleted' : kind === 'disable' ? (r.published ? 'Disabled. It leaves the site when redirects are published.' : 'Disabled') : 'Enabled again. It goes live when redirects are published.'); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(''); }
  }
  async function publish() {
    setBusy('publish');
    try { const r = await post<{ live: number; removed: number }>('/seo/redirects/publish'); setConfirm(false); await load(); toast(`Published and verified: ${r.live} redirect${r.live === 1 ? '' : 's'} live${r.removed ? `, ${r.removed} removed` : ''}`); }
    catch (e) { setConfirm(false); toast(e instanceof ApiError && e.details?.length ? (e.details as { message: string }[]).map((d) => d.message).join(' ') : (e as Error).message, true); } finally { setBusy(''); }
  }
  if (!rows) return <Loading />;
  return <section className="card">
    <div className="card-h">
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>Send visitors and search engines from an old address to its new page. The site is static, so each redirect is a small page at the old address that forwards at once and names the new page as canonical; Studio also writes a <span className="mono">_redirects</span> file with the real status code for hosts that support it.</p>
      <div className="pills">
        {can('seo.update') && <button className="btn" onClick={() => setEdit({ form: { source: '', destination: '', code: 301, reason: '' } })}><Icon n="plus" />New redirect</button>}
        {can('seo.publish') ? <button className="btn btn-primary" disabled={!pending.length} onClick={() => setConfirm(true)}><Icon n="globe" />Publish changes{pending.length ? ` (${pending.length})` : ''}</button>
          : pending.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>{pending.length} change{pending.length === 1 ? '' : 's'} waiting for an administrator to publish</span>}
      </div>
    </div>
    <ListToolbar tabs={[['all', 'All', rows.length], ['live', 'Live', rows.filter((r) => r.live && !r.pending).length], ['pending', 'Waiting to publish', pending.length], ['disabled', 'Disabled', rows.filter((r) => r.status === 'disabled').length]]} value={f} onChange={setF} q={q} setQ={setQ} placeholder="Search redirects" />
    <DataTable id="seo-redirects" rows={rows.filter(match)} total={rows.length} rowKey={(r) => r.id} csvName="afcd-redirects" onOpen={can('seo.update') ? (r) => setEdit({ id: r.id, form: { source: r.source, destination: r.destination, code: r.code, reason: r.reason } }) : undefined} columns={[
      { key: 'from', header: 'Old address', sort: (r) => r.source, csv: (r) => r.source, render: (r) => <div><b className="title mono">/{r.source}</b>{r.reason && <div className="sub">{r.reason}</div>}</div> },
      { key: 'to', header: 'Goes to', sort: (r) => r.destination, csv: (r) => r.destination, render: (r) => <div><span className="mono">{/^https:/.test(r.destination) ? r.destination : `/${r.destination}`}</span>{r.pending === 'edited' && r.published && <div className="sub">Live: /{r.published.source} → {r.published.destination}</div>}</div> },
      { key: 'code', header: 'Type', sort: (r) => r.code, csv: (r) => String(r.code), hideBelow: 900, render: (r) => <span className="pill mono">{r.code}</span> },
      { key: 'state', header: 'Status', sort: (r) => rState(r)[0], csv: (r) => rState(r)[0], render: (r) => { const [l, c] = rState(r); return <span className="dt-state"><span className="dot" style={{ ['--c' as string]: c }} />{l}</span>; } },
      { key: 'by', header: 'Updated', sort: (r) => r.updatedAt, csv: (r) => r.updatedAt, hideBelow: 1100, render: (r) => <span className="sub">{ago(r.updatedAt)}{r.updatedByName ? ` · ${r.updatedByName}` : ''}</span> },
      { key: 'act', header: '', align: 'right', render: (r) => can('seo.update') ? <div className="pills" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
        {r.status === 'disabled' ? <button className="btn btn-sm" disabled={busy === r.id} onClick={() => act(r, 'enable')}>Enable</button> : <button className="btn btn-sm" disabled={busy === r.id} onClick={() => act(r, 'disable')}>Disable</button>}
        {!r.published && <button className="btn btn-sm btn-ghost" disabled={busy === r.id} onClick={() => act(r, 'delete')} aria-label={`Delete redirect ${r.source}`}><Icon n="x" /></button>}
      </div> : null },
    ]} empty={<EmptyState icon="globe" text={rows.length ? 'No redirects here' : 'No redirects yet. Add one when a page moves or is renamed.'} />} />
    {edit && <RedirectDialog init={edit} onClose={() => setEdit(null)} onSaved={(w) => { setEdit(null); load(); toast(w.length ? `Saved with a note: ${w[0]}` : 'Saved. It goes live when redirects are published.'); }} />}
    {confirm && <Modal size="sm" title="Publish redirect changes" onClose={() => setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'publish'} onClick={publish}>{busy === 'publish' ? 'Publishing and verifying…' : 'Publish to the website'}</button></>}>
      <div className="modal-b"><p style={{ marginTop: 0 }}>The website is rebuilt and each change is checked before it is recorded. If anything fails, the site is restored.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{pending.map((r) => <li key={r.id}><span className="mono">/{r.source}</span> {r.pending === 'removal' ? 'is removed' : <>→ <span className="mono">{r.destination}</span>{r.pending === 'edited' ? ' (edited)' : ''}</>}</li>)}</ul></div>
    </Modal>}
  </section>;
}

function RedirectDialog({ init, onClose, onSaved }: { init: { id?: string; form: RForm }; onClose: () => void; onSaved: (warnings: string[]) => void }) {
  const [f, setF] = useState<RForm>(init.form); const [chk, setChk] = useState<{ errors: string[]; warnings: string[] } | null>(null); const [saving, setSaving] = useState(false); const [err, setErr] = useState<string[]>([]);
  useEffect(() => {
    if (!f.source.trim() || !f.destination.trim()) { setChk(null); return; }
    const t = setTimeout(() => { post<{ errors: string[]; warnings: string[] }>(`/seo/redirects/check${init.id ? `?id=${init.id}` : ''}`, f).then(setChk).catch(() => setChk(null)); }, 300);
    return () => clearTimeout(t);
  }, [f]);
  async function save() {
    setSaving(true); setErr([]);
    try { const r = init.id ? await put<{ warnings: string[] }>(`/seo/redirects/${init.id}`, f) : await post<{ warnings: string[] }>('/seo/redirects', f); onSaved(r.warnings ?? []); }
    catch (e) { setErr(e instanceof ApiError && e.details?.length ? (e.details as { message: string }[]).map((d) => d.message) : [(e as Error).message]); } finally { setSaving(false); }
  }
  const blocked = !!chk?.errors.length || !f.source.trim() || !f.destination.trim();
  return <Modal size="sm" title={init.id ? 'Edit redirect' : 'New redirect'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={blocked || saving} onClick={save}>{saving ? 'Saving…' : 'Save as draft'}</button></>}>
    <div className="modal-b stack">
      <label className="field"><span>Old address</span><input className="input mono" autoFocus placeholder="old-page.html" maxLength={160} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /><small>The address that no longer has a page. Exact match, no wildcards.</small></label>
      <label className="field"><span>Goes to</span><input className="input mono" placeholder="projects.html" maxLength={500} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /><small>A page of this site, or a full https:// address (administrators only).</small></label>
      <label className="field"><span>Type</span><select className="select" value={f.code} onChange={(e) => setF({ ...f, code: Number(e.target.value) })}>{CODES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select><small>Used by hosts that read _redirects. On GitHub Pages every redirect forwards instantly through its redirect page.</small></label>
      <label className="field"><span>Reason <em className="muted" style={{ fontStyle: 'normal' }}>(optional, internal)</em></span><input className="input" maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Page renamed in the 2026 redesign" /></label>
      {[...err, ...(chk?.errors ?? [])].length > 0 && <div className="notice n-bad"><div><ul style={{ margin: 0, paddingLeft: 16 }}>{[...new Set([...err, ...(chk?.errors ?? [])])].map((m) => <li key={m}>{m}</li>)}</ul></div></div>}
      {!!chk?.warnings.length && <div className="notice n-info"><div><ul style={{ margin: 0, paddingLeft: 16 }}>{chk.warnings.map((m) => <li key={m}>{m}</li>)}</ul></div></div>}
      {chk && !chk.errors.length && !chk.warnings.length && <div className="notice n-ok"><div>Checked: the new page exists and nothing conflicts.</div></div>}
    </div>
  </Modal>;
}

type PageRow = { file: string; defaults: { title: string; description: string; noindex: boolean } | null; override: null | { id: string; status: string; title: string; description: string; noindex: boolean; publishedRevisionId: string | null; updatedAt: string }; orphan?: boolean };
function PagesView() {
  const [rows, setRows] = useState<PageRow[] | null>(null); const [q, setQ] = useState('');
  useEffect(() => { api<PageRow[]>('/seo/pages').then(setRows); }, []);
  const shown = (rows ?? []).filter((r) => !q || `${r.file} ${r.defaults?.title}`.toLowerCase().includes(q.toLowerCase()));
  return <section className="card">
    <div className="card-h"><p className="muted" style={{ margin: 0 }}>The website’s template pages. Projects, stories, events, opportunities and builder pages have SEO fields in their own editors.</p>
      <label className="search"><Icon n="search" /><span className="sr-only">Search pages</span><input className="input" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
    {!rows ? <Loading /> : <div className="scroll-x"><table className="table">
      <thead><tr><th>Page</th><th>Title in search results</th><th>Settings</th></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.file}>
        <td><Link className="title mono" to={`/studio/seo/pages/${r.file}`}>{r.file}</Link>{r.orphan && <div className="sub">Page no longer a template page</div>}</td>
        <td><span>{r.override?.publishedRevisionId && r.override.title ? r.override.title : r.defaults?.title}</span></td>
        <td>{!r.override ? <span className="muted">Page’s own</span> : <div className="pills">{r.override.publishedRevisionId && r.override.status !== 'published' && <LiveBadge />}<Badge s={r.override.status} /></div>}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

type Detail = { file: string; defaults: { title: string; description: string; noindex: boolean }; owner: Owner | null;
  override: null | { id: string; status: string; title: string; description: string; noindex: boolean; imageMediaId: string | null; publishedRevisionId: string | null; publishedAt: string | null };
  media: MediaItem[]; problems: string[]; history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
type Form = { title: string; description: string; noindex: boolean; imageMediaId: string | null };

function SeoEditor({ file }: { file: string }) {
  const site = useSite();
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [d, setD] = useState<Detail | null>(null); const [f, setF] = useState<Form>({ title: '', description: '', noindex: false, imageMediaId: null });
  const [img, setImg] = useState<MediaItem | null>(null); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'image' | 'publish' | 'unpublish' | 'changes'>(null); const [comment, setComment] = useState('');
  const load = useCallback(async () => {
    const x = await api<Detail>(`/seo/pages/${file}`); setD(x);
    setF(x.override ? { title: x.override.title, description: x.override.description, noindex: x.override.noindex, imageMediaId: x.override.imageMediaId } : { title: '', description: '', noindex: false, imageMediaId: null });
    setImg(x.media[0] ?? null); setDirty(false);
  }, [file]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  if (!d) return <Loading />;
  if (d.owner) { const to = EDIT[d.owner.kind]?.(d.owner); return <div className="notice n-info"><div>{file} is managed in Studio ({d.owner.label}). {to ? <Link to={to}>Edit its SEO fields there.</Link> : ''}</div></div>; }
  const o = d.override; const status = o?.status ?? 'draft'; const live = !!o?.publishedRevisionId;
  const editable = can('seo.update') && status !== 'in_review';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const showErr = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? e.details.map((x) => (x.path ? `${x.path}: ` : '') + x.message) : [e instanceof Error ? e.message : 'Something went wrong.']);
  async function save(): Promise<boolean> { setBusy('save'); setErrs([]); try { await put(`/seo/pages/${file}`, f); await load(); toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved'); return true; } catch (e) { showErr(e); return false; } finally { setBusy(''); } }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    const id = (await api<Detail>(`/seo/pages/${file}`)).override?.id; if (!id) return;
    setBusy(action); setErrs([]);
    try { await post(`/seo/overrides/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment(''); toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/seo/overrides/${o!.id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'The page uses its own settings again'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  const title = f.title || d.defaults.title; const desc = f.description || d.defaults.description;
  return <>
    <div className="page-h">
      <div><Link to="/studio/seo/pages" className="muted" style={{ fontSize: 13 }}>← Page settings</Link><h1 className="mono" style={{ fontSize: 22 }}>{file}</h1>
        <p><span className="pills">{live && status !== 'published' && <LiveBadge />}{o ? <Badge s={status} /> : <span className="pill">Page’s own settings</span>}</span>{dirty && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Unsaved</span>}</p></div>
      {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
    </div>
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
    <div className="side-layout">
      <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={!editable}>
        <section className="card stack" style={{ padding: 20 }}>
          <div className="field"><span>Title in search results</span><input className="input" maxLength={70} value={f.title} placeholder={d.defaults.title} onChange={(e) => set('title', e.target.value)} aria-label="Title" /><small>{title.length} / 65 recommended · empty = the page’s own: “{d.defaults.title}”</small></div>
          <div className="field"><span>Meta description</span><textarea className="textarea" maxLength={170} value={f.description} placeholder={d.defaults.description} onChange={(e) => set('description', e.target.value)} aria-label="Meta description" /><small>{desc.length} / 160 recommended · empty = the page’s own</small></div>
          <div className="field"><span>Share image</span>{f.imageMediaId && img ? <div className="thumb" style={{ width: 240 }}><img src={img.url} alt={img.alt} /><button type="button" aria-label="Remove image" onClick={() => set('imageMediaId', null)}>×</button></div> : <small>The site’s default share image is used.</small>}
            <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('image')}><Icon n="image" />{f.imageMediaId ? 'Change' : 'Choose'} image</button><small>Shown when the page is shared on social media or in messaging apps. Landscape (about 1200 × 630) works best.</small></div>
          <label className="check"><input type="checkbox" checked={f.noindex || d.defaults.noindex} disabled={d.defaults.noindex} onChange={(e) => set('noindex', e.target.checked)} /><span><b>Hide from search engines</b><br /><small className="muted">{d.defaults.noindex ? 'This page is already hidden by its own settings.' : 'Adds noindex and removes the page from the sitemap.'}</small></span></label>
        </section>
        <section className="card stack" style={{ padding: 20 }}>
          <small className="muted">Search result preview</small>
          <div className="serp"><div className="serp-url">{site.host} › {file === 'index.html' ? '' : file}</div><div className="serp-title">{title.length > 65 ? title.slice(0, 63) + '…' : title}</div><div className="serp-desc">{desc.length > 160 ? desc.slice(0, 157) + '…' : desc}</div></div>
          <small className="muted">Link preview</small>
          <div className="og-card">{img && f.imageMediaId ? <img src={img.url} alt="" /> : <div className="og-ph">Default share image</div>}<div className="og-body"><small>AFCDFOUNDATION.ORG</small><b>{title}</b><span>{desc}</span></div></div>
        </section>
      </fieldset>
      <section className="card stack side-panel" style={{ padding: 20 }}>
        <dl className="kv"><dt>Website</dt><dd>{live ? `Custom settings live${status !== 'published' ? ' · newer draft' : ''}` : 'Page’s own settings'}</dd>{o?.publishedAt && <><dt>Published</dt><dd>{fmtDate(o.publishedAt)}</dd></>}</dl>
        <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open the page</a>
        {o && d.problems.length > 0 && <div className="notice n-warn"><div><b>Before review</b><ul>{d.problems.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        {!o && <p className="muted" style={{ margin: 0 }}>Change a field and save to start a draft.</p>}
        {o && ['draft', 'changes_requested'].includes(status) && can('seo.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('seo.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('seo.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {o && ['in_review', 'approved'].includes(status) && can('seo.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('seo.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Use the page’s own settings</button>}
        {o && !live && status !== 'in_review' && can('seo.update') && <button className="btn btn-ghost" onClick={async () => { if (confirm('Discard these draft settings? The page keeps its own.')) { try { await post(`/seo/overrides/${o.id}/discard`); await load(); toast('Draft discarded'); } catch (e) { showErr(e); } } }}><Icon n="x" />Discard draft</button>}
        {o && <><small className="muted">History</small>
          <ol className="timeline">{d.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === o.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small></li>)}
            {d.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></>}
      </section>
    </div>
    {dialog === 'image' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setImg(m[0]); set('imageMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish these SEO settings?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{file}</span> with the new title, description and share image, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Go back to the page’s own settings?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Rebuilding…' : 'Use own settings'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The page is rebuilt with its own title and description. Your settings stay here as a draft.</p></div></Modal>}
  </>;
}
