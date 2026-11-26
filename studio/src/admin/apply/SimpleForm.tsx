// AFCD Apply form builder, simple view: the form as one column of cards, like a familiar online form editor.
// Click a card to edit it in place: the question, its type (a menu with icons), its options, "Required".
// Sections are the form's pages. Rules, translations and validation limits stay in the advanced view,
// one click away from each card. Every edit goes through `change`, so undo/redo and saving work as before.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui.tsx';
import type { Field, FieldType, FormDef, Issue } from '../../server/modules/apply/engine.ts';
import { FILE_TYPES, allFields } from '../../server/modules/apply/engine.ts';
import { FieldView } from './FieldView.tsx';
import { findField, slugId, type Sel } from './Inspector.tsx';
import './simpleform.css';

type Change = (fn: (d: FormDef) => void, key?: string) => void;
const UNTITLED = 'Untitled question';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function newField(type: FieldType, taken: Set<string>): Field {
  const label: Record<FieldType, string> = { short_text: 'Question', long_text: 'Question', email: 'Email', phone: 'Phone', url: 'Web address', number: 'Number', date: 'Date',
    single_choice: 'Question', multi_choice: 'Question', yes_no: 'Yes or no?', consent: 'I agree to…', file: 'Upload a file', statement: '', calculated: 'Total' };
  const id = slugId(type === 'statement' ? 'text_block' : label[type], taken, 'q');
  const f: Field = { id, type, label: { en: label[type] } };
  if (type === 'single_choice' || type === 'multi_choice') f.config = { options: [{ value: 'option_1', label: { en: 'Option 1' } }] };
  if (type === 'file') f.config = { accept: ['pdf'], maxMb: 5, maxFiles: 1 };
  if (type === 'statement') f.config = { text: { en: '' } };
  if (type === 'calculated') f.config = { expr: { op: 'sum', args: [0] }, decimals: 2 };
  if (type === 'consent') { f.required = true; f.config = { text: { en: '' } }; }
  return f;
}

// ---------------------------------------------------------------- question types, as people name them
type Kind = 'short_text' | 'long_text' | 'radio' | 'multi_choice' | 'dropdown' | 'file' | 'date' | 'number' | 'email' | 'phone' | 'url' | 'yes_no' | 'consent';
const P: Record<string, ReactNode> = {
  short_text: <path d="M4 10h16M4 15h9" />,
  long_text: <path d="M4 6h16M4 10h16M4 14h16M4 18h10" />,
  radio: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" fill="currentColor" /></>,
  multi_choice: <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="m8 12 3 3 5-6" /></>,
  dropdown: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 10.5 3.5 3.5 3.5-3.5" /></>,
  file: <><path d="M4 16.5A4.5 4.5 0 0 1 7.5 8a6 6 0 0 1 11.4 1.8A3.5 3.5 0 0 1 18 16.5" /><path d="M12 12v8M9 15l3-3 3 3" /></>,
  date: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><rect x="13" y="13.5" width="3" height="3" fill="currentColor" stroke="none" /></>,
  number: <path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" />,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  phone: <path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L7 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />,
  url: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  yes_no: <><rect x="2.5" y="7" width="19" height="10" rx="5" /><circle cx="16.5" cy="12" r="3" fill="currentColor" /></>,
  consent: <><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  statement: <path d="M4 7V5h11v2M9.5 5v14M13 12v-1.5h7V12M16.5 10.5V19" />,
  section: <><rect x="3.5" y="4" width="17" height="6" rx="1.5" /><rect x="3.5" y="14" width="17" height="6" rx="1.5" /></>,
  add: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /><path d="M10 11v6M14 11v6" /></>,
  more: <><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" /></>,
  grip: <><circle cx="8" cy="9" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="9" r="1.3" fill="currentColor" stroke="none" /><circle cx="16" cy="9" r="1.3" fill="currentColor" stroke="none" /><circle cx="8" cy="15" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" /><circle cx="16" cy="15" r="1.3" fill="currentColor" stroke="none" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};
const G = ({ n, size = 20 }: { n: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[n]}</svg>;

const KINDS: { k: Kind; label: string }[][] = [
  [{ k: 'short_text', label: 'Short answer' }, { k: 'long_text', label: 'Paragraph' }],
  [{ k: 'radio', label: 'Multiple choice' }, { k: 'multi_choice', label: 'Checkboxes' }, { k: 'dropdown', label: 'Drop-down' }],
  [{ k: 'file', label: 'File upload' }],
  [{ k: 'date', label: 'Date' }, { k: 'number', label: 'Number' }],
  [{ k: 'email', label: 'Email' }, { k: 'phone', label: 'Phone' }, { k: 'url', label: 'Web address' }],
  [{ k: 'yes_no', label: 'Yes / No' }, { k: 'consent', label: 'Agreement (tick to accept)' }],
];
const ALL_KINDS = KINDS.flat();
const kindOfField = (f: Field): Kind | null => f.type === 'single_choice' ? (f.appearance?.display === 'dropdown' ? 'dropdown' : 'radio')
  : f.type === 'statement' || f.type === 'calculated' ? null : f.type as Kind;
const isChoice = (k: Kind | null) => k === 'radio' || k === 'multi_choice' || k === 'dropdown';

/** Switches a question to another type, keeping what still makes sense (label, help, required, options between choice types). */
function setKind(f: Field, k: Kind) {
  const was = kindOfField(f);
  const options = f.config?.options;
  const type: FieldType = k === 'radio' || k === 'dropdown' ? 'single_choice' : k;
  f.type = type;
  const app = { ...(f.appearance ?? {}) }; delete app.display;
  if (k === 'dropdown') app.display = 'dropdown';
  f.appearance = Object.keys(app).length ? app : undefined;
  if (isChoice(k)) f.config = { options: isChoice(was) && options?.length ? options : [{ value: 'option_1', label: { en: 'Option 1' } }] };
  else if (k === 'file') f.config = { accept: ['pdf'], maxMb: 5, maxFiles: 1 };
  else if (k === 'consent') { f.config = { text: { en: '' } }; f.required = true; }
  else f.config = undefined;
  if (!f.appearance) delete f.appearance;
  if (!f.config) delete f.config;
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const m = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', m); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', m); document.removeEventListener('keydown', k); };
  }, [open]);
  return ref;
}

function TypeMenu({ value, disabled, onPick }: { value: Kind; disabled?: boolean; onPick: (k: Kind) => void }) {
  const [open, setOpen] = useState(false); const ref = useOutside(open, () => setOpen(false));
  const cur = ALL_KINDS.find((x) => x.k === value)!;
  return <div className="sf-type" ref={ref}>
    <button type="button" className="sf-type-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
      title={disabled ? 'This question is in a published version, so its type is fixed.' : undefined}><G n={value} /><span>{cur.label}</span><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(90deg)' }} /></button>
    {open && <div className="sf-type-pop" role="listbox" aria-label="Question type">{KINDS.map((g, i) => <div key={i} className="sf-type-g">{g.map((x) =>
      <button key={x.k} type="button" role="option" aria-selected={x.k === value} className={x.k === value ? 'on' : ''} onClick={() => { setOpen(false); if (x.k !== value) onPick(x.k); }}><G n={x.k} /><span>{x.label}</span></button>)}</div>)}</div>}
  </div>;
}

function Menu({ items, label }: { items: ({ label: string; run: () => void; on?: boolean; disabled?: boolean } | false)[]; label: string }) {
  const [open, setOpen] = useState(false); const ref = useOutside(open, () => setOpen(false));
  return <div className="sf-menu" ref={ref}>
    <button type="button" className="sf-icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><G n="more" /></button>
    {open && <div className="sf-menu-pop" role="menu">{items.filter(Boolean).map((x) => { const it = x as { label: string; run: () => void; on?: boolean; disabled?: boolean };
      return <button key={it.label} type="button" role="menuitemcheckbox" aria-checked={it.on ?? undefined} disabled={it.disabled} onClick={() => { setOpen(false); it.run(); }}>
        <span className="sf-tick">{it.on ? '✓' : ''}</span>{it.label}</button>; })}</div>}
  </div>;
}

// ---------------------------------------------------------------- the editor
export function SimpleEditor({ d, change, locked, sel, setSel, issues, ruled, onAdvanced }: {
  d: FormDef; change: Change; locked: Set<string>; sel: Sel; setSel: (s: Sel) => void; issues: Issue[]; ruled: Set<string>;
  onAdvanced: (s: Sel) => void;
}) {
  const selId = sel?.kind === 'field' ? sel.id : null;
  const selPage = sel?.kind === 'page' ? sel.id : null;
  const [showHelp, setShowHelp] = useState<Set<string>>(new Set());
  const [focusOpt, setFocusOpt] = useState<string | null>(null);
  const taken = () => new Set(allFields(d).map((f) => f.id));
  const pageOf = (id: string) => d.pages.find((p) => p.fields.some((f) => f.id === id));

  // new items go after the selected question, or at the end of the selected (or last) section
  function insert(f: Field) {
    change((x) => {
      const p = (selId && x.pages.find((pg) => pg.fields.some((y) => y.id === selId))) || (selPage && x.pages.find((pg) => pg.id === selPage)) || x.pages[x.pages.length - 1];
      const at = selId ? p.fields.findIndex((y) => y.id === selId) + 1 : p.fields.length;
      p.fields.splice(at, 0, f);
    });
    setSel({ kind: 'field', id: f.id });
  }
  const addQuestion = () => { const f = newField('single_choice', taken()); f.label = { en: UNTITLED }; f.id = slugId('question', taken(), 'q'); insert(f); };
  const addText = () => { const f = newField('statement', taken()); f.label = { en: 'Title' }; insert(f); };
  /** A new section after the selected question: the questions below it move into the new section. */
  function addSection() {
    const id = slugId(`section_${d.pages.length + 1}`, new Set(d.pages.map((p) => p.id)), 'page');
    change((x) => {
      const pi = selId ? x.pages.findIndex((p) => p.fields.some((f) => f.id === selId)) : selPage ? x.pages.findIndex((p) => p.id === selPage) : x.pages.length - 1;
      const p = x.pages[pi];
      const cut = selId ? p.fields.findIndex((f) => f.id === selId) + 1 : p.fields.length;
      x.pages.splice(pi + 1, 0, { id, title: { en: 'Untitled section' }, fields: p.fields.splice(cut) });
    });
    setSel({ kind: 'page', id });
  }
  const dup = (f: Field) => {
    const c = clone(f); c.id = slugId(f.label.en || f.id, taken(), 'q');
    change((x) => { const p = x.pages.find((pg) => pg.fields.some((y) => y.id === f.id))!; p.fields.splice(p.fields.findIndex((y) => y.id === f.id) + 1, 0, c); });
    setSel({ kind: 'field', id: c.id });
  };
  const remove = (f: Field) => {
    const p = pageOf(f.id)!; const i = p.fields.findIndex((y) => y.id === f.id);
    change((x) => { for (const pg of x.pages) pg.fields = pg.fields.filter((y) => y.id !== f.id); });
    const next = p.fields[i + 1] ?? p.fields[i - 1];
    setSel(next ? { kind: 'field', id: next.id } : { kind: 'page', id: p.id });
  };
  const edit = (id: string, fn: (f: Field) => void, key?: string) => change((x) => { const f = findField(x, id); if (f) fn(f); }, key);

  // drag a card by its handle; drop it before another card, or onto a section header (to the start of that section)
  const drag = useRef<string | null>(null); const [over, setOver] = useState('');
  function dropOn(target: { field?: string; page?: string }) {
    const src = drag.current; drag.current = null; setOver('');
    if (!src || src === target.field) return;
    change((x) => {
      const from = x.pages.find((p) => p.fields.some((f) => f.id === src))!; const [f] = from.fields.splice(from.fields.findIndex((y) => y.id === src), 1);
      if (target.page) { x.pages.find((p) => p.id === target.page)!.fields.unshift(f); return; }
      const to = x.pages.find((p) => p.fields.some((y) => y.id === target.field))!; to.fields.splice(to.fields.findIndex((y) => y.id === target.field), 0, f);
    });
  }
  const dropProps = (key: string, target: { field?: string; page?: string }) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag.current) return; e.preventDefault(); setOver(key); },
    onDragLeave: () => setOver((o) => (o === key ? '' : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropOn(target); },
  });
  const move = (id: string, dir: -1 | 1) => change((x) => {
    const pi = x.pages.findIndex((p) => p.fields.some((f) => f.id === id)); const fs = x.pages[pi].fields; const i = fs.findIndex((f) => f.id === id);
    const [f] = fs.splice(i, 1);
    if (i + dir < 0) { if (pi > 0) x.pages[pi - 1].fields.push(f); else fs.unshift(f); }
    else if (i + dir > fs.length) { if (pi < x.pages.length - 1) x.pages[pi + 1].fields.unshift(f); else fs.push(f); }
    else fs.splice(i + dir, 0, f);
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (selId && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(selId, e.key === 'ArrowUp' ? -1 : 1); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const problems = (kind: 'field' | 'page', id: string) => issues.filter((i) => i.ref?.kind === kind && i.ref.id === id);

  return <div className="sf" onMouseDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
    <div className="sf-col">
      {d.pages.map((p, pi) => <section key={p.id} className="sf-section" aria-label={`Section ${pi + 1}`}>
        {d.pages.length > 1 && <div className="sf-tab">Section {pi + 1} of {d.pages.length}</div>}
        <div className={`sf-card sf-head${selPage === p.id ? ' on' : ''}${pi === 0 ? ' first' : ''}${over === `page:${p.id}` ? ' over' : ''}`} onMouseDown={() => setSel({ kind: 'page', id: p.id })} {...dropProps(`page:${p.id}`, { page: p.id })}>
          <input className="sf-h-title" value={p.title.en ?? ''} placeholder={pi === 0 ? 'Form title' : 'Untitled section'} aria-label={`Section ${pi + 1} title`}
            onChange={(e) => change((x) => { x.pages[pi].title = { ...x.pages[pi].title, en: e.target.value }; }, `${p.id}:title`)} />
          <textarea className="sf-h-desc" rows={1} value={p.description?.en ?? ''} placeholder={pi === 0 ? 'Form description' : 'Description (optional)'} aria-label={`Section ${pi + 1} description`}
            onChange={(e) => change((x) => { const v = e.target.value; if (v) x.pages[pi].description = { ...(x.pages[pi].description ?? { en: '' }), en: v }; else delete x.pages[pi].description; }, `${p.id}:desc`)}
            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
          {problems('page', p.id).map((i, n) => <p key={n} className={`sf-issue ${i.level}`}>{i.message}</p>)}
          {d.pages.length > 1 && <div className="sf-head-tools"><Menu label="Section options" items={[
            pi > 0 && { label: 'Move section up', run: () => change((x) => { [x.pages[pi - 1], x.pages[pi]] = [x.pages[pi], x.pages[pi - 1]]; }) },
            pi < d.pages.length - 1 && { label: 'Move section down', run: () => change((x) => { [x.pages[pi + 1], x.pages[pi]] = [x.pages[pi], x.pages[pi + 1]]; }) },
            { label: pi > 0 ? 'Delete section (its questions join the one above)' : 'Delete section (its questions join the next one)', run: () => change((x) => { const [q] = x.pages.splice(pi, 1); const into = x.pages[Math.max(0, pi - 1)]; if (pi > 0) into.fields.push(...q.fields); else into.fields.unshift(...q.fields); }) },
            { label: 'Show or skip this section with a rule…', run: () => onAdvanced({ kind: 'page', id: p.id }) },
          ]} /></div>}
        </div>

        {p.fields.map((f) => {
          const on = f.id === selId, k = kindOfField(f), isLocked = locked.has(f.id);
          const helpOpen = showHelp.has(f.id) || !!f.help?.en;
          const probs = problems('field', f.id);
          return <div key={f.id} className={`sf-card sf-q${on ? ' on' : ''}${over === `field:${f.id}` ? ' over' : ''}${probs.some((i) => i.level === 'error') ? ' bad' : ''}`}
            onMouseDown={() => { if (!on) setSel({ kind: 'field', id: f.id }); }} {...dropProps(`field:${f.id}`, { field: f.id })}>
            <div className="sf-grip" draggable aria-hidden="true" onDragStart={(e) => { drag.current = f.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.id); }} onDragEnd={() => { drag.current = null; setOver(''); }} title="Drag to move (or Alt+↑/↓)"><G n="grip" size={18} /></div>
            {!on ? <div className="sf-preview">
              {ruled.has(f.id) && <span className="sf-chip">Logic</span>}
              {f.type === 'statement' ? <div className="sf-stmt"><b>{f.label.en || 'Title'}</b>{f.config?.text?.en && <p>{f.config.text.en}</p>}</div>
                : <FieldView f={f} value={undefined} lang="en" required={!!f.required} />}
              {probs.map((i, n) => <p key={n} className={`sf-issue ${i.level}`}>{i.message}</p>)}
            </div> : <div className="sf-edit">
              {f.type === 'statement' ? <>
                <input className="sf-q-input" autoFocus value={f.label.en ?? ''} placeholder="Title" aria-label="Title" onChange={(e) => edit(f.id, (g) => { g.label = { ...g.label, en: e.target.value }; }, `${f.id}:label`)} />
                <textarea className="sf-help" rows={2} value={f.config?.text?.en ?? ''} placeholder="Description (optional)" aria-label="Description"
                  onChange={(e) => edit(f.id, (g) => { g.config = { ...(g.config ?? {}), text: { ...(g.config?.text ?? { en: '' }), en: e.target.value } }; }, `${f.id}:text`)} />
              </> : <>
                <div className="sf-q-row">
                  <input className="sf-q-input" autoFocus={!f.label.en || f.label.en === UNTITLED} onFocus={(e) => { if (e.target.value === UNTITLED) e.target.select(); }} value={f.label.en ?? ''} placeholder="Question" aria-label="Question"
                    onChange={(e) => edit(f.id, (g) => { g.label = { ...g.label, en: e.target.value }; }, `${f.id}:label`)} />
                  {k ? <TypeMenu value={k} disabled={isLocked} onPick={(nk) => edit(f.id, (g) => setKind(g, nk))} />
                    : <span className="sf-fixed">Calculated <button type="button" className="linkish" onClick={() => onAdvanced({ kind: 'field', id: f.id })}>settings</button></span>}
                </div>
                {helpOpen && <input className="sf-help" value={f.help?.en ?? ''} placeholder="Description" aria-label="Question description"
                  onChange={(e) => edit(f.id, (g) => { const v = e.target.value; if (v) g.help = { ...(g.help ?? { en: '' }), en: v }; else delete g.help; }, `${f.id}:help`)} />}
                <Body f={f} k={k} locked={isLocked} edit={edit} focusOpt={focusOpt} setFocusOpt={setFocusOpt} />
              </>}
              {probs.map((i, n) => <p key={n} className={`sf-issue ${i.level}`}>{i.message}</p>)}
              <div className="sf-foot">
                {ruled.has(f.id) && <button type="button" className="sf-chip" onClick={() => onAdvanced({ kind: 'field', id: f.id })}>Logic</button>}
                <span style={{ flex: 1 }} />
                <button type="button" className="sf-icon" onClick={() => dup(f)} aria-label="Duplicate" title="Duplicate"><G n="copy" /></button>
                <button type="button" className="sf-icon" onClick={() => remove(f)} disabled={isLocked} aria-label="Delete" title={isLocked ? 'In a published version: hide it with a rule instead' : 'Delete'}><G n="trash" /></button>
                {f.type !== 'statement' && f.type !== 'calculated' && <><span className="sf-sep" />
                  <label className="sf-req"><span>Required</span><input type="checkbox" role="switch" checked={!!f.required} onChange={(e) => edit(f.id, (g) => { if (e.target.checked) g.required = true; else delete g.required; })} /><i aria-hidden="true" /></label></>}
                <Menu label="More options" items={[
                  f.type !== 'statement' && { label: 'Description', on: helpOpen, run: () => { if (helpOpen) { edit(f.id, (g) => { delete g.help; }); setShowHelp((s) => { const n = new Set(s); n.delete(f.id); return n; }); } else setShowHelp((s) => new Set(s).add(f.id)); } },
                  { label: 'Move up', run: () => move(f.id, -1) }, { label: 'Move down', run: () => move(f.id, 1) },
                  { label: 'Show only when… (logic)', run: () => onAdvanced({ kind: 'field', id: f.id }) },
                  { label: 'More settings (limits, translations, ID)', run: () => onAdvanced({ kind: 'field', id: f.id }) },
                ]} />
              </div>
            </div>}
          </div>;
        })}
        {!p.fields.length && <div className={`sf-empty${over === `page:${p.id}:empty` ? ' over' : ''}`} {...dropProps(`page:${p.id}:empty`, { page: p.id })}>No questions in this section yet. Use <b>+</b> to add one.</div>}
      </section>)}
    </div>

    <div className="sf-rail" role="toolbar" aria-label="Add">
      <button type="button" onClick={addQuestion} aria-label="Add question" title="Add question"><G n="add" size={22} /></button>
      <button type="button" onClick={addText} aria-label="Add title and description" title="Add title and description"><G n="statement" size={22} /></button>
      <button type="button" onClick={addSection} aria-label="Add section" title="Add section"><G n="section" size={22} /></button>
    </div>
  </div>;
}

function Body({ f, k, locked, edit, focusOpt, setFocusOpt }: { f: Field; k: Kind | null; locked: boolean; edit: (id: string, fn: (f: Field) => void, key?: string) => void;
  focusOpt: string | null; setFocusOpt: (v: string | null) => void }) {
  if (isChoice(k)) {
    const opts = f.config?.options ?? [];
    const newValue = () => { const used = new Set(opts.map((o) => o.value)); let i = opts.length + 1; while (used.has(`option_${i}`)) i++; return `option_${i}`; };
    const add = (at: number) => { const v = newValue(); edit(f.id, (g) => { g.config = { ...(g.config ?? {}) }; g.config.options = [...(g.config.options ?? [])]; g.config.options.splice(at, 0, { value: v, label: { en: `Option ${at + 1}` } }); }); setFocusOpt(`${f.id}:${v}`); };
    return <div className="sf-opts">
      {opts.map((o, i) => <div key={o.value} className="sf-opt">
        <span className="sf-opt-mark">{k === 'dropdown' ? `${i + 1}.` : <G n={k === 'radio' ? 'radio-off' : 'box-off'} />}</span>
        <input value={o.label.en ?? ''} aria-label={`Option ${i + 1}`} ref={(el) => { if (el && focusOpt === `${f.id}:${o.value}`) { el.focus(); el.select(); setFocusOpt(null); } }}
          onChange={(e) => edit(f.id, (g) => { const x = g.config!.options!.find((y) => y.value === o.value); if (x) x.label = { ...x.label, en: e.target.value }; }, `${f.id}:opt:${o.value}`)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(i + 1); } }} />
        {opts.length > 1 && <button type="button" className="sf-icon sm" aria-label={`Remove option ${i + 1}`} disabled={locked} title={locked ? 'In a published version: options cannot be removed, only renamed' : 'Remove'}
          onClick={() => edit(f.id, (g) => { g.config!.options = g.config!.options!.filter((y) => y.value !== o.value); })}><G n="x" size={16} /></button>}
      </div>)}
      <div className="sf-opt add"><span className="sf-opt-mark">{k === 'dropdown' ? `${opts.length + 1}.` : <G n={k === 'radio' ? 'radio-off' : 'box-off'} />}</span>
        <button type="button" className="sf-add-opt" onClick={() => add(opts.length)}>Add option</button></div>
    </div>;
  }
  if (k === 'short_text' || k === 'email' || k === 'phone' || k === 'url' || k === 'number' || k === 'date') {
    const ph = { short_text: 'Short answer text', email: 'name@example.org', phone: 'Phone number', url: 'https://…', number: 'Number', date: 'Day, month, year' }[k];
    return <div className="sf-line">{ph}</div>;
  }
  if (k === 'long_text') return <div className="sf-line long">Long answer text</div>;
  if (k === 'yes_no') return <div className="sf-opts ro"><div className="sf-opt"><span className="sf-opt-mark"><G n="radio-off" /></span>Yes</div><div className="sf-opt"><span className="sf-opt-mark"><G n="radio-off" /></span>No</div></div>;
  if (k === 'consent') return <div className="sf-consent"><span className="sf-opt-mark"><G n="box-off" /></span>
    <textarea rows={2} value={f.config?.text?.en ?? ''} placeholder="What the applicant agrees to (optional: the question above is shown next to the tick box)" aria-label="Agreement text"
      onChange={(e) => edit(f.id, (g) => { g.config = { ...(g.config ?? {}), text: { ...(g.config?.text ?? { en: '' }), en: e.target.value } }; }, `${f.id}:text`)} /></div>;
  if (k === 'file') {
    const acc = f.config?.accept ?? [];
    return <div className="sf-file">
      <div className="sf-file-row"><span>Allowed files</span>{Object.entries(FILE_TYPES).map(([key, v]) => <label key={key} className={`sf-pill${acc.includes(key as never) ? ' on' : ''}`}>
        <input type="checkbox" checked={acc.includes(key as never)} onChange={(e) => edit(f.id, (g) => { const a = new Set(g.config?.accept ?? []); if (e.target.checked) a.add(key as never); else if (a.size > 1) a.delete(key as never); g.config = { ...(g.config ?? {}), accept: [...a] }; })} />
        {v.label.replace(/ \(.*\)$/, '')}</label>)}</div>
      <div className="sf-file-row"><label>Maximum size <select className="select" value={f.config?.maxMb ?? 5} onChange={(e) => edit(f.id, (g) => { g.config = { ...(g.config ?? {}), maxMb: Number(e.target.value) }; })}>{[...new Set([1, 2, 5, 10, 20, f.config?.maxMb ?? 5])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} MB</option>)}</select></label>
        <label>Number of files <select className="select" value={f.config?.maxFiles ?? 1} onChange={(e) => edit(f.id, (g) => { g.config = { ...(g.config ?? {}), maxFiles: Number(e.target.value) }; })}>{[...new Set([1, 2, 3, 5, 10, f.config?.maxFiles ?? 1])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
    </div>;
  }
  return null;
}
P['radio-off'] = <circle cx="12" cy="12" r="8.5" />;
P['box-off'] = <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />;
