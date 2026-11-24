// Makes the website's resized copies of every Media Library image again from its original upload, with the current
// sizes and quality (e.g. after adding larger sizes for sharp full-width photos), keeping each image's crop and focal
// point. Then rebuilds the live website so pages use the new sizes.
// Usage (run it right after deploying a change to the sizes, before anyone publishes):  npm run media:rebuild
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { audit } from '../audit.ts';
import { Publisher } from '../modules/publish/service.ts';
import { cropMedia } from '../modules/media/crop.ts';
import { originalFile } from '../modules/media/library.ts';

const cfg = loadConfig();
const { db, close } = await openDb(cfg);

const rows = await db.select().from(t.media);
let done = 0; const missing: string[] = [];
for (const m of rows) {
  if (!originalFile(cfg, m)) { missing.push(m.originalName); continue; }
  await cropMedia(db, cfg, m, m.crop ?? null);   // same crop as before: only the resized copies are made again
  done++;
  process.stdout.write(`\r${done}/${rows.length} images`);
}
console.log(`\nRemade the copies of ${done} images.`);
if (missing.length) console.log(`No original file, left as they were (replace the file in the Media Library): ${missing.join(', ')}`);

const log: string[] = [];
try {
  await new Publisher(db, cfg)['rebuildFromDb'](log);
  await audit(db, null, 'site.rebuild', { type: 'site' }, 'Rebuilt the website after remaking the image sizes', { images: done });
  console.log('Website rebuilt.');
} catch (e) {
  console.error(`The website rebuild failed: ${(e as Error).message}\n${log.join('\n').slice(-4000)}`);
  await close(); process.exit(1);
}
await close();
