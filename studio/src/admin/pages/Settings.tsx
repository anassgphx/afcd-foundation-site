// Settings Center: one workspace for Studio and website settings. A compact category list, settings search and a summary
// strip of real states. Every value shown comes from the server; categories that are not built yet say so plainly.
import { useEffect, useMemo, useState } from 'react';
import { api, post } from '../api.ts';
import { Icon, Link, Modal, ago, fmtDate, navigate, usePath, useToast } from '../ui.tsx';
import { MediaPicker, type MediaItem } from './Media.tsx';
import { Checks, Dot, EFFECT, F, Loading, PanelHead, SaveBar, useForm, type Effect } from './settingsKit.tsx';
import { BackupsPanel, DomainPanel, LocalizationPanel, MaintenancePanel, MediaPanel, NotificationsPanel, PerformancePanel, SecurityPanel, SeoPanel, TemplatesPanel } from './SettingsMore.tsx';
import '../settings.css';

type Category = { id: string; label: string; icon: string; group: string; kind: 'edit' | 'facts'; summary: string; admin?: boolean; link?: { to: string; label: string } };
type FieldDef = { category: string; key: string; label: string; keywords: string; effect: Effect; admin?: boolean };
type Img = { id: string; url: string; width: number; height: number; alt: string; name: string; rightsConfirmed: boolean } | null;
type CatState<T> = { draft: T; published: T | null; defaults: T; unpublished: string[]; updatedAt: string | null; publishedAt: string | null };
type General = { siteName: string; canonicalUrl: string; environment: 'preview' | 'production' };
type Branding = { logoMediaId: string | null; logoLightMediaId: string | null; faviconMediaId: string | null; socialImageMediaId: string | null; socialImageAlt: string; themeColor: '#000000' | '#FFFFFF' };
type Contact = { phone: string; generalEmail: string; boardEmail: string; social: { facebook: string; instagram: string; linkedin: string } };
type Mail = { enabled: boolean; host: string; port: number; security: 'starttls' | 'tls' | 'none'; user: string; fromName: string; fromEmail: string; replyTo: string; hasPassword: boolean; ready: boolean; keySource: string; passwordState: string; updatedAt: string | null; updatedBy: string | null };
type Rev = { id: string; category: string; changed: string[]; summary: string; restoredFrom: string | null; actorEmail: string | null; actorName: string | null; createdAt: string };
type Data = {
  categories: Category[]; fields: FieldDef[];
  permissions: { update: boolean; admin: boolean; publish: boolean };
  summary: { unpublished: number; publishedAt: string | null; buildSupport: boolean; email: 'ready' | 'incomplete' | 'off'; lastTest: { at: string; ok: boolean; actorEmail: string; summary: string; source: 'inbox' | 'settings' } | null; lastChange: Rev | null };
  badges: Record<string, string | null>;
  site: { categories: { general: CatState<General>; branding: CatState<Branding>; contact: CatState<Contact> }; media: Record<'logo' | 'logoLight' | 'favicon' | 'socialImage', Img> };
  identity: { published: { alternateName: string; legalName: string; description: string; foundingDate: string; email: string; telephone: string; sameAs: string[] } | null; status: string | null; publishedAt: string | null };
  studio: { origin: string; publicSiteUrl: string };
  email: Mail | { ready: boolean };
};
import { PUBLIC_EMAILS } from '../../server/identity.ts';
import { AREA_GROUPS, AREA_TITLE, settingsArea } from './settingsArea.ts';
const GROUPS = ['Organization', 'Communication', 'Website', 'System'];
/** A badge in the category list: only real states from the server. */
function Badge({ v, id }: { v: string | null | undefined; id: string }) {
  if (!v) return null;
  if (v === 'unpublished') return <i className="set-badge" title="Saved changes not yet on the website">Unpublished</i>;
  if (v === 'problem') return <i className="set-badge warn" title="The last DNS check found problems">Check</i>;
  if (v === 'on' || v === 'ok') return <i className="set-badge-dot on" title={id === 'domain' ? 'Last DNS check passed' : 'On'} aria-label={id === 'domain' ? 'Last check passed' : 'On'} />;
  if (v === 'off') return <i className="set-badge-dot" title="Off" aria-label="Off" />;
  return <i className="set-badge n">{v}</i>;
}

export function SettingsPage() {
  const path = usePath();
  const area = settingsArea(path); const A = AREA_TITLE[area];   // Website settings or System (pages/settingsArea.ts)
  const cat = path.match(/^\/studio\/settings\/([a-z]+)/)?.[1] ?? A.first;
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<Data>('/settings').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { document.title = `${A.title} · AFCD Studio`; }, [A.title]);
  // phones: the category list is one scrolling row; keep the current category in view
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.set-nav'), on = nav?.querySelector<HTMLElement>('a.on');
    if (nav && on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - nav.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
  }, [cat, !!data]);
  if (err) return <div className="notice n-warn"><Icon n="alert" />{err}</div>;
  if (!data) return <div className="stack"><div className="skeleton" style={{ height: 28, width: 200 }} /><div className="skeleton" style={{ height: 64 }} /><div className="skeleton" style={{ height: 320 }} /></div>;
  const current = data.categories.find((c) => c.id === cat) ?? data.categories.find((c) => c.id === A.first) ?? data.categories[0];
  return (
    <div className="set">
      <div className="page-h set-head">
        <div><h1>{A.title}</h1><p>{A.intro}</p></div>
        <SettingsSearch fields={data.fields} categories={data.categories} />
      </div>
      <SummaryStrip data={data} onPublished={load} />
      <div className="set-body">
        <nav className="set-nav" aria-label="Settings categories">
          {GROUPS.filter((g) => AREA_GROUPS[area].includes(g)).map((g) => (
            <div key={g} className="set-nav-g" role="group" aria-label={g}>
              <span className="set-nav-gl">{g}</span>
              {data.categories.filter((c) => c.group === g).map((c) => {
                const on = cat !== 'history' && c.id === current.id;
                return <Link key={c.id} to={`/studio/settings/${c.id}`} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
                  <Icon n={c.icon} /><span>{c.label}</span>{c.admin && !data.permissions.admin ? <Icon n="lock" className="set-nav-lock" aria-label="Administrators only" /> : <Badge v={data.badges[c.id]} id={c.id} />}
                </Link>;
              })}
            </div>))}
          {area === 'website' && <div className="set-nav-g set-nav-hist"><Link to="/studio/settings/history" className={cat === 'history' ? 'on' : ''} aria-current={cat === 'history' ? 'page' : undefined}><Icon n="history" /><span>History</span></Link></div>}
        </nav>
        <section className="set-panel" aria-labelledby="set-title">
          {cat === 'history' ? <History admin={data.permissions.admin} onRestored={load} />
            : current.id === 'general' ? <GeneralPanel data={data} onSaved={load} />
            : current.id === 'branding' ? <BrandingPanel data={data} onSaved={load} />
            : current.id === 'contact' ? <ContactPanel data={data} onSaved={load} />
            : current.id === 'email' ? <EmailPanel data={data} onSaved={load} />
            : current.id === 'templates' ? <TemplatesPanel c={current} onSaved={load} />
            : current.id === 'notifications' ? <NotificationsPanel c={current} perms={data.permissions} />
            : current.id === 'domain' ? <DomainPanel c={current} perms={data.permissions} onChecked={load} />
            : current.id === 'seo' ? <SeoPanel c={current} />
            : current.id === 'localization' ? <LocalizationPanel c={current} />
            : current.id === 'media' ? <MediaPanel c={current} />
            : current.id === 'performance' ? <PerformancePanel c={current} />
            : current.id === 'security' ? <SecurityPanel c={current} perms={data.permissions} />
            : current.id === 'backups' ? <BackupsPanel c={current} perms={data.permissions} />
            : current.id === 'maintenance' ? <MaintenancePanel c={current} perms={data.permissions} />
            : <AdvancedPanel admin={data.permissions.admin} />}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Search and summary
function SettingsSearch({ fields, categories }: { fields: FieldDef[]; categories: Category[] }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const cats = categories.filter((c) => `${c.label} ${c.summary}`.toLowerCase().includes(t)).map((c) => ({ category: c.id, key: '', label: c.label, sub: 'Category' }));
    const fs = fields.filter((f) => `${f.label} ${f.keywords}`.toLowerCase().includes(t)).map((f) => ({ category: f.category, key: f.key, label: f.label, sub: categories.find((c) => c.id === f.category)?.label ?? '' }));
    return [...fs, ...cats].slice(0, 8);
  }, [q, fields, categories]);
  const go = (h: { category: string; key: string }) => {
    setOpen(false); setQ(''); navigate(`/studio/settings/${h.category}`);
    if (h.key) setTimeout(() => { const el = document.getElementById(`set-${h.key}`); el?.scrollIntoView({ block: 'center' }); el?.focus(); el?.closest('.set-f')?.classList.add('flash'); setTimeout(() => el?.closest('.set-f')?.classList.remove('flash'), 1400); }, 120);
  };
  return (
    <div className="set-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label className="search"><Icon n="search" /><span className="sr-only">Search settings</span>
        <input className="input" placeholder="Search settings" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0]); if (e.key === 'Escape') setOpen(false); }} role="combobox" aria-expanded={open && hits.length > 0} aria-controls="set-search-list" /></label>
      {open && q.trim().length >= 2 && <ul id="set-search-list" className="set-search-list" role="listbox">
        {hits.length ? hits.map((h) => <li key={h.category + h.key + h.sub}><button type="button" role="option" aria-selected="false" onClick={() => go(h)}><b>{h.label}</b><small>{h.sub}</small></button></li>)
          : <li className="set-search-none">No setting matches “{q}”.</li>}
      </ul>}
    </div>
  );
}

function SummaryStrip({ data, onPublished }: { data: Data; onPublished: () => void }) {
  const s = data.summary; const toast = useToast();
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const pending = (Object.entries(data.site.categories) as [string, CatState<unknown>][]).filter(([, v]) => v.unpublished.length);
  async function publish() {
    setBusy(true);
    try { await post('/settings/publish'); toast('Settings published. The website was rebuilt and checked.'); setConfirm(false); onPublished(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="set-strip" role="group" aria-label="Settings status">
      <div className="set-tile">
        <small>Website settings</small>
        <b>{s.unpublished ? `${s.unpublished} unpublished change${s.unpublished === 1 ? '' : 's'}` : s.publishedAt ? 'Up to date' : 'Never published'}</b>
        <span className="muted">{s.publishedAt ? `Published ${ago(s.publishedAt)}` : 'The site uses its built-in values.'}</span>
        {data.permissions.publish && s.unpublished > 0 && <button className="btn btn-sm btn-primary" disabled={!s.buildSupport} onClick={() => setConfirm(true)}><Icon n="rocket" />Publish settings</button>}
        {!s.buildSupport && <span className="set-warn">build.mjs has no settings hook: publishing is off.</span>}
      </div>
      <div className="set-tile"><small>Email sending</small><b><Dot on={s.email === 'ready'} />{s.email === 'ready' ? 'Ready' : s.email === 'incomplete' ? 'Incomplete' : 'Off'}</b><span className="muted">{s.email === 'ready' ? 'Inbox replies can be sent.' : 'Inbox replies cannot be sent.'}</span></div>
      <div className="set-tile"><small>Last test email</small>{s.lastTest ? <><b><Dot on={s.lastTest.ok} />{s.lastTest.ok ? 'Accepted' : 'Failed'}</b><span className="muted">{ago(s.lastTest.at)} · {s.lastTest.source === 'inbox' ? 'from the Inbox · ' : ''}{s.lastTest.actorEmail}{s.email !== 'ready' ? ' · sending is now off' : ''}</span></> : <><b>None sent</b><span className="muted">{data.permissions.admin ? 'Send one from Email & SMTP.' : 'Administrators can send one.'}</span></>}</div>
      <div className="set-tile"><small>Last change</small>{s.lastChange ? <><b>{s.lastChange.summary}</b><span className="muted">{ago(s.lastChange.createdAt)} · {s.lastChange.actorName ?? s.lastChange.actorEmail ?? 'unknown'}</span></> : <><b>No changes yet</b><span className="muted">Saved changes appear in History.</span></>}</div>
      {confirm && <Modal title="Publish settings" size="sm" onClose={() => setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={publish}>{busy ? 'Publishing…' : 'Publish and rebuild'}</button></>}>
        <div className="modal-b stack">
          <p style={{ margin: 0 }}>This writes the saved settings to the website and rebuilds every page. Studio checks each page before recording success; if the build fails, the live site is left as it was.</p>
          <ul className="set-changes">{pending.map(([c, v]) => <li key={c}><b>{data.categories.find((x) => x.id === c)?.label}</b>: {v.unpublished.join(', ')}</li>)}</ul>
        </div>
      </Modal>}
    </div>
  );
}
// ---------------------------------------------------------------- General
function GeneralPanel({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const st = data.site.categories.general; const p = data.permissions;
  const f = useForm<General>(st.draft, '/settings/general', onSaved);
  const id = data.identity.published;
  return (
    <>
      <PanelHead title="General" icon="globe" summary="Organization identity and website configuration." />
      <div className="set-card">
        <h3>Organization identity</h3>
        <F id="siteName" label="Site name" effect="publish" error={f.errs.siteName} hint="Used for the site name shared with social networks, the website name in search results and the Organization markup.">
          <input id="set-siteName" className="input" value={f.v.siteName} disabled={!p.update} onChange={(e) => f.setV({ ...f.v, siteName: e.target.value })} aria-invalid={!!f.errs.siteName} />
        </F>
        <div className="set-ro" id="set-identity">
          <div className="between"><b>Legal name, description and founding year</b><Link className="btn btn-sm" to="/studio/seo/schema">Edit in Schema studio</Link></div>
          <p className="muted">These are reviewed in Schema studio before they reach the website, so they are shown here but not edited twice.</p>
          {id ? <dl className="set-dl">
            <dt>Legal name</dt><dd>{id.legalName || <span className="muted">Site default</span>}</dd>
            <dt>Short name</dt><dd>{id.alternateName || <span className="muted">Site default</span>}</dd>
            <dt>Founded</dt><dd>{id.foundingDate || <span className="muted">Site default</span>}</dd>
            <dt>Description</dt><dd>{id.description || <span className="muted">Site default</span>}</dd>
          </dl> : <p className="muted" style={{ margin: 0 }}>Schema studio has no published organization profile, so the site uses the values written in build.mjs.</p>}
        </div>
      </div>
      <div className="set-card">
        <h3>Website configuration</h3>
        <F id="canonicalUrl" label="Canonical domain" effect="publish" admin locked={!p.admin} error={f.errs.canonicalUrl} hint="The address search engines should treat as the real site: canonical links, share URLs, the sitemap and robots.txt, and Studio’s own SEO work (Article and Event markup, audits, redirects, previews) once published.">
          <input id="set-canonicalUrl" className="input mono" value={f.v.canonicalUrl} disabled={!p.admin} onChange={(e) => f.setV({ ...f.v, canonicalUrl: e.target.value })} aria-invalid={!!f.errs.canonicalUrl} />
        </F>
        <F id="environment" label="Build environment" effect="publish" admin locked={!p.admin} error={f.errs.environment}
          hint={f.v.environment === 'production' ? 'Production: pages may be indexed and robots.txt allows crawling. Use this only for the copy served on the real domain.' : 'Preview: every page is noindex and robots.txt blocks crawling. A build started with SITE_ENV (npm run build:production) overrides this.'}>
          <div className="seg" id="set-environment" role="radiogroup" aria-label="Build environment">
            {(['preview', 'production'] as const).map((e) => <button key={e} type="button" role="radio" aria-checked={f.v.environment === e} className={f.v.environment === e ? 'on' : ''} disabled={!p.admin} onClick={() => f.setV({ ...f.v, environment: e })}>{e === 'preview' ? 'Preview' : 'Production'}</button>)}
          </div>
        </F>
        <div className="set-ro">
          <b>Studio addresses</b>
          <dl className="set-dl"><dt>Studio</dt><dd className="mono">{data.studio.origin}</dd><dt>Website preview</dt><dd className="mono">{data.studio.publicSiteUrl}</dd></dl>
          <p className="muted" style={{ margin: 0 }}>Set in studio/.env (STUDIO_ORIGIN, PUBLIC_SITE_URL). <i className="set-eff set-eff-restart">Restart Studio</i> after a change.</p>
        </div>
      </div>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} onReset={f.reset} unpublished={st.unpublished} canEdit={p.update} />
    </>
  );
}

// ---------------------------------------------------------------- Branding
const SLOTS: { key: keyof Branding & string; media: 'logo' | 'logoLight' | 'favicon' | 'socialImage'; label: string; hint: string; dark?: boolean }[] = [
  { key: 'logoMediaId', media: 'logo', label: 'Header logo', hint: 'Shown at the top of every page and in the Organization markup. A wide logo with a transparent background works best.' },
  { key: 'logoLightMediaId', media: 'logoLight', label: 'Footer logo (on black)', hint: 'The footer is black: use a white version of the logo.', dark: true },
  { key: 'faviconMediaId', media: 'favicon', label: 'Favicon', hint: 'The tab icon. Square, at least 48 × 48 px. The home-screen icon on iPhones stays the current PNG.' },
  { key: 'socialImageMediaId', media: 'socialImage', label: 'Default share image', hint: 'Used when a page has no share image of its own. 1200 × 630 px is best; at least 600 × 315.' },
];
function BrandingPanel({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const st = data.site.categories.branding; const p = data.permissions;
  const f = useForm<Branding>(st.draft, '/settings/branding', onSaved);
  const [pick, setPick] = useState<null | (typeof SLOTS)[number]>(null);
  const [chosen, setChosen] = useState<Record<string, Img>>({});
  const imgOf = (s: (typeof SLOTS)[number]): Img => { const id = f.v[s.key] as string | null; if (!id) return null; return chosen[id] ?? (data.site.media[s.media]?.id === id ? data.site.media[s.media] : null); };
  return (
    <>
      <PanelHead title="Branding" icon="image" summary="Logos, favicon and share image from the Media library. The site design is monochrome, so colours are black or white only." />
      <div className="set-card">
        <div className="set-slots">
          {SLOTS.map((s) => { const img = imgOf(s); return (
            <div key={s.key} className="set-f set-slot">
              <span className="set-fl"><b id={`set-${s.key}`} tabIndex={-1}>{s.label}</b><i className="set-eff set-eff-publish">{EFFECT.publish}</i></span>
              <div className={`set-prev${s.dark ? ' dark' : ''}${s.media === 'favicon' ? ' sq' : ''}`}>
                {img ? <img src={img.url} alt={img.alt || ''} /> : <span className="muted">{s.media === 'socialImage' ? 'Site default image' : 'Site default'}</span>}
              </div>
              {img && <small className="muted">{img.name} · {img.width} × {img.height}{!img.rightsConfirmed ? ' · usage rights not confirmed in the Media library' : ''}</small>}
              <small className={f.errs[s.key] ? 'err' : 'muted'}>{f.errs[s.key] ?? s.hint}</small>
              {p.update && <div className="set-row"><button className="btn btn-sm" onClick={() => setPick(s)}><Icon n="image" />{img ? 'Replace' : 'Choose'}</button>{f.v[s.key] && <button className="btn btn-sm btn-ghost" onClick={() => f.setV({ ...f.v, [s.key]: null })}>Use site default</button>}</div>}
            </div>); })}
        </div>
        {f.v.socialImageMediaId && <F id="socialImageAlt" label="Share image description" effect="publish" error={f.errs.socialImageAlt} hint="Leave empty to use the image’s alt text from the Media library.">
          <input id="set-socialImageAlt" className="input" value={f.v.socialImageAlt} disabled={!p.update} onChange={(e) => f.setV({ ...f.v, socialImageAlt: e.target.value })} />
        </F>}
        <F id="themeColor" label="Browser colour" effect="publish" hint="The colour some phone browsers use around the page.">
          <div className="set-presets" id="set-themeColor" role="radiogroup" aria-label="Browser colour">
            {([['#000000', 'Black'], ['#FFFFFF', 'White']] as const).map(([c, l]) => <button key={c} type="button" role="radio" aria-checked={f.v.themeColor === c} className={f.v.themeColor === c ? 'on' : ''} disabled={!p.update} onClick={() => f.setV({ ...f.v, themeColor: c })}><i style={{ background: c }} />{l}</button>)}
          </div>
        </F>
      </div>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} onReset={f.reset} unpublished={st.unpublished} canEdit={p.update} />
      {pick && <MediaPicker onClose={() => setPick(null)} onPick={([m]: MediaItem[]) => {
        setChosen((c) => ({ ...c, [m.id]: { id: m.id, url: m.url, width: m.width, height: m.height, alt: m.alt, name: m.originalName, rightsConfirmed: m.rightsConfirmed } }));
        f.setV({ ...f.v, [pick.key]: m.id }); setPick(null);
      }} />}
    </>
  );
}

// ---------------------------------------------------------------- Contact & social
function ContactPanel({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const st = data.site.categories.contact; const p = data.permissions;
  const f = useForm<Contact>(st.draft, '/settings/contact', onSaved);
  const id = data.identity.published;
  const overrides = id ? [id.sameAs?.length && 'social profiles'].filter(Boolean) : [];   // the public email and phone always come from here
  const soc = (k: keyof Contact['social'], label: string, ex: string) => (
    <F id={`social.${k}`} label={label} effect="publish" error={f.errs[`social.${k}`]} hint={`Leave empty to hide the ${label} link everywhere.`}>
      <input id={`set-social.${k}`} className="input" placeholder={ex} value={f.v.social[k]} disabled={!p.update} onChange={(e) => f.setV({ ...f.v, social: { ...f.v.social, [k]: e.target.value } })} aria-invalid={!!f.errs[`social.${k}`]} />
    </F>);
  return (
    <>
      <PanelHead title="Contact & social" icon="mail" summary="One source for the contact details on every page: the top bar, the footer, the contact page and the Organization markup." />
      <div className="set-card">
        <h3>Contact</h3>
        <F id="phone" label="Phone number" effect="publish" error={f.errs.phone} hint="International format, as visitors should read it. The call link is made from it.">
          <input id="set-phone" className="input" inputMode="tel" value={f.v.phone} disabled={!p.update} onChange={(e) => f.setV({ ...f.v, phone: e.target.value })} aria-invalid={!!f.errs.phone} />
        </F>
        <div className="set-2">
          <F id="generalEmail" label="General email" effect="publish" error={f.errs.generalEmail} hint="Executive team, volunteering, partnerships and press.">
            <select id="set-generalEmail" className="select" value={f.v.generalEmail} disabled={!p.update} onChange={(e) => f.setV({ ...f.v, generalEmail: e.target.value })}>{PUBLIC_EMAILS.map((m) => <option key={m}>{m}</option>)}</select>
          </F>
          <F id="boardEmail" label="Board email" effect="publish" error={f.errs.boardEmail} hint="Board leadership and governance.">
            <select id="set-boardEmail" className="select" value={f.v.boardEmail} disabled={!p.update} onChange={(e) => f.setV({ ...f.v, boardEmail: e.target.value })}>{PUBLIC_EMAILS.map((m) => <option key={m}>{m}</option>)}</select>
          </F>
        </div>
        <p className="muted set-note">Only the foundation’s two public addresses can be used on the website.</p>
        <div className="set-ro" id="set-address" tabIndex={-1}>
          <b>Office</b>
          <p style={{ margin: '4px 0 0' }}>Marrakech, Morocco</p>
          <p className="muted" style={{ margin: '2px 0 0' }}>The street address is not published until AFCD confirms it, so it has no field here.</p>
        </div>
      </div>
      <div className="set-card">
        <h3>Social profiles</h3>
        {soc('facebook', 'Facebook', 'https://www.facebook.com/…')}
        {soc('instagram', 'Instagram', 'https://www.instagram.com/…')}
        {soc('linkedin', 'LinkedIn', 'https://www.linkedin.com/company/…')}
      </div>
      {overrides.length > 0 && <div className="notice n-info"><Icon n="alert" /><span>Schema studio’s published organization profile also sets {overrides.join(', ')}. For the Organization markup on the homepage, Schema studio’s values win. Clear them there to use these.</span></div>}
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} onReset={f.reset} unpublished={st.unpublished} canEdit={p.update} />
    </>
  );
}

// ---------------------------------------------------------------- Email & SMTP
type TestResult = { ok: boolean; to: string; host?: string; port?: number; messageId?: string; response?: string; stage?: string; message?: string };
type Diag = { checks: { id: string; label: string; ok: boolean | null; detail: string }[]; checkedAt: string };
function EmailPanel({ data, onSaved }: { data: Data; onSaved: () => void }) {
  if (!data.permissions.admin || !('host' in data.email)) return (
    <><PanelHead title="Email & SMTP" icon="send" summary="The email server Studio uses for Inbox replies." />
      <div className="set-card"><p style={{ margin: 0 }}><Dot on={data.email.ready} /> Email sending is {data.email.ready ? 'ready' : 'not set up'}.</p><p className="muted" style={{ margin: '6px 0 0' }}>Only administrators can see or change the email server.</p></div></>);
  return <EmailAdmin mail={data.email} onSaved={onSaved} />;
}
function EmailAdmin({ mail, onSaved }: { mail: Mail; onSaved: () => void }) {
  const base = { enabled: mail.enabled, host: mail.host, port: mail.port, security: mail.security, user: mail.user, fromName: mail.fromName, fromEmail: mail.fromEmail, replyTo: mail.replyTo };
  const f = useForm(base, '/settings/email', onSaved);
  const [pw, setPw] = useState(''); const [removePw, setRemovePw] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null); const [testing, setTesting] = useState(false);
  const [diag, setDiag] = useState<Diag | null>(null); const [diagBusy, setDiagBusy] = useState(false);
  const toast = useToast();
  const dirty = f.dirty || !!pw || removePw;
  const set = <K extends keyof typeof base>(k: K, v: (typeof base)[K]) => f.setV({ ...f.v, [k]: v });
  async function save() {
    await f.save({ ...f.v, ...(removePw ? { password: '' } : pw ? { password: pw } : {}) });
    setPw(''); setRemovePw(false);
  }
  async function sendTest() {
    setTesting(true); setTest(null);
    try { setTest(await post<TestResult>('/settings/email/test')); onSaved(); } catch (e) { toast((e as Error).message, true); } finally { setTesting(false); }
  }
  async function runDiag() {
    setDiagBusy(true);
    try { setDiag(await post<Diag>('/settings/email/diagnose')); } catch (e) { toast((e as Error).message, true); } finally { setDiagBusy(false); }
  }
  return (
    <>
      <PanelHead title="Email & SMTP" icon="send" summary="One email server for all of Studio: Inbox replies and test emails. The same settings as Inbox → Settings." />
      <div className="set-card">
        <label className="check" id="set-enabled"><input type="checkbox" checked={f.v.enabled} onChange={(e) => set('enabled', e.target.checked)} /><span><b>Send email from Studio</b><br /><small className="muted">Off: nothing is sent, and the Inbox says replies are unavailable.</small></span></label>
        <div className="set-2">
          <F id="host" label="SMTP server" effect="immediate" admin error={f.errs.host}><input id="set-host" className="input mono" placeholder="smtp.example.org" value={f.v.host} onChange={(e) => set('host', e.target.value)} /></F>
          <div className="set-2 set-2-tight">
            <F id="port" label="Port" effect="immediate" error={f.errs.port}><input id="set-port" className="input mono" inputMode="numeric" value={f.v.port} onChange={(e) => set('port', Number(e.target.value.replace(/\D/g, '')) || 0)} /></F>
            <F id="security" label="Security" effect="immediate"><select id="set-security" className="select" value={f.v.security} onChange={(e) => set('security', e.target.value as Mail['security'])}><option value="starttls">STARTTLS</option><option value="tls">TLS</option><option value="none">None</option></select></F>
          </div>
        </div>
        <div className="set-2">
          <F id="user" label="Username" effect="immediate" error={f.errs.user}><input id="set-user" className="input" autoComplete="off" value={f.v.user} onChange={(e) => set('user', e.target.value)} /></F>
          <F id="password" label="Password" effect="immediate" hint={mail.passwordState === 'unreadable' ? 'The saved password can’t be read (the encryption key changed). Enter it again.' : mail.hasPassword ? 'A password is saved (encrypted). It is never shown. Type a new one to replace it.' : 'No password saved.'}>
            <input id="set-password" className="input" type="password" autoComplete="new-password" placeholder={mail.hasPassword ? '•••••••• saved' : ''} value={pw} disabled={removePw} onChange={(e) => setPw(e.target.value)} />
            {mail.hasPassword && <label className="check"><input type="checkbox" checked={removePw} onChange={(e) => { setRemovePw(e.target.checked); setPw(''); }} /><span>Remove the saved password</span></label>}
          </F>
        </div>
        <div className="set-2">
          <F id="fromEmail" label="Sender address" effect="immediate" error={f.errs.fromEmail}><input id="set-fromEmail" className="input" value={f.v.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} /></F>
          <F id="fromName" label="Sender name" effect="immediate" error={f.errs.fromName}><input id="set-fromName" className="input" value={f.v.fromName} onChange={(e) => set('fromName', e.target.value)} /></F>
        </div>
        <F id="replyTo" label="Reply-to address" effect="immediate" error={f.errs.replyTo} hint="Optional. Where answers to Studio emails go."><input id="set-replyTo" className="input" value={f.v.replyTo} onChange={(e) => set('replyTo', e.target.value)} /></F>
        <p className="muted set-note">Password encryption key: {mail.keySource === 'env' ? 'STUDIO_ENCRYPTION_KEY' : 'a random key in Studio’s data folder (set STUDIO_ENCRYPTION_KEY for production)'}.{mail.updatedAt ? ` Last changed ${fmtDate(mail.updatedAt)} by ${mail.updatedBy}.` : ''}</p>
      </div>
      <SaveBar dirty={dirty} busy={f.busy} onSave={save} onReset={() => { f.reset(); setPw(''); setRemovePw(false); }} canEdit />
      <div className="set-card">
        <div className="between set-wrap"><h3 style={{ margin: 0 }}>Test and diagnostics</h3>
          <div className="set-row">
            <button className="btn btn-sm" id="set-test" disabled={testing || dirty} onClick={sendTest} title={dirty ? 'Save first' : undefined}><Icon n="send" />{testing ? 'Sending…' : 'Send test email to me'}</button>
            <button className="btn btn-sm" id="set-diagnostics" disabled={diagBusy || dirty} onClick={runDiag}><Icon n="checkcircle" />{diagBusy ? 'Checking…' : 'Check connection'}</button>
          </div></div>
        <p className="muted" style={{ margin: '6px 0 0' }}>The test email is really sent, at most 5 per hour. Save your changes first: tests use the saved settings.</p>
        {test && <div className={`notice ${test.ok ? 'n-ok' : 'n-warn'} set-result`} role="status">
          <Icon n={test.ok ? 'checkcircle' : 'alert'} />
          <div>{test.ok ? <><b>Accepted by {test.host}.</b> Sent to {test.to}. Check that inbox (and its spam folder).</> : <><b>Not sent.</b> {test.message}</>}
            {test.ok && test.response && <div className="mono set-resp">Server response: {test.response}</div>}
            {test.ok && test.messageId && <div className="mono set-resp">Message ID: {test.messageId}</div>}</div>
        </div>}
        {diag && <Checks checks={diag.checks} at={diag.checkedAt} />}
      </div>
    </>
  );
}

type Facts = { studioVersion: string; node: string; platform: string; database: string; migrations: { applied: number | null; known: number; latest: string | null }; encryptionKey: string; origin: string; publicSiteUrl: string; maxUploadMb: number; google: string; uptimeSeconds: number };
function AdvancedPanel({ admin }: { admin: boolean }) {
  const [d, setD] = useState<Facts | null>(null); const [err, setErr] = useState('');
  useEffect(() => { if (admin) api<Facts>('/settings/diagnostics').then(setD).catch((e) => setErr(e.message)); }, [admin]);
  return (
    <><PanelHead title="Advanced & diagnostics" icon="monitor" summary="Read-only facts about this Studio installation, read when you open this page." />
      <div className="set-card" id="set-diagnostics" tabIndex={-1}>
        {!admin ? <p className="muted" style={{ margin: 0 }}>Only administrators can see installation details.</p>
          : err ? <div className="notice n-warn"><Icon n="alert" />{err}</div>
          : !d ? <Loading h={160} />
          : <dl className="set-dl set-dl-wide">
            <dt>Studio version</dt><dd>{d.studioVersion}</dd>
            <dt>Node.js</dt><dd className="mono">{d.node} · {d.platform}</dd>
            <dt>Database</dt><dd>{d.database}</dd>
            <dt>Migrations</dt><dd>{d.migrations.applied ?? 'unknown'} applied of {d.migrations.known} · latest {d.migrations.latest}{d.migrations.applied !== null && d.migrations.applied < d.migrations.known ? ' · restart Studio to apply the rest' : ''}</dd>
            <dt>Encryption key</dt><dd>{d.encryptionKey}</dd>
            <dt>Studio address</dt><dd className="mono">{d.origin}</dd>
            <dt>Website preview</dt><dd className="mono">{d.publicSiteUrl}</dd>
            <dt>Upload limit</dt><dd>{d.maxUploadMb} MB (MAX_UPLOAD_MB)</dd>
            <dt>Google sign-in</dt><dd>{d.google}</dd>
            <dt>Running for</dt><dd>{d.uptimeSeconds < 3600 ? `${Math.round(d.uptimeSeconds / 60)} min` : `${Math.round(d.uptimeSeconds / 3600)} h`}</dd>
          </dl>}
      </div>
      {admin && <p className="muted set-note">Environment values come from studio/.env. <i className="set-eff set-eff-restart">Restart Studio</i> after changing them.</p>}</>
  );
}

// ---------------------------------------------------------------- History
const CAT_LABEL: Record<string, string> = { general: 'General', branding: 'Branding', contact: 'Contact & social', email: 'Email & SMTP', templates: 'Email templates', notifications: 'Notifications' };
function History({ admin, onRestored }: { admin: boolean; onRestored: () => void }) {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Rev[] | null>(null);
  const [open, setOpen] = useState<{ id: string; category: string; values: Record<string, unknown>; changed: string[]; createdAt: string } | null>(null);
  const [busy, setBusy] = useState(false); const toast = useToast();
  const load = () => api<Rev[]>(`/settings/history${filter ? `?category=${filter}` : ''}`).then(setRows).catch((e) => toast(e.message, true));
  useEffect(() => { setRows(null); load(); }, [filter]);
  async function restore(id: string) {
    setBusy(true);
    try { await post(`/settings/history/${id}/restore`); toast('Restored as a new revision. Website settings still need publishing.'); setOpen(null); load(); onRestored(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const cats = admin ? ['general', 'branding', 'contact', 'email', 'templates', 'notifications'] : ['general', 'branding', 'contact', 'templates'];
  return (
    <><PanelHead title="Settings history" icon="history" summary="Every saved change, newest first. Passwords and other secrets are never kept here, only that they changed.">
        <div className="seg set-filter" role="group" aria-label="Filter history">{['', ...cats].map((c) => <button key={c} type="button" className={filter === c ? 'on' : ''} aria-pressed={filter === c} onClick={() => setFilter(c)}>{c ? CAT_LABEL[c] : 'All'}</button>)}</div>
      </PanelHead>
      <div className="set-card set-hist">
        {!rows ? <div className="skeleton" style={{ height: 120 }} /> : !rows.length ? <div className="empty">No changes yet.</div> :
          <ol>{rows.map((r) => <li key={r.id}>
            <button type="button" onClick={() => api(`/settings/history/${r.id}`).then(setOpen).catch((e) => toast(e.message, true))}>
              <span className="set-hc">{CAT_LABEL[r.category] ?? r.category}</span>
              <span className="set-hs"><b>{r.summary}</b><small>{r.actorName ?? r.actorEmail ?? 'unknown'} · {fmtDate(r.createdAt)}{r.restoredFrom ? ' · restore' : ''}</small></span>
              <Icon n="chev" />
            </button></li>)}</ol>}
      </div>
      {open && <Modal title={`${CAT_LABEL[open.category] ?? open.category} · ${fmtDate(open.createdAt)}`} onClose={() => setOpen(null)}
        footer={<><button className="btn" onClick={() => setOpen(null)}>Close</button>{admin && <button className="btn btn-primary" disabled={busy} onClick={() => restore(open.id)}><Icon n="undo" />{busy ? 'Restoring…' : 'Restore as new revision'}</button>}</>}>
        <div className="modal-b">
          <dl className="set-dl set-dl-wide">{Object.entries(open.values).map(([k, v]) => <RevField key={k} k={k} v={v} changed={open.changed.includes(k)} />)}</dl>
          {open.category === 'email' && <p className="muted set-note">Restoring keeps the password that is saved now; revisions never contain it.</p>}
          {!admin && <p className="muted set-note">Only administrators can restore revisions.</p>}
        </div>
      </Modal>}
    </>
  );
}
function RevField({ k, v, changed }: { k: string; v: unknown; changed: boolean }) {
  const show = (x: unknown): string => x === null || x === '' ? '—' : typeof x === 'object' ? Object.entries(x as object).map(([a, b]) => `${a}: ${show(b)}`).join(' · ') : String(x);
  return <><dt>{k}{changed && <i className="set-chg">changed</i>}</dt><dd className="mono">{show(v)}</dd></>;
}

