// AFCD Apply → Messages (every call's outbox, Studio's default templates) and each call's Emails tab: the outbox (delivery status, retries), sending (decision emails for approved decisions,
// messages to chosen applicants), email templates with {{variables}}, and the per-call receipt switch. Every send goes
// through the queue, one email per applicant, after a confirmed count.
import { useCallback, useEffect, useState } from 'react';
import { api, del, post, put, ApiError } from '../api.ts';
import { Link, Modal, fmtDate, navigate, useToast } from '../ui.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import { APP_STATUS } from './Submissions.tsx';
import './evaluation.css';

const errText = (e: unknown) => (e instanceof ApiError && e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : (e as Error).message);
type Msg = { id: string; kind: string; toEmail: string; subject: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string; nextAttemptAt: string; reference: string; submissionId: string };
const KIND: Record<string, string> = { receipt: 'Receipt', decision: 'Decision', custom: 'Message' };
const STATUS: Record<string, string> = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled' };

function NotReady() {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => { api('/apply/overview').then((o) => setReady(o.outbox?.ready ?? null)).catch(() => {}); }, []);
  return ready === false ? <div className="notice n-warn"><div>Email sending isn’t set up, so emails wait in the outbox. An administrator can set it up in Settings → Email.</div></div> : null;
}

/** Messages: every email to applicants, across calls, and the default texts each call starts from. Writing to applicants happens in a call. */
export function MessagesPage() {
  const [call, setCall] = useState(''); const [tab, setTab] = useState('outbox');
  const [calls, setCalls] = useState<{ id: string; reference: string; title: string; status: string }[]>([]);
  useEffect(() => { api('/apply/calls').then((r) => setCalls(r.filter((c: { status: string }) => ['open', 'paused', 'closed', 'under_evaluation', 'completed'].includes(c.status)))).catch(() => {}); }, []);
  return <>
    <div className="page-h"><div><h1>Messages</h1><p>Emails to applicants go through Studio’s email server, one per applicant, from a queue that retries and records delivery. To write to applicants, open a call’s Emails tab.</p></div>
      {calls.length > 0 && <select className="select ev-pick" value="" onChange={(e) => e.target.value && navigate(`/studio/apply/calls/${e.target.value}/emails?tab=send`)} aria-label="Write to the applicants of a call"><option value="">Write to applicants of…</option>{calls.map((c) => <option key={c.id} value={c.id}>{c.reference} · {c.title}</option>)}</select>}</div>
    <NotReady />
    <section className="card">
      <div className="ev-bar"><div className="in-tabs ev-tabs" role="tablist">{[['outbox', 'Outbox'], ['templates', 'Default texts']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'outbox' && <select className="select ev-pick" value={call} onChange={(e) => setCall(e.target.value)} aria-label="Call"><option value="">All calls</option>{calls.map((c) => <option key={c.id} value={c.id}>{c.reference} · {c.title}</option>)}</select>}</div>
      {tab === 'outbox' ? <MessagesTable key={call} callId={call || undefined} /> : <Templates callId="" defaultOnly />}
    </section>
  </>;
}

/** A call's Emails tab: its outbox, sending results and messages, and its own email texts. */
export function CallEmails({ callId }: { callId: string }) {
  const [tab, setTab] = useState(() => { const t = new URLSearchParams(location.search).get('tab'); return t === 'send' || t === 'templates' ? t : 'outbox'; });
  return <>
    <NotReady />
    <section className="card">
      <div className="ev-bar"><div className="in-tabs ev-tabs" role="tablist">{[['outbox', 'Outbox'], ['send', 'Send'], ['templates', 'Email texts']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      {tab === 'outbox' ? <Outbox callId={callId} /> : tab === 'send' ? <Send callId={callId} /> : <Templates callId={callId} />}
    </section>
  </>;
}

export function MessagesTable({ callId, submissionId }: { callId?: string; submissionId?: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Msg[] | null>(null); const [status, setStatus] = useState(''); const [open, setOpen] = useState<null | { to: string; subject: string; body: string; lastError: string | null }>(null);
  const load = useCallback(() => api<Msg[]>(`/apply/messages?${new URLSearchParams(Object.entries({ call: callId ?? '', submission: submissionId ?? '', status }).filter(([, v]) => v)).toString()}`).then(setRows).catch((e) => { setRows([]); toast(e.message, true); }), [callId, submissionId, status]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, a: 'retry' | 'cancel') => { try { await post(`/apply/messages/${id}/${a}`); toast(a === 'retry' ? 'Queued again.' : 'Cancelled.'); await load(); } catch (e) { toast(errText(e), true); } };
  if (!rows) return <Loading />;
  return <>
    {!submissionId && <div className="ev-pad ap-row"><select className="select ev-pick" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Every status</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><button className="btn btn-sm" onClick={() => void load()}>Refresh</button></div>}
    {!rows.length ? <p className="sb-empty">No emails{status ? ' with this status' : ''} yet.</p> : <div className="sb-scroll"><table className="table sb-table"><thead><tr><th>Email</th>{!submissionId && <th>Application</th>}<th>Status</th><th className="r">When</th><th /></tr></thead><tbody>
      {rows.map((m) => <tr key={m.id}><td><button className="linkish" onClick={async () => setOpen(await api(`/apply/messages/${m.id}`))}>{m.subject}</button><small>{KIND[m.kind]} · {m.toEmail}</small></td>
        {!submissionId && <td><Link to={`/studio/apply/applicants/${m.submissionId}`} className="mono sb-ref">{m.reference}</Link></td>}
        <td><span className={`badge cm-${m.status}`}>{STATUS[m.status] ?? m.status}</span>{m.lastError && <small className="cm-err" title={m.lastError}>{m.lastError}</small>}{m.status === 'queued' && m.attempts > 0 && <small>Retry {fmtDate(m.nextAttemptAt)}</small>}</td>
        <td className="r"><small>{m.sentAt ? `Sent ${fmtDate(m.sentAt)}` : `Queued ${fmtDate(m.createdAt)}`}</small><small>{m.attempts} attempt{m.attempts === 1 ? '' : 's'}</small></td>
        <td className="r">{m.status === 'failed' && <button className="btn btn-sm" onClick={() => act(m.id, 'retry')}>Retry</button>}{['queued', 'failed'].includes(m.status) && <button className="btn btn-sm btn-ghost" onClick={() => act(m.id, 'cancel')}>Cancel</button>}</td></tr>)}</tbody></table></div>}
    {open && <Modal title={open.subject} onClose={() => setOpen(null)}><div className="modal-b stack"><small className="muted">To {open.to}</small><pre className="cm-body">{open.body}</pre>{open.lastError && <div className="notice n-warn"><div>{open.lastError}</div></div>}</div></Modal>}
  </>;
}
const Outbox = ({ callId }: { callId: string }) => <MessagesTable callId={callId} />;

function ConfirmSend({ n, title, sample, onClose, onRun }: { n: number; title: string; sample: { to: string; subject: string; body: string } | null; onClose: () => void; onRun: () => Promise<void> }) {
  const [count, setCount] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title={title} onClose={() => !busy && onClose()} footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || Number(count) !== n} onClick={async () => { setBusy(true); try { await onRun(); } finally { setBusy(false); } }}>{busy ? 'Queuing…' : `Queue ${n} email${n === 1 ? '' : 's'}`}</button></>}>
    <div className="modal-b stack">{sample && <><small className="muted">Example, for the first applicant ({sample.to}):</small><b>{sample.subject}</b><pre className="cm-body">{sample.body}</pre></>}
      <p style={{ margin: 0 }}>Each applicant gets their own email; nobody sees other recipients. Emails already sent for the same purpose are not sent again.</p>
      <label className="field"><span>Type {n} to confirm</span><input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} /></label></div></Modal>;
}

function Send({ callId }: { callId: string }) {
  const toast = useToast();
  const [decisions, setDecisions] = useState<{ id: string; outcome: string; reference: string; applicantName: string; notifiedAt: string | null; submissionId: string }[] | null>(null);
  const [selD, setSelD] = useState<Set<string>>(new Set());
  const [receipt, setReceipt] = useState<boolean | null>(null);
  const [status, setStatus] = useState('shortlisted'); const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [dlg, setDlg] = useState<null | { kind: 'decisions' | 'custom'; n: number; ids: string[]; sample: { to: string; subject: string; body: string } | null }>(null);
  const load = useCallback(async () => {
    setDecisions((await api(`/apply/decisions?call=${callId}&status=approved`)).filter((d: { notifiedAt: string | null }) => !d.notifiedAt));
    setReceipt((await api(`/apply/calls/${callId}`)).receiptEnabled ?? false);
  }, [callId]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  async function recipients() {
    const ids: string[] = []; let cursor = '';
    do { const r = await api<{ items: { id: string }[]; next: string | null }>(`/apply/submissions?call=${callId}&status=${status}&limit=100${cursor ? `&cursor=${cursor}` : ''}`); ids.push(...r.items.map((x) => x.id)); cursor = r.next ?? ''; } while (cursor && ids.length < 2000);
    return ids;
  }
  const OUT: Record<string, string> = { selected: 'Selected', waitlisted: 'Waitlisted', not_selected: 'Not selected' };
  return <div className="ev-pad stack">
    <label className="ap-check"><input type="checkbox" checked={!!receipt} disabled={receipt === null} onChange={async (e) => { try { const r = await put<{ enabled: boolean }>(`/apply/calls/${callId}/receipts`, { enabled: e.target.checked }); setReceipt(r.enabled); toast(r.enabled ? 'Applicants now get a receipt email after applying.' : 'Receipts are off.'); } catch (x) { toast(errText(x), true); } }} />
      Send a receipt email after each application (template “Receipt after applying”)</label>
    <div className="cm-box"><h3>Decision emails</h3><p className="muted">Approved decisions not sent yet. The text comes from the decision templates in the applicant’s language.</p>
      {!decisions ? <Loading /> : !decisions.length ? <p className="muted">No approved decision is waiting to be sent.</p> : <>
        <table className="ap-t"><tbody>{decisions.map((d) => <tr key={d.id}><td><label className="ap-check"><input type="checkbox" checked={selD.has(d.id)} onChange={(e) => setSelD((x) => { const n = new Set(x); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} /><span className="mono">{d.reference}</span> {d.applicantName}</label></td><td className="r"><b>{OUT[d.outcome]}</b></td></tr>)}</tbody></table>
        <div className="ap-row"><button className="btn btn-sm" onClick={() => setSelD(new Set(decisions.map((d) => d.id)))}>Select all</button><span style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" disabled={!selD.size} onClick={async () => { const first = decisions.find((d) => selD.has(d.id))!; const sample = await post('/apply/messages/preview', { submissionId: first.submissionId, key: `decision_${first.outcome}` }); setDlg({ kind: 'decisions', n: selD.size, ids: [...selD], sample }); }}>Send {selD.size || ''} decision email{selD.size === 1 ? '' : 's'}…</button></div></>}</div>
    <div className="cm-box"><h3>Message to applicants</h3><p className="muted">Write to every application at one stage of this call. Variables: {'{{applicant_name}} {{call_title}} {{reference}} {{contact_email}} {{submitted_date}}'}.</p>
      <label className="field"><span>Applications at this stage</span><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(APP_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field"><span>Subject</span><input className="input" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="field"><span>Message</span><textarea className="textarea" rows={6} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="ap-row"><span style={{ flex: 1 }} /><button className="btn btn-primary btn-sm" disabled={subject.trim().length < 3 || body.trim().length < 10} onClick={async () => {
        try { const ids = await recipients(); if (!ids.length) { toast('No application is at this stage.', true); return; } const sample = await post('/apply/messages/preview', { submissionId: ids[0], subject, body }); setDlg({ kind: 'custom', n: ids.length, ids, sample }); } catch (e) { toast(errText(e), true); } }}>Review and send…</button></div></div>
    {dlg && <ConfirmSend n={dlg.n} title={dlg.kind === 'decisions' ? 'Send decision emails' : 'Send this message'} sample={dlg.sample} onClose={() => setDlg(null)} onRun={async () => {
      try {
        const r = dlg.kind === 'decisions' ? await post<{ queued: number; skippedNoEmail?: number }>('/apply/messages/decisions', { callId, decisionIds: dlg.ids, confirm: dlg.n })
          : await post<{ queued: number; skippedNoEmail: number }>('/apply/messages/custom', { callId, submissionIds: dlg.ids, subject, body, confirm: dlg.n });
        toast(`${r.queued} email(s) queued.${r.skippedNoEmail ? ` ${r.skippedNoEmail} application(s) have no valid email address.` : ''} Follow them in the Outbox.`);
        setDlg(null); setSelD(new Set()); if (dlg.kind === 'custom') { setSubject(''); setBody(''); } await load();
      } catch (e) { toast(errText(e), true); }
    }} />}
  </div>;
}

type Tpl = { key: string; label: string; variants: Record<'en' | 'fr' | 'ar', { subject: string; body: string }>; source: string; rev: number; defaultRev: number };
function Templates({ callId, defaultOnly }: { callId: string; defaultOnly?: boolean }) {
  const toast = useToast();
  const [scope, setScope] = useState<'call' | 'default'>(defaultOnly ? 'default' : 'call');
  const [data, setData] = useState<{ variables: Record<string, string>; templates: Tpl[] } | null>(null); const [edit, setEdit] = useState<Tpl | null>(null); const [busy, setBusy] = useState(false);
  const q = scope === 'call' ? `?call=${callId}` : '?call=default';
  const load = useCallback(() => api(`/apply/email-templates${q}`).then(setData), [q]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  if (!data) return <Loading />;
  const SRC: Record<string, string> = { call: 'This call’s own text', default: 'Studio default', 'built-in': 'Built-in text' };
  return <div className="ev-pad stack">
    {!defaultOnly && <div className="ap-row"><select className="select ev-pick" value={scope} onChange={(e) => setScope(e.target.value as 'call')} aria-label="Which templates"><option value="call">Templates for this call</option><option value="default">Studio defaults (every call)</option></select></div>}
    <table className="ap-t"><tbody>{data.templates.map((t) => <tr key={t.key}><td><b>{t.label}</b><small>{t.variants.en.subject}</small></td><td className="r"><small>{SRC[t.source]}</small>
      <button className="btn btn-sm" onClick={() => setEdit(JSON.parse(JSON.stringify(t)))}>Edit</button>
      {scope === 'call' && t.source === 'call' && <button className="btn btn-sm btn-ghost" onClick={async () => { await del(`/apply/email-templates/${t.key}?call=${callId}`); toast('This call uses the default text again.'); await load(); }}>Use default</button>}</td></tr>)}</tbody></table>
    {edit && <Modal wide={false} title={`${edit.label}${scope === 'call' ? ' (this call)' : ' (Studio default)'}`} onClose={() => !busy && setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await put(`/apply/email-templates/${edit.key}${q}`, { variants: edit.variants, rev: scope === 'call' ? (edit.source === 'call' ? edit.rev : 0) : edit.defaultRev }); toast('Template saved.'); setEdit(null); await load(); }
      catch (e) { toast(errText(e), true); } finally { setBusy(false); } }}>Save</button></>}>
      <div className="modal-b stack"><small className="muted">Variables: {Object.keys(data.variables).map((v) => `{{${v}}}`).join(' ')}. They are filled in as plain text.</small>
        {(['en', 'fr', 'ar'] as const).map((l) => <div key={l} className="cm-box" dir={l === 'ar' ? 'rtl' : undefined}><b>{l === 'en' ? 'English' : l === 'fr' ? 'Français' : 'العربية'}</b>
          <input className="input" maxLength={200} value={edit.variants[l]?.subject ?? ''} onChange={(e) => setEdit({ ...edit, variants: { ...edit.variants, [l]: { ...edit.variants[l], subject: e.target.value } } })} aria-label={`Subject (${l})`} />
          <textarea className="textarea" rows={7} maxLength={10000} value={edit.variants[l]?.body ?? ''} onChange={(e) => setEdit({ ...edit, variants: { ...edit.variants, [l]: { ...edit.variants[l], body: e.target.value } } })} aria-label={`Message (${l})`} /></div>)}</div></Modal>}
  </div>;
}
