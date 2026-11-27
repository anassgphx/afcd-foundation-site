-- AFCD Studio: read-only database integrity check (audit 27 Nov 2026).
--
-- Why: the content tables point at their live and approved revisions (published_revision_id, approved_revision_id,
-- published_version_id) without a foreign key, so nothing in the database stops a pointer from going stale. A stale
-- pointer breaks publishing for that item. This script only reads; it changes nothing and needs no downtime.
--
-- Run on the server (the transaction is read-only and rolled back):
--   docker compose exec -T studio-pg psql -U studio -d afcd_studio -v ON_ERROR_STOP=1 < site/studio/scripts/db-integrity.sql
-- Every row of part 1 should show 0 problems. Any other number names the table and up to 1000 ids to look at; fixing
-- them is a separate, reviewed step (never run an UPDATE from here). studio/tests/db-integrity.test.ts runs both parts
-- on a test database, so the SQL stays valid as the schema changes. Generated: 78 checks.

begin transaction read only;

-- part 1: revision pointers and the statuses that depend on them
  select 'published_revision_id points to a missing revision' as check_name, 'pillars' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pillars p where p.published_revision_id is not null and not exists (select 1 from pillar_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'pillars' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pillars p where exists (select 1 from pillar_revisions r where r.id = p.published_revision_id and r.pillar_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'pillars' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pillars p where p.approved_revision_id is not null and not exists (select 1 from pillar_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'pillars' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pillars p where exists (select 1 from pillar_revisions r where r.id = p.approved_revision_id and r.pillar_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'pillars' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pillars p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'pillars' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pillars p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'projects' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from projects p where p.published_revision_id is not null and not exists (select 1 from project_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'projects' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from projects p where exists (select 1 from project_revisions r where r.id = p.published_revision_id and r.project_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'projects' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from projects p where p.approved_revision_id is not null and not exists (select 1 from project_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'projects' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from projects p where exists (select 1 from project_revisions r where r.id = p.approved_revision_id and r.project_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'projects' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from projects p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'projects' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from projects p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pages p where p.published_revision_id is not null and not exists (select 1 from page_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pages p where exists (select 1 from page_revisions r where r.id = p.published_revision_id and r.page_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pages p where p.approved_revision_id is not null and not exists (select 1 from page_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pages p where exists (select 1 from page_revisions r where r.id = p.approved_revision_id and r.page_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pages p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from pages p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'articles' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from articles p where p.published_revision_id is not null and not exists (select 1 from article_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'articles' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from articles p where exists (select 1 from article_revisions r where r.id = p.published_revision_id and r.article_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'articles' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from articles p where p.approved_revision_id is not null and not exists (select 1 from article_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'articles' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from articles p where exists (select 1 from article_revisions r where r.id = p.approved_revision_id and r.article_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'articles' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from articles p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'articles' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from articles p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'partners' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from partners p where p.published_revision_id is not null and not exists (select 1 from partner_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'partners' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from partners p where exists (select 1 from partner_revisions r where r.id = p.published_revision_id and r.partner_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'partners' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from partners p where p.approved_revision_id is not null and not exists (select 1 from partner_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'partners' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from partners p where exists (select 1 from partner_revisions r where r.id = p.approved_revision_id and r.partner_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'partners' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from partners p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'partners' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from partners p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'events' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from events p where p.published_revision_id is not null and not exists (select 1 from event_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'events' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from events p where exists (select 1 from event_revisions r where r.id = p.published_revision_id and r.event_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'events' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from events p where p.approved_revision_id is not null and not exists (select 1 from event_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'events' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from events p where exists (select 1 from event_revisions r where r.id = p.approved_revision_id and r.event_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'events' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from events p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'events' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from events p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'opportunities' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from opportunities p where p.published_revision_id is not null and not exists (select 1 from opportunity_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'opportunities' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from opportunities p where exists (select 1 from opportunity_revisions r where r.id = p.published_revision_id and r.opportunity_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'opportunities' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from opportunities p where p.approved_revision_id is not null and not exists (select 1 from opportunity_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'opportunities' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from opportunities p where exists (select 1 from opportunity_revisions r where r.id = p.approved_revision_id and r.opportunity_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'opportunities' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from opportunities p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'opportunities' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from opportunities p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'publications' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from publications p where p.published_revision_id is not null and not exists (select 1 from publication_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'publications' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from publications p where exists (select 1 from publication_revisions r where r.id = p.published_revision_id and r.publication_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'publications' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from publications p where p.approved_revision_id is not null and not exists (select 1 from publication_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'publications' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from publications p where exists (select 1 from publication_revisions r where r.id = p.approved_revision_id and r.publication_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'publications' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from publications p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'publications' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from publications p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'seo_overrides' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from seo_overrides p where p.published_revision_id is not null and not exists (select 1 from seo_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'seo_overrides' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from seo_overrides p where exists (select 1 from seo_revisions r where r.id = p.published_revision_id and r.override_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'seo_overrides' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from seo_overrides p where p.approved_revision_id is not null and not exists (select 1 from seo_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'seo_overrides' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from seo_overrides p where exists (select 1 from seo_revisions r where r.id = p.approved_revision_id and r.override_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'seo_overrides' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from seo_overrides p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'seo_overrides' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from seo_overrides p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'page_contents' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from page_contents p where p.published_revision_id is not null and not exists (select 1 from page_content_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'page_contents' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from page_contents p where exists (select 1 from page_content_revisions r where r.id = p.published_revision_id and r.content_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'page_contents' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from page_contents p where p.approved_revision_id is not null and not exists (select 1 from page_content_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'page_contents' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from page_contents p where exists (select 1 from page_content_revisions r where r.id = p.approved_revision_id and r.content_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'page_contents' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from page_contents p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'page_contents' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from page_contents p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'about_pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from about_pages p where p.published_revision_id is not null and not exists (select 1 from about_page_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'about_pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from about_pages p where exists (select 1 from about_page_revisions r where r.id = p.published_revision_id and r.page_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'about_pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from about_pages p where p.approved_revision_id is not null and not exists (select 1 from about_page_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'about_pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from about_pages p where exists (select 1 from about_page_revisions r where r.id = p.approved_revision_id and r.page_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'about_pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from about_pages p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'about_pages' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from about_pages p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'published_revision_id points to a missing revision' as check_name, 'team_members' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from team_members p where p.published_revision_id is not null and not exists (select 1 from team_member_revisions r where r.id = p.published_revision_id) limit 1000) x
union all
  select 'published_revision_id points to another item''s revision' as check_name, 'team_members' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from team_members p where exists (select 1 from team_member_revisions r where r.id = p.published_revision_id and r.member_id <> p.id) limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'team_members' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from team_members p where p.approved_revision_id is not null and not exists (select 1 from team_member_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'team_members' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from team_members p where exists (select 1 from team_member_revisions r where r.id = p.approved_revision_id and r.member_id <> p.id) limit 1000) x
union all
  select 'status published but nothing on the website' as check_name, 'team_members' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from team_members p where p.status = 'published' and p.published_revision_id is null limit 1000) x
union all
  select 'status approved but no approved revision' as check_name, 'team_members' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from team_members p where p.status = 'approved' and p.approved_revision_id is null limit 1000) x
union all
  select 'approved_revision_id points to a missing revision' as check_name, 'apply_calls' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from apply_calls p where p.approved_revision_id is not null and not exists (select 1 from apply_call_revisions r where r.id = p.approved_revision_id) limit 1000) x
union all
  select 'approved_revision_id points to another item''s revision' as check_name, 'apply_calls' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from apply_calls p where exists (select 1 from apply_call_revisions r where r.id = p.approved_revision_id and r.call_id <> p.id) limit 1000) x
union all
  select 'published_version_id points to a missing version' as check_name, 'apply_forms' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from apply_forms p where p.published_version_id is not null and not exists (select 1 from apply_form_versions r where r.id = p.published_version_id) limit 1000) x
union all
  select 'published_version_id points to another item''s version' as check_name, 'apply_forms' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from apply_forms p where exists (select 1 from apply_form_versions r where r.id = p.published_version_id and r.form_id <> p.id) limit 1000) x
union all
  select 'published_version_id points to a missing version' as check_name, 'apply_rubrics' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from apply_rubrics p where p.published_version_id is not null and not exists (select 1 from apply_rubric_versions r where r.id = p.published_version_id) limit 1000) x
union all
  select 'published_version_id points to another item''s version' as check_name, 'apply_rubrics' as table_name, count(*)::int as problems, coalesce(string_agg(x.id::text, ', ' order by x.id), '') as sample_ids
    from (select p.id from apply_rubrics p where exists (select 1 from apply_rubric_versions r where r.id = p.published_version_id and r.rubric_id <> p.id) limit 1000) x
order by problems desc, table_name, check_name;

-- part 2: items per status in each table (for the record; not a problem list)
select 'projects' as table_name, status::text as status, count(*)::int as items from projects group by status
union all select 'articles' as table_name, status::text as status, count(*)::int as items from articles group by status
union all select 'events' as table_name, status::text as status, count(*)::int as items from events group by status
union all select 'opportunities' as table_name, status::text as status, count(*)::int as items from opportunities group by status
union all select 'publications' as table_name, status::text as status, count(*)::int as items from publications group by status
union all select 'partners' as table_name, status::text as status, count(*)::int as items from partners group by status
union all select 'pillars' as table_name, status::text as status, count(*)::int as items from pillars group by status
union all select 'pages' as table_name, status::text as status, count(*)::int as items from pages group by status
union all select 'team_members' as table_name, status::text as status, count(*)::int as items from team_members group by status
union all select 'apply_calls' as table_name, status::text as status, count(*)::int as items from apply_calls group by status
order by 1, 2;

rollback;
