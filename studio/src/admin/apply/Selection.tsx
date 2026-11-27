// AFCD Apply → the In review, Shortlist and Decision stages of the Applicants pipeline: rank by score, move to the
// shortlist or interview, propose decisions, then approve or reject them (someone other than the proposer). Nothing here
// contacts applicants: results are sent from the call's Emails tab once approved.
import { useCallback, useEffect, useState } from 'react';
import { api, post, ApiError } from '../api.ts';
import { Link, Modal, fmtDate, useCan, useToast } from '../ui.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import { APP_STATUS, EligBadge } from './Submissions.tsx';
import { pts } from './Evaluation.tsx';
import './evaluation.css';

const errText = (e: unknown) => (e instanceof ApiError && e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : (e as Error).message);
const OUTCOME: Record<string, string> = { selected: 'Selected', waitlisted: 'Waitlisted', not_selected: 'Not selected' };
type A = { id: string; reference: string; applicantName: string; status: string; eligibility: string; scoreBp: number | null; scoreReviews: number; disagreement: boolean };

function Confirm({ title, n, children, okLabel, onClose, onRun, needReason = true }: { title: string; n: number; children?: React.ReactNode; okLabel: string; onClose: () => void; onRun: (reason: string) => Promise<void>; needReason?: boolean }) {
  const [reason, setReason] = useState(''); const [count, setCount] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal size="sm" title={title} onClose={() => !busy && onClose()} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    <button className="btn btn-primary" disabled={busy || Number(count) !== n || (needReason && reason.trim().length < 3)} onClick={async () => { setBusy(true); try { await onRun(reason.trim()); } finally { setBusy(false); } }}>{busy ? 'Saving…' : okLabel}</button></>}>
    <div className="modal-b stack">{children}
      <label className="field"><span>{needReason ? 'Reason (kept on each application)' : 'Note (optional)'}</span><textarea className="textarea" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="field"><span>Type {n} to confirm</span><input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /></label>
      <small className="muted">Applicants are not notified. Sending results is a separate, authorized step.</small></div></Modal>;
}

/** Ranked applications of one call at the given stages (In review: under_evaluation; Shortlist: shortlisted and interview). */
export function ShortlistStage({ callId: call, stages, onChanged }: { callId: string; stages: string[]; onChanged?: () => void }) {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<A[] | null>(null); const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<null | { kind: 'move'; to: string } | { kind: 'decide'; outcome: string }>(null);
  const load = useCallback(async () => {
    if (!call) return;
    setRows(null); setSel(new Set());
    try { const p = await api<{ applications: A[] }>(`/apply/calls/${call}/evaluation`); setRows(p.applications.filter((a) => stages.includes(a.status)).sort((a, b) => (b.scoreBp ?? -1) - (a.scoreBp ?? -1) || a.reference.localeCompare(b.reference))); }
    catch (e) { setRows([]); toast((e as Error).message, true); }
  }, [call, stages.join()]);
  useEffect(() => { void load(); }, [load]);
  const reload = async () => { await load(); onChanged?.(); };
  const chosen = (rows ?? []).filter((r) => sel.has(r.id));
  const canMove = (to: string) => chosen.length > 0 && chosen.every((r) => ({ under_evaluation: ['shortlisted'], shortlisted: ['interview', 'under_evaluation'], interview: ['shortlisted'] } as Record<string, string[]>)[r.status]?.includes(to));
  return <>
    <section className="card">
      {can('apply.submission.manage') && chosen.length > 0 && <div className="sb-bulk"><b>{chosen.length} selected</b>
        {[['shortlisted', 'Shortlist'], ['interview', 'Invite to interview'], ['under_evaluation', 'Back to review']].filter(([to]) => chosen.some((r) => r.status !== to)).map(([to, l]) => <button key={to} className="btn btn-sm" disabled={!canMove(to)} onClick={() => setDlg({ kind: 'move', to })}>{l}</button>)}
        <span style={{ flex: 1 }} />{Object.entries(OUTCOME).map(([k, l]) => <button key={k} className="btn btn-sm" onClick={() => setDlg({ kind: 'decide', outcome: k })}>Propose: {l}</button>)}</div>}
      {!rows ? <Loading /> : !rows.length ? <p className="sb-empty">No applications at this stage for this call.</p> :
        <div className="sb-scroll"><table className="table sb-table"><thead><tr>{can('apply.submission.manage') && <th className="sb-c" />}<th>#</th><th>Application</th><th>Stage</th><th>Eligibility</th><th className="r">Score</th></tr></thead><tbody>
          {rows.map((r, i) => <tr key={r.id} className={sel.has(r.id) ? 'on' : ''}>
            {can('apply.submission.manage') && <td className="sb-c"><input type="checkbox" aria-label={`Select ${r.reference}`} checked={sel.has(r.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
            <td><small>{r.scoreBp !== null ? i + 1 : '—'}</small></td>
            <td><Link to={`/studio/apply/applicants/${r.id}`} className="mono sb-ref">{r.reference}</Link><small>{r.applicantName}</small></td>
            <td><small>{APP_STATUS[r.status]}</small></td><td><EligBadge e={r.eligibility} /></td>
            <td className="r"><b>{pts(r.scoreBp)}</b><small>{r.scoreReviews} final review{r.scoreReviews === 1 ? '' : 's'}</small>{r.disagreement && <small className="ev-flag">Disagreement</small>}</td></tr>)}</tbody></table></div>}
    </section>
    {dlg?.kind === 'move' && <Confirm title={`${APP_STATUS[dlg.to]}: ${chosen.length} application${chosen.length === 1 ? '' : 's'}`} n={chosen.length} okLabel="Move" onClose={() => setDlg(null)}
      onRun={async (reason) => { try { await post('/apply/submissions/bulk-status', { ids: chosen.map((c) => c.id), to: dlg.to, reason, confirm: chosen.length }); toast('Moved. Each application records the change and your reason.'); setDlg(null); await reload(); } catch (e) { toast(errText(e), true); } }} />}
    {dlg?.kind === 'decide' && <Confirm title={`Propose “${OUTCOME[dlg.outcome]}” for ${chosen.length} application${chosen.length === 1 ? '' : 's'}`} n={chosen.length} okLabel="Propose" onClose={() => setDlg(null)}
      onRun={async (reason) => { try { await post('/apply/decisions', { ids: chosen.map((c) => c.id), outcome: dlg.outcome, reason, confirm: chosen.length }); toast('Proposed. Someone else approves it in the Decision stage.'); setDlg(null); await reload(); } catch (e) { toast(errText(e), true); } }}>
      <p style={{ margin: 0 }}>The decision takes effect only when someone else approves it.</p></Confirm>}
  </>;
}

type Dec = { id: string; outcome: string; reason: string; status: string; decisionNote: string; createdAt: string; decidedAt: string | null; notifiedAt: string | null; proposedBy: string | null; proposer: string | null; decider: string | null;
  submissionId: string; reference: string; applicantName: string; scoreBp: number | null; callTitle: string };

/** Proposed decisions waiting for a second person, and the decisions already taken, for one call. */
export function DecisionStage({ callId: call, onChanged }: { callId: string; onChanged?: () => void }) {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Dec[] | null>(null); const [sel, setSel] = useState<Set<string>>(new Set()); const [dlg, setDlg] = useState<null | boolean>(null);
  const load = useCallback(async () => { if (!call) return; setRows(null); setSel(new Set()); try { setRows(await api<Dec[]>(`/apply/decisions?call=${call}`)); } catch (e) { setRows([]); toast((e as Error).message, true); } }, [call]);
  useEffect(() => { void load(); }, [load]);
  const proposed = (rows ?? []).filter((r) => r.status === 'proposed'), done = (rows ?? []).filter((r) => r.status !== 'proposed');
  const chosen = proposed.filter((r) => sel.has(r.id));
  return <>
    <section className="card">
      {!rows ? <Loading /> : <>
        <header className="ap-h"><h2>Waiting for approval ({proposed.length})</h2>{can('apply.decide') && chosen.length > 0 && <div className="ap-row"><button className="btn btn-sm btn-primary" onClick={() => setDlg(true)}>Approve {chosen.length}</button><button className="btn btn-sm" onClick={() => setDlg(false)}>Reject {chosen.length}</button></div>}</header>
        {!proposed.length ? <p className="sb-empty">Nothing is waiting. Propose results from the Shortlist stage.</p> : <div className="sb-scroll"><table className="table sb-table"><thead><tr>{can('apply.decide') && <th className="sb-c" />}<th>Application</th><th>Proposed outcome</th><th>Reason</th><th>Proposed by</th><th className="r">Score</th></tr></thead><tbody>
          {proposed.map((r) => <tr key={r.id} className={sel.has(r.id) ? 'on' : ''}>
            {can('apply.decide') && <td className="sb-c"><input type="checkbox" aria-label={`Select ${r.reference}`} checked={sel.has(r.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
            <td><Link to={`/studio/apply/applicants/${r.submissionId}`} className="mono sb-ref">{r.reference}</Link><small>{r.applicantName}</small></td>
            <td><b>{OUTCOME[r.outcome]}</b></td><td><small>{r.reason}</small></td><td><small>{r.proposer}</small><small>{fmtDate(r.createdAt)}</small></td><td className="r">{pts(r.scoreBp)}</td></tr>)}</tbody></table></div>}
        <header className="ap-h"><h2>Decided</h2>{can('apply.message') && done.some((r) => r.status === 'approved' && !r.notifiedAt) && <Link className="btn btn-sm" to={`/studio/apply/calls/${call}/emails?tab=send`}>Send results…</Link>}</header>
        {!done.length ? <p className="sb-empty">No decisions yet.</p> : <div className="sb-scroll"><table className="table sb-table"><thead><tr><th>Application</th><th>Outcome</th><th>Result</th><th>By</th><th>Applicant told</th></tr></thead><tbody>
          {done.map((r) => <tr key={r.id}><td><Link to={`/studio/apply/applicants/${r.submissionId}`} className="mono sb-ref">{r.reference}</Link><small>{r.applicantName}</small></td><td>{OUTCOME[r.outcome]}<small>{r.reason}</small></td>
            <td><span className={`badge ev-d-${r.status}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>{r.decisionNote && <small>{r.decisionNote}</small>}</td><td><small>{r.proposer} → {r.decider}</small><small>{r.decidedAt ? fmtDate(r.decidedAt) : ''}</small></td>
            <td><small>{r.notifiedAt ? fmtDate(r.notifiedAt) : 'Not yet'}</small></td></tr>)}</tbody></table></div>}
      </>}
    </section>
    {dlg !== null && <Confirm title={`${dlg ? 'Approve' : 'Reject'} ${chosen.length} decision${chosen.length === 1 ? '' : 's'}`} n={chosen.length} okLabel={dlg ? 'Approve' : 'Reject'} needReason={!dlg} onClose={() => setDlg(null)}
      onRun={async (note) => { try { await post('/apply/decisions/decide', { ids: chosen.map((c) => c.id), approve: dlg, note, confirm: chosen.length }); toast(dlg ? 'Approved: the applications now show their outcome.' : 'Rejected: the applications keep their stage.'); setDlg(null); await load(); onChanged?.(); } catch (e) { toast(errText(e), true); } }}>
      <p style={{ margin: 0 }}>{dlg ? 'The applications take these outcomes now.' : 'The applications keep their current stage.'} You cannot approve decisions you proposed.</p></Confirm>}
  </>;
}
