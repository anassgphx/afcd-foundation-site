// Settings Center → Email templates: reusable replies for the Inbox, and the design every Studio email is sent in.
// A template is plain text plus optional parts the branded layout shows (email-layout.ts): a heading, the preview line
// inboxes show next to the subject, one button and a details card. Templates may use a fixed set of variables; anything
// else in {{ }} is refused when saving, so a template can never pull in data it should not. Links must be https:// or mailto:.
// Stored in seo_settings 'settings:templates' as { templates, design }; every save adds a settings_revisions row ('templates').
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { formSubmissions, seoSettings } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { addRevision, changedKeys, loadRows } from './service.ts';

type Me = NonNullable<Actor>;
const KEY = 'settings:templates';
export const VARIABLES = [
  { name: 'contact_name', label: 'Full name of the person who wrote', example: 'Amina Test' },
  { name: 'contact_first_name', label: 'Their first name', example: 'Amina' },
  { name: 'topic', label: 'Topic they chose on the form', example: 'Volunteering' },
  { name: 'sender_name', label: 'Your name (the Studio user sending)', example: 'Studio User' },
  { name: 'organization', label: 'Site name (Settings → General)', example: 'AFCD Foundation' },
  { name: 'today', label: 'Today’s date', example: '23 November 2026' },
] as const;
const NAMES = new Set<string>(VARIABLES.map((v) => v.name));
const VAR = /\{\{\s*([^{}]*?)\s*\}\}/g;
const unknownVars = (s: string) => [...s.matchAll(VAR)].map((m) => m[1]).filter((v) => !NAMES.has(v));

const line = (max: number) => z.string().trim().max(max).refine((v) => !/[\r\n]/.test(v), 'Keep it to one line.');
const link = z.string().trim().max(500).regex(/^(https:\/\/|mailto:)[^\s"'<>]+$/i, 'Use a full https:// address or a mailto: link.');
const template = z.object({
  id: z.string().regex(/^[\w-]{6,64}$/).optional(),
  name: z.string().trim().min(1, 'Name the template.').max(60),
  subject: z.string().trim().min(1, 'Add a subject.').max(200).refine((v) => !/[\r\n]/.test(v), 'The subject must be one line.'),
  heading: line(120).optional().default(''),
  preheader: line(150).optional().default(''),
  body: z.string().trim().min(1, 'Write the text.').max(5000),
  button: z.object({ label: line(40).pipe(z.string().min(1, 'Add the button text.')), url: link }).strict().nullable().optional().default(null),
  details: z.object({
    title: line(60).optional().default(''),
    rows: z.array(z.object({ label: line(40), value: line(160) }).strict()).max(8, 'Keep it to 8 lines.'),
  }).strict().nullable().optional().default(null),
}).strict();
/** The look of every email Studio sends (Inbox replies, tests, notifications). */
const designSchema = z.object({
  branded: z.boolean(),
  showContact: z.boolean(),
  showSocial: z.boolean(),
  footerNote: z.string().trim().max(300),
  signature: z.string().trim().max(300),
}).strict();
export type Design = z.infer<typeof designSchema>;
export const DESIGN_DEFAULTS: Design = {
  branded: true, showContact: true, showSocial: true,
  footerNote: 'You are receiving this email because you contacted us or work with us. Reply to this email to reach our team.',
  signature: '',
};
const listSchema = z.object({ templates: z.array(template).max(20, 'Keep it to 20 templates.'), design: designSchema.optional() }).strict();
export type Template = z.infer<typeof template> & { id: string };
/** The optional parts that may hold variables (subject and body are checked on their own, with their own error path). */
const extras = (t: Partial<Template>) => [t.heading ?? '', t.preheader ?? '', t.button?.label ?? '', t.details?.title ?? '', ...(t.details?.rows ?? []).flatMap((r) => [r.label, r.value])];

async function stored(db: DB) {
  const [row] = await db.select({ draft: seoSettings.draft }).from(seoSettings).where(eq(seoSettings.key, KEY));
  return (row?.draft ?? null) as { templates?: Partial<Template>[]; design?: Partial<Design> } | null;
}
/** Older templates (text only) are read with the new optional parts empty. */
export async function list(db: DB): Promise<Template[]> {
  return ((await stored(db))?.templates ?? []).map((t) => ({ heading: '', preheader: '', button: null, details: null, ...t }) as Template);
}
export async function design(db: DB): Promise<Design> {
  return { ...DESIGN_DEFAULTS, ...((await stored(db))?.design ?? {}) };
}

export async function save(db: DB, me: Me, raw: unknown, restoredFrom?: string) {
  const r = listSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Check the templates.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const issues = [
    ...r.data.templates.flatMap((t, i) => [...unknownVars(t.subject).map((v) => ({ path: `templates.${i}.subject`, v })), ...unknownVars(t.body).map((v) => ({ path: `templates.${i}.body`, v })),
      ...extras(t).flatMap((x) => unknownVars(x)).map((v) => ({ path: `templates.${i}`, v }))]),
    ...unknownVars(r.data.design?.signature ?? '').map((v) => ({ path: 'design.signature', v })),
    ...unknownVars(r.data.design?.footerNote ?? '').map((v) => ({ path: 'design.footerNote', v })),
  ];
  if (issues.length) throw new AppError(422, `Unknown variable {{${issues[0].v}}}. Use only: ${[...NAMES].map((n) => `{{${n}}}`).join(', ')}.`, issues.map((x) => ({ path: x.path, message: `Unknown variable {{${x.v}}}` })));
  const names = r.data.templates.map((t) => t.name.toLowerCase());
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new AppError(422, `Two templates are called “${dup}”.`);
  const next: Template[] = r.data.templates.map((t) => ({ ...t, id: t.id ?? randomUUID() }));
  const cur = await list(db);
  const byId = (xs: Template[]) => Object.fromEntries(xs.map((t) => [t.id, t]));
  const curDesign = await design(db); const nextDesign = r.data.design ?? curDesign;
  const changed = [...changedKeys(byId(cur), byId(next)).map((id) => (next.find((t) => t.id === id) ?? cur.find((t) => t.id === id))!.name),
    ...(JSON.stringify(curDesign) !== JSON.stringify(nextDesign) ? ['Email design'] : [])];
  if (!changed.length && !restoredFrom) return { templates: cur, design: curDesign, changed: [] as string[] };
  const draft = { templates: next, design: nextDesign };
  const [row] = await db.select({ key: seoSettings.key }).from(seoSettings).where(eq(seoSettings.key, KEY));
  if (row) await db.update(seoSettings).set({ draft, updatedBy: me.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  else await db.insert(seoSettings).values({ key: KEY, draft, updatedBy: me.id });
  await addRevision(db, me, 'templates', draft, changed, restoredFrom, restoredFrom ? 'Restored email templates' : `Changed templates: ${changed.join(', ')}`);
  await audit(db, me, restoredFrom ? 'settings.restore' : 'settings.update', { type: 'settings', id: 'templates' }, `${restoredFrom ? 'Restored' : 'Changed'} email templates`, { changed });
  return { templates: next, design: nextDesign, changed };
}

const fill = (s: string, vars: Record<string, string>) => s.replace(VAR, (_, v: string) => vars[v] ?? '');
export const fillVars = fill;
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Casablanca' });

/** A template filled in for one contact message (used by the Inbox reply composer). */
export async function renderFor(db: DB, me: Me & { name: string }, templateId: string, messageId: string) {
  const t = (await list(db)).find((x) => x.id === templateId);
  if (!t) throw new AppError(404, 'Template not found.');
  if (!z.string().uuid().safeParse(messageId).success) throw new AppError(404, 'Message not found.');
  const [m] = await db.select({ name: formSubmissions.name, topic: formSubmissions.topic }).from(formSubmissions).where(and(eq(formSubmissions.id, messageId), eq(formSubmissions.formKey, 'contact')));
  if (!m) throw new AppError(404, 'Message not found.');
  const org = (await loadRows(db)).general.draft.siteName;
  const vars = { contact_name: m.name, contact_first_name: m.name.trim().split(/\s+/)[0] ?? '', topic: m.topic, sender_name: me.name, organization: org, today: today() };
  return { ...filled(t, vars), subject: fill(t.subject, vars).replace(/[\r\n]+/g, ' ').slice(0, 200) };
}

/** A template's parts with the variables filled in (what the Inbox composer and the layout receive). */
export function filled(t: Pick<Template, 'subject' | 'body'> & Partial<Template>, vars: Record<string, string>) {
  return {
    subject: fill(t.subject, vars), body: fill(t.body, vars), heading: fill(t.heading ?? '', vars), preheader: fill(t.preheader ?? '', vars),
    button: t.button ? { label: fill(t.button.label, vars), url: t.button.url } : null,
    details: t.details ? { title: fill(t.details.title ?? '', vars), rows: t.details.rows.map((r) => ({ label: fill(r.label, vars), value: fill(r.value, vars) })) } : null,
  };
}
export const exampleVars = () => Object.fromEntries(VARIABLES.map((v) => [v.name, v.example]));

/** Preview with the example values (no personal data). */
export function preview(t: Pick<Template, 'subject' | 'body'> & Partial<Template>) {
  const all = [t.subject, t.body, ...extras(t)];
  return { ...filled(t, exampleVars()), unknown: [...new Set(all.flatMap(unknownVars))] };
}
export const senderVars = async (db: DB, me: { name: string }) => ({ sender_name: me.name, organization: (await loadRows(db)).general.draft.siteName, today: today() });
