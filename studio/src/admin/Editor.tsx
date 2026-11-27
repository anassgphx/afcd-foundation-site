// Shared editor layout for Studio records (events, opportunities, partners): sticky header with save state, a section
// menu that follows the scroll and marks sections ready, form sections as cards, and a publishing panel with the
// workflow steps and a readiness checklist. Presentation only: saving and workflow stay in each editor.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Icon, Link, LiveBadge } from './ui.tsx';
import './editor.css';

const SAVE_KEY = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';

export type SectionDef = { id: string; label: string; icon: string; done?: boolean; optional?: boolean };

export function EditorHeader({ back, title, file, status, live, extra, dirty, actions }: {
  back: { to: string; label: string }; title: string; file?: string; status: string | null; live: boolean; extra?: ReactNode; dirty: boolean; actions: ReactNode;
}) {
  // ⌘S itself is handled by each editor; the header only shows the shortcut next to "Unsaved changes"
  return <div className="ed-head">
    <div className="min-w-0">
      <Link to={back.to} className="ed-back"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />{back.label}</Link>
      <h1>{title || 'Untitled'}</h1>
      <div className="ed-meta">
        {live && status !== 'published' && <LiveBadge />}{status ? <Badge s={status} /> : null}{extra}
        {file && <span className="ed-file"><Icon n="globe" width={12} height={12} />{file}</span>}
        <span className={`ed-save${dirty ? ' dirty' : ''}`} role="status">{dirty ? <>Unsaved changes<kbd className="ed-kbd" title="Save">{SAVE_KEY}</kbd></> : 'All changes saved'}</span>
      </div>
    </div>
    <div className="ed-actions">{actions}</div>
  </div>;
}

/** Left menu: jumps to a section, follows the scroll, and shows which sections are complete. */
export function SectionNav({ sections }: { sections: SectionDef[] }) {
  const [on, setOn] = useState(sections[0]?.id);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(`sec-${s.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setOn(vis[0].target.id.slice(4));
    }, { rootMargin: '-80px 0px -60% 0px' });
    els.forEach((e) => io.observe(e)); return () => io.disconnect();
  }, [sections.map((s) => s.id).join()]);
  const req = sections.filter((s) => s.done !== undefined && !s.optional);
  const ok = req.filter((s) => s.done).length;
  return <nav className="ed-nav" aria-label="Sections">
    {req.length > 0 && <div className="ed-prog" role="status">
      <span className="ed-prog-h"><b>{ok === req.length ? 'All required sections done' : `${ok} of ${req.length} required done`}</b></span>
      <span className="ed-prog-bar" aria-hidden="true"><i style={{ width: `${Math.round((ok / req.length) * 100)}%` }} /></span>
      <span className="ed-prog-key"><i className="ed-todo" aria-hidden="true" />to do<i className="ed-ok" aria-hidden="true">✓</i>done</span>
    </div>}
    {sections.map((s) => <a key={s.id} href={`#sec-${s.id}`} className={on === s.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setOn(s.id); }}>
      <Icon n={s.icon} width={15} height={15} /><span>{s.label}</span>
      {s.done === undefined ? null : s.done ? <i className="ed-ok" aria-label="Complete">✓</i> : s.optional ? <i className="ed-opt">optional</i> : <i className="ed-todo" aria-label="Needs attention" />}
    </a>)}
  </nav>;
}

export function Section({ id, title, desc, children, aside }: { id: string; title: string; desc?: string; children: ReactNode; aside?: ReactNode }) {
  return <section id={`sec-${id}`} className="card ed-sec">
    <header><div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>{aside}</header>
    <div className="ed-body">{children}</div>
  </section>;
}

export function Field({ label, hint, children, span, count }: { label: string; hint?: ReactNode; children: ReactNode; span?: 1 | 2 | 3; count?: [number, number] }) {
  return <div className={`field ed-f${span ? ` s${span}` : ''}`}>
    <span className="ed-lbl">{label}{count && <em className={count[0] > count[1] * 0.9 ? 'near' : ''}>{count[0]} / {count[1]}</em>}</span>
    {children}{hint && <small>{hint}</small>}
  </div>;
}

const STEPS = [['draft', 'Draft'], ['in_review', 'In review'], ['approved', 'Approved'], ['published', 'Live']] as const;
/** One plain sentence: what the editor does now, so nobody has to work out the workflow from the step dots. */
export function nextStep(status: string, live: boolean, problems: number): string {
  if (status === 'archived') return 'Restore it as a draft to work on it again.';
  if (status === 'published') return 'It is on the website. Edit it any time: changes become a new draft and go live after review.';
  if (status === 'approved') return 'Publish it. The website is rebuilt and the page is checked before it counts as live.';
  if (status === 'in_review') return 'Waiting for a reviewer. You are notified when it is approved or sent back.';
  if (problems > 0) return `Finish the ${problems === 1 ? 'item' : `${problems} items`} below, save, then submit it for review.`;
  return live ? 'Submit the new draft for review. The live version stays as it is until the draft is published.'
    : 'Save, then submit it for review. A reviewer approves it before it can be published.';
}
/** Publishing panel: where the record stands in the workflow, what is still missing, and the available actions. */
export function WorkflowPanel({ status, live, problems, children, facts }: { status: string; live: boolean; problems: string[]; children: ReactNode; facts?: [string, ReactNode][] }) {
  const at = status === 'changes_requested' ? 0 : Math.max(0, STEPS.findIndex(([k]) => k === status));
  return <aside className="card ed-panel">
    <ol className="ed-steps" aria-label="Workflow">
      {STEPS.map(([k, l], i) => <li key={k} className={`${i < at || (live && k === 'published') ? 'done' : ''}${i === at && status !== 'archived' ? ' now' : ''}`}><span className="ed-step-dot">{i < at || (live && k === 'published') ? '✓' : i + 1}</span><span>{l}</span></li>)}
    </ol>
    <p className="ed-next"><b>Next step</b>{nextStep(status, live, problems.length)}</p>
    {status === 'changes_requested' && <div className="notice n-warn"><div>A reviewer asked for changes. Update the record, then submit again.</div></div>}
    {status === 'archived' && <div className="notice n-info"><div>Archived. Restore it to edit.</div></div>}
    {facts && <dl className="kv">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
    {status !== 'archived' && status !== 'published' && <div className={`ed-check${problems.length ? '' : ' ok'}`}>
      <b>{problems.length ? `${problems.length} thing${problems.length === 1 ? '' : 's'} to do before review` : 'Ready for review'}</b>
      {problems.length > 0 && <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </div>}
    <div className="ed-panel-actions">{children}</div>
  </aside>;
}

/** Sticky footer bar on small screens with the main save action. */
export function useDirtyGuard(dirty: boolean) {
  const ref = useRef(dirty); ref.current = dirty;
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (ref.current) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, []);
}

/** One input per item (who can apply, benefits…): Enter adds the next item, Backspace on an empty item removes it,
 *  and items can be moved or removed. Empty items are dropped from the saved value. */
export function ListEditor({ value, onChange, label, max, placeholder, disabled }: { value: string[]; onChange: (v: string[]) => void; label: string; max: number; placeholder: string; disabled?: boolean }) {
  const [rows, setRows] = useState<string[]>(value.length ? value : ['']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = useRef<number | null>(null);
  useEffect(() => { if (rows.filter((r) => r.trim()).join('\n') !== value.join('\n')) setRows(value.length ? value : ['']); }, [value.join('\n')]);
  useEffect(() => { if (focusAt.current !== null) { refs.current[focusAt.current]?.focus(); focusAt.current = null; } });
  const commit = (next: string[]) => { setRows(next.length ? next : ['']); onChange(next.map((r) => r.trim()).filter(Boolean).slice(0, max)); };
  const filled = rows.filter((r) => r.trim()).length;
  return <div className="ed-items" role="group" aria-label={label}>
    <ol>{rows.map((r, i) => <li key={i}>
      <span className="ed-items-b" aria-hidden="true" />
      <input ref={(el) => { refs.current[i] = el; }} className="input" value={r} disabled={disabled} maxLength={200} placeholder={i === 0 ? placeholder : 'Another item'} aria-label={`${label}, item ${i + 1}`}
        onChange={(e) => commit(rows.map((x, j) => (j === i ? e.target.value : x)))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (rows.length < max) { focusAt.current = i + 1; commit([...rows.slice(0, i + 1), '', ...rows.slice(i + 1)]); } }
          else if (e.key === 'Backspace' && !r && rows.length > 1) { e.preventDefault(); focusAt.current = Math.max(0, i - 1); commit(rows.filter((_, j) => j !== i)); }
        }} />
      {!disabled && <span className="ed-items-acts">
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => { const n = [...rows]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; commit(n); }}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(-90deg)' }} /></button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move item ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => { const n = [...rows]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; commit(n); }}><Icon n="chev" width={13} height={13} style={{ transform: 'rotate(90deg)' }} /></button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove item ${i + 1}`} onClick={() => commit(rows.filter((_, j) => j !== i))}><Icon n="x" width={13} height={13} /></button>
      </span>}
    </li>)}</ol>
    <div className="ed-items-f">
      {!disabled && rows.length < max && <button type="button" className="btn btn-sm ed-add" onClick={() => { focusAt.current = rows.length; commit([...rows, '']); }}><Icon n="plus" />Add item</button>}
      <span className="muted">{filled} of {max} · Enter adds a line</span>
    </div>
  </div>;
}
