// Settings Center → Email templates: reusable reply texts for the Inbox. Plain text only. Templates may use a fixed set of
// variables; anything else in {{ }} is refused when saving, so a template can never pull in data it should not.
// Stored in seo_settings 'settings:templates'; every save adds a settings_revisions row ('templates').
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

const template = z.object({
  id: z.string().regex(/^[\w-]{6,64}$/).optional(),
  name: z.string().trim().min(1, 'Name the template.').max(60),
  subject: z.string().trim().min(1, 'Add a subject.').max(200).refine((v) => !/[\r\n]/.test(v), 'The subject must be one line.'),
  body: z.string().trim().min(1, 'Write the text.').max(5000),
}).strict();
const listSchema = z.object({ templates: z.array(template).max(20, 'Keep it to 20 templates.') }).strict();
export type Template = Required<z.infer<typeof template>>;

export async function list(db: DB): Promise<Template[]> {
  const [row] = await db.select({ draft: seoSettings.draft }).from(seoSettings).where(eq(seoSettings.key, KEY));
  return ((row?.draft as { templates?: Template[] } | null)?.templates ?? []);
}

export async function save(db: DB, me: Me, raw: unknown, restoredFrom?: string) {
  const r = listSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Check the templates.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const issues = r.data.templates.flatMap((t, i) => [...unknownVars(t.subject).map((v) => ({ path: `templates.${i}.subject`, v })), ...unknownVars(t.body).map((v) => ({ path: `templates.${i}.body`, v }))]);
  if (issues.length) throw new AppError(422, `Unknown variable {{${issues[0].v}}}. Use only: ${[...NAMES].map((n) => `{{${n}}}`).join(', ')}.`, issues.map((x) => ({ path: x.path, message: `Unknown variable {{${x.v}}}` })));
  const names = r.data.templates.map((t) => t.name.toLowerCase());
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new AppError(422, `Two templates are called “${dup}”.`);
  const next: Template[] = r.data.templates.map((t) => ({ ...t, id: t.id ?? randomUUID() }));
  const cur = await list(db);
  const byId = (xs: Template[]) => Object.fromEntries(xs.map((t) => [t.id, t]));
  const changed = changedKeys(byId(cur), byId(next)).map((id) => (next.find((t) => t.id === id) ?? cur.find((t) => t.id === id))!.name);
  if (!changed.length && !restoredFrom) return { templates: cur, changed: [] as string[] };
  const draft = { templates: next };
  const [row] = await db.select({ key: seoSettings.key }).from(seoSettings).where(eq(seoSettings.key, KEY));
  if (row) await db.update(seoSettings).set({ draft, updatedBy: me.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  else await db.insert(seoSettings).values({ key: KEY, draft, updatedBy: me.id });
  await addRevision(db, me, 'templates', draft, changed, restoredFrom, restoredFrom ? 'Restored email templates' : `Changed templates: ${changed.join(', ')}`);
  await audit(db, me, restoredFrom ? 'settings.restore' : 'settings.update', { type: 'settings', id: 'templates' }, `${restoredFrom ? 'Restored' : 'Changed'} email templates`, { changed });
  return { templates: next, changed };
}

const fill = (s: string, vars: Record<string, string>) => s.replace(VAR, (_, v: string) => vars[v] ?? '');
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
  return { subject: fill(t.subject, vars).replace(/[\r\n]+/g, ' ').slice(0, 200), body: fill(t.body, vars) };
}

/** Preview with the example values (no personal data). */
export function preview(t: { subject: string; body: string }) {
  const vars = Object.fromEntries(VARIABLES.map((v) => [v.name, v.example]));
  return { subject: fill(t.subject, vars), body: fill(t.body, vars), unknown: [...new Set([...unknownVars(t.subject), ...unknownVars(t.body)])] };
}
