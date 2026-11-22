// Shared editor layout for Studio records (events, opportunities, partners): sticky header with save state, a section
// menu that follows the scroll and marks sections ready, form sections as cards, and a publishing panel with the
// workflow steps and a readiness checklist. Presentation only: saving and workflow stay in each editor.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Icon, Link, LiveBadge } from './ui.tsx';
import './editor.css';

export type SectionDef = { id: string; label: string; icon: string; done?: boolean; optional?: boolean };

export function EditorHeader({ back, title, file, status, live, extra, dirty, actions }: {
  back: { to: string; label: string }; title: string; file?: string; status: string | null; live: boolean; extra?: ReactNode; dirty: boolean; actions: ReactNode;
}) {
  return <div className="ed-head">
    <div className="min-w-0">
      <Link to={back.to} className="ed-back"><Icon n="chev" width={14} height={14} style={{ transform: 'rotate(180deg)' }} />{back.label}</Link>
      <h1>{title || 'Untitled'}</h1>
      <div className="ed-meta">
        {live && status !== 'published' && <LiveBadge />}{status ? <Badge s={status} /> : null}{extra}
        {file && <span className="ed-file"><Icon n="globe" width={12} height={12} />{file}</span>}
        <span className={`ed-save${dirty ? ' dirty' : ''}`} role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
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
/** Publishing panel: where the record stands in the workflow, what is still missing, and the available actions. */
export function WorkflowPanel({ status, live, problems, children, facts }: { status: string; live: boolean; problems: string[]; children: ReactNode; facts?: [string, ReactNode][] }) {
  const at = status === 'changes_requested' ? 0 : Math.max(0, STEPS.findIndex(([k]) => k === status));
  return <aside className="card ed-panel">
    <ol className="ed-steps" aria-label="Workflow">
      {STEPS.map(([k, l], i) => <li key={k} className={`${i < at || (live && k === 'published') ? 'done' : ''}${i === at && status !== 'archived' ? ' now' : ''}`}><span className="ed-step-dot">{i < at || (live && k === 'published') ? '✓' : i + 1}</span><span>{l}</span></li>)}
    </ol>
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
