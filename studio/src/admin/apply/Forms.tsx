// AFCD Apply → a call's Form tab (the builder) and Form templates (built-in and custom, versioned, JSON import/export).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Icon, Link, Modal, ago, fmtDate, navigate, useCan, useToast } from '../ui.tsx';
import { DataTable, EmptyState, TableSkeleton, type Column } from '../DataTable.tsx';
import { Loading } from '../pages/Dashboard.tsx';
import type { FormDef, Issue } from '../../server/modules/apply/engine.ts';
import { Builder } from './Builder.tsx';
import { CallBadge, CALL_TYPES } from './shared.tsx';

const errText = (e: unknown) => e instanceof ApiError && e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' ')}` : (e as Error).message;
async function readJsonFile(file: File) {
  if (file.size > 1_000_000) throw new Error('The file is larger than 1 MB.');
  try { return JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON.'); }
}

// ---------------------------------------------------------------- Template chooser (new form, replace form)
type Tpl = { id: string; builtIn: boolean; name: string; description: string; category: string; version: number; pages: number; questions: number; rules: number; archivedAt?: string | null; updatedAt?: string | null; updatedByName?: string | null; basedOn?: string | null };
function TemplatePicker({ onPick, blank, busy }: { onPick: (id: string | null) => void; blank?: boolean; busy: boolean }) {
  const [list, setList] = useState<Tpl[] | null>(null);
  useEffect(() => { api<Tpl[]>('/apply/templates').then(setList).catch(() => setList([])); }, []);
  if (!list) return <Loading />;
  return <div className="ap-tpls">
    {blank && <button type="button" className="ap-tpl" disabled={busy} onClick={() => onPick(null)}><b>Blank form</b><small>Name and email, then your questions.</small></button>}
    {list.map((t) => <button type="button" key={t.id} className="ap-tpl" disabled={busy} onClick={() => onPick(t.id)}><b>{t.name}</b><small>{t.description || `${t.questions} questions`}</small>
      <span className="ap-tpl-m">{t.builtIn ? 'Built-in' : `Custom · v${t.version}`} · {t.pages} pages · {t.questions} questions{t.rules ? ` · ${t.rules} rule${t.rules === 1 ? '' : 's'}` : ''}</span></button>)}
  </div>;
}

// ---------------------------------------------------------------- Call form builder
type Loaded = { call: { id: string; reference: string; title: string; status: string; openedAt: string | null };
  form: null | { id: string; rev: number; definition: FormDef; sourceTemplate: string | null; updatedAt: string };
  issues?: Issue[]; versions?: { id: string; number: number; note: string; createdAt: string; publishedBy: string | null; current: boolean }[]; unpublishedChanges?: boolean; breaking?: string[]; publishedFields?: string[] };

export function CallFormBuilder({ callId }: { callId: string }) {
  const can = useCan(); const toast = useToast();
  const [x, setX] = useState<Loaded | null>(null); const [key, setKey] = useState(0);
  const [dialog, setDialog] = useState<null | 'publish' | 'template' | 'saveTpl' | 'versions'>(null);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [errs, setErrs] = useState<string[]>([]); const [tplName, setTplName] = useState('');
  const pending = useRef<{ rev: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { const r = await api<Loaded>(`/apply/calls/${callId}/form`); setX(r); return r; }, [callId]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  if (!x) return <Loading />;
  const back = <Link to={`/studio/apply/calls/${callId}`} className="fb-back" aria-label="Back to the call"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} /></Link>;
  if (!x.form) return <div className="fb-start">
    <div className="page-h"><div><Link to={`/studio/apply/calls/${callId}`} className="ed-back">← {x.call.title}</Link><h1>Application form</h1><p>Start from a template or a blank form. You can change everything afterwards.</p></div></div>
    {can('apply.form.edit') ? <TemplatePicker blank busy={busy} onPick={async (id) => { setBusy(true); try { await post(`/apply/calls/${callId}/form`, id ? { template: id } : {}); await load(); setKey((k) => k + 1); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }} />
      : <div className="notice n-info"><div>This call has no form yet.</div></div>}
  </div>;
  const f = x.form;
  const locked = new Set(x.publishedFields ?? []);
  const last = x.versions?.[0];
  const editable = can('apply.form.edit') && !['archived'].includes(x.call.status);
  const saveFn = async (def: FormDef, rev: number) => { const r = await put<{ rev: number }>(`/apply/calls/${callId}/form`, { definition: def, rev }); load().catch(() => {}); return r.rev; };
  async function importFile(file: File) {
    try { const data = await readJsonFile(file); await post(`/apply/calls/${callId}/form/import`, { data, rev: f.rev }); await load(); setKey((k) => k + 1); toast('Form imported. Check it, then publish.'); }
    catch (e) { toast(errText(e), true); }
  }
  async function publish() {
    setBusy(true); setErrs([]);
    try { const r = await post<{ version: number }>(`/apply/calls/${callId}/form/publish`, { rev: pending.current!.rev, note }); setDialog(null); setNote(''); await load(); toast(`Version ${r.version} published. New applications use it.`); }
    catch (e) { setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => d.message) : [(e as Error).message]); } finally { setBusy(false); }
  }
  const menu = <details className="fb-menu"><summary className="btn btn-ghost btn-sm" title="Templates, import, export, versions">More</summary><div className="fb-pop">
    {editable && <button type="button" onClick={() => setDialog('template')}>Replace with a template…</button>}
    {editable && <button type="button" onClick={() => fileRef.current?.click()}>Import JSON…</button>}
    <a href={`/studio/api/apply/calls/${callId}/form/export`} download>Export JSON</a>
    {can('apply.form.edit') && <button type="button" onClick={() => { setTplName(`${x.call.title} form`); setDialog('saveTpl'); }}>Save as template…</button>}
    {!!x.versions?.length && <button type="button" onClick={() => setDialog('versions')}>Published versions ({x.versions.length})</button>}
  </div></details>;
  return <>
    <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
    <Builder key={`${f.id}:${key}`} initial={f.definition} rev={f.rev} locked={locked} back={back} title={x.call.title}
      subtitle={<><span className="mono">{x.call.reference}</span> · Application form{x.call.openedAt ? <span title="The call has opened, so questions already published keep their ID, type and options."> · published questions are locked</span> : ''}</>}
      status={<span className={`ap-fstate${!last ? ' none' : x.unpublishedChanges ? ' warn' : ' ok'}`}>{!last ? 'Not published' : x.unpublishedChanges ? `v${last.number} live · changes not published` : `v${last.number} published`}</span>}
      save={saveFn} menu={menu}
      onPublish={can('apply.call.publish') ? async (_def, rev) => { pending.current = { rev }; const fresh = await load(); setErrs((fresh.breaking ?? []).length ? fresh.breaking! : []); setDialog('publish'); } : undefined}
      publishLabel="Publish…" />
    {dialog === 'publish' && <Modal size="sm" title="Publish this form?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || (x.issues ?? []).some((i) => i.level === 'error') || !x.unpublishedChanges} onClick={publish}>{busy ? 'Publishing…' : `Publish version ${(last?.number ?? 0) + 1}`}</button></>}>
      <div className="modal-b stack">
        {!x.unpublishedChanges && <p style={{ margin: 0 }}>Nothing changed since version {last?.number}.</p>}
        {(x.issues ?? []).some((i) => i.level === 'error') && <div className="notice n-warn"><div><b>Fix these first:</b><ul>{x.issues!.filter((i) => i.level === 'error').map((i, n) => <li key={n}>{i.message}</li>)}</ul></div></div>}
        {(x.issues ?? []).some((i) => i.level === 'warning') && <details><summary>{x.issues!.filter((i) => i.level === 'warning').length} note(s) to check</summary><ul>{x.issues!.filter((i) => i.level === 'warning').map((i, n) => <li key={n}>{i.message}</li>)}</ul></details>}
        {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((m) => <li key={m}>{m}</li>)}</ul></div></div>}
        <p style={{ margin: 0 }}>Applications started from now on use the new version. Each application keeps the exact version it was made with.</p>
        <label className="field"><span>What changed (optional)</span><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div></Modal>}
    {dialog === 'template' && <Modal title="Replace the form with a template" onClose={() => setDialog(null)}><div className="modal-b stack">
      <div className="notice n-warn"><div>This replaces the working form (you can undo by importing an export, and published versions are kept).{x.call.openedAt ? ' The call has opened: you will not be able to publish a template that drops published questions.' : ''}</div></div>
      <TemplatePicker busy={busy} onPick={async (id) => { if (!id) return; setBusy(true); try { await post(`/apply/calls/${callId}/form/template`, { template: id, rev: f.rev }); setDialog(null); await load(); setKey((k) => k + 1); toast('Template applied. Check it, then publish.'); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }} />
    </div></Modal>}
    {dialog === 'saveTpl' && <Modal size="sm" title="Save as a template" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || tplName.trim().length < 2} onClick={async () => { setBusy(true); try { const t = await post<{ id: string }>('/apply/templates', { meta: { name: tplName.trim() }, from: { callId } }); setDialog(null); toast('Template saved (the last saved form, version 1).'); void t; } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }}>Save template</button></>}>
      <div className="modal-b stack"><label className="field"><span>Name</span><input className="input" autoFocus maxLength={120} value={tplName} onChange={(e) => setTplName(e.target.value)} /></label><small className="muted">Uses the saved form. Save first if you have changes.</small></div></Modal>}
    {dialog === 'versions' && <Modal size="sm" title="Published versions" onClose={() => setDialog(null)}><div className="modal-b"><ol className="timeline">{x.versions!.map((v) => <li key={v.id}><b>Version {v.number}{v.current ? ' · same as the working form' : ''}</b>{v.note && <q>{v.note}</q>}<small>{v.publishedBy ?? 'Unknown'} · {fmtDate(v.createdAt)}</small></li>)}</ol></div></Modal>}
  </>;
}

// ---------------------------------------------------------------- Templates library
export function TemplatesPage() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Tpl[] | null>(null); const [archived, setArchived] = useState(false);
  const [dup, setDup] = useState<Tpl | null>(null); const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api<Tpl[]>(`/apply/templates${archived ? '?archived=1' : ''}`).then(setRows).catch((e) => { setRows([]); toast(e.message, true); });
  useEffect(() => { load(); }, [archived]);
  async function importFile(file: File) {
    try { const data = await readJsonFile(file); const t = await post<{ id: string }>('/apply/templates', { meta: { name: String(data?.name ?? file.name.replace(/\.json$/i, '')).slice(0, 120) || 'Imported template', description: String(data?.description ?? '').slice(0, 500), ...(typeof data?.category === 'string' && /^[a-z_]+$/.test(data.category) ? { category: data.category } : {}) }, from: { data } }); toast('Template imported.'); navigate(`/studio/apply/calls/templates/${t.id}`); }
    catch (e) { toast(errText(e), true); }
  }
  const act = async (path: string, done: string) => { try { await post(path); toast(done); load(); } catch (e) { toast(errText(e), true); } };
  const typeName = (c: string) => CALL_TYPES.find((x) => x[0] === c)?.[1] ?? c;
  const columns: Column<Tpl>[] = [
    { key: 'name', header: 'Template', sort: (r) => r.name, render: (r) => <div className="dt-main"><span className="dt-thumb"><Icon n="book" /></span><span className="min-w-0">
      {r.builtIn ? <span className="title">{r.name}</span> : <Link className="title" to={`/studio/apply/calls/templates/${r.id}`}>{r.name}</Link>}<span className="sub">{r.description || typeName(r.category)}</span></span></div> },
    { key: 'kind', header: 'Kind', sort: (r) => (r.builtIn ? 0 : 1), render: (r) => <span className="pill">{r.builtIn ? 'Built-in' : r.archivedAt ? 'Archived' : `Custom · v${r.version}`}</span> },
    { key: 'size', header: 'Content', hideBelow: 900, sort: (r) => r.questions, render: (r) => <span className="sub">{r.pages} pages · {r.questions} questions · {r.rules} rule{r.rules === 1 ? '' : 's'}</span> },
    { key: 'updated', header: 'Edited', align: 'right', hideBelow: 1100, sort: (r) => -(r.updatedAt ? new Date(r.updatedAt).getTime() : 0), render: (r) => r.updatedAt ? <span className="dt-when"><b>{ago(r.updatedAt)}</b><small>{r.updatedByName}</small></span> : '—' },
  ];
  return <>
    <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
    <div className="page-h"><div><Link to="/studio/apply/calls" className="ed-back"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />Calls</Link><h1>Form templates</h1><p>Starting points for application forms, offered when you create a call. Built-in templates are read-only; duplicate one to change it. Custom templates keep a version number that goes up on every save.</p></div>
      <div className="ap-row"><label className="ap-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label>
        {can('apply.form.edit') && <button className="btn" onClick={() => fileRef.current?.click()}><Icon n="upload" />Import JSON</button>}</div></div>
    <section className="card">{!rows ? <TableSkeleton /> : <DataTable id="apply-templates" rows={rows} total={rows.length} rowKey={(r) => r.id} columns={columns}
      onOpen={(r) => { if (!r.builtIn) navigate(`/studio/apply/calls/templates/${r.id}`); }}
      rowMenu={(r) => [
        ...(can('apply.form.edit') ? [{ label: 'Duplicate', icon: 'layers', run: () => { setDup(r); setName(`${r.name} (copy)`); } }] : []),
        { label: 'Export JSON', icon: 'upload', run: () => { const a = document.createElement('a'); a.href = `/studio/api/apply/templates/${r.id}/export`; a.download = ''; a.click(); } },
        ...(!r.builtIn && can('apply.form.edit') ? [r.archivedAt ? { label: 'Restore', icon: 'undo', run: () => act(`/apply/templates/${r.id}/restore`, 'Template restored') } : { label: 'Archive', icon: 'x', danger: true, run: () => act(`/apply/templates/${r.id}/archive`, 'Template archived') }] : []),
      ]}
      empty={<EmptyState icon="book" text="No templates" />} />}</section>
    {dup && <Modal size="sm" title="Duplicate template" onClose={() => setDup(null)} footer={<><button className="btn" onClick={() => setDup(null)}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || name.trim().length < 2} onClick={async () => { setBusy(true); try { const t = await post<{ id: string }>('/apply/templates', { meta: { name: name.trim(), description: dup.description, category: /^[a-z_]+$/.test(dup.category) ? dup.category : 'other' }, from: { template: dup.id } }); navigate(`/studio/apply/calls/templates/${t.id}`); } catch (e) { toast(errText(e), true); } finally { setBusy(false); } }}>Duplicate</button></>}>
      <div className="modal-b"><label className="field"><span>Name of the copy</span><input className="input" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label></div></Modal>}
  </>;
}

export function TemplateBuilder({ id }: { id: string }) {
  const can = useCan(); const toast = useToast();
  const [x, setX] = useState<null | { id: string; name: string; description: string; category: string; version: number; definition: FormDef; archivedAt: string | null; builtIn: boolean }>(null);
  const [meta, setMeta] = useState(false); const [m, setM] = useState({ name: '', description: '', category: 'other' });
  const ver = useRef(1); const lastDef = useRef<FormDef | null>(null);
  useEffect(() => { api(`/apply/templates/${id}`).then((r) => { setX(r); ver.current = r.version; lastDef.current = r.definition; setM({ name: r.name, description: r.description, category: r.category }); }).catch((e) => toast(e.message, true)); }, [id]);
  if (!x) return <Loading />;
  if (x.builtIn) { navigate('/studio/apply/calls/templates'); return null; }
  const save = async (def: FormDef) => { const r = await put<{ version: number }>(`/apply/templates/${id}`, { meta: m, definition: def, version: ver.current }); ver.current = r.version; lastDef.current = def; toast(`Saved as version ${r.version}`); return r.version; };
  return <>
    <Builder initial={x.definition} rev={x.version} locked={new Set()} title={m.name} subtitle={<>Template · <button type="button" className="linkish" onClick={() => setMeta(true)}>name and description</button>{x.archivedAt ? ' · archived (restore it to save)' : ''}</>}
      back={<Link to="/studio/apply/calls/templates" className="fb-back" aria-label="Back to templates"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} /></Link>}
      save={can('apply.form.edit') ? async (def) => save(def) : async () => { throw new Error('Your role cannot change templates.'); }}
      menu={<a className="btn btn-ghost btn-sm" href={`/studio/api/apply/templates/${id}/export`} download>Export JSON</a>} />
    {meta && <Modal size="sm" title="Template details" onClose={() => setMeta(false)} footer={<><button className="btn" onClick={() => setMeta(false)}>Cancel</button><button className="btn btn-primary" disabled={!can('apply.form.edit') || m.name.trim().length < 2} onClick={async () => { try { await save(lastDef.current!); setMeta(false); } catch (e) { toast(errText(e), true); } }}>Save details</button></>}><div className="modal-b stack">
      <label className="field"><span>Name</span><input className="input" maxLength={120} value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
      <label className="field"><span>Description</span><textarea className="textarea" rows={3} maxLength={500} value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} /></label>
      <label className="field"><span>Kind of call</span><select className="select" value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })}>{CALL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <small className="muted">Saves the details with the last saved form (unsaved form edits stay in the builder).</small></div></Modal>}
  </>;
}
