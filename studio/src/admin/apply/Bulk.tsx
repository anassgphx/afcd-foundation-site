// AFCD Apply → bulk actions on the selected applications. Before anything runs, the dialog says how many applications
// the action applies to and which ones are skipped, and why; the count must be typed to confirm. Every action goes
// through the existing, permission-checked API (all or none per call), and each application records the change.
import { useEffect, useState } from 'react';
import { api, post, ApiError } from '../api.ts';
import { Icon, Modal, useCan, useToast } from '../ui.tsx';
import { StatusBadge, stageLabel } from './badges.tsx';

export type BulkRow = { id: string; reference: string; applicantName: string; applicantEmail: string; status: string; eligibility: string; callId: string; callTitle: string };
type Kind = 'review' | 'shortlist' | 'eligibility' | 'assign' | 'email' | 'withdraw';
const MOVES: Record<string, string[]> = { submitted: ['eligibility_review', 'under_evaluation', 'withdrawn'], eligibility_review: ['submitted', 'under_evaluation', 'withdrawn'], under_evaluation: ['eligibility_review', 'shortlisted', 'withdrawn'], shortlisted: ['under_evaluation', 'interview', 'withdrawn'], interview: ['shortlisted', 'withdrawn'], withdrawn: ['submitted'] };
const errText = (e: unknown) => (e instanceof ApiError && e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : (e as Error).message);
const TITLE: Record<Kind, string> = { review: 'Send to In review', shortlist: 'Shortlist', eligibility: 'Confirm eligibility', assign: 'Assign a reviewer', email: 'Email the applicants', withdraw: 'Withdraw' };

/** Which of the chosen applications an action can apply to, and why the others are skipped. */
function split(kind: Kind, rows: BulkRow[]) {
  const ok: BulkRow[] = [], skip: [BulkRow, string][] = [];
  for (const r of rows) {
    const why = kind === 'review' ? (MOVES[r.status]?.includes('under_evaluation') ? '' : r.status === 'under_evaluation' ? 'already In review' : `${stageLabel(r.status)} cannot go back to In review`)
      : kind === 'shortlist' ? (r.status === 'under_evaluation' ? '' : r.status === 'shortlisted' ? 'already shortlisted' : `only In review can be shortlisted (this one is ${stageLabel(r.status)})`)
      : kind === 'withdraw' ? (MOVES[r.status]?.includes('withdrawn') ? '' : r.status === 'withdrawn' ? 'already withdrawn' : `${stageLabel(r.status)} cannot be withdrawn here`)
      : kind === 'email' ? (r.applicantEmail ? '' : 'no email address')
      : (r.status === 'withdrawn' ? 'withdrawn' : '');
    if (why) skip.push([r, why]); else ok.push(r);
  }
  return { ok, skip };
}
const byCall = (rows: BulkRow[]) => { const m = new Map<string, BulkRow[]>(); for (const r of rows) m.set(r.callId, [...(m.get(r.callId) ?? []), r]); return m; };

export function BulkBar({ rows, onClear, onDone }: { rows: BulkRow[]; onClear: () => void; onDone: () => void }) {
  const can = useCan();
  const [kind, setKind] = useState<Kind | null>(null);
  const n = (k: Kind) => split(k, rows).ok.length;
  const btn = (k: Kind, icon?: string) => <button type="button" className="btn btn-sm" onClick={() => setKind(k)} disabled={!n(k)} title={n(k) ? `${n(k)} of ${rows.length} can be changed` : 'None of the selected applications can'}>{icon && <Icon n={icon} />}{TITLE[k]}{n(k) !== rows.length && n(k) > 0 ? ` (${n(k)})` : ''}</button>;
  return <div className="sb-bulk bk-bar" role="toolbar" aria-label="Actions on the selected applications">
    <b>{rows.length} selected</b>
    {btn('review')}{btn('shortlist')}{btn('eligibility')}
    {can('apply.evaluation.manage') && btn('assign', 'users')}
    {can('apply.message') && btn('email', 'mail')}
    {btn('withdraw')}
    <span style={{ flex: 1 }} />
    <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>Clear</button>
    {kind && <BulkDialog kind={kind} rows={rows} onClose={() => setKind(null)} onDone={() => { setKind(null); onDone(); }} />}
  </div>;
}

function BulkDialog({ kind, rows, onClose, onDone }: { kind: Kind; rows: BulkRow[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { ok, skip } = split(kind, rows);
  const [reason, setReason] = useState(''); const [count, setCount] = useState(''); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'eligible' | 'needs_review' | 'ineligible'>('eligible');
  const [pool, setPool] = useState<{ id: string; name: string; email: string }[]>([]); const [revs, setRevs] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [sample, setSample] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  useEffect(() => { if (kind === 'assign') api('/apply/reviewers').then(setPool).catch(() => {}); }, [kind]);
  const calls = byCall(ok);
  const needsReason = kind === 'review' || kind === 'shortlist' || kind === 'eligibility' || kind === 'withdraw';
  const ready = Number(count) === ok.length && ok.length > 0 && (!needsReason || reason.trim().length >= 3)
    && (kind !== 'assign' || revs.size > 0) && (kind !== 'email' || (subject.trim().length >= 3 && body.trim().length >= 10 && !!sample));
  async function run() {
    setBusy(true); const out: string[] = [];
    try {
      if (kind === 'review' || kind === 'shortlist' || kind === 'withdraw') {
        const to = kind === 'review' ? 'under_evaluation' : kind === 'shortlist' ? 'shortlisted' : 'withdrawn';
        const r = await post<{ moved: number }>('/apply/submissions/bulk-status', { ids: ok.map((x) => x.id), to, reason: reason.trim(), confirm: ok.length });
        out.push(`${r.moved} moved to ${stageLabel(to)}.`);
      } else if (kind === 'eligibility') {
        const r = await post<{ updated: number }>('/apply/submissions/bulk-eligibility', { ids: ok.map((x) => x.id), result, reason: reason.trim(), confirm: ok.length });
        out.push(`${r.updated} marked ${result.replace('_', ' ')}.`);
      } else {
        // per call: a failure in one call (for example its rubric is not published) does not stop the others
        for (const [callId, list] of calls) {
          const title = list[0].callTitle;
          try {
            if (kind === 'assign') { const r = await post<{ created: number; notEnoughReviewers?: number }>(`/apply/calls/${callId}/assignments`, { submissionIds: list.map((x) => x.id), reviewerIds: [...revs] }); out.push(`${title}: ${r.created} assignment${r.created === 1 ? '' : 's'} created${r.notEnoughReviewers ? `, ${r.notEnoughReviewers} still need more reviewers` : ''}.`); }
            else { const r = await post<{ queued: number; skippedNoEmail: number }>('/apply/messages/custom', { callId, submissionIds: list.map((x) => x.id), subject, body, confirm: list.length }); out.push(`${title}: ${r.queued} email${r.queued === 1 ? '' : 's'} queued${r.skippedNoEmail ? `, ${r.skippedNoEmail} without a valid address` : ''}.`); }
          } catch (e) { out.push(`${title}: not done. ${errText(e)}`); }
        }
      }
      setReport(out); toast(out[0] ?? 'Done');
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  }
  async function preview() { try { setSample(await post('/apply/messages/preview', { submissionId: ok[0].id, subject, body })); } catch (e) { toast(errText(e), true); } }
  if (report) return <Modal size="sm" title={TITLE[kind]} onClose={onDone} footer={<button className="btn btn-primary" onClick={onDone}>Done</button>}>
    <div className="modal-b stack"><ul className="bk-report">{report.map((x) => <li key={x}>{x}</li>)}</ul>{kind === 'email' && <small className="muted">Follow delivery in Emails. Nothing claims “delivered”: we only learn that the email server accepted a message.</small>}</div></Modal>;
  return <Modal title={`${TITLE[kind]}: ${ok.length} of ${rows.length}`} onClose={() => !busy && onClose()} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    {kind === 'email' && <button className="btn" disabled={busy || subject.trim().length < 3 || body.trim().length < 10} onClick={preview}>Preview</button>}
    <button className={`btn ${kind === 'withdraw' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !ready} onClick={run}>{busy ? 'Working…' : TITLE[kind]}</button></>}>
    <div className="modal-b stack">
      <div className="bk-sum"><span><b>{ok.length}</b> will change</span>{skip.length > 0 && <span><b>{skip.length}</b> skipped</span>}{calls.size > 1 && <span>{calls.size} calls</span>}</div>
      {skip.length > 0 && <details className="bk-skip"><summary>Why {skip.length} {skip.length === 1 ? 'is' : 'are'} skipped</summary><ul>{skip.map(([r, why]) => <li key={r.id}><span className="mono">{r.reference}</span> {r.applicantName}: {why}</li>)}</ul></details>}
      {(kind === 'review' || kind === 'shortlist') && ok.some((r) => r.eligibility === 'ineligible') && <div className="notice n-warn"><div>{ok.filter((r) => r.eligibility === 'ineligible').length} of them {ok.filter((r) => r.eligibility === 'ineligible').length === 1 ? 'is' : 'are'} marked ineligible. Moving does not change that; your reason is recorded on each.</div></div>}
      {kind === 'eligibility' && <div className="bk-seg" role="radiogroup" aria-label="Assessment">{(['eligible', 'needs_review', 'ineligible'] as const).map((k) => <label key={k} className={result === k ? 'on' : ''}><input type="radio" name="bk-el" checked={result === k} onChange={() => setResult(k)} /><StatusBadge category="eligibility" status={k} size="sm" /></label>)}</div>}
      {kind === 'assign' && <fieldset className="bk-revs"><legend>Reviewers</legend>{pool.length ? pool.map((p) => <label key={p.id} className="ap-check"><input type="checkbox" checked={revs.has(p.id)} onChange={(e) => setRevs((s) => { const x = new Set(s); if (e.target.checked) x.add(p.id); else x.delete(p.id); return x; })} />{p.name} <small className="muted">{p.email}</small></label>) : <p className="muted">No user can review applications yet.</p>}
        <small className="muted">Each application gets as many reviewers as its call’s rubric asks for, shared among the people you tick. The rubric must be published.</small></fieldset>}
      {kind === 'email' && <>
        <label className="field"><span>Subject</span><input className="input" maxLength={200} value={subject} onChange={(e) => { setSubject(e.target.value); setSample(null); }} /></label>
        <label className="field"><span>Message</span><textarea className="textarea" rows={6} maxLength={10000} value={body} onChange={(e) => { setBody(e.target.value); setSample(null); }} /></label>
        <small className="muted">Variables: {'{{applicant_name}} {{reference}} {{call_title}} {{contact_email}} {{submitted_date}}'}. Each applicant gets their own email; nobody sees the others.</small>
        {sample && <div className="adr-preview"><small>Preview for {sample.to}</small><b>{sample.subject}</b><pre>{sample.body}</pre></div>}</>}
      {needsReason && <label className="field"><span>Reason (kept on each application)</span><textarea className="textarea" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      <label className="field"><span>Type {ok.length} to confirm</span><input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /></label>
      <small className="muted">{kind === 'email' ? 'Emails go through the outbox.' : 'Applicants are not notified.'}</small>
    </div></Modal>;
}
