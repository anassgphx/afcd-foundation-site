// AFCD Apply → Applicants: a table of calls with how many people applied to each. A call's Applicants tab holds the
// pipeline (New → Eligibility → In review → Shortlist → Decision), where each stage shows the actions that fit it.
// Counts come from the server only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApplicationDrawer } from './Drawer.tsx';
import { api } from '../api.ts';
import { Link, navigate, useCan, useToast } from '../ui.tsx';
import { DataTable, EmptyState, ListToolbar, TableSkeleton, useUrlState, type Column } from '../DataTable.tsx';
import { CallBadge, inZone } from './shared.tsx';
import { ELIG, SubmissionsTable } from './Submissions.tsx';
import { ShortlistStage, DecisionStage } from './Selection.tsx';
import './submissions.css';

export const STAGES: { key: string; label: string; statuses: string[]; hint: string }[] = [
  { key: 'all', label: 'All', statuses: [], hint: 'Every application, newest first.' },
  { key: 'new', label: 'New', statuses: ['submitted'], hint: 'Arrived and not looked at yet. Check eligibility, or send eligible ones to review.' },
  { key: 'eligibility', label: 'Eligibility', statuses: ['eligibility_review'], hint: 'Being checked against the call’s conditions. Correct the automatic result on the application if needed.' },
  { key: 'review', label: 'In review', statuses: ['under_evaluation'], hint: 'With reviewers, ranked by their mean score. Shortlist the strongest when the scores are in.' },
  { key: 'shortlist', label: 'Shortlist', statuses: ['shortlisted', 'interview'], hint: 'Ranked by score. Invite people to interview, or propose a result for someone else to approve.' },
  { key: 'decision', label: 'Decision', statuses: ['selected', 'waitlisted', 'not_selected'], hint: 'Results are proposed by one person and approved by another. Applicants are emailed only after approval.' },
  { key: 'withdrawn', label: 'Withdrawn', statuses: ['withdrawn'], hint: 'Withdrawn applications. Nothing to do here.' },
];
type Counts = { status: Record<string, number>; total: number; drafts: number };
export const stageCount = (c: Counts | null, statuses: string[]) => (!c ? null : statuses.length ? statuses.reduce((n, s) => n + (c.status[s] ?? 0), 0) : c.total);

type CallRow = { id: string; reference: string; title: string; status: string; closesAt: string | null; timeZone: string; projectName: string | null; pillarName: string | null };
type ByCall = Record<string, Counts>;
const sum = (c: Counts | undefined, st: string[]) => (c ? st.reduce((n, s) => n + (c.status[s] ?? 0), 0) : 0);
const TABS: [string, string, (r: CallRow) => boolean][] = [
  ['all', 'All', () => true], ['open', 'Open', (r) => r.status === 'open' || r.status === 'paused'], ['closed', 'Closed', (r) => ['closed', 'under_evaluation', 'completed'].includes(r.status)],
];

/** Applicants: one row per call with how many people applied and where they are. A row opens that call's applicants. */
export function ApplicantsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<CallRow[] | null>(null); const [by, setBy] = useState<ByCall>({});
  const [st, set] = useUrlState({ status: 'all', q: '' });
  useEffect(() => {
    Promise.all([api<CallRow[]>('/apply/calls'), api<ByCall>('/apply/submissions/by-call')])
      // calls that can receive applications, and any call that already has some
      .then(([calls, counts]) => { setBy(counts); setRows(calls.filter((c) => counts[c.id] || ['scheduled', 'open', 'paused', 'closed', 'under_evaluation', 'completed'].includes(c.status))); })
      .catch((e) => { setRows([]); toast((e as Error).message, true); });
  }, []);
  const base = (rows ?? []).filter((r) => !st.q || `${r.title} ${r.reference} ${r.projectName ?? ''}`.toLowerCase().includes(st.q.toLowerCase()));
  const tab = TABS.some((t) => t[0] === st.status) ? st.status : 'all';
  const shown = base.filter(TABS.find((t) => t[0] === tab)![2]);
  const num = (n: number, strong = false) => <span className={`ac-n${n ? '' : ' zero'}${strong && n ? ' strong' : ''}`}>{n}</span>;
  const columns: Column<CallRow>[] = [
    { key: 'call', header: 'Call', sort: (r) => r.title, render: (r) => <div className="dt-main"><span className="min-w-0"><Link className="title" to={`/studio/apply/calls/${r.id}/applicants`}>{r.title}</Link>
      <span className="sub"><span className="mono">{r.reference}</span>{r.projectName ? ` · ${r.projectName}` : r.pillarName ? ` · ${r.pillarName}` : ''}</span></span></div> },
    { key: 'status', header: 'Status', hideBelow: 700, sort: (r) => r.status, render: (r) => <CallBadge s={r.status} /> },
    { key: 'deadline', header: 'Deadline', hideBelow: 1000, sort: (r) => r.closesAt ?? '9999', render: (r) => <span className="sub ap-nowrap">{r.closesAt ? inZone(r.closesAt, r.timeZone, false) : '—'}</span> },
    { key: 'total', header: 'Applicants', align: 'right', sort: (r) => -(by[r.id]?.total ?? 0), render: (r) => <b className="ac-total">{by[r.id]?.total ?? 0}</b> },
    { key: 'new', header: 'New', align: 'right', sort: (r) => -sum(by[r.id], ['submitted']), render: (r) => num(sum(by[r.id], ['submitted']), true) },
    { key: 'review', header: 'In review', align: 'right', hideBelow: 800, sort: (r) => -sum(by[r.id], ['eligibility_review', 'under_evaluation', 'shortlisted', 'interview']), render: (r) => num(sum(by[r.id], ['eligibility_review', 'under_evaluation', 'shortlisted', 'interview'])) },
    { key: 'selected', header: 'Selected', align: 'right', hideBelow: 900, sort: (r) => -sum(by[r.id], ['selected']), render: (r) => num(sum(by[r.id], ['selected'])) },
    { key: 'drafts', header: 'Drafts', align: 'right', hideBelow: 1100, sort: (r) => -(by[r.id]?.drafts ?? 0), render: (r) => num(by[r.id]?.drafts ?? 0) },
  ];
  return <>
    <div className="page-h"><div><h1>Applicants</h1><p>How many people applied to each call. Open a call to see its applicants.</p></div></div>
    <section className="card">
      <ListToolbar tabs={TABS.map(([k, l, f]) => [k, l, base.filter(f).length])} value={tab} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search calls or projects" />
      {!rows ? <TableSkeleton /> : <DataTable id="apply-applicants" rows={shown} total={base.length} rowKey={(r) => r.id} columns={columns} initialSort={{ key: 'total', dir: 'asc' }}
        onOpen={(r) => navigate(`/studio/apply/calls/${r.id}/applicants`)}
        empty={<EmptyState icon="users" text={rows.length ? 'No calls match' : 'No applications yet'} sub={rows.length ? undefined : 'Calls appear here once they are scheduled or open.'}
          onClear={st.q || tab !== 'all' ? () => { set('q', ''); set('status', 'all'); } : undefined} />} />}
    </section>
  </>;
}

/** A call's Applicants tab. */
export function CallApplicants({ callId }: { callId: string }) {
  const [st, set] = useUrlState({ stage: 'all', q: '', eligibility: '' });
  return <Pipeline call={callId} fixed stage={st.stage} setStage={(v) => set('stage', v)} q={st.q} setQ={(v) => set('q', v)} eligibility={st.eligibility} setEligibility={(v) => set('eligibility', v)} />;
}

function Pipeline({ call, fixed, stage: key, setStage, q, setQ, eligibility, setEligibility }: { call: string; fixed?: boolean; stage: string; setStage: (v: string) => void; q: string; setQ: (v: string) => void; eligibility: string; setEligibility: (v: string) => void }) {
  const can = useCan();
  const [counts, setCounts] = useState<Counts | null>(null); const [search, setSearch] = useState(q); const [gen, setGen] = useState(0);
  // the application drawer: ?app=<id> in the address, so it can be linked to, and Back closes it
  const [app, setApp] = useState(() => new URLSearchParams(location.search).get('app') ?? '');
  const [ids, setIds] = useState<string[]>([]); const pushed = useRef(false);
  useEffect(() => { const f = () => setApp(new URLSearchParams(location.search).get('app') ?? ''); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []);
  const openApp = (id: string) => { const u = new URL(location.href); u.searchParams.set('app', id); if (!app) { history.pushState(history.state, '', u); pushed.current = true; } else history.replaceState(history.state, '', u); setApp(id); };
  const closeApp = () => { if (pushed.current) { pushed.current = false; history.back(); } else { const u = new URL(location.href); u.searchParams.delete('app'); history.replaceState(history.state, '', u); } setApp(''); };
  const loadCounts = useCallback(() => { api<Counts>(`/apply/submissions/counts${call ? `?call=${call}` : ''}`).then(setCounts).catch(() => setCounts(null)); }, [call]);
  useEffect(() => { loadCounts(); }, [loadCounts, gen]);
  useEffect(() => { const h = setTimeout(() => { if (search !== q) setQ(search); }, 350); return () => clearTimeout(h); }, [search]);
  const stage = STAGES.find((s) => s.key === key) ?? STAGES[0];
  // ranking and decisions belong to one call; across calls these stages are a plain list
  const ranked = !!call && ['review', 'shortlist'].includes(stage.key);
  const decisions = !!call && stage.key === 'decision';
  const changed = () => setGen((g) => g + 1);
  return <>
    <nav className="pl-stages" aria-label="Pipeline stages">
      {STAGES.map((s, i) => { const n = stageCount(counts, s.statuses); const on = s.key === stage.key;
        return <button key={s.key} type="button" className={`pl-stage s-${s.key}${on ? ' on' : ''}`} aria-current={on ? 'step' : undefined} onClick={() => setStage(s.key)}>
          <small>{s.key === 'all' ? 'Everything' : s.key === 'withdrawn' ? 'Finished' : `Step ${i}`}</small><span><b>{s.label}</b><em>{n ?? '·'}</em></span></button>; })}
    </nav>
    {!ranked && !decisions && <div className="pl-tools">
      <input className="input" type="search" placeholder="Reference, name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search applications" />
      <select className="select" value={eligibility} onChange={(e) => setEligibility(e.target.value)} aria-label="Eligibility"><option value="">Any eligibility</option>{Object.entries(ELIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {counts && counts.drafts > 0 && <small className="muted">{counts.drafts} draft{counts.drafts === 1 ? '' : 's'} started, not submitted yet</small>}
    </div>}
    {ranked || decisions ? <>
      <div className="pl-hint pl-hint-card">{stage.hint}{stage.key === 'review' && can('apply.evaluation.manage') && <> <Link to={`/studio/apply/calls/${call}/reviews`}>Assign reviewers</Link></>}</div>
      {decisions ? <DecisionStage key={call} callId={call} onChanged={changed} onOpen={openApp} onRows={setIds} reloadKey={gen} /> : <ShortlistStage key={`${call}:${stage.key}`} callId={call} stages={stage.statuses} onChanged={changed} onOpen={openApp} onRows={setIds} reloadKey={gen} />}
    </> : <SubmissionsTable call={call} onChanged={changed} onOpen={openApp} onRows={setIds} reloadKey={gen} status={stage.statuses.join(',')} eligibility={eligibility} q={q}
      hint={<>{stage.hint}{!call && ['review', 'shortlist', 'decision'].includes(stage.key) && !fixed && ' Choose a call above to rank by score and decide.'}</>} />}
    {app && <ApplicationDrawer key="drawer" id={app} ids={ids.includes(app) ? ids : [app]} onClose={closeApp} onNav={openApp} onChanged={changed} />}
  </>;
}
