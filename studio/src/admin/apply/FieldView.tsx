// One question as applicants will see it. Used by the builder canvas (edit and test modes); the public form (phase 3)
// renders the same structure in plain HTML. Texts are React text nodes, so nothing an editor types is ever run as HTML.
import type { Answer, Field, FileRef, Lang } from '../../server/modules/apply/engine.ts';
import { FILE_TYPES, t } from '../../server/modules/apply/engine.ts';

export type Lng = 'en' | 'fr' | 'ar';
const YES: Record<Lng, [string, string]> = { en: ['Yes', 'No'], fr: ['Oui', 'Non'], ar: ['نعم', 'لا'] };
const SELECT: Record<Lng, string> = { en: 'Choose…', fr: 'Choisir…', ar: 'اختر…' };
const OPTIONAL: Record<Lng, string> = { en: 'optional', fr: 'facultatif', ar: 'اختياري' };

export function FieldView({ f, value, set, lang, error, required, value2, onLabel, selected }: {
  f: Field; value: Answer | undefined; set?: (v: Answer) => void; lang: Lng; error?: Lang | null; required: boolean;
  value2?: string | number | null;               // calculated value to show
  onLabel?: (v: string) => void;                 // inline editing of the label (builder, selected question)
  selected?: boolean;
}) {
  const c = f.config ?? {}, a = f.appearance ?? {};
  const id = `fv-${f.id}`, ro = !set;
  const ph = t(a.placeholder, lang);
  const label = onLabel && selected
    ? <input className="fv-label-edit" value={f.label[lang] ?? ''} placeholder={lang === 'en' ? 'Question' : t(f.label, 'en')} onChange={(e) => onLabel(e.target.value)} aria-label="Question label" onClick={(e) => e.stopPropagation()} />
    : <span>{t(f.label, lang) || <i className="fv-empty">Untitled question</i>}</span>;
  const head = f.type === 'statement' ? null : <label className="fv-label" htmlFor={id} id={`${id}-l`}>{label}{required ? <b className="fv-req" aria-hidden="true"> *</b> : f.type !== 'calculated' && <small className="fv-opt"> ({OPTIONAL[lang]})</small>}</label>;
  const help = f.help && t(f.help, lang) ? <p className="fv-help" id={`${id}-help`}>{t(f.help, lang)}</p> : null;
  const err = error ? <p className="fv-err" id={`${id}-err`} role="alert">{t(error, lang)}</p> : null;
  const desc = [help ? `${id}-help` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, disabled: ro, 'aria-describedby': desc, 'aria-invalid': !!error || undefined, 'aria-required': required || undefined };
  let control: React.ReactNode = null;
  switch (f.type) {
    case 'short_text': case 'email': case 'phone': case 'url':
      control = <input className="input" {...common} type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : 'text'} maxLength={c.maxLength} placeholder={ph}
        value={typeof value === 'string' ? value : ''} onChange={(e) => set?.(e.target.value)} autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'off'} />; break;
    case 'long_text':
      control = <textarea className="textarea" {...common} rows={a.rows ?? 4} maxLength={c.maxLength} placeholder={ph} value={typeof value === 'string' ? value : ''} onChange={(e) => set?.(e.target.value)} />; break;
    case 'number':
      control = <input className="input fv-num" {...common} type="number" inputMode="decimal" min={c.min} max={c.max} step={c.step ?? 'any'} placeholder={ph}
        value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={(e) => set?.(e.target.value === '' ? null : Number(e.target.value))} />; break;
    case 'date':
      control = <input className="input fv-date" {...common} type="date" min={c.minDate} max={c.maxDate} value={typeof value === 'string' ? value : ''} onChange={(e) => set?.(e.target.value || null)} />; break;
    case 'single_choice': {
      const opts = c.options ?? [];
      if (a.display === 'dropdown') control = <select className="select" {...common} value={typeof value === 'string' ? value : ''} onChange={(e) => set?.(e.target.value || null)}>
        <option value="">{SELECT[lang]}</option>{opts.map((o) => <option key={o.value} value={o.value}>{t(o.label, lang)}</option>)}</select>;
      else control = <div className={`fv-choices${a.display === 'buttons' ? ' fv-buttons' : ''}`} role="radiogroup" aria-labelledby={`${id}-l`} aria-describedby={desc}>
        {opts.map((o) => <label key={o.value} className={value === o.value ? 'on' : ''}><input type="radio" name={id} disabled={ro} checked={value === o.value} onChange={() => set?.(o.value)} /><span>{t(o.label, lang)}</span></label>)}</div>;
      break;
    }
    case 'multi_choice': {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      control = <div className="fv-choices" role="group" aria-describedby={desc}>
        {(c.options ?? []).map((o) => <label key={o.value} className={cur.includes(o.value) ? 'on' : ''}><input type="checkbox" disabled={ro} checked={cur.includes(o.value)}
          onChange={(e) => set?.(e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value))} /><span>{t(o.label, lang)}</span></label>)}</div>;
      break;
    }
    case 'yes_no':
      control = <div className="fv-choices fv-buttons" role="radiogroup" aria-describedby={desc}>
        {([true, false] as const).map((b, i) => <label key={String(b)} className={value === b ? 'on' : ''}><input type="radio" name={id} disabled={ro} checked={value === b} onChange={() => set?.(b)} /><span>{YES[lang][i]}</span></label>)}</div>;
      break;
    case 'consent':
      return <div className={`fv fv-consent${selected ? ' sel' : ''}`}>
        <label className="fv-check"><input type="checkbox" id={id} disabled={ro} checked={value === true} onChange={(e) => set?.(e.target.checked)} aria-describedby={desc} aria-required={required || undefined} />
          <span>{label}{required && <b className="fv-req" aria-hidden="true"> *</b>}</span></label>
        {c.text && t(c.text, lang) && <p className="fv-help">{t(c.text, lang)}</p>}{help}{err}</div>;
    case 'file': {
      const files = Array.isArray(value) ? (value as FileRef[]) : [];
      const kinds = (c.accept?.length ? c.accept : ['pdf']).map((k) => FILE_TYPES[k]?.label).join(', ');
      control = <div className="fv-file"><input type="file" {...common} disabled /><small>{kinds} · up to {c.maxMb ?? 10} MB{(c.maxFiles ?? 1) > 1 ? ` · ${c.maxFiles} files` : ''}</small>
        {files.map((x) => <span key={x.id} className="pill">{x.name}</span>)}<small className="fv-note">Uploads work on the public form.</small></div>;
      break;
    }
    case 'statement':
      return <div className={`fv fv-statement${selected ? ' sel' : ''}`}>{t(f.label, lang) && <h3>{onLabel && selected ? label : t(f.label, lang)}</h3>}{c.text && <p>{t(c.text, lang)}</p>}{!t(f.label, lang) && !c.text && <p className="fv-empty">Text block</p>}</div>;
    case 'calculated':
      control = <output className="fv-calc" id={id} aria-live="polite">{value2 === null || value2 === undefined ? '—' : `${Number(value2).toLocaleString(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: c.decimals ?? 2 })}${c.unit ? ` ${c.unit}` : ''}`}</output>;
      break;
  }
  return <div className={`fv fv-${f.type}${(a.width ?? 'full') === 'half' ? ' half' : ''}${selected ? ' sel' : ''}${error ? ' bad' : ''}`}>{head}{help}{control}{err}</div>;
}
