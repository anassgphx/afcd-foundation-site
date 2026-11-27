// AFCD Apply: application forms and templates. A call has one working form (saved with optimistic concurrency) and
// immutable published versions; templates are built-in (code) or custom (database, versioned). Definitions are checked
// twice: their shape (definition.ts) on every save, their meaning (engine.analyze) before publishing.
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { applyCalls, applyCallEvents, applyForms, applyFormTemplates, applyFormVersions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { allFields, analyze, breakingChanges, emptyForm, type FormDef } from './engine.ts';
import { parseForm } from './definition.ts';
import { BUILT_IN_TEMPLATES } from './templates.ts';

type Me = NonNullable<Actor>;
const uuid = z.string().uuid();
const FORMAT = 'afcd-apply-form', TEMPLATE_FORMAT = 'afcd-apply-template';

/** JSON with sorted keys: the same definition always gives the same text (Postgres jsonb reorders keys). */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const defHash = (d: unknown) => createHash('sha256').update(canonical(d)).digest('hex');

function parsed(raw: unknown): FormDef {
  const r = parseForm(raw);
  if (!r.ok) throw new AppError(422, 'The form has problems that stop it from being saved.', r.issues);
  return r.def;
}
const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

async function callOf(db: DB, callId: string) {
  if (!uuid.safeParse(callId).success) throw new AppError(404, 'Call not found.');
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, callId));
  if (!c) throw new AppError(404, 'Call not found.');
  return c;
}
async function formOf(db: DB, callId: string) {
  const [f] = await db.select().from(applyForms).where(eq(applyForms.callId, callId));
  return f ?? null;
}
async function latestVersion(db: DB, formId: string) {
  const [v] = await db.select().from(applyFormVersions).where(eq(applyFormVersions.formId, formId)).orderBy(desc(applyFormVersions.number)).limit(1);
  return v ?? null;
}

// ---------------------------------------------------------------- Templates as sources
export async function templateDefinition(db: DB, source: string): Promise<{ def: FormDef; label: string }> {
  const b = BUILT_IN_TEMPLATES.find((x) => x.key === source);
  if (b) return { def: deepCopy(b.definition), label: b.name };
  if (!uuid.safeParse(source).success) throw new AppError(404, 'Template not found.');
  const [t] = await db.select().from(applyFormTemplates).where(eq(applyFormTemplates.id, source));
  if (!t) throw new AppError(404, 'Template not found.');
  return { def: parsed(t.definition), label: t.name };
}

// ---------------------------------------------------------------- Call forms
/** Everything the builder needs: working definition, its checks, published versions, what would break. */
export async function loadForm(db: DB, callId: string) {
  const call = await callOf(db, callId);
  const form = await formOf(db, callId);
  const base = { call: { id: call.id, reference: call.reference, title: call.title, status: call.status, openedAt: call.openedAt } };
  if (!form) return { ...base, form: null };
  const def = form.definition as unknown as FormDef;
  const versions = await db.select({ id: applyFormVersions.id, number: applyFormVersions.number, note: applyFormVersions.note, sha256: applyFormVersions.sha256, createdAt: applyFormVersions.createdAt, publishedBy: users.name })
    .from(applyFormVersions).leftJoin(users, eq(users.id, applyFormVersions.publishedBy)).where(eq(applyFormVersions.formId, form.id)).orderBy(desc(applyFormVersions.number));
  const last = versions[0] ? await latestVersion(db, form.id) : null;
  return {
    ...base,
    form: { id: form.id, rev: form.rev, definition: def, sourceTemplate: form.sourceTemplate, updatedAt: form.updatedAt, publishedVersionId: form.publishedVersionId },
    issues: analyze(def),
    versions: versions.map(({ sha256, ...v }) => ({ ...v, current: sha256 === defHash(def) })),
    unpublishedChanges: !last || last.sha256 !== defHash(def),
    breaking: last && call.openedAt ? breakingChanges(last.definition as unknown as FormDef, def) : [],
    // questions in a published version keep their ID (answers are stored under it); once the call has opened they also
    // keep their type and options (the builder locks them, publishForm refuses otherwise)
    publishedFields: last ? allFields(last.definition as unknown as FormDef).map((f) => f.id) : [],
  };
}

export async function createForm(db: DB, me: Me, callId: string, raw: unknown) {
  const b = z.object({ template: z.string().max(80).optional() }).strict().safeParse(raw ?? {});
  if (!b.success) throw new AppError(422, 'Unknown option.');
  const call = await callOf(db, callId);
  if (call.status === 'archived') throw new AppError(409, 'Restore this call before adding a form.');
  if (await formOf(db, callId)) throw new AppError(409, 'This call already has a form.');
  const src = b.data.template ? await templateDefinition(db, b.data.template) : { def: emptyForm(), label: 'blank form' };
  const def = parsed(src.def);
  const [f] = await db.insert(applyForms).values({ callId, definition: def as unknown as Record<string, unknown>, sourceTemplate: b.data.template ?? null, updatedBy: me.id })
    .onConflictDoNothing().returning();
  if (!f) throw new AppError(409, 'This call already has a form.');
  await audit(db, me, 'apply.form.create', { type: 'apply_call', id: callId }, `Created the form of ${call.reference} from ${src.label}`);
  return loadForm(db, callId);
}

const saveSchema = z.object({ definition: z.unknown(), rev: z.number().int().min(1) }).strict();

/** Replaces the working definition. The published version does not change until "Publish". */
export async function saveForm(db: DB, me: Me, callId: string, raw: unknown, how: 'save' | 'import' | 'template' = 'save', label = '') {
  const b = saveSchema.safeParse(raw);
  if (!b.success) throw new AppError(422, 'Send the form and the revision you loaded.');
  const def = parsed(b.data.definition);
  const call = await callOf(db, callId);
  if (call.status === 'archived') throw new AppError(409, 'Restore this call before editing its form.');
  const [f] = await db.update(applyForms).set({ definition: def as unknown as Record<string, unknown>, rev: sql`${applyForms.rev} + 1`, updatedBy: me.id, updatedAt: new Date(), ...(how === 'template' ? { sourceTemplate: label } : {}) })
    .where(and(eq(applyForms.callId, callId), eq(applyForms.rev, b.data.rev))).returning({ rev: applyForms.rev });
  if (!f) {
    if (!(await formOf(db, callId))) throw new AppError(404, 'This call has no form yet.');
    throw new AppError(409, 'Someone else saved this form after you opened it. Reload to see their changes; your edits are still in this window.', [{ path: 'rev', message: 'stale' }]);
  }
  if (how !== 'save') await audit(db, me, `apply.form.${how}`, { type: 'apply_call', id: callId }, `${how === 'import' ? 'Imported a form into' : `Replaced the form with template “${label}” in`} ${call.reference}`);
  return { rev: f.rev, issues: analyze(def) };
}

/** Publishes the saved working definition as a new immutable version. Errors from analyze() block it; once the call
 *  has opened, a version that would not fit answers already given (removed questions, changed types, removed options)
 *  is refused: add a new question instead. */
export async function publishForm(db: DB, me: Me, callId: string, raw: unknown) {
  const b = z.object({ rev: z.number().int().min(1), note: z.string().trim().max(300).default('') }).strict().safeParse(raw ?? {});
  if (!b.success) throw new AppError(422, 'Send the revision you are publishing.');
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const call = await callOf(t, callId);
    if (['archived', 'completed'].includes(call.status)) throw new AppError(409, 'This call is finished; its form can no longer change.');
    const [form] = await t.select().from(applyForms).where(eq(applyForms.callId, callId)).for('update');
    if (!form) throw new AppError(404, 'This call has no form yet.');
    if (form.rev !== b.data.rev) throw new AppError(409, 'The form changed since you opened it. Reload, check it, then publish.');
    const def = parsed(form.definition);
    const errors = analyze(def).filter((i) => i.level === 'error');
    if (errors.length) throw new AppError(422, 'Fix these problems before publishing.', errors.map((e) => ({ path: e.ref ? `${e.ref.kind}:${e.ref.id}` : '', message: e.message })));
    const last = await latestVersion(t, form.id);
    const hash = defHash(def);
    if (last?.sha256 === hash) throw new AppError(409, `Nothing changed since version ${last.number}.`);
    if (last && call.openedAt) {
      const broken = breakingChanges(last.definition as unknown as FormDef, def);
      if (broken.length) throw new AppError(409, 'This version would not fit answers applicants may already have given. Keep these questions and options (you can hide them with a rule) and add new ones instead.', broken.map((m) => ({ path: '', message: m })));
    }
    const [{ n }] = await t.select({ n: max(applyFormVersions.number) }).from(applyFormVersions).where(eq(applyFormVersions.formId, form.id));
    const [v] = await t.insert(applyFormVersions).values({ formId: form.id, callId, number: (n ?? 0) + 1, definition: def as unknown as Record<string, unknown>, sha256: hash, note: b.data.note, publishedBy: me.id }).returning();
    await t.update(applyForms).set({ publishedVersionId: v.id }).where(eq(applyForms.id, form.id));
    await t.insert(applyCallEvents).values({ callId, actorId: me.id, kind: 'form_published', reason: b.data.note, meta: { version: v.number, sha256: hash } });
    await audit(tx, me, 'apply.form.publish', { type: 'apply_call', id: callId }, `Published form version ${v.number} of ${call.reference}`, { versionId: v.id, sha256: hash });
    return { version: v.number, id: v.id };
  });
}

export async function formVersion(db: DB, callId: string, number: number) {
  const [v] = await db.select().from(applyFormVersions).where(and(eq(applyFormVersions.callId, callId), eq(applyFormVersions.number, number)));
  if (!v) throw new AppError(404, 'Version not found.');
  return { number: v.number, definition: v.definition, sha256: v.sha256, createdAt: v.createdAt, note: v.note };
}

/** A published version exists: the call can open. */
export async function hasPublishedForm(db: Pick<DB, 'select'>, callId: string) {
  const [r] = await db.select({ id: applyForms.publishedVersionId }).from(applyForms).where(eq(applyForms.callId, callId));
  return !!r?.id;
}

export async function exportForm(db: DB, me: Me, callId: string) {
  const call = await callOf(db, callId);
  const form = await formOf(db, callId);
  if (!form) throw new AppError(404, 'This call has no form yet.');
  await audit(db, me, 'apply.form.export', { type: 'apply_call', id: callId }, `Exported the form of ${call.reference} as JSON`);
  return { format: FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), source: { reference: call.reference, title: call.title, rev: form.rev }, definition: form.definition };
}

/** Accepts a file exported from a form or a template (or a bare definition). */
export function unwrapImport(data: unknown): unknown {
  if (data && typeof data === 'object' && 'format' in data) {
    const d = data as { format: unknown; formatVersion?: unknown; definition?: unknown };
    if (d.format !== FORMAT && d.format !== TEMPLATE_FORMAT) throw new AppError(422, 'This file is not an AFCD Apply form or template.');
    if (d.formatVersion !== 1) throw new AppError(422, 'This file was made by a newer version of Studio.');
    return d.definition;
  }
  return data;
}

export async function listForms(db: DB) {
  const rows = await db.select({ callId: applyCalls.id, reference: applyCalls.reference, title: applyCalls.title, status: applyCalls.status, closesAt: applyCalls.closesAt,
    formId: applyForms.id, definition: applyForms.definition, updatedAt: applyForms.updatedAt, publishedVersionId: applyForms.publishedVersionId })
    .from(applyCalls).leftJoin(applyForms, eq(applyForms.callId, applyCalls.id)).where(sql`${applyCalls.status} <> 'archived'`).orderBy(desc(applyCalls.updatedAt)).limit(500);
  const versions = await db.select({ formId: applyFormVersions.formId, number: applyFormVersions.number, sha256: applyFormVersions.sha256 }).from(applyFormVersions).orderBy(desc(applyFormVersions.number));
  const latest = new Map<string, { number: number; sha256: string }>();
  for (const v of versions) if (!latest.has(v.formId)) latest.set(v.formId, v);
  return rows.map(({ definition, ...r }) => {
    const def = definition as unknown as FormDef | null;
    const last = r.formId ? latest.get(r.formId) : undefined;
    return { ...r, questions: def ? def.pages.reduce((s, p) => s + p.fields.length, 0) : 0, pages: def?.pages.length ?? 0, rules: def?.rules.length ?? 0,
      version: last?.number ?? null, unpublishedChanges: !!def && (!last || last.sha256 !== defHash(def)), errors: def ? analyze(def).filter((i) => i.level === 'error').length : 0 };
  });
}

// ---------------------------------------------------------------- Custom templates
const tplMeta = z.object({ name: z.string().trim().min(2).max(120).refine((v) => !/[<>]/.test(v), 'Use plain text.'), description: z.string().trim().max(500).default(''), category: z.string().trim().max(40).regex(/^[a-z_]+$/).default('other') }).strict();

export async function listTemplates(db: DB, includeArchived = false) {
  const custom = await db.select({ id: applyFormTemplates.id, name: applyFormTemplates.name, description: applyFormTemplates.description, category: applyFormTemplates.category, version: applyFormTemplates.version,
    basedOn: applyFormTemplates.basedOn, archivedAt: applyFormTemplates.archivedAt, updatedAt: applyFormTemplates.updatedAt, definition: applyFormTemplates.definition, updatedByName: users.name })
    .from(applyFormTemplates).leftJoin(users, eq(users.id, applyFormTemplates.updatedBy)).where(includeArchived ? undefined : isNull(applyFormTemplates.archivedAt)).orderBy(applyFormTemplates.name);
  const count = (d: FormDef) => ({ pages: d.pages.length, questions: d.pages.reduce((s, p) => s + p.fields.length, 0), rules: d.rules.length });
  return [
    ...BUILT_IN_TEMPLATES.map((b) => ({ id: b.key, builtIn: true, name: b.name, description: b.description, category: b.category, version: b.version, basedOn: null, archivedAt: null, updatedAt: null, updatedByName: null, ...count(b.definition) })),
    ...custom.map(({ definition, ...c }) => ({ ...c, builtIn: false, ...count(definition as unknown as FormDef) })),
  ];
}

export async function getTemplate(db: DB, idOrKey: string) {
  const b = BUILT_IN_TEMPLATES.find((x) => x.key === idOrKey);
  if (b) return { id: b.key, builtIn: true, name: b.name, description: b.description, category: b.category, version: b.version, definition: b.definition, issues: analyze(b.definition) };
  if (!uuid.safeParse(idOrKey).success) throw new AppError(404, 'Template not found.');
  const [t] = await db.select().from(applyFormTemplates).where(eq(applyFormTemplates.id, idOrKey));
  if (!t) throw new AppError(404, 'Template not found.');
  return { ...t, builtIn: false, issues: analyze(t.definition as unknown as FormDef) };
}

/** New custom template from: a built-in or custom template (duplicate), a call's working form, or an imported file. */
export async function createTemplate(db: DB, me: Me, raw: unknown) {
  const b = z.object({ meta: tplMeta, from: z.union([z.object({ template: z.string().max(80) }).strict(), z.object({ callId: z.string().uuid() }).strict(), z.object({ data: z.unknown() }).strict()]) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Give the template a name and say what to copy.', b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  let def: FormDef, basedOn: string | null = null, how: string;
  const from = b.data.from;
  if ('template' in from) { def = (await templateDefinition(db, from.template)).def; basedOn = from.template; how = 'duplicate'; }
  else if ('callId' in from) { const f = await formOf(db, from.callId); if (!f) throw new AppError(404, 'This call has no form yet.'); def = parsed(f.definition); basedOn = `call:${from.callId}`; how = 'from_form'; }
  else { def = parsed(unwrapImport(from.data)); how = 'import'; }
  const [t] = await db.insert(applyFormTemplates).values({ ...b.data.meta, definition: parsed(def) as unknown as Record<string, unknown>, basedOn, createdBy: me.id, updatedBy: me.id }).returning();
  await audit(db, me, `apply.template.${how}`, { type: 'apply_template', id: t.id }, `Created template “${t.name}”`);
  return t;
}

export async function updateTemplate(db: DB, me: Me, id: string, raw: unknown) {
  if (!uuid.safeParse(id).success) throw new AppError(404, 'Template not found.');
  const b = z.object({ meta: tplMeta, definition: z.unknown(), version: z.number().int().min(1) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Send the template, its name and the version you loaded.');
  const def = parsed(b.data.definition);
  const [t] = await db.update(applyFormTemplates).set({ ...b.data.meta, definition: def as unknown as Record<string, unknown>, version: sql`${applyFormTemplates.version} + 1`, updatedBy: me.id, updatedAt: new Date() })
    .where(and(eq(applyFormTemplates.id, id), eq(applyFormTemplates.version, b.data.version), isNull(applyFormTemplates.archivedAt))).returning();
  if (!t) {
    const [cur] = await db.select().from(applyFormTemplates).where(eq(applyFormTemplates.id, id));
    if (!cur) throw new AppError(404, 'Template not found.');
    if (cur.archivedAt) throw new AppError(409, 'Restore this template before editing it.');
    throw new AppError(409, `Someone saved version ${cur.version} of this template after you opened it. Reload, then edit again.`);
  }
  await audit(db, me, 'apply.template.update', { type: 'apply_template', id }, `Saved template “${t.name}” as version ${t.version}`);
  return t;
}

export async function archiveTemplate(db: DB, me: Me, id: string, archive: boolean) {
  if (!uuid.safeParse(id).success) throw new AppError(404, BUILT_IN_TEMPLATES.some((x) => x.key === id) ? 'Built-in templates cannot be archived.' : 'Template not found.');
  const [t] = await db.update(applyFormTemplates).set({ archivedAt: archive ? new Date() : null, updatedBy: me.id, updatedAt: new Date() }).where(eq(applyFormTemplates.id, id)).returning();
  if (!t) throw new AppError(404, 'Template not found.');
  await audit(db, me, archive ? 'apply.template.archive' : 'apply.template.restore', { type: 'apply_template', id }, `${archive ? 'Archived' : 'Restored'} template “${t.name}”`);
  return t;
}

export async function exportTemplate(db: DB, idOrKey: string) {
  const t = await getTemplate(db, idOrKey);
  return { format: TEMPLATE_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), name: t.name, description: t.description, category: t.category, version: t.version, definition: t.definition };
}
