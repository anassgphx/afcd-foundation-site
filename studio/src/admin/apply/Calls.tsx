// AFCD Apply → Calls: the list and the call editor. The server decides every transition; this screen shows only the
// actions it allows for this role and status, and asks for a reason where the history needs one.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Icon, Link, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, ListEditor, Section, SectionNav } from '../Editor.tsx';
import { DataTable, EmptyState, ListToolbar, TableSkeleton, useUrlState, type Column } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from '../pages/Media.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import { CALL_STATUS, CALL_TYPES, CallBadge, ZONES, inZone, relative, typeLabel } from './shared.tsx';

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const RELEASED = ['scheduled', 'open', 'paused', 'closed', 'under_evaluation', 'completed'];

type Row = { id: string; reference: string; slug: string; title: string; callType: string; status: string; opensAt: string | null; closesAt: string | null; timeZone: string;
  location: string; format: string; places: number | null; unlisted: boolean; updatedAt: string; pillarName: string | null; projectName: string | null };

const GROUPS: [string, string, (s: string) => boolean][] = [
  ['all', 'All', (s) => s !== 'archived'], ['open', 'Open', (s) => s === 'open' || s === 'paused'], ['scheduled', 'Scheduled', (s) => s === 'scheduled' || s === 'approved'],
  ['in_review', 'In review', (s) => s === 'in_review'], ['draft', 'Drafts', (s) => s === 'draft' || s === 'changes_requested'],
  ['closed', 'Closed', (s) => ['closed', 'under_evaluation', 'completed'].includes(s)], ['archived', 'Archived', (s) => s === 'archived'],
];
// links from the overview use plain statuses
const groupOf = (k: string) => (k === 'under_evaluation' ? 'closed' : GROUPS.some((g) => g[0] === k) ? k : 'all');

export function CallsList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [st, set] = useUrlState({ status: 'all', q: '', new: '' });
  const [gone, setGone] = useState<{ row: Row; restore: boolean } | null>(null);
  const load = () => api<Row[]>('/apply/calls').then(setRows).catch((e) => { setRows([]); toast(e.message, true); });
  useEffect(() => { load(); }, []);
  const tab = groupOf(st.status);
  const base = (rows ?? []).filter((r) => !st.q || `${r.title} ${r.reference} ${r.location}`.toLowerCase().includes(st.q.toLowerCase()));
  const shown = base.filter((r) => GROUPS.find((g) => g[0] === tab)![2](r.status));
  const tabs: [string, string, number][] = GROUPS.map(([k, l, f]) => [k, l, base.filter((r) => f(r.status)).length]);
  const now = Date.now();
  // no per-column CSV: the export is the server's (role-checked and recorded in the audit log)
  const columns: Column<Row>[] = [
    { key: 'title', header: 'Call', sort: (r) => r.title, render: (r) => <div className="dt-main"><span className="dt-thumb"><Icon n="spark" /></span><span className="min-w-0">
      <Link className="title" to={`/studio/apply/calls/${r.id}`}>{r.title}</Link><span className="sub"><span className="mono">{r.reference}</span>{[r.pillarName, r.location].filter(Boolean).map((x) => ` · ${x}`).join('')}</span></span></div> },
    { key: 'type', header: 'Type', hideBelow: 900, filter: { type: 'set', title: 'Type', get: (r) => r.callType, label: typeLabel }, sort: (r) => typeLabel(r.callType), render: (r) => <span className="pill">{typeLabel(r.callType)}</span> },
    { key: 'status', header: 'Status', filter: { type: 'set', title: 'Status', get: (r) => r.status, label: (v) => CALL_STATUS[v] ?? v }, sort: (r) => r.status, render: (r) => <CallBadge s={r.status} /> },
    { key: 'opens', header: 'Opens', hideBelow: 1100, sort: (r) => r.opensAt ?? '9999', render: (r) => <span className="sub ap-nowrap">{r.opensAt ? inZone(r.opensAt, r.timeZone, false) : '—'}</span> },
    { key: 'closes', header: 'Deadline', sort: (r) => r.closesAt ?? '9999', render: (r) => <span className="ap-when"><b>{r.closesAt ? inZone(r.closesAt, r.timeZone, false) : '—'}</b>
      {r.closesAt && ['open', 'paused', 'scheduled'].includes(r.status) && <small>{relative(r.closesAt, now)}</small>}</span> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 1100, sort: (r) => -new Date(r.updatedAt).getTime(), render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
    // two plain buttons on every row (no hover-only menu)
    { key: 'actions', header: '', align: 'right', render: (r) => <span className="ap-rowacts">
      <Link className="btn btn-sm" to={`/studio/apply/calls/${r.id}/details`}>Edit</Link>
      {can('apply.call.manage') && (r.status === 'archived'
        ? <button type="button" className="btn btn-sm" onClick={() => setGone({ row: r, restore: true })}>Restore</button>
        : <button type="button" className="btn btn-sm btn-danger" onClick={() => setGone({ row: r, restore: false })}>Delete</button>)}
    </span> },
  ];
  return <>
    <div className="page-h"><div><h1>Calls</h1><p>Each call has a reference, its own dates and time zone, and a history of every change to its status and deadline.</p></div>
      <div className="ap-row">
        {can('apply.export') && rows && rows.length > 0 && <a className="btn" href="/studio/api/apply/calls/export.csv" download><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export CSV</a>}
        <Link className="btn" to="/studio/apply/calls/templates"><Icon n="book" />Form templates</Link>
        {can('apply.call.manage') && <button className="btn btn-primary" onClick={() => set('new', '1')}><Icon n="plus" />New call</button>}
      </div></div>
    <section className="card ap-calls">
      <ListToolbar tabs={tabs} value={tab} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search calls or references" />
      {!rows ? <TableSkeleton /> : <DataTable id="apply-calls" rows={shown} total={base.length} rowKey={(r) => r.id} columns={columns} initialSort={{ key: 'closes', dir: 'asc' }}
        onOpen={(r) => navigate(`/studio/apply/calls/${r.id}`)}
        empty={<EmptyState icon="spark" text={rows.length ? 'No calls match these filters' : 'No calls yet'} sub={rows.length ? undefined : 'A call collects applications between its opening and its deadline.'}
          onClear={st.q || tab !== 'all' ? () => { set('q', ''); set('status', 'all'); } : undefined}
          action={!rows.length && can('apply.call.manage') ? <button className="btn btn-sm btn-primary" onClick={() => set('new', '1')}><Icon n="plus" />New call</button> : undefined} />} />}
    </section>
    {st.new && can('apply.call.manage') && <NewCall onClose={() => set('new', '')} />}
    {gone && <DeleteCall row={gone.row} restore={gone.restore} onClose={() => setGone(null)} onDone={() => { setGone(null); void load(); }} />}
  </>;
}

// Delete = Archive (the server's rule: drafts, approved and completed calls). Nothing is erased and Restore brings it back.
export const DELETABLE = ['draft', 'changes_requested', 'approved', 'completed'];
const NOT_YET: Record<string, string> = {
  in_review: 'It is waiting for approval. Send it back to draft first (Edit → Back to draft).',
  scheduled: 'It is scheduled to open. Unschedule it first (Edit → Unschedule).',
  open: 'People can still apply. Close it and finish the evaluation first; then it can be deleted.',
  paused: 'People can still apply once it resumes. Close it and finish the evaluation first; then it can be deleted.',
  closed: 'Its applications are still being handled. Start and finish the evaluation (Edit → Mark completed) first.',
  under_evaluation: 'Its applications are being evaluated. Mark it completed first (Edit → Mark completed).',
};

function DeleteCall({ row, restore, onClose, onDone }: { row: Row; restore: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ok = restore || DELETABLE.includes(row.status);
  const name = <><b>{row.title || 'Untitled call'}</b> <span className="mono">({row.reference})</span></>;
  async function go() {
    setBusy(true);
    try { await post(`/apply/calls/${row.id}/transition`, { action: restore ? 'restore' : 'archive' }); toast(restore ? `${row.reference} restored` : `${row.reference} deleted. It is in Archived.`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save.', true); setBusy(false); }
  }
  if (!ok) return <Modal size="sm" title="This call can’t be deleted yet" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button>
    <Link className="btn btn-primary" to={`/studio/apply/calls/${row.id}/details`}>Edit call</Link></>}>
    <div className="modal-b stack"><p style={{ margin: 0 }}>{name} is {(CALL_STATUS[row.status] ?? row.status).toLowerCase()}.</p><p style={{ margin: 0 }}>{NOT_YET[row.status] ?? 'Its status does not allow it.'}</p></div></Modal>;
  return <Modal size="sm" title={restore ? 'Restore this call?' : 'Delete this call?'} onClose={() => !busy && onClose()} footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
    <button className={`btn ${restore ? 'btn-primary' : 'btn-danger'}`} disabled={busy} onClick={() => void go()}>{busy ? 'Saving…' : restore ? 'Restore' : 'Delete'}</button></>}>
    <div className="modal-b stack">{restore
      ? <p style={{ margin: 0 }}>{name} comes back as a draft (or as completed, if it was completed when deleted).</p>
      : <><p style={{ margin: 0 }}>{name} moves to the <b>Archived</b> tab.</p>
        <p style={{ margin: 0 }} className="muted">Nothing is erased: its form, applications and history are kept. You can restore it from Archived.</p></>}</div></Modal>;
}

type Tpl = { id: string; builtIn: boolean; name: string; description: string; category: string; questions: number; pages: number };
/** A new call, and where its application form starts: a template (built-in or your own) or a blank form. */
function NewCall({ onClose }: { onClose: () => void }) {
  const can = useCan();
  const [title, setTitle] = useState(''); const [type, setType] = useState('youth_program'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [tpls, setTpls] = useState<Tpl[] | null>(null); const [tpl, setTpl] = useState<string | null>('youth_program');
  useEffect(() => { api<Tpl[]>('/apply/templates').then((l) => { setTpls(l); if (!l.some((t) => t.id === 'youth_program')) setTpl(l[0]?.id ?? null); }).catch(() => { setTpls([]); setTpl(null); }); }, []);
  const pick = (t: Tpl | null) => { setTpl(t?.id ?? null); if (t && CALL_TYPES.some(([v]) => v === t.category)) setType(t.category); };
  async function create() {
    setBusy(true); setErr('');
    try {
      const slug = slugify(title) || `call-${Date.now().toString(36)}`;
      const r = await post<{ id: string }>('/apply/calls', { title: title.trim(), slug, callType: type });
      // the call exists from here; a form that fails to start is created later from the Form tab
      if (can('apply.form.edit') && tpls) { try { await post(`/apply/calls/${r.id}/form`, tpl ? { template: tpl } : {}); } catch { /* the Form tab offers the choice again */ } }
      navigate(`/studio/apply/calls/${r.id}`);
    } catch (e) { setErr(e instanceof ApiError && e.details?.length ? e.details.map((d) => d.message).join(' ') : (e as Error).message); setBusy(false); }
  }
  return <Modal title="New call" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-primary" disabled={busy || title.trim().length < 3} onClick={create}>{busy ? 'Creating…' : 'Create call'}</button></>}>
    <div className="modal-b stack">
      <div className="nc-row">
        <label className="field"><span>Title</span><input className="input" autoFocus maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim().length >= 3) create(); }} placeholder="e.g. Green Fellows 2027" /></label>
        <label className="field"><span>Type</span><select className="select" value={type} onChange={(e) => setType(e.target.value)}>{CALL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      {can('apply.form.edit') && <fieldset className="nc-start"><legend>Start the application form from</legend>
        {!tpls ? <Loading /> : <div className="nc-tpls">
          {tpls.map((t) => <button type="button" key={t.id} className={`nc-tpl${tpl === t.id ? ' on' : ''}`} aria-pressed={tpl === t.id} onClick={() => pick(t)}><b>{t.name}</b><small>{t.builtIn ? `${t.questions} questions` : `Your template · ${t.questions} questions`}</small></button>)}
          <button type="button" className={`nc-tpl${tpl === null ? ' on' : ''}`} aria-pressed={tpl === null} onClick={() => pick(null)}><b>Blank form</b><small>Name and email, then your questions</small></button>
        </div>}
        <small className="muted">You can change every question afterwards in the call’s Form tab. Your own templates are managed under <Link to="/studio/apply/calls/templates">Calls › Templates</Link>.</small>
      </fieldset>}
      <small className="muted">It gets a reference (AFCD-year-number) and stays a draft until you submit it for review.</small>
      {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
    </div>
  </Modal>;
}

// ---------------------------------------------------------------- Editor
type Tr = { title?: string; summary?: string; description?: string };
type Form = { title: string; slug: string; summary: string; description: string; i18n: { fr?: Tr; ar?: Tr }; callType: string; audience: string; eligibility: string[]; location: string;
  format: string; language: string; pillarKey: string | null; projectSlug: string | null; heroMediaId: string | null; opensLocal: string | null; closesLocal: string | null; timeZone: string;
  places: number | null; contactEmail: string; terms: string; privacyNotice: string; seoTitle: string; seoDescription: string; unlisted: boolean };
const KEYS: (keyof Form)[] = ['title', 'slug', 'summary', 'description', 'i18n', 'callType', 'audience', 'eligibility', 'location', 'format', 'language', 'pillarKey', 'projectSlug', 'heroMediaId',
  'opensLocal', 'closesLocal', 'timeZone', 'places', 'contactEmail', 'terms', 'privacyNotice', 'seoTitle', 'seoDescription', 'unlisted'];
type Act = { action: string; label: string; reason: 'required' | 'optional' | null; deadline: boolean };
type Ev = { id: string; kind: string; fromStatus: string | null; toStatus: string | null; reason: string; meta: Record<string, unknown> | null; createdAt: string; actorName: string | null };
type Loaded = Form & { id: string; reference: string; status: string; rev: number; opensAt: string | null; closesAt: string | null; openedAt: string | null; closedAt: string | null;
  media: MediaItem | null; problems: string[]; actions: Act[]; serverTime: string;
  page: null | { file: string; expected: boolean; onSite: boolean; current: boolean; hasForm?: boolean }; history: { events: Ev[]; revisions: { id: string; number: number; reason: string; createdAt: string }[] } };

const STEPS: [string, string][] = [['draft', 'Draft'], ['in_review', 'Review'], ['approved', 'Approved'], ['scheduled', 'Scheduled'], ['open', 'Open'], ['closed', 'Closed'], ['under_evaluation', 'Evaluation'], ['completed', 'Completed']];
const stepOf = (s: string) => (s === 'changes_requested' ? 0 : s === 'paused' ? 4 : STEPS.findIndex(([k]) => k === s));
const PRIMARY = ['submit', 'approve', 'schedule', 'resume', 'start_evaluation', 'complete'];
const DONE: Record<string, string> = {
  submit: 'Sent for review.', withdraw: 'Back to draft.', request_changes: 'Sent back with your note.', approve: 'Approved. It can be scheduled.', schedule: 'Scheduled. It opens on its date (server time).',
  unschedule: 'Unscheduled. You can change its dates again.', pause: 'Paused.', resume: 'Resumed.', extend: 'Deadline extended and recorded.', close: 'Closed.', reopen: 'Reopened and recorded.',
  start_evaluation: 'Evaluation started.', complete: 'Marked completed.', archive: 'Archived.', restore: 'Restored.',
};
const EVENT_LABEL = (e: Ev) => e.kind === 'form_published' ? `Form version ${(e.meta?.version as number) ?? ''} published` : e.kind === 'extend' ? 'Deadline extended' : e.kind === 'reopen' ? 'Reopened' : e.kind === 'edit' ? `Edited while released (${((e.meta?.fields as string[]) ?? []).join(', ')})`
  : e.kind === 'duplicate' ? 'Created as a copy' : e.fromStatus ? `${CALL_STATUS[e.fromStatus] ?? e.fromStatus} → ${CALL_STATUS[e.toStatus ?? ''] ?? e.toStatus}` : 'Created';

export function CallEditor({ id, tabs }: { id: string; tabs?: ReactNode }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [c, setC] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null); const [hero, setHero] = useState<MediaItem | null>(null);
  const [pillars, setPillars] = useState<{ key: string; name: string }[]>([]); const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'hero' | Act>(null); const [reason, setReason] = useState(''); const [newClose, setNewClose] = useState('');

  const load = useCallback(async () => {
    const [d, pl, pr] = await Promise.all([api<Loaded>(`/apply/calls/${id}`), api('/pillars').catch(() => []), api('/projects').catch(() => [])]);
    setC(d); setF(Object.fromEntries(KEYS.map((k) => [k, (d as any)[k]])) as Form); setHero(d.media);
    setPillars(pl); setProjects(pr); setDirty(false);
  }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (ev: BeforeUnloadEvent) => { if (dirty) ev.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!c || !f) return <Loading />;
  const status = c.status; const released = RELEASED.includes(status);
  const editable = can('apply.call.manage') && !['in_review', 'archived'].includes(status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x!, [k]: v })); setDirty(true); };
  const setTr = (lang: 'fr' | 'ar', k: keyof Tr, v: string) => set('i18n', { ...f.i18n, [lang]: { ...(f.i18n[lang] ?? {}), [k]: v } });
  const showErr = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => (d.path && d.path !== 'rev' ? `${d.path}: ` : '') + d.message) : [e instanceof Error ? e.message : 'Something went wrong.']);
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/apply/calls/${id}`, { ...f, rev: c!.rev }); await load(); toast(status === 'approved' ? 'Saved. The call is back to draft and needs approval again.' : released ? 'Saved and recorded in the call’s history.' : 'Draft saved.'); return true; }
    catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  async function act(a: Act) {
    if (dirty && !(await save())) return;
    setBusy(a.action); setErrs([]);
    try { const r = await post<{ site?: { error: string | null } }>(`/apply/calls/${id}/transition`, { action: a.action, reason: reason.trim(), ...(a.deadline ? { closesLocal: newClose || null } : {}) }); setDialog(null); setReason(''); setNewClose(''); await load(); toast(DONE[a.action] ?? 'Done'); if (r.site?.error) toast(r.site.error, true); }
    catch (e) { showErr(e); } finally { setBusy(''); }
  }
  const start = (a: Act) => { if (a.reason || a.deadline || a.action === 'archive' || a.action === 'close') { setReason(''); setNewClose(a.deadline ? (f.closesLocal ?? '') : ''); setDialog(a); } else act(a); };
  async function duplicate() {
    if (dirty && !(await save())) return;
    try { const r = await post<{ id: string; reference: string }>(`/apply/calls/${id}/duplicate`); toast(`Copied as ${r.reference}`); navigate(`/studio/apply/calls/${r.id}`); } catch (e) { showErr(e); }
  }
  const now = new Date(c.serverTime).getTime();
  const words = f.description.trim().split(/\s+/).filter(Boolean).length;
  const at = stepOf(status);
  const primary = c.actions.filter((a) => PRIMARY.includes(a.action));
  const others = c.actions.filter((a) => !PRIMARY.includes(a.action));
  const dateLock = released ? (status === 'scheduled' ? 'Unschedule the call to change its dates.' : 'Use Extend deadline or Close now: both are kept in the history with a reason.') : undefined;

  return <>
    <EditorHeader back={{ to: '/studio/apply/calls', label: 'Calls' }} title={f.title || 'Untitled call'} file={c.reference} status={null} live={false} dirty={dirty}
      extra={<CallBadge s={status} />}
      actions={<>
        {can('apply.call.manage') && <button className="btn" onClick={duplicate} disabled={!!busy}><Icon n="layers" />Duplicate</button>}
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)">{busy === 'save' ? 'Saving…' : 'Save'}</button>}
      </>} />
    {tabs}
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && <div className="notice n-info"><div>In review: read-only. {can('apply.call.manage') ? 'Use “Back to draft” to edit.' : ''}</div></div>}
    {released && editable && <div className="notice n-info"><div>This call is {CALL_STATUS[status].toLowerCase()}. You can correct texts, the image and contact details; each save is kept as a revision. Its address, time zone and dates are fixed.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Basics', icon: 'log', done: !!(f.title && f.summary) },
        { id: 'description', label: 'Description & eligibility', icon: 'layers', done: words >= 20 && f.eligibility.length > 0 },
        { id: 'dates', label: 'Dates', icon: 'calendar', done: !!(f.opensLocal && f.closesLocal) },
        { id: 'place', label: 'Place & format', icon: 'pin', optional: true },
        { id: 'privacy', label: 'Contact, terms & privacy', icon: 'lock', done: !!f.contactEmail && f.privacyNotice.trim().length >= 40 },
        { id: 'links', label: 'Links & image', icon: 'image', optional: true },
        { id: 'seo', label: 'Address & search', icon: 'search', optional: true },
        { id: 'translations', label: 'French & Arabic', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
        <fieldset className="ed-main" disabled={!editable}>
          <Section id="basics" title="Basics" desc="What applicants see first.">
            <Field label="Title" span={3} count={[f.title.length, 160]}><input className="input input-lg" maxLength={160} value={f.title} onChange={(x) => set('title', x.target.value)} aria-label="Title" /></Field>
            <Field label="Short summary" span={3} count={[f.summary.length, 400]}><textarea className="textarea" rows={2} maxLength={400} value={f.summary} onChange={(x) => set('summary', x.target.value.replace(/\n/g, ' '))} aria-label="Short summary" /></Field>
            <Field label="Type"><select className="select" value={f.callType} onChange={(x) => set('callType', x.target.value)} aria-label="Type">{CALL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Audience" span={2} hint="Who it is for, in a few words."><input className="input" maxLength={300} value={f.audience} onChange={(x) => set('audience', x.target.value)} aria-label="Audience" placeholder="e.g. Young people aged 18 to 30 in Al Haouz" /></Field>
          </Section>
          <Section id="description" title="Description & eligibility">
            <Field label="Description" span={3} hint={`${words} word${words === 1 ? '' : 's'}${words < 20 ? ' · at least 20 before review' : ''} · Blank line = new paragraph`}><textarea className="textarea" style={{ minHeight: 170 }} maxLength={20000} value={f.description} onChange={(x) => set('description', x.target.value)} aria-label="Description" /></Field>
            <Field label="Who can apply" span={3} hint="Required. One condition per line. Rules that check answers come with the application form."><ListEditor label="Who can apply" value={f.eligibility} max={15} placeholder="e.g. Aged 18 to 30" disabled={!editable} onChange={(v) => set('eligibility', v)} /></Field>
          </Section>
          <Section id="dates" title="Dates" desc="The server opens and closes the call at these times, in the time zone you choose.">
            <Field label="Opens" hint={dateLock}><input className="input" type="datetime-local" disabled={released} value={f.opensLocal ?? ''} onChange={(x) => set('opensLocal', x.target.value || null)} aria-label="Opens" /></Field>
            <Field label="Deadline" hint={dateLock ? undefined : 'Applications sent after this minute are refused.'}><input className="input" type="datetime-local" disabled={released} min={f.opensLocal ?? undefined} value={f.closesLocal ?? ''} onChange={(x) => set('closesLocal', x.target.value || null)} aria-label="Deadline" /></Field>
            <Field label="Time zone"><select className="select" disabled={released} value={f.timeZone} onChange={(x) => set('timeZone', x.target.value)} aria-label="Time zone">{(ZONES.includes(f.timeZone) ? ZONES : [f.timeZone, ...ZONES]).map((z) => <option key={z}>{z}</option>)}</select></Field>
            {(c.opensAt || c.closesAt) && <div className="ap-window s3" role="status"><Icon n="calendar" width={16} height={16} />
              <span>{c.opensAt && <>Opens <b>{inZone(c.opensAt, c.timeZone)}</b>{['draft', 'changes_requested', 'in_review', 'approved', 'scheduled'].includes(status) && ` · ${relative(c.opensAt, now)}`}. </>}
                {c.closesAt && <>Deadline <b>{inZone(c.closesAt, c.timeZone)}</b>{!['closed', 'under_evaluation', 'completed', 'archived'].includes(status) && ` · ${relative(c.closesAt, now)}`}.</>}
                {dirty && ' (saved values)'}</span></div>}
          </Section>
          <Section id="place" title="Place & format">
            <Field label="Location" span={2}><input className="input" maxLength={160} value={f.location} onChange={(x) => set('location', x.target.value)} aria-label="Location" placeholder="e.g. Ait Ourir, or Online" /></Field>
            <Field label="Format"><select className="select" value={f.format} onChange={(x) => set('format', x.target.value)} aria-label="Format"><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></Field>
            <Field label="Language of the programme"><select className="select" value={f.language} onChange={(x) => set('language', x.target.value)} aria-label="Language"><option value="en">English</option><option value="fr">French</option><option value="ar">Arabic</option><option value="multi">Several languages</option></select></Field>
            <Field label="Places" hint="Empty = not stated."><input className="input" type="number" min={1} max={100000} value={f.places ?? ''} onChange={(x) => set('places', x.target.value ? Math.max(1, Math.round(Number(x.target.value))) : null)} aria-label="Places" /></Field>
          </Section>
          <Section id="privacy" title="Contact, terms & privacy" desc="Applicants agree to these before they apply.">
            <Field label="Contact email" span={3} hint="Required. Shown to applicants for questions."><input className="input mono" maxLength={160} value={f.contactEmail} onChange={(x) => set('contactEmail', x.target.value.trim())} aria-label="Contact email" placeholder="apply@afcdteam.com" /></Field>
            <Field label="Privacy notice" span={3} hint="Required: what personal data is collected, why, who sees it and how long it is kept."><textarea className="textarea" rows={4} maxLength={20000} value={f.privacyNotice} onChange={(x) => set('privacyNotice', x.target.value)} aria-label="Privacy notice" /></Field>
            <Field label="Terms" span={3} hint="Optional: conditions of participation."><textarea className="textarea" rows={3} maxLength={20000} value={f.terms} onChange={(x) => set('terms', x.target.value)} aria-label="Terms" /></Field>
          </Section>
          <Section id="links" title="Links & image" desc="Optional.">
            <Field label="Pillar"><select className="select" value={f.pillarKey ?? ''} onChange={(x) => set('pillarKey', x.target.value || null)} aria-label="Pillar"><option value="">None</option>{pillars.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field>
            <Field label="Project" span={2}><select className="select" value={f.projectSlug ?? ''} onChange={(x) => set('projectSlug', x.target.value || null)} aria-label="Project"><option value="">None</option>{projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
            <div className="ed-media s3">
              {f.heroMediaId && hero ? <div className="ed-media-img"><img src={hero.url} alt={hero.alt ?? ''} /><button type="button" className="btn btn-sm" onClick={() => set('heroMediaId', null)}><Icon n="x" />Remove</button></div>
                : <button type="button" className="ed-drop" onClick={() => setDialog('hero')}><Icon n="image" /><b>Choose an image</b><small>From the media library (public images only).</small></button>}
            </div>
          </Section>
          <Section id="seo" title="Address & search">
            <Field label="Page address" span={2} hint={released ? 'Fixed once the call is released.' : 'The public application page comes with the form builder.'}><div className="ed-slug"><span>apply-</span><input className="input mono" aria-label="Page address" disabled={released} value={f.slug} onChange={(x) => set('slug', slugify(x.target.value))} /></div></Field>
            <Field label="Visibility"><label className="ap-check"><input type="checkbox" checked={f.unlisted} onChange={(x) => set('unlisted', x.target.checked)} />Unlisted: only people with the link; never indexed</label></Field>
            <Field label="SEO title" span={3} count={[f.seoTitle.length, 70]}><input className="input" maxLength={70} value={f.seoTitle} onChange={(x) => set('seoTitle', x.target.value)} aria-label="SEO title" placeholder={f.title} /></Field>
            <Field label="Meta description" span={3} count={[f.seoDescription.length, 170]}><textarea className="textarea" rows={2} maxLength={170} value={f.seoDescription} onChange={(x) => set('seoDescription', x.target.value)} aria-label="Meta description" placeholder={f.summary} /></Field>
          </Section>
          <Section id="translations" title="French & Arabic" desc="Optional. Empty fields show the English text.">
            {(['fr', 'ar'] as const).map((l) => <div key={l} className="s3 ap-tr" dir={l === 'ar' ? 'rtl' : undefined} lang={l}>
              <b>{l === 'fr' ? 'Français' : 'العربية'}</b>
              <input className="input" maxLength={160} value={f.i18n[l]?.title ?? ''} onChange={(x) => setTr(l, 'title', x.target.value)} aria-label={`Title (${l})`} placeholder={l === 'fr' ? 'Titre' : 'العنوان'} />
              <textarea className="textarea" rows={2} maxLength={400} value={f.i18n[l]?.summary ?? ''} onChange={(x) => setTr(l, 'summary', x.target.value.replace(/\n/g, ' '))} aria-label={`Summary (${l})`} placeholder={l === 'fr' ? 'Résumé' : 'ملخص'} />
              <textarea className="textarea" rows={4} maxLength={20000} value={f.i18n[l]?.description ?? ''} onChange={(x) => setTr(l, 'description', x.target.value)} aria-label={`Description (${l})`} placeholder={l === 'fr' ? 'Description' : 'الوصف'} />
            </div>)}
          </Section>
        </fieldset>
      </div>
      <aside className="card ed-panel">
        <ol className="ed-steps" aria-label="Lifecycle">
          {STEPS.map(([k, l], i) => <li key={k} className={`${i < at ? 'done' : ''}${i === at && status !== 'archived' ? ' now' : ''}`}><span className="ed-step-dot">{i < at ? '✓' : i + 1}</span><span>{l}{k === 'open' && status === 'paused' ? ' (paused)' : ''}</span></li>)}
        </ol>
        {status === 'changes_requested' && <div className="notice n-warn"><div>{c.history.events.find((e) => e.toStatus === 'changes_requested')?.reason || 'A reviewer asked for changes.'}</div></div>}
        <dl className="kv">
          <dt>Reference</dt><dd className="mono">{c.reference}</dd>
          <dt>Status</dt><dd><CallBadge s={status} /></dd>
          {c.openedAt && <><dt>Opened</dt><dd>{inZone(c.openedAt, c.timeZone, false)}</dd></>}
          {c.closedAt && <><dt>Closed</dt><dd>{inZone(c.closedAt, c.timeZone, false)}</dd></>}
          <dt>Server time</dt><dd>{inZone(c.serverTime, c.timeZone, false)}</dd>
          {c.page && (c.page.expected || c.page.onSite) && <><dt>Website page</dt><dd>{!c.page.expected ? 'Being removed' : !c.page.hasForm ? 'No published form' : c.page.current ? <a href={`${me.siteUrl}${c.page.file}`} target="_blank" rel="noopener">On the site <Icon n="ext" width={12} height={12} /></a> : c.page.onSite ? 'Out of date: being rebuilt' : 'Not built yet'}</dd></>}
        </dl>
        {['draft', 'changes_requested', 'in_review', 'approved'].includes(status) && <div className={`ed-check${c.problems.length ? '' : ' ok'}`}>
          <b>{c.problems.length ? `${c.problems.length} thing${c.problems.length === 1 ? '' : 's'} to do first` : 'Ready for review'}</b>
          {c.problems.length > 0 && <ul>{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>}
        <div className="ed-panel-actions">
          {primary.map((a) => <button key={a.action} className="btn btn-primary" disabled={!!busy || (['submit', 'approve', 'schedule'].includes(a.action) && c.problems.length > 0)} onClick={() => start(a)}>{busy === a.action ? 'Working…' : a.label}</button>)}
          {others.map((a) => <button key={a.action} className={`btn${['close', 'archive'].includes(a.action) ? ' btn-ghost btn-danger' : ' btn-ghost'}`} disabled={!!busy} onClick={() => start(a)}>{a.label}</button>)}
        </div>
        {c.history.events.length > 0 && <details className="ed-history" open><summary>History</summary>
          <ol className="timeline">{c.history.events.slice(0, 30).map((e) => <li key={e.id}><b>{EVENT_LABEL(e)}</b>
            {e.kind === 'extend' || e.kind === 'reopen' ? <small>New deadline {inZone(String(e.meta?.to), c.timeZone, false)}{e.meta?.from ? `, was ${inZone(String(e.meta.from), c.timeZone, false)}` : ''}</small> : null}
            {e.reason && <q>{e.reason}</q>}<small>{e.actorName ?? 'Scheduler (server time)'} · {fmtDate(e.createdAt)}</small></li>)}</ol></details>}
      </aside>
    </div>

    {dialog === 'hero' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setHero(m[0]); set('heroMediaId', m[0].id); } setDialog(null); }} />}
    {dialog && dialog !== 'hero' && <ActionDialog a={dialog} tz={c.timeZone} busy={!!busy} reason={reason} setReason={setReason} newClose={newClose} setNewClose={setNewClose} onClose={() => setDialog(null)} onRun={() => act(dialog)}
      note={dialog.action === 'close' ? 'Applications stop now. Reopening later needs a reason and a new deadline, and is recorded.' : dialog.action === 'archive' ? 'Archived calls are hidden from the lists. You can restore them.'
        : dialog.action === 'reopen' ? 'The call accepts applications again until the new deadline. This is recorded in its history.' : dialog.action === 'extend' ? 'The new deadline must be later than the current one.' : undefined} />}
  </>;
}

function ActionDialog({ a, tz, busy, reason, setReason, newClose, setNewClose, onClose, onRun, note }: { a: Act; tz: string; busy: boolean; reason: string; setReason: (v: string) => void; newClose: string;
  setNewClose: (v: string) => void; onClose: () => void; onRun: () => void; note?: ReactNode }) {
  const ok = (a.reason !== 'required' || reason.trim().length >= 3) && (!a.deadline || !!newClose);
  return <Modal size="sm" title={`${a.label}?`} onClose={() => !busy && onClose()} footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
    <button className={`btn ${['close', 'archive'].includes(a.action) ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !ok} onClick={onRun}>{busy ? 'Working…' : a.label}</button></>}>
    <div className="modal-b stack">
      {note && <p style={{ margin: 0 }}>{note}</p>}
      {a.deadline && <label className="field"><span>New deadline ({tz})</span><input className="input" type="datetime-local" value={newClose} onChange={(e) => setNewClose(e.target.value)} /></label>}
      {a.reason && <label className="field"><span>{a.action === 'request_changes' ? 'What needs to change' : a.reason === 'required' ? 'Reason (kept in the history)' : 'Note (optional)'}</span>
        <textarea className="textarea" rows={3} maxLength={2000} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
    </div>
  </Modal>;
}
