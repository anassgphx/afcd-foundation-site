// Types for lib/i18n.mjs (used by AFCD Studio's TypeScript code).
export const LANGS: Record<'fr' | 'ar', { name: string; locale: string; dir: 'ltr' | 'rtl'; draft: string; back: string }>;
/** English segment -> pages it appears on (built English pages, plus 'main.js'). */
export function collectSegments(root: string): Map<string, Set<string>> & { ctx: Map<string, string> };
export function mapText(html: string, fn: (key: string, kind: 'text' | 'attr', where: string) => string | null): string;
export function mapJs(src: string, fn: (key: string, kind: 'js') => string | null): string;
export function buildLanguages(o: { src: string; outDir: string; files: string[]; site: string; production: boolean; lastmod: (file: string) => string; noindexFiles: Set<string> }): { langs: string[]; sitemap: string[]; report: Record<string, string> };
