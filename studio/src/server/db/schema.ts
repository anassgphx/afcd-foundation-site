// AFCD Studio — PostgreSQL schema (Drizzle). SQL migrations are generated into ./drizzle with `npm run db:generate`.
import { sql } from 'drizzle-orm';
import {
  pgTable, text, integer, boolean, timestamp, jsonb, uuid, primaryKey, uniqueIndex, index, pgEnum,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- Identity
export const roleEnum = pgEnum('role', [
  'super_admin', 'website_admin', 'content_editor', 'content_reviewer', 'media_manager', 'seo_manager', 'read_only',
]);

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('read_only'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);   // emails are stored lower-cased

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),                    // sha256(token) hex — the raw token only lives in the cookie
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const loginAttempts = pgTable('login_attempts', {
  id: id(),
  email: text('email').notNull(),
  ip: text('ip'),
  success: boolean('success').notNull(),
  createdAt: createdAt(),
}, (t) => [index('login_attempts_email_time_idx').on(t.email, t.createdAt), index('login_attempts_ip_time_idx').on(t.ip, t.createdAt)]);

// ---------------------------------------------------------------- Audit (append-only)
export const auditLog = pgTable('audit_log', {
  id: id(),
  at: createdAt(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),               // e.g. project.submit, auth.login
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  summary: text('summary').notNull().default(''),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  ip: text('ip'),
}, (t) => [index('audit_at_idx').on(t.at), index('audit_entity_idx').on(t.entityType, t.entityId)]);

// ---------------------------------------------------------------- Strategy (canonical records)
export const pillars = pgTable('pillars', {
  id: id(),
  key: text('key').notNull(),                     // stable key used by the public generator, e.g. green-thumbs
  number: text('number').notNull(),               // 01..04
  name: text('name').notNull(),
  description: text('description').notNull(),
  colour: text('colour').notNull(),
  publicFile: text('public_file').notNull(),
  sort: integer('sort').notNull().default(0),
}, (t) => [uniqueIndex('pillars_key_uq').on(t.key)]);

export const objectives = pgTable('objectives', {
  id: id(),
  ref: text('ref').notNull(),                     // SO-01
  title: text('title').notNull(),
  description: text('description').notNull(),
  sort: integer('sort').notNull().default(0),
}, (t) => [uniqueIndex('objectives_ref_uq').on(t.ref)]);

export const objectivePillars = pgTable('objective_pillars', {
  objectiveId: uuid('objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  pillarId: uuid('pillar_id').notNull().references(() => pillars.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.objectiveId, t.pillarId] })]);

// ---------------------------------------------------------------- Media
export const media = pgTable('media', {
  id: id(),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull(),      // random base name, never user input
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  bytes: integer('bytes').notNull(),
  alt: text('alt').notNull().default(''),
  caption: text('caption').notNull().default(''),
  credit: text('credit').notNull().default(''),
  rightsConfirmed: boolean('rights_confirmed').notNull().default(false),  // usage rights + consent of people shown
  focalX: integer('focal_x').notNull().default(50),
  focalY: integer('focal_y').notNull().default(50),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('media_storage_uq').on(t.storageKey), index('media_created_idx').on(t.createdAt)]);

// ---------------------------------------------------------------- Projects
export const workflowEnum = pgEnum('workflow_status', [
  'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'archived',
]);

export const projects = pgTable('projects', {
  id: id(),
  slug: text('slug').notNull(),                   // public file: project-<slug>.html
  reference: text('reference').notNull().default(''),
  name: text('name').notNull(),
  category: text('category').notNull().default(''),
  summary: text('summary').notNull().default(''),
  location: text('location').notNull().default(''),
  years: text('years').notNull().default(''),
  extraFacts: jsonb('extra_facts').$type<{ label: string; value: string }[]>().notNull().default([]),
  context: text('context').notNull().default(''),
  approach: text('approach').notNull().default(''),
  activities: text('activities').notNull().default(''),
  results: text('results').notNull().default(''),
  hasDetailPage: boolean('has_detail_page').notNull().default(true),
  photoCaption: text('photo_caption').notNull().default(''),        // placeholder caption until a hero photo is set
  heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  sort: integer('sort').notNull().default(100),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('projects_slug_uq').on(t.slug), index('projects_status_idx').on(t.status)]);

export const projectPillars = pgTable('project_pillars', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pillarId: uuid('pillar_id').notNull().references(() => pillars.id, { onDelete: 'restrict' }),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.projectId, t.pillarId] })]);

export const projectObjectives = pgTable('project_objectives', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  objectiveId: uuid('objective_id').notNull().references(() => objectives.id, { onDelete: 'restrict' }),
}, (t) => [primaryKey({ columns: [t.projectId, t.objectiveId] })]);

export const projectGallery = pgTable('project_gallery', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'restrict' }),
  sort: integer('sort').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.projectId, t.mediaId] })]);

export const projectRevisions = pgTable('project_revisions', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),   // the exact public export entry
  reason: text('reason').notNull(),               // imported | submitted | approved | published | restored
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('project_revisions_num_uq').on(t.projectId, t.number)]);

export const reviewComments = pgTable('review_comments', {
  id: id(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),                   // comment | submit | request_changes | approve | publish
  body: text('body').notNull(),
  createdAt: createdAt(),
}, (t) => [index('review_comments_entity_idx').on(t.entityType, t.entityId)]);

// ---------------------------------------------------------------- Publishing jobs (delivery to the public site)
export const publishJobs = pgTable('publish_jobs', {
  id: id(),
  kind: text('kind').notNull(),                   // publish_project | unpublish_project | rebuild
  entityId: uuid('entity_id'),
  revisionId: uuid('revision_id'),
  status: text('status').notNull().default('running'),   // running | succeeded | failed
  log: text('log').notNull().default(''),
  error: text('error'),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('publish_jobs_created_idx').on(t.createdAt)]);

// ---------------------------------------------------------------- Pages (visual page builder)
export const pages = pgTable('pages', {
  id: id(),
  slug: text('slug').notNull(),                   // public file: <slug>.html
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  navSection: text('nav_section').notNull().default('none'),   // which main-menu item is highlighted
  noindex: boolean('noindex').notNull().default(false),
  doc: jsonb('doc').$type<{ version: number; blocks: unknown[] }>().notNull(),   // working copy (versioned block schema)
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('pages_slug_uq').on(t.slug), index('pages_status_idx').on(t.status)]);

export const pageRevisions = pgTable('page_revisions', {
  id: id(),
  pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),   // { slug, title, description, navSection, noindex, doc }
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('page_revisions_num_uq').on(t.pageId, t.number)]);

// ---------------------------------------------------------------- News & Stories
export const articleTypeEnum = pgEnum('article_type', ['programme_news', 'participant_story', 'call_for_applications', 'event_recap']);

export const articles = pgTable('articles', {
  id: id(),
  slug: text('slug').notNull(),                   // public file: news-<slug>.html (unless externalUrl)
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  body: text('body').notNull().default(''),       // safe rich text subset (see modules/news/render.ts)
  type: articleTypeEnum('type').notNull().default('programme_news'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  authorName: text('author_name').notNull().default(''),
  authorRole: text('author_role').notNull().default(''),
  publishDate: text('publish_date').notNull(),     // YYYY-MM-DD shown on the site
  featured: boolean('featured').notNull().default(false),
  externalUrl: text('external_url').notNull().default(''),   // legacy posts that still live on the old blog
  heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  status: workflowEnum('status').notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('articles_slug_uq').on(t.slug), index('articles_status_idx').on(t.status), index('articles_sched_idx').on(t.scheduledAt)]);

export const articlePillars = pgTable('article_pillars', {
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  pillarId: uuid('pillar_id').notNull().references(() => pillars.id, { onDelete: 'restrict' }),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.articleId, t.pillarId] })]);

export const articleProjects = pgTable('article_projects', {
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
}, (t) => [primaryKey({ columns: [t.articleId, t.projectId] })]);

export const articleGallery = pgTable('article_gallery', {
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'restrict' }),
  sort: integer('sort').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.articleId, t.mediaId] })]);

export const articleRevisions = pgTable('article_revisions', {
  id: id(),
  articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('article_revisions_num_uq').on(t.articleId, t.number)]);

// ---------------------------------------------------------------- Partners (canonical organisation records)
export const partnerScopeEnum = pgEnum('partner_scope', ['international', 'national', 'local']);

export const partners = pgTable('partners', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),            // normalised name, prevents duplicate organisations
  scope: partnerScopeEnum('scope').notNull(),
  category: text('category').notNull().default(''),   // e.g. Embassy, Foundation, Association, Public institution
  description: text('description').notNull().default(''),
  websiteUrl: text('website_url').notNull().default(''),
  sinceYear: integer('since_year'),
  current: boolean('current').notNull().default(true),   // partnership confirmed as current by AFCD
  verifiedAt: timestamp('verified_at', { withTimezone: true }),   // when AFCD last confirmed the details
  provenance: text('provenance').notNull().default(''),   // where the record came from
  logoMediaId: uuid('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
  sort: integer('sort').notNull().default(100),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('partners_slug_uq').on(t.slug), uniqueIndex('partners_name_key_uq').on(t.nameKey), index('partners_status_idx').on(t.status)]);

export const partnerProjects = pgTable('partner_projects', {
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
}, (t) => [primaryKey({ columns: [t.partnerId, t.projectId] })]);

export const partnerRevisions = pgTable('partner_revisions', {
  id: id(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('partner_revisions_num_uq').on(t.partnerId, t.number)]);

// ---------------------------------------------------------------- Events (real AFCD events only; the site's samples are not imported)
export const eventRegistrationEnum = pgEnum('event_registration', ['none', 'contact', 'external']);

export const events = pgTable('events', {
  id: id(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('Workshop'),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  startDate: text('start_date').notNull(),          // YYYY-MM-DD
  endDate: text('end_date'),                        // optional, multi-day events
  timeLabel: text('time_label').notNull().default(''),
  location: text('location').notNull().default(''),
  online: boolean('online').notNull().default(false),
  pillarId: uuid('pillar_id').references(() => pillars.id, { onDelete: 'restrict' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  posterMediaId: uuid('poster_media_id').references(() => media.id, { onDelete: 'set null' }),
  agenda: jsonb('agenda').$type<{ title: string; text: string }[]>().notNull().default([]),
  audience: jsonb('audience').$type<string[]>().notNull().default([]),
  registration: eventRegistrationEnum('registration').notNull().default('contact'),
  registrationUrl: text('registration_url').notNull().default(''),
  recapArticleId: uuid('recap_article_id').references(() => articles.id, { onDelete: 'set null' }),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('events_slug_uq').on(t.slug), index('events_status_idx').on(t.status), index('events_start_idx').on(t.startDate)]);

export const eventRevisions = pgTable('event_revisions', {
  id: id(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('event_revisions_num_uq').on(t.eventId, t.number)]);

// ---------------------------------------------------------------- Opportunities (calls for applications, volunteering, jobs, internships, consultancies)
export const opportunityTypeEnum = pgEnum('opportunity_type', ['call_for_applications', 'volunteering', 'job', 'internship', 'consultancy', 'call_for_partners']);
export const applyMethodEnum = pgEnum('apply_method', ['external', 'email', 'contact']);

export const opportunities = pgTable('opportunities', {
  id: id(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  type: opportunityTypeEnum('type').notNull().default('call_for_applications'),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  eligibility: jsonb('eligibility').$type<string[]>().notNull().default([]),
  benefits: jsonb('benefits').$type<string[]>().notNull().default([]),
  location: text('location').notNull().default(''),
  commitment: text('commitment').notNull().default(''),        // e.g. "3 months, part-time", "2 days"
  opensOn: text('opens_on'),                                    // YYYY-MM-DD, optional
  deadline: text('deadline'),                                   // YYYY-MM-DD, null = rolling
  applyMethod: applyMethodEnum('apply_method').notNull().default('external'),
  applyUrl: text('apply_url').notNull().default(''),
  applyEmail: text('apply_email').notNull().default(''),
  pillarId: uuid('pillar_id').references(() => pillars.id, { onDelete: 'restrict' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('opportunities_slug_uq').on(t.slug), index('opportunities_status_idx').on(t.status)]);

export const opportunityRevisions = pgTable('opportunity_revisions', {
  id: id(),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('opportunity_revisions_num_uq').on(t.opportunityId, t.number)]);
