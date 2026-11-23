// AFCD Studio — PostgreSQL schema (Drizzle). SQL migrations are generated into ./drizzle with `npm run db:generate`.
import { sql } from 'drizzle-orm';
import {
  pgTable, text, integer, boolean, timestamp, date, jsonb, uuid, primaryKey, uniqueIndex, index, pgEnum,
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
  // Set only by `npm run user:password -- --local-only`: a short password that works only while Studio runs on localhost.
  localOnlyPassword: boolean('local_only_password').notNull().default(false),
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

// Editorial workflow shared by every reviewed record (projects, pages, news, partners, pillars, …).
export const workflowEnum = pgEnum('workflow_status', [
  'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'archived',
]);

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
  // Pillars module (0016). name/description/colour above stay the LIVE values other modules read; they change only when
  // a pillar is published. The working copy lives in `draft` (PillarSnapshot) until then. draft = null: page content
  // not imported yet, the website keeps the text written in src/content.py.
  draft: jsonb('draft').$type<Record<string, unknown>>(),
  mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
  provenance: text('provenance').notNull().default(''),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
  // 0017: the pending review is about removing the pillar from the website (its page becomes a redirect to pillars.html)
  removeRequested: boolean('remove_requested').notNull().default(false),
}, (t) => [uniqueIndex('pillars_key_uq').on(t.key)]);

export const pillarRevisions = pgTable('pillar_revisions', {
  id: id(),
  pillarId: uuid('pillar_id').notNull().references(() => pillars.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('pillar_revisions_num_uq').on(t.pillarId, t.number)]);

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
  licence: text('licence').notNull().default(''),                         // e.g. "CC BY 4.0", "AFCD own photo", "Used with permission"
  rightsExpiresOn: date('rights_expires_on', { mode: 'string' }),          // optional end of the usage right (YYYY-MM-DD)
  focalX: integer('focal_x').notNull().default(50),
  focalY: integer('focal_y').notNull().default(50),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('media_storage_uq').on(t.storageKey), index('media_created_idx').on(t.createdAt)]);

// ---------------------------------------------------------------- Projects
// workflowEnum ('workflow_status') is defined above the Strategy tables, which use it too.

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
  // project page sections (all optional, plain text; images are media ids): the programme's own objectives, outcomes
  // (optionally a short verified figure) and activities with their photos. Exported as detail.programObjectives/outcomes/activities.
  programObjectives: jsonb('program_objectives').$type<{ title: string; text: string }[]>().notNull().default([]),
  outcomes: jsonb('outcomes').$type<{ title: string; text: string; figure: string }[]>().notNull().default([]),
  activityItems: jsonb('activity_items').$type<{ title: string; text: string; mediaIds: string[] }[]>().notNull().default([]),
  context: text('context').notNull().default(''),
  approach: text('approach').notNull().default(''),
  activities: text('activities').notNull().default(''),
  results: text('results').notNull().default(''),
  hasDetailPage: boolean('has_detail_page').notNull().default(true),
  photoCaption: text('photo_caption').notNull().default(''),        // placeholder caption until a hero photo is set
  heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
  // project logo, shown in the project summary: a Media Library image and how it is framed (shape, fit, background, size)
  logoMediaId: uuid('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
  logoStyle: jsonb('logo_style').$type<{ shape: string; fit: string; bg: string; size: string }>().notNull().default({ shape: 'original', fit: 'contain', bg: 'white', size: 'm' }),
  // a square (1:1) project poster, shown whole as one of the cover tiles
  posterMediaId: uuid('poster_media_id').references(() => media.id, { onDelete: 'set null' }),
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

// ---------------------------------------------------------------- Publications (reports, studies, policy briefs, guides…; 0022)
// Real AFCD documents only; nothing is imported. Same editorial workflow; only published revisions reach the website.
export const publicationTypeEnum = pgEnum('publication_type', ['report', 'study', 'policy_brief', 'guide', 'annual_report', 'toolkit', 'other']);

// Uploaded PDF files. A row never changes: a new upload is a new row, so every revision keeps pointing at its own file.
// The file is stored as <storageKey>.pdf in <dataDir>/documents and copied to assets/documents/ when a publication goes live.
export const documents = pgTable('documents', {
  id: id(),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull(),      // random, never user input
  mime: text('mime').notNull().default('application/pdf'),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('documents_storage_uq').on(t.storageKey)]);

export const publications = pgTable('publications', {
  id: id(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  type: publicationTypeEnum('type').notNull().default('report'),
  summary: text('summary').notNull().default(''),
  abstract: text('abstract').notNull().default(''),
  publishedOn: text('published_on'),                            // YYYY-MM-DD, the date on the document
  authors: jsonb('authors').$type<string[]>().notNull().default([]),
  organisation: text('organisation').notNull().default(''),
  language: text('language').notNull().default('en'),           // language of the document: en | fr | ar | multi
  pillarIds: jsonb('pillar_ids').$type<string[]>().notNull().default([]),
  projectIds: jsonb('project_ids').$type<string[]>().notNull().default([]),
  coverMediaId: uuid('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  externalUrl: text('external_url').notNull().default(''),
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
}, (t) => [uniqueIndex('publications_slug_uq').on(t.slug), index('publications_status_idx').on(t.status)]);

export const publicationRevisions = pgTable('publication_revisions', {
  id: id(),
  publicationId: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('publication_revisions_num_uq').on(t.publicationId, t.number)]);

// ---------------------------------------------------------------- Forms / Inbox (submissions from the public site; personal data)
// Status is the reply workflow; spam, archive, read and star are separate so a message keeps its status when it is
// archived or flagged. 0015_inbox moved the old enum (new, in_progress, done, spam) to this shape.
export const SUBMISSION_STATUSES = ['new', 'in_progress', 'replied', 'closed'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const formSettings = pgTable('form_settings', {
  key: text('key').primaryKey(),                          // 'contact' | 'newsletter'
  enabled: boolean('enabled').notNull().default(true),     // accepting submissions
  retentionDays: integer('retention_days').notNull().default(365),
  closedRetentionMonths: integer('closed_retention_months'),   // delete closed messages this long after closing; null = off
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const formSubmissions = pgTable('form_submissions', {
  id: id(),
  formKey: text('form_key').notNull(),
  topic: text('topic').notNull().default(''),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
  status: text('status').$type<SubmissionStatus>().notNull().default('new'),
  spam: boolean('spam').notNull().default(false),
  spamReason: text('spam_reason'),                         // honeypot | too_fast | rate_limit | manual
  readAt: timestamp('read_at', { withTimezone: true }),    // first opened by a staff member (shared team inbox)
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  note: text('note').notNull().default(''),               // legacy single note; 0015 copied it into submission_events
  consentAt: timestamp('consent_at', { withTimezone: true }),
  ipHash: text('ip_hash'),                                 // salted hash, for rate limiting only
  page: text('page').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('form_submissions_form_idx').on(t.formKey, t.status, t.createdAt), index('form_submissions_ip_idx').on(t.ipHash, t.createdAt),
  index('form_submissions_inbox_idx').on(t.formKey, t.spam, t.archivedAt, t.readAt)]);

/** Personal star: each staff member keeps their own starred list. */
export const submissionStars = pgTable('submission_stars', {
  submissionId: uuid('submission_id').notNull().references(() => formSubmissions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.submissionId, t.userId] })]);

/** Activity on a message: internal notes (body) and changes (kind + meta). Deleted with the message. */
export const submissionEvents = pgTable('submission_events', {
  id: id(),
  submissionId: uuid('submission_id').notNull().references(() => formSubmissions.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),                            // note | status | assign | archive | unarchive | spam | not_spam | reply
  body: text('body').notNull().default(''),                // note text only
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('submission_events_sub_idx').on(t.submissionId, t.createdAt)]);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: id(),
  email: text('email').notNull(),
  status: text('status').notNull().default('subscribed'),  // 'subscribed' | 'unsubscribed'
  source: text('source').notNull().default(''),            // page it was submitted from
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('newsletter_email_uq').on(t.email)]);

// ---------------------------------------------------------------- SEO (overrides for template pages; audit results)
export const seoOverrides = pgTable('seo_overrides', {
  id: id(),
  file: text('file').notNull(),                       // e.g. 'about.html' (template pages only)
  title: text('title').notNull().default(''),         // plain text; empty = keep the page's own
  description: text('description').notNull().default(''),
  noindex: boolean('noindex').notNull().default(false),
  imageMediaId: uuid('image_media_id').references(() => media.id, { onDelete: 'set null' }),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('seo_overrides_file_uq').on(t.file)]);

export const seoRevisions = pgTable('seo_revisions', {
  id: id(),
  overrideId: uuid('override_id').notNull().references(() => seoOverrides.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('seo_revisions_num_uq').on(t.overrideId, t.number)]);

export const seoAudits = pgTable('seo_audits', {
  id: id(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Page fields (editable texts/links/images marked data-sf in hand-written pages, e.g. the homepage)
export const pageContents = pgTable('page_contents', {
  id: id(),
  file: text('file').notNull(),                                    // e.g. 'index.html'
  values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),   // only edited fields; others keep the page's own text
  // Section list (Studio V2): site sections by id and registry blocks, in page order. null = the page as written.
  layout: jsonb('layout').$type<unknown[] | null>(),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('page_contents_file_uq').on(t.file)]);

export const pageContentRevisions = pgTable('page_content_revisions', {
  id: id(),
  contentId: uuid('content_id').notNull().references(() => pageContents.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('page_content_revisions_num_uq').on(t.contentId, t.number)]);

// SEO issue tracking (audit engine v2): one row per rule + page, kept across audit runs.
export const seoIssueStatusEnum = pgEnum('seo_issue_status', ['open', 'reviewed', 'resolved']);
export const seoIssues = pgTable('seo_issues', {
  id: id(),
  code: text('code').notNull(),
  file: text('file').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  evidence: jsonb('evidence').$type<string[]>().notNull().default([]),
  status: seoIssueStatusEnum('status').notNull().default('open'),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),          // set when an audit no longer finds it (verified)
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  note: text('note').notNull().default(''),
}, (t) => [uniqueIndex('seo_issues_key_uq').on(t.code, t.file), index('seo_issues_status_idx').on(t.status, t.severity)]);

// ---------------------------------------------------------------- Redirects (static hosting: instant redirect pages + a _redirects file)
export const redirectStatusEnum = pgEnum('redirect_status', ['draft', 'active', 'disabled']);
export const redirects = pgTable('redirects', {
  id: id(),
  source: text('source').notNull(),               // e.g. 'old-page.html' (exact path, no wildcards)
  destination: text('destination').notNull(),     // internal path ('new-page.html', 'projects.html#x') or https URL
  code: integer('code').notNull().default(301),   // 301 | 302 | 307 | 308 (used by hosts that support _redirects)
  reason: text('reason').notNull().default(''),
  status: redirectStatusEnum('status').notNull().default('draft'),
  published: jsonb('published').$type<{ source: string; destination: string; code: number } | null>(),   // what the live site has; null = not live
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('redirects_source_uq').on(t.source)]);

// ---------------------------------------------------------------- SEO settings with a draft and a published value (e.g. the Organization profile)
export const seoSettings = pgTable('seo_settings', {
  key: text('key').primaryKey(),
  draft: jsonb('draft').$type<Record<string, unknown> | null>(),
  published: jsonb('published').$type<Record<string, unknown> | null>(),
  status: workflowEnum('status').notNull().default('draft'),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

// ---------------------------------------------------------------- Google connections (SEO Pro). One row per provider.
// Tokens are stored encrypted (AES-256-GCM, key from STUDIO_ENCRYPTION_KEY); they never leave the server.
export const googleConnections = pgTable('google_connections', {
  id: id(),
  provider: text('provider').notNull(),                         // 'gsc' (Search Console); 'ga4' later
  status: text('status').notNull().default('connected'),        // connected | error (needs reconnect)
  accountEmail: text('account_email'),
  scopes: text('scopes').notNull().default(''),
  property: text('property'),                                    // e.g. 'sc-domain:afcdfoundation.com' (chosen by an admin)
  permissionLevel: text('permission_level'),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessTokenEnc: text('access_token_enc'),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
  connectedBy: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncedDate: text('last_synced_date'),                      // last complete GSC day stored (YYYY-MM-DD)
  lastError: text('last_error'),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('google_connections_provider_uq').on(t.provider)]);

// OAuth authorization requests in flight: single use, 10 minutes, bound to the Studio user who started them.
export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull(),
  codeVerifierEnc: text('code_verifier_enc').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

// Search Console Search Analytics rows, one per property × day × dimension set × dimension values. Re-syncing a day
// replaces its rows (unique key), so there are no duplicates. Fields not in the dimension set are ''.
export const gscMetrics = pgTable('gsc_metrics', {
  id: id(),
  property: text('property').notNull(),
  searchType: text('search_type').notNull().default('web'),
  dims: text('dims').notNull(),                                  // 'date' | 'query' | 'page' | 'query,page' | 'country' | 'device'
  date: text('date').notNull(),                                  // YYYY-MM-DD (Google's Pacific-time day)
  query: text('query').notNull().default(''),
  page: text('page').notNull().default(''),
  country: text('country').notNull().default(''),
  device: text('device').notNull().default(''),
  clicks: integer('clicks').notNull(),
  impressions: integer('impressions').notNull(),
  ctr: text('ctr').notNull(),                                    // as returned (0–1), kept as text to avoid float drift
  position: text('position').notNull(),                          // Google's average position, not a live rank
  dataState: text('data_state').notNull().default('final'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('gsc_metrics_uq').on(t.property, t.searchType, t.dims, t.date, t.query, t.page, t.country, t.device),
  index('gsc_metrics_lookup_idx').on(t.property, t.dims, t.date),
]);

// URL Inspection API results: Google's last known (indexed) version of a URL, not a live test.
export const urlInspections = pgTable('url_inspections', {
  id: id(),
  property: text('property').notNull(),
  url: text('url').notNull(),
  verdict: text('verdict'),
  coverageState: text('coverage_state'),
  indexingState: text('indexing_state'),
  robotsTxtState: text('robots_txt_state'),
  pageFetchState: text('page_fetch_state'),
  lastCrawlTime: text('last_crawl_time'),
  googleCanonical: text('google_canonical'),
  userCanonical: text('user_canonical'),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('url_inspections_url_idx').on(t.property, t.url, t.createdAt)]);

// Background jobs (SEO Pro): progress, retries with backoff, cancellation, failure details and history.
export const seoJobs = pgTable('seo_jobs', {
  id: id(),
  kind: text('kind').notNull(),                                  // 'gsc_sync' | 'url_inspection' | ...
  status: text('status').notNull().default('queued'),           // queued | running | succeeded | failed | cancelled
  progress: integer('progress').notNull().default(0),            // 0–100
  message: text('message').notNull().default(''),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(4),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb('result').$type<Record<string, unknown>>(),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('seo_jobs_status_idx').on(t.status, t.runAfter)]);

// API calls per provider and day, to stay inside Google's quotas.
export const apiUsage = pgTable('api_usage', {
  provider: text('provider').notNull(),
  endpoint: text('endpoint').notNull(),
  day: text('day').notNull(),
  calls: integer('calls').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.provider, t.endpoint, t.day] })]);

// ---------------------------------------------------------------- Settings Center history
// Values live where they always did: seo_settings rows 'settings:<category>' (draft = saved, published = on the website)
// and, for email, the Inbox mail settings file. Each save or restore adds one row here with the non-secret values only;
// secrets (the SMTP password) are never copied into a revision, only whether one was set or changed.
export const settingsRevisions = pgTable('settings_revisions', {
  id: id(),
  category: text('category').notNull(),                          // 'general' | 'branding' | 'contact' | 'email'
  values: jsonb('values').$type<Record<string, unknown>>().notNull(),
  changed: jsonb('changed').$type<string[]>().notNull().default([]),   // field names that changed in this revision
  summary: text('summary').notNull().default(''),
  restoredFrom: uuid('restored_from'),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  createdAt: createdAt(),
}, (t) => [index('settings_revisions_cat_idx').on(t.category, t.createdAt)]);
