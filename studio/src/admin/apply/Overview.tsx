// AFCD Apply → Overview. Only real numbers from the server. Application counts (received, drafts, reviews, decisions)
// join this page when calls accept applications; until then it does not show empty or invented figures.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Icon, Link, ago, useCan } from '../ui.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import { CallBadge, CALL_STATUS, inZone, relative } from './shared.tsx';
const ELIG: Record<string, string> = { eligible: 'Eligible', needs_review: 'Needs review', ineligible: 'Ineligible', not_assessed: 'Not assessed' };

type Mini = { id: string; reference: string; title: string; status: string; opensAt: string | null; closesAt: string | null; timeZone: string };
type Data = {
  kpis: { open: number; paused: number; scheduled: number; inReview: number; closingThisWeek: number; underEvaluation: number; drafts: number; total: number };
  deadlines: Mini[]; openings: Mini[]; waiting: Mini[]; serverTime: string;
  applications: { total: number; drafts: number; status: Record<string, number>; eligibility: Record<string, number> };
  outbox: null | { queued: number; failed: number; sent: number; ready: boolean };
  recent: null | { id: string; reference: string; applicantName: string; callTitle: string; status: string; eligibility: string; overridden: boolean; submittedAt: string }[];
  activity: { id: string; callId: string; reference: string; title: string; kind: string; fromStatus: string | null; toStatus: string | null; createdAt: string; actorName: string | null }[];
};

export function ApplyOverview() {
  const can = useCan();
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<Data>('/apply/overview').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="notice n-warn"><div>{err}</div></div>;
  if (!d) return <Loading />;
  const now = new Date(d.serverTime).getTime();
  const k = d.kpis;
  const a = d.applications;
  const kpis: [string, number, string, string][] = [
    ['Open calls', k.open, 'open', k.paused ? `${k.paused} paused` : 'Accepting applications'],
    ['Applications received', a.total, '/studio/apply/applicants', a.status.submitted ? `${a.status.submitted} not yet looked at` : 'All submitted'],
    ['Drafts in progress', a.drafts, '', 'Started, not submitted yet'],
    ['Needs eligibility review', a.eligibility.needs_review ?? 0, '/studio/apply/applicants', 'Flagged by the form’s rules'],
    ...(d.outbox ? [['Email errors', d.outbox.failed, '/studio/apply/messages', d.outbox.ready ? `${d.outbox.queued} waiting to send` : 'Email sending is not set up'] as [string, number, string, string]] : []),
    ['Closing this week', k.closingThisWeek, 'open', 'Open calls with a deadline in 7 days'],
    ['Scheduled', k.scheduled, 'scheduled', 'Approved, opening on their date'],
    ['Awaiting approval', k.inReview, 'in_review', 'Submitted for review'],
    ['Under evaluation', k.underEvaluation, 'under_evaluation', 'Closed, being assessed'],
    ['Drafts', k.drafts, 'draft', 'Being prepared'],
  ];
  const what = (a: Data['activity'][number]) => a.kind === 'form_published' ? 'Form version published' : a.kind === 'extend' ? 'Deadline extended' : a.kind === 'reopen' ? 'Reopened' : a.kind === 'edit' ? 'Edited while released' : a.kind === 'duplicate' ? 'Created as a copy'
    : a.fromStatus ? `${CALL_STATUS[a.fromStatus] ?? a.fromStatus} → ${CALL_STATUS[a.toStatus ?? ''] ?? a.toStatus}` : 'Created';
  return <>
    <div className="page-h"><div><h1>Applications</h1><p>Calls for applications run from AFCD Studio: they open and close on the server’s clock.</p></div>
      {can('apply.call.manage') && <Link className="btn btn-primary" to="/studio/apply/calls?new=1"><Icon n="plus" />New call</Link>}</div>
    {k.total === 0 ? <section className="card ap-empty"><Icon n="spark" /><div><b>No calls yet</b><p>Create a call, send it for review, then schedule its opening. Application forms come next.</p></div>
      {can('apply.call.manage') && <Link className="btn btn-sm btn-primary" to="/studio/apply/calls?new=1">New call</Link>}</section> : <>
      <div className="ap-kpis">{kpis.map(([l, n, s, sub]) => s === '' ? <div key={l} className="ap-kpi"><span>{l}</span><b>{n}</b><small>{sub}</small></div> : <Link key={l} to={s.startsWith('/') ? s : `/studio/apply/calls?status=${s}`} className="ap-kpi"><span>{l}</span><b>{n}</b><small>{sub}</small></Link>)}</div>
      <div className="ap-grid">
        {d.recent && d.recent.length > 0 && <section className="card"><header className="ap-h"><h2>Recent applications</h2><Link to="/studio/apply/applicants" className="btn btn-ghost btn-sm">All</Link></header>
          <table className="ap-t"><tbody>{d.recent.map((r) => <tr key={r.id}><td><Link to={`/studio/apply/applicants/${r.id}`}>{r.applicantName || r.reference}</Link><small>{r.reference} · {r.callTitle}</small></td>
            <td className="r"><small>{ELIG[r.eligibility]}{r.overridden ? ' (corrected)' : ''}</small><small>{ago(r.submittedAt)}</small></td></tr>)}</tbody></table></section>}
        {d.deadlines.length > 0 && <section className="card"><header className="ap-h"><h2>Deadlines</h2></header>
          <table className="ap-t"><tbody>{d.deadlines.map((c) => <tr key={c.id}><td><Link to={`/studio/apply/calls/${c.id}`}>{c.title}</Link><small className="mono">{c.reference}</small></td>
            <td><CallBadge s={c.status} /></td><td className="r"><b>{relative(c.closesAt, now)}</b><small>{inZone(c.closesAt, c.timeZone, false)}</small></td></tr>)}</tbody></table></section>}
        {d.openings.length > 0 && <section className="card"><header className="ap-h"><h2>Opening soon</h2></header>
          <table className="ap-t"><tbody>{d.openings.map((c) => <tr key={c.id}><td><Link to={`/studio/apply/calls/${c.id}`}>{c.title}</Link><small className="mono">{c.reference}</small></td>
            <td className="r"><b>{relative(c.opensAt, now)}</b><small>{inZone(c.opensAt, c.timeZone, false)}</small></td></tr>)}</tbody></table></section>}
        {d.waiting.length > 0 && <section className="card"><header className="ap-h"><h2>Waiting for approval</h2></header>
          <table className="ap-t"><tbody>{d.waiting.map((c) => <tr key={c.id}><td><Link to={`/studio/apply/calls/${c.id}`}>{c.title}</Link><small className="mono">{c.reference}</small></td><td className="r"><CallBadge s={c.status} /></td></tr>)}</tbody></table></section>}
        {d.activity.length > 0 && <section className="card"><header className="ap-h"><h2>Recent activity</h2></header>
          <table className="ap-t"><tbody>{d.activity.map((a) => <tr key={a.id}><td><Link to={`/studio/apply/calls/${a.callId}`}>{a.title}</Link><small>{what(a)}</small></td>
            <td className="r"><small>{a.actorName ?? 'Scheduler'}</small><small>{ago(a.createdAt)}</small></td></tr>)}</tbody></table></section>}
      </div>
    </>}
  </>;
}
