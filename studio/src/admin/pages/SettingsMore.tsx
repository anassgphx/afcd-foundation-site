// Settings Center panels: Email templates, Notifications, Domain & DNS, SEO & analytics, Localization, Media,
// Performance, Security & access, Backups and Maintenance. Live facts are read when the panel opens; nothing is estimated.
import { useEffect, useState } from 'react';
import { del, post } from '../api.ts';
import { Icon, Link, Modal, ago, fmtDate, useToast } from '../ui.tsx';
import '../email-templates.css';
import { AdminOnly, Checks, Dot, F, Loading, PanelHead, SaveBar, Stats, fmtBytes, useFacts, useForm, type CheckItem } from './settingsKit.tsx';

type Cat = { id: string; label: string; icon: string; summary: string; link?: { to: string; label: string } };
type Perms = { update: boolean; admin: boolean; publish: boolean };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// ---------------------------------------------------------------- Email templates
// The design every Studio email is sent in (logo, signature, footer) and reusable Inbox replies with optional parts
// (preview line, heading, button, details card), with a live preview of the real email at desktop and phone width.
type Btn = { label: string; url: string };
type Details = { title: string; rows: { label: string; value: string }[] };
type Tpl = { id?: string; name: string; subject: string; heading: string; preheader: string; body: string; button: Btn | null; details: Details | null };
type Design = { branded: boolean; showContact: boolean; showSocial: boolean; footerNote: string; signature: string };
type TplData = { templates: Tpl[]; design: Design; variables: { name: string; label: string; example: string }[]; canEdit: boolean };
type Pv = { subject: string; heading: string; preheader: string; unknown: string[]; html: string; text: string };
const blank = (t: Partial<Tpl>): Tpl => ({ name: '', subject: '', heading: '', preheader: '', body: '', button: null, details: null, ...t });
const STARTERS: { title: string; desc: string; t: Tpl }[] = [
  { title: 'Volunteering reply', desc: 'Thank them and explain the next steps.', t: blank({ name: 'Volunteering', subject: 'Re: {{topic}}', heading: 'Thank you for offering your time',
    preheader: 'Here is how volunteering with us works.', body: 'Dear {{contact_first_name}},\n\nThank you for writing to {{organization}} and for wanting to volunteer with us.\n\nOur team will call you within a week to talk about the roles that fit you best. Meanwhile, you can read about our current projects on our website.',
    button: { label: 'See our projects', url: 'https://afcdfoundation.com/projects.html' } }) },
  { title: 'Partnership reply', desc: 'Acknowledge a partnership request.', t: blank({ name: 'Partnership', subject: 'Re: {{topic}}', heading: 'Let’s talk about working together',
    preheader: 'Thank you for your interest in partnering with us.', body: 'Dear {{contact_first_name}},\n\nThank you for reaching out about a partnership with {{organization}}.\n\nWe will review your message and suggest a short call in the coming days. If you have a presentation or proposal, you can reply to this email with it attached.' }) },
  { title: 'Event confirmation', desc: 'Confirm a place, with the event details.', t: blank({ name: 'Event confirmation', subject: 'Your place is confirmed', heading: 'See you soon, {{contact_first_name}}',
    preheader: 'Your registration is confirmed. Details inside.', body: 'Dear {{contact_first_name}},\n\nThank you for registering. Your place is confirmed and we look forward to welcoming you.',
    button: { label: 'View the event', url: 'https://afcdfoundation.com/events.html' },
    details: { title: 'Event details', rows: [{ label: 'Date', value: '' }, { label: 'Time', value: '' }, { label: 'Place', value: '' }] } }) },
];

export function TemplatesPanel({ c, onSaved }: { c: Cat; onSaved: () => void }) {
  const { d, err, reload } = useFacts<TplData>('/settings/templates');
  if (!d) return <><PanelHead title={c.label} summary={c.summary} icon={c.icon} /><Loading err={err} /></>;
  return <TemplatesEditor c={c} d={d} onSaved={() => { reload(); onSaved(); }} />;
}
function TemplatesEditor({ c, d, onSaved }: { c: Cat; d: TplData; onSaved: () => void }) {
  const f = useForm<{ templates: Tpl[]; design: Design }>({ templates: d.templates.map(blank), design: d.design }, '/settings/templates', onSaved);
  const [sel, setSel] = useState<number | 'design'>(d.templates.length ? 0 : 'design');
  const [view, setView] = useState<'desktop' | 'phone' | 'text'>('desktop');
  const [pv, setPv] = useState<Pv | null>(null);
  const list = f.v.templates; const design = f.v.design;
  const t = typeof sel === 'number' ? list[sel] : undefined;
  const ro = !d.canEdit;
  const upd = (patch: Partial<Tpl>) => { if (typeof sel === 'number') f.setV({ ...f.v, templates: list.map((x, i) => (i === sel ? { ...x, ...patch } : x)) }); };
  const updD = (patch: Partial<Design>) => f.setV({ ...f.v, design: { ...design, ...patch } });
  const add = (x: Tpl) => { f.setV({ ...f.v, templates: [...list, x] }); setSel(list.length); };
  // the design is previewed on the selected template, or on a sample reply when there is none
  const shown = t ?? list[0] ?? STARTERS[0].t;
  useEffect(() => {
    const h = setTimeout(() => { post<Pv>('/settings/templates/preview', { ...shown, design }).then(setPv).catch(() => {}); }, 250);
    return () => clearTimeout(h);
  }, [JSON.stringify(shown), JSON.stringify(design)]);
  const e = (k: string) => (typeof sel === 'number' ? f.errs[`templates.${sel}.${k}`] : f.errs[`design.${k}`]);
  const vars = (onPick: (name: string) => void) => !ro && <div className="set-vars" aria-label="Insert a variable"><span className="muted">Insert:</span>
    {d.variables.map((v) => <button key={v.name} type="button" className="set-var" title={`${v.label} (e.g. ${v.example})`} onClick={() => onPick(v.name)}>{`{{${v.name}}}`}</button>)}</div>;

  return (
    <>
      <PanelHead title={c.label} summary="The design every email from Studio is sent in, and reusable replies for the Inbox. Variables are filled in when a template is used." icon={c.icon} />
      <div className="et-wrap"><div className="et">
        {/* ---------- list */}
        <nav className="set-card et-list" aria-label="Email design and templates">
          <button type="button" className={`et-item${sel === 'design' ? ' on' : ''}`} aria-current={sel === 'design'} onClick={() => setSel('design')}>
            <span className="et-ico"><Icon n="layers" /></span><span><b>Email design</b><small>Logo, signature and footer for every email</small></span></button>
          <div className="et-list-h"><h3>Templates <span className="muted">{list.length}</span></h3>
            {!ro && <button className="btn btn-sm" disabled={list.length >= 20} onClick={() => add(blank({ name: `New template ${list.length + 1}`, subject: 'Re: {{topic}}', body: 'Dear {{contact_first_name}},\n\n' }))}><Icon n="plus" />New</button>}</div>
          {list.length ? list.map((x, i) => <button key={x.id ?? `new-${i}`} type="button" className={`et-item${i === sel ? ' on' : ''}`} aria-current={i === sel} onClick={() => setSel(i)}>
            <span className="et-ico"><Icon n="mail" /></span><span><b>{x.name || 'Untitled'}</b><small>{x.subject || 'No subject'}</small></span></button>)
            : <div className="et-starters">
              <p className="muted">No templates yet. {!ro && 'Start from one of these and adapt it:'}</p>
              {!ro && STARTERS.map((s) => <button key={s.title} type="button" className="et-starter" onClick={() => add({ ...s.t })}><b>{s.title}</b><small>{s.desc}</small><Icon n="plus" /></button>)}
            </div>}
        </nav>

        {/* ---------- editor */}
        <div className="set-card et-ed">
          {sel === 'design' ? <>
            <div className="et-ed-h"><h3>Email design</h3><p className="muted">Used by Inbox replies, test emails and notifications. The logo, contact details and social links come from <Link to="/studio/settings/branding">Branding</Link> and <Link to="/studio/settings/contact">Contact &amp; social</Link>.</p></div>
            <label className="check et-check"><input type="checkbox" checked={design.branded} disabled={ro} onChange={(x) => updD({ branded: x.target.checked })} />
              <span><b>Send emails in the branded design</b><small className="muted">Off: plain text only, like a personal email.</small></span></label>
            <F id="et-sig" label="Signature" effect="immediate" error={e('signature')} hint="Added under every Inbox reply. Leave it empty if your templates already sign off.">
              <textarea id="set-et-sig" className="textarea" rows={3} value={design.signature} disabled={ro} placeholder={'Warm regards,\n{{sender_name}}\n{{organization}}'} onChange={(x) => updD({ signature: x.target.value })} />
            </F>
            {vars((n) => updD({ signature: `${design.signature}{{${n}}}` }))}
            <F id="et-foot" label="Footer note" effect="immediate" error={e('footerNote')} hint="A short line under the contact details, e.g. why they receive this email.">
              <textarea id="set-et-foot" className="textarea" rows={2} maxLength={300} value={design.footerNote} disabled={ro} onChange={(x) => updD({ footerNote: x.target.value })} />
            </F>
            <div className="et-toggles">
              <label className="check"><input type="checkbox" checked={design.showContact} disabled={ro || !design.branded} onChange={(x) => updD({ showContact: x.target.checked })} /><span>Show email and phone in the footer</span></label>
              <label className="check"><input type="checkbox" checked={design.showSocial} disabled={ro || !design.branded} onChange={(x) => updD({ showSocial: x.target.checked })} /><span>Show social links in the footer</span></label>
            </div>
          </> : t ? <>
            <div className="et-ed-h"><h3>{t.name || 'Untitled'}</h3><p className="muted">Pick it in Inbox → Reply → Use a template. You can still edit the text before sending.</p></div>
            {f.errs[`templates.${sel}`] && <div className="notice n-warn" role="alert"><div>{f.errs[`templates.${sel}`]}</div></div>}
            <div className="et-row">
              <F id="tpl-name" label="Name" effect="immediate" error={e('name')} hint="Only Studio users see it.">
                <input id="set-tpl-name" className="input" value={t.name} maxLength={60} disabled={ro} onChange={(x) => upd({ name: x.target.value })} /></F>
              <F id="tpl-subject" label="Subject" effect="immediate" error={e('subject')}>
                <input id="set-tpl-subject" className="input" value={t.subject} maxLength={200} disabled={ro} onChange={(x) => upd({ subject: x.target.value })} /></F>
            </div>
            <F id="tpl-pre" label="Preview line" effect="immediate" error={e('preheader')} hint="Optional. Shown next to the subject in most inboxes.">
              <input id="set-tpl-pre" className="input" value={t.preheader} maxLength={150} disabled={ro} onChange={(x) => upd({ preheader: x.target.value })} /></F>
            <F id="tpl-heading" label="Heading" effect="immediate" error={e('heading')} hint="Optional. A large title at the top of the email.">
              <input id="set-tpl-heading" className="input" value={t.heading} maxLength={120} disabled={ro} onChange={(x) => upd({ heading: x.target.value })} /></F>
            <F id="tpl-body" label="Text" effect="immediate" error={e('body')} hint="Plain text. A blank line starts a new paragraph; https links become clickable.">
              <textarea id="set-tpl-body" className="textarea set-tpl-body" rows={8} value={t.body} maxLength={5000} disabled={ro} onChange={(x) => upd({ body: x.target.value })} /></F>
            {vars((n) => upd({ body: `${t.body}{{${n}}}` }))}

            <fieldset className="et-part" disabled={ro}>
              <legend><label className="check"><input type="checkbox" checked={!!t.button} onChange={(x) => upd({ button: x.target.checked ? { label: '', url: 'https://afcdfoundation.com/' } : null })} /><span><b>Button</b> <small className="muted">One clear next step</small></span></label></legend>
              {t.button && <div className="et-row">
                <F id="tpl-bl" label="Button text" effect="immediate" error={e('button.label')}><input id="set-tpl-bl" className="input" maxLength={40} placeholder="e.g. See the event" value={t.button.label} onChange={(x) => upd({ button: { ...t.button!, label: x.target.value } })} /></F>
                <F id="tpl-bu" label="Link" effect="immediate" error={e('button.url')} hint="https:// or mailto:"><input id="set-tpl-bu" className="input mono" maxLength={500} value={t.button.url} onChange={(x) => upd({ button: { ...t.button!, url: x.target.value.trim() } })} /></F>
              </div>}
            </fieldset>

            <fieldset className="et-part" disabled={ro}>
              <legend><label className="check"><input type="checkbox" checked={!!t.details} onChange={(x) => upd({ details: x.target.checked ? { title: '', rows: [{ label: '', value: '' }] } : null })} /><span><b>Details card</b> <small className="muted">Dates, places, amounts</small></span></label></legend>
              {t.details && <>
                <F id="tpl-dt" label="Card title" effect="immediate" error={e('details.title')}><input id="set-tpl-dt" className="input" maxLength={60} placeholder="e.g. Event details" value={t.details.title} onChange={(x) => upd({ details: { ...t.details!, title: x.target.value } })} /></F>
                <ol className="et-rows">{t.details.rows.map((r, i) => <li key={i}>
                  <input className="input" maxLength={40} placeholder="Label" aria-label={`Line ${i + 1} label`} value={r.label} onChange={(x) => upd({ details: { ...t.details!, rows: t.details!.rows.map((y, j) => (j === i ? { ...y, label: x.target.value } : y)) } })} />
                  <input className="input" maxLength={160} placeholder="Value" aria-label={`Line ${i + 1} value`} value={r.value} onChange={(x) => upd({ details: { ...t.details!, rows: t.details!.rows.map((y, j) => (j === i ? { ...y, value: x.target.value } : y)) } })} />
                  <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Remove line ${i + 1}`} onClick={() => upd({ details: { ...t.details!, rows: t.details!.rows.filter((_, j) => j !== i) } })}><Icon n="x" /></button></li>)}</ol>
                {t.details.rows.length < 8 && <button type="button" className="btn btn-sm" onClick={() => upd({ details: { ...t.details!, rows: [...t.details!.rows, { label: '', value: '' }] } })}><Icon n="plus" />Add a line</button>}
              </>}
            </fieldset>
            {!ro && <div className="et-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => add({ ...t, id: undefined, name: `${t.name} (copy)`.slice(0, 60) })} disabled={list.length >= 20}><Icon n="layers" />Duplicate</button>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { if (!confirm(`Remove “${t.name}”? It goes away when you save.`)) return; f.setV({ ...f.v, templates: list.filter((_, i) => i !== sel) }); setSel(list.length > 1 ? Math.max(0, (sel as number) - 1) : 'design'); }}><Icon n="x" />Remove</button>
            </div>}
          </> : null}
        </div>

        {/* ---------- live preview */}
        <section className="set-card et-pv" aria-label="Preview">
          <div className="et-pv-h">
            <span><b>Preview</b><small className="muted">{sel === 'design' && !list.length ? 'A sample reply' : 'With example values'}</small></span>
            <span className="seg" role="group" aria-label="Preview size">{(['desktop', 'phone', 'text'] as const).map((v) => <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'desktop' ? 'Desktop' : v === 'phone' ? 'Phone' : 'Plain text'}</button>)}</span>
          </div>
          {pv && <div className="et-inbox" aria-label="How it looks in an inbox"><span className="et-av">{d.variables.find((v) => v.name === 'organization')?.example.slice(0, 1) ?? 'A'}</span>
            <span><b>{pv.subject || 'No subject'}</b><small>{pv.preheader || pv.text.split('\n').find((l) => l.trim()) || ''}</small></span></div>}
          {pv?.unknown.length ? <small className="err">Unknown: {pv.unknown.map((u) => `{{${u}}}`).join(', ')}. Only the variables listed can be used.</small> : null}
          {!design.branded && view !== 'text' && <p className="muted et-note">The branded design is off: emails go out as plain text. This is how they would look with it on.</p>}
          <div className={`et-frame is-${view}`}>
            {!pv ? <div className="skeleton" style={{ height: 320 }} /> : view === 'text' ? <pre className="et-text">{pv.text}</pre>
              : <iframe title="Email preview" sandbox="" srcDoc={pv.html} />}
          </div>
        </section>
      </div></div>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} onReset={f.reset} canEdit={d.canEdit} note="Templates appear in Inbox → Reply → Use a template" />
    </>
  );
}

// ---------------------------------------------------------------- Notifications
type NotifData = { settings: { newMessages: { enabled: boolean; recipients: string[]; intervalMinutes: 15 | 60 | 240 | 1440 } }; state: { lastSentAt: string | null; lastCount: number; lastError: string | null }; people: { id: string; name: string; email: string; role: string }[]; mailReady: boolean };
export function NotificationsPanel({ c, perms }: { c: Cat; perms: Perms }) {
  const { d, err, reload } = useFacts<NotifData>(perms.admin ? '/settings/notifications' : null);
  if (!perms.admin) return <><PanelHead title={c.label} summary={c.summary} icon={c.icon} /><AdminOnly what="who receives notices" /></>;
  if (!d) return <><PanelHead title={c.label} summary={c.summary} icon={c.icon} /><Loading err={err} /></>;
  return <NotifEditor c={c} d={d} onSaved={reload} />;
}
function NotifEditor({ c, d, onSaved }: { c: Cat; d: NotifData; onSaved: () => void }) {
  const f = useForm(d.settings, '/settings/notifications', onSaved);
  const nm = f.v.newMessages; const set = (p: Partial<typeof nm>) => f.setV({ newMessages: { ...nm, ...p } });
  const toast = useToast(); const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try { const r = await post<{ ok: boolean; to: string; response?: string; message?: string }>('/settings/notifications/test'); toast(r.ok ? `Test notice accepted by the server for ${r.to}.` : `Not sent: ${r.message}`, !r.ok); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <>
      <PanelHead title={c.label} summary="An email to chosen people when new messages arrive through the website forms." icon={c.icon} />
      {!d.mailReady && <div className="notice n-warn"><Icon n="alert" /><span>Email sending is not set up, so notices cannot be sent. <Link className="ix-link" to="/studio/settings/email">Set up Email & SMTP</Link></span></div>}
      <div className="set-card">
        <label className="check" id="set-notify"><input type="checkbox" checked={nm.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span><b>Email new website messages</b><br /><small className="muted">The email gives the number of messages and their topics with a link to the Inbox. It never includes names, addresses or message text. Messages in Spam are not counted.</small></span></label>
        <F id="notify-people" label="Send to" effect="immediate" error={f.errs['newMessages.recipients']} hint="Active Studio users who can read the Inbox.">
          <div className="set-people" id="set-notify-people">{d.people.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={nm.recipients.includes(p.id)} onChange={(e) => set({ recipients: e.target.checked ? [...nm.recipients, p.id] : nm.recipients.filter((x) => x !== p.id) })} /><span>{p.name} <small className="muted">{p.email}</small></span></label>)}</div>
        </F>
        <F id="notify-interval" label="At most one email every" effect="immediate" hint="Messages that arrive in between are counted in the next email.">
          <div className="seg" id="set-notify-interval" role="radiogroup" aria-label="Interval">{([[15, '15 min'], [60, 'Hour'], [240, '4 hours'], [1440, 'Day']] as const).map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={nm.intervalMinutes === m} className={nm.intervalMinutes === m ? 'on' : ''} onClick={() => set({ intervalMinutes: m })}>{l}</button>)}</div>
        </F>
        <div className="set-ro">
          <b>Last notice</b>
          <p className="muted">{d.state.lastSentAt ? `${fmtDate(d.state.lastSentAt)} · ${d.state.lastCount} message${d.state.lastCount === 1 ? '' : 's'}${d.state.lastError ? ` · failed: ${d.state.lastError}` : ''}` : 'None sent yet.'}</p>
          <div><button className="btn btn-sm" disabled={busy || !d.mailReady || f.dirty} onClick={test}><Icon n="send" />{busy ? 'Sending…' : 'Send a test notice to me'}</button></div>
        </div>
      </div>
      <SaveBar dirty={f.dirty} busy={f.busy} onSave={() => f.save()} onReset={f.reset} canEdit />
    </>
  );
}

// ---------------------------------------------------------------- Domain & DNS
type DnsResult = { checkedAt: string; checkedBy: string; groups: { id: string; title: string; role: string; checks: CheckItem[] }[] };
export function DomainPanel({ c, perms, onChecked }: { c: Cat; perms: Perms; onChecked: () => void }) {
  const { d, err, setD } = useFacts<{ last: DnsResult | null }>('/settings/domain');
  const [busy, setBusy] = useState(false); const toast = useToast();
  async function run() {
    setBusy(true);
    try { const r = await post<DnsResult>('/settings/domain/check'); setD({ last: r }); onChecked(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const last = d?.last;
  const problems = last ? last.groups.flatMap((g) => g.checks).filter((x) => x.ok === false).length : 0;
  return (
    <>
      <PanelHead title={c.label} summary="Real DNS lookups and an HTTPS request, made from this Studio when you ask. Results are shown with the time they were checked." icon={c.icon}>
        {perms.update && <button className="btn btn-sm btn-primary" id="set-domain-check" disabled={busy} onClick={run}><Icon n="checkcircle" />{busy ? 'Checking…' : last ? 'Check again' : 'Run checks'}</button>}
      </PanelHead>
      {!d ? <Loading err={err} /> : !last ? <div className="set-card set-empty"><Icon n="globe" /><div><b>Not checked yet</b><p className="muted">Studio has not looked up these domains. {perms.update ? 'Run the checks to see the real records.' : 'Someone who can edit settings can run them.'}</p></div></div> : <>
        <div className={`notice ${problems ? 'n-warn' : 'n-ok'}`}><Icon n={problems ? 'alert' : 'checkcircle'} /><span>{problems ? `${problems} problem${problems === 1 ? '' : 's'} found` : 'No problems found'} · checked {ago(last.checkedAt)} by {last.checkedBy}</span></div>
        {last.groups.map((g) => <div key={g.id} className="set-card"><div className="between"><h3 className="mono">{g.title}</h3><span className="pill">{g.role}</span></div><Checks checks={g.checks} /></div>)}
        <p className="muted set-note">The website domain comes from Settings → General. Email domains are those of the public addresses and of the SMTP sender. DNS changes are made at the domain registrar, not in Studio.</p>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- SEO & analytics (facts)
type SeoFacts = { searchConsole: { configured: boolean; status: string | null; property: string | null; lastSyncAt: string | null; lastError: string | null }; indexing: 'open' | 'blocked' | 'unknown'; environment: { saved: string; published: string | null }; sitemapUrls: number | null; openIssues: number; activeRedirects: number; analytics: { connected: boolean; note: string } };
export function SeoPanel({ c }: { c: Cat }) {
  const { d, err } = useFacts<SeoFacts>('/settings/facts/seo');
  const sc = d?.searchConsole;
  return (
    <>
      <PanelHead title={c.label} summary="A live summary. Search settings are managed in SEO, where they go through review." icon={c.icon} link={c.link} />
      {!d ? <Loading err={err} /> : <>
        <div className="set-card"><Stats items={[
          { label: 'Search engines', value: d.indexing === 'open' ? 'Allowed' : d.indexing === 'blocked' ? 'Blocked' : 'Unknown', hint: d.indexing === 'blocked' ? 'robots.txt blocks crawling (preview build).' : d.indexing === 'open' ? 'robots.txt allows crawling.' : 'No robots.txt in the built site.', tone: d.indexing === 'blocked' ? 'warn' : null },
          { label: 'Sitemap', value: d.sitemapUrls === null ? 'Missing' : `${d.sitemapUrls} URLs`, hint: 'In the built sitemap.xml' },
          { label: 'Open SEO issues', value: d.openIssues, tone: d.openIssues ? 'warn' : null },
          { label: 'Active redirects', value: d.activeRedirects },
        ]} /></div>
        <div className="set-card">
          <h3>Google Search Console</h3>
          <p className="set-line"><Dot on={sc?.status === 'connected'} />{!sc?.configured ? 'Not set up on this Studio (Google keys missing in studio/.env).' : sc.status === 'connected' ? <>Connected to <span className="mono">{sc.property ?? 'no property chosen'}</span>{sc.lastSyncAt ? ` · synced ${ago(sc.lastSyncAt)}` : ' · not synced yet'}</> : sc.status === 'error' ? `Needs reconnecting: ${sc.lastError ?? 'access was lost'}` : 'Not connected.'}</p>
          <h3>Google Analytics 4</h3>
          <p className="set-line"><Dot on={false} />{d.analytics.note}</p>
          <h3>Build environment</h3>
          <p className="set-line muted">Saved: {d.environment.saved}{d.environment.published ? ` · on the website: ${d.environment.published}` : ' · settings not published yet'}. Change it in <Link className="ix-link" to="/studio/settings/general">General</Link>.</p>
        </div>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- Localization (facts)
type LangFacts = { languages: { lang: string; name: string; native: string; dir: string; total: number; translated: number; status: string | null; live: boolean }[] };
export function LocalizationPanel({ c }: { c: Cat }) {
  const { d, err } = useFacts<LangFacts>('/settings/facts/localization');
  return (
    <>
      <PanelHead title={c.label} summary="English is the source language. Translation progress and approval come from Translations." icon={c.icon} link={c.link} />
      {!d ? <Loading err={err} /> : <div className="set-langs">{d.languages.map((l) => (
        <div key={l.lang} className="set-card set-lang">
          <div className="between"><div><b>{l.name}</b> <span className="muted" dir={l.dir}>{l.native}</span></div><span className={`pill${l.live ? ' pill-on' : ''}`}>{l.live ? 'Approved for production' : 'Preview only'}</span></div>
          <div className="set-meter" role="meter" aria-valuemin={0} aria-valuemax={l.total} aria-valuenow={l.translated} aria-label={`${l.name} translated`}><i style={{ width: `${pct(l.translated, l.total)}%` }} /></div>
          <small className="muted">{l.translated} of {l.total} texts translated ({pct(l.translated, l.total)}%) · {l.status ? ({ draft: 'draft', in_review: 'in review', changes_requested: 'changes requested', approved: 'approved, not published', published: 'translation published' } as Record<string, string>)[l.status] ?? l.status : 'not started'}{!l.live ? ' · not approved for the production site yet: preview builds show it as “under review”, noindex' : ''}{l.dir === 'rtl' ? ' · right-to-left' : ''}</small>
        </div>))}</div>}
    </>
  );
}

// ---------------------------------------------------------------- Media (facts)
type MediaFacts = { total: number; missingAlt: number; rightsUnconfirmed: number; rightsExpiringIn30Days: number; rightsExpired: number; originalBytes: number; maxUploadMb: number };
export function MediaPanel({ c }: { c: Cat }) {
  const { d, err } = useFacts<MediaFacts>('/settings/facts/media');
  return (
    <>
      <PanelHead title={c.label} summary="What the Media library needs attention for. Images are edited there." icon={c.icon} link={c.link} />
      {!d ? <Loading err={err} /> : <>
        <div className="set-card"><Stats items={[
          { label: 'Images', value: d.total, hint: `${fmtBytes(d.originalBytes)} of originals` },
          { label: 'Missing alt text', value: d.missingAlt, tone: d.missingAlt ? 'warn' : null, hint: 'Needed before publishing' },
          { label: 'Rights not confirmed', value: d.rightsUnconfirmed, tone: d.rightsUnconfirmed ? 'warn' : null },
          { label: 'Rights ending in 30 days', value: d.rightsExpiringIn30Days, tone: d.rightsExpiringIn30Days ? 'warn' : null, hint: d.rightsExpired ? `${d.rightsExpired} already ended` : undefined },
        ]} /></div>
        <div className="set-card"><h3>Uploads</h3><p className="set-line muted">Up to {d.maxUploadMb} MB per file; JPEG, PNG, WebP, AVIF or TIFF. Location data is removed and web sizes are made automatically. The limit is MAX_UPLOAD_MB in studio/.env <i className="set-eff set-eff-restart">Restart Studio</i></p></div>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- Performance (facts)
type PerfFacts = { pages: { count: number; bytes: number; largest: { file: string; bytes: number }[] }; languages: { lang: string; bytes: number; files: number }[]; assets: { css: number | null; js: number | null; media: { bytes: number; files: number }; images: { bytes: number; files: number } }; builds: { measured: number; medianMs: number | null; lastAt: string | null }; note: string };
export function PerformancePanel({ c }: { c: Cat }) {
  const { d, err } = useFacts<PerfFacts>('/settings/facts/performance');
  const max = d ? Math.max(...d.pages.largest.map((p) => p.bytes), 1) : 1;
  return (
    <>
      <PanelHead title={c.label} summary="Sizes of the built site as it is on disk now, and how long recent publishes took." icon={c.icon} />
      {!d ? <Loading err={err} /> : <>
        <div className="set-card"><Stats items={[
          { label: 'English pages', value: d.pages.count, hint: `${fmtBytes(d.pages.bytes)} of HTML` },
          { label: 'Stylesheet', value: fmtBytes(d.assets.css), hint: 'assets/styles.css' },
          { label: 'Script', value: fmtBytes(d.assets.js), hint: 'assets/main.js' },
          { label: 'Published images', value: d.assets.media.files, hint: fmtBytes(d.assets.media.bytes) },
          { label: 'Typical publish', value: d.builds.medianMs === null ? '—' : `${(d.builds.medianMs / 1000).toFixed(1)} s`, hint: d.builds.measured ? `median of the last ${d.builds.measured}` : 'No publish recorded yet' },
        ]} /></div>
        <div className="set-card"><h3>Largest pages</h3>
          <ul className="set-bars">{d.pages.largest.map((p) => <li key={p.file}><span className="mono">{p.file}</span><i><b style={{ width: `${pct(p.bytes, max)}%` }} /></i><span>{fmtBytes(p.bytes)}</span></li>)}</ul>
          <p className="muted set-note">{d.note}</p>
        </div>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- Security & access (facts + one action)
type SecFacts = { roles: { id: string; label: string; users: number; permissions: number }[]; inactiveUsers: number; localOnlyPasswords: number; neverSignedIn: number; failedSignIns: { last24h: number; last7d: number }; activeSessions: number; mySessions: number; transport: { origin: string; https: boolean; secureCookies: boolean }; encryptionKey: string; fixed: string };
export function SecurityPanel({ c, perms }: { c: Cat; perms: Perms }) {
  const { d, err, reload } = useFacts<SecFacts>(perms.admin ? '/settings/facts/security' : null);
  const toast = useToast(); const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try { const r = await post<{ signedOut: number }>('/settings/security/sign-out-others'); toast(r.signedOut ? `Signed out ${r.signedOut} other session${r.signedOut === 1 ? '' : 's'}.` : 'You had no other sessions.'); reload(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  if (!perms.admin) return <><PanelHead title={c.label} summary={c.summary} icon={c.icon} /><AdminOnly what="security details" /></>;
  return (
    <>
      <PanelHead title={c.label} summary="Who can do what, sign-in activity and how Studio is reached. Accounts are managed in Users & roles." icon={c.icon} link={c.link} />
      {!d ? <Loading err={err} /> : <>
        <div className="set-card"><Stats items={[
          { label: 'Failed sign-ins', value: d.failedSignIns.last24h, hint: `last 24 h · ${d.failedSignIns.last7d} in 7 days`, tone: d.failedSignIns.last24h >= 10 ? 'warn' : null },
          { label: 'Active sessions', value: d.activeSessions, hint: `${d.mySessions} of them yours` },
          { label: 'Inactive accounts', value: d.inactiveUsers },
          { label: 'Local-only passwords', value: d.localOnlyPasswords, tone: d.localOnlyPasswords && d.transport.https ? 'warn' : null, hint: 'Work on localhost only' },
          { label: 'Never signed in', value: d.neverSignedIn },
        ]} />
          <div><button className="btn btn-sm" disabled={busy || d.mySessions < 2} onClick={signOut}><Icon n="logout" />{busy ? 'Signing out…' : 'Sign out my other sessions'}</button></div>
        </div>
        <div className="set-card"><h3>Connection</h3>
          <Checks checks={[
            { id: 'https', label: 'Studio is served over HTTPS', ok: d.transport.https ? true : d.transport.origin.includes('localhost') ? null : false, detail: d.transport.https ? d.transport.origin : d.transport.origin.includes('localhost') ? `${d.transport.origin} (local: HTTPS not needed)` : `${d.transport.origin}: sign-in cookies travel unencrypted` },
            { id: 'cookies', label: 'Secure sign-in cookies', ok: d.transport.secureCookies ? true : d.transport.origin.includes('localhost') ? null : false, detail: d.transport.secureCookies ? 'Cookies are only sent over HTTPS.' : 'Follows STUDIO_ORIGIN: on when it starts with https://' },
            { id: 'key', label: 'Encryption key for stored secrets', ok: d.encryptionKey === 'env' ? true : null, detail: d.encryptionKey === 'env' ? 'STUDIO_ENCRYPTION_KEY is set.' : 'A random key in the data folder. Set STUDIO_ENCRYPTION_KEY for production.' },
          ]} />
        </div>
        <div className="set-card"><h3>Roles</h3>
          <table className="set-table"><thead><tr><th>Role</th><th>People</th><th>Permissions</th></tr></thead>
            <tbody>{d.roles.map((r) => <tr key={r.id}><td>{r.label}</td><td>{r.users}</td><td>{r.permissions}</td></tr>)}</tbody></table>
          <p className="muted set-note">{d.fixed}</p>
        </div>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- Backups
type Backups = { supported: boolean; backups: { name: string; bytes: number; createdAt: string; kind: 'studio' | 'manual' }[]; folder: string; covers: string; restore: string };
export function BackupsPanel({ c, perms }: { c: Cat; perms: Perms }) {
  const { d, err, reload } = useFacts<Backups>(perms.admin ? '/settings/backups' : null);
  const toast = useToast(); const [busy, setBusy] = useState(false); const [drop, setDrop] = useState<string | null>(null);
  async function make() {
    setBusy(true);
    try { const r = await post<{ name: string; bytes: number }>('/settings/backups'); toast(`Backup saved: ${r.name} (${fmtBytes(r.bytes)})`); reload(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  async function remove(name: string) {
    try { await del(`/settings/backups/${encodeURIComponent(name)}`); toast('Backup deleted.'); setDrop(null); reload(); } catch (e) { toast((e as Error).message, true); }
  }
  if (!perms.admin) return <><PanelHead title={c.label} summary={c.summary} icon={c.icon} /><AdminOnly what="backups" /></>;
  const latest = d?.backups[0];
  return (
    <>
      <PanelHead title={c.label} summary="A backup copies the whole database while Studio keeps running. Make one before big changes." icon={c.icon}>
        {d?.supported && <button className="btn btn-sm btn-primary" id="set-backup" disabled={busy} onClick={make}><Icon n="archive" />{busy ? 'Backing up…' : 'Back up now'}</button>}
      </PanelHead>
      {!d ? <Loading err={err} /> : <>
        {!d.supported && <div className="notice n-info"><Icon n="alert" /><span>Studio uses a PostgreSQL server: back it up with pg_dump on that server.</span></div>}
        <div className={`notice ${latest && Date.now() - new Date(latest.createdAt).getTime() < 7 * 86400_000 ? 'n-ok' : 'n-warn'}`}><Icon n={latest ? 'checkcircle' : 'alert'} /><span>{latest ? `Latest backup ${ago(latest.createdAt)} (${fmtDate(latest.createdAt)})` : 'No backup found.'}</span></div>
        <div className="set-card">
          {d.backups.length ? <table className="set-table"><thead><tr><th>Backup</th><th>Made</th><th>Size</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.backups.map((b) => <tr key={b.name}><td><span className="mono">{b.name}</span><br /><small className="muted">{b.kind === 'studio' ? 'Made by Studio' : 'Folder copy made by hand'}</small></td><td>{fmtDate(b.createdAt)}</td><td>{fmtBytes(b.bytes)}</td>
              <td>{b.kind === 'studio' && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setDrop(b.name)} aria-label={`Delete ${b.name}`}><Icon n="x" /></button>}</td></tr>)}</tbody></table>
            : <p className="muted" style={{ margin: 0 }}>No backups yet.</p>}
        </div>
        <div className="set-ro"><b>What a backup contains</b><p className="muted">{d.covers}</p><b>Restoring</b><p className="muted">{d.restore}</p><p className="muted">Studio backups are saved in {d.folder}. Keep a copy somewhere else too: a backup on the same disk does not protect against losing the disk.</p></div>
      </>}
      {drop && <Modal title="Delete backup" size="sm" onClose={() => setDrop(null)} footer={<><button className="btn" onClick={() => setDrop(null)}>Cancel</button><button className="btn btn-primary" onClick={() => remove(drop)}>Delete permanently</button></>}>
        <div className="modal-b"><p style={{ margin: 0 }}>Delete <span className="mono">{drop}</span>? This cannot be undone.</p></div></Modal>}
    </>
  );
}

// ---------------------------------------------------------------- Maintenance (facts)
type Maint = { recent: { id: string; kind: string; status: string; error: string | null; createdAt: string; finishedAt: string | null }[]; failedLast7Days: number; seoJobs: Record<string, number>; scheduler: string; maintenanceMode: string };
const JOB_LABEL = (k: string) => k.replace(/_/g, ' ').replace(/^publish /, 'Publish ').replace(/^unpublish /, 'Unpublish ');
export function MaintenancePanel({ c, perms }: { c: Cat; perms: Perms }) {
  const { d, err } = useFacts<Maint>(perms.admin ? '/settings/facts/maintenance' : null);
  if (!perms.admin) return <><PanelHead title={c.label} summary={c.summary} icon={c.icon} /><AdminOnly what="jobs" /></>;
  return (
    <>
      <PanelHead title={c.label} summary="What Studio runs in the background, and recent deliveries to the website." icon={c.icon} link={c.link} />
      {!d ? <Loading err={err} /> : <>
        <div className="set-card"><Stats items={[
          { label: 'Failed publishes', value: d.failedLast7Days, hint: 'last 7 days', tone: d.failedLast7Days ? 'warn' : null },
          { label: 'Background jobs', value: Object.values(d.seoJobs).reduce((a, b) => a + b, 0), hint: Object.entries(d.seoJobs).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none in 7 days' },
        ]} /></div>
        <div className="set-card"><h3>Recent publishing</h3>
          {d.recent.length ? <ul className="set-jobs">{d.recent.map((j) => <li key={j.id}><i className={`set-ck ${j.status === 'succeeded' ? 'ok' : j.status === 'failed' ? 'bad' : 'na'}`} aria-label={j.status} role="img" /><div><b>{JOB_LABEL(j.kind)}</b><small>{fmtDate(j.createdAt)}{j.finishedAt ? ` · ${((new Date(j.finishedAt).getTime() - new Date(j.createdAt).getTime()) / 1000).toFixed(1)} s` : ''}{j.error ? ` · ${j.error.slice(0, 140)}` : ''}</small></div></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nothing published yet.</p>}
        </div>
        <div className="set-ro"><b>Scheduler</b><p className="muted">{d.scheduler}</p><b>Maintenance mode</b><p className="muted">{d.maintenanceMode}</p></div>
      </>}
    </>
  );
}

