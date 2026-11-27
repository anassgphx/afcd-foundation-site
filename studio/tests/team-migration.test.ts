// 0034_team: the people of the About page "team" become one Team record each, without changing the About page.
import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS } from '../src/server/db/client.ts';

/** A migrations folder that stops before `idx`, to build the database as it was then. */
function upTo(idx: number) {
  const dir = mkdtempSync(join(tmpdir(), 'studio-mig-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const j = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
  j.entries = j.entries.filter((e: { idx: number }) => e.idx < idx);
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(j));
  return dir;
}

const person = (name: string, group: string, extra: Record<string, unknown> = {}) => ({ name, role: `${name} role`, group, bio: '', mediaId: null, ...extra });

describe('0034_team migration', () => {
  it('copies each person once, keeps live wording and drafts apart, and leaves the About page untouched', async () => {
    const pg = new PGlite(); const db = drizzle(pg);
    await migrate(db, { migrationsFolder: upTo(34) });
    const [{ id: mediaId }] = (await pg.query<{ id: string }>(`insert into media (original_name, storage_key, mime, width, height, bytes, alt) values ('Fake portrait.jpg', 'fakekey', 'image/jpeg', 10, 10, 1, 'Fake') returning id`)).rows;
    const published = { key: 'team', hero: { title: 'T' }, people: [person('Fake Amina', 'board', { mediaId }), person('Fake Omar', 'executive'), person('Fake Omar', 'staff'), person('Fake Leaving', 'staff')],
      sections: { board: { label: 'Board of directors', desc: 'Fake board description', show: true }, staff: { show: false } }, order: ['executive', 'board'] };
    const draft = { ...published, people: [person('Fake Amina', 'board', { mediaId, bio: 'Fake new bio' }), person('Fake Omar', 'executive'), person('Fake Omar', 'staff'), person('Fake Newcomer', 'volunteers'), person('Élodie Fake', 'volunteers')] };
    delete (draft as Record<string, unknown>).key;
    const [{ id: pageId }] = (await pg.query<{ id: string }>(`update about_pages set draft = $1, status = 'draft', published_at = '2026-11-25T10:00:00Z' where key = 'team' returning id`, [JSON.stringify(draft)])).rows;
    const [{ id: revId }] = (await pg.query<{ id: string }>(`insert into about_page_revisions (page_id, number, snapshot, reason) values ($1, 1, $2, 'imported') returning id`, [pageId, JSON.stringify(published)])).rows;
    await pg.query(`update about_pages set published_revision_id = $1 where id = $2`, [revId, pageId]);
    const before = (await pg.query(`select draft, status, published_revision_id from about_pages where key = 'team'`)).rows;

    await migrate(db, { migrationsFolder: MIGRATIONS });

    const groups = (await pg.query<{ key: string; name: string; description: string; show: boolean }>('select key, name, description, show from team_groups order by sort, key')).rows;
    expect(groups).toEqual([
      { key: 'executive', name: 'Executive team', description: '', show: true }, { key: 'board', name: 'Board of directors', description: 'Fake board description', show: true },
      { key: 'staff', name: 'Staff', description: '', show: false }, { key: 'volunteers', name: 'Volunteers & ambassadors', description: '', show: true }]);

    const rows = (await pg.query<{ id: string; slug: string; name: string; bio: string; group: string; status: string; photo: string | null; live: string | null; provenance: string }>(
      `select m.id, m.slug, m.name, m.bio, g.key as group, m.status::text as status, m.photo_media_id as photo, m.published_revision_id as live, m.provenance
       from team_members m join team_groups g on g.id = m.group_id order by m.sort`)).rows;
    expect(rows.map((r) => [r.name, r.group, r.status, !!r.live])).toEqual([
      ['Fake Amina', 'board', 'draft', true],          // live, with an unpublished bio in the draft
      ['Fake Omar', 'executive', 'published', true],
      ['Fake Omar', 'staff', 'published', true],       // a homonym stays a separate person
      ['Fake Newcomer', 'volunteers', 'draft', false], // only in the draft: not on the website
      ['Élodie Fake', 'volunteers', 'draft', false],
      ['Fake Leaving', 'staff', 'published', true],    // removed from the draft but still live: kept, and said so
    ]);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    expect(rows.map((r) => r.slug)).toEqual(expect.arrayContaining(['fake-omar', 'fake-omar-2', 'elodie-fake']));
    expect(rows[0]).toMatchObject({ bio: 'Fake new bio', photo: mediaId });
    expect(rows[0].provenance).toContain('unpublished changes');
    expect(rows[5].provenance).toContain('no longer in the page draft');

    const revs = (await pg.query<{ member_id: string; snapshot: Record<string, unknown> }>(`select member_id, snapshot from team_member_revisions order by number`)).rows;
    expect(revs).toHaveLength(4);
    expect(revs.find((r) => r.member_id === rows[0].id)!.snapshot).toMatchObject({ name: 'Fake Amina', bio: '', groupKey: 'board', photoMediaId: mediaId, email: '', links: [] });

    const [layout] = (await pg.query<{ snapshot: { groups: { key: string }[]; order: string[] }; published_at: string | null }>('select snapshot, published_at from team_layout_revisions')).rows;
    expect(layout.published_at).toBeTruthy();
    expect(layout.snapshot.groups.map((g) => g.key)).toEqual(['executive', 'board', 'staff', 'volunteers']);
    // the live order is the published page's order
    expect(layout.snapshot.order).toEqual([rows[0].id, rows[1].id, rows[2].id, rows[5].id]);

    expect((await pg.query(`select draft, status, published_revision_id from about_pages where key = 'team'`)).rows).toEqual(before);

    // rollback drops only the Team tables; migrating forward again copies the people again
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0034_team_down.sql'), 'utf8'));
    expect((await pg.query(`select to_regclass('team_members') as t`)).rows).toEqual([{ t: null }]);
    expect((await pg.query(`select draft, status, published_revision_id from about_pages where key = 'team'`)).rows).toEqual(before);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect((await pg.query<{ n: number }>('select count(*)::int as n from team_members')).rows[0].n).toBe(6);
    await pg.close();
  });

  it('works on a database whose Our Team page was never imported', async () => {
    const pg = new PGlite(); const db = drizzle(pg);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect((await pg.query<{ n: number }>('select count(*)::int as n from team_members')).rows[0].n).toBe(0);
    expect((await pg.query<{ n: number }>('select count(*)::int as n from team_groups')).rows[0].n).toBe(4);
    const [layout] = (await pg.query<{ snapshot: { order: string[] } }>('select snapshot from team_layout_revisions')).rows;
    expect(layout.snapshot.order).toEqual([]);
    await pg.close();
  });
});
