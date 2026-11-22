// The Translations tab of a record editor (project, story, event, partner, opportunity): the record's own texts as the
// website shows them, with the French and Arabic beside each. Saves into the same language drafts as the Translations
// screen, so review and publishing stay in one place.
import { Fragment, useEffect, useRef, useState } from 'react';
import { api, ApiError, patch, post } from './api.ts';
import { Badge, Icon, Link, useCan, useToast } from './ui.tsx';
import './translations.css';

type L = 'fr' | 'ar';
type Item = { key: string; files: string[]; placeholder: boolean; code: boolean; tags: number; onPage: boolean; t: Record<L, { text: string; state: 'missing' | 'edited' | 'done' }> };
type View = { pageBuilt: boolean; langs: { lang: L; name: string; native: string; dir: 'ltr' | 'rtl'; status: string; live: boolean }[]; items: Item[] };
const STATE = { missing: ['Not translated', '#d97706'], edited: ['Edited, not published', '#2563eb'], done: ['Published', '#16a34a'] } as const;

function English({ text }: { text: string }) {
  const parts = text.split(/(<[^>]+>)/);
  return <span className="tr-en">{parts.map((p, i) => i % 2 ? <code key={i} className="tr-tag" title={p}>{/^<\//.test(p) ? `</${p.match(/^<\/([a-z0-9]+)/i)?.[1]}>` : `<${p.match(/^<([a-z0-9]+)/i)?.[1]}>`}</code>
    : <Fragment key={i}>{p.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}</Fragment>)}</span>;
}

/** files: the record's own page(s); texts: its English fields, to find it in listings and cards on other pages. */
export function RecordTranslations({ files, texts, noun, dirty }: { files: string[]; texts: string[]; noun: string; dirty?: boolean }) {
  const toast = useToast(); const can = useCan();
  const [v, setV] = useState<View | null>(null); const [edits, setEdits] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [all, setAll] = useState(false);
  const sig = JSON.stringify([files, texts.filter(Boolean)]);
  const seq = useRef(0);   // the editor's fields arrive after the first render: only the latest answer counts
  const load = () => { const n = ++seq.current; return post<View>('/translations/record', { files, texts: texts.filter(Boolean) }).then((x) => { if (n !== seq.current) return; setV(x); setEdits({}); setErrs({}); }).catch((e) => { if (n === seq.current) toast(e.message, true); }); };
  useEffect(() => { load(); }, [sig]);
  if (!v) return <p className="muted" style={{ padding: 16 }}>Loading translations…</p>;

  const id = (key: string, l: L) => `${l}\u0000${key}`;
  const editable = (l: L) => can('translation.update') && !['in_review', 'approved'].includes(v.langs.find((x) => x.lang === l)!.status);
  const items = v.items.filter((i) => all || (!i.placeholder && !i.code));
  const count = Object.keys(edits).length;
  const done = (l: L) => v.items.filter((i) => !i.placeholder && !i.code && i.t[l].text).length;
  const total = v.items.filter((i) => !i.placeholder && !i.code).length;
  const set = (key: string, l: L, val: string, orig: string) => setEdits((e) => { const n = { ...e }; if (val === orig) delete n[id(key, l)]; else n[id(key, l)] = val; return n; });

  async function save() {
    setBusy(true); setErrs({});
    const by: Record<L, Record<string, string | null>> = { fr: {}, ar: {} };
    for (const [k, val] of Object.entries(edits)) { const [l, key] = k.split('\u0000') as [L, string]; by[l][key] = val.trim() ? val : null; }
    try {
      for (const l of ['fr', 'ar'] as L[]) if (Object.keys(by[l]).length) {
        try { await patch(`/translations/${l}`, { strings: by[l] }); }
        catch (e) { if (e instanceof ApiError && e.details?.length) setErrs((x) => ({ ...x, ...Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [id(d.path, l), d.message])) })); throw e; }
      }
      await load(); toast('Translations saved as drafts. They go live after review and publishing in Translations.');
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  return <div className="rt">
    <div className="rt-head">
      <p className="muted" style={{ margin: 0 }}>The French and Arabic of this {noun}, as the website shows it. Untranslated text appears in English. Edits are drafts: they reach the site after review and publishing on the <Link to={`/studio/translations`}>Translations</Link> screen.</p>
      <div className="rt-langs">{v.langs.map((l) => <span key={l.lang} className="rt-lang"><b>{l.name}</b><span className="muted">{done(l.lang)}/{total}</span><Badge s={l.status} /></span>)}</div>
    </div>
    {dirty && <div className="notice n-info"><div>This {noun} has unsaved or unpublished English changes. Translations follow the English that is live on the website; new text appears here once it is published.</div></div>}
    {v.langs.some((l) => !editable(l.lang)) && can('translation.update') && <div className="notice n-info"><div>{v.langs.filter((l) => !editable(l.lang)).map((l) => l.name).join(' and ')} {v.langs.filter((l) => !editable(l.lang)).length === 1 ? 'is' : 'are'} in review. Withdraw on the Translations screen to edit.</div></div>}
    {v.items.length === 0 ? <div className="dt-empty"><Icon n="globe" /><b>{v.pageBuilt ? 'No texts of its own to translate.' : `Nothing to translate yet.`}</b><small>{v.pageBuilt ? 'Its page only shows shared site text.' : `Texts appear here once this ${noun} is published on the website.`}</small></div>
      : <>
        <div className="rt-grid rt-h" aria-hidden="true"><span>English</span>{v.langs.map((l) => <span key={l.lang}>{l.name} <span className="muted" lang={l.lang}>{l.native}</span></span>)}</div>
        <ol className="rt-list">{items.map((i) => <li key={i.key} className="rt-grid rt-row">
          <div className="tr-src"><English text={i.key} />{!i.onPage && <span className="tr-meta"><span className="tr-page" style={{ cursor: 'default' }}>Also in listings</span></span>}{i.tags > 0 && <span className="tr-meta"><span className="tr-hint">Keep {i.tags} tag{i.tags === 1 ? '' : 's'}</span></span>}</div>
          {v.langs.map((l) => { const cur = i.t[l.lang]; const k = id(i.key, l.lang); const val = edits[k] ?? cur.text; const [lab, col] = k in edits ? ['Unsaved', '#7c3aed'] : STATE[cur.state];
            return <div key={l.lang} className="tr-dst">
              <textarea className="textarea" dir={l.dir} lang={l.lang} rows={Math.min(5, Math.max(1, Math.ceil(Math.max(i.key.length, val.length) / 48)))} value={val} disabled={!editable(l.lang)} placeholder={`${l.name} translation`} aria-label={`${l.name} translation`} aria-invalid={!!errs[k]} onChange={(e) => set(i.key, l.lang, e.target.value, cur.text)} />
              <span className="tr-state"><span className="dt-state"><span className="dot" style={{ ['--c' as string]: col }} />{lab}</span>{errs[k] && <span className="tr-err" role="alert">{errs[k]}</span>}<span style={{ flex: 1 }} />
                {editable(l.lang) && !val && <button type="button" className="btn btn-sm btn-ghost" onClick={() => set(i.key, l.lang, i.key, cur.text)}>Keep English</button>}</span>
            </div>; })}
        </li>)}</ol>
        <div className="rt-foot">
          {v.items.length !== items.length || all ? <label className="check"><input type="checkbox" checked={!all} onChange={(e) => setAll(!e.target.checked)} /> <span>Hide sample text and codes</span></label> : <span />}
          <span style={{ flex: 1 }} />
          {count > 0 && <button className="btn btn-ghost" disabled={busy} onClick={() => { setEdits({}); setErrs({}); }}>Discard</button>}
          {can('translation.update') && <button className="btn btn-primary" disabled={!count || busy} onClick={save}><Icon n="save" />{busy ? 'Saving…' : `Save translations${count ? ` (${count})` : ''}`}</button>}
        </div>
      </>}
  </div>;
}
