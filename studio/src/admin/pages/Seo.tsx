// SEO studio: an audit of what the built website shows to search engines and link previews, and reviewed SEO
// settings for the site's template pages. Pages managed elsewhere in Studio link to their own editor.
import { useCallback, useEffect, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

type Issue = { level: 'error' | 'warning'; code: string; message: string };
type Owner = { kind: string; id?: string; label: string };
type PageRep = { file: string; title: string; description: string; h1: string; words: number; issues: Issue[]; score: number; owner: Owner };
type Audit = { id: string; at: string; score: number; counts: { errors: number; warnings: number }; pages: PageRep[] };
const EDIT: Record<string, (o: Owner) => string | null> = {
  project: (o) => o.id ? `/studio/projects/${o.id}` : null, story: (o) => o.id ? `/studio/news/${o.id}` : null, event: (o) => o.id ? `/studio/events/${o.id}` : null,
  opportunity: (o) => o.id ? `/studio/opportunities/${o.id}` : '/studio/opportunities', page: (o) => o.id ? `/studio/pages/${o.id}` : null,
};
const tone = (n: number) => (n >= 90 ? '#16a34a' : n >= 70 ? '#ca8a04' : '#dc2626');

export function SeoPage() {
  const path = location.pathname;
  const file = path.match(/^\/studio\/seo\/pages\/([a-z0-9-]+\.html)$/)?.[1];
  if (file) return <SeoEditor key={file} file={file} />;
  return <SeoHome tab={path.startsWith('/studio/seo/pages') ? 'pages' : 'audit'} />;
}

function SeoHome({ tab }: { tab: 'audit' | 'pages' }) {
  return <>
    <div className="page-h"><div><h1>SEO</h1><p>How the website appears in search results and link previews, and the settings for its template pages.</p></div></div>
    <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
      <button className={tab === 'audit' ? 'on' : ''} onClick={() => navigate('/studio/seo')}>Site audit</button>
      <button className={tab === 'pages' ? 'on' : ''} onClick={() => navigate('/studio/seo/pages')}>Page settings</button>
    </div>
    {tab === 'audit' ? <AuditView /> : <PagesView />}
  </>;
}

function AuditView() {
  const toast = useToast();
  const [data, setData] = useState<{ last: Audit | null; history: { at: string; score: number; errors: number; warnings: number }[] } | null>(null);
  const [busy, setBusy] = useState(false); const [f, setF] = useState<'issues' | 'errors' | 'all'>('issues'); const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api('/seo/audit').then(setData), []);
  useEffect(() => { load(); }, [load]);
  async function run() { setBusy(true); try { await post('/seo/audit'); await load(); toast('Audit finished'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } }
  if (!data) return <Loading />;
  const a = data.last;
  const prev = data.history[1];
  const shown = (a?.pages ?? []).filter((p) => f === 'all' || (f === 'errors' ? p.issues.some((i) => i.level === 'error') : p.issues.length)).sort((x, y) => x.score - y.score || x.file.localeCompare(y.file));
  return <>
    <section className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
        <div className="seo-score" style={{ ['--c' as string]: a ? tone(a.score) : '#999' }}><b>{a ? a.score : '—'}</b><small>/ 100</small></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{a ? `${a.pages.length} pages checked` : 'No audit yet'}</h2>
          {a && <p className="muted" style={{ margin: '4px 0 0' }}><b style={{ color: '#dc2626' }}>{a.counts.errors} errors</b> · <b style={{ color: '#ca8a04' }}>{a.counts.warnings} warnings</b> · checked {ago(a.at)}{prev ? ` · ${a.score - prev.score >= 0 ? '+' : ''}${a.score - prev.score} since the previous audit` : ''}</p>}
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>Checks the pages as built: titles, descriptions, headings, image alt text, broken links, the sitemap, sample text and escaping. Run it after publishing.</p>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={run}><Icon n="search" />{busy ? 'Checking…' : 'Run audit'}</button>
      </div>
    </section>
    {a && <section className="card">
      <div className="card-h"><div className="seg">{([['issues', 'With issues'], ['errors', 'Errors only'], ['all', 'All pages']] as const).map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div></div>
      <div className="scroll-x"><table className="table">
        <thead><tr><th>Score</th><th>Page</th><th>Issues</th><th>Edit in</th></tr></thead>
        <tbody>{shown.length === 0 && <tr><td colSpan={4} className="empty">Nothing to fix here.</td></tr>}
          {shown.map((p) => { const to = p.owner.kind === 'template' ? `/studio/seo/pages/${p.file}` : EDIT[p.owner.kind]?.(p.owner) ?? null; return <tr key={p.file}>
            <td><span className="seo-pill" style={{ ['--c' as string]: tone(p.score) }}>{p.score}</span></td>
            <td><span className="title">{p.title || p.file}</span><div className="sub mono">{p.file}</div></td>
            <td>{p.issues.length === 0 ? <span className="muted">No issues</span> : <>
              <ul className="seo-issues">{(open === p.file ? p.issues : p.issues.slice(0, 2)).map((i) => <li key={i.code} className={i.level}>{i.message}</li>)}</ul>
              {p.issues.length > 2 && <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto' }} onClick={() => setOpen(open === p.file ? null : p.file)}>{open === p.file ? 'Show less' : `+${p.issues.length - 2} more`}</button>}</>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{to ? <Link to={to} className="btn btn-sm">{p.owner.kind === 'template' ? 'SEO settings' : `${p.owner.kind[0].toUpperCase()}${p.owner.kind.slice(1)} editor`}</Link> : <span className="muted">{p.owner.kind === 'sample' ? 'Sample page (website code)' : p.owner.label}</span>}</td>
          </tr>; })}</tbody>
      </table></div>
    </section>}
  </>;
}

type PageRow = { file: string; defaults: { title: string; description: string; noindex: boolean } | null; override: null | { id: string; status: string; title: string; description: string; noindex: boolean; publishedRevisionId: string | null; updatedAt: string }; orphan?: boolean };
function PagesView() {
  const [rows, setRows] = useState<PageRow[] | null>(null); const [q, setQ] = useState('');
  useEffect(() => { api<PageRow[]>('/seo/pages').then(setRows); }, []);
  const shown = (rows ?? []).filter((r) => !q || `${r.file} ${r.defaults?.title}`.toLowerCase().includes(q.toLowerCase()));
  return <section className="card">
    <div className="card-h"><p className="muted" style={{ margin: 0 }}>The website’s template pages. Projects, stories, events, opportunities and builder pages have SEO fields in their own editors.</p>
      <label className="search"><Icon n="search" /><span className="sr-only">Search pages</span><input className="input" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
    {!rows ? <Loading /> : <div className="scroll-x"><table className="table">
      <thead><tr><th>Page</th><th>Title in search results</th><th>Settings</th></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.file}>
        <td><Link className="title mono" to={`/studio/seo/pages/${r.file}`}>{r.file}</Link>{r.orphan && <div className="sub">Page no longer a template page</div>}</td>
        <td><span>{r.override?.publishedRevisionId && r.override.title ? r.override.title : r.defaults?.title}</span></td>
        <td>{!r.override ? <span className="muted">Page’s own</span> : <div className="pills">{r.override.publishedRevisionId && r.override.status !== 'published' && <LiveBadge />}<Badge s={r.override.status} /></div>}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

type Detail = { file: string; defaults: { title: string; description: string; noindex: boolean }; owner: Owner | null;
  override: null | { id: string; status: string; title: string; description: string; noindex: boolean; imageMediaId: string | null; publishedRevisionId: string | null; publishedAt: string | null };
  media: MediaItem[]; problems: string[]; history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
type Form = { title: string; description: string; noindex: boolean; imageMediaId: string | null };

function SeoEditor({ file }: { file: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [d, setD] = useState<Detail | null>(null); const [f, setF] = useState<Form>({ title: '', description: '', noindex: false, imageMediaId: null });
  const [img, setImg] = useState<MediaItem | null>(null); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'image' | 'publish' | 'unpublish' | 'changes'>(null); const [comment, setComment] = useState('');
  const load = useCallback(async () => {
    const x = await api<Detail>(`/seo/pages/${file}`); setD(x);
    setF(x.override ? { title: x.override.title, description: x.override.description, noindex: x.override.noindex, imageMediaId: x.override.imageMediaId } : { title: '', description: '', noindex: false, imageMediaId: null });
    setImg(x.media[0] ?? null); setDirty(false);
  }, [file]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  if (!d) return <Loading />;
  if (d.owner) { const to = EDIT[d.owner.kind]?.(d.owner); return <div className="notice n-info"><div>{file} is managed in Studio ({d.owner.label}). {to ? <Link to={to}>Edit its SEO fields there.</Link> : ''}</div></div>; }
  const o = d.override; const status = o?.status ?? 'draft'; const live = !!o?.publishedRevisionId;
  const editable = can('seo.update') && status !== 'in_review';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const showErr = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? e.details.map((x) => (x.path ? `${x.path}: ` : '') + x.message) : [e instanceof Error ? e.message : 'Something went wrong.']);
  async function save(): Promise<boolean> { setBusy('save'); setErrs([]); try { await put(`/seo/pages/${file}`, f); await load(); toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved'); return true; } catch (e) { showErr(e); return false; } finally { setBusy(''); } }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    const id = (await api<Detail>(`/seo/pages/${file}`)).override?.id; if (!id) return;
    setBusy(action); setErrs([]);
    try { await post(`/seo/overrides/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment(''); toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { await post(`/seo/overrides/${o!.id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the website' : 'The page uses its own settings again'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  const title = f.title || d.defaults.title; const desc = f.description || d.defaults.description;
  return <>
    <div className="page-h">
      <div><Link to="/studio/seo/pages" className="muted" style={{ fontSize: 13 }}>← Page settings</Link><h1 className="mono" style={{ fontSize: 22 }}>{file}</h1>
        <p><span className="pills">{live && status !== 'published' && <LiveBadge />}{o ? <Badge s={status} /> : <span className="pill">Page’s own settings</span>}</span>{dirty && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Unsaved</span>}</p></div>
      {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
    </div>
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
    <div className="side-layout">
      <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={!editable}>
        <section className="card stack" style={{ padding: 20 }}>
          <div className="field"><span>Title in search results</span><input className="input" maxLength={70} value={f.title} placeholder={d.defaults.title} onChange={(e) => set('title', e.target.value)} aria-label="Title" /><small>{title.length} / 65 recommended · empty = the page’s own: “{d.defaults.title}”</small></div>
          <div className="field"><span>Meta description</span><textarea className="textarea" maxLength={170} value={f.description} placeholder={d.defaults.description} onChange={(e) => set('description', e.target.value)} aria-label="Meta description" /><small>{desc.length} / 160 recommended · empty = the page’s own</small></div>
          <div className="field"><span>Share image</span>{f.imageMediaId && img ? <div className="thumb" style={{ width: 240 }}><img src={img.url} alt={img.alt} /><button type="button" aria-label="Remove image" onClick={() => set('imageMediaId', null)}>×</button></div> : <small>The site’s default share image is used.</small>}
            <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('image')}><Icon n="image" />{f.imageMediaId ? 'Change' : 'Choose'} image</button><small>Shown when the page is shared on social media or in messaging apps. Landscape (about 1200 × 630) works best.</small></div>
          <label className="check"><input type="checkbox" checked={f.noindex || d.defaults.noindex} disabled={d.defaults.noindex} onChange={(e) => set('noindex', e.target.checked)} /><span><b>Hide from search engines</b><br /><small className="muted">{d.defaults.noindex ? 'This page is already hidden by its own settings.' : 'Adds noindex and removes the page from the sitemap.'}</small></span></label>
        </section>
        <section className="card stack" style={{ padding: 20 }}>
          <small className="muted">Search result preview</small>
          <div className="serp"><div className="serp-url">afcdfoundation.org › {file === 'index.html' ? '' : file}</div><div className="serp-title">{title.length > 65 ? title.slice(0, 63) + '…' : title}</div><div className="serp-desc">{desc.length > 160 ? desc.slice(0, 157) + '…' : desc}</div></div>
          <small className="muted">Link preview</small>
          <div className="og-card">{img && f.imageMediaId ? <img src={img.url} alt="" /> : <div className="og-ph">Default share image</div>}<div className="og-body"><small>AFCDFOUNDATION.ORG</small><b>{title}</b><span>{desc}</span></div></div>
        </section>
      </fieldset>
      <section className="card stack side-panel" style={{ padding: 20 }}>
        <dl className="kv"><dt>Website</dt><dd>{live ? `Custom settings live${status !== 'published' ? ' · newer draft' : ''}` : 'Page’s own settings'}</dd>{o?.publishedAt && <><dt>Published</dt><dd>{fmtDate(o.publishedAt)}</dd></>}</dl>
        <a className="btn btn-sm" href={me.siteUrl + file} target="_blank" rel="noopener"><Icon n="ext" />Open the page</a>
        {o && d.problems.length > 0 && <div className="notice n-warn"><div><b>Before review</b><ul>{d.problems.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        {!o && <p className="muted" style={{ margin: 0 }}>Change a field and save to start a draft.</p>}
        {o && ['draft', 'changes_requested'].includes(status) && can('seo.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('seo.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('seo.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {o && ['in_review', 'approved'].includes(status) && can('seo.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('seo.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Use the page’s own settings</button>}
        {o && !live && status !== 'in_review' && can('seo.update') && <button className="btn btn-ghost" onClick={async () => { if (confirm('Discard these draft settings? The page keeps its own.')) { try { await post(`/seo/overrides/${o.id}/discard`); await load(); toast('Draft discarded'); } catch (e) { showErr(e); } } }}><Icon n="x" />Discard draft</button>}
        {o && <><small className="muted">History</small>
          <ol className="timeline">{d.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === o.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small></li>)}
            {d.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></>}
      </section>
    </div>
    {dialog === 'image' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setImg(m[0]); set('imageMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish these SEO settings?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{file}</span> with the new title, description and share image, then checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Go back to the page’s own settings?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Rebuilding…' : 'Use own settings'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The page is rebuilt with its own title and description. Your settings stay here as a draft.</p></div></Modal>}
  </>;
}
