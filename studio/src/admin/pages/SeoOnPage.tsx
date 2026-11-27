// On-page SEO checklist (server: modules/seo/onpage.ts): every page of the website build, checked against the on-page
// checklist (target keyword, title, H1, description, URL, content, structure, links, images, structured data,
// crawling, speed, mobile, link previews). Automatic checks come from the built HTML; manual reviews are ticked by a
// person. Nothing here is estimated: keyword volume, rankings and Core Web Vitals need outside data.
import { useCallback, useEffect, useState } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Icon, Link, ago, fmtDate, navigate, useCan, useToast } from '../ui.tsx';
import { Loading } from './Dashboard.tsx';
import { DataTable, EmptyState, ListToolbar, type Column } from '../DataTable.tsx';
import { editorFor, tone } from './Seo.tsx';

type Owner = { kind: string; id?: string; label: string };
type Status = 'pass' | 'warn' | 'fail' | 'info' | 'na' | 'todo' | 'done';
type Check = { id: string; group: string; label: string; status: Status; detail: string; fix: string; manual?: boolean; reviewedBy?: string | null; reviewedAt?: string | null; changed?: boolean };
type Counts = { pass: number; warn: number; fail: number; total: number };
type Scores = { content: number | null; technical: number | null };
type Row = { file: string; url: string; title: string; keyphrase: string; intent: string; score: number; scores: Scores; cap: string | null; waiting: number; counts: Counts; manual: { done: number; total: number }; owner: Owner };
type List = { at: string; production: boolean; pages: Row[]; summary: { pages: number; average: number; withKeyphrase: number; failing: number; reviewed: number } };
type View = Omit<Row, 'owner'> & { owner: Owner; h1: string; words: number; production: boolean; builtAt: string; groups: [string, string][]; intents: string[]; checks: Check[]; serp: { title: string; url: string; description: string } };

const MARK: Record<Status, [string, string]> = { pass: ['✓', 'Passed'], warn: ['!', 'Warning'], fail: ['×', 'Failed'], info: ['i', 'Note'], na: ['–', 'Not run'], todo: ['○', 'To review'], done: ['✓', 'Reviewed'] };
const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
const Score = ({ v, size = 'md' }: { v: number | null; size?: 'md' | 'lg' }) => <span className={`onp-score is-${size}`} style={{ ['--c' as string]: v === null ? 'var(--line-strong)' : tone(v) }}><b>{v ?? '—'}</b>{size === 'lg' && <small>/100</small>}</span>;

// ---------------------------------------------------------------- Every page
export function OnPageList() {
  const toast = useToast();
  const [d, setD] = useState<List | null>(null); const [f, setF] = useState('all'); const [q, setQ] = useState('');
  useEffect(() => { api<List>('/seo/onpage').then(setD).catch((e) => toast(e.message, true)); }, []);
  if (!d) return <Loading />;
  const pages = d.pages.filter((p) => p.file !== '404.html');
  const pick = (p: Row) => f === 'all' || (f === 'fix' ? p.counts.fail > 0 : f === 'nokw' ? !p.keyphrase : p.manual.total > 0 && p.manual.done === p.manual.total);
  const rows = pages.filter((p) => pick(p) && (!q || `${p.title} ${p.file} ${p.keyphrase}`.toLowerCase().includes(q.toLowerCase())));
  const cols: Column<Row>[] = [
    { key: 'score', header: 'Score', width: '84px', sort: (p) => p.score, csv: (p) => String(p.score), render: (p) => <Score v={p.score} /> },
    { key: 'page', header: 'Page', sort: (p) => p.title || p.file, csv: (p) => p.file, render: (p) => <div className="min-w-0"><b className="title">{p.title || p.file}</b><div className="sub mono">{p.file}</div></div> },
    { key: 'kw', header: 'Focus keyphrase', sort: (p) => p.keyphrase || '~', csv: (p) => p.keyphrase, render: (p) => p.keyphrase ? <span>{p.keyphrase}</span> : <span className="onp-missing">Not set</span> },
    { key: 'checks', header: 'Checks', sort: (p) => -(p.counts.fail * 100 + p.counts.warn), csv: (p) => `${p.counts.pass}/${p.counts.total}`, hideBelow: 760,
      render: (p) => <span className="onp-mini" title={`${p.counts.pass} passed, ${p.counts.warn} warnings, ${p.counts.fail} failed`}>
        <span className="onp-bar"><i className="is-pass" style={{ flex: p.counts.pass }} /><i className="is-warn" style={{ flex: p.counts.warn }} /><i className="is-fail" style={{ flex: p.counts.fail }} /></span>
        <small>{p.counts.fail ? `${p.counts.fail} failed` : p.counts.warn ? n(p.counts.warn, 'warning') : 'All passed'}</small></span> },
    { key: 'reviews', header: 'Reviews', align: 'right', hideBelow: 900, sort: (p) => p.manual.done, csv: (p) => `${p.manual.done}/${p.manual.total}`, render: (p) => <span className={p.manual.done === p.manual.total ? '' : 'sub'}>{p.manual.done}/{p.manual.total}</span> },
  ];
  return <div className="stack" style={{ gap: 16 }}>
    <div className="onp-summary">
      <div><small>Average on-page score</small><b style={{ color: tone(d.summary.average) }}>{d.summary.average}</b><span>across {n(d.summary.pages, 'page')}</span></div>
      <div><small>Focus keyphrase set</small><b>{d.summary.withKeyphrase}<em>/{d.summary.pages}</em></b><span>each page needs its own</span></div>
      <div><small>Pages with a failed check</small><b style={d.summary.failing ? { color: 'var(--bad)' } : undefined}>{d.summary.failing}</b><span>fix these first</span></div>
      <div><small>Fully reviewed</small><b>{d.summary.reviewed}<em>/{d.summary.pages}</em></b><span>intent, accuracy, originality, phone</span></div>
    </div>
    <section className="card">
      <ListToolbar tabs={[['all', 'All pages', pages.length], ['fix', 'Failed checks', pages.filter((p) => p.counts.fail).length], ['nokw', 'No keyphrase', pages.filter((p) => !p.keyphrase).length], ['reviewed', 'Reviewed', pages.filter((p) => p.manual.total && p.manual.done === p.manual.total).length]]}
        value={f} onChange={setF} q={q} setQ={setQ} placeholder="Search pages or keyphrases" />
      <DataTable id="seo-onpage" rows={rows} total={pages.length} rowKey={(p) => p.file} columns={cols} csvName="afcd-onpage-checklist" initialSort={{ key: 'score', dir: 'asc' }}
        onOpen={(p) => navigate(`/studio/seo/onpage/${p.file}`)} empty={<EmptyState icon="check" text="No pages here" />} />
      <p className="muted onp-foot">Checked live against the website build ({d.production ? 'production' : 'preview'} build, {ago(d.at)}). Keyword volume, rankings and Core Web Vitals need outside data and are not estimated here.</p>
    </section>
  </div>;
}

// ---------------------------------------------------------------- One page
export function OnPagePage({ file }: { file: string }) {
  const can = useCan(); const toast = useToast();
  const [v, setV] = useState<View | null>(null); const [err, setErr] = useState('');
  const [kp, setKp] = useState(''); const [intent, setIntent] = useState(''); const [busy, setBusy] = useState('');
  const [show, setShow] = useState<'todo' | 'all'>('todo');
  const take = useCallback((x: View) => { setV(x); setKp(x.keyphrase); setIntent(x.intent); }, []);
  useEffect(() => { api<View>(`/seo/onpage/${file}`).then(take).catch((e) => setErr(e.message)); }, [file]);
  if (err) return <section className="card"><div className="dt-empty"><Icon n="search" /><b>{err}</b><Link to="/studio/seo/onpage" className="btn btn-sm">All pages</Link></div></section>;
  if (!v) return <Loading />;
  const dirty = kp.trim() !== v.keyphrase || intent !== v.intent;
  async function saveFocus(e?: React.FormEvent) { e?.preventDefault(); setBusy('kw'); try { take(await put<View>(`/seo/onpage/${file}`, { keyphrase: kp.trim(), intent })); toast(kp.trim() ? 'Keyphrase saved. The checks below now use it.' : 'Keyphrase cleared.'); } catch (x) { toast(x instanceof ApiError && x.details?.length ? x.details[0].message : (x as Error).message, true); } finally { setBusy(''); } }
  async function review(c: Check, done: boolean) { setBusy(c.id); try { take(await post<View>(`/seo/onpage/${file}/review`, { id: c.id, done })); toast(done ? 'Marked as reviewed.' : 'Review removed.'); } catch (x) { toast((x as Error).message, true); } finally { setBusy(''); } }
  const edit = editorFor(v.owner, file);
  const open = (c: Check) => !['pass', 'done', 'na'].includes(c.status);
  const titleCut = v.serp.title.length > 60 ? `${v.serp.title.slice(0, 59)}…` : v.serp.title;
  const descCut = v.serp.description.length > 160 ? `${v.serp.description.slice(0, 159)}…` : v.serp.description;
  return <div className="onp">
    <div className="onp-head">
      <Link to="/studio/seo/onpage" className="btn btn-sm btn-ghost"><Icon n="chev" style={{ transform: 'rotate(180deg)' }} width={14} height={14} />All pages</Link>
      <div className="min-w-0"><h2>{v.title || file}</h2><div className="sub mono">{v.url}</div></div>
      <div className="pills">{edit && <Link to={edit} className="btn btn-sm">{v.owner.kind === 'template' ? 'SEO settings' : `Open the ${v.owner.kind} editor`}</Link>}
        <a className="btn btn-sm btn-ghost" href={v.url} target="_blank" rel="noreferrer">View page<span className="sr-only"> (opens in a new tab)</span></a></div>
    </div>

    <div className="onp-layout">
      <aside className="onp-rail">
        <section className="card onp-card">
          <div className="onp-scorebox"><Score v={v.score} size="lg" /><div>
            <b>On-page score</b>
            <dl className="onp-halves"><div><dt>Keyword &amp; content</dt><dd style={{ color: v.scores.content === null ? undefined : tone(v.scores.content) }}>{v.scores.content ?? '—'}</dd></div>
              <div><dt>Technical</dt><dd style={{ color: v.scores.technical === null ? undefined : tone(v.scores.technical) }}>{v.scores.technical ?? '—'}</dd></div></dl></div></div>
          {v.cap && <p className="onp-cap">{v.cap}</p>}
          <div className="onp-tally"><span className="is-pass">{v.counts.pass} passed</span><span className="is-warn">{n(v.counts.warn, 'warning')}</span><span className="is-fail">{v.counts.fail} failed</span><span>{v.manual.done}/{v.manual.total} reviewed</span></div>
          <small className="muted">Studio’s checks of the built page ({v.production ? 'production' : 'preview'} build, {ago(v.builtAt)}). Not a Google ranking.</small>
        </section>

        <form className="card onp-card" onSubmit={saveFocus}>
          <h3>Focus keyphrase</h3>
          <label className="field"><span className="sr-only">Focus keyphrase</span>
            <input className="input" value={kp} maxLength={80} disabled={!can('seo.update')} placeholder="e.g. youth leadership programme Morocco" onChange={(e) => setKp(e.target.value)} /></label>
          <label className="field"><span className="onp-lbl">Search intent</span>
            <select className="select" value={intent} disabled={!can('seo.update')} onChange={(e) => setIntent(e.target.value)}>
              <option value="">Not chosen</option>{v.intents.map((i) => <option key={i} value={i}>{i[0].toUpperCase() + i.slice(1)}{i === 'informational' ? ' (learn something)' : i === 'navigational' ? ' (find AFCD or a page)' : i === 'commercial' ? ' (compare options)' : ' (act: apply, donate, register)'}</option>)}</select></label>
          {can('seo.update') ? <button className="btn btn-primary btn-sm" disabled={!dirty || busy === 'kw'}>{busy === 'kw' ? 'Saving…' : 'Save keyphrase'}</button> : <small className="muted">SEO editors set the keyphrase.</small>}
          <small className="muted">The search phrase this page should be found for. One per page; Studio warns when two pages compete.</small>
        </form>

        <section className="card onp-card">
          <h3>Search result preview</h3>
          <div className="onp-serp" aria-label="How the page may look in Google">
            <span className="onp-serp-url">{v.serp.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
            <span className="onp-serp-title">{titleCut || 'No title'}</span>
            <span className="onp-serp-desc">{descCut || 'No description: Google will pick text from the page.'}</span>
          </div>
          <small className="muted">From the page’s own title and description, cut where search results usually cut them. Google may still rewrite either.</small>
        </section>
      </aside>

      <div className="onp-main">
        <div className="between onp-filter"><b>{show === 'todo' ? `${v.checks.filter(open).length} to look at` : `${v.checks.length} checks`}</b>
          <div className="seg" role="group" aria-label="Show">{([['todo', 'Needs attention'], ['all', 'All checks']] as const).map(([k, l]) => <button key={k} type="button" className={show === k ? 'on' : ''} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}</div></div>
        {v.groups.map(([g, title], i) => {
          const all = v.checks.filter((c) => c.group === g); if (!all.length) return null;
          const list = show === 'all' ? all : all.filter(open);
          const f = all.filter((c) => c.status === 'fail').length, w = all.filter((c) => c.status === 'warn').length, todo = all.filter((c) => c.status === 'todo').length;
          return <section key={g} className={`card onp-group${list.length ? '' : ' is-clear'}`}>
            <div className="onp-group-h"><span className="onp-num">{String(i + 1).padStart(2, '0')}</span><h3>{title}</h3>
              {f + w + todo === 0 ? <span className="onp-badge is-pass">✓ All good</span> : <span className={`onp-badge is-${f ? 'fail' : w ? 'warn' : 'todo'}`}>{[f && `${f} failed`, w && n(w, 'warning'), todo && `${todo} to review`].filter(Boolean).join(' · ')}</span>}</div>
            {list.length > 0 && <ul>{list.map((c) => <li key={c.id} className={`onp-item is-${c.status}`}>
              <span className="onp-mark" role="img" aria-label={MARK[c.status][1]}>{MARK[c.status][0]}</span>
              <div className="min-w-0">
                <b>{c.label}{c.manual && <span className="onp-tag">Manual</span>}</b>
                <small>{c.detail}{c.manual && c.status === 'done' && c.reviewedAt ? ` ${fmtDate(c.reviewedAt)}.` : ''}</small>
                {c.fix && (c.status !== 'pass' && c.status !== 'done') && <details className="onp-fix"><summary>How to fix</summary><p>{c.fix}</p></details>}
              </div>
              {c.manual && can('seo.update') && <button type="button" className={`btn btn-sm${c.status === 'done' ? ' btn-ghost' : ''}`} disabled={busy === c.id} onClick={() => review(c, c.status !== 'done')}>{c.status === 'done' ? 'Undo' : c.changed ? 'Check again' : 'Mark as checked'}</button>}
            </li>)}</ul>}
          </section>;
        })}
        <p className="muted onp-foot">Not measured here: keyword volume and difficulty, rankings, and Core Web Vitals (they need Google or PageSpeed data). Connect Search Console in Integrations for clicks and positions.</p>
      </div>
    </div>
  </div>;
}

/** Overview card: the site's on-page state at a glance. */
export function OnPageCard() {
  const [d, setD] = useState<List | null>(null);
  useEffect(() => { api<List>('/seo/onpage').then(setD).catch(() => setD(null)); }, []);
  return <section className="card sp-mini"><h3>On-page checklist</h3>
    {!d ? <p className="muted">Loading…</p> : <ul className="sp-facts">
      <li><span>Average score</span><b style={{ color: tone(d.summary.average) }}>{d.summary.average}</b></li>
      <li><span>Focus keyphrase set</span><b>{d.summary.withKeyphrase}/{d.summary.pages}</b></li>
      <li><span>Pages with a failed check</span><b>{d.summary.failing}</b></li></ul>}
    <Link to="/studio/seo/onpage" className="btn btn-sm btn-ghost">Open the checklist</Link></section>;
}
