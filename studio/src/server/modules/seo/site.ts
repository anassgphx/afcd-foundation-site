// The public website's address for everything Studio writes or checks (canonical links, JSON-LD, redirect pages,
// audits, previews). It is the canonical domain published in Settings → General, or afcdfoundation.com before
// settings are published. Read straight from seo_settings ('settings:general') so SEO code does not depend on the
// Settings module's internals.
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { seoSettings } from '../../db/schema.ts';

export const DEFAULT_SITE = 'https://afcdfoundation.com/';

/** 'https://example.org' or 'https://example.org/path' → absolute, https/http only, always ending in '/'. */
export function normSite(u?: unknown) {
  if (typeof u !== 'string' || !u.trim()) return DEFAULT_SITE;
  try { const x = new URL(u.trim()); if (!/^https?:$/.test(x.protocol)) return DEFAULT_SITE; return `${x.origin}${x.pathname.replace(/\/?$/, '/')}`; }
  catch { return DEFAULT_SITE; }
}
export async function siteUrl(db: DB) {
  const [r] = await db.select({ p: seoSettings.published }).from(seoSettings).where(eq(seoSettings.key, 'settings:general'));
  return normSite((r?.p as { canonicalUrl?: unknown } | null | undefined)?.canonicalUrl);
}
export const siteHost = (site: string) => new URL(site).hostname;
