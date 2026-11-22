// Applies pending migrations (they also run automatically on start).
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
const { close } = await openDb(loadConfig());
await close();
console.log('Migrations applied.');
