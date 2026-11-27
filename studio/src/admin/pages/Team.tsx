// Team: the people on the Our Team page, one record per person, with their own review workflow, plus the groups
// (sections of the page) and the order, which are published together by someone who can publish.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, del, post, put, ApiError } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { DataTable, EmptyState, ListToolbar, useUrlState, type Column, TableSkeleton, statusFilter, updatedFilter, useListActions } from '../DataTable.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import '../team.css';

type Group = { id: string; key: string; name: string; description: string; sort: number; show: boolean; count: number; live: boolean };
type Row = { id: string; slug: string; name: string; role: string; groupId: string; photoMediaId: string | null; photo: string | null; email: string; links: { kind: string; url: string }[];
  sort: number; hidden: boolean; status: string; publishedRevisionId: string | null; hasBio: boolean; updatedAt: string };
type TeamData = { groups: Group[]; members: Row[]; layout: { pending: boolean; publishedAt: string | null; number: number | null } };

/** Initials as the team page shows them when there is no photo (same rule as the site generator). */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const nameKey = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const onPage = (r: Row) => (!r.publishedRevisionId ? 'off' : r.hidden ? 'hidden' : 'live');

function Avatar({ r, size = 44 }: { r: { name: string; photo: string | null }; size?: number }) {
  return <span className="dt-thumb tm-ava" style={{ width: size, height: size }}>{r.photo ? <img src={r.photo} alt="" loading="lazy" /> : <span className="tm-ini">{initials(r.name)}</span>}</span>;
}

export function TeamScreen() {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [d, setD] = useState<TeamData | null>(null);
  const [st, set] = useUrlState({ view: 'people', group: 'all', q: '' });
  const [adding, setAdding] = useState(false); const [busy, setBusy] = useState('');
  const load = useCallback(() => api<TeamData>('/team').then(setD).catch((e) => { toast(e.message, true); setD({ groups: [], members: [], layout: { pending: false, publishedAt: null, number: null } }); }), []);
  useEffect(() => { load(); }, [load]);

  async function publishLayout() {
    setBusy('layout');
    try { await post('/team/layout/publish'); await load(); toast('Order and groups published and checked on Our Team'); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(''); }
  }
  async function preview() {
    setBusy('preview');
    const w = window.open('', '_blank');
    try { const r = await post<{ url: string }>('/team/preview'); if (w) w.location.href = r.url; else location.href = r.url; }
    catch (e) { w?.close(); toast((e as Error).message, true); } finally { setBusy(''); }
  }

  return <>
    <div className="page-h"><div><h1>Team</h1><p>One record per person on the Our Team page. People reach the website after review and publishing; groups and order are published together.</p></div>
      <div className="row" style={{ gap: 8 }}>
        {can('about.read') && <Link className="btn" to="/studio/pages/site/team" title="The page’s title, introduction and closing call to action"><Icon n="log" />Page texts</Link>}
        <button className="btn" disabled={!!busy} onClick={preview}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview page'}</button>
        {can('team.create') && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon n="plus" />Add person</button>}
      </div></div>
    {d?.layout.pending && <div className="notice n-info tm-pending" role="status"><div><b>The order or the groups changed.</b> The website keeps the previous order and groups until they are published{d.layout.publishedAt ? ` (last published ${ago(d.layout.publishedAt)})` : ''}.</div>
      {can('team.publish') ? <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={publishLayout}><Icon n="rocket" />{busy === 'layout' ? 'Publishing and checking…' : 'Publish order and groups'}</button>
        : <span className="muted">Someone who can publish needs to publish them.</span>}</div>}
    <div className="seg tm-views" role="tablist" aria-label="View">
      <button type="button" role="tab" aria-selected={st.view === 'people'} className={st.view === 'people' ? 'on' : ''} onClick={() => set('view', 'people')}>People</button>
      <button type="button" role="tab" aria-selected={st.view === 'order'} className={st.view === 'order' ? 'on' : ''} onClick={() => set('view', 'order')}>Order and groups</button>
    </div>
    {!d ? <section className="card"><TableSkeleton /></section>
      : st.view === 'order' ? <OrderBoard d={d} reload={load} />
      : <PeopleTable d={d} st={st} set={set} reload={load} onAdd={() => setAdding(true)} siteUrl={me.siteUrl} />}
    {adding && d && <AddPerson groups={d.groups} members={d.members} onClose={() => setAdding(false)} initialGroup={st.group !== 'all' ? st.group : d.groups[0]?.id} />}
  </>;
}

function PeopleTable({ d, st, set, reload, onAdd, siteUrl }: { d: TeamData; st: Record<string, string>; set: (k: string, v: string) => void; reload: () => Promise<unknown>; onAdd: () => void; siteUrl: string }) {
  const can = useCan(); const toast = useToast();
  const [switching, setSwitching] = useState('');
  const groupName = (id: string) => d.groups.find((g) => g.id === id)?.name ?? '—';
  const acts = useListActions<Row>({
    base: '/team/members', noun: ['person', 'people'], name: (r) => r.name, reload,
    can: { update: can('team.update'), approve: can('team.approve'), publish: can('team.publish'), archive: can('team.update'), preview: true },
    edit: (r) => `/studio/team/${r.id}`, liveUrl: () => siteUrl + 'team.html',
  });
  async function toggle(r: Row) {
    setSwitching(r.id);
    try { await post(`/team/members/${r.id}/visibility`, { hidden: !r.hidden }); await reload(); toast(r.hidden ? `${r.name} is back on Our Team` : `${r.name} is hidden from Our Team. The record and its published version are kept.`); }
    catch (e) { toast((e as Error).message, true); } finally { setSwitching(''); }
  }
  const q = st.q.trim().toLowerCase();
  const base = d.members.filter((r) => !q || `${r.name} ${r.role} ${r.email}`.toLowerCase().includes(q));
  const inTab = (k: string, r: Row) => (k === 'all' ? r.status !== 'archived' : k === 'archived' ? r.status === 'archived' : r.groupId === k && r.status !== 'archived');
  const shown = base.filter((r) => inTab(st.group, r));
  const tabs: [string, string, number][] = [['all', 'All'], ...d.groups.map((g) => [g.id, g.name] as [string, string]), ['archived', 'Archived']]
    .map(([k, l]) => [k, l, base.filter((r) => inTab(k, r)).length] as [string, string, number]).filter((t) => t[0] !== 'archived' || t[2] > 0);
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Person', sort: (r) => r.name, csv: (r) => r.name, render: (r) => <div className="dt-main"><Avatar r={r} /><span className="min-w-0">
      <Link className="title" to={`/studio/team/${r.id}`}>{r.name || 'Unnamed'}</Link><span className="sub">{[r.role || 'No role yet', r.hasBio ? '' : 'No bio', r.photo ? '' : 'No photo'].filter(Boolean).join(' · ')}</span></span></div> },
    { key: 'group', header: 'Group', filter: { type: 'set', title: 'Group', get: (r) => r.groupId, label: groupName }, sort: (r) => d.groups.findIndex((g) => g.id === r.groupId) * 10000 + r.sort, csv: (r) => groupName(r.groupId), render: (r) => <span className="pill">{groupName(r.groupId)}</span> },
    { key: 'page', header: 'On the page', sort: (r) => ['live', 'hidden', 'off'].indexOf(onPage(r)), csv: (r) => onPage(r), render: (r) => {
      const s = onPage(r);
      if (s === 'off') return <span className="sub">Not published</span>;
      return <label className={`tm-switch${switching === r.id ? ' is-busy' : ''}`} title={can('team.publish') ? (s === 'live' ? 'Hide from the team page' : 'Show on the team page') : 'Only someone who can publish can hide or show people'} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" role="switch" checked={s === 'live'} disabled={!can('team.publish') || !!switching} onChange={() => toggle(r)} aria-label={`${r.name} shown on the team page`} />
        <span className="tm-switch-ui" aria-hidden="true" /><span>{switching === r.id ? 'Updating…' : s === 'live' ? 'Shown' : 'Hidden'}</span></label>;
    } },
    { key: 'status', header: 'Status', filter: statusFilter<Row>(), sort: (r) => r.status, csv: (r) => r.status, render: (r) => <div className="pills">{r.publishedRevisionId && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></div> },
    { key: 'updated', header: 'Updated', filter: updatedFilter<Row>(), align: 'right', hideBelow: 760, sort: (r) => -new Date(r.updatedAt).getTime(), csv: (r) => r.updatedAt, render: (r) => <span className="dt-when"><b>{ago(r.updatedAt)}</b></span> },
  ];
  return <section className="card">
    <ListToolbar tabs={tabs} value={st.group} onChange={(v) => set('group', v)} q={st.q} setQ={(v) => set('q', v)} placeholder="Search people" />
    <DataTable id="team" rows={shown} total={d.members.filter((r) => r.status !== 'archived').length} rowKey={(r) => r.id} columns={columns} csvName="afcd-team"
      initialSort={{ key: 'group', dir: 'asc' }} actions={acts.bulk} rowMenu={acts.rowMenu} onOpen={(r) => navigate(`/studio/team/${r.id}`)}
      empty={<EmptyState icon="users" text={d.members.length ? 'No one matches these filters' : 'No team members yet'}
        action={can('team.create') && !d.members.length ? <button className="btn btn-sm btn-primary" onClick={onAdd}><Icon n="plus" />Add person</button> : undefined}
        onClear={st.q || st.group !== 'all' ? () => { set('q', ''); set('group', 'all'); } : undefined} />} />
    {acts.dialog}
  </section>;
}

function AddPerson({ groups, members, onClose, initialGroup }: { groups: Group[]; members: Row[]; onClose: () => void; initialGroup?: string }) {
  const [name, setName] = useState(''); const [groupId, setGroupId] = useState(initialGroup ?? groups[0]?.id ?? ''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const same = nameKey(name).length > 2 ? members.filter((m) => nameKey(m.name) === nameKey(name)) : [];
  async function create() {
    setErr(''); setBusy(true);
    try { const r = await post<{ id: string }>('/team/members', { name: name.trim(), groupId }); navigate(`/studio/team/${r.id}`); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the person.'); } finally { setBusy(false); }
  }
  return <Modal size="sm" title="Add a person" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={name.trim().length < 2 || !groupId || busy} onClick={create}>Add</button></>}>
    <div className="modal-b stack">
      <div className="field"><span>Full name</span><input className="input" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim().length > 1) create(); }} aria-label="Full name" /><small>As the person wants it shown on the website.</small></div>
      {same.length > 0 && <p className="tm-warn" role="alert"><Icon n="eye" width={14} height={14} /><span>{same.length === 1 ? 'Someone' : `${same.length} people`} with this name {same.length === 1 ? 'is' : 'are'} already in Team: {same.map((m, i) => <span key={m.id}>{i ? ', ' : ''}<Link to={`/studio/team/${m.id}`}>{m.name}</Link></span>)}. Keep one record per person; add a new one only for a different person.</span></p>}
      <div className="field"><span>Group</span><select className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Group">{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
    </div></Modal>;
}

/** Groups as cards in page order, each with its people; drag (or the arrow buttons) to reorder. */
function OrderBoard({ d, reload }: { d: TeamData; reload: () => Promise<unknown> }) {
  const can = useCan(); const toast = useToast();
  const editable = can('team.update');
  const [groups, setGroups] = useState(d.groups); const [members, setMembers] = useState(d.members.filter((m) => m.status !== 'archived'));
  useEffect(() => { setGroups(d.groups); setMembers(d.members.filter((m) => m.status !== 'archived')); }, [d]);
  const [drag, setDrag] = useState<{ type: 'group' | 'person'; id: string; groupId?: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<Group | 'new' | null>(null);

  async function saveOrder(groupId: string | null, ids: string[]) {
    try { await post('/team/order', { groupId, ids }); await reload(); }
    catch (e) { toast((e as Error).message, true); await reload(); }
  }
  function moveGroup(from: number, to: number) {
    if (to < 0 || to >= groups.length || from === to) return;
    const next = [...groups]; const [g] = next.splice(from, 1); next.splice(to, 0, g); setGroups(next);
    saveOrder(null, next.map((x) => x.id));
  }
  function movePerson(groupId: string, from: number, to: number) {
    const list = members.filter((m) => m.groupId === groupId);
    if (to < 0 || to >= list.length || from === to) return;
    const [m] = list.splice(from, 1); list.splice(to, 0, m);
    setMembers([...members.filter((x) => x.groupId !== groupId), ...list]);
    saveOrder(groupId, list.map((x) => x.id));
  }
  async function toggleShow(g: Group) {
    try { await put(`/team/groups/${g.id}`, { name: g.name, description: g.description, show: !g.show }); await reload(); toast(g.show ? `“${g.name}” will be hidden once the order and groups are published` : `“${g.name}” will be shown once the order and groups are published`); }
    catch (e) { toast((e as Error).message, true); }
  }
  async function remove(g: Group) {
    if (!confirm(`Remove the empty group “${g.name}”?`)) return;
    try { await del(`/team/groups/${g.id}`); await reload(); toast('Group removed. Publish the order and groups to update the website.'); } catch (e) { toast((e as Error).message, true); }
  }

  return <div className="tm-board">
    <p className="muted tm-board-h">The page shows the groups in this order, each with its people in order. Changes here are saved at once and reach the website when the order and groups are published. To move someone to another group, change the group in their record (it goes through review).</p>
    <ol className="tm-groups">
      {groups.map((g, gi) => {
        const list = members.filter((m) => m.groupId === g.id);
        return <li key={g.id} className={`card tm-group${drag?.type === 'group' && over === g.id ? ' is-over' : ''}${drag?.id === g.id ? ' dragging' : ''}${g.show ? '' : ' is-off'}`}
          onDragOver={(e) => { if (drag?.type === 'group') { e.preventDefault(); setOver(g.id); } }}
          onDrop={(e) => { if (drag?.type === 'group') { e.preventDefault(); moveGroup(groups.findIndex((x) => x.id === drag.id), gi); setDrag(null); setOver(null); } }}>
          <div className="tm-group-h" draggable={editable} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'group', id: g.id }); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
            {editable && <span className="mn-grip" aria-hidden="true">⋮⋮</span>}
            <span className="tm-group-n">{String(gi + 1).padStart(2, '0')}</span>
            <div className="tm-group-t"><b>{g.name}</b><small>{list.length} {list.length === 1 ? 'person' : 'people'}{g.show ? '' : ' · hidden on the page'}{g.live ? '' : ' · new, not on the website yet'}{g.description ? ` · ${g.description}` : ''}</small></div>
            {editable && <div className="tm-group-a">
              <button type="button" className="btn btn-ghost btn-sm icon-btn" disabled={gi === 0} onClick={() => moveGroup(gi, gi - 1)} aria-label={`Move ${g.name} up`}>↑</button>
              <button type="button" className="btn btn-ghost btn-sm icon-btn" disabled={gi === groups.length - 1} onClick={() => moveGroup(gi, gi + 1)} aria-label={`Move ${g.name} down`}>↓</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleShow(g)}><Icon n={g.show ? 'eyeoff' : 'eye'} />{g.show ? 'Hide' : 'Show'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(g)}>Edit</button>
              {list.length === 0 && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(g)}>Remove</button>}
            </div>}
          </div>
          {list.length === 0 ? <p className="muted tm-empty">No one in this group yet. An empty group is not shown on the website.</p>
            : <ol className="tm-people">{list.map((m, i) => <li key={m.id} className={`${drag?.type === 'person' && over === m.id ? 'is-over' : ''}${drag?.id === m.id ? ' dragging' : ''}`}
              draggable={editable} onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'person', id: m.id, groupId: g.id }); }} onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={(e) => { if (drag?.type === 'person' && drag.groupId === g.id) { e.preventDefault(); e.stopPropagation(); setOver(m.id); } }}
              onDrop={(e) => { if (drag?.type === 'person' && drag.groupId === g.id) { e.preventDefault(); e.stopPropagation(); movePerson(g.id, list.findIndex((x) => x.id === drag.id), i); setDrag(null); setOver(null); } }}>
              {editable && <span className="mn-grip" aria-hidden="true">⋮⋮</span>}
              <Avatar r={m} size={34} />
              <span className="tm-person"><Link to={`/studio/team/${m.id}`}>{m.name || 'Unnamed'}</Link><small>{m.role || 'No role yet'}</small></span>
              <span className="tm-person-s">{onPage(m) === 'live' ? <span className="pill">On the page</span> : onPage(m) === 'hidden' ? <span className="pill">Hidden</span> : <Badge s={m.status} />}</span>
              {editable && <span className="tm-person-a">
                <button type="button" className="btn btn-ghost btn-sm icon-btn" disabled={i === 0} onClick={() => movePerson(g.id, i, i - 1)} aria-label={`Move ${m.name} up`}>↑</button>
                <button type="button" className="btn btn-ghost btn-sm icon-btn" disabled={i === list.length - 1} onClick={() => movePerson(g.id, i, i + 1)} aria-label={`Move ${m.name} down`}>↓</button></span>}
            </li>)}</ol>}
        </li>;
      })}
    </ol>
    {editable && <button type="button" className="btn tm-add-group" onClick={() => setEditing('new')}><Icon n="plus" />Add a group</button>}
    {editing && <GroupDialog g={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
  </div>;
}

function GroupDialog({ g, onClose, onSaved }: { g: Group | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(g?.name ?? ''); const [description, setDescription] = useState(g?.description ?? ''); const [show, setShow] = useState(g?.show ?? true);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try { const body = { name: name.trim(), description: description.trim(), show }; if (g) await put(`/team/groups/${g.id}`, body); else await post('/team/groups', body); toast(g ? 'Group saved' : 'Group added'); onSaved(); }
    catch (e) { setErr(e instanceof ApiError && e.details?.length ? e.details.map((x) => x.message).join(' ') : (e as Error).message); } finally { setBusy(false); }
  }
  return <Modal size="sm" title={g ? `Edit “${g.name}”` : 'Add a group'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={name.trim().length < 2 || busy} onClick={save}>{g ? 'Save' : 'Add'}</button></>}>
    <div className="modal-b stack">
      <div className="field"><span>Name</span><input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" /><small>The section heading and its tab on the Our Team page.</small></div>
      <div className="field"><span>Description <i className="muted">(optional)</i></span><textarea className="textarea" rows={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Group description" /><small>{description.length}/400 · shown under the heading.</small></div>
      <label className="tm-check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /><span>Show this group on the website</span></label>
      {err && <div className="notice n-warn" role="alert"><div>{err}</div></div>}
    </div></Modal>;
}

// ---------------------------------------------------------------- one person
type Link_ = { kind: 'linkedin' | 'x' | 'facebook' | 'instagram' | 'website'; url: string };
type Form = { name: string; slug: string; role: string; bio: string; groupId: string; photoMediaId: string | null; email: string; links: Link_[]; provenance: string };
const KEYS: (keyof Form)[] = ['name', 'slug', 'role', 'bio', 'groupId', 'photoMediaId', 'email', 'links', 'provenance'];
type Loaded = Form & { id: string; status: string; hidden: boolean; groupKey: string; publishedRevisionId: string | null; publishedAt: string | null; verifiedAt: string | null; media: MediaItem[]; problems: string[];
  sameName: { id: string; name: string }[]; publicEmails: string[]; linkKinds: Record<string, string>;
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };
const slugify = (s: string) => nameKey(s).replace(/ /g, '-').slice(0, 80);
const LINK_LABEL: Record<string, string> = { linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook', instagram: 'Instagram', website: 'Website' };
const LINK_HINT: Record<string, string> = { linkedin: 'https://www.linkedin.com/in/…', x: 'https://x.com/…', facebook: 'https://www.facebook.com/…', instagram: 'https://www.instagram.com/…', website: 'https://…' };

export function TeamMemberEditor({ id }: { id: string }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [p, setP] = useState<Loaded | null>(null); const [f, setF] = useState<Form | null>(null);
  const [photo, setPhoto] = useState<MediaItem | null>(null); const [groups, setGroups] = useState<Group[]>([]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'photo' | 'preview' | 'publish' | 'unpublish' | 'changes'>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    const [m, t] = await Promise.all([api<Loaded>(`/team/members/${id}`), api<TeamData>('/team')]);
    setP(m); setF(Object.fromEntries(KEYS.map((k) => [k, (m as any)[k]])) as Form); setPhoto(m.media[0] ?? null); setGroups(t.groups); setDirty(false);
  }, [id]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!p || !f) return <Loading />;
  const status = p.status; const live = !!p.publishedRevisionId;
  const editable = can('team.update') && !['in_review', 'archived'].includes(status);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x!, [k]: v })); setDirty(true); };
  const setLink = (i: number, patch: Partial<Link_>) => set('links', f.links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  function showErr(e: unknown) { setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [e instanceof Error ? e.message : 'Something went wrong.']); }
  const group = groups.find((g) => g.id === f.groupId);
  const legal = /legal\s+rep|repr[ée]sentant\s+l[ée]gal/i.test(`${f.role} ${f.bio}`);

  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/team/members/${id}`, f); await load(); toast(live ? 'Draft saved. The team page is unchanged until you publish.' : 'Draft saved. Submit it for review when it is ready.'); return true; }
    catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/team/members/${id}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review. It can be published once approved.', approve: 'Approved. It is ready to publish.', request_changes: 'Sent back to the author with your note.', withdraw: 'Back to draft. You can edit it again.', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function deliver(kind: 'publish' | 'unpublish') {
    setBusy(kind);
    try { const r = await post<{ hidden?: boolean }>(`/team/members/${id}/${kind}`); await load(); setDialog(null); toast(kind === 'publish' ? (r.hidden ? 'Published. The person stays hidden on Our Team until you show them.' : 'Published and checked on Our Team') : 'Removed from Our Team'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function visibility(hidden: boolean) {
    setBusy('visibility');
    try { await post(`/team/members/${id}/visibility`, { hidden }); await load(); toast(hidden ? 'Hidden from Our Team. The published version is kept.' : 'Shown on Our Team again'); }
    catch (e) { showErr(e); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/team/members/${id}/preview`); setUrl(r.url); setDialog('preview'); } catch (e) { showErr(e); } finally { setBusy(''); }
  }
  const pageState = !live ? 'Not on the website' : p.hidden ? 'Published, hidden from the page' : `On the page${status !== 'published' ? ' · newer draft' : ''}`;

  return <>
    <EditorHeader back={{ to: '/studio/team', label: 'Team' }} title={f.name || 'Unnamed'} status={status} live={live && !p.hidden} dirty={dirty}
      extra={<>{group && <span className="pill">{group.name}</span>}{live && p.hidden && <span className="pill">Hidden</span>}</>}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('team.update') && <button className="btn btn-primary" disabled={!!busy || p.problems.length > 0} title={p.problems.length ? `${p.problems.length} thing${p.problems.length === 1 ? '' : 's'} to do first (see the publishing panel)` : undefined} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('team.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('team.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={[
        { id: 'person', label: 'Person', icon: 'users', done: !!(f.name && f.role) },
        { id: 'bio', label: 'Short bio', icon: 'log', optional: true, done: f.bio ? true : undefined },
        { id: 'photo', label: 'Photo', icon: 'image', optional: true, done: f.photoMediaId ? true : undefined },
        { id: 'contact', label: 'Contact and profiles', icon: 'mail', optional: true, done: f.email || f.links.length ? true : undefined },
        { id: 'internal', label: 'Internal', icon: 'lock', optional: true },
        { id: 'translations', label: 'Translations', icon: 'globe', optional: true },
      ]} />
      <div className="ed-col">
      <fieldset className="ed-main" disabled={!editable}>
        <Section id="person" title="Person" desc="One record per person. The name and role appear under the portrait.">
          <div className="tm-top s3">
            <div className="tm-fields">
              <Field label="Full name" count={[f.name.length, 80]} hint="As the person wants it shown."><input className="input input-lg" maxLength={80} value={f.name} onChange={(x) => set('name', x.target.value)} aria-label="Full name" /></Field>
              {p.sameName.length > 0 && <p className="tm-note"><Icon n="eye" width={14} height={14} /><span>Same name as {p.sameName.map((s, i) => <span key={s.id}>{i ? ', ' : ''}<Link to={`/studio/team/${s.id}`}>{s.name}</Link></span>)}. Is it the same person? Keep one record per person.</span></p>}
              <Field label="Role or title" count={[f.role.length, 100]} hint={legal ? <span className="tm-hint-warn">The legal representative is not shown on the website. Describe the role instead (for example, President).</span> : 'For example: President, Programme coordinator, Volunteer.'}>
                <input className="input" maxLength={100} value={f.role} onChange={(x) => set('role', x.target.value)} aria-label="Role or title" /></Field>
              <Field label="Group" hint={live && f.groupId !== groups.find((g) => g.key === p.groupKey)?.id ? 'Moves to the end of the new group. It changes on the website once published.' : 'The section of the page this person appears in.'}>
                <select className="select" value={f.groupId} onChange={(x) => set('groupId', x.target.value)} aria-label="Group">{groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.show ? '' : ' (hidden on the page)'}</option>)}</select></Field>
            </div>
            <div className="tm-prev" aria-label="Preview on the team page"><span className="op-cap">On Our Team</span><PersonCard f={f} photo={f.photoMediaId ? photo : null} /></div>
          </div>
        </Section>
        <Section id="bio" title="Short bio" desc="A few sentences the person agreed to. Plain text.">
          <Field label="Bio" span={3} count={[f.bio.length, 700]}><textarea className="textarea" rows={5} maxLength={700} value={f.bio} onChange={(x) => set('bio', x.target.value)} aria-label="Bio" /></Field>
        </Section>
        <Section id="photo" title="Photo" desc="A portrait from the media library, with the person’s consent confirmed there. The page shows it in black and white, 4:5. Without one the page shows initials.">
          {f.photoMediaId && photo ? <div className="tm-photo s3">
            <div className="tm-photo-stage"><img src={photo.url} alt={photo.alt} style={{ objectPosition: `${photo.focalX ?? 50}% ${photo.focalY ?? 50}%` }} /></div>
            <div className="tm-photo-info"><b>{photo.originalName}</b><small>{photo.width}×{photo.height} px{photo.alt ? ` · alt text: “${photo.alt}”` : ''}</small>
              {!photo.alt && <small className="tm-hint-warn">Add alt text in the Media Library (usually the person’s name).</small>}
              {!photo.rightsConfirmed && <small className="tm-hint-warn">Confirm the usage rights and the person’s consent in the Media Library before review.</small>}
              <div className="row" style={{ gap: 6 }}><Link className="btn btn-sm" to={`/studio/media?id=${photo.id}`}><Icon n="image" />Open in Media Library</Link>
                <button type="button" className="btn btn-sm" onClick={() => setDialog('photo')}>Change</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => set('photoMediaId', null)}><Icon n="x" />Remove</button></div>
            </div></div>
            : <button type="button" className="ed-drop s3" onClick={() => setDialog('photo')}><Icon n="image" /><b>Choose a photo</b><small>From the media library. A portrait with the face near the top works best.</small></button>}
        </Section>
        <Section id="contact" title="Contact and profiles" desc="Optional. Shown as small links under the bio, and in the page’s structured data.">
          <Field label="Email shown" span={3} hint={`Only the foundation’s public addresses can appear on the website. Personal addresses stay off the page.`}>
            <select className="select" value={f.email} onChange={(x) => set('email', x.target.value)} aria-label="Email shown"><option value="">No email</option>{p.publicEmails.map((e) => <option key={e} value={e}>{e}</option>)}</select></Field>
          <div className="tm-links s3">
            {f.links.map((l, i) => <div key={i} className="tm-link">
              <select className="select" value={l.kind} onChange={(x) => setLink(i, { kind: x.target.value as Link_['kind'] })} aria-label={`Link ${i + 1}: kind`}>{Object.entries(p.linkKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className="input mono" maxLength={300} placeholder={LINK_HINT[l.kind]} value={l.url} onChange={(x) => setLink(i, { url: x.target.value.trim() })} aria-label={`Link ${i + 1}: address`} aria-invalid={!!l.url && !/^https:\/\//.test(l.url)} />
              <button type="button" className="btn btn-ghost btn-sm icon-btn" onClick={() => set('links', f.links.filter((_x, j) => j !== i))} aria-label={`Remove link ${i + 1}`}><Icon n="x" /></button>
            </div>)}
            {f.links.length < 6 && <button type="button" className="btn btn-sm" onClick={() => set('links', [...f.links, { kind: f.links.some((x) => x.kind === 'linkedin') ? 'website' : 'linkedin', url: '' }])}><Icon n="plus" />Add a profile link</button>}
            <small className="muted">Public profiles only, with the person’s agreement. Use full https:// addresses.</small>
          </div>
        </Section>
        <Section id="internal" title="Internal" desc="Not shown on the website.">
          <Field label="Source" span={2} hint="Where these details come from (for example, “Confirmed by the person, Nov 2026”)."><input className="input" maxLength={300} value={f.provenance} onChange={(x) => set('provenance', x.target.value)} aria-label="Source" /></Field>
          <Field label="Record key" hint={live ? 'A published person’s key cannot change.' : 'Used for links between records.'}><input className="input mono" disabled={live} value={f.slug} onChange={(x) => set('slug', slugify(x.target.value))} aria-label="Record key" /></Field>
        </Section>
      </fieldset>
      <Section id="translations" title="Translations" desc="French and Arabic of the role and bio. Reviewed and published on the Translations screen.">
        <RecordTranslations noun="team member" dirty={status !== 'published'} files={['team.html']} fields={[{ label: 'Role or title', value: f.role }, { label: 'Bio', value: f.bio }]} />
      </Section>
      </div>
      <WorkflowPanel status={status} live={live} problems={p.problems}
        facts={[['Website', pageState], ...(p.publishedAt ? [['Published', fmtDate(p.publishedAt)] as [string, ReactNode]] : []), ...(p.verifiedAt ? [['Last approved', fmtDate(p.verifiedAt)] as [string, ReactNode]] : [])]}>
        {live && !p.hidden && <a className="btn btn-sm" href={me.siteUrl + 'team.html'} target="_blank" rel="noopener"><Icon n="ext" />Open Our Team</a>}
        {['draft', 'changes_requested'].includes(status) && can('team.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('team.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('team.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('team.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {live && can('team.publish') && <button className="btn" disabled={!!busy} onClick={() => visibility(!p.hidden)}><Icon n={p.hidden ? 'eye' : 'eyeoff'} />{busy === 'visibility' ? 'Updating the page…' : p.hidden ? 'Show on the page' : 'Hide from the page'}</button>}
        {live && can('team.publish') && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('unpublish')}>Remove from website</button>}
        {!live && status !== 'archived' && can('team.update') && <button className="btn btn-ghost" onClick={() => { if (confirm('Archive this record?')) act('archive'); }}><Icon n="archive" />Archive</button>}
        {status === 'archived' && can('team.update') && <button className="btn" onClick={() => act('restore')}>Restore as draft</button>}
        {(p.history.revisions.length > 0 || p.history.comments.some((c) => c.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{p.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === p.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/team/members/${id}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {p.history.comments.filter((c) => c.body).slice(0, 5).map((c) => <li key={c.id}><b>{c.kind.replace('_', ' ')}</b><q>{c.body}</q><small>{fmtDate(c.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>

    {dialog === 'photo' && <MediaPicker onClose={() => setDialog(null)} onPick={(m) => { if (m[0]) { setPhoto(m[0]); set('photoMediaId', m[0].id); } setDialog(null); }} />}
    {dialog === 'preview' && <Modal wide title="Preview · Our Team with this draft" onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Team page preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title="Publish this person?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => deliver('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">team.html</span> and checks the result.{p.hidden ? ' The person stays hidden until you show them.' : ''}{group && !group.live ? ' This group is not on the website yet: publish the order and groups first.' : ''}</p></div></Modal>}
    {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => deliver('unpublish')}>{busy ? 'Removing…' : 'Remove'}</button></>}><div className="modal-b"><p style={{ margin: 0 }}>The person is removed from Our Team. The record stays in Studio as a draft with its history. To take them off the page for a while, use Hide instead.</p></div></Modal>}
  </>;
}

/** The person's card as Our Team shows it, from the form as it is now. */
function PersonCard({ f, photo }: { f: Form; photo: MediaItem | null }) {
  return <div className="tmc">
    <div className={`tmc-vis${photo ? ' has-img' : ''}`}>{photo ? <img src={photo.url} alt="" style={{ objectPosition: `${photo.focalX ?? 50}% ${photo.focalY ?? 50}%` }} /> : <span className="tmc-ini">{initials(f.name)}</span>}</div>
    <b>{f.name || 'Full name'}</b><span className="tmc-r">{f.role || 'Role or title'}</span>
    {f.bio.trim() && <p>{f.bio.length > 180 ? `${f.bio.slice(0, 180)}…` : f.bio}</p>}
    {(f.email || f.links.some((l) => l.url)) && <span className="tmc-l">{f.email && <u>Email</u>}{f.links.filter((l) => l.url).map((l, i) => <u key={i}>{LINK_LABEL[l.kind]} ↗</u>)}</span>}
  </div>;
}
