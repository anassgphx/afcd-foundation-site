// Types for lib/urls.mjs (used by AFCD Studio's TypeScript code).
export const SECTIONS: [string, string][];
export const ABOUT: string[];
export const DEFAULT_PILLARS: string[];
export function pillarStems(root?: string): string[];
export function prettyPath(file: string, pillars?: string[]): string;
export function fileFromPath(path: string): { lang: string; file: string } | null;
export function prettifyAbsolute(text: string, site: string, pillars?: string[]): string;
export function prettifyHtml(html: string, opts: { file: string; lang?: string; site: string; pillars?: string[] }): string;
