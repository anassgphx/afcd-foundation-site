// Dashboard: the overview of the whole website. Everything comes from the database and respects permissions;
// nothing is invented. Order of importance: today's priorities, what needs you, content health, activity, quick actions.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, post } from '../api.ts';
import { Badge, Icon, Link, LiveBadge, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import '../dashboard.css';

type Mod = { key: string; label: string; href: string; icon: string; live: number; drafts: number; review: number; note?: string; scheduled?: number };
type Kind = 'review' | 'publish' | 'changes' | 'failed';
type Data = {
  today: string;
  modules: Mod[];
  decisions: { id: string; kind: Kind; title: string; sub: string; href: string; at: string }[];
  decisionCounts?: Record<Kind, number>;
  health: { key: string; label: string; value: string; tone: 'ok' | 'warn' | 'bad'; href: string; detail: string }[];
  upcoming: { kind: string; title: string; date: string; href: string; label: string }[];
  recent: { kind: string; title: string; status: string; live: boolean; href: string; at: string }[];
  delivery: { id: string; label: string; what: string; status: string; at: string; error: string | null }[];
};
type Cache = { d: Data; langs: Lang[] | null; unread: number | null; at: number };
type Lang = { lang: string; name: string; native: string; dir: string; total: number; translated: number; status: string | null; live: boolean; publishedLive: boolean };

const KIND_ICON: Record<string, string> = { Project: 'folder', Story: 'log', Event: 'calendar', Opportunity: 'spark', Publication: 'book', Partner: 'partner', Page: 'layers', Homepage: 'home', 'Contact page': 'mail' };
const DECISION: Record<Kind, { icon: string; cta: string; label: string }> = {
  review: { icon: 'inbox', cta: 'Review', label: 'Review' }, publish: { icon: 'rocket', cta: 'Publish', label: 'Ready' },
  changes: { icon: 'undo', cta: 'Update', label: 'Changes' }, failed: { icon: 'alert', cta: 'Details', label: 'Failed' },
};
const HEALTH_ICON: Record<string, string> = { delivery: 'globe', seo: 'search', media: 'image', forms: 'mail' };
const isoAgo = (s: string) => s.replace(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/, (m) => ago(m));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nf = new Intl.NumberFormat('en-GB');
/** A failed delivery's cause in plain words, so repeated failures with the same cause read as one problem. */
function causeOf(err: string) {
  if (/Missing image file/i.test(err)) return { key: 'image', title: 'A resized copy of an image is missing on the server', help: 'Studio keeps several sizes of each photo, and one of them isn’t on the server. An administrator can regenerate the image sizes there; then publish again.' };
  if (/timed? ?out|ETIMEDOUT/i.test(err)) return { key: 'timeout', title: 'The website build took too long', help: 'Publish again in a minute. If it keeps happening, an administrator should check the server.' };
  const first = err.split(/(?<=\.)\s/)[0].replace(/\s+/g, ' ').trim();
  return { key: first.replace(/[0-9a-f-]{8,}\S*/gi, '…'), title: first.replace(/\.$/, '') || 'The update didn’t reach the website', help: '' };
}
/** "Publishing failed (publish partner)" → "partner" */
const jobWhat = (title: string) => (title.match(/\((?:un)?publish(?:ing)? ([a-z ]+)\)/i)?.[1] ?? 'website').trim();

export function Dashboard() {
  const me = useMe(); const can = useCan(); const toast = useToast();
  const canTr = can('translation.read'); const canInbox = can('forms.read');
  // Instant view: the last numbers this user saw (this browser tab only, at most 30 minutes old) show at once,
  // and fresh numbers replace them as soon as they arrive.
  const cacheKey = `studio.dash.${me.user.id}`;
  const [cached] = useState<Cache | null>(() => { try { const c = JSON.parse(sessionStorage.getItem(cacheKey) ?? 'null') as Cache | null; return c && Date.now() - c.at < 30 * 60_000 ? c : null; } catch { return null; } });
  const [d, setD] = useState<Data | null>(cached?.d ?? null); const [err, setErr] = useState('');
  const [langs, setLangs] = useState<Lang[] | null>(cached?.langs ?? null);
  const [unread, setUnread] = useState<number | null>(cached?.unread ?? null);
  const [at, setAt] = useState<number | null>(cached?.at ?? null); const atRef = useRef(at); atRef.current = at;
  const [loading, setLoading] = useState(false); const [stale, setStale] = useState(!!cached);
  const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [o, l, u] = await Promise.all([
        api<Data>('/overview'),
        canTr ? api<Lang[]>('/translations').catch(() => [] as Lang[]) : Promise.resolve(null),
        canInbox ? api<{ unread: number }>('/inbox/unread').then((r) => r.unread).catch(() => null) : Promise.resolve(null),
      ]);
      const now = Date.now();
      setD(o); setLangs(l); setUnread(u); setAt(now); setErr(''); setStale(false);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ d: o, langs: l, unread: u, at: now } satisfies Cache)); } catch { /* storage unavailable */ }
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [canTr, canInbox, cacheKey]);
  useEffect(() => { refresh(); }, [refresh]);
  // fresh numbers when you come back to the tab (after 30 s) and every 2 minutes while it is visible
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible' && Date.now() - (atRef.current ?? 0) > 30_000) refresh(); };
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 120_000);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh]);

  const any = (suffix: string) => me.permissions.some((p) => p.endsWith(suffix));
  // counts per kind: from the server when it sends them, otherwise from the (capped) list
  const counts: Record<Kind, number> = d?.decisionCounts ?? (['review', 'publish', 'changes', 'failed'] as Kind[]).reduce((a, k) => ({ ...a, [k]: d?.decisions.filter((x) => x.kind === k).length ?? 0 }), {} as Record<Kind, number>);
  const pending = counts.review + counts.publish + counts.changes + counts.failed;
  const news = d?.modules.find((m) => m.key === 'news');
  const scheduled = news ? news.scheduled ?? Number(news.note?.match(/^(\d+) scheduled/)?.[1] ?? 0) : 0;

  async function create(key: string, path: string, body: Record<string, unknown>, href: (id: string) => string) {
    setBusy(key);
    try { const r = await post<{ id: string }>(path, body); navigate(href(r.id)); }
    catch (e) { toast((e as Error).message, true); setBusy(''); }
  }
  const stamp = () => Date.now().toString(36);
  const today = d?.today ?? new Date().toISOString().slice(0, 10);
  type Action = { key: string; label: string; hint: string; icon: string; to?: string; run?: () => void };
  const actions = ([
    can('news.create') && { key: 'story', label: 'New story', hint: 'News, blog post or press release', icon: 'log', run: () => create('story', '/news', { title: 'Untitled story', slug: `story-${stamp()}`, publishDate: today }, (id) => `/studio/news/${id}`) },
    can('event.create') && { key: 'event', label: 'New event', hint: 'Workshop, training or meetup', icon: 'calendar', run: () => create('event', '/events', { title: 'Untitled event', slug: `untitled-${stamp()}`, startDate: today, registration: 'contact' }, (id) => `/studio/events/${id}`) },
    can('opportunity.create') && { key: 'opp', label: 'New opportunity', hint: 'Call, job, volunteering or grant', icon: 'spark', run: () => create('opp', '/opportunities', { title: 'Untitled opportunity', slug: `untitled-${stamp()}`, applyMethod: 'contact' }, (id) => `/studio/opportunities/${id}`) },
    can('project.create') && { key: 'project', label: 'New project', hint: 'A programme page with its story', icon: 'folder', to: '/studio/projects/new' },
    can('partner.create') && { key: 'partner', label: 'Add partner', hint: 'Logo and link on the partners page', icon: 'partner', to: '/studio/partners' },
    can('page.update') && { key: 'home', label: 'Edit homepage', hint: 'Sections, text and images', icon: 'home', to: '/studio/home' },
    can('media.upload') && { key: 'media', label: 'Upload media', hint: 'Images with alt text and rights', icon: 'upload', to: '/studio/media' },
    can('translation.update') && { key: 'tr', label: 'Translate', hint: 'French and Arabic versions', icon: 'globe', to: '/studio/translations' },
  ].filter(Boolean)) as Action[];
  const primary = actions.find((a) => a.run);

  const hour = new Date().getHours();
  const first = me.user.name.split(' ')[0];
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const inboxNote = unread ? ` ${plural(unread, 'unread message')} in the Inbox.` : '';
  const summary = !d ? 'Loading your overview…'
    : pending === 0 ? (unread ? `Nothing to review or publish.${inboxNote}` : 'You’re all caught up. Nothing is waiting for you.')
    : `${plural(pending, 'item')} need${pending === 1 ? 's' : ''} you: ${[counts.review && `${counts.review} to review`, counts.publish && `${counts.publish} ready to publish`, counts.changes && `${counts.changes} with changes requested`, counts.failed && plural(counts.failed, 'failed publish', 'failed publishes')].filter(Boolean).join(', ')}.${inboxNote}`;

  // failures, grouped by cause (three photos missing the same size are one problem, not three)
  const failures = d?.decisions.filter((x) => x.kind === 'failed') ?? [];
  const groups = [...failures.reduce((m, f) => { const c = causeOf(f.sub); const g = m.get(c.key) ?? { ...c, items: [] as typeof failures }; g.items.push(f); return m.set(c.key, g); }, new Map<string, ReturnType<typeof causeOf> & { items: typeof failures }>()).values()];
  const failedTotal = Math.max(counts.failed, failures.length);
  const allTiles = [
    any('.approve') && { key: 'review', label: 'To review', n: counts.review, href: '/studio/approvals', icon: 'inbox', empty: 'Nothing to review', tone: 'info' },
    any('.publish') && { key: 'publish', label: 'Ready to publish', n: counts.publish, href: '/studio/approvals', icon: 'rocket', empty: 'Nothing ready to publish', tone: 'ok' },
    (any('.update') || any('.create')) && { key: 'changes', label: 'Changes requested', n: counts.changes, href: '/studio/approvals', icon: 'undo', empty: 'No changes requested', tone: 'warn' },
    can('news.read') && { key: 'scheduled', label: 'Scheduled stories', n: scheduled, href: '/studio/news?status=scheduled', icon: 'clock', empty: 'No scheduled stories', tone: 'neutral' },
    canInbox && { key: 'inbox', label: 'Unread messages', n: unread ?? 0, href: '/studio/inbox', icon: 'mail', empty: 'No unread messages', tone: 'info' },
    can('dashboard.read') && { key: 'failed', label: 'Failed publishes', n: counts.failed, href: '/studio/publishing', icon: 'alert', empty: 'No failed publishes', tone: 'bad' },
  ].filter(Boolean) as { key: string; label: string; n: number; href: string; icon: string; empty: string; tone: string }[];
  // what needs action gets a tile (most urgent first); what is clear folds into one quiet line
  const URGENCY = ['failed', 'changes', 'review', 'publish', 'inbox', 'scheduled'];
  const tiles = allTiles.filter((t) => !d || (t.n > 0 && t.key !== 'failed')).sort((a, b) => URGENCY.indexOf(a.key) - URGENCY.indexOf(b.key));
  const clear = d ? allTiles.filter((t) => !t.n) : [];
  // the attention list shows failures once per cause; the alert above explains them
  const attention = d ? [...groups.map((g) => ({ id: `grp:${g.key}`, kind: 'failed' as Kind, title: g.items.length > 1 ? `${g.items.length} ${jobWhat(g.items[0].title)} updates didn’t reach the website` : `A ${jobWhat(g.items[0].title)} update didn’t reach the website`, sub: g.title, href: '/studio/publishing', at: g.items[0].at })), ...d.decisions.filter((x) => x.kind !== 'failed')] : [];
  const others = pending - counts.failed;

  if (err && !d) return <div className="notice n-bad" role="alert">{err} <button className="btn btn-sm" onClick={refresh}>Try again</button></div>;

  return <div className="dsh">
    {/* 1 · greeting and today's priorities */}
    <header className="dsh-head">
      <div className="min-w-0">
        <p className="dsh-eyebrow">{date}<span aria-hidden="true"> · </span>{me.user.roleLabel}</p>
        <h1>Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {first}</h1>
        <p className="dsh-sub" aria-live="polite">{summary}</p>
        <p className="dsh-updated">
          {loading ? <><span className="dsh-spin" aria-hidden="true" />{stale ? 'Showing your last view · updating…' : 'Updating…'}</>
            : err ? <span className="dsh-upd-bad">Couldn’t refresh: {err}</span>
            : at ? <>Updated {ago(new Date(at))}</> : null}
          {!loading && <button type="button" className="dsh-refresh" onClick={refresh} aria-label="Refresh the dashboard">Refresh</button>}
        </p>
      </div>
      <div className="dsh-head-actions">
        {me.siteUrl && <a className="btn" href={me.siteUrl} target="_blank" rel="noreferrer"><Icon n="ext" />View website</a>}
        {primary && <button className="btn btn-primary" onClick={primary.run} disabled={!!busy}><Icon n="plus" />{busy === primary.key ? 'Creating…' : primary.label}</button>}
      </div>
    </header>

    {/* a problem on the live website comes first, explained once, with what to do */}
    {groups.length > 0 && <section className="dsh-alert" role="alert" aria-labelledby="dsh-alert-h">
      <span className="dsh-alert-ico"><Icon n="alert" /></span>
      <div className="dsh-alert-b">
        <h2 id="dsh-alert-h">{failedTotal === 1 ? 'An update didn’t reach the website' : `${failedTotal} updates didn’t reach the website`}</h2>
        {groups.map((g) => <p key={g.key}><b>{g.title}.</b>{g.help && ` ${g.help}`} <span className="dsh-alert-n">{g.items.length > 1 ? `${g.items.length} updates, latest ${ago(g.items[0].at)}` : ago(g.items[0].at)}</span></p>)}
        <p className="dsh-alert-live">The website keeps showing the last version that was delivered.</p>
      </div>
      <Link to="/studio/publishing" className="btn btn-sm dsh-alert-go">See what failed<Icon n="chev" /></Link>
    </section>}

    {(tiles.length > 0 || clear.length > 0) && <section className="dsh-pri" aria-labelledby="dsh-pri">
      <h2 id="dsh-pri" className="sr-only">Today’s priorities</h2>
      {tiles.length > 0 && <ul className="dsh-tiles" style={{ ['--n' as string]: Math.max(2, Math.min(tiles.length, 4)) }}>{tiles.map((t) => <li key={t.key}>
        <Link to={t.href} className={`dsh-tile t-${t.tone}${t.n && d ? ' is-on' : ''}`} aria-label={d ? `${t.label}: ${t.n}` : t.label}>
          <span className="dsh-tile-top"><span>{t.label}</span><Icon n={t.icon} aria-hidden="true" /></span>
          {!d ? <span className="skeleton" style={{ width: 40, height: 24 }} /> : <b>{t.n}</b>}
          <small>{!d ? '\u00a0' : 'Open'}</small>
        </Link></li>)}</ul>}
      {clear.length > 0 && <p className={`dsh-clear${tiles.length ? '' : ' all'}`}>
        <span className="dsh-clear-ico"><Icon n="check" /></span>
        {tiles.length ? <span className="dsh-clear-l">All clear:</span> : <b>All caught up.</b>}
        {clear.map((t) => <Link key={t.key} to={t.href} className="dsh-clear-i" title={t.label}>{t.empty}</Link>)}
      </p>}
    </section>}

    {/* 2 · items that need you, and what's coming */}
    <div className={`dsh-row r-main${d && attention.length === 0 ? ' solo' : ''}`}>
      {!(d && attention.length === 0) && <Panel id="dsh-need" title="Needs your attention" count={d ? others + groups.length : undefined} action={can('project.read') && <Link to="/studio/approvals" className="btn btn-sm btn-ghost">Approval queue<Icon n="chev" /></Link>}>
        {!d ? <Rows /> : attention.length === 0
          ? <Empty icon="check" title="All clear" text="Submissions to review, approved items and publishing problems will show up here." ok />
          : <>
            <ul className="dsh-list">{attention.map((n) => <li key={n.id}><Link to={n.href} className={`dsh-item k-${n.kind}`}>
              <span className="dsh-ico"><Icon n={DECISION[n.kind].icon} /></span>
              <span className="dsh-item-t"><b>{n.title}</b><small>{n.sub} · {ago(n.at)}</small></span>
              <span className="dsh-cta">{DECISION[n.kind].cta}<Icon n="chev" /></span></Link></li>)}</ul>
            {others > attention.length - groups.length && <p className="dsh-more">Showing {attention.length - groups.length} of {others}. <Link to="/studio/approvals">See everything in the approval queue</Link></p>}
          </>}
      </Panel>}

      <Panel id="dsh-soon" title="Coming up" hint="Next 45 days">
        {!d ? <Rows /> : d.upcoming.length === 0 ? <Empty icon="calendar" title="Nothing scheduled" text="Events, application deadlines and scheduled stories will appear here." />
          : <ol className="dsh-list">{d.upcoming.map((u, i) => { const dt = new Date(u.date.length === 10 ? `${u.date}T12:00:00Z` : u.date); const isToday = u.date.slice(0, 10) === d.today; return <li key={i}><Link to={u.href} className="dsh-item">
            <span className={`dsh-date${isToday ? ' is-today' : ''}`}><small>{isToday ? 'Today' : dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</small><b>{dt.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</b></span>
            <span className="dsh-item-t"><b>{u.title}</b><small>{u.kind} · {u.label}{u.date.length > 10 ? ` · ${fmtDate(u.date)}` : ''}</small></span></Link></li>; })}</ol>}
      </Panel>
    </div>

    {/* 3 · content health */}
    <section className="dsh-section" aria-labelledby="dsh-health">
      <div className="dsh-section-h"><h2 id="dsh-health">Content health</h2><p>What is live on the website, what is still in progress, and the site checks.</p></div>
      <div className="dsh-row r-health">
        <Panel id="dsh-content" title="Content" hint="Live · Drafts · In review">
          {!d ? <Rows n={6} /> : d.modules.length === 0 ? <Empty icon="layers" title="No content areas" text="Your role doesn’t include any content areas." />
            : <div className="dsh-table" role="table" aria-label="Content by type">
              <div className="dsh-tr dsh-th" role="row"><span role="columnheader">Type</span><span role="columnheader">Live</span><span role="columnheader">Drafts</span><span role="columnheader">In review</span><span role="columnheader" className="dsh-note-h">Notes</span></div>
              {d.modules.map((m) => <Link key={m.key} to={m.href} className="dsh-tr" role="row">
                <span role="cell" className="dsh-type"><span className="dsh-ico sm"><Icon n={m.icon} /></span>{m.label}</span>
                <span role="cell" data-l="Live" className="dsh-num"><b>{m.live}</b></span>
                <span role="cell" data-l="Drafts" className={`dsh-num${m.drafts ? '' : ' zero'}`}>{m.drafts}</span>
                <span role="cell" data-l="In review" className={`dsh-num${m.review ? ' hot' : ' zero'}`}>{m.review}</span>
                <span role="cell" className="dsh-note">{m.note ?? ''}</span>
              </Link>)}
            </div>}
        </Panel>

        <div className="dsh-stack">
          {canTr && <Panel id="dsh-tr" title="Translations" action={<Link to="/studio/translations" className="btn btn-sm btn-ghost">Open<Icon n="chev" /></Link>}>
            {!langs ? <Rows n={2} /> : langs.length === 0 ? <Empty icon="globe" title="No translation data" text="Translation coverage couldn’t be loaded." />
              : <ul className="dsh-langs">{langs.map((l) => { const pct = l.total ? Math.floor((l.translated / l.total) * 100) : 0; return <li key={l.lang}>
                <div className="dsh-lang-top"><b>{l.name} <span lang={l.lang} dir={l.dir}>{l.native}</span></b><span className="dsh-pct">{pct}%</span></div>
                <div className="dsh-bar" role="progressbar" aria-valuemin={0} aria-valuemax={l.total} aria-valuenow={l.translated} aria-label={`${l.name} coverage`}><span style={{ width: `${pct}%` }} /></div>
                <div className="dsh-lang-sub"><small>{nf.format(l.translated)} of {nf.format(l.total)} texts · {nf.format(l.total - l.translated)} missing</small>
                  <span className="pills">{l.status && !(l.status === 'published' && !l.publishedLive) && <Badge s={l.status} />}<span className={`badge ${l.publishedLive ? 'b-live' : 'dsh-off'}`}>{l.publishedLive ? 'On the site' : 'Not on the site'}</span></span></div>
              </li>; })}</ul>}
          </Panel>}

          {(!d || d.health.length > 0) && <Panel id="dsh-checks" title="Site checks">
            {!d ? <Rows n={4} /> : <ul className="dsh-checks">{d.health.map((h) => <li key={h.key}><Link to={h.href} className={`dsh-check tone-${h.tone}`}>
              <span className="dsh-ico sm"><Icon n={HEALTH_ICON[h.key] ?? 'dash'} /></span>
              <span className="dsh-item-t"><b>{h.label}</b><small>{isoAgo(h.detail)}</small></span>
              <span className="dsh-status"><i aria-hidden="true" />{h.value}</span></Link></li>)}</ul>}
          </Panel>}
        </div>
      </div>
    </section>

    {/* 4 · recent activity and publishing jobs */}
    <section className="dsh-section" aria-labelledby="dsh-act">
      <div className="dsh-section-h"><h2 id="dsh-act">Activity</h2><p>The latest edits across Studio and what was delivered to the website.</p></div>
      <div className="dsh-row r-even">
        <Panel id="dsh-recent" title="Recently edited" action={can('audit.read') && <Link to="/studio/activity" className="btn btn-sm btn-ghost">Activity log<Icon n="chev" /></Link>}>
          {!d ? <Rows /> : d.recent.length === 0 ? <Empty icon="log" title="Nothing edited yet" text="Edits to projects, stories, events and pages will appear here." />
            : <ul className="dsh-list">{d.recent.map((r, i) => <li key={i}><Link to={r.href} className="dsh-item">
              <span className="dsh-ico sm"><Icon n={KIND_ICON[r.kind] ?? 'dash'} /></span>
              <span className="dsh-item-t"><b>{r.title}</b><small>{r.kind} · {ago(r.at)}</small></span>
              <span className="pills">{r.live && r.status !== 'published' && <LiveBadge />}<Badge s={r.status} /></span></Link></li>)}</ul>}
        </Panel>

        {can('dashboard.read') && <Panel id="dsh-pub" title="Publishing" action={<Link to="/studio/publishing" className="btn btn-sm btn-ghost">History<Icon n="chev" /></Link>}>
          {!d ? <Rows /> : d.delivery.length === 0 ? <Empty icon="rocket" title="No publishing yet" text="Each update delivered to the website is listed here." />
            : <ol className="dsh-feed">{d.delivery.map((j) => <li key={j.id} className={`st-${j.status}`}>
              <span className="dsh-dot" aria-hidden="true" />
              <span className="dsh-item-t"><b>{j.label}{j.what && <span className="dsh-what"> · {j.what}</span>}</b>
                <small><span className="sr-only">Status: </span>{j.status === 'failed' ? `Failed · ${j.error?.slice(0, 90) ?? ''}` : j.status === 'running' ? 'In progress' : j.status === 'succeeded' ? 'Delivered and checked' : j.status} · {ago(j.at)}</small></span></li>)}</ol>}
        </Panel>}
      </div>
    </section>

    {/* 5 · quick actions */}
    {actions.length > 0 && <section className="dsh-section" aria-labelledby="dsh-quick">
      <div className="dsh-section-h"><h2 id="dsh-quick">Quick actions</h2><p>New items start as drafts. Nothing goes live until it is reviewed and published.</p></div>
      <ul className="dsh-actions">{actions.map((a) => { const inner = <><span className="dsh-ico"><Icon n={a.icon} /></span><span className="dsh-item-t"><b>{busy === a.key ? 'Creating…' : a.label}</b><small>{a.hint}</small></span><Icon n={a.run ? 'plus' : 'chev'} className="dsh-go" /></>;
        return <li key={a.key}>{a.run ? <button type="button" className="dsh-action" onClick={a.run} disabled={!!busy}>{inner}</button> : <Link to={a.to!} className="dsh-action">{inner}</Link>}</li>; })}</ul>
    </section>}
  </div>;
}

function Panel({ id, title, hint, count, action, children }: { id: string; title: string; hint?: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <section className="dsh-panel" aria-labelledby={id}>
    <div className="dsh-panel-h"><h3 id={id}>{title}{count != null && count > 0 && <span className="dsh-count">{count}</span>}</h3>{hint && <span className="dsh-hint">{hint}</span>}{action || null}</div>
    {children}
  </section>;
}
const Empty = ({ icon, title, text, ok }: { icon: string; title: string; text: string; ok?: boolean }) =>
  <div className={`dsh-empty${ok ? ' ok' : ''}`}><span className="dsh-ico"><Icon n={icon} /></span><div><b>{title}</b><small>{text}</small></div></div>;
const Rows = ({ n = 3 }: { n?: number }) => <div className="dsh-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - (i % 3) * 18}%` }} />)}</div>;

export const Loading = () => <div className="card-b stack"><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '50%' }} /></div>;
