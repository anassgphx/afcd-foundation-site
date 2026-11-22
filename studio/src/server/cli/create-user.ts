// Creates a Studio user. Usage: npm run user:create -- --email you@org --name "Your Name" --role super_admin
// The password is read from the STUDIO_NEW_PASSWORD environment variable or prompted for (never passed as an argument).
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { hashPassword, validatePasswordStrength } from '../auth/session.ts';
import { ROLES, type Role } from '../rbac.ts';
import { audit } from '../audit.ts';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'content_editor' } } });
if (!values.email || !values.name) { console.error('Usage: --email --name [--role]'); process.exit(1); }
if (!ROLES.includes(values.role as Role)) { console.error(`Role must be one of: ${ROLES.join(', ')}`); process.exit(1); }
let pw = process.env.STUDIO_NEW_PASSWORD;
if (!pw) { const rl = createInterface({ input: process.stdin, output: process.stdout }); pw = await rl.question('Password (min 12 characters): '); rl.close(); }
const weak = validatePasswordStrength(pw); if (weak) { console.error(weak); process.exit(1); }
const { db, close } = await openDb(loadConfig());
const [u] = await db.insert(users).values({ email: values.email.toLowerCase(), name: values.name, role: values.role as Role, passwordHash: await hashPassword(pw) })
  .onConflictDoNothing().returning({ id: users.id });
if (!u) { console.error('A user with this email already exists.'); process.exit(1); }
await audit(db, null, 'users.create_cli', { type: 'user', id: u.id }, `${values.email} as ${values.role}`);
await close();
console.log(`Created ${values.email} (${values.role}).`);
