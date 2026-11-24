// Site pages: Our Story, Mission & Vision, Strategy & Objectives, Our Team, and the texts of the Partners page.
// Listed in Website › Pages (PagesList) and opened at /studio/pages/site/<key>. Every page goes through review
// (draft → in review → approved → published), like any other record.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Icon, Link, Modal, fmtDate, useCan, useMe, useToast } from '../ui.tsx';
import { EditorHeader, Field, Section, SectionNav, WorkflowPanel } from '../Editor.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import '../pillars.css';
import '../about.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Content = Record<string, any>;
type Loaded = { id: string; key: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; verifiedAt: string | null; provenance: string; content: Content | null;
  meta: { title: string; file: string; desc: string }; media: MediaItem[]; problems: string[];
  context: { pillars: { key: string; name: string }[]; objectives: { ref: string; pillarKeys: string[] }[]; groups: { value: string; label: string }[]; publicEmails: string[]; sections: Record<string, Record<string, string | boolean>> };
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] } };

// ---------------------------------------------------------------- small form helpers (paths into the content object)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getAt = (o: Content, path: (string | number)[]): any => path.reduce((x: Content | undefined, k) => (x == null ? undefined : x[k as never]), o);
function setAt(o: Content, path: (string | number)[], v: unknown): Content {
  const n = structuredClone(o); let x: Content = n;
  path.slice(0, -1).forEach((k, i) => { if (x[k as never] == null) (x as Record<string, unknown>)[k as never] = typeof path[i + 1] === 'number' ? [] : {}; x = x[k as never]; });
  (x as Record<string, unknown>)[path[path.length - 1] as never] = v; return n;
}
type Ctx = { f: Content; set: (path: (string | number)[], v: unknown) => void; editable: boolean };

function TextF({ c, path, label, max, rows, hint, span = 3, big }: { c: Ctx; path: (string | number)[]; label: string; max: number; rows?: number; hint?: ReactNode; span?: 1 | 2 | 3; big?: boolean }) {
  const v = String(getAt(c.f, path) ?? '');
  return <Field label={label} span={span} count={[v.length, max]} hint={hint}>
    {rows ? <textarea className="textarea" rows={rows} maxLength={max} value={v} onChange={(e) => c.set(path, e.target.value)} aria-label={label} />
      : <input className={`input${big ? ' input-lg' : ''}`} maxLength={max} value={v} onChange={(e) => c.set(path, e.target.value)} aria-label={label} />}
  </Field>;
}

type FieldSpec = { k: string; label: string; max: number; rows?: number; placeholder?: string; required?: boolean };
/** A repeatable list of small records (milestones, principles, people…): numbered rows that move, and can be removed. */
function Repeat({ c, path, label, noun, max, fields, blank, extra, fixed, head }: {
  c: Ctx; path: (string | number)[]; label: string; noun: string; max: number; fields: FieldSpec[]; blank?: Content;
  extra?: (item: Content, i: number) => ReactNode; fixed?: boolean; head?: (item: Content, i: number) => ReactNode;
}) {
  const items: Content[] = getAt(c.f, path) ?? [];
  const move = (i: number, d: -1 | 1) => { const n = [...items]; [n[i], n[i + d]] = [n[i + d], n[i]]; c.set(path, n); };
  return <div className="field ed-f s3"><span className="ed-lbl">{label}</span>
    {items.length === 0 && <p className="muted" style={{ margin: 0 }}>None yet.</p>}
    {items.length > 0 && <ol className="pl-steps ab-rows">{items.map((it, i) => <li key={i}>
      <span className="pl-step-n">{head ? head(it, i) : String(i + 1).padStart(2, '0')}</span>
      <div className="pl-step-f">
        {fields.map((fs) => {
          const v = String(it[fs.k] ?? ''); const lab = `${noun} ${i + 1}: ${fs.label}`;
          return fs.rows ? <textarea key={fs.k} className="textarea" rows={fs.rows} maxLength={fs.max} value={v} placeholder={fs.placeholder ?? fs.label} onChange={(e) => c.set([...path, i, fs.k], e.target.value)} aria-label={lab} />
            : <input key={fs.k} className="input" maxLength={fs.max} value={v} placeholder={fs.placeholder ?? fs.label} onChange={(e) => c.set([...path, i, fs.k], e.target.value)} aria-label={lab} aria-invalid={fs.required && !v.trim() ? true : undefined} />;
        })}
        {extra?.(it, i)}
      </div>
      {!fixed && <span className="pl-step-a">
        <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${noun.toLowerCase()} ${i + 1} up`}>↑</button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${noun.toLowerCase()} ${i + 1} down`}>↓</button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" onClick={() => c.set(path, items.filter((_, j) => j !== i))} aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`}><Icon n="x" /></button></span>}
    </li>)}</ol>}
    {!fixed && (items.length < max ? <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => c.set(path, [...items, blank ?? Object.fromEntries(fields.map((x) => [x.k, '']))])}><Icon n="plus" />Add {noun.toLowerCase()}</button>
      : <small>{max} is the maximum.</small>)}
  </div>;
}

/** Paragraphs: a list of plain-text blocks. */
function Paras({ c, path, label, max, maxItems, hint }: { c: Ctx; path: (string | number)[]; label: string; max: number; maxItems: number; hint?: ReactNode }) {
  const items: string[] = getAt(c.f, path) ?? [];
  return <div className="field ed-f s3"><span className="ed-lbl">{label}</span>
    <ol className="pl-steps ab-rows">{items.map((p, i) => <li key={i}><span className="pl-step-n">{String(i + 1).padStart(2, '0')}</span>
      <div className="pl-step-f"><textarea className="textarea" rows={3} maxLength={max} value={p} onChange={(e) => c.set([...path, i], e.target.value)} aria-label={`${label}, paragraph ${i + 1}`} /></div>
      <span className="pl-step-a"><button type="button" className="btn btn-ghost icon-btn btn-sm" onClick={() => c.set(path, items.filter((_, j) => j !== i))} aria-label={`Remove paragraph ${i + 1}`}><Icon n="x" /></button></span></li>)}</ol>
    {items.length < maxItems && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => c.set(path, [...items, ''])}><Icon n="plus" />Add a paragraph</button>}
    {hint && <small>{hint}</small>}
  </div>;
}

function Photo({ c, path, media, pick, label, small }: { c: Ctx; path: (string | number)[]; media: Map<string, MediaItem>; pick: (path: (string | number)[]) => void; label: string; small?: boolean }) {
  const id = getAt(c.f, path) as string | null; const m = id ? media.get(id) : undefined;
  if (!id) return <button type="button" className={`ed-drop${small ? ' ab-drop-sm' : ''}`} disabled={!c.editable} onClick={() => pick(path)}><Icon n="image" /><b>{label}</b>{!small && <small>From the media library.</small>}</button>;
  return <div className={`ab-photo${small ? ' is-sm' : ''}`}>
    {m ? <img src={m.url} alt={m.alt} /> : <span className="ab-photo-missing">Photo</span>}
    <span className="ab-photo-meta">
      {m && <span className={m.alt ? 'ok' : 'warn'}><Icon n={m.alt ? 'check' : 'alert'} width={13} height={13} />{m.alt ? 'Alt text' : 'No alt text'}</span>}
      {m && <span className={m.rightsConfirmed ? 'ok' : 'warn'}><Icon n={m.rightsConfirmed ? 'check' : 'alert'} width={13} height={13} />{m.rightsConfirmed ? 'Rights confirmed' : 'Rights not confirmed'}</span>}
      <span className="ab-photo-a"><button type="button" className="btn btn-sm" disabled={!c.editable} onClick={() => pick(path)}>Change</button><button type="button" className="btn btn-sm btn-ghost" disabled={!c.editable} onClick={() => c.set(path, null)}>Remove</button></span>
    </span>
  </div>;
}

// ---------------------------------------------------------------- sections: show/hide, order, headings
const SECTION_FIELDS: [string, string, number, string][] = [
  ['tab', 'Menu label', 40, 'In the sticky menu under the overview.'], ['label', 'Small label', 60, 'Next to the section number.'],
  ['title', 'Heading', 120, 'Written in black.'], ['soft', 'Heading, second part', 120, 'Written in grey. Leave empty for none.'],
  ['meta', 'Note on the right', 60, 'Short note at the end of the label line. Leave empty for none.'], ['desc', 'Description', 400, 'One or two lines beside the heading.'],
  ['sub', 'Sub-heading', 60, 'Small heading inside the section.'], ['sub2', 'Second sub-heading', 60, 'Small heading inside the section.'],
];
function SectionsEditor({ c, defs }: { c: Ctx; defs: Record<string, Record<string, string | boolean>> }) {
  const ids = Object.keys(defs);
  if (!ids.length) return <p className="muted s3" style={{ margin: 0 }}>The site’s section list could not be read.</p>;
  const movable = ids.filter((id) => !defs[id].fixed);
  const saved: string[] = (c.f.order ?? []).filter((x: string) => movable.includes(x));
  const order = [...saved, ...movable.filter((x) => !saved.includes(x))];
  const own = (id: string) => (c.f.sections?.[id] ?? null) as Record<string, string | boolean> | null;
  const val = (id: string, k: string) => (own(id)?.[k] ?? defs[id][k] ?? '') as string;
  const shown = (id: string) => own(id)?.show !== false;
  const base = (id: string) => { const { fixed: _f, ...d } = defs[id]; return { show: true, ...d, ...(own(id) ?? {}) }; };
  const setField = (id: string, k: string, v: string | boolean) => c.set(['sections', id], { ...base(id), [k]: v });
  const move = (i: number, d: -1 | 1) => { const n = [...order]; [n[i], n[i + d]] = [n[i + d], n[i]]; c.set(['order'], n); };
  const row = (id: string, i: number | null) => {
    const fixed = i === null; const on = shown(id); const fields = SECTION_FIELDS.filter(([k]) => k in defs[id]);
    return <li key={id} className={`ab-sec${on ? '' : ' is-off'}`}>
      <div className="ab-sec-h">
        <span className="pl-step-n">{fixed ? '—' : String(i! + 1).padStart(2, '0')}</span>
        <span className="ab-sec-t"><b>{val(id, 'label') || val(id, 'title') || id}</b><small>{fixed ? 'Frames the sections, always shown' : on ? (own(id) ? 'Shown · your text' : 'Shown · built-in text') : 'Hidden on the website'}</small></span>
        {!fixed && <label className="ab-switch"><input type="checkbox" checked={on} onChange={(e) => setField(id, 'show', e.target.checked)} aria-label={`Show ${val(id, 'label') || id}`} /><span>{on ? 'Shown' : 'Hidden'}</span></label>}
        {!fixed && <span className="pl-step-a">
          <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === 0} onClick={() => move(i!, -1)} aria-label={`Move ${id} up`}>↑</button>
          <button type="button" className="btn btn-ghost icon-btn btn-sm" disabled={i === order.length - 1} onClick={() => move(i!, 1)} aria-label={`Move ${id} down`}>↓</button></span>}
      </div>
      {fields.length > 0 && <details className="ab-sec-d"><summary>Edit the section’s texts</summary>
        <div className="ab-sec-f">{fields.map(([k, lab, max, hint]) => <Field key={k} label={lab} span={k === 'desc' ? 3 : k === 'title' || k === 'soft' ? 2 : 1} count={[val(id, k).length, max]} hint={hint}>
          {k === 'desc' ? <textarea className="textarea" rows={2} maxLength={max} value={val(id, k)} onChange={(e) => setField(id, k, e.target.value)} aria-label={`${id}: ${lab}`} />
            : <input className="input" maxLength={max} value={val(id, k)} onChange={(e) => setField(id, k, e.target.value)} aria-label={`${id}: ${lab}`} />}</Field>)}
          {own(id) && <button type="button" className="btn btn-sm btn-ghost s3" style={{ justifySelf: 'start' }} onClick={() => c.set(['sections', id], undefined)}><Icon n="undo" />Reset to built-in text</button>}
        </div></details>}
    </li>;
  };
  return <ol className="ab-secs s3">{ids.filter((id) => defs[id].fixed).map((id) => row(id, null))}{order.map((id, i) => row(id, i))}</ol>;
}

// ---------------------------------------------------------------- the editor
export function AboutEditor({ refKey, onChanged }: { refKey: string; onChanged?: () => void }) {
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [p, setP] = useState<Loaded | null>(null); const [f, setF] = useState<Content | null>(null);
  const [media, setMedia] = useState<Map<string, MediaItem>>(new Map());
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(''); const [errs, setErrs] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'preview' | 'publish' | 'changes'>(null); const [picking, setPicking] = useState<(string | number)[] | null>(null);
  const [url, setUrl] = useState(''); const [comment, setComment] = useState('');
  const load = useCallback(async () => {
    const d = await api<Loaded>(`/about/${refKey}`);
    setP(d); setF(d.content ? structuredClone(d.content) : null); setMedia(new Map(d.media.map((m) => [m.id, m]))); setDirty(false); onChanged?.();
  }, [refKey]);
  useEffect(() => { load().catch((e) => toast(e.message, true)); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  useEffect(() => { const k = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k); }, [dirty]);

  if (!p) return <Loading />;
  if (!f) return <><EditorHeader back={{ to: '/studio/pages', label: 'Pages' }} title={p.meta.title} status="draft" live={false} dirty={false} actions={null} />
    <div className="notice n-info"><div>This page’s content is not in Studio yet. Import it from the <Link to="/studio/pages">Pages</Link> list.</div></div></>;
  const status = p.status; const live = !!p.publishedRevisionId;
  const editable = can('about.update') && status !== 'in_review';
  const c: Ctx = { f, editable, set: (path, v) => { setF((x) => setAt(x!, path, v)); setDirty(true); } };
  function showErr(e: unknown) { setErrs(e instanceof ApiError && e.details?.length ? e.details.map((d) => (d.path ? `${d.path}: ` : '') + d.message) : [e instanceof Error ? e.message : 'Something went wrong.']); }
  async function save(): Promise<boolean> {
    setBusy('save'); setErrs([]);
    try { await put(`/about/${p!.key}`, { content: f, provenance: p!.provenance }); await load(); toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved'); return true; }
    catch (e) { showErr(e); return false; } finally { setBusy(''); }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (dirty && !(await save())) return;
    setBusy(action); setErrs([]);
    try { await post(`/about/${p!.key}/transition`, { action, ...extra }); await load(); setDialog(null); setComment('');
      toast({ submit: 'Sent for review', approve: 'Approved', request_changes: 'Changes requested', withdraw: 'Withdrawn to draft' }[action] ?? 'Done'); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function publish() {
    setBusy('publish');
    try { await post(`/about/${p!.key}/publish`); await load(); setDialog(null); toast(`Published and verified on ${p!.meta.file}`); }
    catch (e) { setDialog(null); showErr(e); } finally { setBusy(''); }
  }
  async function preview() {
    if (dirty && !(await save())) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/about/${p!.key}/preview`); setUrl(r.url); setDialog('preview'); } catch (e) { showErr(e); } finally { setBusy(''); }
  }
  const hero = <Section id="hero" title="Page header" desc="The title at the top of the page: the main part in black, the second part in grey.">
    <TextF c={c} path={['hero', 'title']} label="Title" max={90} span={2} big />
    <TextF c={c} path={['hero', 'soft']} label="Title, second part" max={90} span={1} hint="Optional, written in grey." />
    <p className="pl-title-prev s3" aria-label="Title preview">{f.hero?.title} <span>{f.hero?.soft}</span></p>
    <TextF c={c} path={['hero', 'lead']} label="Line under the title" max={280} rows={2} />
  </Section>;
  const layout = <Section id="layout" title="Sections" desc="Show or hide each section, change their order with the arrows, and edit their headings. Numbers and the menu follow automatically.">
    <SectionsEditor c={c} defs={p.context.sections ?? {}} />
  </Section>;
  const closing = <Section id="closing" title="Closing call to action" desc="The “Get involved” band at the end of the page.">
    <TextF c={c} path={['closing', 'title']} label="Heading" max={90} />
    <TextF c={c} path={['closing', 'text']} label="Text" max={300} rows={2} />
  </Section>;
  const pillarSelect = (it: Content, i: number) => <label className="ab-inline"><span>Links to pillar</span>
    <select className="select" value={it.pillar ?? ''} onChange={(e) => c.set(['areas', i, 'pillar'], e.target.value)} aria-label={`Focus area ${i + 1}: pillar`}>
      <option value="">No link</option>{p.context.pillars.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>;

  let sections: { id: string; label: string; icon: string; done?: boolean; optional?: boolean }[] = [];
  let body: ReactNode = null;
  if (p.key === 'our-story') {
    sections = [{ id: 'hero', label: 'Page header', icon: 'log', done: !!f.hero?.title }, { id: 'layout', label: 'Sections', icon: 'layers', optional: true }, { id: 'intro', label: 'Introduction', icon: 'log', done: !!f.intro }, { id: 'statement', label: 'President’s statement', icon: 'users', optional: true },
      { id: 'journey', label: 'Journey', icon: 'calendar', optional: true }, { id: 'principles', label: 'What makes us different', icon: 'check', optional: true }, { id: 'areas', label: 'What we do', icon: 'pillars', optional: true },
      { id: 'approach', label: 'Approach', icon: 'layers', optional: true }, { id: 'impact', label: 'Impact numbers', icon: 'spark', optional: true }, { id: 'closing', label: 'Closing', icon: 'send', optional: true }];
    body = <>{hero}{layout}
      <Section id="intro" title="Introduction" desc="The black overview at the top of the page, and the panel next to it.">
        <TextF c={c} path={['intro']} label="Introduction" max={700} rows={4} hint="The large text in the black overview." />
        <Paras c={c} path={['paragraphs']} label="In short" max={600} maxItems={4} hint="Shown next to the overview when there is no photo." />
        <Repeat c={c} path={['facts']} label="Key facts" noun="Fact" max={4} fields={[{ k: 'label', label: 'Label', max: 30, placeholder: 'e.g. Founded', required: true }, { k: 'value', label: 'Value', max: 60, required: true }]} />
        <TextF c={c} path={['legalName']} label="Legal name" max={160} span={2} hint="Registration, tax and CNSS numbers are never published." />
        <Field label="Founding year" span={1} hint="Drives the “years of community work” counter."><input className="input" type="number" min={1900} max={2100} value={f.foundedYear ?? ''} onChange={(e) => c.set(['foundedYear'], e.target.value ? Number(e.target.value) : null)} aria-label="Founding year" /></Field>
        <Field label="Photo" span={3} hint="Optional. Replaces the “In short” panel. Shown in black and white."><Photo c={c} path={['mediaId']} media={media} pick={setPicking} label="Choose a photo" /></Field>
      </Section>
      <Section id="statement" title="President’s statement" desc="A signed message, shown after the overview. Leave the text empty to hide the section.">
        <TextF c={c} path={['statement', 'kicker']} label="Small heading" max={80} span={1} />
        <TextF c={c} path={['statement', 'title']} label="Heading" max={140} span={2} />
        <Paras c={c} path={['statement', 'paragraphs']} label="Statement" max={1500} maxItems={5} />
        <TextF c={c} path={['statement', 'name']} label="Name" max={80} span={1} />
        <TextF c={c} path={['statement', 'role']} label="Title shown under the name" max={100} span={2} hint="For example “President of AFCD Foundation”. Never “legal representative”." />
        <Field label="Portrait" span={3} hint="Optional."><Photo c={c} path={['statement', 'mediaId']} media={media} pick={setPicking} label="Choose a portrait" small /></Field>
      </Section>
      <Section id="journey" title="Journey" desc="Milestones in chronological order: a date (or period) and what happened.">
        <Repeat c={c} path={['milestones']} label="Milestones" noun="Milestone" max={20} fields={[{ k: 'when', label: 'Date or period', max: 24, placeholder: 'e.g. 2007 or 2020–21', required: true }, { k: 'title', label: 'Title', max: 90, required: true }, { k: 'text', label: 'What happened', max: 500, rows: 2 }]} />
      </Section>
      <Section id="principles" title="What makes us different" desc="Short principles, shown as numbered rows.">
        <Repeat c={c} path={['principles']} label="Principles" noun="Principle" max={10} fields={[{ k: 'title', label: 'Title', max: 90, required: true }, { k: 'text', label: 'Explanation', max: 500, rows: 2 }]} />
      </Section>
      <Section id="areas" title="What we do" desc="Focus areas, each linked to its pillar page. The list of core activities below them is shared with the pillar pages and edited there.">
        <Repeat c={c} path={['areas']} label="Focus areas" noun="Area" max={8} blank={{ title: '', text: '', pillar: '' }} fields={[{ k: 'title', label: 'Title', max: 90, required: true }, { k: 'text', label: 'Description', max: 700, rows: 3 }]} extra={pillarSelect} />
      </Section>
      <Section id="approach" title="Approach" desc="A short statement and the steps of how AFCD works.">
        <TextF c={c} path={['approach', 'title']} label="Statement" max={60} span={2} /><TextF c={c} path={['approach', 'soft']} label="Statement, second part" max={60} span={1} />
        <Repeat c={c} path={['approach', 'steps']} label="Steps" noun="Step" max={6} fields={[{ k: 'title', label: 'Title', max: 40, required: true }, { k: 'text', label: 'Text', max: 260, rows: 2 }]} />
      </Section>
      <Section id="impact" title="Impact numbers" desc="Only figures AFCD can stand behind. End a value with + to show it as “more than”. The years counter is added automatically from the founding year.">
        <Repeat c={c} path={['stats']} label="Numbers" noun="Number" max={6} fields={[{ k: 'value', label: 'Value', max: 12, placeholder: 'e.g. 2,700', required: true }, { k: 'label', label: 'Label', max: 60, required: true }]} />
      </Section>
      {closing}</>;
  } else if (p.key === 'mission-vision') {
    sections = [{ id: 'hero', label: 'Page header', icon: 'log', done: !!f.hero?.title }, { id: 'layout', label: 'Sections', icon: 'layers', optional: true }, { id: 'mission', label: 'Mission', icon: 'send', done: !!f.mission }, { id: 'values', label: 'Values', icon: 'check', done: (f.values ?? []).length > 0 },
      { id: 'vision', label: 'Vision', icon: 'eye', done: !!f.vision }, { id: 'closing', label: 'Closing', icon: 'send', optional: true }];
    body = <>{hero}{layout}
      <Section id="mission" title="Mission" desc="Step 01 of the path, “Today”: what AFCD does every day."><TextF c={c} path={['mission']} label="Mission" max={600} rows={3} /></Section>
      <Section id="values" title="Values" desc="Step 02, “Every step”: numbered I, II, III…">
        <Repeat c={c} path={['values']} label="Values" noun="Value" max={8} fields={[{ k: 'title', label: 'Name', max: 40, required: true }, { k: 'text', label: 'What it means', max: 320, rows: 2 }]} />
      </Section>
      <Section id="vision" title="Vision" desc="Step 03, “Tomorrow”: the society AFCD works toward. Step 04 links to the strategy page automatically."><TextF c={c} path={['vision']} label="Vision" max={600} rows={3} /></Section>
      {closing}</>;
  } else if (p.key === 'strategy') {
    const pname = (k: string) => p.context.pillars.find((x) => x.key === k)?.name ?? k;
    sections = [{ id: 'hero', label: 'Page header', icon: 'log', done: !!f.hero?.title }, { id: 'layout', label: 'Sections', icon: 'layers', optional: true }, { id: 'objectives', label: 'Objectives', icon: 'check', done: (f.objectives ?? []).every((o: Content) => o.title) },
      { id: 'who', label: 'Who we serve', icon: 'users', optional: true }, { id: 'where', label: 'Where we work', icon: 'pin', optional: true }, { id: 'closing', label: 'Closing', icon: 'send', optional: true }];
    body = <>{hero}{layout}
      <Section id="objectives" title="Strategic objectives" desc="SO-01 to SO-06 are AFCD’s strategic objective records, also linked from projects. Publishing this page updates their wording everywhere.">
        <TextF c={c} path={['objectivesIntro']} label="Introduction" max={420} rows={2} />
        <Repeat c={c} path={['objectives']} label="Objectives" noun="Objective" max={20} fixed head={(it) => it.ref}
          fields={[{ k: 'title', label: 'Objective', max: 180, required: true }, { k: 'text', label: 'Explanation', max: 600, rows: 2 }]}
          extra={(it) => { const keys = p.context.objectives.find((o) => o.ref === it.ref)?.pillarKeys ?? []; return <small className="muted">{keys.length ? `Pillars: ${keys.map(pname).join(', ')}` : 'Cross-cutting, all pillars'}</small>; }} />
      </Section>
      <Section id="who" title="Who we serve" desc="The list of participant groups is shared with the pillar pages; the texts here explain it.">
        <TextF c={c} path={['whoIntro']} label="Introduction" max={320} rows={2} />
        <Paras c={c} path={['summary']} label="In detail" max={1000} maxItems={5} />
      </Section>
      <Section id="where" title="Where we work" desc="Regions and the places in each. The public city is Marrakech; the street address is never published.">
        <Repeat c={c} path={['regions']} label="Regions" noun="Region" max={16} fields={[{ k: 'name', label: 'Region', max: 60, required: true }, { k: 'places', label: 'Places', max: 260 }]} />
        <TextF c={c} path={['coverage']} label="Coverage note" max={1000} rows={4} />
      </Section>
      {closing}</>;
  } else if (p.key === 'team') {
    const people: Content[] = f.people ?? [];
    sections = [{ id: 'hero', label: 'Page header', icon: 'log', done: !!f.hero?.title }, { id: 'layout', label: 'Sections', icon: 'layers', optional: true }, { id: 'intro', label: 'Introduction', icon: 'log', done: !!f.intro },
      { id: 'people', label: `People (${people.length})`, icon: 'users', optional: true }, { id: 'closing', label: 'Closing', icon: 'send', optional: true }];
    body = <>{hero}{layout}
      <Section id="intro" title="Introduction" desc="The large text in the black overview."><TextF c={c} path={['intro']} label="Introduction" max={700} rows={4} /></Section>
      <Section id="people" title="People" desc="Grouped on the page in this order: board, executive team, staff, volunteers. Within a group, the order below is kept. Without people the page says profiles are not published yet.">
        <Repeat c={c} path={['people']} label="People" noun="Person" max={120} blank={{ name: '', role: '', group: 'executive', bio: '', mediaId: null }}
          fields={[{ k: 'name', label: 'Full name', max: 80, required: true }, { k: 'role', label: 'Role', max: 100, placeholder: 'Role, e.g. Programme coordinator', required: true }, { k: 'bio', label: 'Short bio (optional)', max: 700, rows: 2 }]}
          extra={(it, i) => <div className="ab-person">
            <label className="ab-inline"><span>Group</span><select className="select" value={it.group} onChange={(e) => c.set(['people', i, 'group'], e.target.value)} aria-label={`Person ${i + 1}: group`}>{p.context.groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
            <Photo c={c} path={['people', i, 'mediaId']} media={media} pick={setPicking} label="Portrait" small />
          </div>} />
        <small className="muted">Only add people who agreed to appear on the website, with their portrait’s usage rights confirmed in the media library.</small>
      </Section>
      {closing}</>;
  } else {
    sections = [{ id: 'hero', label: 'Page header', icon: 'log', done: !!f.hero?.title }, { id: 'layout', label: 'Sections', icon: 'layers', optional: true }, { id: 'directory', label: 'Directory', icon: 'partner', optional: true }, { id: 'models', label: 'Ways to partner', icon: 'layers', optional: true },
      { id: 'steps', label: 'How it starts', icon: 'send', optional: true }, { id: 'closing', label: 'Closing', icon: 'send', optional: true }];
    body = <>{hero}{layout}
      <Section id="directory" title="Partner directory" desc="The organisations, their logos and descriptions are Partner records: edit them in Partners.">
        <TextF c={c} path={['directoryIntro']} label="Line above the directory" max={260} rows={2} />
        <p className="s3" style={{ margin: 0 }}><Link className="btn btn-sm" to="/studio/partners"><Icon n="partner" />Open Partners</Link></p>
      </Section>
      <Section id="models" title="Ways to partner"><Repeat c={c} path={['models']} label="Partnership models" noun="Model" max={6} fields={[{ k: 'title', label: 'Title', max: 40, required: true }, { k: 'text', label: 'Text', max: 320, rows: 2 }]} /></Section>
      <Section id="steps" title="How it starts"><Repeat c={c} path={['steps']} label="Steps" noun="Step" max={6} fields={[{ k: 'title', label: 'Title', max: 80, required: true }, { k: 'text', label: 'Text', max: 320, rows: 2 }]} /></Section>
      {closing}</>;
  }

  return <>
    <EditorHeader back={{ to: '/studio/pages', label: 'Pages' }} title={p.meta.title} file={p.meta.file} status={status} live={live} dirty={dirty}
      actions={<>
        <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building…' : 'Preview'}</button>
        {editable && dirty && <button className="btn btn-primary" onClick={save} disabled={!!busy} title="Save (⌘S)"><Icon n="save" />{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {!dirty && ['draft', 'changes_requested'].includes(status) && can('about.update') && <button className="btn btn-primary" disabled={!!busy || p.problems.length > 0} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {!dirty && status === 'approved' && can('about.publish') && <button className="btn btn-primary" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish…</button>}
      </>} />
    {errs.length > 0 && <div className="notice n-warn" role="alert"><div><ul style={{ margin: 0 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div><button className="btn btn-ghost icon-btn btn-sm" onClick={() => setErrs([])} aria-label="Dismiss"><Icon n="x" /></button></div>}
    {status === 'in_review' && can('about.update') && <div className="notice n-info"><div>In review: read-only. Withdraw it to edit.</div></div>}
    <div className="ed-layout">
      <SectionNav sections={sections} />
      <div className="ed-col"><fieldset className="ed-main" disabled={!editable}>{body}
        <Section id="internal" title="Internal" desc="Not shown on the website.">
          <Field label="Source" span={3} hint="Where this content comes from."><input className="input" maxLength={300} value={p.provenance} onChange={(e) => { setP({ ...p, provenance: e.target.value }); setDirty(true); }} aria-label="Source" /></Field>
        </Section>
      </fieldset></div>
      <WorkflowPanel status={status} live={live} problems={p.problems}
        facts={[['Website', live ? `Live${status !== 'published' ? ' · newer draft' : ''}` : 'Not from Studio yet'], ['Page', p.meta.file], ...(p.publishedAt ? [['Published', fmtDate(p.publishedAt)] as [string, string]] : [])]}>
        {live && <a className="btn btn-sm" href={me.siteUrl + p.meta.file} target="_blank" rel="noopener"><Icon n="ext" />Open the page</a>}
        {['draft', 'changes_requested'].includes(status) && can('about.update') && <button className="btn btn-primary" disabled={!!busy || dirty} onClick={() => act('submit')}><Icon n="send" />Submit for review</button>}
        {status === 'in_review' && can('about.approve') && <><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve')}><Icon n="check" />Approve</button><button className="btn" onClick={() => setDialog('changes')}>Request changes</button></>}
        {status === 'approved' && can('about.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish</button>}
        {['in_review', 'approved'].includes(status) && can('about.update') && <button className="btn btn-ghost" onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
        {(p.history.revisions.length > 0 || p.history.comments.some((x) => x.body)) && <details className="ed-history"><summary>History</summary>
          <ol className="timeline">{p.history.revisions.slice(0, 8).map((r) => <li key={r.id}><b>Revision {r.number} · {r.reason}{r.id === p.publishedRevisionId ? ' · live' : ''}</b><small>{fmtDate(r.createdAt)}</small>
            {editable && r.id !== p.history.revisions[0]?.id && <button className="btn btn-sm btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={async () => { if (confirm(`Copy revision ${r.number} into the draft?`)) { await post(`/about/${p.key}/revisions/${r.id}/restore`); await load(); toast('Revision restored as a draft'); } }}>Restore this version</button>}</li>)}
            {p.history.comments.filter((x) => x.body).slice(0, 5).map((x) => <li key={x.id}><b>{x.kind.replace('_', ' ')}</b><q>{x.body}</q><small>{fmtDate(x.createdAt)}</small></li>)}</ol></details>}
      </WorkflowPanel>
    </div>
    {picking && <MediaPicker onClose={() => setPicking(null)} onPick={(m) => { if (m[0]) { setMedia((x) => new Map(x).set(m[0].id, m[0])); c.set(picking, m[0].id); } setPicking(null); }} />}
    {dialog === 'preview' && <Modal wide title={`Preview · ${p.meta.file} with this draft`} onClose={() => setDialog(null)}><div className="preview-wrap"><iframe title="Page preview" src={url} style={{ width: Math.min(1280, window.innerWidth - 80) }} /></div></Modal>}
    {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim()} onClick={() => act('request_changes', { comment })}>Send to author</button></>}><div className="modal-b"><textarea className="textarea" autoFocus aria-label="What needs to change" value={comment} onChange={(e) => setComment(e.target.value)} /></div></Modal>}
    {dialog === 'publish' && <Modal size="sm" title={`Publish ${p.meta.title}?`} onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={publish}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish'}</button></>}>
      <div className="modal-b"><p style={{ margin: 0 }}>Rebuilds <span className="mono">{p.meta.file}</span>{p.key === 'our-story' ? ' and the About hub' : ''}{p.key === 'strategy' ? ', updates the wording of the strategic objectives everywhere,' : ''} and checks the result. Pushing to the hosted site is a separate, authorized step.</p></div></Modal>}
  </>;
}
