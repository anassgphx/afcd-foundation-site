// Project workspace: tabs for content, an inspector with status, readiness, workflow actions and history.
import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { api, post, put, ApiError } from '../api.ts';
import { Badge, Icon, LiveBadge, Modal, ago, fmtDate, navigate, useCan, useMe, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Loading } from './Dashboard.tsx';

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
const TABS = ['Overview', 'Content', 'Relationships', 'Media', 'SEO'] as const;
const TAB_FIELDS: Record<string, string[]> = {
  Overview: ['name', 'slug', 'reference', 'category', 'summary', 'location', 'years', 'extraFacts', 'sort'],
  Content: ['context', 'approach', 'activities', 'results'],
  Relationships: ['pillarKeys', 'primaryPillarKey', 'objectiveRefs'],
  Media: ['heroMediaId', 'galleryMediaIds', 'photoCaption'],
  SEO: ['seoTitle', 'seoDescription'],
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

  const load = useCallback(async () => {
    const [p, o] = await Promise.all([api<Pillar[]>('/pillars'), api<Objective[]>('/objectives')]);
    setPillars(p); setObjectives(o);
    if (isNew) return;
    const d = await api<Loaded>(`/projects/${id}`);
    const primary = d.pillars.find((x) => x.isPrimary)?.key ?? d.pillars[0]?.key ?? '';
    setData(d);
    setForm({ ...pick(d), pillarKeys: d.pillars.map((x) => x.key), primaryPillarKey: primary, galleryMediaIds: d.gallery.map((g) => g.id) });
    setMedia(Object.fromEntries([d.hero, ...d.gallery].filter(Boolean).map((m) => [m!.id, m!])));
    setDirty(false);
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
    setDirty(true); setErrors((e) => ({ ...e, [k]: '' }));
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

  if (!isNew && !data && !banner) return <Loading />;
  const tabErr = (t: string) => TAB_FIELDS[t].some((f) => errors[f]);
  const ro = !editable || (seoOnly);
  const fileName = form.hasDetailPage ? `project-${form.slug || 'your-project'}.html` : null;

  return (
    <>
      <div className="actionbar">
        <button className="btn btn-ghost icon-btn" onClick={() => navigate('/studio/projects')} aria-label="Back to projects"><Icon n="chev" style={{ transform: 'rotate(180deg)' }} /></button>
        <h1>{form.name || 'New project'}</h1>
        {!isNew && <span className="pills">{live && status !== 'published' && <LiveBadge />}<Badge s={status} /></span>}
        {dirty && <span className="muted" style={{ fontSize: 12 }}>Unsaved changes</span>}
        <span className="spacer" />
        {!isNew && <button className="btn" onClick={preview} disabled={!!busy}><Icon n="eye" />{busy === 'preview' ? 'Building preview…' : 'Preview'}</button>}
        {editable && <button className="btn btn-primary" onClick={() => save()} disabled={!!busy || (!dirty && !isNew)}><Icon n="save" />{busy === 'save' ? 'Saving…' : isNew ? 'Create draft' : 'Save draft'}</button>}
      </div>

      {banner && <div className={`notice ${banner.kind}`} style={{ marginBottom: 14 }} role="alert"><div>{banner.text}</div></div>}

      <div className="editor">
        <section className="card">
          <div className="tabs" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}{tabErr(t) && <span className="err-dot" />}</button>)}</div>
          {locked && <div className="notice n-info" style={{ margin: '14px 18px 0' }}>{status === 'in_review' ? 'This project is in review, so it is read-only. Withdraw it to make changes.' : 'This project is archived. Restore it to edit.'}</div>}
          {seoOnly && <div className="notice n-info" style={{ margin: '14px 18px 0' }}>Your role can edit the SEO tab only.</div>}
          <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {tab === 'Overview' && <div className="form">
              <Field label="Project name" err={errors.name}><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={160} disabled={ro} aria-invalid={!!errors.name} /></Field>
              <Field label="One-line summary" hint="Shown on project cards, the listing and as the page intro." err={errors.summary} count={[form.summary.length, 400]}>
                <textarea className="textarea" style={{ minHeight: 64 }} value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={400} disabled={ro} />
              </Field>
              <div className="row">
                <Field label="Category" hint="e.g. Youth Leadership, Climate Action" err={errors.category}><input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={80} disabled={ro} /></Field>
                <Field label="Internal reference" optional err={errors.reference}><input className="input" value={form.reference} onChange={(e) => set('reference', e.target.value)} maxLength={40} disabled={ro} /></Field>
              </div>
              <div className="row">
                <Field label="Location" optional><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={120} disabled={ro} placeholder="e.g. Ait Ourir" /></Field>
                <Field label="Years" optional><input className="input" value={form.years} onChange={(e) => set('years', e.target.value)} maxLength={60} disabled={ro} placeholder="e.g. 2020 – 2021" /></Field>
              </div>
              <Field group label="Extra facts" optional hint="Short label and value pairs shown in the facts bar (max 4).">
                <div className="stack">
                  {form.extraFacts.map((f, i) => (
                    <div key={i} className="row" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
                      <input className="input" placeholder="Label" value={f.label} maxLength={40} disabled={ro} onChange={(e) => set('extraFacts', form.extraFacts.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                      <input className="input" placeholder="Value" value={f.value} maxLength={120} disabled={ro} onChange={(e) => set('extraFacts', form.extraFacts.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                      <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove fact" onClick={() => set('extraFacts', form.extraFacts.filter((_, j) => j !== i))}><Icon n="x" /></button>
                    </div>))}
                  {form.extraFacts.length < 4 && !ro && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => set('extraFacts', [...form.extraFacts, { label: '', value: '' }])}><Icon n="plus" />Add fact</button>}
                </div>
              </Field>
              <label className="check"><input type="checkbox" checked={form.hasDetailPage} onChange={(e) => set('hasDetailPage', e.target.checked)} disabled={ro} /><span><b>Give this project its own page</b><br /><small className="muted">Off: the project only appears in listings and on pillar pages.</small></span></label>
              <div className="row">
                <Field label="Page address" hint={live ? 'The address of a live page cannot change here.' : 'Lower-case letters, numbers and hyphens.'} err={errors.slug}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="mono muted">project-</span><input className="input mono" aria-label="Page address" value={form.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} disabled={ro || live} aria-invalid={!!errors.slug} /><span className="mono muted">.html</span></div>
                </Field>
                <Field label="Order in listings" hint="Lower numbers come first."><input className="input" type="number" min={0} max={10000} value={form.sort} onChange={(e) => set('sort', Number(e.target.value))} disabled={ro} /></Field>
              </div>
            </div>}

            {tab === 'Content' && <div className="form">
              {!form.hasDetailPage && <div className="notice n-warn">These sections appear on the project page. Turn on “Give this project its own page” in Overview to publish them.</div>}
              {([['context', 'Context', 'What need or situation did the project respond to?'], ['approach', 'Approach', 'How did AFCD and its partners work?'], ['activities', 'Activities', 'What actually happened?'], ['results', 'Results', 'What changed? Use verified facts only.']] as const).map(([k, l, h]) => (
                <Field key={k} label={l} hint={h} err={errors[k]} count={[form[k].length, 2000]}><textarea className="textarea" value={form[k]} onChange={(e) => set(k, e.target.value)} maxLength={2000} disabled={ro} /></Field>
              ))}
            </div>}

            {tab === 'Relationships' && <div className="form">
              <Field group label="Strategic pillars" hint="Tick every pillar the project serves, then choose the primary one. The project appears on each linked pillar page." err={errors.pillarKeys || errors.primaryPillarKey}>
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
              <Field group label="Strategic objectives" optional hint="Shown on the project page. If none are chosen, the objectives of the primary pillar are shown.">
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
              <Field group label="Hero photo" optional hint="Shown full width at the top of the project page. Needs alt text and confirmed rights before publishing." err={errors.heroMediaId}>
                {form.heroMediaId && media[form.heroMediaId] ? (
                  <div className="thumbs"><div className="thumb" style={{ width: 260 }}><img src={media[form.heroMediaId].url} alt={media[form.heroMediaId].alt} />{!ro && <button type="button" aria-label="Remove hero photo" onClick={() => set('heroMediaId', null)}>×</button>}</div></div>
                ) : <div className="muted">No hero photo. A grey placeholder is shown.</div>}
                {!ro && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setDialog('hero')}><Icon n="image" />{form.heroMediaId ? 'Change' : 'Choose'} hero photo</button>}
              </Field>
              <Field label="Placeholder caption" optional hint="Shown on the grey placeholder while there is no hero photo."><input className="input" value={form.photoCaption} onChange={(e) => set('photoCaption', e.target.value)} maxLength={160} disabled={ro} /></Field>
              <Field group label="Gallery" optional hint="The first three photos appear in the gallery section of the page.">
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
              <Field label="SEO title" optional hint="Leave empty to use the project name." count={[form.seoTitle.length, 70]} err={errors.seoTitle}><input className="input" value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} maxLength={70} /></Field>
              <Field label="Meta description" optional hint="Leave empty to use the summary. About 150 characters." count={[form.seoDescription.length, 170]} err={errors.seoDescription}><textarea className="textarea" style={{ minHeight: 72 }} value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} maxLength={170} /></Field>
              <div className="card" style={{ padding: 14, background: 'var(--sunken)' }}>
                <small className="muted">Search result preview</small>
                <div style={{ marginTop: 6, color: '#1a0dab', fontSize: 17 }}>{(form.seoTitle || form.name || 'Project name')} · AFCD Foundation</div>
                <div style={{ color: '#006621', fontSize: 12.5 }}>afcdfoundation.org › {fileName ?? 'projects.html'}</div>
                <div style={{ color: 'var(--ink-2)' }}>{(form.seoDescription || form.summary || 'The summary appears here.').slice(0, 160)}</div>
              </div>
              <div className="notice n-info">The current site builder still sets page titles and descriptions from the project name and summary. These SEO fields are stored and versioned now, and are used once the SEO Studio phase connects them to the build.</div>
            </div></fieldset>}
          </fieldset>
        </section>

        <aside className="inspector">
          <section className="card">
            <div className="card-h"><h2>Status</h2>{!isNew && <Badge s={status} />}</div>
            <div className="card-b stack">
              <dl className="kv">
                <dt>Website</dt><dd>{live ? <>Live{status !== 'published' ? ' · newer draft not published' : ''}</> : 'Not on the website'}</dd>
                {data?.publishedAt && <><dt>Published</dt><dd>{fmtDate(data.publishedAt)}</dd></>}
                <dt>Page</dt><dd className="mono">{fileName ?? 'Listing only'}</dd>
                {data && <><dt>Last saved</dt><dd>{ago(data.updatedAt)}</dd></>}
              </dl>
              {live && fileName && <a className="btn btn-sm" href={me.siteUrl + fileName} target="_blank" rel="noopener"><Icon n="ext" />Open live page</a>}
            </div>
          </section>

          {!isNew && <section className="card">
            <div className="card-h"><h2>Workflow</h2></div>
            <div className="card-b stack">
              {data && data.problems.length > 0 && !['archived'].includes(status) && <div className="notice n-warn"><div><b>Before review</b><ul>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
              <Steps status={status} live={live} />
              {['draft', 'changes_requested'].includes(status) && can('project.update') && <button className="btn btn-primary" disabled={!!busy} onClick={() => act('submit')}><Icon n="send" />{busy === 'submit' ? 'Sending…' : 'Submit for review'}</button>}
              {status === 'in_review' && can('project.approve') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('approve')}><Icon n="check" />Approve</button>}
              {status === 'in_review' && can('project.review') && <button className="btn" disabled={!!busy} onClick={() => setDialog('changes')}>Request changes</button>}
              {status === 'approved' && can('project.publish') && <button className="btn btn-ok" disabled={!!busy} onClick={() => setDialog('publish')}><Icon n="rocket" />Publish to website</button>}
              {status === 'approved' && !can('project.publish') && <div className="notice n-info">Approved. A website administrator will publish it.</div>}
              {['in_review', 'approved'].includes(status) && can('project.update') && <button className="btn btn-ghost" disabled={!!busy} onClick={() => act('withdraw')}><Icon n="undo" />Withdraw to draft</button>}
              {live && can('project.publish') && <button className="btn btn-ghost btn-danger" disabled={!!busy} onClick={() => setDialog('unpublish')}>Remove from website</button>}
              {!live && status !== 'archived' && can('project.archive') && <button className="btn btn-ghost" disabled={!!busy} onClick={() => { if (confirm('Archive this project? It stays in Studio and can be restored.')) act('archive'); }}><Icon n="archive" />Archive</button>}
              {status === 'archived' && can('project.archive') && <button className="btn" onClick={() => act('restore')}><Icon n="undo" />Restore as draft</button>}
            </div>
          </section>}

          {data && <section className="card">
            <div className="card-h"><h2>History</h2></div>
            <div className="card-b"><ol className="timeline">
              {mergeHistory(data).map((h) => <li key={h.key}><b>{h.title}</b>{h.body && <q>{h.body}</q>}<small>{fmtDate(h.at)}</small>
                {h.revId && h.rev && can('project.update') && status !== 'in_review' && <button className="btn btn-sm btn-ghost" style={{ marginTop: 4, padding: 0, height: 'auto' }} onClick={() => restore(h.revId!, h.rev!)}>Restore this version</button>}
              </li>)}
            </ol></div>
          </section>}
        </aside>
      </div>

      {dialog === 'hero' && <MediaPicker onClose={() => setDialog(null)} onPick={(items) => { const m = items[0]; if (m) { setMedia((x) => ({ ...x, [m.id]: m })); set('heroMediaId', m.id); } setDialog(null); }} />}
      {dialog === 'gallery' && <MediaPicker multiple onClose={() => setDialog(null)} onPick={(items) => { setMedia((x) => ({ ...x, ...Object.fromEntries(items.map((m) => [m.id, m])) })); set('galleryMediaIds', [...new Set([...form.galleryMediaIds, ...items.map((m) => m.id)])].slice(0, 12)); setDialog(null); }} />}

      {dialog === 'preview' && <PreviewModal url={previewUrl} onClose={() => setDialog(null)} />}

      {dialog === 'approve' && <Modal size="sm" title="Approve this project?" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => act('approve', { comment })}>{busy ? 'Approving…' : 'Approve'}</button></>}>
        <div className="modal-b stack"><p style={{ margin: 0 }}>The current version is frozen for publishing. Later edits create a new draft that needs approval again.</p>
          <Field label="Note for the team" optional><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field></div>
      </Modal>}
      {dialog === 'changes' && <Modal size="sm" title="Request changes" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!comment.trim() || !!busy} onClick={() => act('request_changes', { comment })}>Send to author</button></>}>
        <div className="modal-b"><Field label="What needs to change?"><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} autoFocus /></Field></div>
      </Modal>}
      {dialog === 'publish' && <Modal size="sm" title="Publish to the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-ok" disabled={!!busy} onClick={() => publish('publish')}><Icon n="rocket" />{busy ? 'Publishing and checking…' : 'Publish now'}</button></>}>
        <div className="modal-b stack"><p style={{ margin: 0 }}>This rebuilds the public site with the approved version and checks the result before confirming:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{fileName && <li>the project page <span className="mono">{fileName}</span></li>}<li>the Projects listing</li><li>{form.pillarKeys.length > 1 ? `${form.pillarKeys.length} pillar pages` : 'its pillar page'}</li><li>the sitemap</li></ul>
          {busy && <div className="notice n-info">Building the website… this can take up to a minute.</div>}
          <small className="muted">This updates the website files in this repository. Pushing them to the hosted site is a separate, authorized step.</small></div>
      </Modal>}
      {dialog === 'unpublish' && <Modal size="sm" title="Remove from the website?" onClose={() => !busy && setDialog(null)} footer={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={() => publish('unpublish')}>{busy ? 'Removing…' : 'Remove from website'}</button></>}>
        <div className="modal-b"><p style={{ margin: 0 }}>The project page and its listing cards are removed from the site. The project stays in Studio as a draft with its full history.</p></div>
      </Modal>}
    </>
  );
}

/** A single control is wrapped in <label> so it gets an accessible name; groups of controls get role=group + aria-label. */
function Field({ label, hint, err, optional, count, group, children }: { label: string; hint?: string; err?: string; optional?: boolean; count?: [number, number]; group?: boolean; children: ReactNode }) {
  // Give the control a short accessible name (the label alone, not the hint or counter).
  const named = group ? children : Children.map(children, (ch) => isValidElement(ch) && typeof ch.type === 'string' && ['input', 'textarea', 'select'].includes(ch.type)
    ? cloneElement(ch as ReactElement<Record<string, unknown>>, { 'aria-label': label }) : ch);
  const inner = <><span>{label}{optional && <em> · optional</em>}</span>{named}
    {(hint || count) && <span className="between">{hint ? <small>{hint}</small> : <span />}{count && <small className="count-hint">{count[0]} / {count[1]}</small>}</span>}
    {err && <small className="err" role="alert">{err}</small>}</>;
  return group ? <div className="field" role="group" aria-label={label}>{inner}</div> : <label className="field">{inner}</label>;
}

function Steps({ status, live }: { status: string; live: boolean }) {
  const order = ['draft', 'in_review', 'approved', 'published'];
  const idx = status === 'changes_requested' ? 0 : order.indexOf(status);
  return <ol style={{ display: 'flex', gap: 6, margin: 0, padding: 0, listStyle: 'none' }} aria-label="Workflow progress">
    {['Draft', 'Review', 'Approved', 'Live'].map((l, i) => <li key={l} style={{ flex: 1 }}><div style={{ height: 4, borderRadius: 4, background: i <= idx || (i === 3 && live) ? 'var(--accent)' : 'var(--line)' }} /><small className="muted">{l}</small></li>)}
  </ol>;
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
