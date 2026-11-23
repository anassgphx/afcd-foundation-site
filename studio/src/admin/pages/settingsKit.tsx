// Settings Center building blocks shared by every panel: headers, fields with their "what applies when" tag, the save
// bar, live-fact grids and check lists. Everything shown through these comes from the server.
import { useEffect, useState, type ReactNode } from 'react';
import { api, put, ApiError } from '../api.ts';
import { Icon, Link, fmtDate, useToast } from '../ui.tsx';

export type Effect = 'publish' | 'immediate' | 'restart' | 'none';
export const EFFECT: Record<Effect, string> = { publish: 'Publish to apply', immediate: 'Applies at once', restart: 'Restart Studio', none: 'Read-only' };
export const errOf = (e: unknown) => (e instanceof ApiError ? e : null);
export const Dot = ({ on }: { on: boolean }) => <i className={`set-dot${on ? ' on' : ''}`} aria-hidden="true" />;

export function PanelHead({ title, summary, icon, link, children }: { title: string; summary: string; icon?: string; link?: { to: string; label: string }; children?: ReactNode }) {
  return (
    <div className="set-ph">
      {icon && <span className="set-ph-ic" aria-hidden="true"><Icon n={icon} /></span>}
      <div className="set-ph-t"><h2 id="set-title">{title}</h2><p>{summary}</p></div>
      {(link || children) && <div className="set-ph-a">{children}{link && <Link className="btn btn-sm" to={link.to}>{link.label}<Icon n="ext" /></Link>}</div>}
    </div>
  );
}

export function F({ id, label, hint, effect, admin, locked, error, children }: { id: string; label: string; hint?: ReactNode; effect: Effect; admin?: boolean; locked?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="set-f field">
      <span className="set-fl"><label htmlFor={`set-${id}`}>{label}</label><i className={`set-eff set-eff-${effect}`}>{EFFECT[effect]}</i>{admin && <i className="set-eff set-eff-admin"><Icon n="lock" />Admins</i>}</span>
      {children}
      {error ? <small className="err" role="alert">{error}</small> : hint ? <small>{hint}{locked ? ' Only an administrator can change this.' : ''}</small> : locked ? <small>Only an administrator can change this.</small> : null}
    </div>
  );
}

export function useForm<T>(initial: T, path: string, onSaved: () => void) {
  const [v, setV0] = useState<T>(initial); const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({}); const toast = useToast();
  const setV = (x: T) => { setV0(x); setErrs({}); };   // an edit clears the previous errors
  useEffect(() => { setV0(initial); }, [JSON.stringify(initial)]);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  async function save(body: unknown = v) {
    setBusy(true); setErrs({});
    try {
      const r = await put<{ changed?: string[] }>(path, body);
      toast(r.changed && !r.changed.length ? 'Nothing changed.' : 'Saved.'); onSaved();
      return true;
    } catch (e) {
      // field errors are shown next to the field (a toast would cover the save bar); other errors as a toast
      const x = errOf(e); const fields = x?.details?.filter((d) => d.path) ?? [];
      if (fields.length) setErrs(Object.fromEntries(fields.map((d) => [d.path!, d.message])));
      else toast(x?.message ?? 'Could not save.', true);
      return false;
    } finally { setBusy(false); }
  }
  return { v, setV, busy, errs, dirty, save, reset: () => { setV0(initial); setErrs({}); } };
}

export function SaveBar({ dirty, busy, onSave, onReset, unpublished, canEdit, note }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void; unpublished?: string[]; canEdit: boolean; note?: string }) {
  if (!canEdit) return <div className="set-bar"><Icon n="lock" /><span className="muted">Your role can view these settings but not change them.</span></div>;
  const msg = dirty ? 'Unsaved changes' : unpublished?.length ? `Saved, not yet on the website: ${unpublished.join(', ')}` : unpublished ? 'Saved values match the website' : note ?? 'All changes saved';
  return (
    <div className={`set-bar${dirty ? ' dirty' : ''}`} role="region" aria-label="Save changes">
      <span className="set-bar-msg"><i className={`set-dot${dirty ? '' : ' on'}`} aria-hidden="true" />{msg}</span>
      <span style={{ flex: 1 }} />
      <button className="btn" disabled={!dirty || busy} onClick={onReset}>Discard</button>
      <button className="btn btn-primary" disabled={!dirty || busy} onClick={onSave}><Icon n="save" />{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

/** Loads read-only facts for a panel; `reload` re-reads them. */
export function useFacts<T>(path: string | null) {
  const [d, setD] = useState<T | null>(null); const [err, setErr] = useState('');
  const load = () => { if (!path) return; setErr(''); api<T>(path).then(setD).catch((e) => setErr(e.message)); };
  useEffect(load, [path]);
  return { d, err, reload: load, setD };
}
export function Loading({ err, h = 140 }: { err?: string; h?: number }) {
  return err ? <div className="notice n-warn"><Icon n="alert" />{err}</div> : <div className="skeleton" style={{ height: h }} />;
}

export type StatItem = { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'ok' | null };
export function Stats({ items }: { items: StatItem[] }) {
  return <dl className="set-stats">{items.map((s) => <div key={s.label} className={s.tone ? `t-${s.tone}` : undefined}><dt>{s.label}</dt><dd>{s.value}</dd>{s.hint && <small>{s.hint}</small>}</div>)}</dl>;
}

export type CheckItem = { id: string; label: string; ok: boolean | null; detail: string };
export function Checks({ checks, at }: { checks: CheckItem[]; at?: string }) {
  return (
    <ul className="set-checks">
      {checks.map((c) => <li key={c.id}><i className={`set-ck ${c.ok === null ? 'na' : c.ok ? 'ok' : 'bad'}`} role="img" aria-label={c.ok === null ? 'Not applicable' : c.ok ? 'Passed' : 'Problem'} /><div><b>{c.label}</b><small>{c.detail}</small></div></li>)}
      {at && <li className="muted set-checked">Checked {fmtDate(at)}</li>}
    </ul>
  );
}

export const AdminOnly = ({ what }: { what: string }) => (
  <div className="set-card set-empty"><Icon n="lock" /><div><b>Administrators only</b><p className="muted">Only administrators can see {what}.</p></div></div>
);

export const fmtBytes = (b: number | null | undefined) => b == null ? '—' : b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
