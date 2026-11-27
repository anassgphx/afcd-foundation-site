// Sign-in screen, other steps: "Forgot password" (asks for the address; the answer never says whether it has an account)
// and "Choose a new password" from an emailed link (?reset=<token>). The server does every check; see modules/account.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, post } from './api.ts';
import { Icon } from './ui.tsx';
import './account.css';

export const resetToken = () => { try { return new URLSearchParams(location.search).get('reset') ?? ''; } catch { return ''; } };
const dropToken = () => { const u = new URL(location.href); u.searchParams.delete('reset'); history.replaceState(null, '', u); };

export function ForgotForm({ available, onBack }: { available: boolean; onBack: () => void }) {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Enter the email address of your Studio account.'); return; }
    setBusy(true);
    try { await post('/auth/forgot', { email: email.trim() }); setDone(true); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send the request. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  if (!available) return <div className="auth-form">
    <h2>Forgot your password?</h2>
    <p className="auth-sub">Studio can’t email reset links yet. Ask an administrator: they can set a new password for you in Users &amp; roles.</p>
    <button type="button" className="auth-btn auth-btn-ghost" onClick={onBack}>Back to sign in</button>
  </div>;
  if (done) return <div className="auth-form" role="status">
    <span className="auth-ok" aria-hidden="true"><Icon n="mail" /></span>
    <h2>Check your email</h2>
    <p className="auth-sub">If <b>{email.trim()}</b> has a Studio account, we’ve sent it a link to choose a new password. The link works once, for 30 minutes. Check your spam folder too.</p>
    <button type="button" className="auth-btn auth-btn-ghost" onClick={onBack}>Back to sign in</button>
  </div>;
  return <form className="auth-form" onSubmit={submit} noValidate>
    <h2>Forgot your password?</h2>
    <p className="auth-sub">Enter your account’s email address. We’ll send you a link to choose a new one.</p>
    <label className="auth-field"><span>Email</span>
      <span className={`auth-in${err ? ' bad' : ''}`}><Icon n="mail" /><input type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} placeholder="you@afcdteam.com" autoFocus required aria-invalid={!!err} aria-describedby={err ? 'fg-err' : undefined} /></span>
      {err && <small id="fg-err" className="auth-err-t">{err}</small>}</label>
    <button className="auth-btn" disabled={busy}>{busy ? <><span className="auth-spin" aria-hidden="true" />Sending…</> : <>Send me a link<span className="auth-btn-arr" aria-hidden="true">→</span></>}</button>
    <button type="button" className="auth-link" onClick={onBack}>← Back to sign in</button>
  </form>;
}

export function ResetForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<'checking' | 'ok' | 'bad' | 'done'>('checking'); const [email, setEmail] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { post<{ ok: boolean; email?: string }>('/auth/reset/check', { token }).then((r) => { setState(r.ok ? 'ok' : 'bad'); setEmail(r.email ?? ''); }).catch(() => setState('bad')); }, [token]);
  const back = () => { dropToken(); onDone(); };
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 12) { setErr('Use at least 12 characters.'); return; }
    if (pw !== pw2) { setErr('The two passwords are not the same.'); return; }
    setBusy(true);
    try { await post('/auth/reset', { token, password: pw }); setState('done'); }
    catch (x) { if (x instanceof ApiError && x.status === 409) setState('bad'); else setErr(x instanceof ApiError ? x.message : 'Could not save. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  if (state === 'checking') return <div className="auth-form"><p className="auth-sub">Checking your link…</p></div>;
  if (state === 'bad') return <div className="auth-form">
    <h2>This link doesn’t work any more</h2>
    <p className="auth-sub">Links work once, for a limited time. Ask for a new one from the sign-in page.</p>
    <button type="button" className="auth-btn auth-btn-ghost" onClick={back}>Back to sign in</button>
  </div>;
  if (state === 'done') return <div className="auth-form" role="status">
    <span className="auth-ok" aria-hidden="true"><Icon n="check" /></span>
    <h2>Password changed</h2>
    <p className="auth-sub">You can sign in with your new password. You were signed out on every other device.</p>
    <button type="button" className="auth-btn" onClick={back}>Sign in<span className="auth-btn-arr" aria-hidden="true">→</span></button>
  </div>;
  const strength = pw.length === 0 ? '' : pw.length < 12 ? 'Too short' : pw.length < 16 ? 'Good' : 'Strong';
  return <form className="auth-form" onSubmit={submit} noValidate>
    <h2>Choose a new password</h2>
    <p className="auth-sub">For <b>{email}</b>. At least 12 characters; a short sentence is easy to remember and hard to guess.</p>
    <label className="auth-field"><span>New password</span>
      <span className="auth-in"><Icon n="lock" /><input type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} autoFocus required minLength={12} aria-describedby="rs-strength" />
        <button type="button" className="auth-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}><Icon n={show ? 'eyeoff' : 'eye'} /></button></span>
      <small id="rs-strength" className={`auth-strength s-${strength.toLowerCase().replace(' ', '-')}`} aria-live="polite">{strength || ' '}</small></label>
    <label className="auth-field"><span>Type it again</span>
      <span className="auth-in"><Icon n="lock" /><input type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(''); }} required /></span></label>
    {err && <div className="auth-alert" role="alert"><Icon n="alert" />{err}</div>}
    <button className="auth-btn" disabled={busy}>{busy ? <><span className="auth-spin" aria-hidden="true" />Saving…</> : <>Save my new password<span className="auth-btn-arr" aria-hidden="true">→</span></>}</button>
  </form>;
}
