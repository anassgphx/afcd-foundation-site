// Types for lib/site-settings.mjs (used by AFCD Studio's tests).
type Img = { src: string; w: number; h: number };
export type SiteSettings = {
  revision: string | null; name: string | null; canonicalUrl: string | null; environment: 'preview' | 'production' | null;
  tel: string | null; phone: string | null; general: string | null; board: string | null;
  social: Record<'facebook' | 'instagram' | 'linkedin', string>;
  themeColor: '#000000' | '#FFFFFF' | null; logo: Img | null; logoLight: Img | null; favicon: Img | null; socialImage: (Img & { alt: string }) | null;
};
export const PUBLIC_EMAILS: string[];
export function loadSiteSettings(file: string | null | undefined): SiteSettings | null;
export function applyHead(head: string, S: SiteSettings): string;
export function applyPage(html: string, S: SiteSettings): string;
export function applyOrg(org: Record<string, unknown>, S: SiteSettings, site: string): Record<string, unknown>;
