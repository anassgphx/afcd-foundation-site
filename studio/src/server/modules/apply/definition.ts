// The shape a form definition must have before Studio stores it (structure, sizes, plain text). The engine's analyze()
// then checks the meaning (references, cycles, reachability). Every object is .strict(): unknown keys are refused, so a
// definition can only ever contain data the engine understands.
import { z } from 'zod';
import { FIELD_TYPES, ID, LIMITS, type Cond, type Expr, type FormDef } from './engine.ts';

const clean = (v: string) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const txt = (n: number) => z.string().max(n).transform(clean);
export const langSchema = (n = 500) => z.object({ en: txt(n), fr: txt(n).optional(), ar: txt(n).optional() }).strict();
const id = z.string().regex(ID, 'IDs start with a letter and use a–z, 0–9 and _ (at most 40).');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean()]);

const OPS = ['equals', 'not_equals', 'contains', 'includes', 'not_includes', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty', 'date_before', 'date_after'] as const;
export const condSchema: z.ZodType<Cond> = z.lazy(() => z.union([
  z.object({ all: z.array(condSchema).max(LIMITS.condItems) }).strict(),
  z.object({ any: z.array(condSchema).max(LIMITS.condItems) }).strict(),
  z.object({ field: id, op: z.enum(OPS), value: scalar.optional() }).strict(),
])) as z.ZodType<Cond>;

export const exprSchema: z.ZodType<Expr> = z.lazy(() => z.union([
  z.number().finite(),
  z.object({ field: id }).strict(),
  z.object({ op: z.enum(['sum', 'sub', 'mul', 'div', 'min', 'max']), args: z.array(exprSchema).min(1).max(30) }).strict(),
  z.object({ op: z.literal('round'), arg: exprSchema, decimals: z.number().int().min(0).max(6).optional() }).strict(),
  z.object({ op: z.literal('count'), field: id }).strict(),
  z.object({ op: z.literal('if'), cond: condSchema, then: exprSchema, else: exprSchema }).strict(),
])) as z.ZodType<Expr>;

const configSchema = z.object({
  minLength: z.number().int().min(0).max(LIMITS.textMax).optional(), maxLength: z.number().int().min(1).max(LIMITS.textMax).optional(),
  min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().positive().max(1e9).optional(),
  minDate: date.optional(), maxDate: date.optional(),
  options: z.array(z.object({ value: z.string().trim().min(1).max(80).regex(/^[^<>]+$/), label: langSchema(300) }).strict()).max(LIMITS.options).optional(),
  minSelected: z.number().int().min(0).max(LIMITS.options).optional(), maxSelected: z.number().int().min(1).max(LIMITS.options).optional(), allowOther: z.boolean().optional(),
  accept: z.array(z.enum(['pdf', 'image', 'doc', 'sheet'])).max(4).optional(), maxMb: z.number().min(0.1).max(LIMITS.maxMb).optional(), maxFiles: z.number().int().min(1).max(LIMITS.maxFiles).optional(),
  expr: exprSchema.optional(), decimals: z.number().int().min(0).max(6).optional(), unit: txt(20).optional(),
  text: langSchema(LIMITS.textMax).optional(),
}).strict();

const fieldSchema = z.object({
  id, type: z.enum(Object.keys(FIELD_TYPES) as [keyof typeof FIELD_TYPES, ...(keyof typeof FIELD_TYPES)[]]),
  label: langSchema(500), help: langSchema(2000).optional(), required: z.boolean().optional(), config: configSchema.optional(),
  appearance: z.object({ width: z.enum(['full', 'half']).optional(), placeholder: langSchema(200).optional(), display: z.enum(['radio', 'dropdown', 'buttons', 'checkbox']).optional(), rows: z.number().int().min(2).max(20).optional() }).strict().optional(),
  private: z.boolean().optional(),
}).strict();

const target = z.object({ kind: z.enum(['field', 'page']), id }).strict();
const actionSchema = z.union([
  z.object({ type: z.enum(['show', 'hide']), target }).strict(),
  z.object({ type: z.enum(['require', 'optional']), field: id }).strict(),
  z.object({ type: z.literal('skip_to'), from: id, to: id }).strict(),
  z.object({ type: z.literal('message'), message: langSchema(1000), tone: z.enum(['info', 'warning']).optional(), page: id.optional() }).strict(),
  z.object({ type: z.literal('eligibility'), result: z.enum(['eligible', 'ineligible', 'needs_review']), reason: langSchema(500) }).strict(),
]);

export const formSchema = z.object({
  schema: z.literal(1),
  pages: z.array(z.object({ id, title: langSchema(200), description: langSchema(2000).optional(), fields: z.array(fieldSchema).max(LIMITS.fields) }).strict()).max(LIMITS.pages),
  rules: z.array(z.object({ id, name: txt(120).optional(), when: condSchema, then: z.array(actionSchema).max(LIMITS.actions) }).strict()).max(LIMITS.rules),
  settings: z.object({
    languages: z.array(z.enum(['en', 'fr', 'ar'])).min(1).max(3), reviewStep: z.boolean(), confirmation: langSchema(2000), submitLabel: langSchema(60).optional(),
  }).strict(),
}).strict().superRefine((d, ctx) => {
  const n = d.pages.reduce((s, p) => s + p.fields.length, 0);
  if (n > LIMITS.fields) ctx.addIssue({ code: 'custom', path: ['pages'], message: `A form can have at most ${LIMITS.fields} questions.` });
});

/** Parses a definition; throws a list of readable problems. */
export function parseForm(raw: unknown): { ok: true; def: FormDef } | { ok: false; issues: { path: string; message: string }[] } {
  if (JSON.stringify(raw ?? null).length > 1_000_000) return { ok: false, issues: [{ path: '', message: 'The form is too large (over 1 MB).' }] };
  const r = formSchema.safeParse(raw);
  if (!r.success) return { ok: false, issues: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) };
  return { ok: true, def: r.data as FormDef };
}
