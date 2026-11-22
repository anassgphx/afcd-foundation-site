// Project workspace: tabs for content, an inspector with status, readiness, workflow actions and history.
import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import '../project-editor.css';

type Pillar = { key: string; name: string; colour: string; number: string };
type Objective = { ref: string; title: string; pillarKeys: string[] };
type Form = {
  name: string; slug: string; reference: string; category: string; summary: string; location: string; years: string;
  extraFacts: { label: string; value: string }[]; context: string; approach: string; activities: string; results: string;
  hasDetailPage: boolean; photoCaption: string; heroMediaId: string | null; galleryMediaIds: string[];
  pillarKeys: string[]; primaryPillarKey: string; objectiveRefs: string[]; seoTitle: string; seoDescription: string; sort: number;
};
type Loaded = Form & {
  id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; approvedRevisionId: string | null; updatedAt: string;
  hero: MediaItem | null; gallery: MediaItem[]; problems: string[]; pillars: { key: string; isPrimary: boolean }[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] };
};

const EMPTY: Form = {
  name: '', slug: '', reference: '', category: '', summary: '', location: '', years: '', extraFacts: [], context: '', approach: '', activities: '', results: '',
  hasDetailPage: true, photoCaption: '', heroMediaId: null, galleryMediaIds: [], pillarKeys: [], primaryPillarKey: '', objectiveRefs: [], seoTitle: '', seoDescription: '', sort: 100,
};
const TABS = ['Overview', 'Content', 'Relationships', 'Media', 'SEO', 'Translations'] as const;
const TAB_FIELDS: Record<string, string[]> = {
  Overview: ['name', 'slug', 'reference', 'category', 'summary', 'location', 'years', 'extraFacts', 'sort'],
  Content: ['context', 'approach', 'activities', 'results'],
  Relationships: ['pillarKeys', 'primaryPillarKey', 'objectiveRefs'],
  Media: ['heroMediaId', 'galleryMediaIds', 'photoCaption'],
  SEO: ['seoTitle', 'seoDescription'],
  Translations: [],
};
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export function ProjectEditor({ id }: { id: string }) {
  const isNew = id === 'new';
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [media, setMedia] = useState<Record<string, MediaItem>>({});
  const [pillars, setPillars] = useState<Pillar[]>([]); const [objectives, setObjectives] = useState<Objective[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [errors, setErrors] = useState<Record<string, string>>({}); const [banner, setBanner] = useState<{ kind: string; text: ReactNode } | null>(null);
  const [busy, setBusy] = useState(''); const [dirty, setDirty] = useState(false); const [slugTouched, setSlugTouched] = useState(!isNew);
  const [dialog, setDialog] = useState<null | 'publish' | 'unpublish' | 'changes' | 'approve' | 'preview' | 'hero' | 'gallery'>(null);
  const [previewUrl, setPreviewUrl] = useState(''); const [comment, setComment] = useState('');
  const [changed, setChanged] = useState<Set<string>>(new Set());   // fields edited since the last save (tab dots)
  const [categories, setCategories] = useState<string[]>([]);       // categories already used by projects (suggestions)
  const [copied, setCopied] = useState(false);
  useEffect(() => { api<{ category: string | null }[]>('/projects').then((r) => setCategories([...new Set(r.map((x) => (x.category ?? '').trim()).filter(Boolean))].sort())).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const [p, o] = await Promise.all([api<Pillar[]>('/pillars'), api<Objective[]>('/objectives')]);
    setPillars(p); setObjectives(o);
    if (isNew) return;
    const d = await api<Loaded>(`/projects/${id}`);
    const primary = d.pillars.find((x) => x.isPrimary)?.key ?? d.pillars[0]?.key ?? '';
    setData(d);
    setForm({ ...pick(d), pillarKeys: d.pillars.map((x) => x.key), primaryPillarKey: primary, galleryMediaIds: d.gallery.map((g) => g.id) });
    setMedia(Object.fromEntries([d.hero, ...d.gallery].filter(Boolean).map((m) => [m!.id, m!])));
    setDirty(false); setChanged(new Set());
  }, [id, isNew]);
  useEffect(() => { load().catch((e) => setBanner({ kind: 'n-bad', text: e.message })); }, [load]);
  useEffect(() => { const f = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, [dirty]);

  const status = data?.status ?? 'draft';
  const live = !!data?.publishedRevisionId;
  const locked = status === 'in_review' || status === 'archived';
  const seoOnly = !can('project.update') && can('project.seo');
  const editable = !locked && (isNew ? can('project.create') : can('project.update') || seoOnly);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => { const n = { ...f, [k]: v }; if (k === 'name' && !slugTouched) n.slug = slugify(String(v)); return n; });
    setDirty(true); setErrors((e) => ({ ...e, [k]: '' })); setChanged((c) => (c.has(k) ? c : new Set(c).add(k)));
  };

  function showError(e: unknown) {
    if (e instanceof ApiError && e.details?.length) {
      const map: Record<string, string> = {};
      for (const d of e.details) if (d.path) map[d.path.split('.')[0]] = d.message;
      setErrors(map);
      const firstTab = TABS.find((t) => TAB_FIELDS[t].some((f) => map[f]));
      if (firstTab) setTab(firstTab);
      const general = e.details.filter((d) => !d.path).map((d) => d.message);
      setBanner({ kind: 'n-bad', text: <>{e.message}{general.length > 0 && <ul>{general.map((g) => <li key={g}>{g}</li>)}</ul>}</> });
    } else setBanner({ kind: 'n-bad', text: e instanceof Error ? e.message : 'Something went wrong.' });
  }

  async function save(quiet = false): Promise<string | null> {
    setBusy('save'); setBanner(null); setErrors({});
    try {
      if (isNew) {
        const p = await post<{ id: string }>('/projects', form);
        setDirty(false); toast('Draft created'); navigate(`/studio/projects/${p.id}`); return p.id;
      }
      await put(`/projects/${id}`, form);
      await load(); if (!quiet) toast(live ? 'Draft saved. The live page is unchanged until you publish.' : 'Draft saved');
      return id;
    } catch (e) { showError(e); return null; } finally { setBusy(''); }
  }

  async function act(action: string, body?: { comment?: string }) {
    if (dirty && !(await save(true))) return;
    setBusy(action); setBanner(null);
    try {
      await post(`/projects/${id}/transition`, { action, comment: body?.comment ?? '' });
      await load();
      toast({ submit: 'Sent for review', withdraw: 'Withdrawn to draft', approve: 'Approved. Ready to publish.', request_changes: 'Changes requested', archive: 'Archived', restore: 'Restored as a draft' }[action] ?? 'Done');
      setDialog(null); setComment('');
    } catch (e) { showError(e); setDialog(null); } finally { setBusy(''); }
  }

  async function publish(kind: 'publish' | 'unpublish') {
    setBusy(kind); setBanner(null);
    try {
      await post(`/projects/${id}/${kind}`);
      await load(); setDialog(null);
      setBanner({ kind: 'n-ok', text: kind === 'publish' ? <>Published and verified on the website. <a href={me.siteUrl + `project-${form.slug}.html`} target="_blank" rel="noopener">Open the live page</a></> : 'Removed from the website. The project is now a draft.' });
    } catch (e) { setDialog(null); showError(e); } finally { setBusy(''); }
  }

  async function preview() {
    if (dirty && !(await save(true))) return;
    setBusy('preview');
    try { const r = await post<{ url: string }>(`/projects/${id}/preview`); setPreviewUrl(r.url); setDialog('preview'); }
    catch (e) { showError(e); } finally { setBusy(''); }
  }

  async function restore(revId: string, n: number) {
    if (!confirm(`Copy revision ${n} into the draft? The live page will not change until it is approved and published again.`)) return;
    try { await post(`/projects/${id}/revisions/${revId}/restore`); await load(); toast(`Revision ${n} restored as a draft`); } catch (e) { showError(e); }
  }

  // ⌘S / Ctrl+S saves the draft
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => { if (editable && (dirty || isNew) && !busy) save(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  // leaving with unsaved changes: links inside Studio ask first (the browser itself asks on reload or close)
  useEffect(() => {
    if (!dirty) return;
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || !a.getAttribute('href')?.startsWith('/studio')) return;
      if (!confirm('You have unsaved changes. Leave without saving?')) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', click, true); return () => document.removeEventListener('click', click, true);
  }, [dirty]);
  const [more, setMore] = useState(false); const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const c = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMore(false); (moreRef.current?.querySelector('button') as HTMLButtonElement | null)?.focus(); } };
    document.addEventListener('mousedown', c); document.addEventListener('keydown', k);
    requestAnimationFrame(() => (moreRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus());
    return () => { document.removeEventListener('mousedown', c); document.removeEventListener('keydown', k); };
  }, [more]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!isNew && !data && !banner) return <Loading />;
  const ro = !editable || seoOnly;
  const fileName = form.hasDetailPage ? `project-${form.slug || 'your-project'}.html` : null;
  const liveUrl = live && fileName ? me.siteUrl + fileName : null;
  const fullUrl = me.siteUrl + `project-${form.slug || 'your-project'}.html`;
  const errCount = (t: string) => TAB_FIELDS[t].filter((f) => errors[f]).length;
  const tabChanged = (t: string) => TAB_FIELDS[t].some((f) => changed.has(f));
  const errorList = Object.entries(errors).filter(([, v]) => v);
  const goTo = (field: string) => { const t = TABS.find((x) => TAB_FIELDS[x].includes(field)); if (t) setTab(t); setTimeout(() => document.getElementById(`pe-${field}`)?.focus(), 40); };
  const leave = (to: string) => { if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return; navigate(to); };
  const yearsOk = !form.years.trim() || /^(19|20)\d{2}(\s*[–—-]\s*((19|20)\d{2}|present|today|ongoing))?$/i.test(form.years.trim());

  // the next step in the workflow, shown in the header when there is nothing to save
  type Next = { key: string; label: string; icon: string; run: () => void };
  const next: Next | null = isNew ? null
    : ['draft', 'changes_requested'].includes(status) && can('project.update') ? { key: 'submit', label: 'Submit for review', icon: 'send', run: () => act('submit') }
    : status === 'in_review' && can('project.approve') ? { key: 'approve', label: 'Approve', icon: 'check', run: () => setDialog('approve') }
    : status === 'approved' && can('project.publish') ? { key: 'publish', label: live ? 'Publish changes' : 'Publish to website', icon: 'rocket', run: () => setDialog('publish') }
    : null;
  type MoreItem = { key: string; label: string; icon: string; run: () => void; danger?: boolean; href?: string };
  const moreItems = ([
    !isNew && { key: 'preview', label: 'Preview', icon: 'eye', run: preview },
    liveUrl && { key: 'open', label: 'Open live page', icon: 'ext', run: () => {}, href: liveUrl },
    status === 'in_review' && can('project.review') && { key: 'changes', label: 'Request changes', icon: 'undo', run: () => setDialog('changes') },
    ['in_review', 'approved'].includes(status) && can('project.update') && { key: 'withdraw', label: 'Withdraw to draft', icon: 'undo', run: () => act('withdraw') },
    status === 'archived' && can('project.archive') && { key: 'restore', label: 'Restore as draft', icon: 'undo', run: () => act('restore') },
    !live && !isNew && status !== 'archived' && can('project.archive') && { key: 'archive', label: 'Archive', icon: 'archive', run: () => { if (confirm('Archive this project? It stays in Studio and can be restored.')) act('archive'); } },
    live && can('project.publish') && { key: 'unpublish', label: 'Remove from website…', icon: 'x', danger: true, run: () => setDialog('unpublish') },
  ].filter(Boolean)) as MoreItem[];

  const saveState = isNew ? <span className="pe-state">Not saved yet</span>
    : busy === 'save' ? <span className="pe-state">Saving…</span>
    : dirty ? <span className="pe-state is-dirty"><i aria-hidden="true" />Unsaved changes</span>
    : <span className="pe-state is-clean"><Icon n="check" />All changes saved{data ? <span className="pe-hide-sm"> · {ago(data.updatedAt)}</span> : null}</span>;

  const tabKey = (e: ReactKeyboardEvent) => {
    const i = TABS.indexOf(tab); let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = TABS.length - 1;
    if (j >= 0) { e.preventDefault(); setTab(TABS[j]); tabRefs.current[j]?.focus(); }
  };
  const moreKey = (e: ReactKeyboardEvent) => {
    const list = [...(moreRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]; const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
  };
  const moveFact = (i: number, d: number) => { const a = [...form.extraFacts]; [a[i], a[i + d]] = [a[i + d], a[i]]; set('extraFacts', a); };

  return (
    <div className="pe">
      <div className="actionbar pe-head">
        <button className="btn btn-ghost icon-btn" onClick={() => leave('/studio/projects')} aria-label="Back to projects"><Icon n="chev" style={{ transform: 'rotate(180deg)' }} /></button>
        <div className="pe-title"><h1>{form.name || 'New project'}</h1>{!isNew && <span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} /></span>}</div>
        <span className="pe-state-wrap" aria-live="polite">{saveState}</span>
        <span className="spacer" />
        {!isNew && <button className="btn pe-hide-sm" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building preview…' : 'Preview'}</button>}
        {editable && (dirty || isNew) && <button className="btn btn-primary" onClick={() => save()} disabled={!!busy} title={`Save (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}S)`}><Icon n="save" />{busy === 'save' ? 'Saving…' : isNew ? 'Create draft' : 'Save draft'}</button>}
        {!dirty && next && <button className="btn btn-primary" onClick={next.run} disabled={!!busy}><Icon n={next.icon} />{busy === next.key ? 'Working…' : next.label}</button>}
        {moreItems.length > 0 && <div className="pe-more" ref={moreRef} onKeyDown={moreKey}>
          <button className="btn icon-btn" aria-haspopup="menu" aria-expanded={more} aria-label="More actions" onClick={() => setMore(!more)}><span aria-hidden="true" className="pe-dots">⋯</span></button>
          {more && <div className="pe-menu" role="menu" aria-label="More actions">{moreItems.map((m, i) => <span key={m.key}>
            {m.danger && i > 0 && <span className="pe-menu-sep" role="separator" />}
            {m.href ? <a role="menuitem" tabIndex={-1} className="pe-menu-item" href={m.href} target="_blank" rel="noopener" onClick={() => setMore(false)}><Icon n={m.icon} />{m.label}</a>
              : <button role="menuitem" tabIndex={-1} className={`pe-menu-item${m.danger ? ' danger' : ''}${m.key === 'preview' ? ' pe-show-sm' : ''}`} disabled={!!busy} onClick={() => { setMore(false); m.run(); }}><Icon n={m.icon} />{m.label}</button>}
          </span>)}</div>}
        </div>}
      </div>

      {errorList.length > 0 && <div className="notice n-bad pe-errors" role="alert"><div><b>{errorList.length === 1 ? '1 field needs' : `${errorList.length} fields need`} attention before saving</b>
        <ul>{errorList.map(([f, m]) => <li key={f}><button type="button" className="pe-link" onClick={() => goTo(f)}>{LABELS[f] ?? f}</button> · {m}</li>)}</ul></div></div>}
      {banner && !(banner.kind === 'n-bad' && errorList.length) && <div className={`notice ${banner.kind}`} style={{ marginBottom: 14 }} role="alert"><div>{banner.text}</div></div>}

      <div className="editor pe-body">
        <section className="card pe-main">
          <div className="tabs pe-tabs" role="tablist" aria-label="Project sections" onKeyDown={tabKey}>{TABS.map((t, i) => { const n = errCount(t); return (
            <button key={t} ref={(el) => { tabRefs.current[i] = el; }} id={`pe-tab-${i}`} role="tab" aria-controls="pe-panel" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t}{n > 0 ? <span className="pe-tab-err" aria-label={`, ${n} error${n === 1 ? '' : 's'}`}>{n}</span> : tabChanged(t) ? <span className="pe-tab-dot" title="Unsaved changes in this tab"><span className="sr-only">, unsaved changes</span></span> : null}
            </button>); })}</div>
          <div id="pe-panel" role="tabpanel" aria-labelledby={`pe-tab-${TABS.indexOf(tab)}`}>
          {locked && <div className="notice n-info" style={{ margin: '14px 18px 0' }}>{status === 'in_review' ? 'This project is in review, so it is read-only. Withdraw it to make changes.' : 'This project is archived. Restore it to edit.'}</div>}
          {seoOnly && <div className="notice n-info" style={{ margin: '14px 18px 0' }}>Your role can edit the SEO tab only.</div>}
          {tab === 'Translations' && <div className="form"><RecordTranslations noun="project" dirty={status !== 'published'} files={form.hasDetailPage && form.slug ? [`project-${form.slug}.html`] : []}
            fields={[{ label: 'Project name', value: form.name }, { label: 'One-line summary', value: form.summary }, { label: 'Category', value: form.category }, { label: 'Location', value: form.location }, { label: 'Years', value: form.years },
              ...form.extraFacts.flatMap((x) => [{ label: 'Fact label', value: x.label }, { label: `Fact · ${x.label || 'value'}`, value: x.value }]),
              { label: 'Context', value: form.context }, { label: 'Approach', value: form.approach }, { label: 'Activities', value: form.activities }, { label: 'Results', value: form.results },
              { label: 'Photo caption', value: form.photoCaption }, { label: 'SEO title', value: form.seoTitle }, { label: 'Meta description', value: form.seoDescription }]} /></div>}
          <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {tab === 'Overview' && <div className="pe-form">
              <PeSection title="Basics" desc="How the project is named and introduced on cards, listings and its page.">
                <Field name="name" label="Project name" err={errors.name}><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={160} disabled={ro} /></Field>
                <Field name="summary" label="One-line summary" hint="Shown on project cards, the listing and as the page intro." err={errors.summary} count={[form.summary.length, 400]}>
                  <textarea className="textarea" style={{ minHeight: 64 }} value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={400} disabled={ro} />
                </Field>
                <div className="row">
                  <Field name="category" label="Category" hint={categories.length ? 'Pick one already in use, or type a new one.' : 'e.g. Youth Leadership, Climate Action'} err={errors.category}>
                    <input className="input" list="pe-categories" value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={80} disabled={ro} />
                  </Field>
                  <Field name="reference" label="Internal reference" optional hint="Only visible in Studio." err={errors.reference}><input className="input" value={form.reference} onChange={(e) => set('reference', e.target.value)} maxLength={40} disabled={ro} /></Field>
                </div>
                <datalist id="pe-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </PeSection>

              <PeSection title="Details" desc="Shown in the facts bar on the project page.">
                <div className="row">
                  <Field name="location" label="Location" optional err={errors.location}><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={120} disabled={ro} placeholder="e.g. Ait Ourir" /></Field>
                  <Field name="years" label="Years" optional hint={yearsOk ? 'A year, or a range like 2020 – 2021.' : undefined} warn={yearsOk ? undefined : 'This doesn’t look like a year or a range (e.g. 2020 – 2021).'} err={errors.years}>
                    <input className="input" value={form.years} onChange={(e) => set('years', e.target.value)} maxLength={60} disabled={ro} placeholder="e.g. 2020 – 2021" inputMode="numeric" />
                  </Field>
                </div>
                <Field group name="extraFacts" label="Extra facts" optional hint="Short label and value pairs, e.g. “Participants · 120”." aside={<span className="count-hint">{form.extraFacts.length} of 4</span>} err={errors.extraFacts}>
                  <div className="pe-facts">
                    {form.extraFacts.map((f, i) => (
                      <div key={i} className="pe-fact">
                        <span className="pe-fact-n" aria-hidden="true">{i + 1}</span>
                        <input className="input" aria-label={`Fact ${i + 1} label`} placeholder="Label, e.g. Participants" value={f.label} maxLength={40} disabled={ro} onChange={(e) => set('extraFacts', form.extraFacts.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                        <input className="input" aria-label={`Fact ${i + 1} value`} placeholder="Value, e.g. 120" value={f.value} maxLength={120} disabled={ro} onChange={(e) => set('extraFacts', form.extraFacts.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                        {!ro && <span className="pe-fact-tools">
                          <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move fact ${i + 1} up`} disabled={i === 0} onClick={() => moveFact(i, -1)}><Icon n="chev" style={{ transform: 'rotate(-90deg)' }} /></button>
                          <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move fact ${i + 1} down`} disabled={i === form.extraFacts.length - 1} onClick={() => moveFact(i, 1)}><Icon n="chev" style={{ transform: 'rotate(90deg)' }} /></button>
                          <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove fact ${i + 1}`} onClick={() => set('extraFacts', form.extraFacts.filter((_, j) => j !== i))}><Icon n="x" /></button>
                        </span>}
                      </div>))}
                    {form.extraFacts.length === 0 && <p className="pe-empty">No extra facts.</p>}
                    {form.extraFacts.length < 4 && !ro && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => set('extraFacts', [...form.extraFacts, { label: '', value: '' }])}><Icon n="plus" />Add fact</button>}
                  </div>
                </Field>
              </PeSection>

              <PeSection title="Page" desc="Whether the project has its own page, and where it sits in listings.">
                <label className="check pe-toggle"><input type="checkbox" checked={form.hasDetailPage} onChange={(e) => set('hasDetailPage', e.target.checked)} disabled={ro} /><span><b>Give this project its own page</b><small>Off: the project only appears in listings and on pillar pages.</small></span></label>
                <div className="row pe-row-page">
                  <Field name="slug" label="Page address" hint={live ? 'The address of a live page can’t change here.' : 'Lower-case letters, numbers and hyphens.'} err={errors.slug}>
                    <div className="pe-slug"><span className="mono">project-</span><input id="pe-slug" className="input mono" aria-label="Page address" value={form.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} disabled={ro || live || !form.hasDetailPage} aria-invalid={!!errors.slug} /><span className="mono">.html</span>
                      {form.hasDetailPage && form.slug && <button type="button" className="btn btn-sm btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(fullUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard unavailable */ } }}>{copied ? <><Icon n="check" />Copied</> : 'Copy URL'}</button>}
                    </div>
                  </Field>
                  <Field name="sort" label="Order in listings" hint="Lower numbers come first." err={errors.sort}><input className="input" type="number" min={0} max={10000} value={form.sort} onChange={(e) => set('sort', Number(e.target.value))} disabled={ro} /></Field>
                </div>
                {liveUrl && <a className="pe-url" href={liveUrl} target="_blank" rel="noopener"><Icon n="globe" />{liveUrl}<Icon n="ext" /></a>}
              </PeSection>
            </div>}

            {tab === 'Content' && <div className="form">
              {!form.hasDetailPage && <div className="notice n-warn">These sections appear on the project page. Turn on “Give this project its own page” in Overview to publish them.</div>}
              {([['context', 'Context', 'What need or situation did the project respond to?'], ['approach', 'Approach', 'How did AFCD and its partners work?'], ['activities', 'Activities', 'What actually happened?'], ['results', 'Results', 'What changed? Use verified facts only.']] as const).map(([k, l, h]) => (
                <Field key={k} name={k} label={l} hint={h} err={errors[k]} count={[form[k].length, 2000]}><textarea className="textarea" value={form[k]} onChange={(e) => set(k, e.target.value)} maxLength={2000} disabled={ro} /></Field>
              ))}
            </div>}

            {tab === 'Relationships' && <div className="form">
              <Field group name="pillarKeys" label="Strategic pillars" hint="Tick every pillar the project serves, then choose the primary one. The project appears on each linked pillar page." err={errors.pillarKeys || errors.primaryPillarKey}>
                <div className="choice-grid">
                  {pillars.map((p) => { const on = form.pillarKeys.includes(p.key); return (
                    <div key={p.key} className={`choice${on ? ' on' : ''}`}>
                      <input type="checkbox" id={`pl-${p.key}`} checked={on} disabled={ro} onChange={(e) => {
                        const keys = e.target.checked ? [...form.pillarKeys, p.key] : form.pillarKeys.filter((k) => k !== p.key);
                        set('pillarKeys', keys);
                        if (!keys.includes(form.primaryPillarKey)) set('primaryPillarKey', keys[0] ?? '');
                      }} />
                      <label htmlFor={`pl-${p.key}`} style={{ flex: 1, cursor: 'pointer' }}><b><span className="dot" style={{ ['--c' as string]: p.colour, marginRight: 6 }} />{p.name}</b><small>Pillar {p.number}</small></label>
                      {on && <label className="check" style={{ fontSize: 12 }}><input type="radio" name="primary" checked={form.primaryPillarKey === p.key} disabled={ro} onChange={() => set('primaryPillarKey', p.key)} />Primary</label>}
                    </div>); })}
                </div>
              </Field>
              <Field group name="objectiveRefs" label="Strategic objectives" optional hint="Shown on the project page. If none are chosen, the objectives of the primary pillar are shown.">
                <div className="choice-grid">
                  {objectives.map((o) => { const on = form.objectiveRefs.includes(o.ref); const suggested = o.pillarKeys.some((k) => form.pillarKeys.includes(k)); return (
                    <label key={o.ref} className={`choice${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={ro} onChange={(e) => set('objectiveRefs', e.target.checked ? [...form.objectiveRefs, o.ref] : form.objectiveRefs.filter((r) => r !== o.ref))} />
                      <span><b>{o.ref}{suggested && <span className="pill" style={{ marginLeft: 6 }}>Matches pillar</span>}</b><small>{o.title}</small></span>
                    </label>); })}
                </div>
              </Field>
            </div>}

            {tab === 'Media' && <div className="form">
              <Field group name="heroMediaId" label="Hero photo" optional hint="Shown full width at the top of the project page. Needs alt text and confirmed rights before publishing." err={errors.heroMediaId}>
                {form.heroMediaId && media[form.heroMediaId] ? (
                  <div className="thumbs"><div className="thumb" style={{ width: 260 }}><img src={media[form.heroMediaId].url} alt={media[form.heroMediaId].alt} />{!ro && <button type="button" aria-label="Remove hero photo" onClick={() => set('heroMediaId', null)}>×</button>}</div></div>
                ) : <div className="muted">No hero photo. A grey placeholder is shown.</div>}
                {!ro && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('hero')}><Icon n="image" />{form.heroMediaId ? 'Change' : 'Choose'} hero photo</button>}
              </Field>
              <Field name="photoCaption" label="Placeholder caption" optional hint="Shown on the grey placeholder while there is no hero photo."><input className="input" value={form.photoCaption} onChange={(e) => set('photoCaption', e.target.value)} maxLength={160} disabled={ro} /></Field>
              <Field group name="galleryMediaIds" label="Gallery" optional hint="The first three photos appear in the gallery section of the page.">
                <div className="thumbs">{form.galleryMediaIds.map((mid, i) => media[mid] && (
                  <div key={mid} className="thumb"><img src={media[mid].url} alt={media[mid].alt} />
                    {!ro && <><button type="button" aria-label="Remove from gallery" onClick={() => set('galleryMediaIds', form.galleryMediaIds.filter((x) => x !== mid))}>×</button>
                      <span className="mv">{i > 0 && <button type="button" aria-label="Move earlier" onClick={() => { const a = [...form.galleryMediaIds]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set('galleryMediaIds', a); }}>‹</button>}
                        {i < form.galleryMediaIds.length - 1 && <button type="button" aria-label="Move later" onClick={() => { const a = [...form.galleryMediaIds]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set('galleryMediaIds', a); }}>›</button>}</span></>}
                  </div>))}
                </div>
                {!ro && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('gallery')}><Icon n="plus" />Add photos</button>}
              </Field>
            </div>}

            {tab === 'SEO' && <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0 }}><div className="form">
              <Field name="seoTitle" label="SEO title" optional hint="Leave empty to use the project name." count={[form.seoTitle.length, 70]} err={errors.seoTitle}><input className="input" value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} maxLength={70} /></Field>
              <Field name="seoDescription" label="Meta description" optional hint="Leave empty to use the summary. About 150 characters." count={[form.seoDescription.length, 170]} err={errors.seoDescription}><textarea className="textarea" style={{ minHeight: 72 }} value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} maxLength={170} /></Field>
              <div className="card" style={{ padding: 14, background: 'var(--sunken)' }}>
                <small className="muted">Search result preview</small>
                <div style={{ marginTop: 6, color: '#1a0dab', fontSize: 17 }}>{(form.seoTitle || form.name || 'Project name')} · AFCD Foundation</div>
                <div style={{ color: '#006621', fontSize: 12.5 }}>afcdfoundation.org › {fileName ?? 'projects.html'}</div>
                <div style={{ color: 'var(--ink-2)' }}>{(form.seoDescription || form.summary || 'The summary appears here.').slice(0, 160)}</div>
              </div>
              <div className="notice n-info">The current site builder still sets page titles and descriptions from the project name and summary. These SEO fields are stored and versioned now, and are used once the SEO Studio phase connects them to the build.</div>
            </div></fieldset>}
          </fieldset>
          </div>
        </section>

        <aside className="inspector pe-rail" aria-label="Project status">
          <section className="card pe-card">
            <div className="pe-card-h"><h2>Status</h2></div>
            <div className="pe-card-b">
              <p className="pe-summary"><span className={`pe-live${live ? ' on' : ''}`}><i aria-hidden="true" />{live ? 'Live' : isNew ? 'New draft' : 'Not on the website'}</span>
                {data?.publishedAt && <> · published {fmtDate(data.publishedAt)}</>}{data && <> · saved {ago(data.updatedAt)}</>}</p>
              {live && status !== 'published' && <p className="pe-note">A newer draft isn’t published yet. The live page shows the last published version.</p>}
              <dl className="kv"><dt>Page</dt><dd className="mono">{fileName ?? 'Listing only'}</dd></dl>
              {(liveUrl || !isNew) && <div className="pe-btns">
                {liveUrl && <a className="btn btn-sm" href={liveUrl} target="_blank" rel="noopener"><Icon n="ext" />Open live page</a>}
                {!isNew && <button className="btn btn-sm" onClick={preview} disabled={!!busy}><Icon n="eye" />Preview</button>}
              </div>}
            </div>
          </section>

          {!isNew && <section className="card pe-card">
            <div className="pe-card-h"><h2>Workflow</h2></div>
            <div className="pe-card-b">
              <Stepper status={status} live={live} publishedAt={data?.publishedAt ?? null} />
              {data && data.problems.length > 0 && status !== 'archived' && <div className="notice n-warn"><div><b>Before review</b><ul>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
              {next && <button className="btn btn-primary pe-next" disabled={!!busy} onClick={next.run}><Icon n={next.icon} />{busy === next.key ? 'Working…' : next.label}</button>}
              {status === 'in_review' && can('project.review') && <button className="btn" disabled={!!busy} onClick={() => setDialog('changes')}>Request changes</button>}
              {status === 'approved' && !can('project.publish') && <div className="notice n-info">Approved. A website administrator will publish it.</div>}
              {status === 'in_review' && !can('project.approve') && <p className="pe-note">Waiting for a reviewer.</p>}
            </div>
          </section>}

          {data && <details className="card pe-card pe-hist" open>
            <summary className="pe-card-h"><h2>History</h2><span className="pe-hist-n">{mergeHistory(data).length}</span><Icon n="chev" className="pe-caret" /></summary>
            <div className="pe-card-b"><ol className="timeline">
              {mergeHistory(data).map((h) => { const isLive = h.revId === data.publishedRevisionId; return <li key={h.key} className={isLive ? 'is-live' : undefined}><b>{h.title}</b>{h.body && <q>{h.body}</q>}<small>{ago(h.at)} · {fmtDate(h.at)}</small>
                {h.revId && h.rev && can('project.update') && status !== 'in_review' && !(isLive && status === 'published') && <button className="btn btn-sm btn-ghost pe-restore" onClick={() => restore(h.revId!, h.rev!)}>Restore this version</button>}
              </li>; })}
            </ol></div>
          </details>}
        </aside>
      </div>

      {dialog === 'hero' && <MediaPicker onClose={() => setDialog(null)} onPick={(items) => { const m = items[0]; if (m) { setMedia((x) => ({ ...x, [m.id]: m })); set('heroMediaId', m.id); } setDialog(null); }} />}
      {dialog === 'gallery' && <MediaPicker multiple onClose={() => setDialog(null)} onPick={(items) => { setMedia((x) => ({ ...x, ...Object.fromEntries(items.map((m) => [m.id, m])) })); set('galleryMediaIds', [...new Set([...form.galleryMediaIds, ...items.map((m) => m.id)])].slice(0, 12)); setDialog(null); }} />}

      {dialog === 'preview' && <PreviewModal url={previewUrl} onClose={() => setDialog(null)} />}

      {dialog === 'approve' && <Modal size="sm" title="Approve this project?" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => act('approve', { comment })}>{busy ? 'Approving…' : 'Approve'}</button></>}>
        <div className="modal-b stack"><p style={{ margin: 0 }}>The current version is frozen for publishing. Later edits create a new draft that needs approval again.</p>
          <Field name="approveNote" label="Note for the team" optional><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field></div>
      </Modal>}
      {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim() || !!busy} onClick={() => act('request_changes', { comment })}>Send to author</button></>}>
        <div className="modal-b"><Field name="changesNote" label="What needs to change?"><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} autoFocus /></Field></div>
      </Modal>}
      {dialog === 'publish' && <Modal size="sm" title="Publish to the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => publish('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish now'}</button></>}>
        <div className="modal-b stack"><p style={{ margin: 0 }}>This rebuilds the public site with the approved version and checks the result before confirming:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{fileName && <li>the project page <span className="mono">{fileName}</span></li>}<li>the Projects listing</li><li>{form.pillarKeys.length > 1 ? `${form.pillarKeys.length} pillar pages` : 'its pillar page'}</li><li>the sitemap</li></ul>
          {busy && <div className="notice n-info">Building the website… this can take up to a minute.</div>}
          <small className="muted">This updates the website files in this repository. Pushing them to the hosted site is a separate, authorized step.</small></div>
      </Modal>}
      {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary pe-danger" disabled={!!busy} onClick={() => publish('unpublish')}>{busy ? 'Removing…' : 'Remove from website'}</button></>}>
        <div className="modal-b"><p style={{ margin: 0 }}>The project page and its listing cards are removed from the site. The project stays in Studio as a draft with its full history.</p></div>
      </Modal>}
    </div>
  );
}

const LABELS: Record<string, string> = {
  name: 'Project name', summary: 'One-line summary', category: 'Category', reference: 'Internal reference', location: 'Location', years: 'Years', extraFacts: 'Extra facts',
  slug: 'Page address', sort: 'Order in listings', context: 'Context', approach: 'Approach', activities: 'Activities', results: 'Results', pillarKeys: 'Strategic pillars',
  primaryPillarKey: 'Primary pillar', objectiveRefs: 'Strategic objectives', heroMediaId: 'Hero photo', galleryMediaIds: 'Gallery', photoCaption: 'Placeholder caption',
  seoTitle: 'SEO title', seoDescription: 'Meta description',
};

function PeSection({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  const id = `pe-sec-${title.toLowerCase()}`;
  return <section className="pe-sec" aria-labelledby={id}>
    <div className="pe-sec-h"><h3 id={id}>{title}</h3>{desc && <p>{desc}</p>}</div>
    <div className="pe-sec-b">{children}</div>
  </section>;
}

/** A single control is wrapped in <label> so it gets an accessible name; groups of controls get role=group + aria-label.
 *  `name` gives the control a stable id (pe-<name>) so the error summary can jump to it. */
function Field({ label, hint, err, warn, optional, count, group, name, aside, children }: { label: string; hint?: string; err?: string; warn?: string; optional?: boolean; count?: [number, number]; group?: boolean; name?: string; aside?: ReactNode; children: ReactNode }) {
  const named = group ? children : Children.map(children, (ch) => isValidElement(ch) && typeof ch.type === 'string' && ['input', 'textarea', 'select'].includes(ch.type)
    ? cloneElement(ch as ReactElement<Record<string, unknown>>, { 'aria-label': label, ...(name ? { id: (ch.props as { id?: string }).id ?? `pe-${name}` } : {}), ...(err ? { 'aria-invalid': true } : {}) }) : ch);
  const near = count && count[0] >= count[1] * 0.9;
  const inner = <>
    <span className="pe-label">{label}{optional && <em> · optional</em>}{aside && <span className="pe-label-aside">{aside}</span>}</span>
    {named}
    {(hint || count || warn) && <span className="between">{warn ? <small className="pe-warn">{warn}</small> : hint ? <small>{hint}</small> : <span />}{count && <small className={`count-hint${near ? ' near' : ''}`}>{count[0]} / {count[1]}</small>}</span>}
    {err && <small className="err" role="alert">{err}</small>}</>;
  return group ? <div className={`field${err ? ' has-err' : ''}`} role="group" aria-label={label} id={name ? `pe-${name}` : undefined} tabIndex={name ? -1 : undefined}>{inner}</div>
    : <label className={`field${err ? ' has-err' : ''}`}>{inner}</label>;
}

/** Workflow stepper: done, current and upcoming steps. */
function Stepper({ status, live, publishedAt }: { status: string; live: boolean; publishedAt: string | null }) {
  const order = ['draft', 'in_review', 'approved', 'published'];
  const cur = status === 'changes_requested' ? 0 : order.indexOf(status);
  const steps: [string, string][] = [
    ['Draft', status === 'changes_requested' ? 'Changes requested' : 'Being edited'],
    ['Review', 'Checked by a reviewer'],
    ['Approved', 'Ready to publish'],
    ['Live', publishedAt && status === 'published' ? `Since ${fmtDate(publishedAt)}` : live ? 'An earlier version is live' : 'On the website'],
  ];
  if (status === 'archived') return <p className="pe-note">Archived. Restore it as a draft to continue.</p>;
  return <ol className="pe-steps" aria-label="Workflow progress">{steps.map(([l, d], i) => {
    const st = i < cur ? 'done' : i === cur ? 'current' : 'todo';
    return <li key={l} className={`st-${st}${i === 3 && live ? ' is-live' : ''}`} aria-current={st === 'current' ? 'step' : undefined}>
      <span className="pe-step-dot" aria-hidden="true">{st === 'done' ? <Icon n="check" /> : i + 1}</span>
      <span className="pe-step-t"><b>{l}</b><small>{d}</small></span>
      <span className="sr-only">{st === 'done' ? ' (done)' : st === 'current' ? ' (current step)' : ' (to do)'}</span>
    </li>; })}</ol>;
}

function PreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [w, setW] = useState(1280);
  return <Modal wide title={<span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>Preview<span className="badge b-draft">Not published</span></span>} onClose={onClose}>
    <div className="modal-h" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="seg" role="group" aria-label="Device">{([[1280, 'monitor', 'Desktop'], [820, 'tablet', 'Tablet'], [390, 'phone', 'Mobile']] as const).map(([x, ic, l]) => <button key={x} className={w === x ? 'on' : ''} onClick={() => setW(x)}><Icon n={ic} width={14} height={14} style={{ verticalAlign: -2, marginRight: 4 }} />{l}</button>)}</div>
      <span className="muted" style={{ fontSize: 12 }}>Real website template · {w}px</span><span style={{ flex: 1 }} /><a className="btn btn-sm" href={url} target="_blank" rel="noopener"><Icon n="ext" />Open in tab</a>
    </div>
    <div className="preview-wrap"><iframe title="Project preview" src={url} style={{ width: Math.min(w, window.innerWidth - 80) }} /></div>
  </Modal>;
}

function pick(d: Loaded): Form {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Form)[]) if (k in d && (d as any)[k] !== null || k === 'heroMediaId') (f as any)[k] = (d as any)[k] ?? (EMPTY as any)[k];
  return f;
}

function mergeHistory(d: Loaded) {
  const reasons: Record<string, string> = { imported: 'Imported from the current website', submitted: 'Submitted for review', approved: 'Approved version', published: 'Published', restored: 'Restored' };
  const kinds: Record<string, string> = { submit: 'Sent for review', request_changes: 'Changes requested', approve: 'Approved', archive: 'Archived', restore: 'Restored', withdraw: 'Withdrawn', comment: 'Comment' };
  const items = [
    ...d.history.revisions.map((r) => ({ key: r.id, at: r.createdAt, title: `Revision ${r.number} · ${reasons[r.reason] ?? r.reason}${r.id === d.publishedRevisionId ? ' · live' : ''}`, body: '', revId: r.id, rev: r.number })),
    ...d.history.comments.filter((c) => c.body).map((c) => ({ key: c.id, at: c.createdAt, title: kinds[c.kind] ?? c.kind, body: c.body, revId: undefined as string | undefined, rev: undefined as number | undefined })),
  ];
  return items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 20);
}
