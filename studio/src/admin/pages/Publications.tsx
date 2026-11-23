// Publications: reports, studies, policy briefs, guides, annual reports and toolkits, each with a downloadable PDF.
// Each one gets its own page and appears on publications.html, where visitors filter by type and pillar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, ListEditor, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, workflowActions, type Column } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import '../publications.css';

export const PUB_TYPES: [string, string][] = [['report', 'Report'], ['study', 'Study'], ['policy_brief', 'Policy brief'], ['guide', 'Guide'], ['annual_report', 'Annual report'], ['toolkit', 'Toolkit'], ['other', 'Other publication']];
const LANGS: [string, string][] = [['en', 'English'], ['fr', 'French'], ['ar', 'Arabic'], ['multi', 'Several languages']];
const typeLabel = (t: string) => PUB_TYPES.find((x) => x[0] === t)?.[1] ?? t;
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX_MB = 30;

type Row = { id: string; slug: string; title: string; type: string; publishedOn: string | null; language: string; status: string; publishedRevisionId: string | null; updatedAt: string;
  externalUrl: string; documentBytes: number | null; pillarNames: string[]; cover: string | null };

export function PublicationsList() {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [st, set] = useUrlState({ status: 'all', type: 'all', q: '' });
  const load = () => api<Row[]>('/publications').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function create() {
    try { const r = await post<{ id: string }>('/publications', { title: 'Untitled publication', slug: `untitled-${Date.now().toString(36)}` }); navigate(`/studio/publications/${r.id}`); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not create it.', true); }
  }
  const is = (k: string, r: Row) => (k === 'all' ? r.status !== 'archived' : k === 'live' ? !!r.publishedRevisionId : k === 'draft' ? ['draft', 'changes_requested'].includes(r.status) : r.status === k);
  const base = (rows ?? []).filter((r) => (st.type === 'all' || r.type === st.type) && (!st.q || `${r.title} ${r.pillarNames.join(' ')}`.toLowerCase().includes(st.q.toLowerCase())));
  const shown = base.filter((r) => is(st.status, r));
  const tabs: [string, string, number][] = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['in_review', 'In review'], ['approved', 'Approved'], ['archived', 'Archived']].map(([k, l]) => [k, l, base.filter((r) => is(k, r)).length]);
  const fileOf = (r: Row) => (r.documentBytes ? `PDF · ${size(r.documentBytes)}` : r.externalUrl ? 'Online link' : 'No file yet');
  const columns: Column<Row>[] = [
    { key: 'title', header: 'Publication', sort: (r) => r.title, csv: (r) => r.title, render: (r) => <div className="dt-main"><span className="dt-thumb">{r.cover ? <img src={r.cover} alt="" /> : <Icon n="book" />}</span><span className="min-w-0">
      <Link className="title" to={`/studio/publications/${r.id}`}>{r.title}</Link><span className="sub">{r.pillarNames.join(' · ') || '—'}</span></span></div> },
    { key: 'type', header: 'Type', sort: (r) => typeLabel(r.type), csv: (r) => typeLabel(r.type), hideBelow: 900, render: (r) => <span className="pill">{typeLabel(r.type)}</span> },
    { key: 'date', header: 'Published', sort: (r) => r.publishedOn ?? '0000', csv: (r) => r.publishedOn ?? '', render: (r) => <span className="sub" style={{ whiteSpace: 'nowrap' }}>{r.publishedOn ? dateLabel(r.publishedOn) : '—'}</span> },
    { key: 'file', header: 'File', sort: (r) => r.documentBytes ?? 0, csv: fileOf, hideBelow: 1000, render: (r) => <span className={`pb-file${r.documentBytes || r.externalUrl ? '' : ' none'}`}>{fileOf(r)}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'updated', header: 'Updated', align: 'right', hideBelow: 1100, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  return <>
    <div className="page-h"><div><h1>Publications</h1><p>Reports, studies, policy briefs, guides and annual reports. Each one gets its own page with a download, and visitors filter the list by type and pillar.</p></div>
      {can('publication.create') && <button className="btn btn-primary" onClick={create}><Icon n="plus" />New publication</button>}</div>
    {rows && !rows.some((r) => r.publishedRevisionId) && <div className="notice n-info"><div>Nothing is published yet, so the website has no Publications page. It appears at <span className="mono">publications.html</span> with the first published publication. Add a link to it in Menus when you are ready.</div></div>}
    <section className="card">
      <ListToolbar tabs={tabs} value={st.status} onChange={(v) => set('status', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search publications">
        <select className="select" value={st.type} onChange={(e) => set('type', e.target.value)} aria-label="Type"><option value="all">All types</option>{PUB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </ListToolbar>
      {!rows ? <Loading /> : <DataTable id="publications" rows={shown} total={base.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-publications" initialSort={{ key: 'date', dir: 'desc' }}
        actions={workflowActions<Row>({ base: '/publications', noun: ['publication', 'publications'], name: (r) => r.title, canUpdate: can('publication.update'), reload: load, post, toast })}
        onOpen={(r) => navigate(`/studio/publications/${r.id}`)}
        empty={<EmptyState icon="book" text={rows.length ? 'No publications match these filters' : 'No publications yet. Add the first report or study.'} onClear={st.q || st.type !== 'all' || st.status !== 'all' ? () => { set('q', ''); set('type', 'all'); set('status', 'all'); } : undefined} />} />}
    </section>
  </>;
}

type Form = { title: string; slug: string; type: string; summary: string; abstract: string; publishedOn: string | null; authors: string[]; organisation: string; language: string;
  pillarKeys: string[]; projectSlugs: string[]; coverMediaId: string | null; documentId: string | null; externalUrl: string; seoTitle: string; seoDescription: string };
const KEYS: (keyof Form)[] = ['title', 'slug', 'type', 'summary', 'abstract', 'publishedOn', 'authors', 'organisation', 'language', 'pillarKeys', 'projectSlugs', 'coverMediaId', 'documentId', 'externalUrl', 'seoTitle', 'seoDescription'];
type Doc = { id: string; originalName: string; bytes: number; createdAt: string; url: string; missing?: boolean };
type Loaded = Form & { id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; cover: MediaItem | null; document: Doc | null; problems: string[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

function uploadPdf(file: File, csrf: string, onProgress: (p: number) => void) {
  return new Promise<Doc>((res, rej) => {
    const x = new XMLHttpRequest(); const fd = new FormData(); fd.append('file', file);
    x.open('POST', '/studio/api/documents'); x.withCredentials = true; x.setRequestHeader('X-CSRF-Token', csrf);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { let d: any = {}; try { d = JSON.parse(x.responseText); } catch { /* not json */ } x.status < 300 ? res(d) : rej(new ApiError(x.status, d.error || 'Upload failed')); };
    x.onerror = () => rej(new ApiError(0, 'Network error. Check the connection and retry.'));
    x.send(fd);
  });
}

export function PublicationEditor({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [o, setO] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [cover, setCover] = useState<MediaItem | null>(null); const [doc, setDoc] = useState<Doc | null>(null);
  const [pillars, setPillars] = useState<{ key: string; name: string; colour?: string }[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'cover' | 'preview' | 'publish' | 'unpublish' | 'changes'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState(''); const [slugTouched, setSlugTouched] = useState(true);
  const [progress, setProgress] = useState<number | null>(null); const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [d, pl, pr] = await Promise.all([api<Loaded>(`/publications/${id}`), api('/pillars'), api('/projects')]);
    setO(d); setF(Object.fromEntries(KEYS.map((k) => [k, (d as any)[k]])) as Form); setCover(d.cover); setDoc(d.document);
    setPillars(pl); setProjects(pr.filter((x: any) => x.publishedRevisionId || d.projectSlugs.includes(x.slug)));
    setDirty(false); setSlugTouched(!d.title.startsWith('Untitled') || !d.slug.startsWith('untitled-'));
  }, [id]);
  useEffect(() => { load().catch((err) => toast(err.message, true)); }, [load]);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (ev: BeforeUnloadEvent) => { if (dirty) ev.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!o || !f) return <Loading />;
  const status = o.status; const live = !!o.publishedRevisionId;
  const editable = can('publication.update') && !['in_review', 'archived'].includes(status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => { const n = { ...x!, [k]: v }; if (k === 'title' && !slugTouched && !live) n.slug = slugify(String(v)) || x!.slug; return n; }); setDirty(true); };
  const toggle = (k: 'pillarKeys' | 'projectSlugs', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  function showErr(err: unknown) { setErrs(err instanceof ApiError && err.details?.length ? err.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [err instanceof Error ? err.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/publications/${id}`, f); await load(); toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved'); return true; }
    catch (err) { showErr(err); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/publications/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (err) { setDialog(null); showErr(err); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/publications/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'Removed from the website'); }
    catch (err) { setDialog(null); showErr(err); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/publications/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (err) { showErr(err); } finally { setBusy(''); }
  }
  async function pickFile(file: File | undefined) {
    if (!file) return;
    setErrs([]);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setErrs(['Upload the document as a PDF.']); return; }
    if (file.size > MAX_MB * 1048576) { setErrs([`The file is larger than ${MAX_MB} MB. Compress it (e.g. “Reduce file size” when exporting) and try again.`]); return; }
    setProgress(0);
    try { const d = await uploadPdf(file, me.csrf, setProgress); setDoc(d); set('documentId', d.id); toast('PDF uploaded. Save the draft to attach it.'); }
    catch (err) { showErr(err); } finally { setProgress(null); if (fileInput.current) fileInput.current.value = ''; }
  }

  const file = `publication-${f.slug}.html`;
  const words = f.abstract.trim().split(/\s+/).filter(Boolean).length;
  const linkIssue = f.externalUrl && !/^https:\/\/\S+\.\S+$/.test(f.externalUrl) ? 'Use a full secure address starting with https://' : '';
  const shownPillars = pillars.filter((p) => f.pillarKeys.includes(p.key));

  return <>
    <EditorHeader back={{ to: '/studio/publications', label: 'Publications' }} title={f.title} file={live ? file : undefined} status={status} live={live} dirty={dirty}
      extra={<span className="pill">{typeLabel(f.type)}</span>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy || progress !== null} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('publication.update') && <button className="btn btn-primary" disabled={!!busy || o.problems.length > 0} title={o.problems.length ? `${o.problems.length} thing${o.problems.length === 1 ? '' : 's'} to do first (see the publishing panel)` : undefined} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('publication.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('publication.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'basics', label: 'Basics', icon: 'log', done: !!(f.title && f.summary && f.publishedOn) },
        { id: 'authors', label: 'Authors', icon: 'users', done: f.authors.length > 0 || !!f.organisation },
        { id: 'document', label: 'Document', icon: 'upload', done: !!f.documentId || (!!f.externalUrl && !linkIssue) },
        { id: 'abstract', label: 'Abstract', icon: 'layers', optional: true, done: words ? true : undefined },
        { id: 'links', label: 'Pillars, projects & cover', icon: 'image', optional: true, done: f.coverMediaId || f.pillarKeys.length || f.projectSlugs.length ? true : undefined },
        { id: 'seo', label: 'Search & address', icon: 'search', optional: true, done: f.seoTitle || f.seoDescription ? true : undefined },
        { id: 'translations', label: 'Translations', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
      <fieldset className="ed-main" disabled={!editable}>
        <Section id="basics" title="Basics" desc="What people see in the list of publications and in search results.">
          <Field label="Title" span={3} count={[f.title.length, 160]}><input className="input input-lg" maxLength={160} value={f.title} onChange={(x) => set('title', x.target.value)} aria-label="Title" placeholder="The title as printed on the document" /></Field>
          <Field label="Short summary" span={3} count={[f.summary.length, 320]} hint="One or two sentences: what the document covers and who it is for."><textarea className="textarea" rows={3} maxLength={320} value={f.summary} onChange={(x) => set('summary', x.target.value.replace(/\n/g, ' '))} aria-label="Short summary" /></Field>
          <Field label="Type"><select className="select" value={f.type} onChange={(x) => set('type', x.target.value)} aria-label="Type">{PUB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Publication date" hint="The date on the document."><input className="input" type="date" value={f.publishedOn ?? ''} onChange={(x) => set('publishedOn', x.target.value || null)} aria-label="Publication date" /></Field>
          <Field label="Language of the document"><select className="select" value={f.language} onChange={(x) => set('language', x.target.value)} aria-label="Language of the document">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <div className="pb-card-wrap s3" aria-label="Preview of the card in the list of publications">
            <span className="pb-cap">How it appears in the list</span>
            <article className="pb-card">
              <div className="pb-card-cover">{cover && f.coverMediaId ? <img src={cover.url} alt="" /> : <Icon n="book" width={30} height={30} />}</div>
              <div className="pb-card-body">
                <div className="pb-card-top"><span className="pb-kind">{typeLabel(f.type) === 'Other publication' ? 'Publication' : typeLabel(f.type)}</span>{f.publishedOn && <span>{dateLabel(f.publishedOn)}</span>}</div>
                <h3>{f.title || 'Publication title'}</h3>
                <p>{f.summary || 'The short summary appears here.'}</p>
                <span className="pb-card-meta">{[doc && f.documentId ? `PDF · ${size(doc.bytes)}` : f.externalUrl ? 'Online' : '', LANGS.find((l) => l[0] === f.language)?.[1]].filter(Boolean).join(' · ')}</span>
              </div>
            </article>
          </div>
        </Section>
        <Section id="authors" title="Authors" desc="Who wrote or produced the document. Add the authors, the organisation, or both.">
          <Field label="Authors" span={3} hint="One name per line, as printed on the document."><ListEditor label="Authors" value={f.authors} max={20} placeholder="Author’s name" disabled={!editable} onChange={(v) => set('authors', v)} /></Field>
          <Field label="Organisation" span={3} hint="e.g. the organisation that published it, or a partnership of organisations."><input className="input" maxLength={160} value={f.organisation} onChange={(x) => set('organisation', x.target.value)} aria-label="Organisation" /></Field>
        </Section>
        <Section id="document" title="Document" desc="The PDF visitors download. You can add a link instead, or as well, when the document is also hosted elsewhere.">
          <div className="s3 pb-docbox">
            {f.documentId && doc ? <div className={`pb-doc${doc.missing ? ' missing' : ''}`}>
              <span className="pb-doc-ico" aria-hidden="true">PDF</span>
              <div className="pb-doc-info"><b>{doc.originalName}</b><small>{size(doc.bytes)} · uploaded {fmtDate(doc.createdAt)}{doc.missing ? ' · the file is missing, upload it again' : ''}</small></div>
              <div className="pb-doc-act">
                {!doc.missing && <a className="btn btn-sm" href={doc.url}><Icon n="ext" />Download</a>}
                {editable && <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}><Icon n="upload" />Replace</button>}
                {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('documentId', null)}><Icon n="x" />Remove</button>}
              </div>
            </div> : <button type="button" className={`ed-drop${drag ? ' pb-drag' : ''}`} disabled={!editable || progress !== null} onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (editable) pickFile(e.dataTransfer.files[0]); }}>
              <Icon n="upload" /><b>{progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload the PDF'}</b><small>Drop it here or choose a file. PDF only, up to {MAX_MB} MB.</small></button>}
            {progress !== null && f.documentId && <div className="pb-progress" role="status"><i style={{ width: `${Math.round(progress * 100)}%` }} />Uploading… {Math.round(progress * 100)}%</div>}
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
            {f.documentId && doc && doc.id !== o.documentId && <p className="muted" style={{ margin: '8px 0 0' }}>New file: save the draft to attach it. The live page keeps the previous file until this version is published.</p>}
          </div>
          <Field label="Read-online link" span={3} hint={linkIssue || 'Optional. A page where the document can be read online (e.g. a partner’s website).'}><input className="input mono" maxLength={500} placeholder="https://…" value={f.externalUrl} onChange={(x) => set('externalUrl', x.target.value.trim())} aria-label="Read-online link" /></Field>
        </Section>
        <Section id="abstract" title="Abstract" desc="Optional. A longer description on the publication’s page: the questions it answers, its main findings, how it was made.">
          <Field label="Abstract" span={3} hint={<>{words} word{words === 1 ? '' : 's'} · Blank line = new paragraph · ## Subheading · **bold** · [link](https://…) · - list item</>}><textarea className="textarea" style={{ minHeight: 170 }} maxLength={20000} value={f.abstract} onChange={(x) => set('abstract', x.target.value)} aria-label="Abstract" /></Field>
        </Section>
        <Section id="links" title="Pillars, projects & cover" desc="Optional. Pillars are the filters on the publications page; projects get a link from the publication.">
          <Field label="Pillars" span={3}><div className="pb-checks" role="group" aria-label="Pillars">{pillars.map((p) => <label key={p.key} className={f.pillarKeys.includes(p.key) ? 'on' : ''}><input type="checkbox" checked={f.pillarKeys.includes(p.key)} onChange={() => toggle('pillarKeys', p.key)} /><span className="pb-dot" style={{ ['--c' as string]: p.colour ?? '#ccc' }} />{p.name}</label>)}{!pillars.length && <span className="muted">No live pillars yet.</span>}</div></Field>
          <Field label="Projects" span={3} hint="Live projects only."><div className="pb-checks" role="group" aria-label="Projects">{projects.map((p) => <label key={p.slug} className={f.projectSlugs.includes(p.slug) ? 'on' : ''}><input type="checkbox" checked={f.projectSlugs.includes(p.slug)} onChange={() => toggle('projectSlugs', p.slug)} />{p.name}</label>)}{!projects.length && <span className="muted">No live projects yet.</span>}</div></Field>
          <div className="ed-media s3">
            {f.coverMediaId && cover ? <div className="ed-media-img pb-cover"><img src={cover.url} alt={cover.alt} /><button type="button" className="btn btn-sm" onClick={() => set('coverMediaId', null)}><Icon n="x" />Remove</button></div>
              : <button type="button" className="ed-drop" onClick={() => setDialog('cover')}><Icon n="image" /><b>Choose a cover image</b><small>Optional, from the media library: e.g. the document’s front page.</small></button>}
            {f.coverMediaId && <button type="button" className="btn btn-sm" onClick={() => setDialog('cover')}><Icon n="image" />Change cover</button>}
          </div>
        </Section>
        <Section id="seo" title="Search & address" desc="Optional. Empty fields use the title and summary.">
          <Field label="SEO title" span={2} count={[f.seoTitle.length, 70]}><input className="input" maxLength={70} value={f.seoTitle} onChange={(x) => set('seoTitle', x.target.value)} aria-label="SEO title" placeholder={f.title} /></Field>
          <Field label="Page address" hint={live ? 'A live publication’s address cannot change.' : undefined}><div className="ed-slug"><span>publication-</span><input className="input mono" aria-label="Page address" disabled={live} value={f.slug} onChange={(x) => { setSlugTouched(true); set('slug', slugify(x.target.value)); }} /></div></Field>
          <Field label="Meta description" span={3} count={[f.seoDescription.length, 170]}><textarea className="textarea" rows={2} maxLength={170} value={f.seoDescription} onChange={(x) => set('seoDescription', x.target.value)} aria-label="Meta description" placeholder={f.summary} /></Field>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of this publication’s page. Reviewed and published on the Translations screen. The PDF itself is not translated.">
        <RecordTranslations noun="publication" dirty={status !== 'published'} files={f.slug ? [`publication-${f.slug}.html`] : []} fields={[{ label: 'Title', value: f.title }, { label: 'Summary', value: f.summary }, ...f.abstract.split(/\n{2,}/).map((x) => ({ label: 'Abstract', value: x.replace(/^[>#-]+\s*/, '') })), { label: 'Organisation', value: f.organisation }, { label: 'SEO title', value: f.seoTitle }, { label: 'Meta description', value: f.seoDescription }]} />
      </Section>
      </div>
      <WorkflowPanel status={status} live={live} problems={o.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not on the website'], ...(o.publishedAt ? [['Published', fmtDate(o.publishedAt)] as [string, string]] : []), ['File', doc && f.documentId ? `PDF · ${size(doc.bytes)}` : f.externalUrl ? 'Online link' : 'None yet'], ...(shownPillars.length ? [['Pillars', shownPillars.map((p) => p.name).join(', ')] as [string, string]] : [])]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open live page</a>}
        {['draft', 'changes_requested'].includes(status) && can('publication.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('publication.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('publication.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('publication.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('publication.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('publication.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this publication?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('publication.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        {(o.history.revisions.length > 0 || o.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{o.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === o.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/publications/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {o.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>

    {dialog === 'cover' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setCover(m[0]); set('coverMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title="Preview · the real publication page" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Publication preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(x) => setComment(x.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this publication?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Builds <span className="mono">{file}</span> and <span className="mono">publications.html</span>{doc && f.documentId ? <>, copies the PDF to <span className="mono">assets/documents/</span></> : null}, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The page, its listing and its PDF are removed from the site. It stays in Studio as a draft with its history.</p></div></Modal>}
  </>;
}
