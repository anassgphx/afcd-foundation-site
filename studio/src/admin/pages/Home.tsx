// Homepage editor: the texts, buttons, photos and figures marked editable in the homepage. Unchanged fields keep the
// text written in the page; edits go through review and are verified on the built page before they count as published.
import { useCallback, useEffect, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

type Field = { key: string; type: 'text' | 'split' | 'rich' | 'link' | 'tail' | 'image'; section: string; label: string; default: any };
type Data = { fields: Field[]; sections: Record<string, string>; media: MediaItem[]; problems: string[];
  content: null | { id: string; status: string; values: Record<string, any>; publishedRevisionId: string | null; publishedAt: string | null };
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function HomeEditor() {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [d, setD] = useState<Data | null>(null); const [vals, setVals] = useState<Record<string, any>>({});
  const [media, setMedia] = useState<Record<string, MediaItem>>({}); const [open, setOpen] = useState<string>('hero.1');
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'image'; key: string } | { kind: 'preview' | 'publish' | 'unpublish' | 'changes' }>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');
  const load = useCallback(async () => {
    const x = await api<Data>('/home'); setD(x); setVals(x.content?.values ?? {}); setMedia(Object.fromEntries(x.media.map((m) => [m.id, m]))); setDirty(false);
  }, []);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);
  if (!d) return <Loading />;
  const c = d.content; const status = c?.status ?? 'draft'; const live = !!c?.publishedRevisionId;
  const editable = can('page.update') && status !== 'in_review';
  const set = (f: Field, v: any) => { setVals((x) => { const n = { ...x }; if (v === null || same(v, f.default)) delete n[f.key]; else n[f.key] = v; return n; }); setDirty(true); };
  const cur = (f: Field) => (f.key in vals ? vals[f.key] : f.default);
  const showErr = (e: unknown) => setErrs(e instanceof ApiError && e.details?.length ? e.details.map((x) => (x.path ? `${labelOf(x.path)}: ` : '') + x.message) : [e instanceof Error ? e.message : 'Something went wrong.']);
  const labelOf = (path: string) => { const f = d.fields.find((x) => path.startsWith(x.key)); return f ? `${d.sections[f.section] ?? f.section} · ${f.label}` : path; };
  async function save(): Promise<boolean> { setBusy('save'); setErrs([]); try { await put('/home', vals); await load(); toast(live ? 'Draft saved. The live homepage is unchanged until you publish.' : 'Draft saved'); return true; } catch (e) { showErr(e); return false; } finally { setBusy(''); } }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post('/home/transition', { action, ...extra }); await load(); setDialog(null); setComment(''); toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind); try { await post(`/home/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? 'Published and verified on the homepage' : 'The homepage shows its original text again'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() { if (dirty && !(await save())) return; setBusy('preview'); try { const r = await post<{ url: string }>('/home/preview'); setUrl(r.url); setDialog({ kind: 'preview' }); } catch (e) { showErr(e); } finally { setBusy(''); } }
  const sections = [...new Set(d.fields.map((f) => f.section))];
  const changed = (s: string) => d.fields.filter((f) => f.section === s && f.key in vals).length;
  const nChanged = Object.keys(vals).length;

  const input = (f: Field) => {
    const v = cur(f); const isChanged = f.key in vals;
    const reset = isChanged && editable ? <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto' }} onClick={() => set(f, null)}>Reset to the page’s text</button> : null;
    let control: React.ReactNode;
    if (f.type === 'split') control = <div className="cols-2"><input className="input" maxLength={90} value={v.main} onChange={(e) => set(f, { ...v, main: e.target.value })} aria-label={`${f.label}, main part`} /><input className="input" maxLength={90} value={v.soft} onChange={(e) => set(f, { ...v, soft: e.target.value })} aria-label={`${f.label}, lighter part`} placeholder="Lighter second part (optional)" /></div>;
    else if (f.type === 'link') control = <div className="cols-2"><input className="input" maxLength={40} value={v.label} onChange={(e) => set(f, { ...v, label: e.target.value })} aria-label={`${f.label} text`} /><input className="input mono" maxLength={300} value={v.href} onChange={(e) => set(f, { ...v, href: e.target.value.trim() })} aria-label={`${f.label} link`} placeholder="about.html, #section or https://…" /></div>;
    else if (f.type === 'image') { const m = v.mediaId ? media[v.mediaId] : null; control = <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="thumb" style={{ width: 180 }}><img src={m ? m.url : '/studio/site/' + v.src} alt={m ? m.alt : v.alt} /></div>
      <button type="button" className="btn btn-sm" disabled={!editable} onClick={() => setDialog({ kind: 'image', key: f.key })}><Icon n="image" />Choose photo</button></div>; }
    else if (f.type === 'rich' || (f.type === 'text' && String(v).length > 80)) control = <textarea className="textarea" maxLength={f.type === 'rich' ? 700 : 300} value={v} onChange={(e) => set(f, e.target.value.replace(/\n/g, ' '))} aria-label={f.label} />;
    else control = <input className="input" maxLength={f.key.endsWith('.value') ? 24 : 240} value={v} onChange={(e) => set(f, e.target.value)} aria-label={f.label} />;
    return <div className={`field${isChanged ? ' hp-changed' : ''}`} key={f.key}><span>{f.label}{isChanged && <em className="hp-dot">edited</em>}</span>{control}
      {f.type === 'rich' && <small>Wrap words in **double stars** to highlight them, as in the original.</small>}
      {f.type === 'split' && <small>The second part is shown lighter, as on the page.</small>}
      {f.key.endsWith('.value') && <small>A figure or short value, e.g. 24+ or Ait Ourir. Use only facts AFCD can confirm.</small>}{reset}</div>;
  };

  return <>
    <div className="page-h">
      <div><h1>Homepage</h1><p>Edit the homepage’s texts, buttons, photos and figures. Fields you don’t change keep the text written in the page.</p>
        <p><span className="pills">{live && status !== 'published' && <LiveBadge />}{c ? <Badge s={status} /> : <span className="pill">Original text</span>}<span className="pill">{nChanged} field{nChanged === 1 ? '' : 's'} changed</span></span>{dirty && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>Unsaved</span>}</p></div>
      <div className="pills">
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && <button className="btn btn-primary" onClick={save} disabled={!dirty || !!busy}><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>}
      </div>
    </div>
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('page.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="side-layout">
      <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={!editable}>
        {sections.map((s) => <section key={s} className="card">
          <button type="button" className="hp-sec" aria-expanded={open === s} onClick={() => setOpen(open === s ? '' : s)}>
            <b>{d.sections[s] ?? s}</b><span className="muted">{changed(s) ? `${changed(s)} changed` : `${d.fields.filter((f) => f.section === s).length} fields`}</span><Icon n="chev" style={{ transform: open === s ? 'rotate(90deg)' : 'none' }} /></button>
          {open === s && <div className="stack" style={{ padding: '0 20px 20px' }}>{d.fields.filter((f) => f.section === s).map(input)}</div>}
        </section>)}
      </fieldset>
      <section className="card stack side-panel" style={{ padding: 20 }}>
        <dl className="kv"><dt>Website</dt><dd>{live ? `Edited homepage live${status !== 'published' ? ' · newer draft' : ''}` : 'Original text'}</dd>{c?.publishedAt && <><dt>Published</dt><dd>{fmtDate(c.publishedAt)}</dd></>}</dl>
        <a className="btn btn-sm" href={me.siteUrl + 'index.html'} target="_blank" rel="noopener"><Icon n="ext" />Open the homepage</a>
        {c && d.problems.length > 0 && <div className="notice n-warn"><div><b>Before review</b><ul>{d.problems.map((x) => <li key={x}>{x}</li>)}</ul></div></div>}
        {!c && <p className="muted" style={{ margin: 0 }}>Change a field and save to start a draft.</p>}
        {c && ['draft', 'changes_requested'].includes(status) && can('page.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('page.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog({ kind: 'changes' })}>Request changes</button></>}
        {status === 'approved' && can('page.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog({ kind: 'publish' })}><Icon n="rocket" />Publish</button>}
        {c && ['in_review', 'approved'].includes(status) && can('page.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('page.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog({ kind: 'unpublish' })}>Show the original text</button>}
        {c && <><small className="muted">History</small>
          <ol className="timeline">{d.history.revisions.slice(0, 6).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === c.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/home/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {d.history.comments.filter((x) => x.body).slice(0, 5).map((x) => <li key={x.id}><b>{x.kind.replace('_', ' ')}</b><q>{x.body}</q><small>{fmtDate(x.createdAt)}</small></li>)}</ol></>}
      </section>
    </div>
    {dialog?.kind === 'image' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { const f = d.fields.find((x) => x.key === dialog.key)!; if (m[0]) { setMedia((x) => ({ ...x, [m[0].id]: m[0] })); set(f, { mediaId: m[0].id }); } setDialog(null); }} />}
    {dialog?.kind === 'preview' && <Modal wide title="Preview · the homepage with your changes" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Homepage preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog?.kind === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog?.kind === 'publish' && <Modal size="sm" title="Publish the homepage changes?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">index.html</span> with {nChanged} changed field{nChanged === 1 ? '' : 's'} and checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
    {dialog?.kind === 'unpublish' && <Modal size="sm" title="Show the original homepage text?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Rebuilding…' : 'Show original'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The homepage is rebuilt with the text written in the page. Your changes stay here as a draft.</p></div></Modal>}
  </>;
}
