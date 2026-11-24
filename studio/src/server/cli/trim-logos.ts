// Trims the empty margins around every partner logo that has no crop yet (see modules/media/trim.ts), then rebuilds the
// live website so the Partners page and the homepage use the trimmed logos. Non-destructive: Reset in the crop tool undoes it.
// Usage:  npm run logos:trim
import { isNotNull } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { audit } from '../audit.ts';
import { Publisher } from '../modules/publish/service.ts';
import { trimIfUncropped } from '../modules/media/trim.ts';

const cfg = loadConfig();
const { db, close } = await openDb(cfg);
const rows = await db.select({ name: t.partners.name, logo: t.partners.logoMediaId }).from(t.partners).where(isNotNull(t.partners.logoMediaId));
const trimmed: string[] = [];
for (const r of rows) if (await trimIfUncropped(db, cfg, r.logo).catch((e) => { console.log(`${r.name}: ${(e as Error).message}`); return null; })) trimmed.push(r.name);
console.log(`Trimmed ${trimmed.length} of ${rows.length} partner logos${trimmed.length ? `: ${trimmed.join(', ')}` : ''}.`);
if (trimmed.length) {
  const log: string[] = [];
  try {
    await new Publisher(db, cfg)['rebuildFromDb'](log);
    await audit(db, null, 'site.rebuild', { type: 'site' }, 'Rebuilt the website after trimming partner logos', { logos: trimmed.length });
    console.log('Website rebuilt.');
  } catch (e) { console.log(`Rebuild failed: ${(e as Error).message}\n${log.join('\n')}`); process.exitCode = 1; }
}
await close();
