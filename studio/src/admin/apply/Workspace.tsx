// AFCD Apply → one call as a workspace: Overview, Details, Form, Applicants, Reviews and Emails as tabs, so the call
// you are working on stays in view. Each tab is the screen that already does the job; this file only frames them.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Icon, Link, useCan, useMe, useToast } from '../ui.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import { CallBadge, inZone, relative } from './shared.tsx';
import { CallEditor } from './Calls.tsx';
import { CallFormBuilder } from './Forms.tsx';
import { CallApplicants, STAGES, stageCount } from './Applicants.tsx';
import { CallReviews } from './Evaluation.tsx';
import { CallEmails } from './Communications.tsx';
import './workspace.css';

export type CallTab = 'overview' | 'details' | 'form' | 'applicants' | 'reviews' | 'emails';
type Summary = { id: string; reference: string; title: string; status: string; timeZone: string; opensAt: string | null; closesAt: string | null; serverTime: string; problems: string[]; receiptEnabled?: boolean;
  page: null | { file: string; expected: boolean; onSite: boolean; current: boolean; hasForm?: boolean } };
type Counts = { status: Record<string, number>; total: number; drafts: number };
const RELEASED = ['scheduled', 'open', 'paused', 'closed', 'under_evaluation', 'completed'];
const base = (id: string) => `/studio/apply/calls/${id}`;

/** The tab bar under a call's header. Tabs this role cannot use are left out. */
export function CallTabs({ id, tab }: { id: string; tab: CallTab }) {
  const can = useCan();
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { if (can('apply.submission.read')) api<Counts>(`/apply/submissions/counts?call=${id}`).then((c) => setN(c.total)).catch(() => {}); }, [id]);
  const tabs: [CallTab, string, string, boolean][] = [
    ['overview', 'Overview', '', true], ['details', 'Details', '/details', true], ['form', 'Form', '/form', true],
    ['applicants', 'Applicants', '/applicants', can('apply.submission.read')], ['reviews', 'Reviews', '/reviews', can('apply.evaluation.manage')], ['emails', 'Emails', '/emails', can('apply.message')],
  ];
  return <nav className="cw-tabs" aria-label="Call sections">{tabs.filter((t) => t[3]).map(([k, l, p]) =>
    <Link key={k} to={`${base(id)}${p}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>{l}{k === 'applicants' && n !== null && n > 0 && <em>{n}</em>}</Link>)}</nav>;
}

export function CallWorkspace({ id, tab }: { id: string; tab: CallTab }) {
  if (tab === 'details') return <CallEditor key={id} id={id} tabs={<CallTabs id={id} tab="details" />} />;
  if (tab === 'form') return <div className="cw-full"><CallTabs id={id} tab="form" /><CallFormBuilder key={id} callId={id} /></div>;
  return <Framed id={id} tab={tab} />;
}

function Framed({ id, tab }: { id: string; tab: Exclude<CallTab, 'details' | 'form'> }) {
  const me = useMe(); const toast = useToast();
  const [c, setC] = useState<Summary | null>(null);
  useEffect(() => { api<Summary>(`/apply/calls/${id}`).then(setC).catch((e) => toast(e.message, true)); }, [id]);
  if (!c) return <Loading />;
  const now = new Date(c.serverTime).getTime();
  const when = c.status === 'open' || c.status === 'paused' ? (c.closesAt ? `Closes ${inZone(c.closesAt, c.timeZone, false)} · ${relative(c.closesAt, now)}` : '')
    : ['draft', 'changes_requested', 'in_review', 'approved', 'scheduled'].includes(c.status) && c.opensAt ? `Opens ${inZone(c.opensAt, c.timeZone, false)} · ${relative(c.opensAt, now)}`
    : c.closesAt ? `Closed ${inZone(c.closesAt, c.timeZone, false)}` : '';
  const live = c.page?.expected && c.page.current;
  return <>
    <div className="ed-head cw-head">
      <div className="min-w-0">
        <Link to="/studio/apply/calls" className="ed-back"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />Calls</Link>
        <h1>{c.title || 'Untitled call'}</h1>
        <div className="ed-meta"><CallBadge s={c.status} /><span className="mono">{c.reference}</span>{when && <span>{when}</span>}</div>
      </div>
      <div className="ed-actions">{live && <a className="btn" href={`${me.siteUrl}${c.page!.file}`} target="_blank" rel="noopener">View public page <Icon n="ext" width={12} height={12} /></a>}
        <Link className="btn" to={`${base(id)}/details`}>Edit details</Link></div>
    </div>
    <CallTabs id={id} tab={tab} />
    {tab === 'overview' ? <CallOverview c={c} /> : tab === 'applicants' ? <CallApplicants callId={id} /> : tab === 'reviews' ? <CallReviews callId={id} /> : <CallEmails callId={id} />}
  </>;
}

type Check = { label: string; done: boolean; optional?: boolean; note?: string; to: string; go: string };

function CallOverview({ c }: { c: Summary }) {
  const can = useCan();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [form, setForm] = useState<{ published: boolean; changes: boolean } | null>(null);
  const [rubric, setRubric] = useState<boolean | null>(null);
  useEffect(() => {
    if (can('apply.submission.read')) api<Counts>(`/apply/submissions/counts?call=${c.id}`).then(setCounts).catch(() => {});
    api(`/apply/calls/${c.id}/form`).then((f) => setForm({ published: !!f.versions?.length, changes: !!f.unpublishedChanges })).catch(() => {});
    if (can('apply.evaluation.manage')) api(`/apply/calls/${c.id}/rubric`).then((r) => setRubric(!!r.publishedVersionId)).catch(() => {});
  }, [c.id]);
  const checks: Check[] = [
    { label: 'Details complete', done: c.problems.length === 0, note: c.problems.length ? `${c.problems.length} thing${c.problems.length === 1 ? '' : 's'} missing` : undefined, to: '/details', go: 'Details' },
    { label: 'Application form published', done: !!form?.published, note: form?.published && form.changes ? 'Changes not published yet' : undefined, to: '/form', go: 'Form' },
    { label: 'Approved and scheduled', done: RELEASED.includes(c.status), to: '/details', go: 'Details' },
    ...(rubric !== null ? [{ label: 'Scoring rubric published', done: rubric, to: '/reviews?tab=rubric', go: 'Reviews' }] : []),
    ...(can('apply.message') && c.receiptEnabled !== undefined ? [{ label: 'Receipt email to applicants', done: c.receiptEnabled, optional: true, note: c.receiptEnabled ? undefined : 'Off', to: '/emails?tab=send', go: 'Emails' }] : []),
  ];
  const left = checks.filter((x) => !x.done && !x.optional).length;
  const decided = stageCount(counts, ['selected', 'waitlisted', 'not_selected']) ?? 0;
  const pipe = STAGES.filter((s) => !['all', 'withdrawn'].includes(s.key));
  const max = Math.max(1, ...pipe.map((s) => stageCount(counts, s.statuses) ?? 0));
  const tiles: [string, number, string, string][] = counts ? [
    ['Applications', counts.total, '/applicants', counts.status.submitted ? `${counts.status.submitted} not looked at yet` : 'All looked at'],
    ['Drafts', counts.drafts, '', 'Started, not submitted'],
    ['In review', stageCount(counts, ['under_evaluation']) ?? 0, '/applicants?stage=review', 'With reviewers'],
    ['Decided', decided, '/applicants?stage=decision', 'Selected, waitlisted or not selected'],
  ] : [];
  return <div className="cw-grid">
    {tiles.length > 0 && <div className="ap-kpis cw-kpis">{tiles.map(([l, n, to, sub]) => to ? <Link key={l} to={`${base(c.id)}${to}`} className="ap-kpi"><span>{l}</span><b>{n}</b><small>{sub}</small></Link>
      : <div key={l} className="ap-kpi"><span>{l}</span><b>{n}</b><small>{sub}</small></div>)}</div>}
    <section className="card cw-card">
      <header className="ap-h"><h2>Setup</h2><span className="muted">{left ? `${left} step${left === 1 ? '' : 's'} left` : 'Ready'}</span></header>
      <ul className="cw-checks">{checks.map((x) => <li key={x.label} className={x.done ? 'done' : x.optional ? 'opt' : 'todo'}>
        <span className="cw-mark" role="img" aria-label={x.done ? 'Done' : x.optional ? 'Optional' : 'To do'}>{x.done && <Icon n="check" width={12} height={12} />}</span>
        <span><b>{x.label}</b>{x.note && <small>{x.note}</small>}</span><Link to={`${base(c.id)}${x.to}`}>{x.go}</Link></li>)}</ul>
    </section>
    {counts && <section className="card cw-card">
      <header className="ap-h"><h2>Pipeline</h2><Link to={`${base(c.id)}/applicants`} className="btn btn-ghost btn-sm">Open applicants</Link></header>
      {counts.total === 0 ? <p className="muted cw-pad">No applications yet. They appear here as applicants submit.</p> :
        <ul className="cw-pipe">{pipe.map((s) => { const n = stageCount(counts, s.statuses) ?? 0; return <li key={s.key}><Link to={`${base(c.id)}/applicants?stage=${s.key}`}>{s.label}</Link>
          <span className="cw-bar" aria-hidden="true"><span style={{ width: `${Math.round((n / max) * 100)}%` }} /></span><b>{n}</b></li>; })}</ul>}
    </section>}
  </div>;
}

