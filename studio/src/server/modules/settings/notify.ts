// Settings Center → Notifications: an email to chosen Studio users when new website messages arrive.
// It says how many messages and which topics, with a link to the Inbox: never names, addresses or message text, so no
// personal data leaves Studio by email. Messages in Spam do not count. At most one email per chosen interval; messages
// that arrive in between are counted in the next one. Uses the Inbox's email server (Settings → Email & SMTP).
import { and, count, eq, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { formSubmissions, seoSettings, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { can, type Role } from '../../rbac.ts';
import * as MAIL from '../inbox/mail.ts';
import { addRevision, changedKeys } from './service.ts';

type Me = NonNullable<Actor>;
const KEY = 'settings:notifications', STATE = 'settings:notifications-state';
const schema = z.object({
  newMessages: z.object({
    enabled: z.boolean(),
    recipients: z.array(z.string().uuid()).max(20),
    intervalMinutes: z.union([z.literal(15), z.literal(60), z.literal(240), z.literal(1440)]),
  }).strict(),
}).strict();
export type Notifications = z.infer<typeof schema>;
const DEFAULT: Notifications = { newMessages: { enabled: false, recipients: [], intervalMinutes: 60 } };

async function getKey<T>(db: DB, key: string): Promise<T | null> {
  const [row] = await db.select({ draft: seoSettings.draft }).from(seoSettings).where(eq(seoSettings.key, key));
  return (row?.draft as T | null) ?? null;
}
async function setKey(db: DB, key: string, value: Record<string, unknown>, by: string | null) {
  const [row] = await db.select({ key: seoSettings.key }).from(seoSettings).where(eq(seoSettings.key, key));
  if (row) await db.update(seoSettings).set({ draft: value, updatedBy: by, updatedAt: new Date() }).where(eq(seoSettings.key, key));
  else await db.insert(seoSettings).values({ key, draft: value, updatedBy: by });
}
export async function load(db: DB): Promise<Notifications> { return { ...DEFAULT, ...((await getKey<Notifications>(db, KEY)) ?? {}) }; }
type State = { lastSentAt: string | null; lastCount: number; lastError: string | null };
export async function state(db: DB): Promise<State> { return (await getKey<State>(db, STATE)) ?? { lastSentAt: null, lastCount: 0, lastError: null }; }

/** Studio users who may receive message notices: active and allowed to read the Inbox. */
export async function eligible(db: DB) {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.active, true));
  return rows.filter((u) => can(u.role as Role, 'forms.read'));
}

export async function view(db: DB, cfg: Config) {
  return { settings: await load(db), state: await state(db), people: await eligible(db), mailReady: MAIL.mailSettings(cfg).ready };
}

export async function save(db: DB, cfg: Config, me: Me, raw: unknown, restoredFrom?: string) {
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Check the notification settings.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const ok = new Set((await eligible(db)).map((u) => u.id));
  const bad = r.data.newMessages.recipients.filter((id) => !ok.has(id));
  if (bad.length) throw new AppError(422, 'Only active Studio users who can read the Inbox can receive message notices.', [{ path: 'newMessages.recipients', message: 'Not allowed' }]);
  if (r.data.newMessages.enabled && !r.data.newMessages.recipients.length) throw new AppError(422, 'Choose at least one person to notify.', [{ path: 'newMessages.recipients', message: 'Choose someone' }]);
  if (r.data.newMessages.enabled && !MAIL.mailSettings(cfg).ready) throw new AppError(422, 'Set up email sending first (Email & SMTP): notices are sent through it.', [{ path: 'newMessages.enabled', message: 'Email sending is not set up' }]);
  const cur = await load(db);
  const changed = changedKeys(cur.newMessages, r.data.newMessages);
  if (!changed.length && !restoredFrom) return view(db, cfg);
  await setKey(db, KEY, r.data, me.id);
  await addRevision(db, me, 'notifications', r.data, changed, restoredFrom);
  await audit(db, me, restoredFrom ? 'settings.restore' : 'settings.update', { type: 'settings', id: 'notifications' }, `${restoredFrom ? 'Restored' : 'Changed'} notifications: ${changed.join(', ') || 'restored'}`, { changed });
  return view(db, cfg);
}

// ---------------------------------------------------------------- Sending
async function recipients(db: DB, ids: string[]) {
  if (!ids.length) return [];
  const ok = new Set((await eligible(db)).map((u) => u.id));
  return (await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids))).filter((u) => ok.has(u.id));
}
function body(cfg: Config, total: number, topics: { topic: string; n: number }[]) {
  return [`${total} new message${total === 1 ? '' : 's'} arrived through the website.`, '',
    ...topics.map((t) => `· ${t.topic || 'No topic'}: ${t.n}`), '',
    `Open the Inbox: ${cfg.origin}/studio/inbox`, '',
    'For privacy, this email does not include names, addresses or message text.',
    'You get this because an administrator chose you in Studio → Settings → Notifications.'].join('\n');
}

/** Sends one notice if there are new non-spam contact messages since the last one and the interval has passed. */
export async function flush(db: DB, cfg: Config, now = new Date()) {
  const s = await load(db);
  if (!s.newMessages.enabled || !MAIL.mailSettings(cfg).ready) return { sent: false as const, reason: 'off' };
  const st = await state(db);
  const since = st.lastSentAt ? new Date(st.lastSentAt) : new Date(now.getTime() - 24 * 3600_000);
  if (st.lastSentAt && now.getTime() - since.getTime() < s.newMessages.intervalMinutes * 60_000) return { sent: false as const, reason: 'interval' };
  const where = and(eq(formSubmissions.formKey, 'contact'), eq(formSubmissions.spam, false), gt(formSubmissions.createdAt, since));
  const topics = (await db.select({ topic: formSubmissions.topic, n: count() }).from(formSubmissions).where(where).groupBy(formSubmissions.topic)).map((t) => ({ topic: t.topic, n: Number(t.n) }));
  const total = topics.reduce((a, t) => a + t.n, 0);
  if (!total) return { sent: false as const, reason: 'nothing' };
  const to = await recipients(db, s.newMessages.recipients);
  if (!to.length) return { sent: false as const, reason: 'no recipients' };
  const errors: string[] = [];
  for (const u of to) {
    try { await MAIL.deliver(cfg, { to: u.email, subject: `AFCD Studio: ${total} new website message${total === 1 ? '' : 's'}`, text: body(cfg, total, topics) }); }
    catch (e) { errors.push((e as Error).message.slice(0, 200)); }
  }
  await setKey(db, STATE, { lastSentAt: now.toISOString(), lastCount: total, lastError: errors[0] ?? null }, null);
  await audit(db, null, errors.length === to.length ? 'settings.notification_failed' : 'settings.notification_sent', { type: 'settings', id: 'notifications' },
    `New-message notice (${total}) to ${to.length - errors.length} of ${to.length} recipient${to.length === 1 ? '' : 's'}${errors.length ? `: ${errors[0]}` : ''}`);
  return { sent: errors.length < to.length, total, recipients: to.length, errors };
}

/** Called after the website posts a message: checks again shortly after (messages often come in bursts). */
let timer: NodeJS.Timeout | null = null;
export function afterReceive(db: DB, cfg: Config) {
  if (timer) return;
  void load(db).then((s) => {
    if (!s.newMessages.enabled || timer) return;
    timer = setTimeout(() => { timer = null; flush(db, cfg).catch((e) => console.error('[notify]', e)); }, 60_000);
    timer.unref();
  }).catch(() => { /* never block or fail the public form */ });
}
export const cancelPending = () => { if (timer) clearTimeout(timer); timer = null; };

/** A sample notice to the signed-in user, with made-up counts and no message data. */
export async function sendTest(db: DB, cfg: Config, me: Me) {
  if (!MAIL.mailSettings(cfg).ready) throw new AppError(409, 'Set up email sending first (Email & SMTP).');
  try {
    const r = await MAIL.deliver(cfg, { to: me.email, subject: 'AFCD Studio: test notification', text: `This is a test of Studio’s new-message notice. A real notice looks like this:\n\n${body(cfg, 2, [{ topic: 'Volunteering', n: 1 }, { topic: 'Partnership', n: 1 }])}` });
    await audit(db, me, 'settings.notification_test', { type: 'settings', id: 'notifications' }, 'Sent a test notification to themselves');
    return { ok: true, to: me.email, response: (r.response ?? '').slice(0, 300) };
  } catch (e) { return { ok: false, to: me.email, message: (e as Error).message.slice(0, 300) }; }
}
