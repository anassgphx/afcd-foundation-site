// AFCD Apply form engine: operators, rules, navigation, calculations, answer checks and static analysis.
import { describe, it, expect } from 'vitest';
import { analyze, breakingChanges, evalCond, evaluate, validate, type Cond, type Field, type FormDef, type Op, type Rule } from '../src/server/modules/apply/engine.ts';
import { parseForm } from '../src/server/modules/apply/definition.ts';
import { BUILT_IN_TEMPLATES } from '../src/server/modules/apply/templates.ts';

const fld = (id: string, type: Field['type'], extra: Partial<Field> = {}): Field => ({ id, type, label: { en: id }, ...extra });
const choice = (id: string, values: string[], type: 'single_choice' | 'multi_choice' = 'single_choice', extra: Partial<Field> = {}) =>
  fld(id, type, { config: { options: values.map((v) => ({ value: v, label: { en: v } })) }, ...extra });
const form = (pages: [string, Field[]][], rules: Rule[] = []): FormDef => ({
  schema: 1, pages: pages.map(([id, fields]) => ({ id, title: { en: id }, fields })), rules,
  settings: { languages: ['en'], reviewStep: true, confirmation: { en: 'Thanks' } },
});
const codes = (d: FormDef) => analyze(d).map((i) => `${i.level}:${i.code}`);

describe('conditions', () => {
  const get = (a: Record<string, unknown>) => (id: string) => a[id] as never;
  const c = (field: string, op: Op, value?: string | number | boolean): Cond => ({ field, op, value });
  it('handles every operator', () => {
    const a = get({ t: 'Hello World', n: 25, s: '25', d: '2027-03-01', m: ['a', 'b'], b: false, e: '' });
    expect(evalCond(c('t', 'equals', 'hello world'), a)).toBe(true);
    expect(evalCond(c('t', 'not_equals', 'x'), a)).toBe(true);
    expect(evalCond(c('e', 'not_equals', 'x'), a)).toBe(true);
    expect(evalCond(c('e', 'equals', ''), a)).toBe(false);         // empty never "equals"
    expect(evalCond(c('t', 'contains', 'WORLD'), a)).toBe(true);
    expect(evalCond(c('n', 'gt', 24), a)).toBe(true);
    expect(evalCond(c('s', 'gte', 25), a)).toBe(true);              // numeric text compares as a number
    expect(evalCond(c('n', 'lt', 25), a)).toBe(false);
    expect(evalCond(c('n', 'lte', '25'), a)).toBe(true);
    expect(evalCond(c('t', 'gt', 1), a)).toBe(false);               // text is not a number
    expect(evalCond(c('d', 'date_before', '2027-03-02'), a)).toBe(true);
    expect(evalCond(c('d', 'date_after', '2027-03-01'), a)).toBe(false);
    expect(evalCond(c('m', 'includes', 'a'), a)).toBe(true);
    expect(evalCond(c('m', 'not_includes', 'c'), a)).toBe(true);
    expect(evalCond(c('x', 'empty'), a)).toBe(true);
    expect(evalCond(c('m', 'not_empty'), a)).toBe(true);
    expect(evalCond(c('b', 'equals', false), a)).toBe(true);
    expect(evalCond(c('b', 'not_empty'), a)).toBe(true);           // "No" is an answer
    expect(evalCond({ all: [c('n', 'gt', 1), c('b', 'equals', true)] }, a)).toBe(false);
    expect(evalCond({ any: [c('n', 'gt', 1), c('b', 'equals', true)] }, a)).toBe(true);
    expect(evalCond({ all: [] }, a)).toBe(true);
    expect(evalCond({ any: [] }, a)).toBe(false);
  });
});

describe('evaluate', () => {
  const d = form([
    ['p1', [fld('age', 'number'), fld('has_org', 'yes_no'), fld('org', 'short_text', { required: true }), fld('note', 'short_text')]],
    ['p2', [fld('budget_a', 'number'), fld('budget_b', 'number'), fld('total', 'calculated', { config: { expr: { op: 'sum', args: [{ field: 'budget_a' }, { field: 'budget_b' }] }, decimals: 2 } })]],
    ['p3', [fld('extra', 'long_text')]],
    ['p4', [fld('consent', 'consent', { required: true })]],
  ], [
    { id: 'r1', when: { field: 'has_org', op: 'equals', value: true }, then: [{ type: 'show', target: { kind: 'field', id: 'org' } }] },
    { id: 'r2', when: { field: 'age', op: 'lt', value: 18 }, then: [{ type: 'skip_to', from: 'p1', to: 'p4' }, { type: 'eligibility', result: 'ineligible', reason: { en: 'Under 18' } }] },
    { id: 'r3', when: { field: 'total', op: 'gt', value: 1000 }, then: [{ type: 'require', field: 'extra' }, { type: 'message', message: { en: 'Explain the budget' }, page: 'p3' }] },
    { id: 'r4', when: { field: 'age', op: 'gte', value: 60 }, then: [{ type: 'eligibility', result: 'needs_review', reason: { en: '60+' } }, { type: 'hide', target: { kind: 'page', id: 'p3' } }] },
  ]);

  it('shows a question only when its rule applies, and never keeps hidden answers', () => {
    let e = evaluate(d, { has_org: false, org: 'Leftover', age: 25 });
    expect(e.visibleFields.has('org')).toBe(false);
    expect(e.values.org).toBeUndefined();
    expect(e.required.has('org')).toBe(false);
    e = evaluate(d, { has_org: true, org: 'AFCD', age: 25 });
    expect(e.visibleFields.has('org')).toBe(true);
    expect(e.required.has('org')).toBe(true);
    expect(e.values.org).toBe('AFCD');
  });

  it('follows skips, and pages off the path do not count', () => {
    const e = evaluate(d, { age: 16, budget_a: 5000 });
    expect(e.path).toEqual(['p1', 'p4']);
    expect(e.values.budget_a).toBeUndefined();
    expect(e.values.total).toBeUndefined();
    expect(e.eligibility).toMatchObject({ result: 'ineligible', rules: ['r2'] });
    expect(evaluate(d, { age: 25 }).path).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(evaluate(d, { age: 65 }).path).toEqual(['p1', 'p2', 'p4']);   // hidden page is passed over
  });

  it('calculates exactly and reacts to calculated values', () => {
    const e = evaluate(d, { age: 25, budget_a: 600.1, budget_b: '400.2' });
    expect(e.values.total).toBe(1000.3);
    expect(e.required.has('extra')).toBe(true);
    expect(e.messages.map((m) => m.text.en)).toEqual(['Explain the budget']);
    expect(evaluate(d, { age: 25, budget_a: 0.1, budget_b: 0.2 }).values.total).toBe(0.3);
    expect(evaluate(d, { age: 25 }).values.total).toBe(0);   // a total of nothing is 0
    expect(evaluate(d, { age: 25 }).eligibility.result).toBe('not_assessed');
  });

  it('validates answers: the server drops what the browser should not have sent', () => {
    const v = validate(d, { age: 25, has_org: false, org: 'x', budget_a: 2000, consent: true, injected: 'nope', total: 99999 });
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.field)).toEqual(['extra']);
    expect(v.answers).not.toHaveProperty('org');
    expect(v.answers).not.toHaveProperty('injected');
    expect(v.answers.total).toBe(2000);            // recomputed, not taken from the request
    expect(validate(d, { age: 25, budget_a: 1, consent: false }).errors.map((e) => e.field)).toEqual(['consent']);
    expect(validate(d, { age: 'twenty' }, ['p1']).errors[0]).toMatchObject({ field: 'age', message: { en: 'Enter a number.' } });
  });

  it('checks each type', () => {
    const t = form([['p', [fld('e', 'email'), fld('u', 'url'), fld('ph', 'phone'), fld('dt', 'date', { config: { minDate: '2027-01-01' } }), choice('c', ['a', 'b']),
      choice('m', ['a', 'b', 'c'], 'multi_choice', { config: { options: ['a', 'b', 'c'].map((v) => ({ value: v, label: { en: v } })), maxSelected: 2 } }),
      fld('n', 'number', { config: { min: 1, max: 10, step: 1 } }), fld('s', 'short_text', { config: { minLength: 3, maxLength: 5 } }),
      fld('f', 'file', { config: { accept: ['pdf'], maxMb: 1, maxFiles: 1 } })]]]);
    const errs = validate(t, { e: 'nope', u: 'javascript:alert(1)', ph: '12', dt: '2026-12-31', c: 'z', m: ['a', 'b', 'c'], n: 2.5, s: 'ab',
      f: [{ id: 'x', name: 'a.exe', bytes: 10, mime: 'application/x-msdownload' }] }).errors.map((e) => e.field);
    expect(errs).toEqual(['e', 'u', 'ph', 'dt', 'c', 'm', 'n', 's', 'f']);
    expect(validate(t, { e: 'a@b.ma', u: 'https://afcd.ma', ph: '+212 600 000000', dt: '2027-02-30' }).errors.map((e) => e.field)).toEqual(['dt']);
    expect(validate(t, { f: [{ id: 'x', name: 'a.pdf', bytes: 2 * 1048576, mime: 'application/pdf' }] }).errors.map((e) => e.field)).toEqual(['f']);
  });
});

describe('analyze', () => {
  const base = (): [string, Field[]][] => [['p1', [fld('email', 'email'), fld('age', 'number'), choice('kind', ['a', 'b']), fld('consent', 'consent', { required: true })]], ['p2', [fld('x', 'short_text')]], ['p3', [fld('y', 'short_text')]]];

  it('accepts all built-in templates', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(parseForm(t.definition).ok, t.key).toBe(true);
      expect(analyze(t.definition).filter((i) => i.level === 'error'), t.key).toEqual([]);
    }
  });

  it('finds missing references, wrong operators and values', () => {
    expect(codes(form(base(), [{ id: 'r', when: { field: 'gone', op: 'empty' }, then: [{ type: 'hide', target: { kind: 'field', id: 'x' } }] }]))).toContain('error:missing_ref');
    expect(codes(form(base(), [{ id: 'r', when: { field: 'age', op: 'contains', value: '1' }, then: [] }]))).toContain('error:bad_op');
    expect(codes(form(base(), [{ id: 'r', when: { field: 'kind', op: 'equals', value: 'zzz' }, then: [] }]))).toContain('error:bad_value');
    expect(codes(form(base(), [{ id: 'r', when: { field: 'age', op: 'gt', value: 'old' }, then: [] }]))).toContain('error:bad_value');
    expect(codes(form(base(), [{ id: 'r', when: { field: 'age', op: 'gt' }, then: [] }]))).toContain('error:no_value');
    expect(codes(form(base(), [{ id: 'r', when: { all: [] }, then: [{ type: 'show', target: { kind: 'page', id: 'p9' } }] }]))).toContain('error:missing_target');
  });

  it('finds calculation cycles and rule cycles', () => {
    const calc = form([['p', [fld('email', 'email'), fld('a', 'calculated', { config: { expr: { op: 'sum', args: [{ field: 'b' }] } } }), fld('b', 'calculated', { config: { expr: { field: 'a' } } })]]]);
    expect(codes(calc)).toContain('error:calc_cycle');
    const loop = form([['p', [fld('email', 'email'), fld('a', 'short_text'), fld('b', 'short_text')]]], [
      { id: 'r1', when: { field: 'a', op: 'empty' }, then: [{ type: 'hide', target: { kind: 'field', id: 'b' } }] },
      { id: 'r2', when: { field: 'b', op: 'empty' }, then: [{ type: 'hide', target: { kind: 'field', id: 'a' } }] },
    ]);
    expect(codes(loop)).toContain('error:rule_cycle');
    expect(evaluate(loop, {}).path).toEqual(['p']);   // still finite at runtime
  });

  it('finds unreachable pages, backward skips and conflicts', () => {
    expect(codes(form(base(), [{ id: 'r', when: { all: [] }, then: [{ type: 'skip_to', from: 'p1', to: 'p3' }] }]))).toContain('error:unreachable');
    expect(codes(form(base(), [{ id: 'r', when: { field: 'age', op: 'gt', value: 1 }, then: [{ type: 'skip_to', from: 'p1', to: 'p3' }] }]))).not.toContain('error:unreachable');
    expect(codes(form(base(), [{ id: 'r', when: { field: 'age', op: 'gt', value: 1 }, then: [{ type: 'skip_to', from: 'p2', to: 'p1' }] }]))).toContain('error:skip_back');
    const conflict = codes(form(base(), [
      { id: 'r1', when: { field: 'age', op: 'gt', value: 1 }, then: [{ type: 'show', target: { kind: 'field', id: 'x' } }, { type: 'require', field: 'x' }] },
      { id: 'r2', when: { field: 'age', op: 'gt', value: 5 }, then: [{ type: 'hide', target: { kind: 'field', id: 'x' } }, { type: 'optional', field: 'x' }] },
    ]));
    expect(conflict.filter((c) => c === 'warning:conflict')).toHaveLength(2);
    expect(codes(form(base(), [{ id: 'r', when: { field: 'y', op: 'empty' }, then: [{ type: 'hide', target: { kind: 'field', id: 'x' } }] }]))).toContain('warning:later_ref');
  });

  it('warns about missing consent and email, and refuses duplicate IDs', () => {
    const c = codes(form([['p', [fld('a', 'short_text'), fld('a', 'number')]]]));
    expect(c).toEqual(expect.arrayContaining(['error:dup_field', 'warning:no_consent', 'warning:no_email']));
    expect(codes(form([['p', [choice('c', [])]]]))).toContain('error:no_options');
  });

  it('refuses definitions that are not plain data', () => {
    expect(parseForm({ ...form(base()), extra: 1 }).ok).toBe(false);
    const bad = form(base()); (bad.pages[0].fields[0] as any).onChange = 'alert(1)';
    expect(parseForm(bad).ok).toBe(false);
    const expr = form([['p', [fld('a', 'calculated', { config: { expr: { op: 'eval', args: ['1+1'] } as any } })]]]);
    expect(parseForm(expr).ok).toBe(false);
    expect(parseForm(form([['Bad Id', []]])).ok).toBe(false);
  });

  it('lists the changes that would break answers already given', () => {
    const a = form([['p', [choice('kind', ['a', 'b']), fld('age', 'number'), fld('note', 'short_text')]]]);
    const b = form([['p', [choice('kind', ['a']), fld('age', 'short_text'), fld('new_q', 'short_text')]]]);
    expect(breakingChanges(a, b)).toHaveLength(3);
    expect(breakingChanges(a, a)).toEqual([]);
  });
});
