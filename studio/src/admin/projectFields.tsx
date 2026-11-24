// Project editor inputs: the duration as calendar dates, and the category as tags.
// Both still save the same plain text the website shows ("2025 – 2026", "Climate Action, Advocacy").
import { useState } from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export type Duration = { start: string; end: string; ongoing: boolean };   // dates as YYYY-MM-DD

const ym = (d: string) => { const m = /^(\d{4})-(\d{2})/.exec(d); return m ? { y: +m[1], m: +m[2] } : null; };
const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;

/** What the website shows. Whole years read as years ("2025 – 2026"); otherwise month and year ("March 2024 – June 2025"). */
export function formatDuration({ start, end, ongoing }: Duration): string {
  const s = ym(start); if (!s) return '';
  const e = ongoing ? null : ym(end);
  if (ongoing) return `${s.m === 1 ? s.y : `${MONTHS[s.m - 1]} ${s.y}`} – present`;
  if (!e) return `${MONTHS[s.m - 1]} ${s.y}`;
  if (s.m === 1 && e.m === 12) return s.y === e.y ? `${s.y}` : `${s.y} – ${e.y}`;
  if (s.y === e.y) return s.m === e.m ? `${MONTHS[s.m - 1]} ${s.y}` : `${MONTHS[s.m - 1]} – ${MONTHS[e.m - 1]} ${s.y}`;
  return `${MONTHS[s.m - 1]} ${s.y} – ${MONTHS[e.m - 1]} ${e.y}`;
}

const monthOf = (t: string) => { const k = t.trim().slice(0, 3).toLowerCase(); const i = MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === k); return i >= 0 ? i + 1 : 0; };
/** Reads the saved text back into dates ("2025–2026", "January – November 2026", "Mar 2024 – present"); null if it can't. */
export function parseDuration(v: string): Duration | null {
  const t = v.trim().replace(/\s+/g, ' '); if (!t) return { start: '', end: '', ongoing: false };
  const [l, r] = t.split(/\s*(?:–|—|-|\bto\b|\buntil\b)\s*/i);
  const side = (x?: string) => { if (!x) return null; const m = /^(?:([a-z]+)\.?\s*)?((?:19|20)\d{2})?$/i.exec(x.trim()); if (!m || (!m[1] && !m[2])) return null;
    const mo = m[1] ? monthOf(m[1]) : 0; if (m[1] && !mo) return null; return { m: mo, y: m[2] ? +m[2] : 0 }; };
  const a = side(l); if (!a) return null;
  if (r === undefined) { if (!a.y) return null; return a.m ? { start: iso(a.y, a.m), end: '', ongoing: false } : { start: iso(a.y, 1), end: iso(a.y, 12), ongoing: false }; }
  if (/^(present|today|ongoing|now)$/i.test(r.trim())) { if (!a.y) return null; return { start: iso(a.y, a.m || 1), end: '', ongoing: true }; }
  const b = side(r); if (!b || !b.y) return null;
  return { start: iso(a.y || b.y, a.m || 1), end: iso(b.y, b.m || 12), ongoing: false };
}

/** Start and end dates with an "Ongoing" switch; writes the formatted text through onChange. */
export function DurationPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [local, setLocal] = useState<Duration | null>(null);   // keeps the exact days picked while the text stays the same
  const parsed = parseDuration(value);
  const d: Duration = local && formatDuration(local) === value ? local : parsed ?? { start: '', end: '', ongoing: false };
  const put = (next: Duration) => { setLocal(next); onChange(formatDuration(next)); };
  const backwards = !d.ongoing && d.start && d.end && d.end < d.start;
  return <div className="pe-dur">
    <div className="pe-dur-row">
      <label><span>Start</span><input className="input" type="date" value={d.start} disabled={disabled} onChange={(e) => put({ ...d, start: e.target.value })} /></label>
      <span className="pe-dur-sep" aria-hidden="true">→</span>
      <label><span>End</span><input className="input" type="date" value={d.ongoing ? '' : d.end} min={d.start || undefined} disabled={disabled || d.ongoing} onChange={(e) => put({ ...d, end: e.target.value })} /></label>
      <label className="check pe-dur-on"><input type="checkbox" checked={d.ongoing} disabled={disabled || !d.start} onChange={(e) => put({ ...d, ongoing: e.target.checked, end: e.target.checked ? '' : d.end })} /><span>Ongoing</span></label>
      {value && !disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLocal(null); onChange(''); }}>Clear</button>}
    </div>
    {parsed === null && value
      ? <small className="pe-dur-out warn">Saved as “{value}”, which the calendar can’t read. Pick the dates to replace it.</small>
      : <small className="pe-dur-out">On the website: <b>{value || 'not shown'}</b></small>}
    {backwards && <small className="pe-dur-out warn">The end date is before the start date.</small>}
  </div>;
}

export const splitTags = (v: string) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];

/** Category as tags; saved as "Tag one, Tag two" (up to `max` characters, the database limit). */
export function TagInput({ value, onChange, suggestions, disabled, max = 80, id }: { value: string; onChange: (v: string) => void; suggestions: string[]; disabled?: boolean; max?: number; id?: string }) {
  const tags = splitTags(value); const [q, setQ] = useState('');
  const room = (t: string) => [...tags, t].join(', ').length <= max;
  const add = (raw: string) => { const t = raw.replace(/,/g, ' ').trim().slice(0, 40); if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase()) || !room(t)) return false; onChange([...tags, t].join(', ')); setQ(''); return true; };
  const left = suggestions.filter((s) => !tags.some((x) => x.toLowerCase() === s.toLowerCase()));
  const full = !room('x');
  return <div className="pe-tags">
    <div className="pe-tags-box">
      {tags.map((t) => <span key={t} className="pe-tag">{t}{!disabled && <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t).join(', '))}>×</button>}</span>)}
      {!disabled && !full && <input id={id} value={q} list="pe-categories" placeholder={tags.length ? 'Add another…' : 'Type a category and press Enter'} aria-label="Add a category"
        onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) add(v.slice(0, -1)); else if (left.some((s) => s === v)) add(v); else setQ(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(q); } if (e.key === 'Backspace' && !q && tags.length) onChange(tags.slice(0, -1).join(', ')); }}
        onBlur={() => q.trim() && add(q)} />}
    </div>
    <datalist id="pe-categories">{left.map((c) => <option key={c} value={c} />)}</datalist>
    {!disabled && left.length > 0 && <div className="pe-tags-sug"><small>In use:</small>{left.slice(0, 12).map((s) => <button key={s} type="button" disabled={!room(s)} onClick={() => add(s)}>+ {s}</button>)}</div>}
    {full && !disabled && <small className="pe-dur-out">That’s as many categories as fit ({max} characters).</small>}
  </div>;
}
