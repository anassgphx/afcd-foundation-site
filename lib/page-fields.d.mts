// Types for lib/page-fields.mjs (used by AFCD Studio's TypeScript code).
export type LayoutItem = { section: string; hidden?: boolean } | { block: string; html: string; hidden?: boolean };
export type PageEntry = { revision?: string; fields?: Record<string, unknown>; layout?: LayoutItem[] };
export function applyFields(body: string, vals?: Record<string, unknown>): string;
export function closeIndex(html: string, tag: string, from: number): number;
export function splitSections(body: string): { parts: { id: string | null; html: string }[]; tail: string };
export function composeSections(body: string, layout: LayoutItem[] | null | undefined, wrap?: ((id: string, html: string, kind: 'section' | 'block' | 'hidden-section' | 'hidden-block') => string) | null): string;
export function renderPage(body: string, entry?: PageEntry | null): string;
