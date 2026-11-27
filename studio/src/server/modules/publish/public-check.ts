// Did a publish reach visitors? A delivery is checked against the site Studio built (see verifyLive), but visitors get a
// copy that a separate sync puts in the web server's folder (on the VPS, sync-site.sh, every minute). So after each
// successful delivery Studio compares the build stamp in its own robots.txt with the one the public site serves
// (written by build.mjs: "# studio-build: <hash of the pages and sitemap>"), and records what it saw in the job's log
// and the activity log. Nothing here changes the site: it only reads the two files.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { publishJobs } from '../../db/schema.ts';
import { audit, type Actor } from '../../audit.ts';

const STAMP = /^# studio-build: ([0-9a-f]{8,64})$/m;
export const stampOf = (robots: string | null) => robots?.match(STAMP)?.[1] ?? null;

/** The stamp of the site Studio last built, or null (a preview build, or a build from before stamps existed). */
export function builtStamp(cfg: Config): string | null {
  try { return stampOf(readFileSync(resolve(cfg.siteRoot, 'robots.txt'), 'utf8')); } catch { return null; }
}

/** The stamp visitors get, or null with the reason. Never cached: a CDN or browser copy would hide the real state. */
export async function publicStamp(siteUrl: string, fetcher: typeof fetch = fetch): Promise<{ stamp: string | null; error?: string }> {
  try {
    const r = await fetcher(new URL(`robots.txt?studio-check=${Date.now()}`, siteUrl), { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { stamp: null, error: `The public site answered ${r.status}.` };
    const stamp = stampOf(await r.text());
    return stamp ? { stamp } : { stamp: null, error: 'The public robots.txt has no build stamp yet.' };
  } catch (e) { return { stamp: null, error: `Could not reach the public site (${(e as Error).message}).` }; }
}

/** Only a real public address is checked: a local or test setup has no separate public copy. */
export const checksPublic = (cfg: Config) => {
  if (process.env.NODE_ENV === 'test' || process.env.STUDIO_PUBLIC_CHECK === 'off') return false;
  try { const h = new URL(cfg.publicSiteUrl).hostname; return !/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(h); } catch { return false; }
};

export type PublicState = { checked: boolean; built: string | null; live: string | null; match: boolean | null; error: string | null; at: string };

/** The state right now: does the public site serve the build Studio made? */
export async function publicState(cfg: Config, fetcher: typeof fetch = fetch): Promise<PublicState> {
  const at = new Date().toISOString(), built = builtStamp(cfg);
  if (!checksPublic(cfg)) return { checked: false, built, live: null, match: null, error: null, at };
  if (!built) return { checked: false, built, live: null, match: null, error: 'This build has no stamp to compare (built before the check existed).', at };
  const p = await publicStamp(cfg.publicSiteUrl, fetcher);
  return { checked: true, built, live: p.stamp, match: p.stamp === built, error: p.error ?? null, at };
}

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** After a successful delivery: waits up to `timeoutMs` for the public site to serve this build, then records the outcome
 *  on the job (its log) and in the activity log. Runs in the background; it never throws. */
export async function confirmPublic(db: DB, cfg: Config, jobId: string, actor: Actor, opts: { timeoutMs?: number; everyMs?: number; fetcher?: typeof fetch; wait?: Wait } = {}) {
  try {
    if (!checksPublic(cfg)) return null;
    const built = builtStamp(cfg); if (!built) return null;
    const { timeoutMs = 4 * 60_000, everyMs = 15_000, fetcher = fetch, wait = sleep } = opts;
    const started = Date.now(); let last: { stamp: string | null; error?: string } = { stamp: null };
    for (;;) {
      last = await publicStamp(cfg.publicSiteUrl, fetcher);
      if (last.stamp === built) break;
      if (builtStamp(cfg) !== built) return null;   // a newer publish replaced this build: that one is checked instead
      if (Date.now() - started >= timeoutMs) break;
      await wait(everyMs);
    }
    const ok = last.stamp === built, secs = Math.round((Date.now() - started) / 1000);
    const line = ok ? `Public site: serving this build (${built}), confirmed after ${secs}s.`
      : `Public site: NOT serving this build after ${Math.round(timeoutMs / 60_000)} min. ${last.error ?? `It serves ${last.stamp ?? 'an unknown build'} instead of ${built}.`} Visitors still see the previous version: check the site sync on the server.`;
    const [job] = await db.select({ log: publishJobs.log }).from(publishJobs).where(eq(publishJobs.id, jobId));
    if (job) await db.update(publishJobs).set({ log: `${job.log}${job.log ? '\n' : ''}${line}`.slice(-20000) }).where(eq(publishJobs.id, jobId));
    await audit(db, actor, ok ? 'publish.public_confirmed' : 'publish.public_missing', { type: 'publish_job', id: jobId }, line);
    return ok;
  } catch { return null; }
}

let cache: { at: number; value: Promise<PublicState> } | null = null;
/** publicState, shared for 30 seconds so dashboards opened by several people make one request to the public site. */
export function recentPublicState(cfg: Config): Promise<PublicState> {
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), value: publicState(cfg) };
  return cache.value;
}
