// AFCD Apply → the application drawer: one application, managed from the Applicants list without leaving it.
// Tabs: Overview, Answers, Documents, Eligibility, Evaluation, Decision, Emails, Activity. Every action calls the
// existing, permission-checked API; badges change only after the server confirms. Stage, eligibility and decision are
// three separate things here, as in the database: moving an application never makes it eligible, and an approval
// email can only follow an approved decision.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, del, post, ApiError } from '../api.ts';
import { Icon, Link, Modal, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import type { Answers, Field, FileRef, FormDef } from '../../server/modules/apply/engine.ts';
import { FIELD_TYPES, evaluate, t } from '../../server/modules/apply/engine.ts';
import { StatusBadge, stageLabel } from './badges.tsx';
import { MessagesTable } from './Communications.tsx';
import './drawer.css';

type Decision = { id: string; outcome: string; status: string; reason: string; decisionNote: string; createdAt: string; decidedAt: string | null; notifiedAt: string | null; proposedBy: string | null; proposer: string | null; decider: string | null };
export type Detail = { id: string; reference: string; applicantName: string; applicantEmail: string; status: string; eligibility: string; lang: string; submittedAt: string; answers: Answers;
  scoreBp: number | null; scoreReviews: number; disagreement: boolean;
  eligibilityAuto: { result: string; reasons: { en: string }[]; rules: string[]; formVersion: number }; eligibilityOverride: null | { result: string; reason: string; byName: string; at: string };
  consent: { field: string; label: string; text: string; at: string }[];
  call: { id: string; reference: string; title: string; status: string; timeZone: string; eligibility: string[]; places: number | null; selected: number };
  version: { number: number; definition: FormDef };
  files: { id: string; fieldId: string; name: string; kind: string; mime: string; bytes: number; sha256: string }[];
  events: { id: string; kind: string; fromValue: string | null; toValue: string | null; body: string; meta: Record<string, unknown> | null; createdAt: string; actorName: string | null }[];
  decisions: Decision[]; moves: string[] };
type Review = { assignmentId: string; reviewer: string; status: string; coi: null | { hasConflict: boolean; note: string }; criteria: { id: string; label: string; min: number; max: number }[];
  scores: Record<string, number> | null; comments: Record<string, string> | null; overallComment: string | null; recommendation: string | null; totalBp: number | null; reviewStatus: string | null; finalAt: string | null };

const TABS = ['Overview', 'Answers', 'Documents', 'Eligibility', 'Evaluation', 'Decision', 'Emails', 'Activity'] as const;
type Tab = (typeof TABS)[number];
const OUTCOME: Record<string, string> = { selected: 'Selected', waitlisted: 'Waitlisted', not_selected: 'Not selected' };
const TEMPLATE_OF: Record<string, string> = { selected: 'decision_selected', waitlisted: 'decision_waitlisted', not_selected: 'decision_not_selected' };
const DECIDABLE = ['under_evaluation', 'shortlisted', 'interview'];
const MOVE_LABEL: Record<string, string> = { eligibility_review: 'Send to eligibility screening', under_evaluation: 'Send to In review', shortlisted: 'Shortlist', interview: 'Invite to interview', submitted: 'Back to New', withdrawn: 'Withdraw' };
const LIFECYCLE: [string, string][] = [['submitted', 'New'], ['eligibility_review', 'Eligibility'], ['under_evaluation', 'In review'], ['shortlisted', 'Shortlist'], ['decision', 'Decision']];
const errText = (e: unknown) => (e instanceof ApiError && e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : (e as Error).message);
const pts = (bp: number | null | undefined) => (bp === null || bp === undefined ? '—' : (bp / 100).toFixed(1));

/** The decision shown in the header: the outcome once approved, "waiting" while proposed, otherwise none yet. */
export const decisionOf = (d: Pick<Detail, 'status' | 'decisions'>) => (OUTCOME[d.status] ? d.status : d.decisions.some((x) => x.status === 'proposed') ? 'proposed' : 'pending');

export function ApplicationDrawer({ id, ids, onClose, onNav, onChanged }: { id: string; ids: string[]; onClose: () => void; onNav: (id: string) => void; onChanged: () => void }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [d, setD] = useState<Detail | null>(null); const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('Overview'); const [full, setFull] = useState(false);
  const [dlg, setDlg] = useState<null | { kind: 'move'; to: string } | { kind: 'email'; preset: 'custom' | 'decision'; decisionId?: string }>(null);
  const panel = useRef<HTMLDivElement>(null); const opener = useRef<Element | null>(null);
  // decisions whose email is already in the outbox (queued, sending or accepted), so "Send" is not offered twice
  const [outbox, setOutbox] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    try { setD(await api<Detail>(`/apply/submissions/${id}`)); setErr(''); } catch (e) { setErr((e as Error).message); }
    if (can('apply.message')) api<{ decisionId: string | null; status: string }[]>(`/apply/messages?submission=${id}`).then((m) => setOutbox(new Set(m.filter((x) => x.decisionId && x.status !== 'cancelled').map((x) => x.decisionId!)))).catch(() => {});
  }, [id]);
  useEffect(() => { setD(null); void load(); }, [load]);
  useEffect(() => { opener.current = document.activeElement; panel.current?.focus(); return () => { (opener.current as HTMLElement | null)?.focus?.(); }; }, []);
  const at = ids.indexOf(id);
  // keyboard: Escape closes (not while a dialog is open), [ and ] move between applications
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (dlg) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (!typing && e.key === '[' && at > 0) onNav(ids[at - 1]);
      else if (!typing && e.key === ']' && at >= 0 && at < ids.length - 1) onNav(ids[at + 1]);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [dlg, at, ids, onClose, onNav]);
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);
  const changed = async (msg: string) => { await load(); onChanged(); toast(msg); };
  const manage = can('apply.submission.manage');
  const decision = d ? decisionOf(d) : 'pending';
  const proposed = d?.decisions.find((x) => x.status === 'proposed');
  const approvedUnsent = d?.decisions.find((x) => x.status === 'approved' && !x.notifiedAt && !outbox.has(x.id));

  // the one main action for where this application is
  const next: null | { label: string; run: () => void } = !d || !manage ? null
    : (d.status === 'submitted' || d.status === 'eligibility_review') && d.moves.includes('under_evaluation') ? { label: 'Send to In review', run: () => setDlg({ kind: 'move', to: 'under_evaluation' }) }
    : proposed ? { label: 'Review the proposed decision', run: () => setTab('Decision') }
    : d.status === 'under_evaluation' ? { label: 'Shortlist', run: () => setDlg({ kind: 'move', to: 'shortlisted' }) }
    : DECIDABLE.includes(d.status) ? { label: 'Decide', run: () => setTab('Decision') }
    : approvedUnsent && can('apply.message') ? { label: `Send the ${OUTCOME[approvedUnsent.outcome].toLowerCase()} email`, run: () => setDlg({ kind: 'email', preset: 'decision', decisionId: approvedUnsent.id }) }
    : null;

  return createPortal(<div className="adr-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !dlg) onClose(); }}>
    <div className={`adr${full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-label={d ? `Application ${d.reference}` : 'Application'} ref={panel} tabIndex={-1}>
      <header className="adr-head">
        <div className="adr-id">
          {!d ? <div className="skeleton" style={{ width: 260, height: 22 }} /> : <>
            <div className="adr-ref"><span className="mono">{d.reference}</span><button type="button" className="adr-mini" onClick={() => { void navigator.clipboard?.writeText(d.reference).then(() => toast('Reference copied')); }} aria-label="Copy the reference" title="Copy the reference"><Icon n="layers" width={13} height={13} /></button></div>
            <h2>{d.applicantName || 'Applicant without a name'}</h2>
            <p className="adr-sub">{d.call.title} · submitted {fmtDate(d.submittedAt)}</p>
            <div className="adr-badges" aria-live="polite">
              <span><small>Stage</small><StatusBadge category="stage" status={d.status} /></span>
              <span><small>Eligibility</small><StatusBadge category="eligibility" status={d.eligibility} /></span>
              <span><small>Decision</small><StatusBadge category="decision" status={decision} /></span>
              {d.scoreReviews > 0 && <span><small>Score</small><b className="adr-score">{pts(d.scoreBp)}<small> / 100 · {d.scoreReviews} review{d.scoreReviews === 1 ? '' : 's'}</small></b></span>}
            </div></>}
        </div>
        <div className="adr-tools">
          <span className="adr-count">{at >= 0 ? `${at + 1} of ${ids.length}` : ''}</span>
          <button type="button" className="adr-icon" disabled={at <= 0} onClick={() => onNav(ids[at - 1])} aria-label="Previous application" title="Previous ( [ )"><Icon n="chev" style={{ transform: 'rotate(180deg)' }} /></button>
          <button type="button" className="adr-icon" disabled={at < 0 || at >= ids.length - 1} onClick={() => onNav(ids[at + 1])} aria-label="Next application" title="Next ( ] )"><Icon n="chev" /></button>
          <button type="button" className="adr-icon adr-hide-sm" onClick={() => setFull((v) => !v)} aria-label={full ? 'Smaller' : 'Full screen'} aria-pressed={full} title={full ? 'Smaller' : 'Full screen'}><Icon n="monitor" /></button>
          {d && <Link className="adr-icon adr-hide-sm" to={`/studio/apply/applicants/${d.id}`} aria-label="Open as a page" title="Open as a page"><Icon n="ext" /></Link>}
          <button type="button" className="adr-icon" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon n="x" /></button>
        </div>
      </header>
      {d && manage && <div className="adr-actions">
        {next && <button type="button" className="btn btn-primary" onClick={next.run}>{next.label}</button>}
        <MoveMenu moves={d.moves} onPick={(to) => setDlg({ kind: 'move', to })} />
        {can('apply.message') && <button type="button" className="btn" onClick={() => setDlg({ kind: 'email', preset: 'custom' })}><Icon n="mail" />Email</button>}
        <span className="adr-hint">{d.eligibility === 'ineligible' ? 'Marked ineligible: moving it forward needs a reason.' : d.eligibility === 'not_assessed' || d.eligibility === 'needs_review' ? 'Eligibility is not confirmed yet.' : ''}</span>
      </div>}
      <nav className="adr-tabs" role="tablist" aria-label="Application sections">{TABS.filter((x) => (x !== 'Evaluation' || can('apply.evaluation.manage')) && (x !== 'Emails' || can('apply.message'))).map((x, i) =>
        <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}><small>{String(i + 1).padStart(2, '0')}</small>{x}{x === 'Documents' && d ? <em>{d.files.length}</em> : null}{x === 'Decision' && proposed ? <i className="adr-ping" aria-label="waiting" /> : null}</button>)}</nav>
      <div className="adr-body">
        {err ? <div className="notice n-warn"><div>{err}</div></div> : !d ? <Loading /> : <>
          {tab === 'Overview' && <Overview d={d} decision={decision} />}
          {tab === 'Answers' && <AnswersView d={d} />}
          {tab === 'Documents' && <Documents d={d} />}
          {tab === 'Eligibility' && <Eligibility d={d} manage={manage} onDone={changed} />}
          {tab === 'Evaluation' && <Evaluation d={d} onDone={changed} />}
          {tab === 'Decision' && <DecisionTab d={d} outbox={outbox} me={me.user.id} role={me.user.role} onDone={changed} onEmail={(decisionId) => setDlg({ kind: 'email', preset: 'decision', decisionId })} />}
          {tab === 'Emails' && <section className="adr-card"><div className="adr-card-h"><h3>Emails to this applicant</h3>{can('apply.message') && <button type="button" className="btn btn-sm" onClick={() => setDlg({ kind: 'email', preset: 'custom' })}><Icon n="mail" />Write an email</button>}</div>
            <MessagesTable key={d.events.length} submissionId={d.id} /><p className="adr-note">“Accepted by the email server” means the server took the email; we do not receive delivery receipts, so nothing here claims it was delivered.</p></section>}
          {tab === 'Activity' && <Activity d={d} manage={manage} onDone={changed} />}
        </>}
      </div>
    </div>
    {d && dlg?.kind === 'move' && <MoveDialog d={d} to={dlg.to} onClose={() => setDlg(null)} onDone={async (m) => { setDlg(null); await changed(m); }} />}
    {d && dlg?.kind === 'email' && <EmailDialog d={d} preset={dlg.preset} decisionId={dlg.decisionId} onClose={() => setDlg(null)} onDone={async (m) => { setDlg(null); await changed(m); setTab('Emails'); }} />}
  </div>, document.body);
}

function MoveMenu({ moves, onPick }: { moves: string[]; onPick: (to: string) => void }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const m = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', m); return () => document.removeEventListener('mousedown', m); }, [open]);
  return <div className="adr-menu" ref={ref}>
    <button type="button" className="btn" disabled={!moves.length} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={moves.length ? undefined : 'No status change from here: use the Decision tab'}>Change status<Icon n="chev" width={13} height={13} style={{ transform: 'rotate(90deg)' }} /></button>
    {open && <div className="adr-menu-pop" role="menu">{moves.map((m) => <button key={m} type="button" role="menuitem" className={m === 'withdrawn' ? 'danger' : ''} onClick={() => { setOpen(false); onPick(m); }}>
      <StatusBadge category="stage" status={m} size="sm" /><span>{MOVE_LABEL[m] ?? stageLabel(m)}</span></button>)}</div>}
  </div>;
}

function MoveDialog({ d, to, onClose, onDone }: { d: Detail; to: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const forward = ['under_evaluation', 'shortlisted', 'interview'].includes(to);
  const needReason = to === 'withdrawn' || (forward && d.eligibility === 'ineligible');
  async function run() {
    setBusy(true); setErr('');
    try { await post(`/apply/submissions/${d.id}/status`, { to, reason: reason.trim() }); onDone(`Moved to ${stageLabel(to)}. Recorded in the activity.`); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return <Modal size="sm" title={MOVE_LABEL[to] ?? `Move to ${stageLabel(to)}`} onClose={() => !busy && onClose()} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    <button className={`btn ${to === 'withdrawn' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (needReason && reason.trim().length < 3)} onClick={run}>{busy ? 'Saving…' : 'Confirm'}</button></>}>
    <div className="modal-b stack">
      <div className="adr-move"><StatusBadge category="stage" status={d.status} /><span aria-hidden="true">→</span><StatusBadge category="stage" status={to} /></div>
      {forward && d.eligibility === 'ineligible' && <div className="notice n-warn"><div>This application is marked <b>ineligible</b>. Moving it forward does not change that; say why you are doing it anyway.</div></div>}
      {forward && (d.eligibility === 'not_assessed' || d.eligibility === 'needs_review') && <div className="notice n-info"><div>Eligibility is {d.eligibility === 'needs_review' ? 'flagged for review' : 'not assessed'}. You can confirm it in the Eligibility tab first.</div></div>}
      <label className="field"><span>{needReason ? 'Reason (required, kept in the activity)' : 'Internal note (optional, kept in the activity)'}</span><textarea className="textarea" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
      <small className="muted">The applicant is not notified. To write to them, use Email.</small>
      {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
    </div></Modal>;
}

// ---------------------------------------------------------------- tabs
function Overview({ d, decision }: { d: Detail; decision: string }) {
  const stageAt = OUTCOME[d.status] ? 4 : d.status === 'withdrawn' ? -1 : ['submitted', 'eligibility_review', 'under_evaluation', 'shortlisted'].indexOf(d.status === 'interview' ? 'shortlisted' : d.status);
  const last = d.events[0];
  return <div className="adr-grid">
    <section className="adr-card adr-span">
      <ol className="adr-life" aria-label="Lifecycle">{LIFECYCLE.map(([k, l], i) => <li key={k} className={i < stageAt ? 'done' : i === stageAt ? 'on' : ''}><span>{i < stageAt ? '✓' : i + 1}</span>{l}</li>)}</ol>
      {d.status === 'withdrawn' && <p className="adr-note">This application was withdrawn.</p>}
    </section>
    <section className="adr-card"><h3>Application</h3><dl className="adr-kv">
      <dt>Reference</dt><dd className="mono">{d.reference}</dd>
      <dt>Call</dt><dd><Link to={`/studio/apply/calls/${d.call.id}`}>{d.call.title}</Link></dd>
      <dt>Submitted</dt><dd>{fmtDate(d.submittedAt)}</dd>
      <dt>Form</dt><dd>Version {d.version.number} · {({ en: 'English', fr: 'French', ar: 'Arabic' } as Record<string, string>)[d.lang] ?? d.lang}</dd>
      <dt>Last activity</dt><dd>{last ? `${fmtDate(last.createdAt)} · ${last.actorName ?? 'Applicant'}` : '—'}</dd>
    </dl></section>
    <section className="adr-card"><h3>Applicant</h3><dl className="adr-kv">
      <dt>Name</dt><dd>{d.applicantName || <span className="muted">Not given</span>}</dd>
      <dt>Email</dt><dd>{d.applicantEmail ? <a href={`mailto:${d.applicantEmail}`}>{d.applicantEmail}</a> : <span className="muted">Not given</span>}</dd>
      <dt>Consent</dt><dd>{d.consent.length ? `${d.consent.length} given, ${fmtDate(d.consent[0].at)}` : <span className="muted">None recorded</span>}</dd>
    </dl></section>
    <section className="adr-card"><h3>Where it stands</h3><dl className="adr-kv">
      <dt>Stage</dt><dd><StatusBadge category="stage" status={d.status} /></dd>
      <dt>Eligibility</dt><dd><StatusBadge category="eligibility" status={d.eligibility} />{d.eligibilityOverride ? <small className="muted"> confirmed by {d.eligibilityOverride.byName}</small> : <small className="muted"> automatic</small>}</dd>
      <dt>Reviews</dt><dd>{d.scoreReviews ? `${d.scoreReviews} final · ${pts(d.scoreBp)} / 100${d.disagreement ? ' · reviewers disagree' : ''}` : <span className="muted">No final review yet</span>}</dd>
      <dt>Decision</dt><dd><StatusBadge category="decision" status={decision} /></dd>
    </dl></section>
    {d.call.places ? <section className="adr-card"><h3>Places</h3><p className="adr-big">{d.call.selected} <small>of {d.call.places} selected</small></p></section> : null}
  </div>;
}

function AnswersView({ d }: { d: Detail }) {
  const ev = useMemo(() => evaluate(d.version.definition, d.answers), [d]);
  const [q, setQ] = useState('');
  const fileUrl = (f: { id: string }) => `/studio/api/apply/submissions/${d.id}/files/${f.id}`;
  const show = (f: Field, v: unknown): ReactNode => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return <span className="adr-empty">No answer</span>;
    if (typeof v === 'boolean') return f.type === 'consent' ? (v ? 'Agreed' : 'Not agreed') : v ? 'Yes' : 'No';
    const opt = (x: string) => t(f.config?.options?.find((o) => o.value === x)?.label) || x;
    if (f.type === 'file') return <ul className="adr-files-in">{(v as FileRef[]).map((x) => { const file = d.files.find((y) => y.id === x.id); return <li key={x.id}>{file ? <a href={fileUrl(file)}>{file.name}</a> : x.name}</li>; })}</ul>;
    if (Array.isArray(v)) return <ul className="adr-chips">{(v as string[]).map((x) => <li key={x}>{opt(x)}</li>)}</ul>;
    if (f.type === 'calculated') return `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: f.config?.decimals ?? 2 })}${f.config?.unit ? ` ${f.config.unit}` : ''}`;
    return <span className="adr-pre">{typeof v === 'string' && f.config?.options ? opt(v) : String(v)}</span>;
  };
  const pages = d.version.definition.pages;
  const match = (f: Field) => !q || `${t(f.label)} ${JSON.stringify(d.answers[f.id] ?? '')}`.toLowerCase().includes(q.toLowerCase());
  return <div className="adr-answers">
    <div className="adr-answers-bar">
      <input className="input" type="search" placeholder="Search the answers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the answers" />
      <nav aria-label="Jump to a section">{pages.map((p, i) => <a key={p.id} href={`#adr-sec-${p.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`adr-sec-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{String(i + 1).padStart(2, '0')} {t(p.title)}</a>)}</nav>
      <button type="button" className="btn btn-sm" onClick={() => window.print()}>Print</button>
    </div>
    {pages.map((p, i) => { const fs = p.fields.filter((f) => (FIELD_TYPES[f.type].input || f.type === 'calculated') && match(f)); if (!fs.length) return null;
      const shown = ev.path.includes(p.id);
      return <details key={p.id} id={`adr-sec-${p.id}`} className="adr-sec" open>
        <summary><small>{String(i + 1).padStart(2, '0')}</small>{t(p.title)}{!shown && <em>Not shown to this applicant (form logic)</em>}</summary>
        <dl>{fs.map((f) => { const visible = shown && ev.visibleFields.has(f.id);
          return <div key={f.id} className={visible ? '' : 'hidden-q'}><dt>{t(f.label)}{f.private && <em> · sensitive</em>}</dt>
            <dd>{visible ? show(f, f.type === 'calculated' ? ev.values[f.id] : d.answers[f.id]) : <span className="adr-empty">Not asked: hidden by the form’s logic</span>}</dd></div>; })}</dl>
      </details>; })}
    <p className="adr-note">Exactly as submitted, with form version {d.version.number}. Answers cannot be edited here.</p>
  </div>;
}

function Documents({ d }: { d: Detail }) {
  const [open, setOpen] = useState<string | null>(null);
  const url = (f: { id: string }, inline = false) => `/studio/api/apply/submissions/${d.id}/files/${f.id}${inline ? '?inline=1' : ''}`;
  const field = (fid: string) => t(d.version.definition.pages.flatMap((p) => p.fields).find((x) => x.id === fid)?.label) || fid;
  const viewable = (m: string) => m === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(m);
  const cur = d.files.find((f) => f.id === open);
  if (!d.files.length) return <section className="adr-card"><p className="muted" style={{ margin: 0 }}>This application has no documents.</p></section>;
  return <div className={`adr-docs${cur ? ' viewing' : ''}`}>
    <ul className="adr-doc-list">{d.files.map((f) => <li key={f.id} className={open === f.id ? 'on' : ''}>
      <span className="adr-doc-ico">{f.kind.toUpperCase().slice(0, 4)}</span>
      <span className="adr-doc-t"><b>{f.name}</b><small>{field(f.fieldId)} · {Math.max(1, Math.round(f.bytes / 1024))} KB</small></span>
      <span className="adr-doc-a">{viewable(f.mime) && <button type="button" className="btn btn-sm" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? 'Close' : 'Preview'}</button>}<a className="btn btn-sm btn-ghost" href={url(f)}>Download</a></span></li>)}</ul>
    {cur && <div className="adr-viewer">{cur.mime === 'application/pdf' ? <iframe title={cur.name} src={url(cur, true)} /> : <img src={url(cur, true)} alt={cur.name} />}</div>}
    <p className="adr-note">Files stay private: they open only for signed-in staff allowed to read applications, and every view or download is recorded in the activity.</p>
  </div>;
}

function Eligibility({ d, manage, onDone }: { d: Detail; manage: boolean; onDone: (m: string) => void }) {
  const [result, setResult] = useState(d.eligibilityOverride?.result ?? d.eligibility); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  async function save(body: unknown, msg: string) { setBusy(true); try { await post(`/apply/submissions/${d.id}/eligibility`, body); setReason(''); onDone(msg); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  return <div className="adr-grid">
    <section className="adr-card adr-span"><h3>Who can apply to this call</h3>
      {d.call.eligibility.length ? <ul className="adr-crit">{d.call.eligibility.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="muted">The call lists no conditions.</p>}</section>
    <section className="adr-card"><h3>Automatic check</h3>
      <p><StatusBadge category="eligibility" status={d.eligibilityAuto.result} /> <small className="muted">from the form’s rules, version {d.eligibilityAuto.formVersion}</small></p>
      {d.eligibilityAuto.reasons.length ? <ul className="adr-reasons">{d.eligibilityAuto.reasons.map((r, i) => <li key={i}>{r.en}</li>)}</ul> : <p className="muted">No rule flagged anything.</p>}
      <p className="adr-note">Nobody is rejected automatically: staff confirm.</p></section>
    <section className="adr-card"><h3>Staff assessment</h3>
      {d.eligibilityOverride ? <p><StatusBadge category="eligibility" status={d.eligibilityOverride.result} /> by {d.eligibilityOverride.byName}, {fmtDate(d.eligibilityOverride.at)}<q className="adr-q">{d.eligibilityOverride.reason}</q></p> : <p className="muted">Not confirmed by staff yet.</p>}
      {manage && <div className="stack">
        <div className="adr-seg" role="radiogroup" aria-label="Assessment">{(['eligible', 'needs_review', 'ineligible'] as const).map((k) => <label key={k} className={result === k ? 'on' : ''}><input type="radio" name="elig" checked={result === k} onChange={() => setResult(k)} /><StatusBadge category="eligibility" status={k} size="sm" /></label>)}</div>
        <label className="field"><span>Reason (required, kept with the assessment)</span><textarea className="textarea" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="ap-row"><button type="button" className="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 3} onClick={() => save({ result, reason: reason.trim() }, 'Eligibility confirmed')}>Confirm eligibility</button>
          {d.eligibilityOverride && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => save({ clear: true }, 'Back to the automatic result')}>Back to automatic</button>}</div>
      </div>}</section>
  </div>;
}

function Evaluation({ d, onDone }: { d: Detail; onDone: (m: string) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Review[] | null>(null); const [pool, setPool] = useState<{ id: string; name: string; email: string }[]>([]); const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false);
  const [rubric, setRubric] = useState<boolean | null>(null);
  const load = useCallback(() => api<Review[]>(`/apply/submissions/${d.id}/reviews`).then(setRows).catch(() => setRows([])), [d.id]);
  useEffect(() => { void load(); api('/apply/reviewers').then(setPool).catch(() => {}); api(`/apply/calls/${d.call.id}/rubric`).then((r) => setRubric(!!r.publishedVersionId)).catch(() => setRubric(null)); }, [load]);
  const assigned = new Set((rows ?? []).map((r) => r.reviewer));
  async function assign() { setBusy(true); try { const r = await post<{ created: number }>(`/apply/calls/${d.call.id}/assignments`, { submissionIds: [d.id], reviewerIds: [pick] }); setPick(''); await load(); onDone(r.created ? 'Reviewer assigned' : 'Already assigned'); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  async function remove(id: string) { setBusy(true); try { await del(`/apply/assignments/${id}`); await load(); onDone('Assignment removed'); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  if (!rows) return <Loading />;
  const finals = rows.filter((r) => r.reviewStatus === 'final');
  return <div className="adr-grid">
    <section className="adr-card adr-span"><div className="adr-card-h"><h3>Reviewers</h3><span className="muted">{finals.length} of {rows.length} final</span></div>
      {rubric === false && <div className="notice n-info"><div>Publish this call’s scoring rubric before assigning reviewers: <Link to={`/studio/apply/calls/${d.call.id}/reviews?tab=rubric`}>open the rubric</Link>.</div></div>}
      {rows.length ? <ul className="adr-revs">{rows.map((r) => <li key={r.assignmentId}><b>{r.reviewer}</b>
        <span>{r.status === 'conflict' ? <span className="stb stb-red stb-sm"><span>Conflict of interest</span></span> : r.reviewStatus === 'final' ? <span className="stb stb-green stb-sm"><span>Final · {pts(r.totalBp)} / 100</span></span> : r.reviewStatus === 'draft' ? <span className="stb stb-violet stb-sm"><span>Draft</span></span> : <span className="stb stb-neutral stb-sm"><span>Not started</span></span>}</span>
        {r.reviewStatus !== 'final' && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => remove(r.assignmentId)}>Remove</button>}</li>)}</ul> : <p className="muted">No reviewer assigned yet.</p>}
      {rubric !== false && <div className="ap-row"><select className="select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Reviewer"><option value="">Choose a reviewer…</option>{pool.filter((p) => !assigned.has(p.name)).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.email}</option>)}</select>
        <button type="button" className="btn btn-sm" disabled={!pick || busy} onClick={assign}>Assign</button></div>}
    </section>
    {finals.map((r) => <section key={r.assignmentId} className="adr-card"><div className="adr-card-h"><h3>{r.reviewer}</h3><b>{pts(r.totalBp)} / 100</b></div>
      <dl className="adr-kv">{r.criteria.map((c) => <div key={c.id} style={{ display: 'contents' }}><dt>{c.label}</dt><dd>{r.scores?.[c.id] ?? '—'} / {c.max}{r.comments?.[c.id] ? <q className="adr-q">{r.comments[c.id]}</q> : null}</dd></div>)}
        <dt>Recommendation</dt><dd>{({ yes: 'Recommend', maybe: 'Maybe', no: 'Do not recommend' } as Record<string, string>)[r.recommendation ?? ''] ?? '—'}{r.overallComment ? <q className="adr-q">{r.overallComment}</q> : null}</dd></dl></section>)}
    <p className="adr-note adr-span">Scores come only from final reviews, computed on the server from the rubric version each reviewer used.</p>
  </div>;
}

function DecisionTab({ d, outbox, me, role, onDone, onEmail }: { d: Detail; outbox: Set<string>; me: string; role: string; onDone: (m: string) => void; onEmail: (decisionId: string) => void }) {
  const can = useCan(); const toast = useToast();
  const [outcome, setOutcome] = useState('selected'); const [reason, setReason] = useState(''); const [sure, setSure] = useState(false); const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false); const [note, setNote] = useState('');
  const proposed = d.decisions.find((x) => x.status === 'proposed');
  const decided = d.decisions.find((x) => x.status === 'approved');
  const canPropose = can('apply.submission.manage') && DECIDABLE.includes(d.status) && !proposed;
  const canDecide = can('apply.decide');
  const selfOk = role === 'super_admin';
  const full = !!d.call.places && d.call.selected >= d.call.places;
  const confirmText = outcome === 'selected' ? 'I confirm that this applicant is selected for this call.' : outcome === 'not_selected' ? 'I confirm that this application will be marked Not selected.' : 'I confirm that this applicant goes on the waiting list.';
  async function decide(ids: string[], approve: boolean, n = note) {
    await post('/apply/decisions/decide', { ids, approve, note: n, confirm: ids.length, ...(over ? { overCapacity: true } : {}) });
  }
  async function submit(now: boolean) {
    setBusy(true);
    try {
      await post('/apply/decisions', { ids: [d.id], outcome, reason: reason.trim(), confirm: 1 });
      if (now) {
        const fresh = await api<Detail>(`/apply/submissions/${d.id}`);
        const p = fresh.decisions.find((x) => x.status === 'proposed');
        if (p) { try { await decide([p.id], true, over ? note : ''); } catch (e) { toast(`Proposed, but not approved: ${errText(e)}`, true); onDone('Decision proposed'); return; } }
        onDone(`${OUTCOME[outcome]}: decision approved and recorded.`);
      } else onDone('Proposed. Someone else approves it.');
      setReason(''); setSure(false);
    } catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  }
  async function act(approve: boolean) {
    if (!proposed) return; setBusy(true);
    try { await decide([proposed.id], approve, approve ? (over ? note : '') : note); setNote(''); onDone(approve ? 'Decision approved and recorded.' : 'Decision rejected; the application keeps its stage.'); }
    catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  }
  async function back() { setBusy(true); try { await post(`/apply/submissions/${d.id}/status`, { to: 'under_evaluation', reason: reason.trim() || 'Returned for further review' }); onDone('Returned to In review'); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }
  return <div className="adr-grid">
    <section className="adr-card adr-span adr-dec-sum">
      <div><small>Eligibility</small><StatusBadge category="eligibility" status={d.eligibility} /></div>
      <div><small>Evaluation</small><b>{d.scoreReviews ? `${pts(d.scoreBp)} / 100` : '—'}</b><small>{d.scoreReviews ? `${d.scoreReviews} final review${d.scoreReviews === 1 ? '' : 's'}${d.disagreement ? ' · disagreement' : ''}` : 'no final review'}</small></div>
      <div><small>Stage</small><StatusBadge category="stage" status={d.status} /></div>
      {d.call.places ? <div><small>Places</small><b>{d.call.selected} / {d.call.places}</b><small>{full ? 'full' : `${d.call.places - d.call.selected} left`}</small></div> : null}
    </section>
    {decided && <section className="adr-card adr-span adr-decided">
      <StatusBadge category="decision" status={decided.outcome} /><p>Approved by {decided.decider ?? '—'} on {decided.decidedAt ? fmtDate(decided.decidedAt) : '—'}. Proposed by {decided.proposer ?? '—'}: “{decided.reason}”</p>
      {decided.notifiedAt ? <p className="muted">The applicant was emailed on {fmtDate(decided.notifiedAt)}.</p>
        : outbox.has(decided.id) ? <p className="muted">The {OUTCOME[decided.outcome].toLowerCase()} email is in the outbox: follow it in Emails.</p>
        : can('apply.message') ? <button type="button" className="btn btn-primary" onClick={() => onEmail(decided.id)}><Icon n="mail" />Preview and send the {OUTCOME[decided.outcome].toLowerCase()} email</button> : <p className="muted">Not emailed yet.</p>}
    </section>}
    {proposed && <section className="adr-card adr-span adr-proposed">
      <h3>Waiting for approval: <StatusBadge category="decision" status={proposed.outcome} /></h3>
      <p>Proposed by {proposed.proposer ?? '—'} on {fmtDate(proposed.createdAt)}: “{proposed.reason}”</p>
      {canDecide && (proposed.proposedBy !== me || selfOk) ? <div className="stack">
        {proposed.outcome === 'selected' && full && <label className="ap-check"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />Select beyond the {d.call.places} places (needs a note)</label>}
        <label className="field"><span>Note (required to reject{over ? ' or to go over the places' : ''})</span><textarea className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="ap-row"><button type="button" className="btn btn-primary" disabled={busy || (over && note.trim().length < 3)} onClick={() => act(true)}>Approve decision</button>
          <button type="button" className="btn" disabled={busy || note.trim().length < 3} onClick={() => act(false)}>Reject</button></div>
      </div> : <p className="muted">{proposed.proposedBy === me ? 'You proposed it: someone else with the right to decide approves or rejects it.' : 'You cannot approve decisions.'}</p>}
    </section>}
    {canPropose && <section className="adr-card adr-span"><h3>Decide</h3>
      <div className="adr-outcomes" role="radiogroup" aria-label="Decision">{(['selected', 'waitlisted', 'not_selected'] as const).map((k) => <label key={k} className={`adr-outcome o-${k}${outcome === k ? ' on' : ''}`}>
        <input type="radio" name="outcome" checked={outcome === k} onChange={() => { setOutcome(k); setSure(false); }} /><StatusBadge category="decision" status={k} /><small>{k === 'selected' ? 'Approve: the applicant is selected' : k === 'waitlisted' ? 'On the waiting list' : 'Not selected this time'}</small></label>)}</div>
      {outcome === 'selected' && full && <div className="notice n-warn"><div>All {d.call.places} places are taken. Approving needs an explicit override with a note.</div></div>}
      {outcome === 'selected' && full && selfOk && canDecide && <label className="ap-check"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />Select beyond the places</label>}
      {over && <label className="field"><span>Why go over the places (kept with the decision)</span><textarea className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
      <label className="field"><span>Reason (kept with the decision; not shown to the applicant)</span><textarea className="textarea" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="ap-check adr-confirm"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />{confirmText}</label>
      <div className="ap-row">
        {selfOk && canDecide ? <button type="button" className="btn btn-primary" disabled={busy || !sure || reason.trim().length < 3 || (over && note.trim().length < 3)} onClick={() => submit(true)}>{busy ? 'Saving…' : `Approve: ${OUTCOME[outcome]}`}</button>
          : <button type="button" className="btn btn-primary" disabled={busy || !sure || reason.trim().length < 3} onClick={() => submit(false)}>{busy ? 'Saving…' : 'Propose for approval'}</button>}
        {d.status !== 'under_evaluation' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={back}>Return for further review</button>}
      </div>
      <p className="adr-note">{selfOk ? 'As Super Administrator you can approve your own decision; it is recorded as proposed and approved by you.' : 'Someone else with the right to decide must approve it.'} Nothing is emailed until you choose to send it.</p>
    </section>}
    {!decided && !proposed && !canPropose && <section className="adr-card adr-span"><p className="muted" style={{ margin: 0 }}>{d.status === 'withdrawn' ? 'This application was withdrawn.' : 'A decision can be taken once the application is In review, Shortlisted or at Interview.'}</p></section>}
    {d.decisions.length > 0 && <section className="adr-card adr-span"><h3>Decision history</h3><ol className="timeline">{d.decisions.map((x) => <li key={x.id}><b>{OUTCOME[x.outcome]} · {({ proposed: 'waiting for approval', approved: 'approved', rejected: 'rejected', withdrawn: 'withdrawn' } as Record<string, string>)[x.status] ?? x.status}</b>
      <q>{x.reason}</q>{x.decisionNote && <q>{x.decisionNote}</q>}<small>{x.proposer ?? '—'} · {fmtDate(x.createdAt)}{x.decidedAt ? ` → ${x.decider ?? '—'} · ${fmtDate(x.decidedAt)}` : ''}{x.notifiedAt ? ` · emailed ${fmtDate(x.notifiedAt)}` : ''}</small></li>)}</ol></section>}
  </div>;
}

function Activity({ d, manage, onDone }: { d: Detail; manage: boolean; onDone: (m: string) => void }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  const EV: Record<string, string> = { email: 'Email', decision: 'Decision', submitted: 'Submitted by the applicant', status: 'Stage changed', eligibility: 'Eligibility', note: 'Note', download: 'Document opened' };
  const what = (e: Detail['events'][number]) => e.kind === 'status' ? `${stageLabel(e.fromValue ?? '')} → ${stageLabel(e.toValue ?? '')}` : e.kind === 'decision' ? (e.toValue ?? '').replace(':', ' · ').replace('_', ' ') : e.kind === 'eligibility' ? `${e.fromValue ?? ''} → ${e.toValue ?? ''}`.replace(/_/g, ' ') : e.kind === 'download' ? String(e.meta?.name ?? '') : '';
  return <section className="adr-card">
    {manage && <div className="adr-note-f"><textarea className="textarea" rows={2} maxLength={5000} placeholder="Internal note (never shown to the applicant)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className="btn btn-sm" disabled={!note.trim() || busy} onClick={async () => { setBusy(true); try { await post(`/apply/submissions/${d.id}/notes`, { body: note.trim() }); setNote(''); onDone('Note added'); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }}>Add note</button></div>}
    <ol className="timeline">{d.events.map((e) => <li key={e.id}><b>{EV[e.kind] ?? e.kind}{what(e) ? `: ${what(e)}` : ''}</b>{e.body && <q>{e.body}</q>}<small>{e.actorName ?? (e.kind === 'submitted' ? 'Applicant' : 'System')} · {fmtDate(e.createdAt)}</small></li>)}</ol>
  </section>;
}

// ---------------------------------------------------------------- email
function EmailDialog({ d, preset, decisionId, onClose, onDone }: { d: Detail; preset: 'custom' | 'decision'; decisionId?: string; onClose: () => void; onDone: (m: string) => void }) {
  const toast = useToast();
  const dec = decisionId ? d.decisions.find((x) => x.id === decisionId) : undefined;
  const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [pv, setPv] = useState<{ to: string; subject: string; body: string } | null>(null); const [busy, setBusy] = useState(false); const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => { api('/apply/overview').then((o) => setReady(o.outbox?.ready ?? null)).catch(() => {}); }, []);
  useEffect(() => { if (dec) post<{ to: string; subject: string; body: string }>('/apply/messages/preview', { submissionId: d.id, key: TEMPLATE_OF[dec.outcome] }).then(setPv).catch((e) => toast(errText(e), true)); }, [dec?.id]);
  async function preview() { try { setPv(await post('/apply/messages/preview', { submissionId: d.id, subject, body })); } catch (e) { toast(errText(e), true); } }
  async function send() {
    setBusy(true);
    try {
      if (dec) await post('/apply/messages/decisions', { callId: d.call.id, decisionIds: [dec.id], confirm: 1 });
      else await post('/apply/messages/custom', { callId: d.call.id, submissionIds: [d.id], subject, body, confirm: 1 });
      onDone(ready === false ? 'Queued. It will be sent when email sending is set up (Settings → Email).' : 'Queued. Follow its delivery in Emails.');
    } catch (e) { toast(errText(e), true); setBusy(false); }
  }
  return <Modal title={dec ? `${OUTCOME[dec.outcome]} email` : 'Email the applicant'} onClose={() => !busy && onClose()} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    {!dec && <button className="btn" disabled={busy || subject.trim().length < 3 || body.trim().length < 10} onClick={preview}>Preview</button>}
    <button className="btn btn-primary" disabled={busy || !pv || (!dec && (subject.trim().length < 3 || body.trim().length < 10))} onClick={send}>{busy ? 'Queuing…' : 'Send'}</button></>}>
    <div className="modal-b stack">
      {ready === false && <div className="notice n-warn"><div>Email sending isn’t set up yet: the email waits in the outbox and goes out once it is (Settings → Email).</div></div>}
      <div className="adr-to"><small>To</small><b>{d.applicantName}</b><span>{d.applicantEmail}</span></div>
      {dec ? <p className="muted" style={{ margin: 0 }}>The text comes from this call’s “{OUTCOME[dec.outcome]}” template in the applicant’s language ({d.lang.toUpperCase()}). Edit it in the call’s Emails tab.</p> : <>
        <label className="field"><span>Subject</span><input className="input" maxLength={200} value={subject} onChange={(e) => { setSubject(e.target.value); setPv(null); }} /></label>
        <label className="field"><span>Message</span><textarea className="textarea" rows={7} maxLength={10000} value={body} onChange={(e) => { setBody(e.target.value); setPv(null); }} /></label>
        <small className="muted">You can use {'{{applicant_name}} {{reference}} {{call_title}} {{contact_email}} {{submitted_date}}'}. Preview before sending.</small></>}
      {pv && <div className="adr-preview"><small>Preview, exactly as it will be sent</small><b>{pv.subject}</b><pre>{pv.body}</pre></div>}
      <small className="muted">One email, to this applicant only. The same decision email is never queued twice.</small>
    </div></Modal>;
}
