// AFCD Apply → reviews. Managers: rubric (criteria, weights, scales, mode, blind), assignments and progress in each
// call's Reviews tab. Reviewers: their own assignments only, a conflict-of-interest declaration first, then a blind view of the
// application and the scoring form (draft, then final and locked).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Icon, Link, Modal, fmtDate, useCan, useToast } from '../ui.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import type { Answers, Field, FormDef } from '../../server/modules/apply/engine.ts';
import { FIELD_TYPES, evaluate, t } from '../../server/modules/apply/engine.ts';
import { APP_STATUS, EligBadge } from './Submissions.tsx';
import './evaluation.css';

type Criterion = { id: string; label: string; description?: string; weight: number; min: number; max: number; commentRequired?: boolean };
type Settings = { mode: 'single' | 'double' | 'committee' | 'panel' | 'consensus'; reviewersPerApplication: number; blind: boolean; disagreementPoints: number };
const MODES: [Settings['mode'], string][] = [['single', 'One reviewer'], ['double', 'Two reviewers'], ['committee', 'Committee'], ['panel', 'Panel'], ['consensus', 'Consensus (panel, then agreement)']];
export const pts = (bp: number | null | undefined) => (bp === null || bp === undefined ? '—' : (bp / 100).toFixed(1));
const errText = (e: unknown) => (e instanceof ApiError && e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : (e as Error).message);

export function CallPicker({ value, onChange, withSubmissions = true }: { value: string; onChange: (v: string) => void; withSubmissions?: boolean }) {
  const [calls, setCalls] = useState<{ id: string; reference: string; title: string; status: string }[]>([]);
  useEffect(() => { api('/apply/calls').then((r) => { const list = r.filter((c: { status: string }) => !withSubmissions || ['open', 'paused', 'closed', 'under_evaluation', 'completed'].includes(c.status)); setCalls(list); if (!value && list[0]) onChange(list[0].id); }).catch(() => {}); }, []);
  return <select className="select ev-pick" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Call">{!calls.length && <option value="">No call has applications yet</option>}{calls.map((c) => <option key={c.id} value={c.id}>{c.reference} · {c.title}</option>)}</select>;
}

/** A call's Reviews tab: who reviews what and how far they are, and the scoring rubric. */
export function CallReviews({ callId }: { callId: string }) {
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') === 'rubric' ? 'rubric' : 'progress');
  return <section className="card ev-card">
    <div className="ev-bar"><div className="in-tabs ev-tabs" role="tablist">{[['progress', 'Reviewers & progress'], ['rubric', 'Scoring rubric']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div></div>
    {tab === 'rubric' ? <RubricEditor key={callId} callId={callId} /> : <Progress key={callId} callId={callId} />}
  </section>;
}

type Mine = { id: string; status: string; reference: string; callTitle: string; createdAt: string; reviewStatus: string | null };
const mineLabel = (r: Mine) => r.status === 'conflict' ? 'Conflict declared' : r.status === 'final' ? 'Final' : r.reviewStatus === 'draft' ? 'Draft saved' : r.status === 'in_progress' ? 'Started' : 'To do';

/** Reviews assigned to the signed-in user, across calls. Blind calls show the reference only. */
export function MyReviewsPage() {
  const [rows, setRows] = useState<Mine[] | null>(null); const [show, setShow] = useState<'open' | 'done'>('open');
  useEffect(() => { api<Mine[]>('/apply/my-reviews').then(setRows).catch(() => setRows([])); }, []);
  const isDone = (r: Mine) => ['final', 'conflict'].includes(r.status);
  const todo = (rows ?? []).filter((r) => !isDone(r) && mineLabel(r) === 'To do').length, started = (rows ?? []).filter((r) => !isDone(r) && mineLabel(r) !== 'To do').length, done = (rows ?? []).filter(isDone).length;
  const list = (rows ?? []).filter((r) => (show === 'done') === isDone(r));
  return <>
    <div className="page-h"><div><h1>My reviews</h1><p>Applications assigned to you. Opening one first asks whether you have a conflict of interest. Final reviews are locked.</p></div></div>
    {!rows ? <Loading /> : !rows.length ? <section className="card ap-empty"><Icon n="check" /><div><b>Nothing assigned to you</b><p>When a manager assigns you applications to review, they appear here.</p></div></section> : <>
      <div className="ap-kpis mr-kpis">{([['To do', todo, 'open'], ['Started', started, 'open'], ['Finished', done, 'done']] as const).map(([l, n, k]) => <button key={l} type="button" className={`ap-kpi${show === k ? ' on' : ''}`} onClick={() => setShow(k)}><span>{l}</span><b>{n}</b></button>)}</div>
      <section className="card">
        <div className="ev-bar"><div className="in-tabs ev-tabs" role="tablist">{([['open', `To finish (${todo + started})`], ['done', `Finished (${done})`]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}</div></div>
        {!list.length ? <p className="sb-empty">{show === 'open' ? 'All done. Nothing left to review.' : 'No finished reviews yet.'}</p> :
          <table className="ap-t mr-t"><tbody>{list.map((r) => <tr key={r.id}><td><Link to={`/studio/apply/reviews/${r.id}`}>Application {r.reference.slice(-4)}</Link><small>{r.callTitle} · assigned {fmtDate(r.createdAt)}</small></td>
            <td className="r"><span className={`badge ev-r-${r.status}`}>{mineLabel(r)}</span></td>
            <td className="r mr-go">{!isDone(r) ? <Link className="btn btn-sm btn-primary" to={`/studio/apply/reviews/${r.id}`}>{mineLabel(r) === 'To do' ? 'Start review' : 'Continue'}</Link> : <Link className="btn btn-sm" to={`/studio/apply/reviews/${r.id}`}>Open</Link>}</td></tr>)}</tbody></table>}
      </section>
    </>}
  </>;
}

// ---------------------------------------------------------------- Rubric
function RubricEditor({ callId }: { callId: string }) {
  const toast = useToast();
  const [r, setR] = useState<{ criteria: Criterion[]; settings: Settings; rev: number; versions: { number: number; createdAt: string }[]; publishedVersionId: string | null } | null>(null);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/apply/calls/${callId}/rubric`).then((x) => { setR(x); setDirty(false); }), [callId]);
  useEffect(() => { void load(); }, [load]);
  if (!r) return <Loading />;
  const set = (fn: (x: NonNullable<typeof r>) => void) => { setR((x) => { const n = JSON.parse(JSON.stringify(x)); fn(n); return n; }); setDirty(true); };
  const W = r.criteria.reduce((s, c) => s + (c.weight || 0), 0);
  async function save() { setBusy(true); try { const x = await put<{ rev: number }>(`/apply/calls/${callId}/rubric`, { criteria: r!.criteria, settings: r!.settings, rev: r!.rev }); setR({ ...r!, rev: x.rev }); setDirty(false); toast('Rubric saved. Publish it to use it for new assignments.'); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  async function publish() { setBusy(true); try { if (dirty) await save(); const x = await post<{ version: number }>(`/apply/calls/${callId}/rubric/publish`); toast(`Rubric version ${x.version} published. New assignments use it.`); await load(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  return <div className="ev-pad stack">
    <div className="ev-settings">
      <label className="field"><span>Mode</span><select className="select" value={r.settings.mode} onChange={(e) => set((x) => { x.settings.mode = e.target.value as Settings['mode']; x.settings.reviewersPerApplication = e.target.value === 'single' ? 1 : e.target.value === 'double' ? 2 : Math.max(3, x.settings.reviewersPerApplication); })}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field"><span>Reviewers per application</span><input className="input" type="number" min={1} max={12} disabled={['single', 'double'].includes(r.settings.mode)} value={r.settings.reviewersPerApplication} onChange={(e) => set((x) => { x.settings.reviewersPerApplication = Number(e.target.value) || 1; })} /></label>
      <label className="field"><span>Flag disagreement above (points of 100)</span><input className="input" type="number" min={1} max={100} value={r.settings.disagreementPoints} onChange={(e) => set((x) => { x.settings.disagreementPoints = Number(e.target.value) || 1; })} /></label>
      <label className="ap-check"><input type="checkbox" checked={r.settings.blind} onChange={(e) => set((x) => { x.settings.blind = e.target.checked; })} />Blind review: reviewers do not see names, contact details, sensitive answers or files</label>
    </div>
    <table className="table ev-crit"><thead><tr><th>Criterion</th><th>Weight</th><th>Scale</th><th>Comment</th><th /></tr></thead><tbody>
      {r.criteria.map((c, i) => <tr key={i}>
        <td><input className="input" value={c.label} maxLength={160} aria-label="Criterion" onChange={(e) => set((x) => { x.criteria[i].label = e.target.value; })} /><input className="input ev-desc" value={c.description ?? ''} maxLength={1000} placeholder="What reviewers should look for (optional)" aria-label="Description" onChange={(e) => set((x) => { x.criteria[i].description = e.target.value || undefined; })} /></td>
        <td><input className="input ev-num" type="number" min={1} max={100} value={c.weight} aria-label="Weight" onChange={(e) => set((x) => { x.criteria[i].weight = Number(e.target.value) || 1; })} /><small className="muted">{W ? Math.round((c.weight / W) * 100) : 0}%</small></td>
        <td className="ev-scale"><input className="input ev-num" type="number" min={0} max={99} value={c.min} aria-label="Lowest score" onChange={(e) => set((x) => { x.criteria[i].min = Number(e.target.value) || 0; })} />–<input className="input ev-num" type="number" min={1} max={100} value={c.max} aria-label="Highest score" onChange={(e) => set((x) => { x.criteria[i].max = Number(e.target.value) || 1; })} /></td>
        <td><label className="ap-check"><input type="checkbox" checked={!!c.commentRequired} onChange={(e) => set((x) => { x.criteria[i].commentRequired = e.target.checked || undefined; })} />Required</label></td>
        <td><button className="btn btn-ghost icon-btn btn-sm" aria-label="Remove criterion" disabled={r.criteria.length < 2} onClick={() => set((x) => { x.criteria.splice(i, 1); })}><Icon n="x" /></button></td></tr>)}
    </tbody></table>
    <div className="ap-row"><button className="btn btn-sm" onClick={() => set((x) => { let n = x.criteria.length + 1; while (x.criteria.some((c) => c.id === `criterion_${n}`)) n++; x.criteria.push({ id: `criterion_${n}`, label: 'New criterion', weight: 10, min: 1, max: 5 }); })}><Icon n="plus" />Add criterion</button>
      <span style={{ flex: 1 }} /><button className="btn" disabled={!dirty || busy} onClick={save}>Save</button><button className="btn btn-primary" disabled={busy} onClick={publish}>Publish version {(r.versions[0]?.number ?? 0) + 1}</button></div>
    <small className="muted">{r.versions.length ? `Published: ${r.versions.map((v) => `v${v.number} (${fmtDate(v.createdAt)})`).join(', ')}. Existing assignments keep the version they started with.` : 'Not published yet: reviewers can be assigned once a version is published.'}</small>
  </div>;
}

// ---------------------------------------------------------------- Assignments & progress
type Prog = { applications: { id: string; reference: string; applicantName: string; status: string; eligibility: string; scoreBp: number | null; scoreReviews: number; disagreement: boolean; reviews: { id: string; reviewer: string; status: string; totalBp: number | null }[] }[];
  workload: { reviewerId: string; name: string; assigned: number; final: number; conflict: number }[] };
function Progress({ callId }: { callId: string }) {
  const toast = useToast();
  const [p, setP] = useState<Prog | null>(null); const [pool, setPool] = useState<{ id: string; name: string; email: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [revs, setRevs] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false);
  const load = useCallback(() => api<Prog>(`/apply/calls/${callId}/evaluation`).then(setP).catch((e) => toast(e.message, true)), [callId]);
  useEffect(() => { void load(); api('/apply/reviewers').then(setPool).catch(() => {}); }, [load]);
  if (!p) return <Loading />;
  const assignable = p.applications.filter((a) => a.status !== 'withdrawn');
  async function assign() {
    setBusy(true);
    try { const r = await post<{ created: number; notEnoughReviewers: number }>(`/apply/calls/${callId}/assignments`, { submissionIds: [...sel], reviewerIds: [...revs] }); toast(`${r.created} review(s) assigned.${r.notEnoughReviewers ? ` ${r.notEnoughReviewers} application(s) still need more reviewers.` : ''}`); setOpen(false); setSel(new Set()); await load(); }
    catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  }
  const label = (s: string) => (s === 'final' ? 'final' : s === 'conflict' ? 'conflict' : 'pending');
  return <div className="ev-pad stack">
    {p.workload.length > 0 && <div className="ev-load">{p.workload.map((w) => <div key={w.reviewerId}><b>{w.name}</b><small>{w.final}/{w.assigned} final{w.conflict ? ` · ${w.conflict} conflict` : ''}</small><span className="ev-meter"><i style={{ width: `${w.assigned ? (w.final / w.assigned) * 100 : 0}%` }} /></span></div>)}</div>}
    <div className="ap-row"><b>{p.applications.length} application{p.applications.length === 1 ? '' : 's'}</b><span style={{ flex: 1 }} />
      <button className="btn btn-sm" disabled={!sel.size} onClick={() => setOpen(true)}>Assign reviewers to {sel.size || '…'}</button></div>
    {!p.applications.length ? <p className="muted">No applications yet.</p> : <div className="sb-scroll"><table className="table sb-table"><thead><tr>
      <th className="sb-c"><input type="checkbox" aria-label="Select all" checked={sel.size === assignable.length && sel.size > 0} onChange={(e) => setSel(e.target.checked ? new Set(assignable.map((a) => a.id)) : new Set())} /></th>
      <th>Application</th><th>Status</th><th>Reviews</th><th className="r">Score</th></tr></thead><tbody>
      {p.applications.map((a) => <tr key={a.id} className={sel.has(a.id) ? 'on' : ''}>
        <td className="sb-c"><input type="checkbox" disabled={a.status === 'withdrawn'} aria-label={`Select ${a.reference}`} checked={sel.has(a.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} /></td>
        <td><Link to={`/studio/apply/applicants/${a.id}`} className="mono sb-ref">{a.reference}</Link><small>{a.applicantName}</small></td>
        <td><small>{APP_STATUS[a.status]}</small><EligBadge e={a.eligibility} /></td>
        <td>{a.reviews.length ? <ul className="ev-revs">{a.reviews.map((r) => <li key={r.id} className={`ev-r-${r.status}`}>{r.reviewer} · {label(r.status)}{r.totalBp !== null ? ` · ${pts(r.totalBp)}` : ''}</li>)}</ul> : <small className="muted">None</small>}</td>
        <td className="r"><b>{pts(a.scoreBp)}</b>{a.disagreement && <small className="ev-flag" title="Reviewers are further apart than the threshold">Disagreement</small>}</td></tr>)}</tbody></table></div>}
    {open && <Modal size="sm" title={`Assign reviewers to ${sel.size} application${sel.size === 1 ? '' : 's'}`} onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !revs.size} onClick={assign}>{busy ? 'Assigning…' : 'Assign'}</button></>}>
      <div className="modal-b stack"><p style={{ margin: 0 }}>Each application gets the rubric’s number of reviewers, least busy first; nobody is assigned twice to the same application.</p>
        {pool.length ? pool.map((u) => <label key={u.id} className="ap-check"><input type="checkbox" checked={revs.has(u.id)} onChange={(e) => setRevs((x) => { const n = new Set(x); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} />{u.name} <small className="muted">{u.email}</small></label>)
          : <p className="muted">No users can review yet. Give someone the Application Reviewer role in Users &amp; roles.</p>}</div></Modal>}
  </div>;
}

// ---------------------------------------------------------------- Reviewer screen
type RV = { assignment: { id: string; status: string; coi: null | { hasConflict: boolean; note: string } }; call: { title: string; reference: string }; rubric: { number: number; criteria: Criterion[]; settings: Settings };
  review: null | { scores: Record<string, number>; comments: Record<string, string>; overallComment: string; recommendation: string | null; rev: number; status: string; totalBp: number | null };
  application: null | { reference: string; applicantName: string | null; eligibility: string; formVersion: number; definition: FormDef; answers: Answers; hidden: string[]; files: { id: string; fieldId: string; name: string; bytes: number }[] | null } };

export function ReviewScreen({ id }: { id: string }) {
  const toast = useToast();
  const [v, setV] = useState<RV | null>(null); const [f, setF] = useState({ scores: {} as Record<string, number>, comments: {} as Record<string, string>, overallComment: '', recommendation: null as string | null });
  const [rev, setRev] = useState(0); const [state, setState] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [confirm, setConfirm] = useState(false); const [errs, setErrs] = useState<string[]>([]);
  const timer = useRef(0);
  const load = useCallback(async () => { const x = await api<RV>(`/apply/reviews/${id}`); setV(x); setRev(x.review?.rev ?? 0); if (x.review) setF({ scores: x.review.scores, comments: x.review.comments, overallComment: x.review.overallComment, recommendation: x.review.recommendation }); }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  const ev = useMemo(() => (v?.application ? evaluate(v.application.definition, v.application.answers) : null), [v]);
  if (!v) return <Loading />;
  const locked = v.assignment.status === 'final' || v.assignment.coi?.hasConflict;
  async function save(next = f): Promise<number | null> {
    setState('Saving…');
    try { const r = await put<{ rev: number }>(`/apply/reviews/${id}`, { ...next, rev }); setRev(r.rev); setState('Draft saved'); return r.rev; } catch (e) { setState(''); toast(errText(e), true); return null; }
  }
  const change = (fn: (x: typeof f) => void) => { const n = JSON.parse(JSON.stringify(f)); fn(n); setF(n); clearTimeout(timer.current); setState(''); timer.current = window.setTimeout(() => void save(n), 1200); };
  async function declare(hasConflict: boolean) { setBusy(true); try { await post(`/apply/reviews/${id}/coi`, { hasConflict, note }); await load(); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  async function finalize() {
    clearTimeout(timer.current); setBusy(true); setErrs([]);
    try { const r = await save(); if (r === null) return; const x = await post<{ totalBp: number }>(`/apply/reviews/${id}/final`, { rev: r }); setConfirm(false); toast(`Review submitted: ${pts(x.totalBp)} / 100. It is now locked.`); await load(); }
    catch (e) { setConfirm(false); setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => d.message) : [(e as Error).message]); } finally { setBusy(false); }
  }
  const head = <div className="ed-head"><div className="min-w-0"><Link to="/studio/apply/reviews" className="ed-back"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />My reviews</Link>
    <h1 className="sb-h1">{v.application?.reference ?? 'Application'}</h1><div className="sb-meta"><span>{v.call.title}</span><span>Rubric v{v.rubric.number}</span>{v.rubric.settings.blind && <span className="badge">Blind review</span>}</div></div></div>;
  if (!v.assignment.coi) return <>{head}<section className="card ev-pad ev-coi"><h2>Conflict of interest</h2>
    <p>Before you see this application: do you know the applicant personally, work or study with them, or have any interest in the outcome?</p>
    <label className="field"><span>If yes, say how (kept with the assignment, visible to the evaluation managers)</span><textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="ap-row"><button className="btn btn-primary" disabled={busy} onClick={() => declare(false)}>No conflict: show the application</button><button className="btn" disabled={busy || note.trim().length < 3} onClick={() => declare(true)}>I have a conflict</button></div></section></>;
  if (v.assignment.coi.hasConflict) return <>{head}<div className="notice n-info"><div>You declared a conflict of interest, so this application is not shown to you. The evaluation managers will reassign it.</div></div></>;
  const a = v.application!;
  const show = (fd: Field, x: unknown) => x === undefined || x === null || x === '' ? <span className="muted">No answer</span> : typeof x === 'boolean' ? (x ? 'Yes' : 'No')
    : Array.isArray(x) ? (fd.type === 'file' ? (a.files ? (x as { id: string; name: string }[]).map((y) => <a key={y.id} href={`/studio/api/apply/reviews/${id}/files/${y.id}`}>{y.name} </a>) : 'File (hidden in blind review)') : (x as string[]).map((y) => t(fd.config?.options?.find((o) => o.value === y)?.label) || y).join(', '))
    : <span className="sb-pre">{typeof x === 'string' && fd.config?.options ? t(fd.config.options.find((o) => o.value === x)?.label) || x : String(x)}</span>;
  const live = locked ? v.review?.totalBp : null;
  return <>{head}
    <div className="ev-grid">
      <section className="card sb-card">{v.rubric.settings.blind && <p className="muted ev-blind">Blind review: {a.hidden.length} answer{a.hidden.length === 1 ? '' : 's'} (names, contact details, sensitive answers) and files are hidden.</p>}
        {ev && ev.path.map((pid) => { const pg = a.definition.pages.find((x) => x.id === pid)!; const fs = pg.fields.filter((fd) => (FIELD_TYPES[fd.type].input || fd.type === 'calculated') && ev.visibleFields.has(fd.id) && !a.hidden.includes(fd.id));
          return fs.length ? <div key={pid} className="sb-page"><h2>{t(pg.title)}</h2><dl>{fs.map((fd) => <div key={fd.id}><dt>{t(fd.label)}</dt><dd>{show(fd, fd.type === 'calculated' ? ev.values[fd.id] : a.answers[fd.id])}</dd></div>)}</dl></div> : null; })}</section>
      <aside className="card ev-pad ev-score">
        <h2>Your review {locked && <span className="badge ev-r-final">Final · {pts(live)} / 100</span>}</h2>
        {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        <fieldset disabled={!!locked} className="ev-fs">
          {v.rubric.criteria.map((c) => <div key={c.id} className="ev-crit-row"><b>{c.label}</b><small className="muted">Weight {c.weight} · {c.min}–{c.max}</small>{c.description && <p className="muted">{c.description}</p>}
            <div className="ev-scale-btns" role="radiogroup" aria-label={c.label}>{Array.from({ length: c.max - c.min + 1 }, (_, k) => c.min + k).map((n) => <label key={n} className={f.scores[c.id] === n ? 'on' : ''}><input type="radio" name={`s-${c.id}`} checked={f.scores[c.id] === n} onChange={() => change((x) => { x.scores[c.id] = n; })} />{n}</label>)}</div>
            <textarea className="textarea" rows={2} maxLength={3000} placeholder={c.commentRequired ? 'Comment (required)' : 'Comment (optional)'} value={f.comments[c.id] ?? ''} onChange={(e) => change((x) => { x.comments[c.id] = e.target.value; })} aria-label={`Comment on ${c.label}`} /></div>)}
          <label className="field"><span>Overall comment</span><textarea className="textarea" rows={3} maxLength={5000} value={f.overallComment} onChange={(e) => change((x) => { x.overallComment = e.target.value; })} /></label>
          <div className="ev-reco" role="radiogroup" aria-label="Recommendation"><span>Recommendation</span>{[['yes', 'Recommend'], ['maybe', 'Maybe'], ['no', 'Do not recommend']].map(([k, l]) => <label key={k} className={f.recommendation === k ? 'on' : ''}><input type="radio" name="reco" checked={f.recommendation === k} onChange={() => change((x) => { x.recommendation = k; })} />{l}</label>)}</div>
        </fieldset>
        {!locked && <div className="ap-row"><span className="muted">{state}</span><span style={{ flex: 1 }} /><button className="btn" disabled={busy} onClick={() => void save()}>Save draft</button><button className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)}>Submit final review</button></div>}
        <small className="muted">Other reviewers’ scores are not shown to you, and nobody can change your final review.</small>
      </aside>
    </div>
    {confirm && <Modal size="sm" title="Submit your final review?" onClose={() => setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)}>Keep editing</button><button className="btn btn-primary" disabled={busy} onClick={finalize}>{busy ? 'Submitting…' : 'Submit and lock'}</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>After this you cannot change your scores or comments. The score is computed from rubric version {v.rubric.number}.</p></div></Modal>}
  </>;
}
