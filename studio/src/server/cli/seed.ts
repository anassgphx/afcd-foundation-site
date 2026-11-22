// npm run db:seed — imports pillars, objectives and projects from the current website. Safe to run repeatedly.
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
import { seed } from '../seed.ts';
const cfg = loadConfig();
const { db, close } = await openDb(cfg);
console.log(await seed(db, cfg));
await close();
