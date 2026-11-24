// Translations: French and Arabic text of the public site, side by side with the English it replaces.
// Edits are drafts; a language goes to the website only after someone else reviews it and an admin publishes it.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, ApiError, patch, post } from '../api.ts';
import { Badge, Icon, Modal, ago, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { FilterTabs, EmptyState } from '../DataTable.tsx';
import { useDirtyGuard } from '../Editor.tsx';
import { Loading } from './Dashboard.tsx';
import '../translations.css';

type Lang = 'fr' | 'ar';
type Item = { key: string; files: string[]; text: string; published: string; state: 'missing' | 'edited' | 'done'; placeholder: boolean; code: boolean; tags: number };
type View = {
  lang: Lang; name: string; native: string; dir: 'ltr' | 'rtl'; status: string; live: boolean; publishedLive: boolean; revision: string | null;
  publishedAt: string | null; updatedAt: string | null; updatedByName: string | null; submittedBy: string | null;
  counts: { total: number; done: number; edited: number; missing: number; placeholder: number; code: number; unused: number; removed: number };
  pending: number; fileDiffers: boolean; items: Item[]; unused: string[];
};
type Summary = { lang: Lang; name: string; native: string; total: number; translated: number; status: string | null; live: boolean; publishedLive: boolean };

const PER = 25;
const STATE: Record<Item['state'], [string, string]> = { missing: ['Not translated', '#d97706'], edited: ['Edited, not published', '#2563eb'], done: ['Published', '#16a34a'] };
const pageName = (f: string) => f === 'main.js' ? 'Site messages' : f === 'index.html' ? 'Homepage' : f.replace(/\.html$/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** English text with its HTML tags shown as small tokens, so translators see what to keep. */
function English({ text }: { text: string }) {
  const parts = text.split(/(<[^>]+>)/);
  return <span className="tr-en">{parts.map((p, i) => i % 2 ? <code key={i} className="tr-tag" title={p}>{/^<\//.test(p) ? `</${p.match(/^<\/([a-z0-9]+)/i)?.[1]}>` : `<${p.match(/^<([a-z0-9]+)/i)?.[1]}>`}</code>
    : <Fragment key={i}>{p.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')}</Fragment>)}</span>;
}

export function TranslationsPage() {
  const toast = useToast(); const can = useCan(); const me = useMe();
  const [langs, setLangs] = useState<Summary[] | null>(null);
  const [lang, setLang] = useState<Lang>(() => (new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : 'fr'));
  const [v, setV] = useState<View | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [liveEdit, setLiveEdit] = useState<boolean | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [f, setF] = useState('todo'); const [q, setQ] = useState(''); const [file, setFile] = useState(''); const [hideSample, setHideSample] = useState(true);
  const [pg, setPg] = useState(0); const [busy, setBusy] = useState(''); const [dialog, setDialog] = useState<'changes' | 'publish' | null>(null); const [comment, setComment] = useState('');

  const dirtyCount = Object.keys(edits).length + (liveEdit !== null ? 1 : 0);
  useDirtyGuard(dirtyCount > 0);
  const loadAll = () => api<Summary[]>('/translations').then(setLangs).catch((e) => toast(e.message, true));
  const take = (x: View) => { setV(x); setEdits({}); setLiveEdit(null); setErrs({}); };
  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    setV(null); api<View>(`/translations/${lang}`).then(take).catch((e) => toast(e.message, true));
    const u = new URL(location.href); u.searchParams.set('lang', lang); history.replaceState(history.state, '', u);
  }, [lang]);
  useEffect(() => { setPg(0); }, [f, q, file, hideSample, lang]);

  const status = v?.status ?? 'draft';
  const editable = !!v && can('translation.update') && !['in_review', 'approved'].includes(status);
  const files = useMemo(() => [...new Set((v?.items ?? []).flatMap((i) => i.files))].sort((a, b) => (a === 'main.js' ? 1 : b === 'main.js' ? -1 : pageName(a).localeCompare(pageName(b)))), [v]);
  const valueOf = (i: Item) => edits[i.key] ?? i.text;
  const shown = useMemo(() => (v?.items ?? []).filter((i) => {
    if (hideSample && (i.placeholder || i.code) && !i.text) return false;
    if (file && !i.files.includes(file)) return false;
    if (f === 'todo' && i.text) return false;
    if (f === 'edited' && i.state !== 'edited' && !(i.key in edits)) return false;
    if (f === 'done' && i.state !== 'done') return false;
    if (q) { const s = q.toLowerCase(); if (!i.key.toLowerCase().includes(s) && !valueOf(i).toLowerCase().includes(s)) return false; }
    return true;
  }), [v, f, q, file, hideSample, edits]);
  if (!langs || !v) return <Loading />;

  const c = v.counts;
  const hidden = hideSample ? c.placeholder + c.code : 0;
  const visible = c.total - hidden;
  const translated = c.done + c.edited;
  const pct = Math.round((translated / Math.max(1, c.total)) * 100);
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const rows = shown.slice(pg * PER, pg * PER + PER);
  const live = liveEdit ?? v.live;
  const setText = (i: Item, val: string) => { setErrs((e) => { const n = { ...e }; delete n[i.key]; return n; }); setEdits((e) => { const n = { ...e }; if (val === i.text) delete n[i.key]; else n[i.key] = val; return n; }); };

  async function run(label: string, fn: () => Promise<void>, done: string) {
    setBusy(label);
    try { await fn(); setDialog(null); setComment(''); toast(done); loadAll(); }
    catch (e) {
      setDialog(null);
      if (e instanceof ApiError && e.details?.length) { setErrs(Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [d.path, d.message]))); toast(e.message, true); }
      else toast((e as Error).message, true);
    } finally { setBusy(''); }
  }
  const saveBody = () => ({ strings: Object.fromEntries(Object.entries(edits).map(([k, val]) => [k, val.trim() ? val : null])), ...(liveEdit !== null ? { live: liveEdit } : {}) });
  const save = () => run('save', async () => take(await patch<View>(`/translations/${lang}`, saveBody())), 'Draft saved. The website changes only after review and publishing.');
  const act = (action: string, done: string) => run(action, async () => {
    if (dirtyCount) take(await patch<View>(`/translations/${lang}`, saveBody()));
    take(await post<View>(`/translations/${lang}/transition`, { action, comment }));
  }, done);
  const publish = () => run('publish', async () => { await post(`/translations/${lang}/publish`); take(await api<View>(`/translations/${lang}`)); }, `${v.name} published and verified on every ${lang}/ page`);
  const removeUnused = () => run('unused', async () => take(await patch<View>(`/translations/${lang}`, { removeUnused: true })), 'Unused translations removed from the draft');
  const selfReview = v.submittedBy === me.user.id && me.user.role !== 'super_admin';
  const switchLang = (l: Lang) => { if (l === lang) return; if (dirtyCount && !confirm('Discard unsaved changes?')) return; setLang(l); };

  return <div className="tr">
    <div className="page-h"><div><h1>Translations</h1><p>The French and Arabic text of the public website. English stays the source: anything not translated here shows in English. Changes reach the site only after review and publishing.</p></div></div>

    <div className="tr-langs" role="tablist" aria-label="Language">
      {langs.map((l) => { const p = Math.round((l.translated / Math.max(1, l.total)) * 100); return <button key={l.lang} role="tab" aria-selected={lang === l.lang} className={`card tr-lang${lang === l.lang ? ' on' : ''}`} onClick={() => switchLang(l.lang)}>
        <span className="tr-lang-h"><b>{l.name}</b><span className="tr-native" lang={l.lang}>{l.native}</span>{l.status && <Badge s={l.status} label={l.status === 'published' && !l.publishedLive ? 'Saved, not public' : undefined} />}</span>
        <span className="tr-bar" aria-hidden="true"><i style={{ width: `${p}%` }} /></span>
        <span className="tr-lang-f"><span>{l.translated} of {l.total} texts · {p}%</span><span className={`tr-vis${l.publishedLive ? ' pub' : ''}`}>{l.publishedLive ? 'Public on the live site' : 'Preview only'}</span></span>
      </button>; })}
    </div>

    {v.fileDiffers && <div className="notice n-warn"><div><b>The language file was changed outside Studio.</b> src/i18n/{lang}.json no longer matches what Studio published. Studio manages this file now: the next publish replaces it with the version here.</div></div>}
    {status === 'changes_requested' && <div className="notice n-warn"><div>A reviewer asked for changes. Update the translations, then send them for review again.</div></div>}
    {(status === 'in_review' || status === 'approved') && <div className="notice n-info"><div>{status === 'in_review' ? 'These translations are in review.' : 'Approved and ready to publish.'} Withdraw them to make more edits.</div></div>}

    <div className="tr-grid">
      <section className="card tr-main">
        <div className="card-h dt-toolbar">
          <FilterTabs value={f} onChange={setF} tabs={[['todo', 'To translate', c.missing - hidden], ['edited', 'Edited', c.edited + Object.keys(edits).filter((k) => v.items.find((i) => i.key === k)?.state !== 'edited').length], ['done', 'Published', c.done], ['all', 'All', visible]]} />
          <div className="dt-tools">
            <select className="select" aria-label="Page" value={file} onChange={(e) => setFile(e.target.value)}><option value="">All pages</option>{files.map((x) => <option key={x} value={x}>{pageName(x)}</option>)}</select>
            <label className="search"><Icon n="search" /><span className="sr-only">Search texts</span><input className="input" placeholder="Search English or translation" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button type="button" className="dt-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}</label>
          </div>
        </div>
        <div className="tr-sub">
          <label className="check"><input type="checkbox" checked={hideSample} onChange={(e) => setHideSample(e.target.checked)} /> <span>Hide sample text and codes <span className="muted">({c.placeholder} lorem ipsum placeholders, {c.code} emails and codes like EN or SO-04)</span></span></label>
          <span className="muted"><span id="tr-keep-help">“Keep English” is for names and terms that stay the same in every language.</span> · {shown.length} text{shown.length === 1 ? '' : 's'}</span>
        </div>

        {rows.length === 0 ? <EmptyState icon="globe" text={f === 'todo' && !q && !file ? `Everything is translated into ${v.name}.` : 'No texts match these filters.'} onClear={q || file || f !== 'all' ? () => { setQ(''); setFile(''); setF('all'); } : undefined} />
          : <ol className="tr-list">{rows.map((i) => {
            const val = valueOf(i); const changed = i.key in edits; const [label, color] = changed ? ['Unsaved', '#7c3aed'] as const : STATE[i.state];
            return <li key={i.key} className={`tr-row${changed ? ' ch' : ''}${errs[i.key] ? ' bad' : ''}`}>
              <div className="tr-src">
                <English text={i.key} />
                <span className="tr-meta">
                  {i.files.slice(0, 3).map((x) => <button key={x} type="button" className="tr-page" onClick={() => setFile(x)} title={`Show only ${pageName(x)}`}>{pageName(x)}</button>)}
                  {i.files.length > 3 && <span className="muted">+{i.files.length - 3} more</span>}
                  {i.tags > 0 && <span className="tr-hint" title="Links, bold text and icons are part of the design; the translation must contain the same tags.">Keep {i.tags} tag{i.tags === 1 ? '' : 's'}</span>}
                </span>
              </div>
              <div className="tr-dst">
                <textarea className="textarea" dir={v.dir} lang={lang} rows={Math.min(6, Math.max(1, Math.ceil(Math.max(i.key.length, val.length) / 70)))} value={val} disabled={!editable}
                  placeholder={editable ? `${v.name} translation` : 'Not translated'} aria-label={`${v.name} translation`} aria-invalid={!!errs[i.key]} onChange={(e) => setText(i, e.target.value)} />
                <span className="tr-state">
                  <span className="dt-state"><span className="dot" style={{ ['--c' as string]: color }} />{label}</span>
                  {errs[i.key] && <span className="tr-err" role="alert">{errs[i.key]}</span>}
                  <span style={{ flex: 1 }} />
                  {editable && !val && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setText(i, i.key)} aria-describedby="tr-keep-help">Keep English</button>}
                  {editable && changed && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setText(i, i.text)}>Undo</button>}
                  {i.state === 'edited' && !changed && i.published && <span className="muted tr-was" title={i.published}>was: {i.published.replace(/<[^>]+>/g, '').slice(0, 60)}{i.published.length > 60 ? '…' : ''}</span>}
                </span>
              </div>
            </li>;
          })}</ol>}

        {pages > 1 && <div className="tr-pager">
          <button className="btn btn-sm" disabled={pg === 0} onClick={() => setPg(pg - 1)}>Previous</button>
          <span className="muted">Page {pg + 1} of {pages}</span>
          <button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPg(pg + 1)}>Next</button>
        </div>}
      </section>

      <aside className="card tr-side">
        <div className="tr-side-h"><b>{v.name} on the website</b><Badge s={status} label={status === 'published' && !v.publishedLive ? 'Saved, not public' : undefined} /></div>
        <div className="tr-big"><b>{pct}%</b><span className="muted">{translated} of {c.total} texts translated</span></div>
        <dl className="kv">
          <dt>Edited, not published</dt><dd>{c.edited + c.removed}</dd>
          <dt>Not translated</dt><dd>{c.missing}{c.placeholder ? <span className="muted"> ({c.placeholder} sample)</span> : null}</dd>
          <dt>Last published</dt><dd>{v.publishedAt ? fmtDate(v.publishedAt) : v.revision === null && status === 'published' ? 'From the site file' : 'Never'}</dd>
          {v.updatedAt && <><dt>Last edit</dt><dd>{ago(v.updatedAt)}{v.updatedByName ? ` · ${v.updatedByName}` : ''}</dd></>}
        </dl>

        <label className={`tr-live${live ? ' on' : ''}`}>
          <input type="checkbox" checked={live} disabled={!editable} onChange={(e) => setLiveEdit(e.target.checked === v.live ? null : e.target.checked)} />
          <span><b>Public on the live site</b><small>{live ? `The production build publishes the ${lang}/ pages and lists them for search engines.` : `Preview builds only: pages show an “under review” notice and search engines are told to skip them.`}</small></span>
        </label>
        {live !== v.publishedLive && <p className="tr-note">{live ? 'Making the language public' : 'Taking the language off the live site'} is part of this draft and goes through review.</p>}
        {c.unused > 0 && editable && <p className="tr-note">{c.unused} translation{c.unused === 1 ? '' : 's'} no longer match any English text on the site. <button className="btn-link" onClick={removeUnused} disabled={!!busy}>Remove them</button></p>}

        <div className="tr-actions">
          {editable && <button className="btn btn-primary" disabled={!dirtyCount || !!busy} onClick={save}><Icon n="save" />{busy === 'save' ? 'Saving…' : `Save draft${dirtyCount ? ` (${dirtyCount})` : ''}`}</button>}
          {editable && dirtyCount > 0 && <button className="btn btn-ghost" disabled={!!busy} onClick={() => { setEdits({}); setLiveEdit(null); setErrs({}); }}>Discard changes</button>}
          {editable && (status === 'draft' || status === 'changes_requested') && <button className="btn" disabled={!!busy || (!dirtyCount && v.pending === 0)} title={!dirtyCount && v.pending === 0 ? 'Nothing has changed since the last publish' : undefined} onClick={() => act('submit', 'Sent for review')}><Icon n="send" />Submit for review</button>}
          {(status === 'in_review' || status === 'approved') && can('translation.update') && <button className="btn" disabled={!!busy} onClick={() => act('withdraw', 'Withdrawn to draft')}><Icon n="undo" />Withdraw</button>}
          {status === 'in_review' && can('translation.approve') && <>
            <button className="btn btn-primary" disabled={!!busy || selfReview} title={selfReview ? 'Someone other than the translator must review' : undefined} onClick={() => act('approve', 'Approved')}><Icon n="check" />Approve</button>
            <button className="btn" disabled={!!busy} onClick={() => setDialog('changes')}>Request changes</button></>}
          {status === 'approved' && can('translation.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="globe" />Publish {v.name}</button>}
          {status === 'approved' && !can('translation.publish') && <p className="tr-note">Approved. A website administrator publishes it.</p>}
        </div>
      </aside>
    </div>

    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', 'Changes requested')}>Send to translator</button></>}>
      <div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" placeholder="Which texts, and what should change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title={`Publish ${v.name} translations`} onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'publish'} onClick={publish}>{busy === 'publish' ? 'Publishing and verifying…' : 'Publish to the website'}</button></>}>
      <div className="modal-b"><p style={{ marginTop: 0 }}>The website is rebuilt with these translations and every {lang}/ page is checked before anything is recorded. If the build or the check fails, the site is restored.</p>
        <p className="muted" style={{ marginBottom: 0 }}>{v.live ? <>The language is <b>public</b>: production builds publish it and list it for search engines.</> : <>The language stays <b>preview only</b>: production builds leave it out until it is made public.</>}</p></div></Modal>}
  </div>;
}
