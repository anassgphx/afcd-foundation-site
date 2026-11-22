// Forms: the inbox for messages sent through the website, and the newsletter list.
// Personal data: only administrators see this page; messages are deleted after the retention period.
import { useCallback, useEffect, useState } from 'react';
import { api, patch, post, put } from '../api.ts';
import { Icon, Modal, ago, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';

type FormInfo = { key: 'contact' | 'newsletter'; label: string; site: string; settings: { enabled: boolean; retentionDays: number }; counts: Record<string, number> };
type Overview = { forms: FormInfo[]; subscribers: number; topics: string[] };
type Msg = { id: string; topic: string; name: string; email: string; data: { phone?: string; org?: string; message?: string }; status: 'new' | 'in_progress' | 'done' | 'spam'; note: string; assignedTo: string | null; assigneeName: string | null; page: string; createdAt: string };
type Sub = { id: string; email: string; status: string; source: string; consentAt: string; unsubscribedAt: string | null };
const ST: [Msg['status'], string][] = [['new', 'New'], ['in_progress', 'In progress'], ['done', 'Done'], ['spam', 'Spam']];

export function FormsPage() {
  const can = useCan(); const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [tab, setTab] = useState<'contact' | 'newsletter'>('contact');
  const [settings, setSettings] = useState<null | FormInfo>(null);
  const load = useCallback(() => api<Overview>('/forms').then(setOv).catch((e) => toast(e.message, true)), []);
  useEffect(() => { load(); }, [load]);
  if (!ov) return <Loading />;
  return <>
    <div className="page-h"><div><h1>Forms</h1><p>Messages and sign-ups sent through the website. Visible to administrators only.</p></div>
      <div className="pills"><a className="btn" href={`/studio/api/forms/export/${tab}`} download><Icon n="upload" style={{ transform: 'rotate(180deg)' }} />Export CSV</a></div></div>
    <div className="notice n-info"><div>The website sends forms here only when it is built with <span className="mono">FORMS_ENDPOINT</span> set to this Studio’s address. Until Studio is hosted, that works locally only; the public site still says messages aren’t sent.</div></div>
    <div className="seg" role="tablist" aria-label="Forms" style={{ marginBottom: 12 }}>
      {ov.forms.map((f) => <button key={f.key} role="tab" aria-selected={tab === f.key} className={tab === f.key ? 'on' : ''} onClick={() => setTab(f.key)}>
        {f.label} {f.key === 'contact' && (f.counts.new ?? 0) > 0 ? <em className="count">{f.counts.new}</em> : f.key === 'newsletter' ? <span className="muted"> · {ov.subscribers}</span> : null}
        {!f.settings.enabled && <span className="muted"> · paused</span>}</button>)}
    </div>
    {tab === 'contact' ? <Inbox topics={ov.topics} onChange={load} /> : <Subscribers onChange={load} />}
    {can('forms.manage') && <p style={{ marginTop: 12 }}><button className="btn btn-ghost btn-sm" onClick={() => setSettings(ov.forms.find((f) => f.key === tab)!)}><Icon n="lock" />Form settings and data retention</button></p>}
    {settings && <SettingsDialog form={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); load(); toast('Settings saved'); }} />}
  </>;
}

function Inbox({ topics, onChange }: { topics: string[]; onChange: () => void }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [status, setStatus] = useState<string>('new'); const [topic, setTopic] = useState(''); const [q, setQ] = useState('');
  const [rows, setRows] = useState<Msg[] | null>(null); const [sel, setSel] = useState<string | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]); const [note, setNote] = useState(''); const [confirmDel, setConfirmDel] = useState(false);
  const load = useCallback(() => api<Msg[]>(`/forms/contact/submissions${status === 'all' ? '' : `?status=${status}`}`).then(setRows), [status]);
  useEffect(() => { setRows(null); load(); }, [load]);
  useEffect(() => { if (can('users.read')) api<{ users: { id: string; name: string; active: boolean }[] }>('/users').then((r) => setPeople(r.users.filter((u) => u.active))).catch(() => undefined); }, []);
  const shown = (rows ?? []).filter((r) => (!topic || r.topic === topic) && (!q || `${r.name} ${r.email} ${r.data.message ?? ''} ${r.data.org ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const m = shown.find((r) => r.id === sel) ?? null;
  useEffect(() => { setNote(m?.note ?? ''); }, [m?.id]);
  async function change(id: string, body: Record<string, unknown>, msg: string) {
    try { await patch(`/forms/submissions/${id}`, body); await load(); onChange(); toast(msg); } catch (e) { toast((e as Error).message, true); }
  }
  async function remove(id: string) {
    try { await post('/forms/submissions/delete', { ids: [id] }); setSel(null); setConfirmDel(false); await load(); onChange(); toast('Message deleted permanently'); } catch (e) { toast((e as Error).message, true); }
  }
  return <section className="card">
    <div className="card-h">
      <div className="seg" role="group" aria-label="Status">{[...ST, ['all', 'All but spam'] as const].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setSel(null); }}>{l}</button>)}</div>
      <div className="pills">
        <select className="select" style={{ width: 'auto' }} value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic"><option value="">All topics</option>{topics.map((t) => <option key={t}>{t}</option>)}</select>
        <label className="search"><Icon n="search" /><span className="sr-only">Search messages</span><input className="input" placeholder="Search name, email, text" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
    </div>
    {!rows ? <Loading /> : <div className="inbox">
      <ul className="inbox-list" aria-label="Messages">
        {shown.length === 0 && <li className="empty">No messages here.</li>}
        {shown.map((r) => <li key={r.id}><button className={`inbox-row${sel === r.id ? ' on' : ''}${r.status === 'new' ? ' unread' : ''}`} onClick={() => setSel(r.id)}>
          <span className="inbox-top"><b>{r.name}</b><small className="muted">{ago(r.createdAt)}</small></span>
          <span className="inbox-sub"><span className="pill">{r.topic}</span>{r.assigneeName && <small className="muted">→ {r.assigneeName}</small>}</span>
          <span className="inbox-prev muted">{r.data.message}</span></button></li>)}
      </ul>
      <div className="inbox-detail">
        {!m ? <p className="muted" style={{ padding: 24 }}>Choose a message to read it.</p> : <div className="stack" style={{ padding: 20 }}>
          <div><span className="pill">{m.topic}</span><h2 style={{ margin: '10px 0 2px', fontSize: 20 }}>{m.name}</h2>
            <p className="muted" style={{ margin: 0 }}>{m.email}{m.data.phone ? ` · ${m.data.phone}` : ''}{m.data.org ? ` · ${m.data.org}` : ''}</p>
            <small className="muted">Received {fmtDate(m.createdAt)}{m.page ? ` from ${m.page}` : ''}</small></div>
          <div className="msg-body">{m.data.message}</div>
          <div className="pills">
            <a className="btn btn-primary" href={`mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: your message to AFCD Foundation')}`}><Icon n="mail" />Reply by email</a>
            {can('forms.manage') && ST.filter(([k]) => k !== m.status).map(([k, l]) => <button key={k} className="btn" onClick={() => change(m.id, { status: k }, `Marked as ${l.toLowerCase()}`)}>{k === 'spam' ? 'Spam' : `Mark ${l.toLowerCase()}`}</button>)}
          </div>
          {can('forms.manage') && <>
            {people.length > 0 && <div className="field"><span>Assigned to</span><select className="select" value={m.assignedTo ?? ''} onChange={(e) => change(m.id, { assignedTo: e.target.value || null, ...(e.target.value && m.status === 'new' ? { status: 'in_progress' } : {}) }, 'Assignment saved')} aria-label="Assigned to"><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.id === me.user.id ? `${p.name} (me)` : p.name}</option>)}</select></div>}
            <div className="field"><span>Internal note</span><textarea className="textarea" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Internal note" placeholder="Only staff see this." />
              <button className="btn btn-sm" style={{ justifySelf: 'start' }} disabled={note === m.note} onClick={() => change(m.id, { note }, 'Note saved')}>Save note</button></div>
            <button className="btn btn-ghost btn-danger btn-sm" style={{ justifySelf: 'start' }} onClick={() => setConfirmDel(true)}>Delete permanently</button>
          </>}
        </div>}
      </div>
    </div>}
    {confirmDel && m && <Modal size="sm" title="Delete this message?" onClose={() => setConfirmDel(false)} footer={<><button className="btn" onClick={() => setConfirmDel(false)}>Cancel</button><button className="btn btn-primary" onClick={() => remove(m.id)}>Delete permanently</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>The message from {m.name} is deleted for good. This can’t be undone. Mark it Done instead if you only want it out of the way.</p></div></Modal>}
  </section>;
}

function Subscribers({ onChange }: { onChange: () => void }) {
  const can = useCan(); const toast = useToast();
  const [rows, setRows] = useState<Sub[] | null>(null); const [q, setQ] = useState(''); const [del, setDel] = useState<Sub | null>(null);
  const load = useCallback(() => api<Sub[]>('/forms/subscribers').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  async function act(s: Sub, a: 'unsubscribe' | 'delete') {
    try { await post(`/forms/subscribers/${s.id}/${a}`); setDel(null); await load(); onChange(); toast(a === 'delete' ? 'Subscriber deleted' : 'Unsubscribed'); } catch (e) { toast((e as Error).message, true); }
  }
  const shown = (rows ?? []).filter((r) => !q || r.email.includes(q.toLowerCase()));
  return <section className="card">
    <div className="card-h"><p className="muted" style={{ margin: 0 }}>No newsletter service is connected yet: export the list as CSV to send with your mailing tool.</p>
      <label className="search"><Icon n="search" /><span className="sr-only">Search subscribers</span><input className="input" placeholder="Search email" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
    {!rows ? <Loading /> : <div className="scroll-x"><table className="table">
      <thead><tr><th>Email</th><th>Status</th><th>Signed up</th><th>From</th>{can('forms.manage') && <th />}</tr></thead>
      <tbody>{shown.length === 0 && <tr><td colSpan={5} className="empty">No subscribers yet.</td></tr>}
        {shown.map((s) => <tr key={s.id}><td className="mono">{s.email}</td><td><span className="pill">{s.status === 'subscribed' ? 'Subscribed' : 'Unsubscribed'}</span></td><td className="sub">{fmtDate(s.consentAt)}</td><td className="sub mono">{s.source || '—'}</td>
          {can('forms.manage') && <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{s.status === 'subscribed' && <button className="btn btn-ghost btn-sm" onClick={() => act(s, 'unsubscribe')}>Unsubscribe</button>}<button className="btn btn-ghost btn-sm btn-danger" onClick={() => setDel(s)}>Delete</button></td>}</tr>)}</tbody>
    </table></div>}
    {del && <Modal size="sm" title="Delete this subscriber?" onClose={() => setDel(null)} footer={<><button className="btn" onClick={() => setDel(null)}>Cancel</button><button className="btn btn-primary" onClick={() => act(del, 'delete')}>Delete permanently</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}><span className="mono">{del.email}</span> is removed for good, for example after a request to erase their data. This can’t be undone.</p></div></Modal>}
  </section>;
}

function SettingsDialog({ form, onClose, onSaved }: { form: FormInfo; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(form.settings.enabled); const [days, setDays] = useState(form.settings.retentionDays); const [err, setErr] = useState('');
  async function save() { setErr(''); try { await put(`/forms/${form.key}/settings`, { enabled, retentionDays: days }); onSaved(); } catch (e) { setErr((e as Error).message); } }
  return <Modal size="sm" title={`${form.label} · settings`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
    <div className="modal-b stack">
      <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Accept new submissions</b><br /><small className="muted">When paused, the website shows a message to email contact@afcdteam.com instead.</small></span></label>
      <div className="field"><span>Keep messages for (days)</span><input className="input" type="number" min={30} max={1825} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Retention in days" /><small>Older messages are deleted automatically. Spam is deleted after 30 days. Newsletter subscribers stay until they unsubscribe or are deleted.</small></div>
      {err && <div className="notice n-warn"><div>{err}</div></div>}
    </div></Modal>;
}
