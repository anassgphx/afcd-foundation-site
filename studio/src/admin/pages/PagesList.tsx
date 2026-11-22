// Pages list + "New page" with templates.
import { useEffect, useState, type FormEvent } from 'react';
import { api, post, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, navigate, useCan } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';

type Row = { id: string; slug: string; title: string; status: string; publishedRevisionId: string | null; updatedAt: string };
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function PagesList() {
  const can = useCan();
  const [rows, setRows] = useState<Row[] | null>(null); const [creating, setCreating] = useState(false);
  useEffect(() => { api<Row[]>('/pages').then(setRows).catch(() => setRows([])); }, []);
  return <>
    <div className="page-h">
      <div><h1>Pages</h1><p>Pages built with the visual builder from AFCD’s approved blocks. Existing site pages stay managed by their templates.</p></div>
      {can('page.create') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon n="plus" />New page</button>}
    </div>
    <section className="card">{!rows ? <Loading /> : rows.length === 0 ? <div className="empty">No builder pages yet. Create one from a template.</div> :
      <div className="scroll-x"><table className="table"><thead><tr><th>Page</th><th>Address</th><th>Status</th><th>Updated</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td><Link className="title" to={`/studio/pages/${r.id}`}>{r.title}</Link></td><td className="mono sub">{r.slug}.html</td>
          <td><div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div></td><td className="sub">{ago(r.updatedAt)}</td></tr>)}
      </tbody></table></div>}</section>
    {creating && <NewPage onClose={() => setCreating(false)} />}
  </>;
}

function NewPage({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<{ id: string; label: string; description: string }[]>([]);
  const [f, setF] = useState({ title: '', slug: '', template: 'campaign' }); const [touched, setTouched] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/pages/catalog').then((c) => setTemplates(c.templates)); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const p = await post<{ id: string }>('/pages', f); navigate(`/studio/pages/${p.id}`); }
    catch (x) { setErr(x instanceof ApiError ? (x.details?.[0]?.message ?? x.message) : 'Could not create the page.'); setBusy(false); }
  }
  return <Modal title="New page" onClose={onClose}><form onSubmit={submit}>
    <div className="modal-b stack">
      <div className="row">
        <label className="field"><span>Page title</span><input className="input" autoFocus value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value, slug: touched ? f.slug : slugify(e.target.value) })} required /></label>
        <label className="field"><span>Address</span><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input className="input mono" aria-label="Address" value={f.slug} onChange={(e) => { setTouched(true); setF({ ...f, slug: slugify(e.target.value) }); }} required /><span className="mono muted">.html</span></div></label>
      </div>
      <div className="field"><span>Start from</span><div className="choice-grid">{templates.map((t) => (
        <label key={t.id} className={`choice${f.template === t.id ? ' on' : ''}`}><input type="radio" name="tpl" checked={f.template === t.id} onChange={() => setF({ ...f, template: t.id })} /><span><b>{t.label}</b><small>{t.description}</small></span></label>))}</div></div>
      {err && <div className="notice n-bad">{err}</div>}
    </div>
    <div className="modal-f"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.title || !f.slug}>{busy ? 'Creating…' : 'Create and open builder'}</button></div>
  </form></Modal>;
}
