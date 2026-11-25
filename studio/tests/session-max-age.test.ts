// Security review: a sliding session renewed every day must still end 7 days after sign-in.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser } from './helpers.ts';
import { sessions, users } from '../src/server/db/schema.ts';
import { createSession, validateSession, SESSION_MAX_AGE_MS } from '../src/server/auth/session.ts';

describe('session lifetime', () => {
  it('ends a session 7 days after sign-in, even while it keeps being used', async () => {
    const h = await makeApp();
    await addUser(h.db, 'editor@example.org', 'content_editor');
    const [u] = await h.db.select().from(users).where(eq(users.email, 'editor@example.org'));
    const s = await createSession(h.db, u.id, null, null);
    expect(await validateSession(h.db, s.token)).not.toBeNull();
    // signed in 7 days and 1 minute ago, still inside its sliding window
    await h.db.update(sessions).set({ createdAt: new Date(Date.now() - SESSION_MAX_AGE_MS - 60_000), expiresAt: new Date(Date.now() + 3600_000) });
    expect(await validateSession(h.db, s.token)).toBeNull();
    expect(await h.db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
    await h.close();
  });

  it('never renews a session past the cap', async () => {
    const h = await makeApp();
    await addUser(h.db, 'editor2@example.org', 'content_editor');
    const [u] = await h.db.select().from(users).where(eq(users.email, 'editor2@example.org'));
    const s = await createSession(h.db, u.id, null, null);
    const created = Date.now() - SESSION_MAX_AGE_MS + 3600_000;   // 1 hour of its 7 days left
    await h.db.update(sessions).set({ createdAt: new Date(created), expiresAt: new Date(Date.now() + 60_000) });   // due for renewal
    expect(await validateSession(h.db, s.token)).not.toBeNull();
    const [row] = await h.db.select().from(sessions);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(created + SESSION_MAX_AGE_MS);
    await h.close();
  });
});
