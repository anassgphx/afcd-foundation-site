// AFCD Apply → Applicants: every application as one pipeline (New → Eligibility → In review → Shortlist → Decision).
// Each stage shows the actions that fit it: the table with status changes, ranking by score, or decisions to approve.
// The same screen is a call's Applicants tab, with the call fixed. Counts come from the server only.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Link, useCan } from '../ui.tsx';
import { useUrlState } from '../DataTable.tsx';
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

export function ApplicantsPage() {
  const [st, set] = useUrlState({ call: '', stage: 'all', q: '', eligibility: '' });
  const [calls, setCalls] = useState<{ id: string; reference: string; title: string; status: string }[]>([]);
  useEffect(() => { api('/apply/calls').then((r) => setCalls(r.filter((x: { status: string }) => !['draft', 'in_review', 'changes_requested', 'approved'].includes(x.status)))).catch(() => {}); }, []);
  return <>
    <div className="page-h"><div><h1>Applicants</h1><p>Every application, from the moment it arrives to its result. This is personal data: open only what you need.</p></div>
      <select className="select pl-call" value={st.call} onChange={(e) => set('call', e.target.value)} aria-label="Call"><option value="">All calls</option>{calls.map((c) => <option key={c.id} value={c.id}>{c.reference} · {c.title}</option>)}</select></div>
    <Pipeline call={st.call} stage={st.stage} setStage={(v) => set('stage', v)} q={st.q} setQ={(v) => set('q', v)} eligibility={st.eligibility} setEligibility={(v) => set('eligibility', v)} />
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
        return <button key={s.key} type="button" className={`pl-stage${on ? ' on' : ''}`} aria-current={on ? 'step' : undefined} onClick={() => setStage(s.key)}>
          <small>{s.key === 'all' ? 'Everything' : s.key === 'withdrawn' ? 'Finished' : `Step ${i}`}</small><span><b>{s.label}</b><em>{n ?? '·'}</em></span></button>; })}
    </nav>
    {!ranked && !decisions && <div className="pl-tools">
      <input className="input" type="search" placeholder="Reference, name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search applications" />
      <select className="select" value={eligibility} onChange={(e) => setEligibility(e.target.value)} aria-label="Eligibility"><option value="">Any eligibility</option>{Object.entries(ELIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {counts && counts.drafts > 0 && <small className="muted">{counts.drafts} draft{counts.drafts === 1 ? '' : 's'} started, not submitted yet</small>}
    </div>}
    {ranked || decisions ? <>
      <div className="pl-hint pl-hint-card">{stage.hint}{stage.key === 'review' && can('apply.evaluation.manage') && <> <Link to={`/studio/apply/calls/${call}/reviews`}>Assign reviewers</Link></>}</div>
      {decisions ? <DecisionStage key={`${call}:${gen}`} callId={call} onChanged={changed} /> : <ShortlistStage key={`${call}:${stage.key}`} callId={call} stages={stage.statuses} onChanged={changed} />}
    </> : <SubmissionsTable call={call} onChanged={changed} status={stage.statuses.join(',')} eligibility={eligibility} q={q}
      hint={<>{stage.hint}{!call && ['review', 'shortlist', 'decision'].includes(stage.key) && !fixed && ' Choose a call above to rank by score and decide.'}</>} />}
  </>;
}
