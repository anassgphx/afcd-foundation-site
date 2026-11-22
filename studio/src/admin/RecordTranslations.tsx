// The Translations tab of a record editor (project, story, event, partner, opportunity): the record's texts as the
// website shows them, each labelled (the field it comes from, or what it is on the page) and placed (where it appears),
// with the French and Arabic beside it. Saves into the same language drafts as the Translations screen, so review and
// publishing stay in one place.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, patch, post } from './api.ts';
import { Badge, Icon, Link, useCan, useToast } from './ui.tsx';
import { useDirtyGuard } from './Editor.tsx';
import './translations.css';

type L = 'fr' | 'ar';
type Cell = { text: string; state: 'missing' | 'edited' | 'done' };
type Item = { key: string; files: string[]; where: string[]; group: 'field' | 'page'; label: string; placeholder: boolean; code: boolean; tags: number; t: Record<L, Cell> };
type View = { pageBuilt: boolean; langs: { lang: L; name: string; native: string; dir: 'ltr' | 'rtl'; status: string; live: boolean }[]; items: Item[] };
export type RecordField = { label: string; value: string | null | undefined };

const STATE: Record<Cell['state'] | 'unsaved', [string, string]> = { missing: ['Not translated', '#d97706'], edited: ['Edited · not published', '#2563eb'], done: ['Published', '#16a34a'], unsaved: ['Unsaved', '#7c3aed'] };

function English({ text }: { text: string }) {
  const parts = text.split(/(<[^>]+>)/);
  return <>{parts.map((p, i) => i % 2 ? <code key={i} className="tr-tag" title={p}>{/^<\//.test(p) ? `</${p.match(/^<\/([a-z0-9]+)/i)?.[1]}>` : `<${p.match(/^<([a-z0-9]+)/i)?.[1]}>`}</code>
    : <Fragment key={i}>{p.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}</Fragment>)}</>;
}

/** files: the record's own page(s). fields: its English fields with their form labels, in form order. */
export function RecordTranslations({ files, fields, noun, dirty }: { files: string[]; fields: RecordField[]; noun: string; dirty?: boolean }) {
  const toast = useToast(); const can = useCan();
  const [v, setV] = useState<View | null>(null); const [edits, setEdits] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'all' | 'todo'>('all'); const [extras, setExtras] = useState(false);
  const clean = fields.filter((f) => f.value && f.value.trim()).map((f) => ({ label: f.label, value: String(f.value) }));
  const sig = JSON.stringify([files, clean]);
  const seq = useRef(0);   // the editor's fields arrive after the first render: only the latest answer counts
  const load = () => { const n = ++seq.current; return post<View>('/translations/record', { files, fields: clean }).then((x) => { if (n !== seq.current) return; setV(x); setEdits({}); setErrs({}); }).catch((e) => { if (n === seq.current) toast(e.message, true); }); };
  useEffect(() => { load(); }, [sig]);
  const count = Object.keys(edits).length;
  useDirtyGuard(count > 0);

  const groups = useMemo(() => {
    const items = (v?.items ?? []).filter((i) => (extras || (!i.placeholder && !i.code)) && (show === 'all' || !i.t.fr.text || !i.t.ar.text));
    return [['field', `This ${noun}’s fields`, `Text you wrote in the other tabs, wherever the website shows it.`], ['page', `Other text on its page`, `Page title, search description, photo labels and headings made for this ${noun}.`]]
      .map(([g, title, desc]) => ({ g, title, desc, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  }, [v, show, extras, noun]);
  if (!v) return <p className="muted" style={{ margin: 0 }}>Loading translations…</p>;

  const id = (key: string, l: L) => `${l}\u0000${key}`;
  const editable = (l: L) => can('translation.update') && !['in_review', 'approved'].includes(v.langs.find((x) => x.lang === l)!.status);
  const real = v.items.filter((i) => !i.placeholder && !i.code);
  const done = (l: L) => real.filter((i) => i.t[l].text).length;
  const todo = real.filter((i) => !i.t.fr.text || !i.t.ar.text).length;
  const hidden = v.items.length - real.length;
  const set = (key: string, l: L, val: string, orig: string) => { setErrs((e) => { const n = { ...e }; delete n[id(key, l)]; return n; }); setEdits((e) => { const n = { ...e }; if (val === orig) delete n[id(key, l)]; else n[id(key, l)] = val; return n; }); };

  async function save() {
    setBusy(true); setErrs({});
    const by: Record<L, Record<string, string | null>> = { fr: {}, ar: {} };
    for (const [k, val] of Object.entries(edits)) { const [l, key] = k.split('\u0000') as [L, string]; by[l][key] = val.trim() ? val : null; }
    try {
      for (const l of ['fr', 'ar'] as L[]) if (Object.keys(by[l]).length) {
        try { await patch(`/translations/${l}`, { strings: by[l] }); }
        catch (e) { if (e instanceof ApiError && e.details?.length) setErrs((x) => ({ ...x, ...Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [id(d.path, l), d.message])) })); throw e; }
      }
      await load(); toast('Saved as drafts. They go live after review and publishing on the Translations screen.');
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  return <div className="rt">
    {v.items.length > 0 && <div className="rt-top">
      <div className="rt-langs">{v.langs.map((l) => { const d = done(l.lang); const pct = real.length ? Math.round((d / real.length) * 100) : 0; return <div key={l.lang} className="rt-lang">
        <div className="rt-lang-h"><b>{l.name}</b><span className="muted" lang={l.lang}>{l.native}</span><Badge s={l.status} /></div>
        <div className="tr-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
        <span className="muted">{d} of {real.length} translated</span>
      </div>; })}</div>
      <p className="rt-help">Untranslated text shows in English on the French and Arabic pages. Edits here are drafts: they go live after review and publishing on the <Link to="/studio/translations">Translations screen</Link>.</p>
    </div>}

    {dirty && v.items.length > 0 && <div className="notice n-info"><div>This {noun} has English changes that are not on the website yet. Translations follow the published English; new text appears here once it is published.</div></div>}
    {v.langs.some((l) => !editable(l.lang)) && can('translation.update') && <div className="notice n-info"><div>{v.langs.filter((l) => !editable(l.lang)).map((l) => l.name).join(' and ')} {v.langs.filter((l) => !editable(l.lang)).length === 1 ? 'is' : 'are'} in review, so read-only here. Withdraw on the Translations screen to edit.</div></div>}

    {v.items.length === 0 ? <div className="dt-empty"><Icon n="globe" /><b>{v.pageBuilt ? 'No text of its own to translate.' : 'Nothing to translate yet.'}</b><small>{v.pageBuilt ? 'Its page only shows text shared with the rest of the site.' : `Text appears here once this ${noun} is published on the website.`}</small></div>
      : <>
        <div className="rt-bar">
          <div className="seg" role="tablist" aria-label="Show">
            <button role="tab" aria-selected={show === 'all'} className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All<em>{real.length}</em></button>
            <button role="tab" aria-selected={show === 'todo'} className={show === 'todo' ? 'on' : ''} onClick={() => setShow('todo')}>Needs translation<em>{todo}</em></button>
          </div>
          {hidden > 0 && <label className="check"><input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} /> <span>Show sample text and codes <span className="muted">({hidden})</span></span></label>}
        </div>

        {groups.length === 0 && <div className="dt-empty"><Icon n="check" /><b>Everything is translated.</b></div>}
        {groups.map((g) => <section key={g.g} className="rt-group">
          <header><h3>{g.title} <span className="muted">{g.items.length}</span></h3><p className="muted">{g.desc}</p></header>
          <div className="rt-cols" aria-hidden="true"><span>English</span>{v.langs.map((l) => <span key={l.lang}>{l.name} <span lang={l.lang}>· {l.native}</span></span>)}</div>
          <ol className="rt-list">{g.items.map((i) => <li key={i.key} className="rt-row">
            <div className="rt-label">
              <b>{i.label}</b>
              <span className="rt-where" title={i.where.join(' · ')}>{i.where.slice(0, 3).join(' · ')}{i.where.length > 3 ? ` · +${i.where.length - 3}` : ''}</span>
              {i.tags > 0 && <span className="tr-hint" title="Links, bold text and icons are part of the design. Keep the same tags in the translation.">Keep {i.tags} tag{i.tags === 1 ? '' : 's'}</span>}
            </div>
            <div className="rt-cells">
              <div className="rt-en" lang="en"><English text={i.key} /></div>
              {v.langs.map((l) => { const cur = i.t[l.lang]; const k = id(i.key, l.lang); const val = edits[k] ?? cur.text; const [lab, col] = STATE[k in edits ? 'unsaved' : cur.state];
                return <div key={l.lang} className={`rt-cell${k in edits ? ' ch' : ''}${errs[k] ? ' bad' : ''}`}>
                  <textarea className="textarea" dir={l.dir} lang={l.lang} rows={Math.min(6, Math.max(2, Math.ceil(Math.max(i.key.length, val.length) / 42)))} value={val} disabled={!editable(l.lang)}
                    placeholder={`${l.name} translation`} aria-label={`${i.label}, ${l.name} translation`} aria-invalid={!!errs[k]} onChange={(e) => set(i.key, l.lang, e.target.value, cur.text)} />
                  <div className="rt-state">
                    <span className="dt-state"><span className="dot" style={{ ['--c' as string]: col }} />{lab}</span>
                    {editable(l.lang) && !val && <button type="button" className="btn-link" onClick={() => set(i.key, l.lang, i.key, cur.text)}>Keep English</button>}
                    {editable(l.lang) && k in edits && <button type="button" className="btn-link" onClick={() => set(i.key, l.lang, cur.text, cur.text)}>Undo</button>}
                  </div>
                  {errs[k] && <span className="tr-err" role="alert">{errs[k]}</span>}
                </div>; })}
            </div>
          </li>)}</ol>
        </section>)}
      </>}

    {count > 0 && <div className="rt-save" role="region" aria-label="Unsaved translations">
      <span><b>{count}</b> unsaved translation{count === 1 ? '' : 's'}</span>
      <span style={{ flex: 1 }} />
      <button className="btn btn-ghost" disabled={busy} onClick={() => { setEdits({}); setErrs({}); }}>Discard</button>
      <button className="btn btn-primary" disabled={busy || !can('translation.update')} onClick={save}><Icon n="save" />{busy ? 'Saving…' : 'Save translations'}</button>
    </div>}
  </div>;
}
