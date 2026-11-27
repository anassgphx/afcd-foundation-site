// Form builder inspector: settings of the selected question (Content, Validation, Logic, Appearance, Advanced), of a
// page, of a rule (the visual rule builder) and of the whole form. Every edit goes through `change`, which the builder
// records for undo/redo.
import { useState, type ReactNode } from 'react';
import { Icon } from '../ui.tsx';
import type { Action, Cond, Expr, Field, FormDef, Lang, Op, Page, Rule } from '../../server/modules/apply/engine.ts';
import { FIELD_TYPES, FILE_TYPES, ID, OP_LABEL, OPS_FOR, allFields, kindOf, t } from '../../server/modules/apply/engine.ts';

export type Sel = { kind: 'field' | 'page' | 'rule'; id: string } | { kind: 'settings' } | null;
type Change = (fn: (d: FormDef) => void, key?: string) => void;
const LANGS: [keyof Lang, string][] = [['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']];

export const slugId = (s: string, taken: Set<string>, fallback = 'q') => {
  let base = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || fallback;
  if (!/^[a-z]/.test(base)) base = `${fallback}_${base}`.slice(0, 32);
  let id = base, i = 2;
  while (taken.has(id)) id = `${base}_${i++}`;
  return id;
};
/** Renames a question and every reference to it (conditions, actions, calculations); page and rule IDs are untouched. */
export function renameField(d: FormDef, from: string, to: string) {
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.field === from) o.field = to;
    if (o.kind === 'field' && o.id === from) o.id = to;
    for (const x of Object.values(o)) walk(x);
  };
  for (const p of d.pages) for (const f of p.fields) { if (f.id === from) f.id = to; walk(f.config); }
  walk(d.rules);
}
export const findField = (d: FormDef, id: string) => { for (const p of d.pages) { const f = p.fields.find((x) => x.id === id); if (f) return f; } return null; };

function Txt({ label, value, onChange, area, max, hint, dir, placeholder }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; max?: number; hint?: ReactNode; dir?: 'rtl'; placeholder?: string }) {
  return <label className="field in-f"><span>{label}</span>
    {area ? <textarea className="textarea" rows={3} maxLength={max} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      : <input className="input" maxLength={max} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    {hint && <small>{hint}</small>}</label>;
}
function LangText({ label, value, onChange, area, max, langs }: { label: string; value: Lang | undefined; onChange: (v: Lang | undefined) => void; area?: boolean; max?: number; langs: (keyof Lang)[] }) {
  const v = value ?? { en: '' };
  const set = (k: keyof Lang, s: string) => { const n = { ...v, [k]: s }; if (!n.fr) delete n.fr; if (!n.ar) delete n.ar; onChange(!n.en && !n.fr && !n.ar ? undefined : n); };
  return <div className="in-lang"><span className="in-lang-h">{label}</span>
    {LANGS.filter(([k]) => k === 'en' || langs.includes(k)).map(([k, l]) => <Txt key={k} label={l} area={area} max={max} dir={k === 'ar' ? 'rtl' : undefined} value={v[k] ?? ''} placeholder={k !== 'en' ? v.en : undefined} onChange={(s) => set(k, s)} />)}</div>;
}
function Num({ label, value, onChange, min, max, step, hint }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; hint?: string }) {
  return <label className="field in-f"><span>{label}</span><input className="input" type="number" min={min} max={max} step={step ?? 'any'} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />{hint && <small>{hint}</small>}</label>;
}
function Check({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return <label className="in-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{label}{hint && <small>{hint}</small>}</span></label>;
}
const Tabs = ({ tabs, value, set }: { tabs: string[]; value: string; set: (v: string) => void }) =>
  <div className="in-tabs" role="tablist">{tabs.map((x) => <button key={x} type="button" role="tab" aria-selected={value === x} className={value === x ? 'on' : ''} onClick={() => set(x)}>{x}</button>)}</div>;

// ---------------------------------------------------------------- Field
export function FieldInspector({ d, f, change, locked, onSelect, onDelete }: { d: FormDef; f: Field; change: Change; locked: Set<string>; onSelect: (s: Sel) => void; onDelete: () => void }) {
  const [tab, setTab] = useState('Content');
  const langs = d.settings.languages;
  const k = kindOf(f.type);
  const up = (fn: (x: Field) => void, key?: string) => change((dd) => { const x = findField(dd, f.id); if (x) fn(x); }, key ? `${f.id}:${key}` : undefined);
  const cfg = (fn: (c: NonNullable<Field['config']>) => void, key: string) => up((x) => { x.config = x.config ?? {}; fn(x.config); for (const [kk, vv] of Object.entries(x.config)) if (vv === undefined) delete (x.config as Record<string, unknown>)[kk]; if (!Object.keys(x.config).length) delete x.config; }, key);
  const app = (fn: (a: NonNullable<Field['appearance']>) => void, key: string) => up((x) => { x.appearance = x.appearance ?? {}; fn(x.appearance); for (const [kk, vv] of Object.entries(x.appearance)) if (vv === undefined) delete (x.appearance as Record<string, unknown>)[kk]; if (!Object.keys(x.appearance).length) delete x.appearance; }, key);
  const rules = d.rules.filter((r) => JSON.stringify(r).includes(`"${f.id}"`));
  const tabs = ['Content', ...(FIELD_TYPES[f.type].input ? ['Validation'] : []), 'Logic', 'Appearance', 'Advanced'];
  const c = f.config ?? {};
  return <div className="in">
    <div className="in-h"><span className="pill">{FIELD_TYPES[f.type].label}</span><b className="mono">{f.id}</b><span style={{ flex: 1 }} />
      <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onDelete} disabled={locked.has(f.id)} title={locked.has(f.id) ? 'In a published version: hide it with a rule instead' : 'Delete question'}><Icon n="x" />Delete</button></div>
    <Tabs tabs={tabs} value={tabs.includes(tab) ? tab : 'Content'} set={setTab} />
    {tab === 'Content' && <div className="in-b">
      <LangText label={f.type === 'statement' ? 'Heading (optional)' : 'Question'} langs={langs} value={f.label} max={500} onChange={(v) => up((x) => { x.label = v ?? { en: '' }; }, 'label')} />
      {f.type !== 'statement' && <LangText label="Help text" area langs={langs} value={f.help} max={2000} onChange={(v) => up((x) => { if (v) x.help = v; else delete x.help; }, 'help')} />}
      {(f.type === 'statement' || f.type === 'consent') && <LangText label={f.type === 'consent' ? 'Text under the checkbox' : 'Text'} area langs={langs} value={c.text} max={20000} onChange={(v) => cfg((cc) => { cc.text = v; }, 'text')} />}
      {(k === 'choice' || k === 'multi') && <OptionsEditor f={f} langs={langs} locked={locked.has(f.id)} cfg={cfg} />}
    </div>}
    {tab === 'Validation' && <div className="in-b">
      <Check label="Required" checked={!!f.required} onChange={(v) => up((x) => { if (v) x.required = true; else delete x.required; })} hint={f.type === 'consent' ? 'Applicants must tick it to submit.' : undefined} />
      {k === 'text' && <div className="in-row"><Num label="Min. characters" min={0} value={c.minLength} onChange={(v) => cfg((cc) => { cc.minLength = v; }, 'minLength')} /><Num label="Max. characters" min={1} value={c.maxLength} onChange={(v) => cfg((cc) => { cc.maxLength = v; }, 'maxLength')} /></div>}
      {f.type === 'number' && <><div className="in-row"><Num label="Minimum" value={c.min} onChange={(v) => cfg((cc) => { cc.min = v; }, 'min')} /><Num label="Maximum" value={c.max} onChange={(v) => cfg((cc) => { cc.max = v; }, 'max')} /></div>
        <Check label="Whole numbers only" checked={c.step === 1} onChange={(v) => cfg((cc) => { cc.step = v ? 1 : undefined; }, 'step')} /></>}
      {f.type === 'date' && <div className="in-row"><label className="field in-f"><span>Earliest</span><input className="input" type="date" value={c.minDate ?? ''} onChange={(e) => cfg((cc) => { cc.minDate = e.target.value || undefined; }, 'minDate')} /></label>
        <label className="field in-f"><span>Latest</span><input className="input" type="date" value={c.maxDate ?? ''} onChange={(e) => cfg((cc) => { cc.maxDate = e.target.value || undefined; }, 'maxDate')} /></label></div>}
      {k === 'multi' && <div className="in-row"><Num label="Choose at least" min={0} step={1} value={c.minSelected} onChange={(v) => cfg((cc) => { cc.minSelected = v; }, 'minSel')} /><Num label="Choose at most" min={1} step={1} value={c.maxSelected} onChange={(v) => cfg((cc) => { cc.maxSelected = v; }, 'maxSel')} /></div>}
      {f.type === 'file' && <><span className="in-lang-h">Accepted files</span>
        {Object.entries(FILE_TYPES).map(([key, ft]) => <Check key={key} label={ft.label} checked={(c.accept ?? ['pdf']).includes(key as 'pdf')} onChange={(v) => cfg((cc) => { const cur = new Set(cc.accept ?? ['pdf']); if (v) cur.add(key as 'pdf'); else cur.delete(key as 'pdf'); cc.accept = cur.size ? [...cur] as ('pdf')[] : ['pdf']; }, 'accept')} />)}
        <div className="in-row"><Num label="Max. size (MB)" min={0.1} max={25} value={c.maxMb ?? 10} onChange={(v) => cfg((cc) => { cc.maxMb = v; }, 'maxMb')} /><Num label="Max. files" min={1} max={10} step={1} value={c.maxFiles ?? 1} onChange={(v) => cfg((cc) => { cc.maxFiles = v; }, 'maxFiles')} /></div>
        <small className="muted">Files are checked on the server (type from the bytes, size), stored privately and never published.</small></>}
    </div>}
    {tab === 'Logic' && <div className="in-b">
      {rules.length ? <ul className="in-rules">{rules.map((r) => <li key={r.id}><button type="button" className="linkish" onClick={() => onSelect({ kind: 'rule', id: r.id })}>{r.name || r.id}</button><small>{ruleSummary(d, r)}</small></li>)}</ul>
        : <p className="muted">No rule uses this question yet.</p>}
      {FIELD_TYPES[f.type].input && <button type="button" className="btn btn-sm" onClick={() => {
        const id = slugId(`show_when_${f.id}`, new Set(d.rules.map((r) => r.id)), 'rule');
        change((dd) => { dd.rules.push({ id, name: `When ${t(f.label) || f.id} is answered`, when: { all: [{ field: f.id, op: 'not_empty' }] }, then: [] }); });
        onSelect({ kind: 'rule', id });
      }}><Icon n="plus" />Rule that uses this answer</button>}
      <button type="button" className="btn btn-sm" onClick={() => {
        const id = slugId(`show_${f.id}`, new Set(d.rules.map((r) => r.id)), 'rule');
        change((dd) => { dd.rules.push({ id, name: `Show ${t(f.label) || f.id}`, when: { all: [] }, then: [{ type: 'show', target: { kind: 'field', id: f.id } }] }); });
        onSelect({ kind: 'rule', id });
      }}><Icon n="eye" />Show this question only when…</button>
    </div>}
    {tab === 'Appearance' && <div className="in-b">
      <label className="field in-f"><span>Width</span><select className="select" value={f.appearance?.width ?? 'full'} onChange={(e) => app((a) => { a.width = e.target.value === 'half' ? 'half' : undefined; }, 'width')}><option value="full">Full width</option><option value="half">Half (side by side on wide screens)</option></select></label>
      {f.type === 'single_choice' && <label className="field in-f"><span>Show options as</span><select className="select" value={f.appearance?.display ?? 'radio'} onChange={(e) => app((a) => { a.display = e.target.value === 'radio' ? undefined : e.target.value as 'dropdown'; }, 'display')}><option value="radio">A list</option><option value="buttons">Buttons in a row</option><option value="dropdown">A dropdown</option></select></label>}
      {f.type === 'long_text' && <Num label="Height (lines)" min={2} max={20} step={1} value={f.appearance?.rows} onChange={(v) => app((a) => { a.rows = v; }, 'rows')} />}
      {['short_text', 'long_text', 'email', 'phone', 'url', 'number'].includes(f.type) && <LangText label="Placeholder" langs={langs} value={f.appearance?.placeholder} max={200} onChange={(v) => app((a) => { a.placeholder = v; }, 'placeholder')} />}
    </div>}
    {tab === 'Advanced' && <div className="in-b">
      <IdEditor d={d} f={f} change={change} locked={locked.has(f.id)} onRenamed={(id) => onSelect({ kind: 'field', id })} />
      <Check label="Sensitive answer" checked={!!f.private} onChange={(v) => up((x) => { if (v) x.private = true; else delete x.private; })} hint="Hidden from reviewers in blind mode and left out of exports unless chosen." />
      {f.type === 'calculated' && <CalcEditor d={d} f={f} cfg={cfg} />}
    </div>}
  </div>;
}

function OptionsEditor({ f, langs, locked, cfg }: { f: Field; langs: (keyof Lang)[]; locked: boolean; cfg: (fn: (c: NonNullable<Field['config']>) => void, key: string) => void }) {
  const opts = f.config?.options ?? [];
  const taken = new Set(opts.map((o) => o.value));
  return <div className="in-lang"><span className="in-lang-h">Options</span>
    {opts.map((o, i) => <div key={o.value} className="in-opt">
      <div className="in-opt-texts">{LANGS.filter(([k]) => k === 'en' || langs.includes(k)).map(([k, l]) => <input key={k} className="input" dir={k === 'ar' ? 'rtl' : undefined} aria-label={`Option ${i + 1} (${l})`} placeholder={k === 'en' ? 'Option' : o.label.en}
        value={o.label[k] ?? ''} onChange={(e) => cfg((c) => { const x = c.options![i]; x.label = { ...x.label, [k]: e.target.value }; if (!x.label.fr) delete x.label.fr; if (!x.label.ar) delete x.label.ar; }, `opt:${o.value}:${k}`)} />)}
        <small className="mono muted">value: {o.value}</small></div>
      <div className="in-opt-btns">
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => cfg((c) => { const a = c.options!; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }, 'order')}>↑</button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Move down" disabled={i === opts.length - 1} onClick={() => cfg((c) => { const a = c.options!; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }, 'order')}>↓</button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Remove option" disabled={locked} title={locked ? 'In a published version: options cannot be removed' : undefined} onClick={() => cfg((c) => { c.options!.splice(i, 1); }, 'remove')}><Icon n="x" /></button>
      </div></div>)}
    <button type="button" className="btn btn-sm" onClick={() => cfg((c) => { const v = slugId(`option_${opts.length + 1}`, taken, 'option'); c.options = [...(c.options ?? []), { value: v, label: { en: `Option ${opts.length + 1}` } }]; }, 'add')}><Icon n="plus" />Add option</button>
    {locked && <small className="muted">Options already published stay, so earlier answers keep their meaning. You can rename their labels.</small>}
  </div>;
}

function IdEditor({ d, f, change, locked, onRenamed }: { d: FormDef; f: Field; change: Change; locked: boolean; onRenamed: (id: string) => void }) {
  const [v, setV] = useState(f.id); const [err, setErr] = useState('');
  const taken = new Set(allFields(d).map((x) => x.id));
  function apply() {
    if (v === f.id) return;
    if (!ID.test(v)) return setErr('Start with a letter; use a–z, 0–9 and _ (at most 40).');
    if (taken.has(v)) return setErr('Another question uses this ID.');
    const old = f.id;
    // rename everywhere: the field, and every rule and calculation that refers to it
    change((dd) => renameField(dd, old, v));
    setErr(''); onRenamed(v);
  }
  return <label className="field in-f"><span>Question ID</span>
    <div className="in-row"><input className="input mono" value={v} disabled={locked} onChange={(e) => setV(e.target.value.toLowerCase())} onBlur={apply} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} /></div>
    <small>{locked ? 'Fixed: this question is in a published version, and answers are stored under this ID.' : 'Stable name used in exports and rules. Renaming updates the rules that use it.'}</small>
    {err && <small className="bad-t">{err}</small>}</label>;
}

function CalcEditor({ d, f, cfg }: { d: FormDef; f: Field; cfg: (fn: (c: NonNullable<Field['config']>) => void, key: string) => void }) {
  const e = f.config?.expr;
  const flat = e === undefined || (typeof e === 'object' && 'op' in e && ['sum', 'sub', 'mul', 'min', 'max'].includes(e.op) && (e as { args: Expr[] }).args.every((a) => typeof a === 'number' || ('field' in a && !('op' in a))));
  const nums = allFields(d).filter((x) => x.id !== f.id && (x.type === 'number' || x.type === 'calculated'));
  const op = (e && typeof e === 'object' && 'op' in e ? e.op : 'sum') as 'sum';
  const args = (e && typeof e === 'object' && 'args' in e ? e.args : []) as Expr[];
  const setExpr = (o: string, a: Expr[]) => cfg((c) => { c.expr = { op: o as 'sum', args: a.length ? a : [0] }; }, 'expr');
  return <div className="in-lang"><span className="in-lang-h">Calculation</span>
    {!flat ? <p className="muted">This calculation was made in a template and has more steps than the builder edits. It is checked and recomputed on the server like any other.</p> : <>
      <label className="field in-f"><span>Operation</span><select className="select" value={op} onChange={(x) => setExpr(x.target.value, args)}>
        <option value="sum">Add up</option><option value="sub">Subtract (first minus the others)</option><option value="mul">Multiply</option><option value="min">Smallest</option><option value="max">Largest</option></select></label>
      {args.map((a, i) => <div key={i} className="in-row">
        <select className="select" value={typeof a === 'number' ? '__n' : (a as { field: string }).field} onChange={(x) => setExpr(op, args.map((y, j) => j === i ? (x.target.value === '__n' ? 0 : { field: x.target.value }) : y))}>
          {nums.map((n) => <option key={n.id} value={n.id}>{t(n.label) || n.id}</option>)}<option value="__n">A fixed number</option></select>
        {typeof a === 'number' && <input className="input" type="number" value={a} onChange={(x) => setExpr(op, args.map((y, j) => j === i ? Number(x.target.value) || 0 : y))} aria-label="Number" />}
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Remove" onClick={() => setExpr(op, args.filter((_, j) => j !== i))}><Icon n="x" /></button></div>)}
      <button type="button" className="btn btn-sm" disabled={!nums.length} onClick={() => setExpr(op, [...args.filter((a) => a !== 0 || args.length > 1), nums[0] ? { field: nums[0].id } : 0])}><Icon n="plus" />Add a value</button>
      {!nums.length && <small className="muted">Add number questions first.</small>}</>}
    <div className="in-row"><Num label="Decimals" min={0} max={6} step={1} value={f.config?.decimals ?? 2} onChange={(v) => cfg((c) => { c.decimals = v; }, 'decimals')} />
      <Txt label="Unit" max={20} value={f.config?.unit ?? ''} onChange={(v) => cfg((c) => { c.unit = v || undefined; }, 'unit')} placeholder="MAD" /></div>
    <small className="muted">Recalculated on the server when the application is submitted; what the browser shows is never trusted.</small>
  </div>;
}

// ---------------------------------------------------------------- Page
export function PageInspector({ d, p, change, onDelete, onSelect }: { d: FormDef; p: Page; change: Change; onDelete: () => void; onSelect: (s: Sel) => void }) {
  const up = (fn: (x: Page) => void, key?: string) => change((dd) => { const x = dd.pages.find((y) => y.id === p.id); if (x) fn(x); }, key ? `page:${p.id}:${key}` : undefined);
  const rules = d.rules.filter((r) => r.then.some((a) => (a.type === 'skip_to' && a.from === p.id) || ((a.type === 'show' || a.type === 'hide') && a.target.kind === 'page' && a.target.id === p.id)));
  const ruleIds = new Set(d.rules.map((r) => r.id));
  return <div className="in">
    <div className="in-h"><span className="pill">Page {d.pages.indexOf(p) + 1}</span><b className="mono">{p.id}</b><span style={{ flex: 1 }} />
      <button type="button" className="btn btn-ghost btn-sm btn-danger" disabled={d.pages.length < 2 || p.fields.length > 0} title={p.fields.length ? 'Move or delete its questions first' : undefined} onClick={onDelete}><Icon n="x" />Delete</button></div>
    <div className="in-b">
      <LangText label="Page title" langs={d.settings.languages} value={p.title} max={200} onChange={(v) => up((x) => { x.title = v ?? { en: '' }; }, 'title')} />
      <LangText label="Introduction (optional)" area langs={d.settings.languages} value={p.description} max={2000} onChange={(v) => up((x) => { if (v) x.description = v; else delete x.description; }, 'desc')} />
      <span className="in-lang-h">Rules for this page</span>
      {rules.length ? <ul className="in-rules">{rules.map((r) => <li key={r.id}><button type="button" className="linkish" onClick={() => onSelect({ kind: 'rule', id: r.id })}>{r.name || r.id}</button><small>{ruleSummary(d, r)}</small></li>)}</ul> : <p className="muted">Applicants go to the next page.</p>}
      <div className="in-row">
        <button type="button" className="btn btn-sm" disabled={d.pages.indexOf(p) >= d.pages.length - 2} onClick={() => { const id = slugId(`skip_after_${p.id}`, ruleIds, 'rule'); const to = d.pages[d.pages.indexOf(p) + 2]?.id ?? p.id;
          change((dd) => { dd.rules.push({ id, name: `Skip after ${t(p.title) || p.id}`, when: { all: [] }, then: [{ type: 'skip_to', from: p.id, to }] }); }); onSelect({ kind: 'rule', id }); }}>Skip ahead when…</button>
        <button type="button" className="btn btn-sm" disabled={d.pages.indexOf(p) === 0} onClick={() => { const id = slugId(`show_${p.id}`, ruleIds, 'rule');
          change((dd) => { dd.rules.push({ id, name: `Show ${t(p.title) || p.id}`, when: { all: [] }, then: [{ type: 'show', target: { kind: 'page', id: p.id } }] }); }); onSelect({ kind: 'rule', id }); }}>Show only when…</button>
      </div>
    </div>
  </div>;
}

// ---------------------------------------------------------------- Rules
export function ruleSummary(d: FormDef, r: Rule) {
  const name = (id: string) => { const f = findField(d, id); return f ? (t(f.label) || id) : id; };
  const page = (id: string) => t(d.pages.find((p) => p.id === id)?.title) || id;
  const cond = (c: Cond): string => 'all' in c ? (c.all.length ? c.all.map(cond).join(' and ') : 'always') : 'any' in c ? c.any.map(cond).join(' or ') : `${name(c.field)} ${OP_LABEL[c.op]}${c.value !== undefined && !['empty', 'not_empty'].includes(c.op) ? ` ${c.value === true ? 'Yes' : c.value === false ? 'No' : c.value}` : ''}`;
  const act = (a: Action) => a.type === 'show' || a.type === 'hide' ? `${a.type} ${a.target.kind === 'page' ? `page “${page(a.target.id)}”` : name(a.target.id)}` : a.type === 'require' ? `require ${name(a.field)}` : a.type === 'optional' ? `make ${name(a.field)} optional`
    : a.type === 'skip_to' ? `after “${page(a.from)}” go to “${page(a.to)}”` : a.type === 'message' ? 'show a message' : `mark ${(a as Extract<Action, { type: 'eligibility' }>).result.replace('_', ' ')}`;
  return `If ${cond(r.when)}: ${r.then.map(act).join(', ') || 'nothing yet'}`;
}

const blankAction = (d: FormDef): Action => ({ type: 'show', target: { kind: 'field', id: allFields(d)[0]?.id ?? 'x' } });

export function RuleInspector({ d, r, change, onDelete }: { d: FormDef; r: Rule; change: Change; onDelete: () => void }) {
  const up = (fn: (x: Rule) => void, key?: string) => change((dd) => { const x = dd.rules.find((y) => y.id === r.id); if (x) fn(x); }, key ? `rule:${r.id}:${key}` : undefined);
  const flat = ('all' in r.when || 'any' in r.when) && ('all' in r.when ? r.when.all : (r.when as { any: Cond[] }).any).every((c) => 'field' in c);
  const mode = 'any' in r.when ? 'any' : 'all';
  const conds = flat ? ('all' in r.when ? r.when.all : (r.when as { any: Cond[] }).any) as Extract<Cond, { field: string }>[] : [];
  const inputs = allFields(d).filter((f) => kindOf(f.type) !== 'none');
  const setConds = (list: Cond[], m = mode) => up((x) => { x.when = m === 'any' ? { any: list } : { all: list }; }, 'cond');
  return <div className="in">
    <div className="in-h"><span className="pill">Rule</span><b className="mono">{r.id}</b><span style={{ flex: 1 }} /><button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onDelete}><Icon n="x" />Delete</button></div>
    <div className="in-b">
      <Txt label="Name" max={120} value={r.name ?? ''} onChange={(v) => up((x) => { x.name = v || undefined; }, 'name')} placeholder="What this rule does" />
      <div className="in-lang"><span className="in-lang-h">When</span>
        {!flat ? <p className="muted">This rule has nested conditions (from a template). It works and is checked like any other; the builder shows it as: {ruleSummary(d, r)}.</p> : <>
          {conds.length > 1 && <select className="select in-mode" value={mode} onChange={(e) => setConds(conds, e.target.value)} aria-label="Match"><option value="all">All of these are true</option><option value="any">Any of these is true</option></select>}
          {!conds.length && <p className="muted">Always (no condition).</p>}
          {conds.map((c, i) => <CondRow key={i} d={d} c={c} fields={inputs} onChange={(n) => setConds(conds.map((x, j) => (j === i ? n : x)))} onRemove={() => setConds(conds.filter((_, j) => j !== i))} />)}
          <button type="button" className="btn btn-sm" disabled={!inputs.length} onClick={() => setConds([...conds, { field: inputs[0].id, op: OPS_FOR[kindOf(inputs[0].type)][0] }])}><Icon n="plus" />Add condition</button></>}
      </div>
      <div className="in-lang"><span className="in-lang-h">Then</span>
        {r.then.map((a, i) => <ActionRow key={i} d={d} a={a} onChange={(n) => up((x) => { x.then[i] = n; }, `act${i}`)} onRemove={() => up((x) => { x.then.splice(i, 1); })} />)}
        <button type="button" className="btn btn-sm" disabled={r.then.length >= 20} onClick={() => up((x) => { x.then.push(blankAction(d)); })}><Icon n="plus" />Add action</button>
      </div>
      <p className="in-sum">{ruleSummary(d, r)}</p>
    </div>
  </div>;
}

function CondRow({ d, c, fields, onChange, onRemove }: { d: FormDef; c: Extract<Cond, { field: string }>; fields: Field[]; onChange: (c: Cond) => void; onRemove: () => void }) {
  const f = findField(d, c.field);
  const k = f ? kindOf(f.type) : 'text';
  const ops = OPS_FOR[k] ?? [];
  const needs = !['empty', 'not_empty'].includes(c.op);
  let value: ReactNode = null;
  if (needs) {
    if ((k === 'choice' || k === 'multi') && f) value = <select className="select" value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Value"><option value="">Choose…</option>{(f.config?.options ?? []).map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</select>;
    else if (k === 'bool') value = <select className="select" value={c.value === undefined ? '' : String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === 'true' })} aria-label="Value"><option value="">Choose…</option><option value="true">{f?.type === 'consent' ? 'Ticked' : 'Yes'}</option><option value="false">{f?.type === 'consent' ? 'Not ticked' : 'No'}</option></select>;
    else if (k === 'number') value = <input className="input" type="number" value={typeof c.value === 'number' ? c.value : ''} onChange={(e) => onChange({ ...c, value: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Value" />;
    else if (k === 'date') value = <input className="input" type="date" value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value || undefined })} aria-label="Value" />;
    else value = <input className="input" value={String(c.value ?? '')} maxLength={500} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Value" />;
  }
  return <div className="in-cond">
    <select className="select" value={c.field} onChange={(e) => { const g = findField(d, e.target.value); onChange({ field: e.target.value, op: OPS_FOR[g ? kindOf(g.type) : 'text'][0] }); }} aria-label="Question">
      {!f && <option value={c.field}>Missing: {c.field}</option>}{fields.map((x) => <option key={x.id} value={x.id}>{t(x.label) || x.id}</option>)}</select>
    <select className="select" value={c.op} onChange={(e) => onChange({ field: c.field, op: e.target.value as Op, ...(['empty', 'not_empty'].includes(e.target.value) ? {} : { value: c.value }) })} aria-label="Comparison">
      {!ops.includes(c.op) && <option value={c.op}>{OP_LABEL[c.op]} (not valid)</option>}{ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
    {value}
    <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Remove condition" onClick={onRemove}><Icon n="x" /></button>
  </div>;
}

function ActionRow({ d, a, onChange, onRemove }: { d: FormDef; a: Action; onChange: (a: Action) => void; onRemove: () => void }) {
  const fields = allFields(d), inputs = fields.filter((f) => FIELD_TYPES[f.type].input);
  const make = (type: string): Action => type === 'show' || type === 'hide' ? { type, target: 'target' in a ? a.target : { kind: 'field', id: fields[0]?.id ?? 'x' } }
    : type === 'require' || type === 'optional' ? { type, field: 'field' in a ? a.field : inputs[0]?.id ?? 'x' }
    : type === 'skip_to' ? { type, from: d.pages[0]?.id ?? 'x', to: d.pages[1]?.id ?? d.pages[0]?.id ?? 'x' }
    : type === 'message' ? { type, message: { en: '' }, tone: 'info' } : { type: 'eligibility', result: 'needs_review', reason: { en: '' } };
  const targetOpts = <>{d.pages.map((p) => <optgroup key={p.id} label={t(p.title) || p.id}><option value={`page:${p.id}`}>The whole page</option>{p.fields.map((f) => <option key={f.id} value={`field:${f.id}`}>{t(f.label) || f.id}</option>)}</optgroup>)}</>;
  return <div className="in-act">
    <select className="select" value={a.type} onChange={(e) => onChange(make(e.target.value))} aria-label="Action">
      <option value="show">Show</option><option value="hide">Hide</option><option value="require">Make required</option><option value="optional">Make optional</option>
      <option value="skip_to">Skip to a page</option><option value="message">Show a message</option><option value="eligibility">Eligibility result</option></select>
    {(a.type === 'show' || a.type === 'hide') && <select className="select" value={`${a.target.kind}:${a.target.id}`} onChange={(e) => { const [kind, id] = e.target.value.split(':'); onChange({ ...a, target: { kind: kind as 'field', id } }); }} aria-label="Target">{targetOpts}</select>}
    {(a.type === 'require' || a.type === 'optional') && <select className="select" value={a.field} onChange={(e) => onChange({ ...a, field: e.target.value })} aria-label="Question">{inputs.map((f) => <option key={f.id} value={f.id}>{t(f.label) || f.id}</option>)}</select>}
    {a.type === 'skip_to' && <><select className="select" value={a.from} onChange={(e) => onChange({ ...a, from: e.target.value })} aria-label="After page">{d.pages.map((p) => <option key={p.id} value={p.id}>After “{t(p.title) || p.id}”</option>)}</select>
      <select className="select" value={a.to} onChange={(e) => onChange({ ...a, to: e.target.value })} aria-label="Go to page">{d.pages.map((p) => <option key={p.id} value={p.id}>go to “{t(p.title) || p.id}”</option>)}</select></>}
    {a.type === 'message' && <><select className="select" value={a.tone ?? 'info'} onChange={(e) => onChange({ ...a, tone: e.target.value as 'info' })} aria-label="Tone"><option value="info">Information</option><option value="warning">Warning</option></select>
      <select className="select" value={a.page ?? ''} onChange={(e) => onChange({ ...a, page: e.target.value || undefined })} aria-label="On page"><option value="">On every page</option>{d.pages.map((p) => <option key={p.id} value={p.id}>On “{t(p.title) || p.id}”</option>)}</select>
      <textarea className="textarea" rows={2} maxLength={1000} placeholder="Message (English)" value={a.message.en} onChange={(e) => onChange({ ...a, message: { ...a.message, en: e.target.value } })} aria-label="Message" /></>}
    {a.type === 'eligibility' && <><select className="select" value={a.result} onChange={(e) => onChange({ ...a, result: e.target.value as 'eligible' })} aria-label="Result"><option value="eligible">Eligible</option><option value="needs_review">Needs review</option><option value="ineligible">Ineligible</option></select>
      <input className="input" maxLength={500} placeholder="Reason (stored with the result)" value={a.reason.en} onChange={(e) => onChange({ ...a, reason: { ...a.reason, en: e.target.value } })} aria-label="Reason" />
      {a.result === 'ineligible' && <small className="muted">Applicants are never rejected automatically: staff see the result and its reason, and can correct it.</small>}</>}
    <button type="button" className="btn btn-ghost icon-btn btn-sm in-act-x" aria-label="Remove action" onClick={onRemove}><Icon n="x" /></button>
  </div>;
}

// ---------------------------------------------------------------- Form settings
export function SettingsInspector({ d, change }: { d: FormDef; change: Change }) {
  const s = d.settings;
  return <div className="in"><div className="in-h"><span className="pill">Form</span><b>Settings</b></div>
    <div className="in-b">
      <span className="in-lang-h">Languages applicants can choose</span>
      {LANGS.map(([k, l]) => <Check key={k} label={l} checked={s.languages.includes(k)} disabled={k === 'en'} onChange={(v) => change((dd) => { const set = new Set(dd.settings.languages); if (v) set.add(k); else set.delete(k); dd.settings.languages = (['en', 'fr', 'ar'] as const).filter((x) => set.has(x)); })} />)}
      <small className="muted">Texts left empty in French or Arabic show the English text.</small>
      <Check label="Review step before submitting" checked={s.reviewStep} onChange={(v) => change((dd) => { dd.settings.reviewStep = v; })} hint="Applicants see all their answers and can go back to change them." />
      <LangText label="Submit button" langs={s.languages} value={s.submitLabel} max={60} onChange={(v) => change((dd) => { if (v) dd.settings.submitLabel = v; else delete dd.settings.submitLabel; }, 'submitLabel')} />
      <LangText label="Confirmation message" area langs={s.languages} value={s.confirmation} max={2000} onChange={(v) => change((dd) => { dd.settings.confirmation = v ?? { en: '' }; }, 'confirmation')} />
      <small className="muted">Shown only after the server has saved the application, with its reference number.</small>
    </div></div>;
}
