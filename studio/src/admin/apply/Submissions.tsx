// AFCD Apply → Submissions: applications are personal data. The list is filtered and paged on the server (50 at a time);
// the detail shows answers in the form's order, files (downloads are recorded), eligibility with its reasons and any
// staff correction, and the full history.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, post, ApiError } from '../api.ts';
import { Icon, Link, Modal, fmtDate, navigate, useCan, useToast } from '../ui.tsx';
import { TableSkeleton, useUrlState } from '../DataTable.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import type { Answers, Field, FileRef, FormDef } from '../../server/modules/apply/engine.ts';
import { FIELD_TYPES, evaluate, t } from '../../server/modules/apply/engine.ts';
import './submissions.css';

export const APP_STATUS: Record<string, string> = {
  submitted: 'Submitted', eligibility_review: 'Eligibility review', under_evaluation: 'Under evaluation', shortlisted: 'Shortlisted', interview: 'Interview',
  selected: 'Selected', waitlisted: 'Waitlisted', not_selected: 'Not selected', withdrawn: 'Withdrawn',
};
export const ELIG: Record<string, string> = { eligible: 'Eligible', needs_review: 'Needs review', ineligible: 'Ineligible', not_assessed: 'Not assessed' };
export const EligBadge = ({ e, o }: { e: string; o?: boolean }) => <span className={`badge sb-e sb-e-${e}`} title={o ? 'Corrected by staff' : 'Automatic result'}>{ELIG[e] ?? e}{o ? ' ✎' : ''}</span>;
const StatusBadge = ({ s }: { s: string }) => <span className={`badge sb-s sb-s-${s}`}>{APP_STATUS[s] ?? s}</span>;
const MOVES: Record<string, string[]> = { submitted: ['eligibility_review', 'under_evaluation', 'withdrawn'], eligibility_review: ['submitted', 'under_evaluation', 'withdrawn'], under_evaluation: ['eligibility_review', 'withdrawn'], withdrawn: ['submitted'] };

type Row = { id: string; reference: string; applicantName: string; applicantEmail: string; status: string; eligibility: string; overridden: boolean; submittedAt: string; lang: string; callId: string; callReference: string; callTitle: string };
type Page = { items: Row[]; total: number; next: string | null };

export function SubmissionsList() {
  const can = useCan(); const toast = useToast();
  const [st, set] = useUrlState({ call: '', status: '', eligibility: '', q: '' });
  const [calls, setCalls] = useState<{ id: string; reference: string; title: string }[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null); const [total, setTotal] = useState(0); const [next, setNext] = useState<string | null>(null);
  const [q, setQ] = useState(st.q); const [sel, setSel] = useState<Set<string>>(new Set()); const [bulk, setBulk] = useState(false); const [busy, setBusy] = useState(false);
  const qs = (cursor?: string) => new URLSearchParams(Object.entries({ call: st.call, status: st.status, eligibility: st.eligibility, q: st.q, cursor: cursor ?? '' }).filter(([, v]) => v)).toString();
  const load = useCallback(async () => {
    setRows(null); setSel(new Set());
    try { const r = await api<Page>(`/apply/submissions?${qs()}`); setRows(r.items); setTotal(r.total); setNext(r.next); } catch (e) { setRows([]); toast((e as Error).message, true); }
  }, [st.call, st.status, st.eligibility, st.q]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api('/apply/calls').then((r) => setCalls(r.filter((x: { status: string }) => !['draft', 'in_review', 'changes_requested', 'approved'].includes(x.status)))).catch(() => {}); }, []);
  useEffect(() => { const h = setTimeout(() => { if (q !== st.q) set('q', q); }, 350); return () => clearTimeout(h); }, [q]);
  async function more() { if (!next) return; setBusy(true); try { const r = await api<Page>(`/apply/submissions?${qs(next)}`); setRows((x) => [...(x ?? []), ...r.items]); setNext(r.next); } finally { setBusy(false); } }
  const chosen = (rows ?? []).filter((r) => sel.has(r.id));
  const commonMoves = chosen.length ? chosen.map((r) => MOVES[r.status] ?? []).reduce((a, b) => a.filter((x) => b.includes(x))) : [];
  return <>
    <div className="page-h"><div><h1>Submissions</h1><p>Applications received through AFCD Apply. Each one keeps the form version it was made with. This is personal data: open only what you need.</p></div></div>
    <section className="card">
      <div className="sb-filters">
        <select className="select" value={st.call} onChange={(e) => set('call', e.target.value)} aria-label="Call"><option value="">All calls</option>{calls.map((c) => <option key={c.id} value={c.id}>{c.reference} · {c.title}</option>)}</select>
        <select className="select" value={st.status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">Any status</option>{Object.entries(APP_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="select" value={st.eligibility} onChange={(e) => set('eligibility', e.target.value)} aria-label="Eligibility"><option value="">Any eligibility</option>{Object.entries(ELIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" type="search" placeholder="Reference, name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search applications" />
      </div>
      {can('apply.submission.manage') && chosen.length > 0 && <div className="sb-bulk"><b>{chosen.length} selected</b>
        <button className="btn btn-sm" disabled={!commonMoves.length} title={commonMoves.length ? undefined : 'These applications have no status change in common'} onClick={() => setBulk(true)}>Change status…</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Clear</button></div>}
      {!rows ? <TableSkeleton /> : !rows.length ? <p className="sb-empty">{st.call || st.status || st.eligibility || st.q ? 'No applications match these filters.' : 'No applications yet. They appear here when applicants submit.'}</p> :
        <div className="sb-scroll"><table className="table sb-table">
          <thead><tr>{can('apply.submission.manage') && <th className="sb-c"><input type="checkbox" aria-label="Select all shown" checked={chosen.length === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
            <th>Reference</th><th>Applicant</th><th className="sb-hide">Call</th><th>Status</th><th>Eligibility</th><th className="r">Submitted</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className={sel.has(r.id) ? 'on' : ''}>
            {can('apply.submission.manage') && <td className="sb-c"><input type="checkbox" aria-label={`Select ${r.reference}`} checked={sel.has(r.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
            <td><Link to={`/studio/apply/submissions/${r.id}`} className="mono sb-ref">{r.reference}</Link></td>
            <td><span className="sb-name">{r.applicantName || '—'}</span><small>{r.applicantEmail}</small></td>
            <td className="sb-hide"><small>{r.callTitle}</small></td>
            <td><StatusBadge s={r.status} /></td><td><EligBadge e={r.eligibility} o={r.overridden} /></td>
            <td className="r"><small>{fmtDate(r.submittedAt)}</small></td></tr>)}</tbody></table></div>}
      {rows && rows.length > 0 && <div className="sb-foot"><span>{rows.length} of {total} shown</span>{next && <button className="btn btn-sm" disabled={busy} onClick={more}>{busy ? 'Loading…' : 'Show 50 more'}</button>}</div>}
    </section>
    {bulk && <BulkDialog rows={chosen} moves={commonMoves} onClose={() => setBulk(false)} onDone={() => { setBulk(false); void load(); }} />}
  </>;
}

function BulkDialog({ rows, moves, onClose, onDone }: { rows: Row[]; moves: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState(moves[0]); const [reason, setReason] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3 && Number(confirm) === rows.length;
  async function run() {
    setBusy(true);
    try { const r = await post<{ moved: number }>('/apply/submissions/bulk-status', { ids: rows.map((x) => x.id), to, reason: reason.trim(), confirm: Number(confirm) }); toast(`${r.moved} application(s) moved to ${APP_STATUS[to]}. Each one records the change and your reason.`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change the status.', true); } finally { setBusy(false); }
  }
  return <Modal size="sm" title={`Change the status of ${rows.length} application${rows.length === 1 ? '' : 's'}`} onClose={() => !busy && onClose()} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" disabled={!ok || busy} onClick={run}>{busy ? 'Saving…' : 'Change status'}</button></>}>
    <div className="modal-b stack">
      <label className="field"><span>New status</span><select className="select" value={to} onChange={(e) => setTo(e.target.value)}>{moves.map((m) => <option key={m} value={m}>{APP_STATUS[m]}</option>)}</select></label>
      <label className="field"><span>Reason (kept on each application)</span><textarea className="textarea" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="field"><span>Type {rows.length} to confirm</span><input className="input" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} /></label>
      <small className="muted">Applicants are not notified. Decisions and emails come with evaluation, and need approval first.</small>
    </div></Modal>;
}

// ---------------------------------------------------------------- Detail
type Detail = { id: string; reference: string; applicantName: string; applicantEmail: string; status: string; eligibility: string; lang: string; submittedAt: string; answers: Answers;
  eligibilityAuto: { result: string; reasons: { en: string }[]; rules: string[]; formVersion: number }; eligibilityOverride: null | { result: string; reason: string; byName: string; at: string };
  consent: { field: string; label: string; text: string; at: string }[]; call: { id: string; reference: string; title: string; status: string; timeZone: string }; version: { number: number; definition: FormDef };
  files: { id: string; fieldId: string; name: string; kind: string; mime: string; bytes: number; sha256: string }[];
  events: { id: string; kind: string; fromValue: string | null; toValue: string | null; body: string; meta: Record<string, unknown> | null; createdAt: string; actorName: string | null }[]; moves: string[] };

export function SubmissionDetail({ id }: { id: string }) {
  const can = useCan(); const toast = useToast();
  const [d, setD] = useState<Detail | null>(null); const [tab, setTab] = useState('Overview');
  const [dialog, setDialog] = useState<null | 'status' | 'elig'>(null); const [to, setTo] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const load = useCallback(() => api<Detail>(`/apply/submissions/${id}`).then(setD).catch((e) => toast(e.message, true)), [id]);
  useEffect(() => { void load(); }, [load]);
  const ev = useMemo(() => (d ? evaluate(d.version.definition, d.answers) : null), [d]);
  if (!d || !ev) return <Loading />;
  const manage = can('apply.submission.manage');
  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    try { await post(path, body); setDialog(null); setReason(''); await load(); toast(done); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save.', true); } finally { setBusy(false); }
  }
  const fileUrl = (f: { id: string }) => `/studio/api/apply/submissions/${d.id}/files/${f.id}`;
  const show = (f: Field, v: unknown) => {
    if (v === undefined || v === null || v === '') return <span className="muted">No answer</span>;
    if (typeof v === 'boolean') return f.type === 'consent' ? (v ? 'Agreed' : 'Not agreed') : v ? 'Yes' : 'No';
    const opt = (x: string) => t(f.config?.options?.find((o) => o.value === x)?.label) || x;
    if (f.type === 'file') return <ul className="sb-files">{(v as FileRef[]).map((x) => { const file = d.files.find((y) => y.id === x.id); return <li key={x.id}>{file ? <a href={fileUrl(file)}>{file.name}</a> : x.name} <small>{Math.max(1, Math.round(x.bytes / 1024))} KB</small></li>; })}</ul>;
    if (Array.isArray(v)) return (v as string[]).map(opt).join(', ');
    if (f.type === 'calculated') return `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: f.config?.decimals ?? 2 })}${f.config?.unit ? ` ${f.config.unit}` : ''}`;
    return <span className="sb-pre">{typeof v === 'string' && f.config?.options ? opt(v) : String(v)}</span>;
  };
  const EV: Record<string, string> = { submitted: 'Submitted by the applicant', status: 'Status changed', eligibility: 'Eligibility corrected', note: 'Note', download: 'File downloaded' };
  return <>
    <div className="ed-head"><div className="min-w-0">
      <Link to="/studio/apply/submissions" className="ed-back"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />Submissions</Link>
      <h1 className="sb-h1">{d.applicantName || d.reference}</h1>
      <div className="sb-meta"><span className="mono">{d.reference}</span><StatusBadge s={d.status} /><EligBadge e={d.eligibility} o={!!d.eligibilityOverride} /><span>{d.call.title}</span><span>Submitted {fmtDate(d.submittedAt)}</span></div>
    </div>
      {manage && <div className="ap-row"><button className="btn" disabled={!d.moves.length} onClick={() => { setTo(d.moves[0]); setReason(''); setDialog('status'); }}>Change status…</button><button className="btn" onClick={() => { setTo(d.eligibility); setReason(''); setDialog('elig'); }}>Correct eligibility…</button></div>}
    </div>
    <div className="in-tabs sb-tabs" role="tablist">{['Overview', 'Answers', `Documents (${d.files.length})`, 'Eligibility', ...(can('apply.evaluation.manage') ? ['Evaluation'] : []), 'Activity'].map((x) => <button key={x} role="tab" aria-selected={tab === x.split(' ')[0]} className={tab === x.split(' ')[0] ? 'on' : ''} onClick={() => setTab(x.split(' ')[0])}>{x}</button>)}</div>
    {tab === 'Overview' && <section className="card sb-card"><dl className="kv sb-kv">
      <dt>Applicant</dt><dd>{d.applicantName || '—'}</dd><dt>Email</dt><dd>{d.applicantEmail ? <a href={`mailto:${d.applicantEmail}`}>{d.applicantEmail}</a> : '—'}</dd>
      <dt>Call</dt><dd><Link to={`/studio/apply/calls/${d.call.id}`}>{d.call.reference} · {d.call.title}</Link></dd><dt>Form</dt><dd>Version {d.version.number}</dd>
      <dt>Language</dt><dd>{({ en: 'English', fr: 'French', ar: 'Arabic' } as Record<string, string>)[d.lang] ?? d.lang}</dd><dt>Submitted</dt><dd>{fmtDate(d.submittedAt)}</dd>
      <dt>Consent</dt><dd>{d.consent.length ? <ul className="sb-consent">{d.consent.map((c) => <li key={c.field}>{c.label}<small>{fmtDate(c.at)}</small></li>)}</ul> : '—'}</dd>
    </dl></section>}
    {tab === 'Answers' && <section className="card sb-card">{ev.path.map((pid) => { const p = d.version.definition.pages.find((x) => x.id === pid)!; const fs = p.fields.filter((f) => FIELD_TYPES[f.type].input || f.type === 'calculated');
      return <div key={pid} className="sb-page"><h2>{t(p.title)}</h2><dl>{fs.filter((f) => ev.visibleFields.has(f.id)).map((f) => <div key={f.id}><dt>{t(f.label)}{f.private && <em title="Sensitive answer"> · sensitive</em>}</dt><dd>{show(f, f.type === 'calculated' ? ev.values[f.id] : d.answers[f.id])}</dd></div>)}</dl></div>; })}</section>}
    {tab === 'Documents' && <section className="card sb-card">{d.files.length ? <table className="table"><thead><tr><th>File</th><th>Question</th><th>Type</th><th className="r">Size</th></tr></thead><tbody>
      {d.files.map((f) => <tr key={f.id}><td><a href={fileUrl(f)}>{f.name}</a></td><td><small>{t(d.version.definition.pages.flatMap((p) => p.fields).find((x) => x.id === f.fieldId)?.label) || f.fieldId}</small></td><td><small>{f.kind.toUpperCase()}</small></td><td className="r"><small>{Math.max(1, Math.round(f.bytes / 1024))} KB</small></td></tr>)}</tbody></table>
      : <p className="muted">No files.</p>}<p className="muted sb-note">Files are private: each download is recorded in the activity and the audit log.</p></section>}
    {tab === 'Eligibility' && <section className="card sb-card"><dl className="kv sb-kv">
      <dt>Result</dt><dd><EligBadge e={d.eligibility} o={!!d.eligibilityOverride} /></dd>
      <dt>Automatic</dt><dd>{ELIG[d.eligibilityAuto.result]} · form version {d.eligibilityAuto.formVersion}{d.eligibilityAuto.rules.length ? ` · rules ${d.eligibilityAuto.rules.join(', ')}` : ''}
        {d.eligibilityAuto.reasons.length > 0 && <ul>{d.eligibilityAuto.reasons.map((r, i) => <li key={i}>{r.en}</li>)}</ul>}</dd>
      {d.eligibilityOverride && <><dt>Correction</dt><dd>{ELIG[d.eligibilityOverride.result]} by {d.eligibilityOverride.byName}, {fmtDate(d.eligibilityOverride.at)}<q className="sb-q">{d.eligibilityOverride.reason}</q>
        {manage && <button className="btn btn-sm btn-ghost" onClick={() => act(`/apply/submissions/${d.id}/eligibility`, { clear: true }, 'Back to the automatic result')}>Back to the automatic result</button>}</dd></>}
    </dl><p className="muted sb-note">The automatic result comes from the form’s rules. Nobody is rejected automatically: staff decide.</p></section>}
    {tab === 'Evaluation' && <ReviewsTab id={d.id} />}
    {tab === 'Activity' && <section className="card sb-card">
      {manage && <div className="sb-note-f"><textarea className="textarea" rows={2} maxLength={5000} placeholder="Internal note (not shown to the applicant)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-sm" disabled={!note.trim() || busy} onClick={async () => { await act(`/apply/submissions/${d.id}/notes`, { body: note.trim() }, 'Note added'); setNote(''); }}>Add note</button></div>}
      <ol className="timeline">{d.events.map((e) => <li key={e.id}><b>{EV[e.kind] ?? e.kind}{e.kind === 'status' ? `: ${APP_STATUS[e.fromValue ?? ''] ?? e.fromValue} → ${APP_STATUS[e.toValue ?? ''] ?? e.toValue}` : e.kind === 'eligibility' ? `: ${ELIG[e.fromValue ?? ''] ?? e.fromValue} → ${ELIG[e.toValue ?? ''] ?? e.toValue}` : e.kind === 'download' ? `: ${String(e.meta?.name ?? '')}` : ''}</b>
        {e.body && <q>{e.body}</q>}<small>{e.actorName ?? (e.kind === 'submitted' ? 'Applicant' : 'System')} · {fmtDate(e.createdAt)}</small></li>)}</ol></section>}
    {dialog === 'status' && <Modal size="sm" title="Change status" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || (to === 'withdrawn' && reason.trim().length < 3)} onClick={() => act(`/apply/submissions/${d.id}/status`, { to, reason: reason.trim() }, `Moved to ${APP_STATUS[to]}`)}>Save</button></>}>
      <div className="modal-b stack"><label className="field"><span>New status</span><select className="select" value={to} onChange={(e) => setTo(e.target.value)}>{d.moves.map((m) => <option key={m} value={m}>{APP_STATUS[m]}</option>)}</select></label>
        <label className="field"><span>Reason{to === 'withdrawn' ? '' : ' (optional)'}</span><textarea className="textarea" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <small className="muted">The applicant is not notified.</small></div></Modal>}
    {dialog === 'elig' && <Modal size="sm" title="Correct eligibility" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => act(`/apply/submissions/${d.id}/eligibility`, { result: to, reason: reason.trim() }, 'Eligibility corrected')}>Save correction</button></>}>
      <div className="modal-b stack"><p style={{ margin: 0 }}>Automatic result: <b>{ELIG[d.eligibilityAuto.result]}</b>. It stays on record next to your correction.</p>
        <label className="field"><span>Result</span><select className="select" value={to} onChange={(e) => setTo(e.target.value)}>{Object.entries(ELIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Why (kept with the correction)</span><textarea className="textarea" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label></div></Modal>}
  </>;
}

function ReviewsTab({ id }: { id: string }) {
  const [rows, setRows] = useState<{ assignmentId: string; reviewer: string; status: string; coi: null | { hasConflict: boolean; note: string }; rubricVersion: number; criteria: { id: string; label: string; min: number; max: number }[];
    scores: Record<string, number> | null; comments: Record<string, string> | null; overallComment: string | null; recommendation: string | null; totalBp: number | null; reviewStatus: string | null; finalAt: string | null }[] | null>(null);
  useEffect(() => { api(`/apply/submissions/${id}/reviews`).then(setRows).catch(() => setRows([])); }, [id]);
  if (!rows) return <Loading />;
  if (!rows.length) return <section className="card sb-card"><p className="muted">No reviewer assigned yet. Assign reviewers in Review &amp; evaluation.</p></section>;
  return <section className="card sb-card">{rows.map((r) => <div key={r.assignmentId} className="sb-page"><h2>{r.reviewer} · {r.status === 'conflict' ? 'conflict of interest' : r.reviewStatus === 'final' ? `final, ${r.totalBp !== null ? (r.totalBp / 100).toFixed(1) : '—'} / 100` : r.reviewStatus === 'draft' ? 'draft (not counted)' : 'not started'} · rubric v{r.rubricVersion}</h2>
    {r.status === 'conflict' ? <p className="muted">{r.coi?.note}</p> : r.reviewStatus === 'final' ? <dl>{r.criteria.map((c) => <div key={c.id}><dt>{c.label}</dt><dd>{r.scores?.[c.id] ?? '—'} / {c.max}{r.comments?.[c.id] ? <q className="sb-q">{r.comments[c.id]}</q> : null}</dd></div>)}
      <div><dt>Recommendation</dt><dd>{({ yes: 'Recommend', maybe: 'Maybe', no: 'Do not recommend' } as Record<string, string>)[r.recommendation ?? ''] ?? '—'}{r.overallComment ? <q className="sb-q">{r.overallComment}</q> : null}</dd></div></dl> : <p className="muted">Scores appear when the review is final.</p>}</div>)}</section>;
}
