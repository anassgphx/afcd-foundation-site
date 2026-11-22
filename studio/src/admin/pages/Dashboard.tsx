// Dashboard: the overview of the whole website. Everything comes from the database and respects permissions;
// nothing is invented. Order of importance: what needs you, site health, content, what's coming, recent activity.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, ago, fmtDate, useCan, useMe } from '../ui.tsx';

type Mod = { key: string; label: string; href: string; icon: string; live: number; drafts: number; review: number; note?: string };
type Data = {
  today: string;
  modules: Mod[];
  decisions: { id: string; kind: 'review' | 'publish' | 'changes' | 'failed'; title: string; sub: string; href: string; at: string }[];
  health: { key: string; label: string; value: string; tone: 'ok' | 'warn' | 'bad'; href: string; detail: string }[];
  upcoming: { kind: string; title: string; date: string; href: string; label: string }[];
  recent: { kind: string; title: string; status: string; live: boolean; href: string; at: string }[];
  delivery: { id: string; label: string; what: string; status: string; at: string; error: string | null }[];
};
const KIND_ICON: Record<string, string> = { Project: 'folder', Story: 'log', Event: 'calendar', Opportunity: 'spark', Partner: 'partner', Page: 'layers', Homepage: 'home' };
const DECISION: Record<string, { icon: string; cta: string }> = { review: { icon: 'inbox', cta: 'Review' }, publish: { icon: 'rocket', cta: 'Publish' }, changes: { icon: 'undo', cta: 'Update' }, failed: { icon: 'alert', cta: 'Details' } };
const HEALTH_ICON: Record<string, string> = { delivery: 'globe', seo: 'search', media: 'image', forms: 'mail' };
const isoAgo = (s: string) => s.replace(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/, (m) => ago(m));

export function Dashboard() {
  const me = useMe(); const can = useCan();
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api<Data>('/overview').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="notice n-bad">{err}</div>;
  const hour = new Date().getHours();
  const first = me.user.name.split(' ')[0];
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const actions = [
    can('project.create') && { to: '/studio/projects/new', label: 'New project', icon: 'folder' },
    can('news.create') && { to: '/studio/news', label: 'New story', icon: 'log' },
    can('event.create') && { to: '/studio/events', label: 'New event', icon: 'calendar' },
    can('page.update') && { to: '/studio/home', label: 'Edit homepage', icon: 'home' },
  ].filter(Boolean) as { to: string; label: string; icon: string }[];

  return <div className="db">
    <div className="db-head">
      <div><p className="db-date">{date}</p><h1>Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {first}</h1>
        <p className="muted">{!d ? 'Loading the website overview…' : d.decisions.length ? `${d.decisions.length} thing${d.decisions.length === 1 ? '' : 's'} need${d.decisions.length === 1 ? 's' : ''} your attention.` : 'Nothing needs your attention right now.'}</p></div>
      {actions.length > 0 && <div className="db-actions">{actions.map((a, i) => <Link key={a.to + a.label} to={a.to} className={`btn${i === 0 ? ' btn-primary' : ''}`}><Icon n={i === 0 ? 'plus' : a.icon} />{a.label}</Link>)}</div>}
    </div>

    {/* Site health: four plain answers */}
    <div className="db-health">{(d?.health ?? Array.from({ length: 4 }, () => null)).map((h, i) => h
      ? <Link key={h.key} to={h.href} className={`db-h tone-${h.tone}`}><span className="db-h-ico"><Icon n={HEALTH_ICON[h.key] ?? 'dash'} /></span><span className="min-w-0"><small>{h.label}</small><b>{h.value}</b><span className="db-h-d">{isoAgo(h.detail)}</span></span></Link>
      : <div key={i} className="db-h"><div className="skeleton" style={{ width: '60%' }} /></div>)}</div>

    <div className="db-grid">
      <div className="db-col">
        <section className="card">
          <div className="card-h"><h2>Needs your attention</h2><Link to="/studio/approvals" className="btn btn-sm btn-ghost">Approval queue</Link></div>
          {!d ? <Loading /> : d.decisions.length === 0
            ? <div className="db-clear"><Icon n="check" /><div><b>All clear</b><small>Reviews, items ready to publish and problems will show up here.</small></div></div>
            : <ul className="db-list">{d.decisions.map((n) => <li key={n.id}><Link to={n.href} className={`db-row k-${n.kind}`}>
              <span className="db-ico"><Icon n={DECISION[n.kind].icon} /></span><span className="min-w-0"><b>{n.title}</b><small>{n.sub} · {ago(n.at)}</small></span><span className="btn btn-sm">{DECISION[n.kind].cta}</span></Link></li>)}</ul>}
        </section>

        <section className="card">
          <div className="card-h"><h2>Website content</h2><span className="muted" style={{ fontSize: 12.5 }}>Live on the site · drafts · in review</span></div>
          {!d ? <Loading /> : <div className="db-mods">{d.modules.map((m) => <Link key={m.key} to={m.href} className="db-mod">
            <span className="db-mod-top"><span className="db-ico"><Icon n={m.icon} /></span><Icon n="chev" width={14} height={14} /></span>
            <b>{m.live}</b><span className="db-mod-l">{m.label} live</span>
            <span className="db-mod-sub">{[m.drafts && `${m.drafts} draft${m.drafts === 1 ? '' : 's'}`, m.review && `${m.review} in review`, m.note].filter(Boolean).join(' · ') || 'No drafts'}</span></Link>)}</div>}
        </section>

        <section className="card">
          <div className="card-h"><h2>Recently edited</h2></div>
          {!d ? <Loading /> : d.recent.length === 0 ? <div className="empty">Nothing edited yet.</div>
            : <ul className="db-list">{d.recent.map((r, i) => <li key={i}><Link to={r.href} className="db-row">
              <span className="db-ico"><Icon n={KIND_ICON[r.kind] ?? 'dash'} /></span><span className="min-w-0"><b>{r.title}</b><small>{r.kind} · {ago(r.at)}</small></span>
              <span className="pills">{r.live && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></span></Link></li>)}</ul>}
        </section>
      </div>

      <div className="db-col">
        <section className="card">
          <div className="card-h"><h2>Coming up</h2></div>
          {!d ? <Loading /> : d.upcoming.length === 0 ? <div className="empty">No events, deadlines or scheduled stories in the next weeks.</div>
            : <ol className="db-cal">{d.upcoming.map((u, i) => { const dt = new Date(u.date.length === 10 ? `${u.date}T12:00:00Z` : u.date); return <li key={i}><Link to={u.href} className="db-cal-row">
              <span className="db-cal-d"><b>{dt.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</b><small>{dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</small></span>
              <span className="min-w-0"><b>{u.title}</b><small>{u.kind} · {u.label}{u.date.length > 10 ? ` · ${fmtDate(u.date)}` : ''}</small></span></Link></li>; })}</ol>}
        </section>

        {can('dashboard.read') && <section className="card">
          <div className="card-h"><h2>Website delivery</h2><Link to="/studio/publishing" className="btn btn-sm btn-ghost">History</Link></div>
          {!d ? <Loading /> : d.delivery.length === 0 ? <div className="empty">No publishing activity yet.</div>
            : <ol className="db-feed">{d.delivery.map((j) => <li key={j.id} className={`st-${j.status}`}><span className="db-feed-dot" aria-hidden="true" />
              <span className="min-w-0"><b>{j.label}</b>{j.what && <span className="db-feed-what">{j.what}</span>}<small>{j.status === 'failed' ? `Failed · ${j.error?.slice(0, 90) ?? ''}` : j.status === 'running' ? 'In progress' : 'Delivered and checked'} · {ago(j.at)}</small></span></li>)}</ol>}
        </section>}
      </div>
    </div>
  </div>;
}

export const Loading = () => <div className="card-b stack"><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '50%' }} /></div>;
