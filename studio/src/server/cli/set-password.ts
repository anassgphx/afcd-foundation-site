// Sets a Studio user's password. Usage: npm run user:password -- --email you@org [--local-only]
// The password is read from STUDIO_NEW_PASSWORD or prompted for (never passed as an argument). It must have 12+ characters,
// except with --local-only: then any password of 6+ characters is accepted, the account is marked, and the login is refused
// whenever Studio runs on a real (non-localhost) address. Setting a strong password later clears the mark. Signs the user out.
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';
import { hashPassword, isLocalOrigin, validatePasswordStrength } from '../auth/session.ts';
import { audit } from '../audit.ts';

const { values } = parseArgs({ options: { email: { type: 'string' }, 'local-only': { type: 'boolean', default: false } } });
if (!values.email) { console.error('Usage: --email you@org [--local-only]'); process.exit(1); }
const cfg = loadConfig();
const localOnly = !!values['local-only'];
if (localOnly && !isLocalOrigin(cfg.origin)) { console.error(`--local-only is refused: Studio is configured for ${cfg.origin}, not this computer.`); process.exit(1); }
let pw = process.env.STUDIO_NEW_PASSWORD;
if (!pw) { const rl = createInterface({ input: process.stdin, output: process.stdout }); pw = await rl.question(localOnly ? 'Password (local only, min 6 characters): ' : 'Password (min 12 characters): '); rl.close(); }
const weak = localOnly ? (pw.length < 6 ? 'Use at least 6 characters.' : null) : validatePasswordStrength(pw);
if (weak) { console.error(weak); process.exit(1); }
const { db, close } = await openDb(cfg);
const [u] = await db.update(users).set({ passwordHash: await hashPassword(pw), localOnlyPassword: localOnly && !!validatePasswordStrength(pw), updatedAt: new Date() })
  .where(eq(users.email, values.email.toLowerCase())).returning({ id: users.id });
if (!u) { console.error('No user with this email.'); await close(); process.exit(1); }
await db.delete(sessions).where(eq(sessions.userId, u.id));
await audit(db, null, 'users.password_cli', { type: 'user', id: u.id }, `${values.email}${localOnly ? ' (local-only password)' : ''}`);
await close();
console.log(`Password updated for ${values.email}${localOnly ? '. It works only while Studio runs on this computer.' : '.'}`);
