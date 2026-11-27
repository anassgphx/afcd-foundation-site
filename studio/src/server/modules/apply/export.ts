// AFCD Apply → export the chosen applications as an Excel workbook: an "Applicants" overview (stage, eligibility and
// decision as coloured cells, score, dates) and, per call, the answers in the form's order. Answers marked sensitive
// in the form are left out. Only staff allowed to export may do it, and each export is recorded in the audit log.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { applyCalls, applyDecisions, applyFormVersions, applySubmissions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { FIELD_TYPES, evaluate, t, type Field, type FileRef, type FormDef } from './engine.ts';
import { S, workbook, type Cell, type Sheet, type Tone } from './xlsx.ts';

type Me = NonNullable<Actor>;
const STAGE: Record<string, [string, Tone]> = { submitted: ['New', 'grey'], eligibility_review: ['Eligibility screening', 'blue'], under_evaluation: ['In review', 'violet'], shortlisted: ['Shortlisted', 'amber'],
  interview: ['Interview', 'amber'], selected: ['Selected', 'green'], waitlisted: ['Waitlisted', 'amber'], not_selected: ['Not selected', 'red'], withdrawn: ['Withdrawn', 'slate'] };
const ELIG: Record<string, [string, Tone]> = { not_assessed: ['Not assessed', 'grey'], needs_review: ['Needs review', 'amber'], eligible: ['Eligible', 'green'], ineligible: ['Ineligible', 'red'] };
const OUT: Record<string, [string, Tone]> = { selected: ['Selected', 'green'], waitlisted: ['Waitlisted', 'amber'], not_selected: ['Not selected', 'red'] };
const LANG: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic' };
const badge = ([v, tn]: [string, Tone]): Cell => ({ v, s: S[tn] });

/** A date shown in the call's time zone (Excel has no time zones: the cell holds the local wall-clock time). */
function local(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}
function answer(f: Field, v: unknown): Cell {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (typeof v === 'boolean') return f.type === 'consent' ? (v ? 'Agreed' : 'Not agreed') : v ? 'Yes' : 'No';
  const opt = (x: string) => t(f.config?.options?.find((o) => o.value === x)?.label) || x;
  if (f.type === 'file') return (v as FileRef[]).map((x) => x.name).join(', ');
  if (Array.isArray(v)) return (v as string[]).map(opt).join(', ');
  if (typeof v === 'number') return v;
  return typeof v === 'string' && f.config?.options ? opt(v) : String(v);
}

export async function exportApplicants(db: DB, me: Me, raw: unknown) {
  const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Choose the applications to export.');
  const ids = [...new Set(b.data.ids)];
  const subs = await db.select().from(applySubmissions).where(inArray(applySubmissions.id, ids)).orderBy(desc(applySubmissions.submittedAt));
  if (subs.length !== ids.length) throw new AppError(404, 'Some applications no longer exist. Reload and try again.');
  const calls = await db.select().from(applyCalls).where(inArray(applyCalls.id, [...new Set(subs.map((s) => s.callId))]));
  const versions = await db.select({ id: applyFormVersions.id, number: applyFormVersions.number, definition: applyFormVersions.definition }).from(applyFormVersions).where(inArray(applyFormVersions.id, [...new Set(subs.map((s) => s.versionId))]));
  const proposed = new Set((await db.select({ s: applyDecisions.submissionId }).from(applyDecisions).where(and(inArray(applyDecisions.submissionId, ids), eq(applyDecisions.status, 'proposed')))).map((x) => x.s));
  const [who] = await db.select({ name: users.name }).from(users).where(eq(users.id, me.id));
  const callOf = new Map(calls.map((c) => [c.id, c])), verOf = new Map(versions.map((v) => [v.id, v]));
  const zone = calls[0]?.timeZone ?? 'Africa/Casablanca';
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const note = `Exported ${when} by ${who?.name ?? me.email} · ${subs.length} application${subs.length === 1 ? '' : 's'} · personal data: keep it private and delete it when no longer needed. Times in ${zone}.`;

  const overview: Sheet = {
    name: 'Applicants', title: calls.length === 1 ? `Applicants · ${calls[0].title}` : 'Applicants', note,
    columns: [{ header: 'Reference', width: 22 }, { header: 'Applicant', width: 26 }, { header: 'Email', width: 30 }, ...(calls.length > 1 ? [{ header: 'Call', width: 30 }] : []),
      { header: 'Stage', width: 20 }, { header: 'Eligibility', width: 16 }, { header: 'Decision', width: 20 }, { header: 'Score / 100', width: 12 }, { header: 'Final reviews', width: 12 },
      { header: 'Submitted', width: 20 }, { header: 'Language', width: 11 }, { header: 'Eligibility note', width: 40 }],
    rows: subs.map((s) => {
      const c = callOf.get(s.callId)!;
      const decision: Cell = OUT[s.status] ? badge(OUT[s.status]) : proposed.has(s.id) ? badge(['Waiting for approval', 'amber']) : badge(['None yet', 'grey']);
      return [{ v: s.reference, s: S.ref }, { v: s.applicantName, s: S.bold }, s.applicantEmail, ...(calls.length > 1 ? [c.title] : []),
        badge(STAGE[s.status] ?? [s.status, 'grey']), badge(ELIG[s.eligibility] ?? [s.eligibility, 'grey']), decision,
        s.scoreBp === null ? '' : { v: s.scoreBp / 100, s: S.num1 }, s.scoreReviews, local(s.submittedAt, c.timeZone), LANG[s.lang] ?? s.lang,
        s.eligibilityOverride ? { v: `${s.eligibilityOverride.reason} (${s.eligibilityOverride.byName})`, s: S.wrap } : ''];
    }),
  };

  // one answers sheet per call: the questions of the newest form version used, in the form's order (sensitive ones left out)
  const sheets: Sheet[] = [overview];
  let leftOut = 0;
  for (const c of calls) {
    const own = subs.filter((s) => s.callId === c.id);
    const vs = [...new Set(own.map((s) => s.versionId))].map((id) => verOf.get(id)!).sort((a, b) => b.number - a.number);
    const fields: Field[] = []; const seen = new Set<string>();
    for (const v of vs) for (const p of (v.definition as FormDef).pages) for (const f of p.fields) {
      if (seen.has(f.id) || !(FIELD_TYPES[f.type].input || f.type === 'calculated')) continue;
      seen.add(f.id); if (f.private) { leftOut++; continue; } fields.push(f);
    }
    sheets.push({
      name: `Answers ${c.reference}`, title: `Answers · ${c.title}`, note: `${own.length} application${own.length === 1 ? '' : 's'} · form version${vs.length > 1 ? 's' : ''} ${vs.map((v) => v.number).join(', ')}${fields.length < seen.size ? ' · answers marked sensitive are not exported' : ''}. Empty: not answered, or not asked because of the form’s logic.`,
      columns: [{ header: 'Reference', width: 22 }, { header: 'Applicant', width: 24 }, ...fields.map((f) => ({ header: t(f.label) || f.id, width: f.type === 'long_text' ? 48 : f.type === 'multi_choice' || f.type === 'file' ? 32 : 22 }))],
      rows: own.map((s) => {
        const def = verOf.get(s.versionId)!.definition as FormDef;
        const ev = evaluate(def, s.answers as never);
        return [{ v: s.reference, s: S.ref }, { v: s.applicantName, s: S.bold }, ...fields.map((f) => {
          const v = answer(f, f.type === 'calculated' ? ev.values[f.id] : (s.answers as Record<string, unknown>)[f.id]);
          return typeof v === 'string' && v.length > 40 ? { v, s: S.wrap } : v;
        })];
      }),
    });
  }
  const bytes = workbook(sheets, { title: overview.title, author: who?.name ?? me.email });
  await audit(db, me, 'apply.submission.export', { type: 'apply_submission' }, `Exported ${subs.length} application(s) to Excel`, { ids, calls: calls.map((c) => c.reference), sensitiveLeftOut: leftOut > 0 });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = calls.length === 1 ? calls[0].reference : 'applicants';
  return { bytes, filename: `${base}-applicants-${stamp}.xlsx` };
}
