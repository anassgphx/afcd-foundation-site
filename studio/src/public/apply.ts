// AFCD Apply public form (built to ../assets/apply.js by `npm run build:apply`). Renders the call's published form with
// the same engine the server runs, saves a draft as the applicant types, and never says "submitted" unless the server
// answered with a reference. Plain DOM, text nodes only: nothing from the form or the server is inserted as HTML.
import { evaluate, FIELD_TYPES, FILE_TYPES, t, validate, type Answers, type Field, type FileRef, type FormDef, type Lang } from '../server/modules/apply/engine.ts';

type Lng = 'en' | 'fr' | 'ar';
type DraftView = { id: string; rev: number; page: string | null; lang: Lng; answers: Answers; expiresAt: string; files: (FileRef & { field: string })[];
  call: { slug: string; title: string; state: string | null; closesAt: string | null; timeZone: string; contactEmail: string };
  version: { id: string; number: number; definition: FormDef } };

const UI: Record<string, Record<Lng, string>> = {
  start: { en: 'Start my application', fr: 'Commencer ma candidature', ar: 'ابدأ طلبي' },
  intro: { en: 'Your answers are saved as you go, in this browser. You can stop and come back later.', fr: 'Vos réponses sont enregistrées au fur et à mesure dans ce navigateur. Vous pouvez reprendre plus tard.', ar: 'تُحفظ إجاباتك تلقائيًا في هذا المتصفح. يمكنك التوقف والعودة لاحقًا.' },
  next: { en: 'Next', fr: 'Suivant', ar: 'التالي' }, back: { en: 'Back', fr: 'Retour', ar: 'رجوع' },
  review: { en: 'Review my answers', fr: 'Vérifier mes réponses', ar: 'مراجعة إجاباتي' }, reviewTitle: { en: 'Check your answers', fr: 'Vérifiez vos réponses', ar: 'تحقق من إجاباتك' },
  edit: { en: 'Change', fr: 'Modifier', ar: 'تعديل' }, submit: { en: 'Submit my application', fr: 'Envoyer ma candidature', ar: 'إرسال طلبي' },
  step: { en: 'Step {n} of {m}', fr: 'Étape {n} sur {m}', ar: 'الخطوة {n} من {m}' },
  saving: { en: 'Saving…', fr: 'Enregistrement…', ar: 'جارٍ الحفظ…' }, saved: { en: 'Saved', fr: 'Enregistré', ar: 'تم الحفظ' },
  offline: { en: 'Not saved yet: we will try again.', fr: 'Pas encore enregistré : nouvel essai bientôt.', ar: 'لم يُحفظ بعد: سنحاول مجددًا.' },
  conflict: { en: 'This application was changed in another window or device. Reload the page to continue with the latest answers.', fr: 'Cette candidature a été modifiée dans une autre fenêtre ou sur un autre appareil. Rechargez la page pour continuer.', ar: 'تم تعديل هذا الطلب في نافذة أو جهاز آخر. أعد تحميل الصفحة للمتابعة.' },
  reload: { en: 'Reload', fr: 'Recharger', ar: 'إعادة التحميل' },
  fix: { en: 'Please check these answers:', fr: 'Veuillez vérifier ces réponses :', ar: 'يرجى التحقق من هذه الإجابات:' },
  yes: { en: 'Yes', fr: 'Oui', ar: 'نعم' }, no: { en: 'No', fr: 'Non', ar: 'لا' }, choose: { en: 'Choose…', fr: 'Choisir…', ar: 'اختر…' },
  optional: { en: 'optional', fr: 'facultatif', ar: 'اختياري' }, remove: { en: 'Remove', fr: 'Retirer', ar: 'إزالة' }, uploading: { en: 'Uploading…', fr: 'Envoi…', ar: 'جارٍ الرفع…' },
  linkTitle: { en: 'Continue on another device', fr: 'Continuer sur un autre appareil', ar: 'المتابعة على جهاز آخر' },
  linkText: { en: 'We email you a link that works once, for 72 hours. The email does not contain your answers.', fr: 'Nous vous envoyons un lien valable une fois, pendant 72 heures. L’e-mail ne contient pas vos réponses.', ar: 'نرسل إليك رابطًا صالحًا مرة واحدة لمدة 72 ساعة. لا يحتوي البريد على إجاباتك.' },
  send: { en: 'Email me a link', fr: 'M’envoyer un lien', ar: 'أرسل لي رابطًا' }, email: { en: 'Email', fr: 'E-mail', ar: 'البريد الإلكتروني' },
  sent: { en: 'If the address is valid, a link is on its way. Check your inbox (and spam folder).', fr: 'Si l’adresse est valide, un lien est en route. Vérifiez votre boîte (et les indésirables).', ar: 'إذا كان العنوان صحيحًا فالرابط في الطريق. تحقق من بريدك (ومجلد الرسائل غير المرغوب فيها).' },
  noConnect: { en: 'Online applications are not available on this copy of the website.', fr: 'Les candidatures en ligne ne sont pas disponibles sur cette copie du site.', ar: 'التقديم عبر الإنترنت غير متاح في هذه النسخة من الموقع.' },
  error: { en: 'Something went wrong. Your saved answers are kept; please try again.', fr: 'Une erreur est survenue. Vos réponses enregistrées sont conservées ; réessayez.', ar: 'حدث خطأ. إجاباتك المحفوظة باقية؛ حاول مرة أخرى.' },
  closed: { en: 'Applications for this call are closed.', fr: 'Les candidatures pour cet appel sont closes.', ar: 'باب الترشح لهذه الدعوة مغلق.' },
  paused: { en: 'Applications are paused for a moment. Your answers are kept; please come back later.', fr: 'Les candidatures sont suspendues un moment. Vos réponses sont conservées.', ar: 'تم إيقاف الترشح مؤقتًا. إجاباتك محفوظة؛ يرجى العودة لاحقًا.' },
  done: { en: 'Application received', fr: 'Candidature reçue', ar: 'تم استلام الطلب' }, ref: { en: 'Your reference', fr: 'Votre référence', ar: 'رقمك المرجعي' },
  deadline: { en: 'Deadline: {d}', fr: 'Date limite : {d}', ar: 'آخر أجل: {d}' },
  thanks: { en: 'Thank you. We have your application.', fr: 'Merci. Nous avons bien reçu votre candidature.', ar: 'شكرًا. لقد استلمنا طلبك.' },
  keepRef: { en: 'Keep this reference: it identifies your application if you contact us.', fr: 'Gardez cette référence : elle identifie votre candidature si vous nous écrivez.', ar: 'احتفظ بهذا الرقم المرجعي: يعرّف طلبك إذا تواصلت معنا.' },
  copy: { en: 'Copy', fr: 'Copier', ar: 'نسخ' }, copied: { en: 'Copied', fr: 'Copié', ar: 'تم النسخ' },
  next2: { en: 'What happens next', fr: 'La suite', ar: 'ماذا بعد' },
  questions: { en: 'Questions? Write to {e}.', fr: 'Des questions ? Écrivez à {e}.', ar: 'أسئلة؟ اكتب إلى {e}.' },
  backCall: { en: 'Back to the call', fr: 'Retour à l’appel', ar: 'العودة إلى الدعوة' }, more: { en: 'Other opportunities', fr: 'Autres opportunités', ar: 'فرص أخرى' },
  reviewStep: { en: 'Review', fr: 'Vérification', ar: 'المراجعة' },
};

function boot() {
  const rootEl = document.getElementById('apply-app');
  const data = document.getElementById('apply-data');
  if (!rootEl || !data) return;
  const root: HTMLElement = rootEl;
  let embedded: { slug: string; title: string; closesAt: string | null; timeZone: string; contactEmail: string; version: { id: string; number: number; definition: FormDef } };
  try { embedded = JSON.parse(data.textContent || '{}'); } catch { return; }
  const meta = document.querySelector('meta[name="afcd-forms"]') as HTMLMetaElement | null;
  let api = '';
  try { if (meta?.content) api = `${new URL(meta.content).origin}/apply/v1`; } catch { api = ''; }
  const docLang = (document.documentElement.lang || 'en').slice(0, 2) as Lng;
  const slug = embedded.slug;
  const KEY = `afcd-apply:${slug}`;
  const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* private mode: the draft still works until the tab closes */ } } };

  let def = embedded.version.definition;
  let lang: Lng = def.settings.languages.includes(docLang) ? docLang : 'en';
  const u = (k: string, vars: Record<string, string | number> = {}) => (UI[k]?.[lang] ?? UI[k]?.en ?? k).replace(/\{(\w+)\}/g, (_, x) => String(vars[x] ?? ''));
  let token: string | null = null;
  let draft: DraftView | null = null;
  let answers: Answers = {};
  let page = '';
  let errors: Record<string, Lang> = {};
  let saveTimer = 0, saving: Promise<void> | null = null, dirty = false, frozen = false;
  const started = Date.now();

  // Application mode: "Apply now" turns the call page into just the banner and the form (#apply in the address);
  // "Call details" or the browser's Back button returns to the full page. Without JavaScript the page is unchanged.
  const html = document.documentElement;
  const focusOn = () => { html.classList.add('ap-focus'); window.scrollTo({ top: 0 }); };
  const focusOff = () => { html.classList.remove('ap-focus'); };
  document.querySelectorAll<HTMLAnchorElement>('a[href="#apply"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); if (location.hash !== '#apply') history.pushState(null, '', '#apply'); focusOn(); }));
  document.querySelector('[data-ap-exit]')?.addEventListener('click', (e) => { e.preventDefault(); if (location.hash.startsWith('#apply')) history.back(); else focusOff(); setTimeout(() => window.scrollTo({ top: 0 }), 0); });
  window.addEventListener('popstate', () => { if (location.hash.startsWith('#apply') || location.hash.startsWith('#resume=')) focusOn(); else focusOff(); });
  if (location.hash.startsWith('#apply') || location.hash.startsWith('#resume=')) focusOn();

  // ---------------------------------------------------------------- DOM helpers (text only)
  function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | number | undefined | null | EventListener> = {}, ...kids: (Node | string | null | undefined | false)[]) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'className') el.className = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
  }
  const put = (...k: (Node | string | null | undefined | false)[]) => root.append(...k.filter((x): x is Node | string => x !== null && x !== undefined && x !== false));
  const clear = () => { while (root.firstChild) root.removeChild(root.firstChild); root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr'); root.setAttribute('lang', lang); };
  const status = h('p', { className: 'ap-save', role: 'status', 'aria-live': 'polite' });
  const banner = (text: string, tone: 'info' | 'warn' | 'bad' = 'info', action?: HTMLElement) => h('div', { className: `ap-msg ap-${tone}`, role: tone === 'bad' ? 'alert' : 'status' }, h('p', {}, text), action);
  const fmtDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: embedded.timeZone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso)) : '');

  async function call<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(api + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), credentials: 'omit', mode: 'cors' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || u('error')) as Error & { status: number; details?: { path: string; message: string }[] }; e.status = res.status; e.details = j.details; throw e; }
    return j as T;
  }

  // ---------------------------------------------------------------- saving
  function scheduleSave() { dirty = true; status.textContent = ''; clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 1200); }
  async function save(): Promise<void> {
    if (frozen || !draft) return;
    if (saving) { await saving; if (!dirty) return; }
    clearTimeout(saveTimer);
    dirty = false; status.textContent = u('saving');
    saving = (async () => {
      try {
        const r = await call<{ rev: number }>('PUT', '/drafts/me', { answers, page, rev: draft!.rev, lang });
        draft!.rev = r.rev; status.textContent = u('saved');
      } catch (e) {
        const err = e as Error & { status?: number; details?: { path: string; message: string }[] };
        if (err.status === 409 && err.details?.[0]?.path === 'rev') { frozen = true; status.textContent = ''; root.prepend(banner(u('conflict'), 'bad', h('button', { type: 'button', className: 'ap-btn', onclick: () => location.reload() }, u('reload')))); }
        else if (err.status === 409) { frozen = true; status.textContent = ''; root.prepend(banner(err.message, 'warn')); root.querySelectorAll('input,select,textarea,button.ap-next').forEach((x) => ((x as HTMLInputElement).disabled = true)); }
        else { dirty = true; status.textContent = u('offline'); saveTimer = window.setTimeout(() => void save(), 5000); }
      } finally { saving = null; }
    })();
    return saving;
  }
  window.addEventListener('beforeunload', (e) => { if (dirty && !frozen) { void save(); e.preventDefault(); } });

  // ---------------------------------------------------------------- start / resume
  async function start() {
    if (!api) { clear(); put(banner(u('noConnect'), 'warn')); return; }
    const hash = /#resume=([A-Za-z0-9_-]{43})/.exec(location.hash);
    if (hash) {
      history.replaceState(null, '', location.pathname + location.search + '#apply');
      try { const r = await call<{ token: string; draft: DraftView }>('POST', '/resume', { token: hash[1] }); token = r.token; store.set(token); return open(r.draft); }
      catch (e) { clear(); put(banner((e as Error).message, 'warn')); }
    }
    token = store.get();
    if (token) {
      try { return open(await call<DraftView>('GET', '/drafts/me')); }
      catch { token = null; store.set(null); }
    }
    let live: { call: { state: string | null; closesAt: string | null }; version: { definition: FormDef } | null } | null = null;
    try { live = await call('GET', `/calls/${slug}`); } catch { /* keep the page's copy */ }
    if (live?.version) def = live.version.definition;
    const state = live?.call.state ?? 'open';
    root.querySelector('[data-ap-loading]')?.remove();
    clear();
    if (state !== 'open') { put(banner(u(state === 'paused' ? 'paused' : 'closed'), 'warn')); return; }
    const begin = h('button', { type: 'button', className: 'ap-btn ap-primary' }, u('start'));
    const err = h('div');
    begin.addEventListener('click', async () => {
      (begin as HTMLButtonElement).disabled = true;
      try { const r = await call<{ token: string; draft: DraftView }>('POST', `/calls/${slug}/drafts`, { lang, t: Date.now() - started }); token = r.token; store.set(token); open(r.draft); }
      catch (e) { err.replaceChildren(banner((e as Error).message, 'bad')); (begin as HTMLButtonElement).disabled = false; }
    });
    put(h('div', { className: 'ap-intro' }, live?.call.closesAt || embedded.closesAt ? h('p', { className: 'ap-deadline' }, u('deadline', { d: fmtDate(live?.call.closesAt ?? embedded.closesAt) })) : null, h('p', {}, u('intro')), begin, err));
  }

  function open(d: DraftView) {
    draft = d; def = d.version.definition; answers = d.answers ?? {};
    if (def.settings.languages.includes(d.lang)) lang = d.lang;
    const ev = evaluate(def, answers);
    page = d.page && (d.page === 'review' || ev.path.includes(d.page)) ? d.page : ev.path[0];
    if (d.call.state !== 'open') { frozen = true; }
    render();
  }

  // ---------------------------------------------------------------- pages
  function render() {
    clear(); errors = errors || {};
    if (frozen && draft?.call.state !== 'open') put(banner(u(draft?.call.state === 'paused' ? 'paused' : 'closed'), 'warn'));
    if (page === 'review') return renderReview();
    const ev = evaluate(def, answers);
    const p = def.pages.find((x) => x.id === page) ?? def.pages.find((x) => x.id === ev.path[0])!;
    page = p.id;
    const idx = Math.max(0, ev.path.indexOf(p.id)), total = ev.path.length + (def.settings.reviewStep ? 1 : 0);
    const langs = def.settings.languages.length > 1 ? h('div', { className: 'ap-langs', role: 'group', 'aria-label': 'Language' }, ...def.settings.languages.map((l) => h('button', { type: 'button', className: `ap-lang${l === lang ? ' on' : ''}`, 'aria-pressed': l === lang ? 'true' : 'false', lang: l, onclick: () => { lang = l; scheduleSave(); render(); } }, l === 'en' ? 'English' : l === 'fr' ? 'Français' : 'العربية'))) : null;
    const bar = h('div', { className: 'ap-progress', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': total, 'aria-valuenow': idx + 1, 'aria-label': u('step', { n: idx + 1, m: total }) }, h('span', { style: `width:${Math.round(((idx + 1) / total) * 100)}%` }));
    const heading = h('h3', { className: 'ap-page-title', tabindex: '-1' }, t(p.title, lang));
    const steps = stepList(ev.path, idx);
    const summary = h('div', { className: 'ap-summary' });
    const msgs = h('div', { className: 'ap-msgs' });
    const fields = h('div', { className: 'ap-fields' });
    const views = new Map<string, { wrap: HTMLElement; req: HTMLElement | null; out: HTMLElement | null; err: HTMLElement }>();
    for (const f of p.fields) { const v = fieldView(f, () => { refresh(); scheduleSave(); }); views.set(f.id, v); fields.append(v.wrap); }
    const back = h('button', { type: 'button', className: 'ap-btn', disabled: idx === 0, onclick: async () => { await save(); page = ev.path[Math.max(0, ev.path.indexOf(page) - 1)]; errors = {}; render(); focusTitle(); } }, u('back'));
    const next = h('button', { type: 'button', className: 'ap-btn ap-primary ap-next', disabled: frozen, onclick: () => void goNext() }, u('next'));
    function refresh() {
      const e2 = evaluate(def, answers);
      for (const f of p.fields) {
        const v = views.get(f.id)!;
        v.wrap.hidden = !e2.visibleFields.has(f.id);
        if (v.req) v.req.textContent = e2.required.has(f.id) ? ' *' : ` (${u('optional')})`;
        if (v.out) { const x = e2.values[f.id]; v.out.textContent = x === undefined ? '—' : `${Number(x).toLocaleString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: f.config?.decimals ?? 2 })}${f.config?.unit ? ` ${f.config.unit}` : ''}`; }
      }
      msgs.replaceChildren(...e2.messages.filter((m) => !m.page || m.page === p.id).map((m) => banner(t(m.text, lang), m.tone === 'warning' ? 'warn' : 'info')));
      const last = !e2.next(p.id);
      next.textContent = last ? (def.settings.reviewStep ? u('review') : t(def.settings.submitLabel, lang) || u('submit')) : u('next');
      showErrors();
    }
    function showErrors() {
      for (const [id, v] of views) { const m = errors[id]; v.err.textContent = m ? t(m, lang) : ''; v.err.hidden = !m; v.wrap.classList.toggle('ap-bad', !!m); const inp = v.wrap.querySelector('input,select,textarea'); if (inp) { if (m) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); } }
      const list = Object.entries(errors).filter(([id]) => views.has(id));
      summary.replaceChildren(...(list.length ? [h('div', { className: 'ap-msg ap-bad', role: 'alert', tabindex: '-1' }, h('p', {}, u('fix')), h('ul', {}, ...list.map(([id, m]) => h('li', {}, h('a', { href: `#ap-${id}` }, `${t(def.pages.flatMap((x) => x.fields).find((x) => x.id === id)?.label, lang)}: ${t(m, lang)}`)))))] : []));
    }
    async function goNext() {
      const v = validate(def, answers, [p.id]);
      if (!v.ok) { errors = Object.fromEntries(v.errors.map((e) => [e.field, e.message])); showErrors(); (summary.firstChild as HTMLElement | null)?.focus(); return; }
      errors = {}; await save();
      const n = evaluate(def, answers).next(p.id);
      page = n ?? (def.settings.reviewStep ? 'review' : page);
      if (!n && !def.settings.reviewStep) return void submit();
      scheduleSave(); render(); focusTitle();
    }
    put(h('div', { className: 'ap-pagehead' }, h('div', { className: 'ap-head' }, h('p', { className: 'ap-step' }, u('step', { n: idx + 1, m: total })), langs), bar, steps, heading,
      p.description ? h('p', { className: 'ap-page-desc' }, t(p.description, lang)) : null), summary, msgs, fields,
      h('div', { className: 'ap-nav' }, back, h('span', { className: 'ap-sp' }), status, next), resumeBox());
    refresh();
  }
  /** The wizard's steps by name: done ones ticked, the current one highlighted; the review step last when the form has one. */
  function stepList(path: string[], at: number) {
    const names = path.map((pid) => t(def.pages.find((x) => x.id === pid)?.title, lang));
    if (def.settings.reviewStep) names.push(u('reviewStep'));
    if (names.length < 2) return null;
    return h('ol', { className: 'ap-steps' }, ...names.map((n, i) => h('li', { className: i < at ? 'done' : i === at ? 'on' : '', 'aria-current': i === at ? 'step' : undefined },
      h('span', { className: 'ap-steps-n', 'aria-hidden': 'true' }, i < at ? '✓' : String(i + 1)), h('span', { className: 'ap-steps-t' }, n || `${i + 1}`))));
  }
  const focusTitle = () => { (root.querySelector('.ap-page-title') as HTMLElement | null)?.focus(); root.scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  function fieldView(f: Field, changed: () => void) {
    const id = `ap-${f.id}`, c = f.config ?? {}, a = f.appearance ?? {};
    const err = h('p', { className: 'ap-err', id: `${id}-err`, hidden: true });
    const help = f.help && t(f.help, lang) ? h('p', { className: 'ap-help', id: `${id}-help` }, t(f.help, lang)) : null;
    const describedby = [help ? `${id}-help` : '', `${id}-err`].filter(Boolean).join(' ');
    const req = FIELD_TYPES[f.type].input && f.type !== 'consent' ? h('span', { className: 'ap-req' }) : null;
    const label = h('label', { className: 'ap-label', for: id, id: `${id}-l` }, t(f.label, lang), req);
    const set = (v: unknown) => { if (v === null || v === '' || (Array.isArray(v) && !v.length)) delete answers[f.id]; else answers[f.id] = v as never; changed(); };
    const val = answers[f.id];
    let control: HTMLElement | null = null, out: HTMLElement | null = null;
    const ph = t(a.placeholder, lang) || undefined;
    switch (f.type) {
      case 'short_text': case 'email': case 'phone': case 'url':
        control = h('input', { id, className: 'ap-input', type: f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : 'text', maxlength: c.maxLength ?? 300, placeholder: ph, 'aria-describedby': describedby, autocomplete: f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.id === 'full_name' ? 'name' : 'off', value: typeof val === 'string' ? val : '' });
        control.addEventListener('input', (e) => set((e.target as HTMLInputElement).value)); break;
      case 'long_text':
        control = h('textarea', { id, className: 'ap-input', rows: a.rows ?? 5, maxlength: c.maxLength ?? 5000, placeholder: ph, 'aria-describedby': describedby }, typeof val === 'string' ? val : '');
        control.addEventListener('input', (e) => set((e.target as HTMLTextAreaElement).value)); break;
      case 'number':
        control = h('input', { id, className: 'ap-input ap-short', type: 'number', inputmode: 'decimal', min: c.min, max: c.max, step: c.step ?? 'any', 'aria-describedby': describedby, value: typeof val === 'number' ? String(val) : '' });
        control.addEventListener('input', (e) => { const s = (e.target as HTMLInputElement).value; set(s === '' ? null : Number(s)); }); break;
      case 'date':
        control = h('input', { id, className: 'ap-input ap-short', type: 'date', min: c.minDate, max: c.maxDate, 'aria-describedby': describedby, value: typeof val === 'string' ? val : '' });
        control.addEventListener('change', (e) => set((e.target as HTMLInputElement).value || null)); break;
      case 'single_choice':
        if (a.display === 'dropdown') {
          control = h('select', { id, className: 'ap-input', 'aria-describedby': describedby }, h('option', { value: '' }, u('choose')), ...(c.options ?? []).map((o) => h('option', { value: o.value, selected: val === o.value }, t(o.label, lang))));
          control.addEventListener('change', (e) => set((e.target as HTMLSelectElement).value || null));
        } else control = h('div', { className: `ap-choices${a.display === 'buttons' ? ' ap-row' : ''}`, role: 'radiogroup', 'aria-labelledby': `${id}-l`, 'aria-describedby': describedby, id },
          ...(c.options ?? []).map((o) => { const r = h('input', { type: 'radio', name: id, value: o.value, checked: val === o.value }); r.addEventListener('change', () => set(o.value)); return h('label', { className: 'ap-choice' }, r, h('span', {}, t(o.label, lang))); }));
        break;
      case 'multi_choice': {
        const cur = new Set(Array.isArray(val) ? (val as string[]) : []);
        control = h('div', { className: 'ap-choices', role: 'group', 'aria-labelledby': `${id}-l`, 'aria-describedby': describedby, id },
          ...(c.options ?? []).map((o) => { const x = h('input', { type: 'checkbox', value: o.value, checked: cur.has(o.value) }); x.addEventListener('change', (e) => { if ((e.target as HTMLInputElement).checked) cur.add(o.value); else cur.delete(o.value); set([...cur]); }); return h('label', { className: 'ap-choice' }, x, h('span', {}, t(o.label, lang))); }));
        break;
      }
      case 'yes_no':
        control = h('div', { className: 'ap-choices ap-row', role: 'radiogroup', 'aria-labelledby': `${id}-l`, 'aria-describedby': describedby, id },
          ...([true, false] as const).map((b) => { const r = h('input', { type: 'radio', name: id, checked: val === b }); r.addEventListener('change', () => set(b)); return h('label', { className: 'ap-choice' }, r, h('span', {}, u(b ? 'yes' : 'no'))); }));
        break;
      case 'consent': {
        const x = h('input', { type: 'checkbox', id, checked: val === true, 'aria-describedby': describedby });
        x.addEventListener('change', (e) => set((e.target as HTMLInputElement).checked ? true : null));
        return { wrap: h('div', { className: 'ap-field ap-consent', id: `${id}-w` }, h('label', { className: 'ap-check' }, x, h('span', {}, t(f.label, lang), h('span', { className: 'ap-req' }, f.required ? ' *' : ''))), c.text && t(c.text, lang) ? h('p', { className: 'ap-help' }, t(c.text, lang)) : null, help, err), req: null, out: null, err };
      }
      case 'file': return fileField(f, id, label, help, err, describedby, changed);
      case 'statement':
        return { wrap: h('div', { className: 'ap-field ap-statement' }, t(f.label, lang) ? h('h4', {}, t(f.label, lang)) : null, c.text ? h('p', {}, t(c.text, lang)) : null), req: null, out: null, err };
      case 'calculated':
        out = h('output', { id, className: 'ap-calc', 'aria-live': 'polite', for: '' }, '—');
        return { wrap: h('div', { className: 'ap-field', id: `${id}-w` }, h('p', { className: 'ap-label', id: `${id}-l` }, t(f.label, lang)), help, out, err), req: null, out, err };
    }
    return { wrap: h('div', { className: `ap-field${(a.width ?? 'full') === 'half' ? ' ap-half' : ''}`, id: `${id}-w` }, label, help, control, err), req, out, err };
  }

  function fileField(f: Field, id: string, label: HTMLElement, help: HTMLElement | null, err: HTMLElement, describedby: string, changed: () => void) {
    const c = f.config ?? {};
    const kinds = (c.accept?.length ? c.accept : ['pdf']);
    const accept = kinds.flatMap((k) => FILE_TYPES[k]?.ext.map((e) => `.${e}`) ?? []).join(',');
    const list = h('ul', { className: 'ap-files' });
    const note = h('p', { className: 'ap-help' }, `${kinds.map((k) => FILE_TYPES[k]?.label).join(', ')} · ≤ ${c.maxMb ?? 10} MB${(c.maxFiles ?? 1) > 1 ? ` · ≤ ${c.maxFiles} files` : ''}`);
    const input = h('input', { type: 'file', id, accept, multiple: (c.maxFiles ?? 1) > 1, 'aria-describedby': describedby, className: 'ap-file' }) as HTMLInputElement;
    const current = () => (Array.isArray(answers[f.id]) ? (answers[f.id] as FileRef[]) : []);
    const draw = () => list.replaceChildren(...current().map((x) => h('li', {}, h('span', {}, `${x.name} (${Math.max(1, Math.round(x.bytes / 1024))} KB)`),
      h('button', { type: 'button', className: 'ap-link', disabled: frozen, onclick: async () => {
        try { await call('DELETE', `/drafts/me/files/${x.id}`); } catch (e) { if ((e as { status?: number }).status !== 404) { err.textContent = (e as Error).message; err.hidden = false; return; } }
        const left = current().filter((y) => y.id !== x.id); if (left.length) answers[f.id] = left; else delete answers[f.id]; draw(); changed();
      } }, u('remove')))));
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      for (const file of files) {
        err.hidden = true; const li = h('li', { className: 'ap-up' }, `${file.name}: ${u('uploading')}`); list.append(li);
        const fd = new FormData(); fd.append('field', f.id); fd.append('file', file);
        try { const ref = await call<FileRef & { field: string }>('POST', '/drafts/me/files', undefined, fd); const { field: _x, ...r } = ref; answers[f.id] = [...current(), r]; changed(); }
        catch (e) { err.textContent = `${file.name}: ${(e as Error).message}`; err.hidden = false; }
        li.remove(); draw();
      }
    });
    draw();
    return { wrap: h('div', { className: 'ap-field', id: `${id}-w` }, label, help, note, input, list, err), req: label.querySelector('.ap-req') as HTMLElement | null, out: null, err };
  }

  // ---------------------------------------------------------------- review and submit
  function renderReview() {
    const ev = evaluate(def, answers);
    const all = validate(def, answers);
    const show = (f: Field, v: unknown) => {
      if (v === undefined) return '—';
      if (typeof v === 'boolean') return u(v ? 'yes' : 'no');
      const opt = (x: string) => t(f.config?.options?.find((o) => o.value === x)?.label, lang) || x;
      if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? opt(x) : (x as FileRef).name)).join(', ');
      return typeof v === 'string' && f.config?.options ? opt(v) : String(v);
    };
    const msg = h('div');
    const submitBtn = h('button', { type: 'button', className: 'ap-btn ap-primary', disabled: !all.ok || frozen, onclick: () => void submit(msg, submitBtn as HTMLButtonElement) }, t(def.settings.submitLabel, lang) || u('submit'));
    const rTotal = ev.path.length + 1;
    put(h('div', { className: 'ap-pagehead' }, h('div', { className: 'ap-head' }, h('p', { className: 'ap-step' }, u('step', { n: rTotal, m: rTotal }))),
      h('div', { className: 'ap-progress', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': rTotal, 'aria-valuenow': rTotal, 'aria-label': u('step', { n: rTotal, m: rTotal }) }, h('span', { style: 'width:100%' })),
      stepList(ev.path, ev.path.length), h('h3', { className: 'ap-page-title', tabindex: '-1' }, u('reviewTitle'))),
      ...ev.path.map((pid) => { const p = def.pages.find((x) => x.id === pid)!; return h('section', { className: 'ap-review' }, h('div', { className: 'ap-review-h' }, h('h4', {}, t(p.title, lang)), h('button', { type: 'button', className: 'ap-link', onclick: () => { page = pid; render(); focusTitle(); } }, u('edit'))),
        h('dl', {}, ...p.fields.filter((f) => ev.visibleFields.has(f.id) && (FIELD_TYPES[f.type].input || f.type === 'calculated')).map((f) => h('div', {}, h('dt', {}, t(f.label, lang)), h('dd', {}, show(f, ev.values[f.id])))))); }),
      !all.ok ? banner(`${u('fix')} ${all.errors.map((e) => t(def.pages.flatMap((x) => x.fields).find((x) => x.id === e.field)?.label, lang)).join(', ')}`, 'warn') : null,
      msg, h('div', { className: 'ap-nav' }, h('button', { type: 'button', className: 'ap-btn', onclick: () => { page = ev.path[ev.path.length - 1]; render(); focusTitle(); } }, u('back')), h('span', { className: 'ap-sp' }), status, submitBtn), resumeBox());
  }

  /** Only a reference number from the server means the application was received. */
  async function submit(msg?: HTMLElement, btn?: HTMLButtonElement) {
    if (btn) btn.disabled = true;
    try {
      await save();
      // the same key for every retry of this draft: the server returns the same reference instead of a second application
      const KK = `afcd-apply-key:${draft?.id}`;
      let key = ''; try { key = sessionStorage.getItem(KK) || ''; } catch { /* ignore */ }
      if (!key) { key = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, ''); try { sessionStorage.setItem(KK, key); } catch { /* ignore */ } }
      let r: { reference?: string };
      try { r = await call<{ reference?: string }>('POST', '/drafts/me/submit', { idempotencyKey: key }); }
      catch (e) {
        const err = e as Error & { status?: number; details?: { path: string; message: string; messages?: Lang }[] };
        if (err.status === 422 && err.details?.length) {
          // the server found answers to fix: show them on their page
          errors = Object.fromEntries(err.details.map((x) => [x.path.split('.')[1], x.messages ?? { en: x.message }]));
          page = err.details[0].path.split('.')[0]; render(); focusTitle();
          (root.querySelector('.ap-summary .ap-msg') as HTMLElement | null)?.focus();
          return;
        }
        throw e;
      }
      if (!r.reference) throw new Error(u('error'));
      store.set(null); dirty = false; frozen = true; clear();
      const ref = r.reference;
      const copyBtn = h('button', { type: 'button', className: 'ap-copy' }, u('copy'));
      copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(ref); copyBtn.textContent = u('copied'); setTimeout(() => { copyBtn.textContent = u('copy'); }, 2000); } catch { /* clipboard blocked: the reference stays selectable */ } });
      const confirmation = t(def.settings.confirmation, lang);
      put(h('div', { className: 'ap-done', role: 'status' },
        h('span', { className: 'ap-done-ico', 'aria-hidden': 'true' }, '✓'),
        h('h3', { tabindex: '-1' }, u('done')), h('p', { className: 'ap-done-lead' }, u('thanks')),
        h('div', { className: 'ap-ref' }, h('span', { className: 'ap-ref-l' }, u('ref')), h('strong', { className: 'ap-ref-v' }, ref), copyBtn),
        h('p', { className: 'ap-help' }, u('keepRef')),
        confirmation ? h('div', { className: 'ap-next-box' }, h('h4', {}, u('next2')), h('p', {}, confirmation)) : null,
        embedded.contactEmail ? h('p', { className: 'ap-help' }, u('questions', { e: embedded.contactEmail })) : null,
        h('div', { className: 'ap-done-actions' }, h('a', { className: 'ap-btn', href: '#top', 'data-ap-done-exit': '' }, u('backCall')), h('a', { className: 'ap-btn ap-primary', href: 'get-involved.html' }, u('more')))));
      root.querySelector('[data-ap-done-exit]')?.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', location.pathname + location.search); focusOff(); window.scrollTo({ top: 0 }); });
      window.scrollTo({ top: 0 });
      (root.querySelector('.ap-done h3') as HTMLElement | null)?.focus();
    } catch (e) {
      (msg ?? root).prepend(banner((e as Error).message || u('error'), 'bad'));
      if (btn) btn.disabled = false;
    }
  }

  function resumeBox() {
    if (frozen) return null;
    const out = h('p', { className: 'ap-help', role: 'status' });
    const email = h('input', { type: 'email', className: 'ap-input', id: 'ap-resume-email', autocomplete: 'email', maxlength: 160 }) as HTMLInputElement;
    const form = h('form', { className: 'ap-resume-f', novalidate: true }, h('label', { for: 'ap-resume-email', className: 'ap-label' }, u('email')), email, h('button', { type: 'submit', className: 'ap-btn' }, u('send')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); out.textContent = '';
      try { await call('POST', '/drafts/me/resume-link', { email: email.value.trim() }); out.textContent = u('sent'); email.value = ''; } catch (x) { out.textContent = (x as Error).message; }
    });
    return h('details', { className: 'ap-resume' }, h('summary', {}, u('linkTitle')), h('p', { className: 'ap-help' }, u('linkText')), form, out);
  }

  void start();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
