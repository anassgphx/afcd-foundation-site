// AFCD Apply form builder. One column of cards, edited in place (the simple editor, always where it opens). The detailed
// view is not a mode to choose: it opens only from a question's "Logic" / "More settings" links, and "Back to the form"
// returns. Detailed view, left: pages, questions and rules (drag to reorder, or use the arrow buttons / Alt+↑↓).
// Centre: the live form on a desktop or phone canvas, with inline label editing; "Test" fills it in like an applicant,
// running the same engine the server runs. Right: the inspector. Top: undo/redo, problems, save and publish.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui.tsx';
import type { Answers, Field, FieldType, FormDef, Issue, Lang } from '../../server/modules/apply/engine.ts';
import { FIELD_TYPES, allFields, analyze, evaluate, t, validate } from '../../server/modules/apply/engine.ts';
import { FieldView, type Lng } from './FieldView.tsx';
import { FieldInspector, PageInspector, RuleInspector, SettingsInspector, findField, ruleSummary, slugId, type Sel } from './Inspector.tsx';
import { SimpleEditor, newField } from './SimpleForm.tsx';
import './builder.css';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const typing = (el: EventTarget | null) => { const e = el as HTMLElement | null; return !!e && (/INPUT|TEXTAREA|SELECT/.test(e.tagName) || e.isContentEditable); };

export type BuilderProps = {
  initial: FormDef; rev: number; locked: Set<string>;
  title: ReactNode; subtitle?: ReactNode; back: ReactNode;
  save: (def: FormDef, rev: number) => Promise<number>;            // returns the new rev
  onPublish?: (def: FormDef, rev: number, dirty: boolean) => void; publishLabel?: string;
  menu?: ReactNode; status?: ReactNode;
};

export function Builder({ initial, rev: rev0, locked, title, subtitle, back, save, onPublish, publishLabel, menu, status }: BuilderProps) {
  const [d, setD] = useState<FormDef>(() => clone(initial));
  const dRef = useRef(d); dRef.current = d;
  const [rev, setRev] = useState(rev0);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const hist = useRef<{ past: string[]; future: string[]; key?: string; at: number }>({ past: [], future: [], at: 0 });
  const [, bump] = useState(0);
  const [sel, setSel] = useState<Sel>({ kind: 'page', id: initial.pages[0]?.id ?? '' });
  const [pageId, setPageId] = useState(initial.pages[0]?.id ?? '');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [lang, setLang] = useState<Lng>('en');
  const [mode, setMode] = useState<'edit' | 'test'>('edit');
  const [view, setViewState] = useState<'simple' | 'advanced'>('simple');
  const setView = (v: 'simple' | 'advanced') => { setViewState(v); setMode('edit'); };
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const dirty = JSON.stringify(d) !== savedJson;

  /** Every edit: clone, apply, remember the previous state. Edits with the same key in quick succession (typing) are one step. */
  const change = useCallback((fn: (x: FormDef) => void, key?: string) => {
    const cur = dRef.current, next = clone(cur);
    fn(next);
    const h = hist.current, now = Date.now();
    if (!(key && h.key === key && now - h.at < 1000)) h.past = [...h.past.slice(-99), JSON.stringify(cur)];
    h.future = []; h.key = key; h.at = now;
    dRef.current = next; setD(next);
  }, []);
  const undo = useCallback(() => { const h = hist.current; const p = h.past.pop(); if (!p) return; h.future.push(JSON.stringify(dRef.current)); h.key = undefined; const n = JSON.parse(p); dRef.current = n; setD(n); bump((x) => x + 1); }, []);
  const redo = useCallback(() => { const h = hist.current; const f = h.future.pop(); if (!f) return; h.past.push(JSON.stringify(dRef.current)); h.key = undefined; const n = JSON.parse(f); dRef.current = n; setD(n); bump((x) => x + 1); }, []);

  const issues = useMemo(() => analyze(d), [d]);
  const errors = issues.filter((i) => i.level === 'error'), warnings = issues.filter((i) => i.level === 'warning');
  const page = d.pages.find((p) => p.id === pageId) ?? d.pages[0];
  useEffect(() => { if (sel?.kind === 'field') { const p = d.pages.find((x) => x.fields.some((f) => f.id === sel.id)); if (p && p.id !== pageId) setPageId(p.id); } else if (sel?.kind === 'page' && sel.id !== pageId && d.pages.some((p) => p.id === sel.id)) setPageId(sel.id); }, [sel]);
  useEffect(() => { if (!d.pages.some((p) => p.id === pageId) && d.pages[0]) setPageId(d.pages[0].id); }, [d, pageId]);

  async function doSave(): Promise<number | null> {
    setBusy(true); setErr([]);
    try { const r = await save(dRef.current, rev); setRev(r); setSavedJson(JSON.stringify(dRef.current)); return r; }
    catch (e) { const x = e as { message: string; details?: { path: string; message: string }[] }; setErr(x.details?.length ? x.details.map((y) => (y.path && y.path !== 'rev' ? `${y.path}: ` : '') + y.message) : [x.message]); return null; }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) void doSave(); return; }
      if (typing(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel?.kind === 'field') { e.preventDefault(); moveField(sel.id, e.key === 'ArrowUp' ? -1 : 1); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  // ---------------------------------------------------------------- structure edits
  const taken = () => new Set(allFields(dRef.current).map((f) => f.id));
  function addField(type: FieldType) {
    const f = newField(type, taken());
    change((x) => {
      const p = x.pages.find((y) => y.id === page.id) ?? x.pages[0];
      const at = sel?.kind === 'field' ? p.fields.findIndex((y) => y.id === sel.id) : -1;
      p.fields.splice(at >= 0 ? at + 1 : p.fields.length, 0, f);
    });
    setSel({ kind: 'field', id: f.id }); setMode('edit');
  }
  function addPage() {
    const id = slugId(`page_${d.pages.length + 1}`, new Set(d.pages.map((p) => p.id)), 'page');
    change((x) => { const i = x.pages.findIndex((p) => p.id === page?.id); x.pages.splice(i + 1, 0, { id, title: { en: `Page ${x.pages.length + 1}` }, fields: [] }); });
    setSel({ kind: 'page', id }); setPageId(id);
  }
  function moveField(id: string, dir: -1 | 1) {
    change((x) => {
      const pi = x.pages.findIndex((p) => p.fields.some((f) => f.id === id)); if (pi < 0) return;
      const fs = x.pages[pi].fields, i = fs.findIndex((f) => f.id === id), [f] = fs.splice(i, 1);
      if (i + dir < 0) { if (pi > 0) x.pages[pi - 1].fields.push(f); else fs.unshift(f); }
      else if (i + dir > fs.length) { if (pi < x.pages.length - 1) x.pages[pi + 1].fields.unshift(f); else fs.push(f); }
      else fs.splice(i + dir, 0, f);
    });
  }
  function movePage(id: string, dir: -1 | 1) {
    change((x) => { const i = x.pages.findIndex((p) => p.id === id), j = i + dir; if (j < 0 || j >= x.pages.length) return; [x.pages[i], x.pages[j]] = [x.pages[j], x.pages[i]]; });
  }
  // drag and drop (navigator): a question onto a question (before it) or onto a page (at its end); a page onto a page
  const drag = useRef<{ kind: 'field' | 'page'; id: string } | null>(null);
  const [over, setOver] = useState('');
  function drop(target: { kind: 'field' | 'page'; id: string }) {
    const src = drag.current; drag.current = null; setOver('');
    if (!src || (src.kind === target.kind && src.id === target.id)) return;
    change((x) => {
      if (src.kind === 'page') {
        const tp = target.kind === 'page' ? target.id : x.pages.find((p) => p.fields.some((f) => f.id === target.id))?.id;
        const i = x.pages.findIndex((p) => p.id === src.id); const [p] = x.pages.splice(i, 1);
        const j = x.pages.findIndex((q) => q.id === tp); x.pages.splice(j < 0 ? x.pages.length : j, 0, p); return;
      }
      const from = x.pages.find((p) => p.fields.some((f) => f.id === src.id))!; const [f] = from.fields.splice(from.fields.findIndex((y) => y.id === src.id), 1);
      if (target.kind === 'page') x.pages.find((p) => p.id === target.id)!.fields.push(f);
      else { const to = x.pages.find((p) => p.fields.some((y) => y.id === target.id))!; to.fields.splice(to.fields.findIndex((y) => y.id === target.id), 0, f); }
    });
  }
  const dnd = (item: { kind: 'field' | 'page'; id: string }) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { drag.current = item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); },
    onDragOver: (e: React.DragEvent) => { if (!drag.current || (drag.current.kind === 'page' && item.kind === 'field')) return; e.preventDefault(); setOver(`${item.kind}:${item.id}`); },
    onDragLeave: () => setOver((o) => (o === `${item.kind}:${item.id}` ? '' : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(item); },
    onDragEnd: () => { drag.current = null; setOver(''); },
  });
  const deleteSel = () => {
    if (!sel || sel.kind === 'settings') return;
    if (sel.kind === 'field') change((x) => { for (const p of x.pages) p.fields = p.fields.filter((f) => f.id !== sel.id); });
    if (sel.kind === 'page') change((x) => { x.pages = x.pages.filter((p) => p.id !== sel.id); });
    if (sel.kind === 'rule') change((x) => { x.rules = x.rules.filter((r) => r.id !== sel.id); });
    setSel({ kind: 'page', id: page?.id ?? d.pages[0]?.id });
  };
  const issuesFor = (kind: string, id: string) => issues.filter((i) => i.ref?.kind === kind && i.ref.id === id);
  const shownByRule = useMemo(() => new Set(d.rules.flatMap((r) => r.then.filter((a) => a.type === 'show').map((a) => (a as { target: { id: string } }).target.id))), [d]);
  const hiddenByRule = useMemo(() => new Set(d.rules.flatMap((r) => r.then.filter((a) => a.type === 'hide').map((a) => (a as { target: { id: string } }).target.id))), [d]);
  const pick = (i: Issue) => { if (i.ref) setSel(i.ref.kind === 'page' ? { kind: 'page', id: i.ref.id } : i.ref.kind === 'field' ? { kind: 'field', id: i.ref.id } : { kind: 'rule', id: i.ref.id }); setShowIssues(false); setMode('edit'); };

  const types = Object.entries(FIELD_TYPES) as [FieldType, (typeof FIELD_TYPES)[FieldType]][];
  const groups = [...new Set(types.map(([, v]) => v.group))];
  const selField = sel?.kind === 'field' ? findField(d, sel.id) : null;
  const selPage = sel?.kind === 'page' ? d.pages.find((p) => p.id === sel.id) : null;
  const selRule = sel?.kind === 'rule' ? d.rules.find((r) => r.id === sel.id) : null;

  return <div className="fb">
    <header className="fb-top">
      <div className="fb-title">{back}<div className="min-w-0"><div className="fb-h1"><h1>{title}</h1>{status}</div>{subtitle && <small>{subtitle}</small>}</div></div>
      <div className="fb-tools">
        {view === 'advanced' && <button type="button" className="btn btn-sm" onClick={() => setView('simple')}><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />Back to the form</button>}
        <span className="fb-undo"><button type="button" className="btn btn-ghost icon-btn" onClick={undo} disabled={!hist.current.past.length} title="Undo (⌘Z)" aria-label="Undo"><Icon n="undo" /></button>
        <button type="button" className="btn btn-ghost icon-btn" onClick={redo} disabled={!hist.current.future.length} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon n="undo" style={{ transform: 'scaleX(-1)' }} /></button></span>
        {issues.length === 0 ? <span className="fb-ok" title="The form passes every check"><Icon n="check" width={14} height={14} />No problems</span> : <div className="fb-issues-wrap">
          <button type="button" className={`btn btn-sm fb-issues${errors.length ? ' bad' : warnings.length ? ' warn' : ' ok'}`} onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues}>
            {errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'}` : 'No problems'}{warnings.length ? ` · ${warnings.length} note${warnings.length === 1 ? '' : 's'}` : ''}</button>
          {showIssues && <div className="fb-pop" role="dialog" aria-label="Form check">
            {[...errors, ...warnings].map((i, n) => <button type="button" key={n} className={`fb-issue ${i.level}`} onClick={() => pick(i)}><b>{i.level === 'error' ? 'Must fix' : 'Check'}</b><span>{i.message}</span></button>)}
          </div>}
        </div>}
        {view === 'simple' && <button type="button" className={`btn btn-sm${mode === 'test' ? ' btn-primary' : ''}`} onClick={() => setMode(mode === 'test' ? 'edit' : 'test')} aria-pressed={mode === 'test'}><Icon n="eye" />{mode === 'test' ? 'Back to editing' : 'Preview'}</button>}
        {menu}
        {dirty || busy ? <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void doSave()} title="Save (⌘S)">{busy ? 'Saving…' : 'Save'}</button>
          : <span className="fb-saved" role="status"><Icon n="check" width={13} height={13} />Saved</span>}
        {onPublish && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={async () => { let r: number | null = rev; if (dirty) r = await doSave(); if (r !== null) onPublish(dRef.current, r, false); }}><Icon n="rocket" />{publishLabel ?? 'Publish'}</button>}
      </div>
    </header>
    {err.length > 0 && <div className="notice n-warn fb-err" role="alert"><div><ul style={{ margin: 0 }}>{err.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErr([])} aria-label="Dismiss"><Icon n="x" /></button></div>}

    {view === 'simple' ? (mode === 'test'
      ? <div className="sf-preview-wrap"><div className="fb-sheet"><TestRun key={JSON.stringify(d)} d={d} lang={lang} /></div></div>
      : <SimpleEditor d={d} change={change} locked={locked} sel={sel} setSel={setSel} issues={issues} ruled={new Set([...shownByRule, ...hiddenByRule])}
          onAdvanced={(s) => { setSel(s); setMode('edit'); setView('advanced'); }} />) :
    <div className="fb-body">
      <nav className="fb-nav" aria-label="Pages, questions and rules">
        <div className="fb-nav-h"><b>Pages</b><button type="button" className="btn btn-ghost btn-sm" onClick={addPage}><Icon n="plus" />Page</button></div>
        <ol className="fb-pages">{d.pages.map((p, pi) => <li key={p.id}>
          <div {...dnd({ kind: 'page', id: p.id })} className={`fb-page-row${sel?.kind === 'page' && sel.id === p.id ? ' on' : ''}${over === `page:${p.id}` ? ' over' : ''}${issuesFor('page', p.id).some((i) => i.level === 'error') ? ' has-err' : ''}`}>
            <span className="fb-grip" aria-hidden="true">⋮⋮</span>
            <button type="button" className="fb-name" onClick={() => setSel({ kind: 'page', id: p.id })}><span className="fb-num">{pi + 1}</span>{t(p.title) || p.id}{hiddenByRule.has(p.id) || shownByRule.has(p.id) ? <em title="Shown or hidden by a rule"> ·rule</em> : null}</button>
            <span className="fb-row-btns"><button type="button" className="btn btn-ghost icon-btn btn-xs" aria-label={`Move page ${pi + 1} up`} disabled={pi === 0} onClick={() => movePage(p.id, -1)}>↑</button><button type="button" className="btn btn-ghost icon-btn btn-xs" aria-label={`Move page ${pi + 1} down`} disabled={pi === d.pages.length - 1} onClick={() => movePage(p.id, 1)}>↓</button></span>
          </div>
          <ul className="fb-fields">{p.fields.map((f) => <li key={f.id} {...dnd({ kind: 'field', id: f.id })} className={`${sel?.kind === 'field' && sel.id === f.id ? 'on' : ''}${over === `field:${f.id}` ? ' over' : ''}${issuesFor('field', f.id).some((i) => i.level === 'error') ? ' has-err' : ''}`}>
            <span className="fb-grip" aria-hidden="true">⋮⋮</span>
            <button type="button" className="fb-name" onClick={() => setSel({ kind: 'field', id: f.id })}><span className="fb-type">{FIELD_TYPES[f.type]?.label}</span>{t(f.label) || (f.type === 'statement' ? 'Text block' : f.id)}{f.required ? ' *' : ''}</button>
            {sel?.kind === 'field' && sel.id === f.id && <span className="fb-row-btns"><button type="button" className="btn btn-ghost icon-btn btn-xs" aria-label="Move question up (Alt+↑)" onClick={() => moveField(f.id, -1)}>↑</button><button type="button" className="btn btn-ghost icon-btn btn-xs" aria-label="Move question down (Alt+↓)" onClick={() => moveField(f.id, 1)}>↓</button></span>}
          </li>)}{!p.fields.length && <li className="fb-empty" {...dnd({ kind: 'page', id: p.id })}>Drop questions here</li>}</ul>
        </li>)}</ol>
        <details className="fb-add" open><summary>Add a question</summary>
          {groups.map((g) => <div key={g} className="fb-add-g"><small>{g}</small><div>{types.filter(([, v]) => v.group === g).map(([k, v]) => <button key={k} type="button" className="btn btn-sm" onClick={() => addField(k)}>{v.label}</button>)}</div></div>)}
        </details>
        <div className="fb-nav-h"><b>Rules</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => { const id = slugId(`rule_${d.rules.length + 1}`, new Set(d.rules.map((r) => r.id)), 'rule'); change((x) => { x.rules.push({ id, when: { all: [] }, then: [] }); }); setSel({ kind: 'rule', id }); }}><Icon n="plus" />Rule</button></div>
        <ul className="fb-rules">{d.rules.map((r) => <li key={r.id} className={`${sel?.kind === 'rule' && sel.id === r.id ? 'on' : ''}${issuesFor('rule', r.id).some((i) => i.level === 'error') ? ' has-err' : ''}`}>
          <button type="button" className="fb-name" onClick={() => setSel({ kind: 'rule', id: r.id })}><b>{r.name || r.id}</b><small>{ruleSummary(d, r)}</small></button></li>)}
          {!d.rules.length && <li className="fb-empty">No rules: every question is shown, pages follow in order.</li>}</ul>
        <button type="button" className={`fb-settings${sel?.kind === 'settings' ? ' on' : ''}`} onClick={() => setSel({ kind: 'settings' })}><Icon n="settings" width={16} height={16} />Form settings</button>
      </nav>

      <main className="fb-canvas-wrap">
        <div className="fb-canvas-bar">
          <div className="seg" role="group" aria-label="Mode"><button type="button" className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit</button><button type="button" className={mode === 'test' ? 'on' : ''} onClick={() => setMode('test')}>Test</button></div>
          <div className="seg" role="group" aria-label="Device"><button type="button" className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')} aria-label="Desktop"><Icon n="monitor" width={15} height={15} /></button><button type="button" className={device === 'mobile' ? 'on' : ''} onClick={() => setDevice('mobile')} aria-label="Phone">▯</button></div>
          {d.settings.languages.length > 1 && <div className="seg" role="group" aria-label="Language">{d.settings.languages.map((l) => <button key={l} type="button" className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}</div>}
        </div>
        <div className={`fb-canvas ${device}`}>
          <div className="fb-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
            {mode === 'edit' ? <EditCanvas d={d} page={page} lang={lang} sel={sel} setSel={setSel} setPageId={setPageId} change={change} shown={shownByRule} hidden={hiddenByRule} />
              : <TestRun key={JSON.stringify(d)} d={d} lang={lang} />}
          </div>
        </div>
      </main>

      <aside className="fb-insp" aria-label="Inspector">
        {selField ? <FieldInspector key={selField.id} d={d} f={selField} change={change} locked={locked} onSelect={setSel} onDelete={deleteSel} />
          : selRule ? <RuleInspector key={selRule.id} d={d} r={selRule} change={change} onDelete={deleteSel} />
          : selPage ? <PageInspector key={selPage.id} d={d} p={selPage} change={change} onDelete={deleteSel} onSelect={setSel} />
          : sel?.kind === 'settings' ? <SettingsInspector d={d} change={change} />
          : <p className="muted in-b">Select a page, question or rule.</p>}
        {sel && sel.kind !== 'settings' && issuesFor(sel.kind, sel.id).length > 0 && <div className="in-b"><span className="in-lang-h">Checks</span>
          {issuesFor(sel.kind, sel.id).map((i, n) => <p key={n} className={`fb-issue-inline ${i.level}`}>{i.message}</p>)}</div>}
      </aside>
    </div>}
  </div>;
}

function EditCanvas({ d, page, lang, sel, setSel, setPageId, change, shown, hidden }: { d: FormDef; page: FormDef['pages'][number] | undefined; lang: Lng; sel: Sel; setSel: (s: Sel) => void; setPageId: (id: string) => void;
  change: (fn: (x: FormDef) => void, key?: string) => void; shown: Set<string>; hidden: Set<string> }) {
  if (!page) return <p className="muted">Add a page to start.</p>;
  const i = d.pages.indexOf(page);
  return <>
    <ol className="fb-steps" aria-label="Pages">{d.pages.map((p, j) => <li key={p.id} className={j === i ? 'on' : j < i ? 'done' : ''}><button type="button" onClick={() => { setPageId(p.id); setSel({ kind: 'page', id: p.id }); }} title={t(p.title, lang)}>{j + 1}</button></li>)}</ol>
    <h2 className="fb-page-title" onClick={() => setSel({ kind: 'page', id: page.id })}>{t(page.title, lang) || <i className="fv-empty">Untitled page</i>}</h2>
    {page.description && <p className="fb-page-desc">{t(page.description, lang)}</p>}
    <div className="fb-grid">{page.fields.map((f) => <div key={f.id} className={`fb-q${(f.appearance?.width ?? 'full') === 'half' ? ' half' : ''}`} onClick={() => setSel({ kind: 'field', id: f.id })} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setSel({ kind: 'field', id: f.id }); }} aria-label={`Edit ${t(f.label) || f.id}`}>
      {(shown.has(f.id) || hidden.has(f.id)) && <span className="fb-flag">{shown.has(f.id) ? 'Shown by a rule' : 'Can be hidden by a rule'}</span>}
      <FieldView f={f} value={undefined} lang={lang} required={!!f.required} selected={sel?.kind === 'field' && sel.id === f.id}
        onLabel={f.type === 'statement' ? undefined : (v) => change((x) => { const g = findField(x, f.id); if (g) g.label = { ...g.label, [lang]: v }; }, `${f.id}:label`)} />
    </div>)}
      {!page.fields.length && <p className="fb-blank">This page is empty. Add a question from the left.</p>}</div>
    <div className="fb-foot"><button type="button" className="btn" disabled>Back</button><span style={{ flex: 1 }} /><button type="button" className="btn btn-primary" disabled>{i === d.pages.length - 1 ? (d.settings.reviewStep ? 'Review' : t(d.settings.submitLabel, lang) || 'Submit') : 'Next'}</button></div>
  </>;
}

/** Fill the form in like an applicant. Same engine as the server; nothing is sent anywhere. */
function TestRun({ d, lang }: { d: FormDef; lang: Lng }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState<string | 'review' | 'done'>(() => evaluate(d, {}).path[0] ?? 'review');
  const [errs, setErrs] = useState<Record<string, Lang>>({});
  const ev = evaluate(d, answers);
  const page = d.pages.find((p) => p.id === step);
  const idx = page ? ev.path.indexOf(page.id) : ev.path.length;
  const set = (id: string, v: unknown) => { setAnswers((a) => ({ ...a, [id]: v as never })); setErrs((e) => { const n = { ...e }; delete n[id]; return n; }); };
  const next = () => {
    if (!page) return;
    const v = validate(d, answers, [page.id]);
    if (!v.ok) { setErrs(Object.fromEntries(v.errors.map((e) => [e.field, e.message]))); return; }
    setErrs({}); const n = ev.next(page.id); setStep(n ?? (d.settings.reviewStep ? 'review' : 'done'));
  };
  const back = () => { const i = ev.path.indexOf(page ? page.id : ''); const prev = step === 'review' || step === 'done' ? ev.path[ev.path.length - 1] : ev.path[i - 1]; if (prev) setStep(prev); };
  if (step === 'done') return <div className="fb-done"><b>Test only: nothing was sent.</b><p>{t(d.settings.confirmation, lang)}</p><p className="muted">On the public form this message appears only after the server has saved the application.</p>
    <dl className="kv"><dt>Eligibility</dt><dd>{ev.eligibility.result.replace('_', ' ')}{ev.eligibility.reasons.length ? `: ${ev.eligibility.reasons.map((r) => t(r)).join('; ')}` : ''}</dd></dl>
    <button type="button" className="btn" onClick={() => { setAnswers({}); setStep(ev.path[0]); }}>Start again</button></div>;
  if (step === 'review') {
    const all = validate(d, answers);
    return <div><h2 className="fb-page-title">Review your answers</h2>
      {ev.path.map((pid) => { const p = d.pages.find((x) => x.id === pid)!; return <section key={pid} className="fb-review"><h3>{t(p.title, lang)}</h3><dl>{p.fields.filter((f) => ev.visibleFields.has(f.id) && FIELD_TYPES[f.type].input).map((f) => <div key={f.id}><dt>{t(f.label, lang)}</dt><dd>{show(ev.values[f.id], f, lang)}</dd></div>)}</dl></section>; })}
      {!all.ok && <div className="notice n-warn"><div>{all.errors.length} answer{all.errors.length === 1 ? '' : 's'} still need attention.</div></div>}
      <div className="fb-foot"><button type="button" className="btn" onClick={back}>Back</button><span style={{ flex: 1 }} /><button type="button" className="btn btn-primary" disabled={!all.ok} onClick={() => setStep('done')}>{t(d.settings.submitLabel, lang) || 'Submit'} (test)</button></div></div>;
  }
  if (!page) return <p className="muted">No page to show: check the rules.</p>;
  const msgs = ev.messages.filter((m) => !m.page || m.page === page.id);
  return <>
    <div className="fb-progress" role="progressbar" aria-valuemin={1} aria-valuemax={ev.path.length} aria-valuenow={idx + 1}><span style={{ width: `${((idx + 1) / Math.max(1, ev.path.length)) * 100}%` }} /></div>
    <small className="muted">Step {idx + 1} of {ev.path.length}</small>
    <h2 className="fb-page-title">{t(page.title, lang)}</h2>
    {page.description && <p className="fb-page-desc">{t(page.description, lang)}</p>}
    {msgs.map((m, i) => <div key={i} className={`notice ${m.tone === 'warning' ? 'n-warn' : 'n-info'}`}><div>{t(m.text, lang)}</div></div>)}
    <div className="fb-grid">{page.fields.filter((f) => ev.visibleFields.has(f.id)).map((f) => <div key={f.id} className={`fb-q${(f.appearance?.width ?? 'full') === 'half' ? ' half' : ''}`}>
      <FieldView f={f} value={answers[f.id]} set={f.type === 'calculated' || f.type === 'statement' ? undefined : (v) => set(f.id, v)} lang={lang} required={ev.required.has(f.id)} error={errs[f.id] ?? null}
        value2={f.type === 'calculated' ? (ev.values[f.id] as number | undefined) ?? null : undefined} /></div>)}</div>
    <div className="fb-foot"><button type="button" className="btn" disabled={idx === 0} onClick={back}>Back</button><span style={{ flex: 1 }} /><button type="button" className="btn btn-primary" onClick={next}>{ev.next(page.id) ? 'Next' : d.settings.reviewStep ? 'Review' : t(d.settings.submitLabel, lang) || 'Submit'}</button></div>
  </>;
}
const show = (v: unknown, f: Field, lang: Lng) => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? (lang === 'fr' ? 'Oui' : lang === 'ar' ? 'نعم' : 'Yes') : (lang === 'fr' ? 'Non' : lang === 'ar' ? 'لا' : 'No');
  const opt = (x: string) => t(f.config?.options?.find((o) => o.value === x)?.label, lang) || x;
  if (Array.isArray(v)) return v.map((x) => typeof x === 'string' ? opt(x) : (x as { name: string }).name).join(', ');
  return typeof v === 'string' && f.config?.options ? opt(v) : String(v);
};
