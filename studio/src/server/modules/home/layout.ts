// Homepage section list (Studio V2): site sections (the page's own top-level <section>, by id) and registry blocks,
// in page order. A section's identity is its id, never its position. Site sections can move and hide; blocks can also be
// added, duplicated and removed. Unknown block types are refused; block props are validated by the registry.
import { z } from 'zod';
import { AppError } from '../../http.ts';
import { BLOCK_MAP, validateDoc, type Block } from '../pages/blocks.ts';
import { siteSections } from './fields.ts';

export type LayoutEntry =
  | { kind: 'section'; id: string; hidden: boolean }
  | { kind: 'block'; id: string; type: string; v: number; hidden: boolean; props: Record<string, unknown> };

/** Blocks offered on the homepage (a breadcrumb page header does not belong there). */
export const HOME_BLOCKS = [...BLOCK_MAP.keys()].filter((t) => t !== 'page_header');
const MAX_ITEMS = 40;

const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('section'), id: z.string().max(60), hidden: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('block'), id: z.string().regex(/^[a-z0-9]{6,24}$/), type: z.string().max(40), v: z.number().int().min(1), hidden: z.boolean().default(false), props: z.record(z.string(), z.unknown()) }).strict(),
]);

export const defaultLayout = (siteRoot: string, file: string): LayoutEntry[] => siteSections(siteRoot, file).map((s) => ({ kind: 'section', id: s.id, hidden: false }));

/** Merges a stored layout with the page as it is now: new hand-written sections appear at their source position; removed ones drop out. */
export function currentLayout(siteRoot: string, file: string, stored: unknown): LayoutEntry[] {
  const src = siteSections(siteRoot, file).map((s) => s.id);
  if (!Array.isArray(stored)) return defaultLayout(siteRoot, file);
  const list = (stored as LayoutEntry[]).filter((e) => e.kind === 'block' || src.includes(e.id));
  for (const [i, id] of src.entries()) {
    if (list.some((e) => e.kind === 'section' && e.id === id)) continue;
    const prev = src.slice(0, i).reverse().find((p) => list.some((e) => e.kind === 'section' && e.id === p));
    const at = prev ? list.findIndex((e) => e.kind === 'section' && e.id === prev) + 1 : 0;
    list.splice(at, 0, { kind: 'section', id, hidden: false });
  }
  return list;
}

/** Strict structure check for a save; returns the layout plus field problems in blocks (reported, not refused). */
export function validateLayout(siteRoot: string, file: string, raw: unknown) {
  const r = z.array(entrySchema).max(MAX_ITEMS, `Use at most ${MAX_ITEMS} sections.`).safeParse(raw);
  if (!r.success) throw new AppError(422, 'The section list is not valid.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const src = new Set(siteSections(siteRoot, file).map((s) => s.id));
  const seen = new Set<string>();
  for (const e of r.data) {
    if (seen.has(e.id)) throw new AppError(422, 'A section appears twice.');
    seen.add(e.id);
    if (e.kind === 'section' && !src.has(e.id)) throw new AppError(422, `The section “${e.id}” is no longer on the homepage.`);
    if (e.kind === 'block' && !HOME_BLOCKS.includes(e.type)) throw new AppError(422, `Unknown section type “${e.type}”.`);
  }
  const blocks = r.data.filter((e) => e.kind === 'block') as Extract<LayoutEntry, { kind: 'block' }>[];
  const { doc, problems } = validateDoc({ version: 1, blocks: blocks.map((b) => ({ id: b.id, type: b.type, v: b.v, hidden: b.hidden, props: b.props })) });
  const upgraded = new Map(doc.blocks.map((b) => [b.id, b]));
  const layout: LayoutEntry[] = r.data.map((e) => {
    if (e.kind === 'section') return e;
    const b = upgraded.get(e.id)!;
    return { kind: 'block', id: b.id, type: b.type, v: b.v, hidden: b.hidden, props: b.props as Record<string, unknown> };
  });
  return { layout, problems };
}

export const layoutBlocks = (layout: LayoutEntry[]): Block[] =>
  layout.filter((e): e is Extract<LayoutEntry, { kind: 'block' }> => e.kind === 'block').map((b) => ({ id: b.id, type: b.type, v: b.v, hidden: b.hidden, props: b.props }));
