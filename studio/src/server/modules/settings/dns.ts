// Settings Center → Domain & DNS. Real lookups only, run when someone asks: the website's canonical domain (address
// records and an HTTPS request) and the email domains (MX, SPF, DMARC) of the public addresses and the SMTP sender.
// The last result is kept (seo_settings 'settings:domain-check') so the screen can show when it was checked; nothing
// is ever shown as healthy without a check behind it.
import { resolve4, resolve6, resolveMx, resolveTxt, resolveCname } from 'node:dns/promises';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { seoSettings } from '../../db/schema.ts';
import { audit, type Actor } from '../../audit.ts';
import { AppError } from '../../http.ts';
import * as MAIL from '../inbox/mail.ts';
import { loadRows } from './service.ts';

export type DnsProbe = {
  a: (h: string) => Promise<string[]>; aaaa: (h: string) => Promise<string[]>; cname: (h: string) => Promise<string[]>;
  mx: (h: string) => Promise<{ exchange: string; priority: number }[]>; txt: (h: string) => Promise<string[][]>;
  https: (url: string) => Promise<{ status: number; location: string | null; ms: number }>;
};
const realProbe: DnsProbe = {
  a: resolve4, aaaa: resolve6, cname: resolveCname, mx: resolveMx, txt: resolveTxt,
  https: async (url) => {
    const t0 = Date.now();
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'AFCD-Studio-domain-check' } });
    return { status: r.status, location: r.headers.get('location'), ms: Date.now() - t0 };
  },
};
let probe = realProbe;
export const setDnsProbe = (p: DnsProbe | null) => { probe = p ?? realProbe; };

type Check = { id: string; label: string; ok: boolean | null; detail: string };
const KEY = 'settings:domain-check';
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;
const none = (e: unknown) => ['ENODATA', 'ENOTFOUND', 'ESERVFAIL'].includes((e as NodeJS.ErrnoException).code ?? '');

async function websiteChecks(host: string, url: string): Promise<Check[]> {
  const out: Check[] = [];
  const [a, aaaa, cname] = await Promise.all([probe.a(host).catch((e) => e as Error), probe.aaaa(host).catch((e) => e as Error), probe.cname(host).catch(() => [] as string[])]);
  const v4 = Array.isArray(a) ? a : [], v6 = Array.isArray(aaaa) ? aaaa : [];
  out.push({ id: 'address', label: 'Domain points to a server', ok: v4.length + v6.length > 0,
    detail: v4.length + v6.length ? [...v4, ...v6].slice(0, 4).join(', ') + (cname.length ? ` (via ${cname[0]})` : '') : `No address record: ${a instanceof Error ? code(a) : 'none'}` });
  if (v4.length + v6.length) {
    try {
      const r = await probe.https(url);
      const redirect = r.status >= 300 && r.status < 400;
      out.push({ id: 'https', label: 'Site answers over HTTPS', ok: r.status < 400, detail: `HTTP ${r.status} in ${r.ms} ms${redirect && r.location ? ` → ${r.location}` : ''}` });
    } catch (e) { out.push({ id: 'https', label: 'Site answers over HTTPS', ok: false, detail: `No answer: ${(e as Error).name === 'TimeoutError' ? 'timed out after 8 s' : code(e)}` }); }
  }
  return out;
}
async function mailChecks(domain: string): Promise<Check[]> {
  const out: Check[] = [];
  try { const mx = (await probe.mx(domain)).sort((a, b) => a.priority - b.priority); out.push({ id: 'mx', label: 'Receives email (MX)', ok: mx.length > 0, detail: mx.length ? mx.slice(0, 3).map((m) => m.exchange).join(', ') : 'No MX record' }); }
  catch (e) { out.push({ id: 'mx', label: 'Receives email (MX)', ok: false, detail: none(e) ? 'No MX record' : code(e) }); }
  try {
    const spf = (await probe.txt(domain)).map((r) => r.join('')).filter((t) => /^v=spf1\b/i.test(t));
    out.push({ id: 'spf', label: 'SPF record', ok: spf.length === 1, detail: spf.length === 1 ? spf[0].slice(0, 200) : spf.length ? `${spf.length} SPF records (there must be exactly one)` : 'No SPF record: other servers may treat mail from this domain as spam' });
  } catch (e) { out.push({ id: 'spf', label: 'SPF record', ok: false, detail: none(e) ? 'No SPF record' : code(e) }); }
  try {
    const d = (await probe.txt(`_dmarc.${domain}`)).map((r) => r.join('')).find((t) => /^v=DMARC1\b/i.test(t));
    out.push({ id: 'dmarc', label: 'DMARC policy', ok: !!d, detail: d ? `${/(^|;)\s*p=none\b/i.test(d) ? 'Monitoring only (p=none): receivers are not asked to reject failing mail. ' : ''}${d.slice(0, 200)}` : 'No DMARC record' });
  } catch (e) { out.push({ id: 'dmarc', label: 'DMARC policy', ok: false, detail: none(e) ? 'No DMARC record' : code(e) }); }
  return out;
}

/** Runs every check now and stores the result. */
export async function run(db: DB, cfg: Config, me: NonNullable<Actor>) {
  const rows = await loadRows(db);
  const url = rows.general.draft.canonicalUrl; const host = new URL(url).hostname;
  const mailDomains = [...new Set(['afcdteam.com', MAIL.mailSettings(cfg).fromEmail.split('@')[1]].filter((x): x is string => !!x && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x)).map((x) => x.toLowerCase()))];
  const groups = [
    { id: 'website', title: host, role: 'Website (canonical domain)', checks: await websiteChecks(host, url) },
    ...(await Promise.all(mailDomains.map(async (d) => ({ id: `mail:${d}`, title: d, role: d === 'afcdteam.com' ? 'Public email addresses' : 'SMTP sender address', checks: await mailChecks(d) })))),
  ];
  const result = { checkedAt: new Date().toISOString(), checkedBy: me.email, groups };
  const [row] = await db.select({ key: seoSettings.key }).from(seoSettings).where(eq(seoSettings.key, KEY));
  if (row) await db.update(seoSettings).set({ draft: result, updatedBy: me.id, updatedAt: new Date() }).where(eq(seoSettings.key, KEY));
  else await db.insert(seoSettings).values({ key: KEY, draft: result, updatedBy: me.id });
  const failed = groups.flatMap((g) => g.checks).filter((c) => c.ok === false).length;
  await audit(db, me, 'settings.domain_check', { type: 'settings', id: 'domain' }, `Checked DNS for ${groups.map((g) => g.title).join(', ')}: ${failed ? `${failed} problem${failed === 1 ? '' : 's'}` : 'no problems'}`);
  return result;
}
export async function last(db: DB) {
  const [row] = await db.select({ draft: seoSettings.draft }).from(seoSettings).where(eq(seoSettings.key, KEY));
  return (row?.draft as Awaited<ReturnType<typeof run>> | null) ?? null;
}
let running = false;
/** One check at a time, at most every 20 seconds. */
let lastRun = 0;
export async function runGuarded(db: DB, cfg: Config, me: NonNullable<Actor>) {
  if (running || Date.now() - lastRun < 20_000) throw new AppError(429, 'A check just ran. Wait a few seconds.');
  running = true; lastRun = Date.now();
  try { return await run(db, cfg, me); } finally { running = false; }
}
export const resetGuard = () => { running = false; lastRun = 0; };
