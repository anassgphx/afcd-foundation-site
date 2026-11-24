// Project workspace: tabs for content, an inspector with status, readiness, workflow actions and history.
import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { api, patch, post, put, ApiError } from '../api.ts';
import { useSite } from '../site.ts';
import { Badge, Icon, Link, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';
import { RecordTranslations } from '../RecordTranslations.tsx';
import { ActivityList, type PubOpt } from '../ActivityEditor.tsx';
import { DurationPicker, TagInput, splitTags } from '../projectFields.tsx';
import '../project-editor.css';

type Pillar = { key: string; name: string; colour: string; number: string };
type Objective = { ref: string; title: string; pillarKeys: string[] };
type Form = {
  name: string; slug: string; reference: string; category: string; summary: string; location: string; years: string;
  extraFacts: { label: string; value: string }[]; context: string; approach: string; activities: string; results: string;
  hasDetailPage: boolean; photoCaption: string; heroMediaId: string | null; galleryMediaIds: string[];
  logoMediaId: string | null; logoStyle: LogoStyle; posterMediaId: string | null;
  pillarKeys: string[]; primaryPillarKey: string; objectiveRefs: string[]; partnerSlugs: string[]; seoTitle: string; seoDescription: string; sort: number;
  programObjectives: ProgObjective[]; outcomes: Outcome[]; activityItems: Activity[];
};
type ProgObjective = { title: string; text: string };
type PartnerOpt = { id: string; slug: string; name: string; scope: string; status: string; publishedRevisionId: string | null };
const MONTH = '(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)';
/** A year, a month and year, or a range of them ("2020 – 2021", "January – November 2026", "Mar 2024 – present"). */
const durationOk = (v: string) => { const t = v.trim(); if (!t) return true;
  const part = `(${MONTH}\\.?\\s+)?((19|20)\\d{2})?`; const re = new RegExp(`^${MONTH}?\\s*${part}(\\s*(–|—|-|to|until)?\\s*(${part}|present|today|ongoing))?$`, 'i');
  return /(19|20)\d{2}/.test(t) && re.test(t.replace(/\s+/g, ' ')); };
type LogoStyle = { shape: string; fit: 'contain' | 'cover'; bg: 'none' | 'white' | 'light' | 'dark' | 'pillar'; size: 's' | 'm' | 'l' };
const LOGO_SHAPES: [string, string][] = [['original', 'Original'], ['1:1', '1:1'], ['circle', 'Circle'], ['3:1', '3:1 wide'], ['2:1', '2:1'], ['4:3', '4:3'], ['16:9', '16:9'], ['3:4', '3:4'], ['1:3', '1:3 tall']];
const LOGO_BGS: [LogoStyle['bg'], string][] = [['none', 'None'], ['white', 'White'], ['light', 'Light'], ['dark', 'Dark'], ['pillar', 'Pillar colour']];
/** The logo as the website frames it (same rules as .pj-logo in input.css). */
function LogoFrame({ m, st, tone }: { m: { url: string; large?: string; alt: string; width: number; height: number; focalX: number; focalY: number }; st: LogoStyle; tone?: string }) {
  const ratio = st.shape === 'original' ? `${m.width} / ${m.height}` : st.shape === 'circle' ? '1 / 1' : st.shape.replace(':', ' / ');
  const tall = st.shape === '3:4' || st.shape === '1:3' || (st.shape === 'original' && m.height > m.width);
  return <span className={`pe-logo s-${st.size} bg-${st.bg}${st.shape === 'circle' ? ' round' : ''}${st.fit === 'cover' ? ' cover' : ''}${tall ? ' tall' : ''}`} style={{ aspectRatio: ratio, ['--pc' as string]: tone ?? '#e7e5e4' }}>
    <img src={m.large ?? m.url} alt={m.alt} style={{ objectPosition: `${m.focalX}% ${m.focalY}%` }} /></span>;
}
type Outcome = { title: string; text: string; figure: string };
type Activity = { title: string; text: string; when?: string; place?: string; mediaIds: string[]; publicationSlugs?: string[] };
type LinkedEvent = { id: string; title: string; startDate: string; status: string; live: boolean };
type MediaRow = { id: string; storageKey: string; originalName: string; width: number; height: number; alt: string; rightsConfirmed: boolean; focalX: number; focalY: number };
type Loaded = Form & {
  activityMedia?: Record<string, MediaRow>; linkedEvents?: LinkedEvent[];
  id: string; status: string; publishedRevisionId: string | null; publishedAt: string | null; approvedRevisionId: string | null; updatedAt: string;
  hero: MediaItem | null; logo: MediaItem | null; poster: MediaItem | null; gallery: MediaItem[]; problems: string[]; pillars: { key: string; isPrimary: boolean }[];
  history: { revisions: { id: string; number: number; reason: string; createdAt: string }[]; comments: { id: string; kind: string; body: string; createdAt: string }[] };
};

const EMPTY: Form = {
  name: '', slug: '', reference: '', category: '', summary: '', location: '', years: '', extraFacts: [], context: '', approach: '', activities: '', results: '',
  hasDetailPage: true, photoCaption: '', heroMediaId: null, galleryMediaIds: [], logoMediaId: null, logoStyle: { shape: 'original', fit: 'contain', bg: 'white', size: 'm' }, posterMediaId: null, pillarKeys: [], primaryPillarKey: '', objectiveRefs: [], partnerSlugs: [], seoTitle: '', seoDescription: '', sort: 100,
  programObjectives: [], outcomes: [], activityItems: [],
};
const LIST_MAX = 12;
// Same order as the project page: Summary · Program objectives · Outcomes · Program activities · Related events
const TABS = ['Summary', 'Objectives', 'Outcomes', 'Activities', 'Events', 'Relationships', 'Gallery', 'SEO', 'Translations'] as const;
const TAB_FIELDS: Record<string, string[]> = {
  Summary: ['name', 'slug', 'reference', 'category', 'summary', 'location', 'years', 'partnerSlugs', 'extraFacts', 'sort', 'context', 'approach', 'heroMediaId', 'photoCaption', 'logoMediaId', 'logoStyle', 'posterMediaId'],
  Objectives: ['programObjectives'],
  Outcomes: ['outcomes', 'results'],
  Activities: ['activityItems', 'activities'],
  Events: [],
  Relationships: ['pillarKeys', 'primaryPillarKey', 'objectiveRefs'],
  Gallery: ['galleryMediaIds'],
  SEO: ['seoTitle', 'seoDescription'],
  Translations: [],
};
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export function ProjectEditor({ id }: { id: string }) {
  const site = useSite();
  const isNew = id === 'new';
  const can = useCan(); const me = useMe(); const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [media, setMedia] = useState<Record<string, MediaItem>>({});
  const [pillars, setPillars] = useState<Pillar[]>([]); const [objectives, setObjectives] = useState<Objective[]>([]);
  const [partnersAll, setPartnersAll] = useState<PartnerOpt[]>([]); const [pubsAll, setPubsAll] = useState<PubOpt[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Summary');
  const [errors, setErrors] = useState<Record<string, string>>({}); const [banner, setBanner] = useState<{ kind: string; text: ReactNode } | null>(null);
  const [busy, setBusy] = useState(''); const [dirty, setDirty] = useState(false); const [slugTouched, setSlugTouched] = useState(!isNew);
  const [dialog, setDialog] = useState<null | 'publish' | 'unpublish' | 'changes' | 'approve' | 'preview' | 'hero' | 'gallery' | 'activity' | 'logo' | 'poster'>(null);
  const [actPick, setActPick] = useState(-1);   // which activity is choosing a photo
  const [fixing, setFixing] = useState<MediaItem | null>(null);   // a photo whose alt text / rights are being completed here
  const [previewUrl, setPreviewUrl] = useState(''); const [comment, setComment] = useState('');
  const [changed, setChanged] = useState<Set<string>>(new Set());   // fields edited since the last save (tab dots)
  const [categories, setCategories] = useState<string[]>([]);       // categories already used by projects (suggestions)
  const [copied, setCopied] = useState(false);
  useEffect(() => { api<{ category: string | null }[]>('/projects').then((r) => setCategories([...new Set(r.flatMap((x) => splitTags(x.category ?? '')))].sort())).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const [p, o] = await Promise.all([api<Pillar[]>('/pillars'), api<Objective[]>('/objectives')]);
    setPillars(p); setObjectives(o);
    api<PartnerOpt[]>('/partners').then(setPartnersAll).catch(() => setPartnersAll([]));   // partners the project can be linked to
    api<PubOpt[]>('/publications').then(setPubsAll).catch(() => setPubsAll([]));   // publications an activity can link to
    if (isNew) return;
    const d = await api<Loaded>(`/projects/${id}`);
    const primary = d.pillars.find((x) => x.isPrimary)?.key ?? d.pillars[0]?.key ?? '';
    setData(d);
    setForm({ ...pick(d), pillarKeys: d.pillars.map((x) => x.key), primaryPillarKey: primary, galleryMediaIds: d.gallery.map((g) => g.id) });
    const act = Object.values(d.activityMedia ?? {}).map((m) => ({ ...m, url: `/studio/media-file/${m.storageKey}-480.webp` }) as unknown as MediaItem);
    setMedia(Object.fromEntries([d.hero, d.logo, d.poster, ...d.gallery, ...act].filter(Boolean).map((m) => [m!.id, m!])));
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
    // empty section lists are left out: the server defaults them to [] (and a server not yet restarted still accepts the save)
    const { programObjectives, outcomes, activityItems, ...base } = form;
    const body = { ...base, ...(programObjectives.length ? { programObjectives } : {}), ...(outcomes.length ? { outcomes } : {}), ...(activityItems.length ? { activityItems } : {}) };
    try {
      if (isNew) {
        const p = await post<{ id: string }>('/projects', body);
        setDirty(false); toast('Draft created'); navigate(`/studio/projects/${p.id}`); return p.id;
      }
      await put(`/projects/${id}`, body);
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
  const usedPhotoIds = [...new Set([form.heroMediaId, form.logoMediaId, form.posterMediaId, ...form.galleryMediaIds, ...form.activityItems.flatMap((a) => a.mediaIds)].filter(Boolean) as string[])];
  const toFix = usedPhotoIds.map((x) => media[x]).filter((m) => m && (!m.alt || !m.rightsConfirmed));
  const canFix = can('media.update');
  const goTo = (field: string) => { const t = TABS.find((x) => TAB_FIELDS[x].includes(field)); if (t) setTab(t); setTimeout(() => document.getElementById(`pe-${field}`)?.focus(), 40); };
  const leave = (to: string) => { if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return; navigate(to); };
  const yearsOk = durationOk(form.years);

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
      {toFix.length > 0 && <div className="pe-fixlist" role="region" aria-label="Images to complete">
        <p className="pe-fixlist-h"><b>{toFix.length === 1 ? '1 image needs' : `${toFix.length} images need`} details before review</b><span>Alt text describes the image for screen readers; the rights box confirms AFCD may publish it. This includes the project logo.</span></p>
        <ul>{toFix.map((m) => <li key={m.id}>
          <img src={m.url} alt="" />
          <span className="pe-fix-t"><b title={m.originalName}>{m.originalName}</b><small>{[!m.alt && 'Alt text missing', !m.rightsConfirmed && 'Rights not confirmed'].filter(Boolean).join(' · ')}</small></span>
          {canFix ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setFixing(m)}>Fix</button> : <small className="muted">Ask a media manager</small>}
        </li>)}</ul>
      </div>}

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
              ...form.programObjectives.flatMap((o, i) => [{ label: `Programme objective ${i + 1}`, value: o.title }, { label: `Programme objective ${i + 1} · text`, value: o.text }]),
              ...form.outcomes.flatMap((o, i) => [{ label: `Outcome ${i + 1} · figure`, value: o.figure }, { label: `Outcome ${i + 1}`, value: o.title }, { label: `Outcome ${i + 1} · text`, value: o.text }]),
              ...form.activityItems.flatMap((a, i) => [{ label: `Activity ${i + 1}`, value: a.title }, { label: `Activity ${i + 1} · text`, value: a.text }]),
              { label: 'Photo caption', value: form.photoCaption }, { label: 'SEO title', value: form.seoTitle }, { label: 'Meta description', value: form.seoDescription }]} /></div>}
          <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {tab === 'Summary' && <div className="pe-form">
              <PeSection title="Basics" desc="How the project is named and introduced on cards, listings and its page.">
                <Field name="name" label="Project name" err={errors.name}><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={160} disabled={ro} /></Field>
                <Field name="summary" label="One-line summary" hint="Shown on project cards, the listing and as the page intro." err={errors.summary} count={[form.summary.length, 400]}>
                  <textarea className="textarea" style={{ minHeight: 64 }} value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={400} disabled={ro} />
                </Field>
                <Field group name="category" label="Categories" hint="Tags shown with the pillar at the top of the page. Pick ones already in use, or type a new one and press Enter." err={errors.category}>
                  <TagInput value={form.category} onChange={(v) => set('category', v)} suggestions={categories} disabled={ro} />
                </Field>
                <Field name="reference" label="Internal reference" optional hint="Only visible in Studio." err={errors.reference}><input className="input" value={form.reference} onChange={(e) => set('reference', e.target.value)} maxLength={40} disabled={ro} /></Field>
              </PeSection>

              <PeSection title="Details" desc="Shown in the “At a glance” panel on the project page.">
                <Field name="location" label="Location" optional err={errors.location}><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={120} disabled={ro} placeholder="e.g. Ait Ourir" /></Field>
                <Field group name="years" label="Duration" optional hint="Pick the start and end dates. The website shows months and years; a full January–December span shows as years (2025 – 2026)." warn={yearsOk ? undefined : 'Pick the dates again so the website can show them.'} err={errors.years}>
                  <DurationPicker value={form.years} onChange={(v) => set('years', v)} disabled={ro} />
                </Field>
                <Field group name="partnerSlugs" label="Partners" optional hint="Chosen from Studio → Partners, the same links the partner pages use. Only published partners show on the website." err={errors.partnerSlugs}>
                  {(() => {
                    const chosen = form.partnerSlugs.map((sl) => partnersAll.find((x) => x.slug === sl) ?? { slug: sl, name: sl, scope: '', status: '', publishedRevisionId: null, id: sl });
                    const left = partnersAll.filter((x) => !form.partnerSlugs.includes(x.slug)).sort((a, b) => a.name.localeCompare(b.name));
                    const live = left.filter((x) => x.publishedRevisionId), draft = left.filter((x) => !x.publishedRevisionId);
                    const add = (sl: string) => { if (sl) set('partnerSlugs', [...form.partnerSlugs, sl].slice(0, 12)); };
                    // a partner typed as an extra fact that matches a real partner: offer to link it instead
                    const typed = form.extraFacts.findIndex((f) => /^partners?$/i.test(f.label.trim()));
                    const typedMatch = typed >= 0 ? partnersAll.find((x) => !form.partnerSlugs.includes(x.slug) && (form.extraFacts[typed].value.toLowerCase().includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(form.extraFacts[typed].value.trim().toLowerCase()))) : undefined;
                    return <div className="pe-partners">
                      {chosen.length > 0 && <ul className="pe-pchips">{chosen.map((x) => <li key={x.slug}><span className="pe-pchip-n">{x.name}</span>
                        {x.scope && <small>{x.scope}</small>}{!x.publishedRevisionId && <em title="This partner is not published yet, so it isn't shown on the website">not published</em>}
                        {!ro && <button type="button" aria-label={`Remove ${x.name}`} onClick={() => set('partnerSlugs', form.partnerSlugs.filter((s2) => s2 !== x.slug))}>×</button>}</li>)}</ul>}
                      {!ro && <select className="select pe-pselect" value="" disabled={!left.length || form.partnerSlugs.length >= 12} onChange={(e) => add(e.target.value)} aria-label="Add a partner">
                        <option value="">{!partnersAll.length ? 'No partners yet: add them in Partners' : left.length ? 'Add a partner…' : 'All partners are linked'}</option>
                        {live.length > 0 && <optgroup label="Published partners">{live.map((x) => <option key={x.slug} value={x.slug}>{x.name}{x.scope ? ` · ${x.scope}` : ''}</option>)}</optgroup>}
                        {draft.length > 0 && <optgroup label="Not published yet (hidden on the website)">{draft.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</optgroup>}
                      </select>}
                      {!ro && typedMatch && <div className="pe-plink"><span>“{form.extraFacts[typed].value}” is typed as an extra fact. Link the partner <b>{typedMatch.name}</b> instead, so it stays in step with the Partners page?</span>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => { set('partnerSlugs', [...form.partnerSlugs, typedMatch.slug]); set('extraFacts', form.extraFacts.filter((_, i) => i !== typed)); }}>Link partner</button></div>}
                    </div>;
                  })()}
                </Field>
                <Field group name="extraFacts" label="Extra facts" optional hint="Short label and value pairs, e.g. “Participants · 120”. Shown as key figures under the cover." aside={<span className="count-hint">{form.extraFacts.length} of 4</span>} err={errors.extraFacts}>
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
                {(() => {
                  // what the project page will show: partner, duration and location in the At a glance panel, the extra facts as key figures (same rules as src/content.py)
                  const linked = form.partnerSlugs.map((sl) => partnersAll.find((x) => x.slug === sl)).filter((x) => x && x.publishedRevisionId).map((x) => x!.name);
                  const typed = form.extraFacts.find((f) => /^partners?$/i.test(f.label.trim()))?.value.trim() ?? '';
                  const pn = linked.length ? linked : typed ? [typed] : [];
                  const bar = ([[pn.length > 1 ? 'Partners' : 'Partner', pn.join(', ')], ['Duration', form.years.trim()], ['Location', form.location.trim()]] as [string, string][]).filter(([, v]) => v);
                  const stats = form.extraFacts.filter((f) => f.label.trim() && f.value.trim() && !/^partners?$/i.test(f.label.trim()));
                  return <div className="pe-fpreview" aria-label="Preview of the project page facts">
                    <span className="pe-fp-k">On the project page</span>
                    {bar.length > 0 && <dl className="pe-fp-bar">{bar.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
                    {stats.length > 0 && <dl className="pe-fp-stats">{stats.map((f, i) => <div key={i}><dd>{f.value}</dd><dt>{f.label}</dt></div>)}</dl>}
                    {form.partnerSlugs.length > linked.length && <small className="muted">Partners that aren't published yet are left out until they are.</small>}
                  </div>;
                })()}
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

              <PeSection title="Story" desc="The project page opens with this, after the summary.">
                {([['context', 'Context', 'What need or situation did the project respond to?'], ['approach', 'Approach', 'How did AFCD and its partners work?']] as const).map(([k, l, h]) => (
                  <Field key={k} name={k} label={l} hint={h} err={errors[k]} count={[form[k].length, 2000]}><textarea className="textarea" value={form[k]} onChange={(e) => set(k, e.target.value)} maxLength={2000} disabled={ro} /></Field>
                ))}
              </PeSection>

              <PeSection title="Project logo" desc="Shown next to the project title on its page and on the homepage case-study card. Upload it in the Media Library. Alt text is required before the project can be published.">
                <Field group name="logoMediaId" label="Logo" optional hint="Upload it to the Media Library first (PNG or SVG-like images with a transparent background work best). Needs alt text and confirmed rights." err={errors.logoMediaId}>
                  {(() => {
                    const m = form.logoMediaId ? media[form.logoMediaId] : null; const st = form.logoStyle;
                    const setSt = (p: Partial<LogoStyle>) => set('logoStyle', { ...st, ...p });
                    const tone = pillars.find((x) => x.key === (form.primaryPillarKey || form.pillarKeys[0]))?.colour;
                    return <div className="pe-logo-ed">
                      <div className="pe-logo-stage">{m ? <LogoFrame m={m} st={st} tone={tone} /> : <span className="muted">No logo</span>}</div>
                      {!ro && <div className="pe-logo-ctl">
                        <div className="pe-logo-row"><button type="button" className="btn btn-sm" onClick={() => setDialog('logo')}><Icon n="image" />{m ? 'Change logo' : 'Choose logo'}</button>
                          {m && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => set('logoMediaId', null)}>Remove</button>}</div>
                        {m && <p className="pe-logo-alt">{m.alt ? <>Alt text: <b>{m.alt}</b></> : <b>Alt text is missing.</b>}{!ro && canFix && <button type="button" className="btn btn-sm" onClick={() => setFixing(m)}>{m.alt ? 'Edit alt text' : 'Add alt text'}</button>}</p>}
                        {m && <>
                          <span className="pe-logo-k">Shape</span>
                          <div className="seg-btns" role="group" aria-label="Logo shape">{LOGO_SHAPES.map(([k, l]) => <button key={k} type="button" className={st.shape === k ? 'on' : ''} aria-pressed={st.shape === k} onClick={() => setSt({ shape: k })}>{l}</button>)}</div>
                          <span className="pe-logo-k">Fit</span>
                          <div className="seg-btns" role="group" aria-label="Logo fit">
                            <button type="button" className={st.fit === 'contain' ? 'on' : ''} aria-pressed={st.fit === 'contain'} onClick={() => setSt({ fit: 'contain' })} title="The whole logo, with space around it">Whole logo</button>
                            <button type="button" className={st.fit === 'cover' ? 'on' : ''} aria-pressed={st.fit === 'cover'} onClick={() => setSt({ fit: 'cover' })} title="Fill the shape and crop around the focal point set in the Media Library">Fill and crop</button></div>
                          <span className="pe-logo-k">Background</span>
                          <div className="seg-btns" role="group" aria-label="Logo background">{LOGO_BGS.map(([k, l]) => <button key={k} type="button" className={st.bg === k ? 'on' : ''} aria-pressed={st.bg === k} onClick={() => setSt({ bg: k })}>{l}</button>)}</div>
                          <span className="pe-logo-k">Size</span>
                          <div className="seg-btns" role="group" aria-label="Logo size">{([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as const).map(([k, l]) => <button key={k} type="button" className={st.size === k ? 'on' : ''} aria-pressed={st.size === k} onClick={() => setSt({ size: k })}>{l}</button>)}</div>
                          {st.fit === 'cover' && <small className="muted">The crop keeps the focal point chosen for this image in the Media Library.</small>}
                        </>}
                      </div>}
                    </div>;
                  })()}
                </Field>
              </PeSection>

              <PeSection title="Cover photos" desc="Up to five places at the top of the project page: the main photo large, the others beside it. A poster takes one of the places.">
              <Field group name="heroMediaId" label="Cover photos" optional hint="The first photo is the large one; ★ makes another one the main photo. Photos 2 to 5 are also the first photos of the Gallery tab. Each needs alt text and confirmed rights before publishing." err={errors.heroMediaId}>
                  {(() => {
                    const places = form.posterMediaId ? 4 : 5;   // the poster is one of the five cover places
                    const cover = [form.heroMediaId, ...form.galleryMediaIds].filter(Boolean).slice(0, places) as string[];
                    const removeAt = (k: number) => { if (k === 0) { const [next, ...rest] = form.galleryMediaIds; set('heroMediaId', next ?? null); set('galleryMediaIds', rest); } else set('galleryMediaIds', form.galleryMediaIds.filter((_, x) => x !== k - 1)); };
                    const makeMain = (k: number) => { const g = [...form.galleryMediaIds]; const old = form.heroMediaId!; const neu = g[k - 1]; g[k - 1] = old; set('heroMediaId', neu); set('galleryMediaIds', g); };
                    const tiles = cover.length + (form.posterMediaId ? 1 : 0);
                    const layout = tiles <= 1 ? 'one large photo' : tiles === 2 ? 'two photos side by side' : tiles === 3 ? 'the main photo large, two stacked beside it' : tiles === 4 ? 'the main photo large, one wide and two small beside it' : 'the main photo large, four in a 2×2 grid beside it';
                    return <>{cover.length ? <div className="pe-cover">{cover.map((mid, k) => media[mid] && <div key={mid} className={`thumb${k === 0 ? ' main' : ''}`}><img src={media[mid].url} alt={media[mid].alt} />
                      <span className="pe-cover-n">{k === 0 ? 'Main' : k + 1}</span>
                      {!ro && <><button type="button" aria-label={`Remove cover photo ${k + 1}`} onClick={() => removeAt(k)}>×</button>{k > 0 && <span className="mv"><button type="button" aria-label="Make this the main photo" title="Make this the large photo" onClick={() => makeMain(k)}>★</button></span>}</>}</div>)}</div>
                      : <div className="muted">No cover photo. A grey placeholder is shown.</div>}
                    <small className="pe-cover-note">{tiles} of 5 places used{form.posterMediaId ? ' (one is the poster)' : ''}: {layout}. Phones show the main photo on top, the others two per row.</small>
                    {!ro && cover.length < places && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('hero')}><Icon n="image" />{cover.length ? `Add photos (${places - cover.length} more)` : `Choose up to ${places} photos`}</button>}</>;
                  })()}
                </Field>
                <Field group name="posterMediaId" label="Poster (1:1)" optional hint="A square poster shown whole (never cropped) next to the main photo, with a “Poster” tag. It takes one of the five cover places. Needs alt text and confirmed rights before publishing." err={errors.posterMediaId}>
                  {(() => {
                    const m = form.posterMediaId ? media[form.posterMediaId] : null;
                    const r = m ? m.width / m.height : 1; const square = Math.abs(r - 1) <= 0.08;
                    return <div className="pe-poster">
                      {m ? <div className="pe-poster-tile"><img src={m.large ?? m.url} alt={m.alt} /><span className="pe-poster-tag">Poster</span></div> : <div className="pe-poster-tile empty">1:1</div>}
                      <div className="pe-poster-side">
                        {m && <small className="muted">{m.width} × {m.height} px · {m.originalName}</small>}
                        {m && !square && <p className="pe-warn"><Icon n="alert" width={14} height={14} />Not square ({r > 1 ? 'wider' : 'taller'} than 1:1). It will show whole with space around it; a square version looks best.</p>}
                        {m && (!m.alt || !m.rightsConfirmed) && <p className="pe-warn"><Icon n="alert" width={14} height={14} />{!m.alt ? 'Add alt text' : 'Confirm usage rights'} for this poster in the Media Library before publishing.</p>}
                        {!ro && <div className="pe-poster-b"><button type="button" className="btn btn-sm" onClick={() => setDialog('poster')}><Icon n="image" />{m ? 'Change poster' : 'Choose poster'}</button>
                          {m && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => set('posterMediaId', null)}>Remove</button>}</div>}
                      </div>
                    </div>;
                  })()}
                </Field>
                <Field name="photoCaption" label="Placeholder caption" optional hint="Shown on the grey placeholder while there is no hero photo."><input className="input" value={form.photoCaption} onChange={(e) => set('photoCaption', e.target.value)} maxLength={160} disabled={ro} /></Field>
              </PeSection>
            </div>}

            {tab === 'Objectives' && <div className="pe-form">
              {!form.hasDetailPage && <div className="notice n-warn" style={{ margin: '18px 20px 0' }}>These sections appear on the project page. Turn on “Give this project its own page” in Summary to publish them.</div>}
              <PeSection title="Program objectives" desc="What the programme itself sets out to achieve. Separate from AFCD’s strategic objectives (Relationships tab).">
                <ListEditor items={form.programObjectives} max={LIST_MAX} ro={ro} noun="objective" err={errors.programObjectives}
                  blank={{ title: '', text: '' }} onChange={(v) => set('programObjectives', v)}
                  render={(o, upd, i) => <>
                    <input className="input" aria-label={`Objective ${i + 1} title`} placeholder="Objective, e.g. Train young people in civic leadership" value={o.title} maxLength={160} disabled={ro} onChange={(e) => upd({ ...o, title: e.target.value })} />
                    <textarea className="textarea" style={{ minHeight: 56 }} aria-label={`Objective ${i + 1} details`} placeholder="Details (optional)" value={o.text} maxLength={600} disabled={ro} onChange={(e) => upd({ ...o, text: e.target.value })} />
                  </>} />
              </PeSection>
            </div>}

            {tab === 'Outcomes' && <div className="pe-form">
              {!form.hasDetailPage && <div className="notice n-warn" style={{ margin: '18px 20px 0' }}>These sections appear on the project page. Turn on “Give this project its own page” in Summary to publish them.</div>}
              <PeSection title="Outcomes" desc="What changed. Use real, verified results only. A figure is optional, e.g. “120 participants”.">
                <ListEditor items={form.outcomes} max={LIST_MAX} ro={ro} noun="outcome" err={errors.outcomes}
                  blank={{ title: '', text: '', figure: '' }} onChange={(v) => set('outcomes', v)}
                  render={(o, upd, i) => <>
                    <div className="pe-li-row">
                      <input className="input pe-li-fig" aria-label={`Outcome ${i + 1} figure`} placeholder="Figure (optional)" value={o.figure} maxLength={40} disabled={ro} onChange={(e) => upd({ ...o, figure: e.target.value })} />
                      <input className="input" aria-label={`Outcome ${i + 1} title`} placeholder="Outcome, e.g. Youth-led initiatives launched" value={o.title} maxLength={160} disabled={ro} onChange={(e) => upd({ ...o, title: e.target.value })} />
                    </div>
                    <textarea className="textarea" style={{ minHeight: 56 }} aria-label={`Outcome ${i + 1} details`} placeholder="Details (optional)" value={o.text} maxLength={600} disabled={ro} onChange={(e) => upd({ ...o, text: e.target.value })} />
                  </>} />
              </PeSection>
              <PeSection title="Results text" desc="The earlier free-text results. The page uses it while there are no outcome cards above.">
                <Field name="results" label="Results" optional hint="What changed? Use verified facts only." err={errors.results} count={[form.results.length, 2000]}><textarea className="textarea" value={form.results} onChange={(e) => set('results', e.target.value)} maxLength={2000} disabled={ro} /></Field>
              </PeSection>
            </div>}

            {tab === 'Activities' && <div className="pe-form">
              {!form.hasDetailPage && <div className="notice n-warn" style={{ margin: '18px 20px 0' }}>These sections appear on the project page. Turn on “Give this project its own page” in Summary to publish them.</div>}
              <PeSection title="Program activities" desc="What actually happened, each with its own photo gallery. Drag cards or photos to reorder; the first photo is the main one. The page shows 3 photos per activity, then “+N”. Photos need alt text and confirmed rights before review.">
                <ActivityList items={form.activityItems} onChange={(v) => set('activityItems', v)} ro={ro} err={errors.activityItems}
                  media={media} addMedia={(ms) => setMedia((x) => ({ ...x, ...Object.fromEntries(ms.map((m) => [m.id, { ...x[m.id], ...m }])) }))}
                  onPickPhotos={(i) => { setActPick(i); setDialog('activity'); }} canEditMedia={can('media.update')} publications={pubsAll} />
              </PeSection>
              <PeSection title="Activities text" desc="The earlier free-text activities. The page uses it while there are no activity cards above.">
                <Field name="activities" label="Activities" optional hint="What actually happened?" err={errors.activities} count={[form.activities.length, 2000]}><textarea className="textarea" value={form.activities} onChange={(e) => set('activities', e.target.value)} maxLength={2000} disabled={ro} /></Field>
              </PeSection>
            </div>}

            {tab === 'Events' && <div className="pe-form">
              <PeSection title="Related events" desc="Events linked to this project appear at the end of its page. Link an event to the project from the event itself.">
                {!data?.linkedEvents?.length ? <p className="pe-empty">No events are linked to this project yet.</p>
                  : <ul className="pe-events">{data.linkedEvents.map((ev) => <li key={ev.id}><Link to={`/studio/events/${ev.id}`} className="pe-event">
                    <span className="pe-event-d">{fmtDay(ev.startDate)}</span><span className="pe-event-t"><b>{ev.title}</b><small>{ev.live ? 'On the website' : 'Not published'}</small></span>
                    <span className="pills">{ev.live && ev.status !== 'published' && <LiveBadge />}<Badge s={ev.status} /></span></Link></li>)}</ul>}
                {can('event.read') && <Link to="/studio/events" className="btn btn-sm" style={{ justifySelf: 'start' }}><Icon n="calendar" />Open Events</Link>}
              </PeSection>
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

            {tab === 'Gallery' && <div className="form">
              <Field group name="galleryMediaIds" label="Gallery" optional hint="The first two photos are also cover photos 2 and 3 at the top of the page.">
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
                <div style={{ color: '#006621', fontSize: 12.5 }}>{site.host} › {fileName ?? 'projects.html'}</div>
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

      {dialog === 'logo' && <MediaPicker onClose={() => setDialog(null)} onPick={(items) => { const m = items[0]; if (m) { setMedia((x) => ({ ...x, [m.id]: m })); set('logoMediaId', m.id); } setDialog(null); }} />}
      {dialog === 'hero' && <MediaPicker multiple onClose={() => setDialog(null)} onPick={(items) => {
        // fill the cover: the main photo first, then the free places among the first gallery photos (four, or three with a poster)
        setMedia((x) => ({ ...x, ...Object.fromEntries(items.map((m) => [m.id, m])) }));
        const extra = form.posterMediaId ? 3 : 4;
        const ids = items.map((m) => m.id).filter((id) => id !== form.heroMediaId && !form.galleryMediaIds.slice(0, extra).includes(id));
        const hero = form.heroMediaId ?? ids.shift() ?? null;
        const front = form.galleryMediaIds.slice(0, extra); const add = ids.slice(0, extra - front.length);
        const gallery = [...front, ...add, ...form.galleryMediaIds.slice(extra).filter((id) => !add.includes(id))].slice(0, 12);
        set('heroMediaId', hero); set('galleryMediaIds', gallery); setDialog(null); }} />}
      {dialog === 'poster' && <MediaPicker onClose={() => setDialog(null)} onPick={(items) => { const m = items[0]; if (m) { setMedia((x) => ({ ...x, [m.id]: m })); set('posterMediaId', m.id); } setDialog(null); }} />}
      {dialog === 'gallery' && <MediaPicker multiple onClose={() => setDialog(null)} onPick={(items) => { setMedia((x) => ({ ...x, ...Object.fromEntries(items.map((m) => [m.id, m])) })); set('galleryMediaIds', [...new Set([...form.galleryMediaIds, ...items.map((m) => m.id)])].slice(0, 12)); setDialog(null); }} />}

      {dialog === 'activity' && actPick >= 0 && <MediaPicker multiple onClose={() => { setDialog(null); setActPick(-1); }} onPick={(items) => {
        setMedia((x) => ({ ...x, ...Object.fromEntries(items.map((m) => [m.id, m])) }));
        set('activityItems', form.activityItems.map((a, j) => j === actPick ? { ...a, mediaIds: [...new Set([...a.mediaIds, ...items.map((m) => m.id)])].slice(0, 12) } : a));
        setDialog(null); setActPick(-1); }} />}
      {fixing && <PhotoFix item={fixing} onClose={() => setFixing(null)} onSaved={(m) => { setMedia((x) => ({ ...x, [m.id]: { ...x[m.id], ...m } })); setFixing(null); toast('Photo details saved'); if (!isNew && !dirty) load().catch(() => {}); }} />}
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
  primaryPillarKey: 'Primary pillar', objectiveRefs: 'Strategic objectives', partnerSlugs: 'Partners', heroMediaId: 'Cover photos', logoMediaId: 'Project logo', logoStyle: 'Logo framing', posterMediaId: 'Poster', galleryMediaIds: 'Gallery', photoCaption: 'Placeholder caption',
  seoTitle: 'SEO title', seoDescription: 'Meta description',
  programObjectives: 'Program objectives', outcomes: 'Outcomes', activityItems: 'Program activities',
};

/** Complete a photo's alt text and usage rights without leaving the project. Saves to the Media Library. */
function PhotoFix({ item, onClose, onSaved }: { item: MediaItem; onClose: () => void; onSaved: (m: MediaItem) => void }) {
  const [alt, setAlt] = useState(item.alt ?? ''); const [rights, setRights] = useState(!!item.rightsConfirmed);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = alt.trim().length >= 3 && rights;
  async function save() {
    setBusy(true); setErr('');
    try { const m = await patch<MediaItem>(`/media/${item.id}`, { alt: alt.trim(), rightsConfirmed: rights }); onSaved(m); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return <Modal size="sm" title="Photo details" onClose={() => !busy && onClose()} footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
    <div className="modal-b stack">
      <img src={item.url} alt="" className="pe-fix-img" />
      <small className="muted" style={{ overflowWrap: 'anywhere' }}>{item.originalName}</small>
      <label className="field"><span className="pe-label">Alt text</span>
        <textarea className="textarea" style={{ minHeight: 64 }} value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={250} autoFocus placeholder="Describe what the photo shows, e.g. Young people working in groups at a leadership workshop" />
        <span className="between"><small>Say what matters in the photo. No “image of…”.</small><small className="count-hint">{alt.length} / 250</small></span>
      </label>
      <label className="check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /><span><b>AFCD has the right to publish this photo</b><br /><small className="muted">and the people shown agreed to appear on the website.</small></span></label>
      {err && <div className="notice n-bad" role="alert">{err}</div>}
    </div>
  </Modal>;
}

const fmtDay = (d: string) => { const t = new Date(`${d.slice(0, 10)}T12:00:00Z`); return isNaN(+t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

/** A reorderable list of small cards: add, edit, move up/down, remove (with confirm when the item has content). */
function ListEditor<T extends object>({ items, max, ro, noun, blank, onChange, render, err }: {
  items: T[]; max: number; ro: boolean; noun: string; blank: T; err?: string;
  onChange: (v: T[]) => void; render: (item: T, update: (v: T) => void, i: number) => ReactNode;
}) {
  const move = (i: number, d: number) => { const a = [...items]; [a[i], a[i + d]] = [a[i + d], a[i]]; onChange(a); };
  const filled = (x: T) => Object.values(x).some((v) => typeof v === 'string' ? v.trim() : v);
  return <div className="pe-list" role="group" aria-label={`${noun[0].toUpperCase()}${noun.slice(1)}s`}>
    {items.length === 0 && <p className="pe-empty">None yet. The page shows its usual sections until you add some.</p>}
    {items.map((it, i) => <div key={i} className="pe-li">
      <span className="pe-fact-n" aria-hidden="true">{i + 1}</span>
      <div className="pe-li-body">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}</div>
      {!ro && <span className="pe-fact-tools pe-li-tools">
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon n="chev" style={{ transform: 'rotate(-90deg)' }} /></button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Move ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon n="chev" style={{ transform: 'rotate(90deg)' }} /></button>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => { if (!filled(it) || confirm(`Remove this ${noun}?`)) onChange(items.filter((_, j) => j !== i)); }}><Icon n="x" /></button>
      </span>}
    </div>)}
    {err && <small className="err" role="alert">{err}</small>}
    {!ro && <div className="pe-li-add">{items.length < max ? <button type="button" className="btn btn-sm" onClick={() => onChange([...items, { ...blank }])}><Icon n="plus" />Add {noun}</button> : <small className="muted">Maximum {max} reached.</small>}<small className="count-hint">{items.length} of {max}</small></div>}
  </div>;
}

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
