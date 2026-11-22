// Imports the partner list the website shows today (PARTNERS in src/content.py) as published records.
// Idempotent: organisations already in Studio (same normalised name) are skipped. Only names and scope exist in the
// source, so nothing else is invented: category, description, website and logo stay empty until AFCD adds them.
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { partners, partnerRevisions } from '../../db/schema.ts';
import { audit, type Actor } from '../../audit.ts';
import { loadPartner, nameKey, slugify, toPartnerSnapshot } from './service.ts';

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function readSitePartners(cfg: Config): { scope: string; names: string[] }[] {
  // Read the literal list, not the Studio-loaded one, so a partners.json never feeds back into the import.
  const py = `
import sys, json, os; os.environ['STUDIO_PARTNERS_JSON'] = '/nonexistent'; sys.path.insert(0, 'src'); import content as c
print(json.dumps([dict(scope=g, names=n) for g, n in c.PARTNERS]))`;
  return JSON.parse(execFileSync('python3', ['-I', '-c', py], { cwd: cfg.siteRoot, encoding: 'utf8' }));
}

export async function importPartners(db: DB, cfg: Config, actor: Actor = null, source?: { scope: string; names: string[] }[]) {
  const groups = source ?? readSitePartners(cfg);
  let imported = 0, skipped = 0, sort = 0;
  for (const g of groups) {
    const scope = g.scope.toLowerCase() as 'international' | 'national' | 'local';
    if (!['international', 'national', 'local'].includes(scope)) continue;
    for (const raw of g.names) {
      sort += 10;
      const name = unescape(raw);
      if ((await db.select({ id: partners.id }).from(partners).where(eq(partners.nameKey, nameKey(name)))).length) { skipped++; continue; }
      await db.transaction(async (tx) => {
        const t = tx as unknown as DB;
        const [p] = await t.insert(partners).values({ name, nameKey: nameKey(name), slug: slugify(name), scope, sort, status: 'published', provenance: 'Imported from the Our Partners page of the current website' }).returning();
        const snap = toPartnerSnapshot(await loadPartner(t, p.id));
        const [rev] = await t.insert(partnerRevisions).values({ partnerId: p.id, number: 1, snapshot: snap as unknown as Record<string, unknown>, reason: 'imported', createdBy: actor?.id ?? null }).returning();
        await t.update(partners).set({ publishedRevisionId: rev.id, publishedAt: new Date() }).where(eq(partners.id, p.id));
        await audit(tx, actor, 'partner.import', { type: 'partner', id: p.id }, `Imported partner “${name}” from the current website`);
      });
      imported++;
    }
  }
  return { imported, skipped };
}
