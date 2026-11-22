// One-off check: rebuild every page from the Studio database into a temp folder and compare with the current site sources.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/server/config.ts';
import { openDb } from '../src/server/db/client.ts';
import { Publisher, realRunner } from '../src/server/modules/publish/service.ts';

const cfg = loadConfig();
const { db, close } = await openDb(cfg);
const pub = new Publisher(db, cfg);
const entries = await pub.liveEntries();
const dir = mkdtempSync(join(tmpdir(), 'studio-parity-'));
const dataFile = join(dir, 'p.json');
mkdirSync(join(dir, 'pages')); mkdirSync(join(dir, 'site'));
(pub as any).writeData(dataFile, entries);
await realRunner(cfg, { kind: 'preview', dataFile, pagesDir: join(dir, 'pages'), outDir: join(dir, 'site') });
let diffs = 0;
for (const f of readdirSync(join(dir, 'pages'))) {
  const a = readFileSync(join(dir, 'pages', f), 'utf8').replace(/ data-studio-rev="[^"]*"/g, '');
  const b = readFileSync(resolve(cfg.siteRoot, 'src/pages', f), 'utf8').replace(/ data-studio-rev="[^"]*"/g, '');
  if (a !== b) { diffs++; console.log('DIFF', f); const al=a.split('\n'), bl=b.split('\n'); for (let i=0;i<Math.max(al.length,bl.length);i++) if (al[i]!==bl[i]) { console.log(' new:', al[i]?.slice(0,260)); console.log(' old:', bl[i]?.slice(0,260)); break; } }
}
console.log(`${readdirSync(join(dir, 'pages')).length} pages compared, ${diffs} differ`);
await close();
