// The shared review workflow (modules/content/workflow.ts). Before: each content module had its own copy of these rules
// and of the transition function. These tests pin the shared behaviour (statuses, permissions, messages) so the modules
// adopted so far (events, partners) behave exactly as their own copies did.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { REVIEW_RULES, transitionPerm } from '../src/server/modules/content/workflow.ts';
import { eventTransitionPerm } from '../src/server/modules/events/service.ts';
import { partnerTransitionPerm } from '../src/server/modules/partners/service.ts';
import { makeApp, addUser, client } from './helpers.ts';
import { auditLog, reviewComments } from '../src/server/db/schema.ts';
import { eq } from 'drizzle-orm';

describe('review rules', () => {
  it('are the rules every module used', () => {
    expect(REVIEW_RULES).toEqual({
      submit: { from: ['draft', 'changes_requested'], to: 'in_review', needs: 'update' },
      withdraw: { from: ['in_review', 'approved'], to: 'draft', needs: 'update' },
      request_changes: { from: ['in_review'], to: 'changes_requested', needs: 'approve' },
      approve: { from: ['in_review'], to: 'approved', needs: 'approve' },
      archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', needs: 'update' },
      restore: { from: ['archived'], to: 'draft', needs: 'update' },
    });
  });
  it('map each action to the same permission as before', () => {
    expect(['submit', 'withdraw', 'request_changes', 'approve', 'archive', 'restore', 'publish', 'nope'].map(eventTransitionPerm))
      .toEqual(['event.update', 'event.update', 'event.approve', 'event.approve', 'event.update', 'event.update', undefined, undefined]);
    expect(partnerTransitionPerm('approve')).toBe('partner.approve');
    expect(transitionPerm('news', 'request_changes')).toBe('news.approve');
  });
});

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('a partner through the shared workflow', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'sa@afcd.test', 'super_admin');
  });

  it('keeps the messages, review comments, audit entries and approval fields', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test');
    const { body: p } = await ed.post('/partners', { name: 'Green Atlas Network', slug: 'green-atlas-network', scope: 'national', category: 'Association', description: 'Co-runs climate workshops.', websiteUrl: 'https://example.org', sinceYear: 2024, current: true, logoMediaId: null, projectSlugs: ['eco-citizen'], sort: 500, provenance: 'Test' });
    expect(p.id).toBeTruthy();
    const tr = (c: typeof ed, action: string, comment?: string) => c.post(`/partners/${p.id}/transition`, { action, ...(comment !== undefined ? { comment } : {}) });
    expect((await tr(ed, 'approve')).status).toBe(403);                               // editors cannot approve
    expect((await tr(rev, 'approve')).body.error).toBe('Cannot approve a partner that is draft.');
    expect((await tr(ed, 'submit')).status).toBe(200);
    expect((await tr(ed, 'approve')).status).toBe(403);
    expect((await tr(rev, 'request_changes')).body.error).toBe('Explain what needs to change.');
    expect((await tr(rev, 'request_changes', 'Add the logo.')).status).toBe(200);
    expect((await tr(ed, 'submit')).status).toBe(200);
    const ok = await tr(rev, 'approve');
    expect(ok.body).toMatchObject({ status: 'approved' }); expect(ok.body.revisionId).toBeTruthy();
    const kinds = (await h.db.select().from(reviewComments).where(eq(reviewComments.entityId, p.id))).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['submit', 'request_changes', 'approve']));
    const acts = (await h.db.select().from(auditLog)).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['partner.submit', 'partner.request_changes', 'partner.approve']));
    // a Super Administrator may approve their own submission (the self-approval rule's one exception)
    const sa = await client(h.app, 'sa@afcd.test');
    expect((await tr(ed, 'withdraw')).body).toMatchObject({ status: 'draft', revisionId: null });
    expect((await tr(sa, 'submit')).status).toBe(200);
    expect((await tr(sa, 'approve')).body).toMatchObject({ status: 'approved' });
    expect((await tr(sa, 'archive')).status).toBe(200);
    expect((await tr(sa, 'archive')).body.error).toBe('Cannot archive a partner that is archived.');
  });
});
