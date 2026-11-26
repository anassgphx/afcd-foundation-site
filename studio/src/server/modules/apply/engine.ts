// AFCD Apply form engine: one pure module (no imports, no I/O) used by the server, the Studio form builder and the public
// application form. A form is DATA only: pages, fields, rules and calculations as JSON. Nothing here evaluates code or
// strings typed by an editor; there is no expression language, only the small JSON trees below.
//
//   evaluate(def, answers)  → which pages/fields are shown and required, calculated values, messages, eligibility, path
//   validate(def, answers)  → the cleaned answers the server keeps (hidden answers dropped, calculations recomputed) + errors
//   analyze(def)            → problems a form must not be published with (errors) or should be looked at (warnings)

// ---------------------------------------------------------------- Types
export type Lang = { en: string; fr?: string; ar?: string };
export type FieldType = 'short_text' | 'long_text' | 'email' | 'phone' | 'url' | 'number' | 'date' | 'single_choice' | 'multi_choice' | 'yes_no' | 'consent' | 'file' | 'statement' | 'calculated';
export type Option = { value: string; label: Lang };
export type Expr = number | { field: string } | { op: 'sum' | 'sub' | 'mul' | 'div' | 'min' | 'max'; args: Expr[] } | { op: 'round'; arg: Expr; decimals?: number }
  | { op: 'count'; field: string } | { op: 'if'; cond: Cond; then: Expr; else: Expr };
export type FieldConfig = {
  minLength?: number; maxLength?: number;            // texts
  min?: number; max?: number; step?: number;         // number; for dates min/max are not used (see minDate/maxDate)
  minDate?: string; maxDate?: string;                // YYYY-MM-DD
  options?: Option[]; minSelected?: number; maxSelected?: number; allowOther?: boolean;   // choices
  accept?: ('pdf' | 'image' | 'doc' | 'sheet')[]; maxMb?: number; maxFiles?: number;    // file
  expr?: Expr; decimals?: number; unit?: string;     // calculated
  text?: Lang;                                       // statement body, consent text
};
export type Appearance = { width?: 'full' | 'half'; placeholder?: Lang; display?: 'radio' | 'dropdown' | 'buttons' | 'checkbox'; rows?: number };
export type Field = { id: string; type: FieldType; label: Lang; help?: Lang; required?: boolean; config?: FieldConfig; appearance?: Appearance; private?: boolean };
export type Page = { id: string; title: Lang; description?: Lang; fields: Field[] };
export type Op = 'equals' | 'not_equals' | 'contains' | 'includes' | 'not_includes' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty' | 'date_before' | 'date_after';
export type Cond = { all: Cond[] } | { any: Cond[] } | { field: string; op: Op; value?: string | number | boolean };
export type Target = { kind: 'field' | 'page'; id: string };
export type Action =
  | { type: 'show' | 'hide'; target: Target }
  | { type: 'require' | 'optional'; field: string }
  | { type: 'skip_to'; from: string; to: string }
  | { type: 'message'; message: Lang; tone?: 'info' | 'warning'; page?: string }
  | { type: 'eligibility'; result: 'eligible' | 'ineligible' | 'needs_review'; reason: Lang };
export type Rule = { id: string; name?: string; when: Cond; then: Action[] };
export type FormSettings = { languages: ('en' | 'fr' | 'ar')[]; reviewStep: boolean; confirmation: Lang; submitLabel?: Lang };
export type FormDef = { schema: 1; pages: Page[]; rules: Rule[]; settings: FormSettings };
export type Answer = string | number | boolean | string[] | FileRef[] | null;
export type FileRef = { id: string; name: string; bytes: number; mime: string };
export type Answers = Record<string, Answer>;

// ---------------------------------------------------------------- Registry (what each type accepts)
type Kind = 'text' | 'number' | 'date' | 'choice' | 'multi' | 'bool' | 'file' | 'none';
export const FIELD_TYPES: Record<FieldType, { label: string; kind: Kind; input: boolean; group: 'Text' | 'Choice' | 'Number & date' | 'Files' | 'Layout' }> = {
  short_text: { label: 'Short text', kind: 'text', input: true, group: 'Text' },
  long_text: { label: 'Long text', kind: 'text', input: true, group: 'Text' },
  email: { label: 'Email', kind: 'text', input: true, group: 'Text' },
  phone: { label: 'Phone', kind: 'text', input: true, group: 'Text' },
  url: { label: 'Web address', kind: 'text', input: true, group: 'Text' },
  number: { label: 'Number', kind: 'number', input: true, group: 'Number & date' },
  date: { label: 'Date', kind: 'date', input: true, group: 'Number & date' },
  single_choice: { label: 'Single choice', kind: 'choice', input: true, group: 'Choice' },
  multi_choice: { label: 'Multiple choice', kind: 'multi', input: true, group: 'Choice' },
  yes_no: { label: 'Yes / No', kind: 'bool', input: true, group: 'Choice' },
  consent: { label: 'Consent', kind: 'bool', input: true, group: 'Choice' },
  file: { label: 'File upload', kind: 'file', input: true, group: 'Files' },
  statement: { label: 'Text block', kind: 'none', input: false, group: 'Layout' },
  calculated: { label: 'Calculated', kind: 'number', input: false, group: 'Number & date' },
};
/** Operators that make sense for each kind of answer. */
export const OPS_FOR: Record<Kind, Op[]> = {
  text: ['equals', 'not_equals', 'contains', 'empty', 'not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  date: ['equals', 'not_equals', 'date_before', 'date_after', 'empty', 'not_empty'],
  choice: ['equals', 'not_equals', 'empty', 'not_empty'],
  multi: ['includes', 'not_includes', 'empty', 'not_empty'],
  bool: ['equals', 'not_equals', 'empty', 'not_empty'],
  file: ['empty', 'not_empty'],
  none: [],
};
export const OP_LABEL: Record<Op, string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', includes: 'includes', not_includes: 'does not include', gt: 'is greater than', gte: 'is at least',
  lt: 'is less than', lte: 'is at most', empty: 'is empty', not_empty: 'is answered', date_before: 'is before', date_after: 'is after',
};
export const FILE_TYPES: Record<string, { label: string; mimes: string[]; ext: string[] }> = {
  pdf: { label: 'PDF', mimes: ['application/pdf'], ext: ['pdf'] },
  image: { label: 'Images (JPEG, PNG, WebP)', mimes: ['image/jpeg', 'image/png', 'image/webp'], ext: ['jpg', 'jpeg', 'png', 'webp'] },
  doc: { label: 'Word (DOCX)', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ext: ['docx'] },
  sheet: { label: 'Excel (XLSX)', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ext: ['xlsx'] },
};
export const LIMITS = { pages: 30, fields: 200, rules: 200, options: 100, actions: 20, condDepth: 4, condItems: 20, exprDepth: 6, textMax: 20000, maxMb: 25, maxFiles: 10 };
export const ID = /^[a-z][a-z0-9_]{0,39}$/;

export const allFields = (def: FormDef) => def.pages.flatMap((p) => p.fields);
export const kindOf = (t: FieldType) => FIELD_TYPES[t]?.kind ?? 'none';
export const t = (l: Lang | undefined, lang: 'en' | 'fr' | 'ar' = 'en') => (l ? (l[lang] || l.en || '') : '');

// ---------------------------------------------------------------- Values
const isEmpty = (v: Answer | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
/** Numbers are rounded to 9 decimals after each step, so 0.1 + 0.2 is 0.3 and totals never show floating noise. */
const tidy = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : NaN);
const num = (v: Answer | undefined): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

export function evalExpr(e: Expr, get: (id: string) => Answer | undefined, depth = 0): number | null {
  if (depth > LIMITS.exprDepth + 2) return null;
  if (typeof e === 'number') return Number.isFinite(e) ? e : null;
  if ('field' in e && !('op' in e)) return num(get(e.field));
  switch (e.op) {
    case 'sum': case 'sub': case 'mul': case 'min': case 'max': case 'div': {
      const xs = e.args.map((a) => evalExpr(a, get, depth + 1));
      if (e.op === 'sum') return tidy(xs.reduce<number>((s, x) => s + (x ?? 0), 0));     // empty answers count as 0 in a total
      if (xs.some((x) => x === null) || !xs.length) return null;
      const ns = xs as number[];
      if (e.op === 'sub') return tidy(ns.slice(1).reduce((s, x) => s - x, ns[0]));
      if (e.op === 'mul') return tidy(ns.reduce((s, x) => s * x, 1));
      if (e.op === 'min') return Math.min(...ns);
      if (e.op === 'max') return Math.max(...ns);
      return ns.slice(1).some((x) => x === 0) ? null : tidy(ns.slice(1).reduce((s, x) => s / x, ns[0]));
    }
    case 'round': { const x = evalExpr(e.arg, get, depth + 1); const d = Math.max(0, Math.min(6, e.decimals ?? 0)); return x === null ? null : Math.round(x * 10 ** d) / 10 ** d; }
    case 'count': { const v = get(e.field); return Array.isArray(v) ? v.length : isEmpty(v) ? 0 : 1; }
    case 'if': return evalCond(e.cond, get) ? evalExpr(e.then, get, depth + 1) : evalExpr(e.else, get, depth + 1);
  }
  return null;
}

export function evalCond(c: Cond, get: (id: string) => Answer | undefined): boolean {
  if ('all' in c) return c.all.every((x) => evalCond(x, get));
  if ('any' in c) return c.any.some((x) => evalCond(x, get));
  const v = get(c.field), w = c.value;
  switch (c.op) {
    case 'empty': return isEmpty(v);
    case 'not_empty': return !isEmpty(v);
    case 'equals': case 'not_equals': {
      let same: boolean;
      if (typeof w === 'boolean' || typeof v === 'boolean') same = v === w || String(v) === String(w);
      else if (num(v) !== null && num(w as Answer) !== null) same = num(v) === num(w as Answer);
      else same = typeof v === 'string' && String(w ?? '').trim().toLowerCase() === v.trim().toLowerCase();
      return c.op === 'equals' ? !isEmpty(v) && same : isEmpty(v) || !same;
    }
    case 'contains': return typeof v === 'string' && String(w ?? '') !== '' && v.toLowerCase().includes(String(w).toLowerCase());
    case 'includes': return Array.isArray(v) && (v as unknown[]).includes(String(w));
    case 'not_includes': return !Array.isArray(v) || !(v as unknown[]).includes(String(w));
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = num(v), b = num(w as Answer);
      if (a === null || b === null) return false;
      return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
    }
    case 'date_before': case 'date_after': {
      if (typeof v !== 'string' || !DATE.test(v) || typeof w !== 'string' || !DATE.test(w)) return false;
      return c.op === 'date_before' ? v < w : v > w;
    }
  }
  return false;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALWAYS = (c: Cond) => 'all' in c && c.all.length === 0;

// ---------------------------------------------------------------- Evaluate
export type Evaluation = {
  path: string[];                         // pages the applicant goes through, in order
  visibleFields: Set<string>;             // shown and on the path
  required: Set<string>;
  values: Answers;                        // answers of visible fields + calculated values
  messages: { page: string | null; tone: 'info' | 'warning'; text: Lang }[];
  eligibility: { result: 'eligible' | 'ineligible' | 'needs_review' | 'not_assessed'; reasons: Lang[]; rules: string[] };
  next: (pageId: string) => string | null; // the page after this one (or null = review/submit)
};

/** Applies the rules to the answers. Deterministic: the same form and answers give the same result in the browser and on
 *  the server. Hidden fields count as unanswered for every rule and calculation. */
export function evaluate(def: FormDef, answers: Answers): Evaluation {
  const fields = allFields(def);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const pageOf = new Map(def.pages.flatMap((p) => p.fields.map((f) => [f.id, p.id] as const)));
  const shownBy = new Set<string>();                    // targets that start hidden because a rule can show them
  for (const r of def.rules) for (const a of r.then) if (a.type === 'show') shownBy.add(`${a.target.kind}:${a.target.id}`);

  let hidden = new Set<string>(), values: Answers = {};
  const computeValues = () => {
    const out: Answers = {};
    for (const f of fields) if (FIELD_TYPES[f.type]?.input && !hidden.has(`field:${f.id}`) && !hidden.has(`page:${pageOf.get(f.id)}`)) {
      const v = answers[f.id];
      if (!isEmpty(v)) out[f.id] = v as Answer;
    }
    // calculated fields: resolve in dependency order (analyze() refuses cycles; the pass limit keeps a bad form finite)
    const calcs = fields.filter((f) => f.type === 'calculated' && f.config?.expr !== undefined);
    for (let pass = 0; pass <= calcs.length; pass++) {
      let changed = false;
      for (const f of calcs) {
        if (hidden.has(`field:${f.id}`)) { if (f.id in out) { delete out[f.id]; changed = true; } continue; }
        const v = evalExpr(f.config!.expr!, (id) => out[id]);
        const r = v === null ? null : Math.round(v * 10 ** (f.config?.decimals ?? 2)) / 10 ** (f.config?.decimals ?? 2);
        if (r !== (out[f.id] ?? null)) { if (r === null) delete out[f.id]; else out[f.id] = r; changed = true; }
      }
      if (!changed) break;
    }
    return out;
  };
  // visibility to a fixed point (analyze() refuses rule cycles; the limit keeps a bad form finite)
  for (let pass = 0; pass <= def.rules.length + 1; pass++) {
    values = computeValues();
    const get = (id: string) => values[id];
    const next = new Set<string>([...shownBy]);
    for (const r of def.rules) {
      if (!evalCond(r.when, get)) continue;
      for (const a of r.then) {
        if (a.type === 'show') next.delete(`${a.target.kind}:${a.target.id}`);
      }
    }
    for (const r of def.rules) {
      if (!evalCond(r.when, get)) continue;
      for (const a of r.then) if (a.type === 'hide') next.add(`${a.target.kind}:${a.target.id}`);
    }
    const same = next.size === hidden.size && [...next].every((x) => hidden.has(x));
    hidden = next;
    if (same) break;
  }
  values = computeValues();
  const get = (id: string) => values[id];

  // navigation: from each page, the first rule whose skip applies, else the next page that is not hidden
  const skips = new Map<string, string>();
  for (const r of def.rules) if (evalCond(r.when, get)) for (const a of r.then) if (a.type === 'skip_to' && !skips.has(a.from)) skips.set(a.from, a.to);
  const idx = new Map(def.pages.map((p, i) => [p.id, i]));
  const nextOf = (pid: string): string | null => {
    const s = skips.get(pid);
    let i = s !== undefined && idx.has(s) && idx.get(s)! > idx.get(pid)! ? idx.get(s)! : idx.get(pid)! + 1;
    while (i < def.pages.length && hidden.has(`page:${def.pages[i].id}`)) i++;
    return i < def.pages.length ? def.pages[i].id : null;
  };
  const path: string[] = [];
  let cur: string | null = def.pages.find((p) => !hidden.has(`page:${p.id}`))?.id ?? null;
  while (cur && !path.includes(cur) && path.length <= def.pages.length) { path.push(cur); cur = nextOf(cur); }
  const onPath = new Set(path);

  const visibleFields = new Set(fields.filter((f) => onPath.has(pageOf.get(f.id)!) && !hidden.has(`field:${f.id}`)).map((f) => f.id));
  // answers of fields the applicant does not see (off the path or hidden) are not kept and do not count
  for (const id of Object.keys(values)) if (!visibleFields.has(id)) delete values[id];
  const required = new Set(fields.filter((f) => f.required && FIELD_TYPES[f.type]?.input).map((f) => f.id));
  const messages: Evaluation['messages'] = [];
  const elig: Evaluation['eligibility'] = { result: 'not_assessed', reasons: [], rules: [] };
  const rank = { not_assessed: 0, eligible: 1, needs_review: 2, ineligible: 3 } as const;
  for (const r of def.rules) {
    if (!evalCond(r.when, (id) => values[id])) continue;
    for (const a of r.then) {
      if (a.type === 'require') required.add(a.field);
      else if (a.type === 'optional' && !def.rules.some((o) => o !== r && o.then.some((x) => x.type === 'require' && x.field === a.field) && evalCond(o.when, (id) => values[id]))) required.delete(a.field);
      else if (a.type === 'message') messages.push({ page: a.page ?? null, tone: a.tone ?? 'info', text: a.message });
      else if (a.type === 'eligibility') {
        if (rank[a.result] > rank[elig.result]) elig.result = a.result;
        elig.reasons.push(a.reason); elig.rules.push(r.id);
      }
    }
  }
  for (const id of [...required]) if (!visibleFields.has(id) || !byId.has(id)) required.delete(id);
  return { path, visibleFields, required, values, messages, eligibility: elig, next: nextOf };
}

// ---------------------------------------------------------------- Validate answers
export type FieldError = { field: string; page: string; message: Lang };
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const PHONE = /^\+?[0-9][0-9 ().-]{5,24}$/;
const URL_RE = /^https?:\/\/[^\s"'<>]+\.[^\s"'<>]+$/i;
const L = (en: string, fr: string, ar: string): Lang => ({ en, fr, ar });

/** Checks one visible field's answer. Returns null when it is fine. */
export function checkAnswer(f: Field, v: Answer | undefined, required: boolean): Lang | null {
  const c = f.config ?? {};
  if (isEmpty(v)) return required ? (f.type === 'consent' ? L('Please give your consent to continue.', 'Veuillez donner votre accord pour continuer.', 'يرجى إعطاء موافقتك للمتابعة.') : L('This question is required.', 'Cette question est obligatoire.', 'هذا السؤال إلزامي.')) : null;
  switch (f.type) {
    case 'short_text': case 'long_text': case 'email': case 'phone': case 'url': {
      if (typeof v !== 'string') return L('Enter text.', 'Saisissez du texte.', 'أدخل نصًا.');
      const n = [...v.trim()].length, max = Math.min(c.maxLength ?? (f.type === 'long_text' ? 5000 : 300), LIMITS.textMax);
      if (c.minLength && n < c.minLength) return L(`Write at least ${c.minLength} characters.`, `Écrivez au moins ${c.minLength} caractères.`, `اكتب ${c.minLength} حرفًا على الأقل.`);
      if (n > max) return L(`Use at most ${max} characters.`, `Utilisez au plus ${max} caractères.`, `استخدم ${max} حرفًا على الأكثر.`);
      if (f.type === 'email' && !EMAIL.test(v.trim())) return L('Enter a valid email address.', 'Saisissez une adresse e-mail valide.', 'أدخل بريدًا إلكترونيًا صالحًا.');
      if (f.type === 'phone' && !PHONE.test(v.trim())) return L('Enter a valid phone number.', 'Saisissez un numéro valide.', 'أدخل رقم هاتف صالحًا.');
      if (f.type === 'url' && !URL_RE.test(v.trim())) return L('Enter a full web address (https://…).', 'Saisissez une adresse complète (https://…).', 'أدخل عنوانًا كاملًا (https://…).');
      return null;
    }
    case 'number': {
      const n = num(v);
      if (n === null) return L('Enter a number.', 'Saisissez un nombre.', 'أدخل رقمًا.');
      if (c.min !== undefined && n < c.min) return L(`Enter ${c.min} or more.`, `Saisissez ${c.min} ou plus.`, `أدخل ${c.min} أو أكثر.`);
      if (c.max !== undefined && n > c.max) return L(`Enter ${c.max} or less.`, `Saisissez ${c.max} ou moins.`, `أدخل ${c.max} أو أقل.`);
      if (c.step === 1 && !Number.isInteger(n)) return L('Enter a whole number.', 'Saisissez un nombre entier.', 'أدخل عددًا صحيحًا.');
      return null;
    }
    case 'date': {
      if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) return L('Enter a valid date.', 'Saisissez une date valide.', 'أدخل تاريخًا صالحًا.');
      if (c.minDate && v < c.minDate) return L(`Choose a date on or after ${c.minDate}.`, `Choisissez une date à partir du ${c.minDate}.`, `اختر تاريخًا في ${c.minDate} أو بعده.`);
      if (c.maxDate && v > c.maxDate) return L(`Choose a date on or before ${c.maxDate}.`, `Choisissez une date jusqu’au ${c.maxDate}.`, `اختر تاريخًا في ${c.maxDate} أو قبله.`);
      return null;
    }
    case 'single_choice': {
      if (typeof v !== 'string' || !(c.options ?? []).some((o) => o.value === v)) return L('Choose one of the options.', 'Choisissez une des options.', 'اختر أحد الخيارات.');
      return null;
    }
    case 'multi_choice': {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !(c.options ?? []).some((o) => o.value === x)) || new Set(v as string[]).size !== v.length) return L('Choose from the options.', 'Choisissez parmi les options.', 'اختر من الخيارات.');
      if (c.minSelected && v.length < c.minSelected) return L(`Choose at least ${c.minSelected}.`, `Choisissez-en au moins ${c.minSelected}.`, `اختر ${c.minSelected} على الأقل.`);
      if (c.maxSelected && v.length > c.maxSelected) return L(`Choose at most ${c.maxSelected}.`, `Choisissez-en au plus ${c.maxSelected}.`, `اختر ${c.maxSelected} على الأكثر.`);
      return null;
    }
    case 'yes_no': return typeof v === 'boolean' ? null : L('Answer yes or no.', 'Répondez oui ou non.', 'أجب بنعم أو لا.');
    case 'consent': return v === true ? null : required ? L('Please give your consent to continue.', 'Veuillez donner votre accord pour continuer.', 'يرجى إعطاء موافقتك للمتابعة.') : null;
    case 'file': {
      if (!Array.isArray(v) || v.some((x) => !x || typeof x !== 'object' || typeof (x as FileRef).id !== 'string')) return L('Upload the file again.', 'Téléversez le fichier à nouveau.', 'ارفع الملف مرة أخرى.');
      const files = v as FileRef[], max = c.maxFiles ?? 1;
      if (files.length > max) return L(`Upload at most ${max} file${max === 1 ? '' : 's'}.`, `Téléversez au plus ${max} fichier(s).`, `ارفع ${max} ملف(ات) على الأكثر.`);
      const mimes = (c.accept?.length ? c.accept : ['pdf']).flatMap((k) => FILE_TYPES[k]?.mimes ?? []);
      if (files.some((x) => !mimes.includes(x.mime))) return L('This file type is not accepted here.', 'Ce type de fichier n’est pas accepté ici.', 'نوع الملف هذا غير مقبول هنا.');
      if (files.some((x) => x.bytes > (c.maxMb ?? 10) * 1048576)) return L(`Each file must be ${c.maxMb ?? 10} MB or less.`, `Chaque fichier doit faire ${c.maxMb ?? 10} Mo au plus.`, `يجب ألا يتجاوز كل ملف ${c.maxMb ?? 10} ميغابايت.`);
      return null;
    }
  }
  return null;
}

/** What the server keeps: answers of visible input fields, recomputed calculations, and the errors that block submitting.
 *  `pages` limits the check to some pages (saving a page of a draft); omitted = the whole path (final submission). */
export function validate(def: FormDef, answers: Answers, pages?: string[]) {
  const ev = evaluate(def, answers);
  const pageOf = new Map(def.pages.flatMap((p) => p.fields.map((f) => [f.id, p.id] as const)));
  const scope = new Set(pages ?? ev.path);
  const errors: FieldError[] = [];
  for (const f of allFields(def)) {
    if (!ev.visibleFields.has(f.id) || !FIELD_TYPES[f.type]?.input || !scope.has(pageOf.get(f.id)!)) continue;
    const m = checkAnswer(f, answers[f.id], ev.required.has(f.id));
    if (m) errors.push({ field: f.id, page: pageOf.get(f.id)!, message: m });
  }
  const clean: Answers = {};
  for (const [k, v] of Object.entries(ev.values)) if (!errors.some((e) => e.field === k)) clean[k] = v;
  return { ok: errors.length === 0, errors, answers: clean, evaluation: ev };
}

// ---------------------------------------------------------------- Static analysis (before publishing)
export type Issue = { level: 'error' | 'warning'; code: string; message: string; ref?: { kind: 'page' | 'field' | 'rule'; id: string } };

function condFields(c: Cond, out: string[] = [], depth = 0): string[] {
  if (depth > 20) return out;
  if ('all' in c) c.all.forEach((x) => condFields(x, out, depth + 1));
  else if ('any' in c) c.any.forEach((x) => condFields(x, out, depth + 1));
  else out.push(c.field);
  return out;
}
function exprFields(e: Expr, out: string[] = [], depth = 0): string[] {
  if (depth > 20 || typeof e === 'number') return out;
  if ('field' in e && !('op' in e)) out.push(e.field);
  else if ('op' in e) {
    if (e.op === 'round') exprFields(e.arg, out, depth + 1);
    else if (e.op === 'count') out.push(e.field);
    else if (e.op === 'if') { condFields(e.cond, out); exprFields(e.then, out, depth + 1); exprFields(e.else, out, depth + 1); }
    else e.args.forEach((a) => exprFields(a, out, depth + 1));
  }
  return out;
}
function depth(c: Cond): number { return 'all' in c ? 1 + Math.max(0, ...c.all.map(depth)) : 'any' in c ? 1 + Math.max(0, ...c.any.map(depth)) : 0; }
function exprDepth(e: Expr): number {
  if (typeof e === 'number' || ('field' in e && !('op' in e))) return 0;
  if (e.op === 'round') return 1 + exprDepth(e.arg);
  if (e.op === 'count') return 1;
  if (e.op === 'if') return 1 + Math.max(exprDepth(e.then), exprDepth(e.else));
  return 1 + Math.max(0, ...e.args.map(exprDepth));
}
/** A cycle in a directed graph, as a list of nodes, or null. */
function findCycle(edges: Map<string, Set<string>>): string[] | null {
  const state = new Map<string, 1 | 2>(), stack: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1); stack.push(n);
    for (const m of edges.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) { const c = visit(m); if (c) return c; }
    }
    stack.pop(); state.set(n, 2); return null;
  };
  for (const n of edges.keys()) if (!state.has(n)) { const c = visit(n); if (c) return c; }
  return null;
}

export function analyze(def: FormDef): Issue[] {
  const out: Issue[] = [];
  const err = (code: string, message: string, ref?: Issue['ref']) => out.push({ level: 'error', code, message, ref });
  const warn = (code: string, message: string, ref?: Issue['ref']) => out.push({ level: 'warning', code, message, ref });
  const fields = allFields(def);
  const byId = new Map<string, Field>();
  const pageOf = new Map<string, string>();
  const pIdx = new Map(def.pages.map((p, i) => [p.id, i]));
  const name = (id: string) => { const f = byId.get(id); return f ? `“${t(f.label) || id}”` : `“${id}”`; };

  if (!def.pages.length) err('no_pages', 'Add at least one page.');
  if (new Set(def.pages.map((p) => p.id)).size !== def.pages.length) err('dup_page', 'Two pages have the same ID.');
  for (const p of def.pages) {
    if (!ID.test(p.id)) err('bad_id', `Page ID “${p.id}” must start with a letter and use a–z, 0–9 and _.`, { kind: 'page', id: p.id });
    if (!t(p.title).trim()) err('page_title', 'Every page needs a title.', { kind: 'page', id: p.id });
    if (!p.fields.length) warn('empty_page', `Page “${t(p.title) || p.id}” has no questions.`, { kind: 'page', id: p.id });
    for (const f of p.fields) {
      if (byId.has(f.id)) err('dup_field', `Two questions use the ID “${f.id}”.`, { kind: 'field', id: f.id });
      byId.set(f.id, f); pageOf.set(f.id, p.id);
    }
  }
  if (!fields.some((f) => FIELD_TYPES[f.type]?.input)) err('no_inputs', 'The form has no questions to answer.');
  if (!fields.some((f) => f.type === 'consent' && f.required)) warn('no_consent', 'Add a required consent question that links to the privacy notice.');
  if (!fields.some((f) => f.type === 'email')) warn('no_email', 'Add an email question so the team can reply and send the confirmation.');

  for (const f of fields) {
    const ref = { kind: 'field' as const, id: f.id };
    if (!FIELD_TYPES[f.type]) { err('bad_type', `Unknown question type “${f.type}”.`, ref); continue; }
    if (!ID.test(f.id)) err('bad_id', `Question ID “${f.id}” must start with a letter and use a–z, 0–9 and _.`, ref);
    if (f.type !== 'statement' && !t(f.label).trim()) err('no_label', 'Every question needs a label.', ref);
    const c = f.config ?? {};
    if (f.type === 'single_choice' || f.type === 'multi_choice') {
      const opts = c.options ?? [];
      if (!opts.length) err('no_options', `${name(f.id)} has no options.`, ref);
      if (new Set(opts.map((o) => o.value)).size !== opts.length) err('dup_option', `${name(f.id)} has two options with the same value.`, ref);
      if (opts.some((o) => !t(o.label).trim())) err('option_label', `An option of ${name(f.id)} has no label.`, ref);
      if (c.maxSelected && c.minSelected && c.minSelected > c.maxSelected) err('range', `${name(f.id)}: the minimum is above the maximum.`, ref);
    }
    if (c.minLength !== undefined && c.maxLength !== undefined && c.minLength > c.maxLength) err('range', `${name(f.id)}: the minimum length is above the maximum.`, ref);
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) err('range', `${name(f.id)}: the minimum is above the maximum.`, ref);
    if (c.minDate && c.maxDate && c.minDate > c.maxDate) err('range', `${name(f.id)}: the earliest date is after the latest.`, ref);
    if (f.type === 'calculated') {
      if (c.expr === undefined) err('no_expr', `${name(f.id)} has no calculation.`, ref);
      else {
        if (exprDepth(c.expr) > LIMITS.exprDepth) err('deep', `${name(f.id)}: the calculation is nested too deeply.`, ref);
        for (const id of exprFields(c.expr)) {
          const g = byId.get(id);
          if (!g) err('missing_ref', `${name(f.id)} uses a question that no longer exists (“${id}”).`, ref);
          else if (kindOf(g.type) !== 'number' && kindOf(g.type) !== 'multi' && g.type !== 'calculated') err('bad_ref', `${name(f.id)} adds up ${name(id)}, which is not a number.`, ref);
        }
      }
    }
  }
  // calculation cycles
  const calcEdges = new Map<string, Set<string>>();
  for (const f of fields) if (f.type === 'calculated' && f.config?.expr !== undefined) calcEdges.set(f.id, new Set(exprFields(f.config.expr).filter((x) => byId.get(x)?.type === 'calculated')));
  const cc = findCycle(calcEdges);
  if (cc) err('calc_cycle', `Calculations depend on each other in a loop: ${cc.map(name).join(' → ')}.`, { kind: 'field', id: cc[0] });

  // rules
  const ruleIds = new Set<string>();
  const shows = new Map<string, string[]>(), hides = new Map<string, string[]>(), req = new Map<string, string[]>(), opt = new Map<string, string[]>();
  const visEdges = new Map<string, Set<string>>();       // field X's visibility depends on field Y: X → Y
  const alwaysSkip = new Map<string, string[]>();
  const skipEdges: [string, string][] = [];
  for (const r of def.rules) {
    const ref = { kind: 'rule' as const, id: r.id };
    if (ruleIds.has(r.id)) err('dup_rule', `Two rules have the ID “${r.id}”.`, ref);
    ruleIds.add(r.id);
    if (depth(r.when) > LIMITS.condDepth) err('deep', `Rule “${r.name || r.id}”: conditions are nested too deeply.`, ref);
    if (!r.then.length) warn('no_action', `Rule “${r.name || r.id}” does nothing.`, ref);
    const deps = condFields(r.when);
    const checkCond = (c: Cond) => {
      if ('all' in c) return c.all.forEach(checkCond);
      if ('any' in c) return c.any.forEach(checkCond);
      const g = byId.get(c.field);
      if (!g) return err('missing_ref', `Rule “${r.name || r.id}” checks a question that no longer exists (“${c.field}”).`, ref);
      const k = kindOf(g.type);
      if (k === 'none') return err('bad_ref', `Rule “${r.name || r.id}” checks ${name(c.field)}, which has no answer.`, ref);
      if (!OPS_FOR[k].includes(c.op)) return err('bad_op', `Rule “${r.name || r.id}”: “${OP_LABEL[c.op] ?? c.op}” does not apply to ${name(c.field)}.`, ref);
      if (!['empty', 'not_empty'].includes(c.op) && (c.value === undefined || c.value === '')) return err('no_value', `Rule “${r.name || r.id}”: choose the value to compare ${name(c.field)} with.`, ref);
      if ((k === 'choice' || k === 'multi') && c.value !== undefined && !['empty', 'not_empty'].includes(c.op) && !(g.config?.options ?? []).some((o) => o.value === String(c.value)))
        err('bad_value', `Rule “${r.name || r.id}”: ${name(c.field)} has no option “${c.value}”.`, ref);
      if (k === 'number' && ['gt', 'gte', 'lt', 'lte', 'equals', 'not_equals'].includes(c.op) && num(c.value as Answer) === null) err('bad_value', `Rule “${r.name || r.id}”: compare ${name(c.field)} with a number.`, ref);
      if (k === 'date' && ['date_before', 'date_after', 'equals', 'not_equals'].includes(c.op) && !DATE.test(String(c.value))) err('bad_value', `Rule “${r.name || r.id}”: compare ${name(c.field)} with a date (YYYY-MM-DD).`, ref);
    };
    checkCond(r.when);
    const add = (m: Map<string, string[]>, k: string) => m.set(k, [...(m.get(k) ?? []), r.id]);
    for (const a of r.then) {
      if (a.type === 'show' || a.type === 'hide') {
        const ok = a.target.kind === 'field' ? byId.has(a.target.id) : pIdx.has(a.target.id);
        if (!ok) { err('missing_target', `Rule “${r.name || r.id}” ${a.type}s a ${a.target.kind} that no longer exists (“${a.target.id}”).`, ref); continue; }
        add(a.type === 'show' ? shows : hides, `${a.target.kind}:${a.target.id}`);
        const targets = a.target.kind === 'field' ? [a.target.id] : (def.pages[pIdx.get(a.target.id)!]?.fields ?? []).map((f) => f.id);
        for (const x of targets) { const s = visEdges.get(x) ?? new Set(); deps.forEach((d) => s.add(d)); visEdges.set(x, s); }
        if (a.target.kind === 'field') {
          const later = deps.filter((d) => pageOf.has(d) && pIdx.get(pageOf.get(d)!)! > pIdx.get(pageOf.get(a.target.id)!)!);
          if (later.length) warn('later_ref', `Rule “${r.name || r.id}” uses ${later.map(name).join(', ')}, which comes after ${name(a.target.id)}: applicants have not answered it yet.`, ref);
        } else if (deps.some((d) => pageOf.get(d) && pIdx.get(pageOf.get(d)!)! >= pIdx.get(a.target.id)!)) warn('later_ref', `Rule “${r.name || r.id}” decides whether a page is shown using answers from that page or later.`, ref);
        if (ALWAYS(r.when) && a.type === 'hide') warn('never_shown', `Rule “${r.name || r.id}” always hides its target, so applicants never see it.`, ref);
      } else if (a.type === 'require' || a.type === 'optional') {
        const g = byId.get(a.field);
        if (!g) err('missing_target', `Rule “${r.name || r.id}” changes a question that no longer exists (“${a.field}”).`, ref);
        else if (!FIELD_TYPES[g.type].input) err('bad_target', `Rule “${r.name || r.id}”: ${name(a.field)} cannot be required.`, ref);
        add(a.type === 'require' ? req : opt, a.field);
      } else if (a.type === 'skip_to') {
        if (!pIdx.has(a.from) || !pIdx.has(a.to)) { err('missing_target', `Rule “${r.name || r.id}” skips between pages that no longer exist.`, ref); continue; }
        if (pIdx.get(a.to)! <= pIdx.get(a.from)!) err('skip_back', `Rule “${r.name || r.id}” skips backwards or to the same page; skips may only go forward.`, ref);
        if (deps.some((d) => pageOf.get(d) && pIdx.get(pageOf.get(d)!)! > pIdx.get(a.from)!)) warn('later_ref', `Rule “${r.name || r.id}” decides where to go after a page using answers from later pages.`, ref);
        skipEdges.push([a.from, a.to]);
        if (ALWAYS(r.when)) alwaysSkip.set(a.from, [...(alwaysSkip.get(a.from) ?? []), a.to]);
      } else if (a.type === 'message') {
        if (!t(a.message).trim()) err('no_message', `Rule “${r.name || r.id}” shows an empty message.`, ref);
        if (a.page && !pIdx.has(a.page)) err('missing_target', `Rule “${r.name || r.id}” shows a message on a page that no longer exists.`, ref);
      } else if (a.type === 'eligibility') {
        if (!t(a.reason).trim()) err('no_reason', `Rule “${r.name || r.id}”: say why (the reason is stored with the result).`, ref);
      } else err('bad_action', `Rule “${r.name || r.id}” has an unknown action.`, ref);
    }
  }
  for (const [k, ids] of shows) if (hides.has(k)) warn('conflict', `${k.startsWith('page:') ? 'A page' : name(k.slice(6))} is both shown and hidden by rules (${[...ids, ...hides.get(k)!].join(', ')}). When both apply, it is hidden.`, { kind: 'rule', id: ids[0] });
  for (const [k, ids] of req) if (opt.has(k)) warn('conflict', `${name(k)} is made both required and optional by rules (${[...ids, ...opt.get(k)!].join(', ')}). When both apply, it is required.`, { kind: 'rule', id: ids[0] });
  for (const [from, tos] of alwaysSkip) if (new Set(tos).size > 1) err('conflict', `Page “${from}” always skips to two different pages.`, { kind: 'page', id: from });
  const vc = findCycle(visEdges);
  if (vc) err('rule_cycle', `Rules depend on each other in a loop: ${vc.map(name).join(' → ')}.`, { kind: 'field', id: vc[0] });

  // reachability: from the first page, follow "next page" and every skip; an always-true skip replaces "next page"
  const reach = new Set<string>(), queue = def.pages.length ? [def.pages[0].id] : [];
  while (queue.length) {
    const p = queue.shift()!;
    if (reach.has(p)) continue;
    reach.add(p);
    const i = pIdx.get(p)!, always = alwaysSkip.get(p);
    if (always?.length) { for (const to of always) if (pIdx.get(to)! > i) queue.push(to); continue; }
    if (i + 1 < def.pages.length) queue.push(def.pages[i + 1].id);
    for (const [from, to] of skipEdges) if (from === p && pIdx.get(to)! > i) queue.push(to);
  }
  for (const p of def.pages) if (!reach.has(p.id)) err('unreachable', `Page “${t(p.title) || p.id}” can never be reached: a skip always jumps over it.`, { kind: 'page', id: p.id });
  return out;
}

/** Answers already received would no longer fit if `next` replaced `prev`: removed questions, changed types, removed options. */
export function breakingChanges(prev: FormDef, next: FormDef): string[] {
  const out: string[] = [];
  const nf = new Map(allFields(next).map((f) => [f.id, f]));
  for (const f of allFields(prev)) {
    if (!FIELD_TYPES[f.type]?.input) continue;
    const g = nf.get(f.id);
    if (!g) { out.push(`“${t(f.label) || f.id}” was removed.`); continue; }
    if (g.type !== f.type) out.push(`“${t(f.label) || f.id}” changed from ${FIELD_TYPES[f.type].label} to ${FIELD_TYPES[g.type]?.label ?? g.type}.`);
    if (f.config?.options && g.config?.options) for (const o of f.config.options) if (!g.config.options.some((x) => x.value === o.value)) out.push(`Option “${t(o.label) || o.value}” of “${t(f.label) || f.id}” was removed.`);
  }
  return out;
}

/** A new, empty form. */
export const emptyForm = (): FormDef => ({
  schema: 1,
  pages: [{ id: 'about_you', title: { en: 'About you' }, fields: [
    { id: 'full_name', type: 'short_text', label: { en: 'Full name', fr: 'Nom complet', ar: 'الاسم الكامل' }, required: true, config: { maxLength: 120 } },
    { id: 'email', type: 'email', label: { en: 'Email', fr: 'E-mail', ar: 'البريد الإلكتروني' }, required: true },
  ] }],
  rules: [],
  settings: { languages: ['en'], reviewStep: true, confirmation: { en: 'Thank you. Your application was received.' } },
});
