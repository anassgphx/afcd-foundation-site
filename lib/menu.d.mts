// Types for lib/menu.mjs (used by AFCD Studio's TypeScript code).
export function readMenus(headerHtml: string, footerHtml: string): unknown;
export function renderMenus(headerHtml: string, footerHtml: string, model: unknown): { header: string; footer: string };
export function menuLinks(model: unknown): { where: string; href: string }[];
