// AFCD Studio — PostgreSQL schema (Drizzle). SQL migrations are generated into ./drizzle with `npm run db:generate`.
import { sql } from 'drizzle-orm';
import {
  pgTable, text, integer, boolean, timestamp, date, jsonb, uuid, primaryKey, uniqueIndex, index, pgEnum, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- Identity
export const roleEnum = pgEnum('role', [
  'super_admin', 'website_admin', 'content_editor', 'content_reviewer', 'media_manager', 'seo_manager', 'read_only',
  'application_manager', 'application_reviewer',   // AFCD Apply (0027)
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

// "Forgot password" and links sent by an administrator. Only the SHA-256 of a link's token is stored; a row without a
// token records a request for an unknown or inactive address, so requests can be rate-limited without revealing accounts.
export const passwordResets = pgTable('password_resets', {
  id: id(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash'),
  kind: text('kind').notNull().default('forgot'),          // forgot | admin
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('password_resets_token_uq').on(t.tokenHash), index('password_resets_email_time_idx').on(t.email, t.createdAt), index('password_resets_ip_time_idx').on(t.ip, t.createdAt)]);

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
  quality: text('quality').notNull().default('best'),   // compression of the website copies: 'best' | 'balanced' | 'smaller'
  crop: jsonb('crop').$type<{ x: number; y: number; w: number; h: number } | null>(),   // crop of the original (pixels, after EXIF rotation); null = whole image
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
  activityItems: jsonb('activity_items').$type<{ title: string; text: string; when?: string; whenEnd?: string; place?: string; mediaIds: string[]; publicationSlugs?: string[] }[]>().notNull().default([]),
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
export const applyMethodEnum = pgEnum('apply_method', ['external', 'email', 'contact', 'studio']);   // studio = an AFCD Apply call (0029)

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
  applyCallId: uuid('apply_call_id').references((): AnyPgColumn => applyCalls.id, { onDelete: 'set null' }),   // AFCD Apply call (apply method "studio", 0029)
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

// ---------------------------------------------------------------- About pages (Our Story, Mission & Vision, Strategy, Team, Partners page texts)
// One row per page, with a fixed key. The working copy lives in `draft` (the page content, plain text and media ids);
// draft = null: not imported yet, the website keeps the text written in src/content.py. Published revisions are exported to
// src/data/about.json. Same workflow as every reviewed record (draft → in review → approved → published).
export const aboutPages = pgTable('about_pages', {
  id: id(),
  key: text('key').notNull(),                     // 'our-story' | 'mission-vision' | 'strategy' | 'team' | 'partners'
  draft: jsonb('draft').$type<Record<string, unknown>>(),
  provenance: text('provenance').notNull().default(''),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('about_pages_key_uq').on(t.key)]);

export const aboutPageRevisions = pgTable('about_page_revisions', {
  id: id(),
  pageId: uuid('page_id').notNull().references(() => aboutPages.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('about_page_revisions_num_uq').on(t.pageId, t.number)]);

// ---------------------------------------------------------------- AFCD Apply: calls for applications (0027, docs/adr/0004-afcd-apply.md)
// A call has its own lifecycle, run on server time: draft → in_review → approved → scheduled → open (⇄ paused) → closed →
// under_evaluation → completed → archived. Dates are stored in UTC; `time_zone` is how staff and applicants read them.
export const applyCallStatusEnum = pgEnum('apply_call_status', [
  'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'open', 'paused', 'closed', 'under_evaluation', 'completed', 'archived',
]);
export type ApplyCallI18n = Partial<Record<'fr' | 'ar', { title?: string; summary?: string; description?: string }>>;

export const applyCalls = pgTable('apply_calls', {
  id: id(),
  reference: text('reference').notNull(),                       // e.g. AFCD-2027-004, given on creation, never changes
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  description: text('description').notNull().default(''),
  i18n: jsonb('i18n').$type<ApplyCallI18n>().notNull().default({}),   // French and Arabic texts (optional)
  callType: text('call_type').notNull().default('youth_program'),
  audience: text('audience').notNull().default(''),
  eligibility: jsonb('eligibility').$type<string[]>().notNull().default([]),
  location: text('location').notNull().default(''),
  format: text('format').notNull().default('in_person'),       // in_person | online | hybrid
  language: text('language').notNull().default('en'),         // en | fr | ar | multi
  pillarId: uuid('pillar_id').references(() => pillars.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  heroMediaId: uuid('hero_media_id').references(() => media.id, { onDelete: 'set null' }),
  opensAt: timestamp('opens_at', { withTimezone: true }),
  closesAt: timestamp('closes_at', { withTimezone: true }),
  timeZone: text('time_zone').notNull().default('Africa/Casablanca'),
  places: integer('places'),                                    // null = not limited / not stated
  contactEmail: text('contact_email').notNull().default(''),
  terms: text('terms').notNull().default(''),
  privacyNotice: text('privacy_notice').notNull().default(''),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  unlisted: boolean('unlisted').notNull().default(false),      // reachable by link only: noindex, not in the sitemap
  receiptEnabled: boolean('receipt_enabled').notNull().default(false),   // email a receipt after each application (0032)
  status: applyCallStatusEnum('status').notNull().default('draft'),
  rev: integer('rev').notNull().default(1),                     // optimistic concurrency: every save must send the rev it loaded
  approvedRevisionId: uuid('approved_revision_id'),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  openedAt: timestamp('opened_at', { withTimezone: true }),     // first time it opened; after that the slug and opening are fixed
  closedAt: timestamp('closed_at', { withTimezone: true }),
  archivedFrom: applyCallStatusEnum('archived_from'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_calls_slug_uq').on(t.slug), uniqueIndex('apply_calls_reference_uq').on(t.reference),
  index('apply_calls_status_idx').on(t.status), index('apply_calls_schedule_idx').on(t.status, t.opensAt, t.closesAt)]);

export const applyCallRevisions = pgTable('apply_call_revisions', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('apply_call_revisions_num_uq').on(t.callId, t.number)]);

/** Lifecycle history of a call: status changes, extensions, reopenings, live edits. Never updated or deleted by the app. */
export const applyCallEvents = pgTable('apply_call_events', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),   // null = the scheduler (server time)
  kind: text('kind').notNull(),                                 // status | extend | reopen | edit | duplicate
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  reason: text('reason').notNull().default(''),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('apply_call_events_call_idx').on(t.callId, t.createdAt)]);

// ---------------------------------------------------------------- AFCD Apply: application forms (0028)
// One working form per call (`definition`, saved with optimistic concurrency) and immutable published versions. Every
// application will point at the exact version it was made with. A definition is JSON data only (modules/apply/engine.ts).
export const applyForms = pgTable('apply_forms', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  rev: integer('rev').notNull().default(1),
  sourceTemplate: text('source_template'),                     // built-in key or custom template id it started from
  publishedVersionId: uuid('published_version_id'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_forms_call_uq').on(t.callId)]);

export const applyFormVersions = pgTable('apply_form_versions', {
  id: id(),
  formId: uuid('form_id').notNull().references(() => applyForms.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  sha256: text('sha256').notNull(),
  note: text('note').notNull().default(''),
  publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('apply_form_versions_num_uq').on(t.formId, t.number), index('apply_form_versions_call_idx').on(t.callId)]);

/** Custom templates (the built-in ones live in code: modules/apply/templates.ts). `version` goes up on every save. */
export const applyFormTemplates = pgTable('apply_form_templates', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('other'),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  version: integer('version').notNull().default(1),
  basedOn: text('based_on'),                                   // built-in key or template id it was copied from
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('apply_form_templates_name_idx').on(t.name)]);

// ---------------------------------------------------------------- AFCD Apply: applicant drafts and private files (0029)
// Applicants are not users: a draft is reached with a random secret (only its SHA-256 is stored) that the browser keeps,
// or with a single-use, time-limited resume link sent by email (only the token's SHA-256 is stored, never the answers).
export const applyDrafts = pgTable('apply_drafts', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => applyFormVersions.id, { onDelete: 'restrict' }),   // the exact form version
  secretHash: text('secret_hash').notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  page: text('page'),
  lang: text('lang').notNull().default('en'),
  rev: integer('rev').notNull().default(1),                     // optimistic concurrency between tabs and devices
  status: text('status').notNull().default('active'),           // active | submitted
  ipHash: text('ip_hash'),                                       // salted, for rate limiting only
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('apply_drafts_call_idx').on(t.callId, t.status), index('apply_drafts_expiry_idx').on(t.status, t.expiresAt), index('apply_drafts_ip_idx').on(t.ipHash, t.createdAt)]);

/** Files applicants upload. Stored privately in <dataDir>/apply-files/<storage_key>; never in the media library, never
 *  copied to the website, no public address. The type comes from the bytes, not from the name. */
export const applyFiles = pgTable('apply_files', {
  id: id(),
  draftId: uuid('draft_id').references(() => applyDrafts.id, { onDelete: 'set null' }),
  submissionId: uuid('submission_id').references((): AnyPgColumn => applySubmissions.id, { onDelete: 'set null' }),   // set when the application is submitted (0030)
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  fieldId: text('field_id').notNull(),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull(),
  kind: text('kind').notNull(),                                  // pdf | image | doc | sheet
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('apply_files_storage_uq').on(t.storageKey), index('apply_files_draft_idx').on(t.draftId), index('apply_files_submission_idx').on(t.submissionId)]);

export const applyResumeTokens = pgTable('apply_resume_tokens', {
  id: id(),
  draftId: uuid('draft_id').notNull().references(() => applyDrafts.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  ipHash: text('ip_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('apply_resume_tokens_hash_uq').on(t.tokenHash), index('apply_resume_tokens_draft_idx').on(t.draftId, t.createdAt)]);

// ---------------------------------------------------------------- AFCD Apply: submitted applications (0030)
// One row per application, written in a single transaction when the applicant submits: the exact form version, the
// answers the server validated (hidden answers dropped, calculations recomputed), consent texts and times, and the
// automatic eligibility result with its rule version and reasons. Staff corrections are stored next to it, never over it.
export const APPLICATION_STATUSES = ['submitted', 'eligibility_review', 'under_evaluation', 'shortlisted', 'interview', 'selected', 'waitlisted', 'not_selected', 'withdrawn'] as const;
export const ELIGIBILITY = ['eligible', 'needs_review', 'ineligible', 'not_assessed'] as const;
export type EligibilityAuto = { result: (typeof ELIGIBILITY)[number]; reasons: { en: string; fr?: string; ar?: string }[]; rules: string[]; formVersion: number };
export type EligibilityOverride = { result: (typeof ELIGIBILITY)[number]; reason: string; by: string; byName: string; at: string };

export const applySubmissions = pgTable('apply_submissions', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'restrict' }),
  versionId: uuid('version_id').notNull().references(() => applyFormVersions.id, { onDelete: 'restrict' }),
  draftId: uuid('draft_id').references(() => applyDrafts.id, { onDelete: 'set null' }),
  reference: text('reference').notNull(),                       // e.g. AFCD-2027-004-0012
  idempotencyKey: text('idempotency_key').notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull(),
  applicantName: text('applicant_name').notNull().default(''),
  applicantEmail: text('applicant_email').notNull().default(''),
  lang: text('lang').notNull().default('en'),
  status: text('status').$type<(typeof APPLICATION_STATUSES)[number]>().notNull().default('submitted'),
  eligibility: text('eligibility').$type<(typeof ELIGIBILITY)[number]>().notNull().default('not_assessed'),   // effective result
  eligibilityAuto: jsonb('eligibility_auto').$type<EligibilityAuto>().notNull(),
  eligibilityOverride: jsonb('eligibility_override').$type<EligibilityOverride | null>(),
  consent: jsonb('consent').$type<{ field: string; label: string; text: string; at: string }[]>().notNull().default([]),
  ipHash: text('ip_hash'),
  // evaluation (0031): mean of final reviews in basis points (0–10000 = 0–100.00), how many, and whether reviewers disagree
  scoreBp: integer('score_bp'),
  scoreReviews: integer('score_reviews').notNull().default(0),
  disagreement: boolean('disagreement').notNull().default(false),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_submissions_reference_uq').on(t.reference), uniqueIndex('apply_submissions_draft_uq').on(t.draftId),
  uniqueIndex('apply_submissions_idem_uq').on(t.callId, t.idempotencyKey), index('apply_submissions_list_idx').on(t.callId, t.submittedAt, t.id),
  index('apply_submissions_status_idx').on(t.callId, t.status), index('apply_submissions_elig_idx').on(t.callId, t.eligibility), index('apply_submissions_time_idx').on(t.submittedAt, t.id)]);

/** History of an application: status changes, eligibility corrections, internal notes, file downloads. */
export const applySubmissionEvents = pgTable('apply_submission_events', {
  id: id(),
  submissionId: uuid('submission_id').notNull().references(() => applySubmissions.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),   // null = the applicant or the system
  kind: text('kind').notNull(),                                  // submitted | status | eligibility | note | download
  fromValue: text('from_value'),
  toValue: text('to_value'),
  body: text('body').notNull().default(''),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('apply_submission_events_sub_idx').on(t.submissionId, t.createdAt)]);

// ---------------------------------------------------------------- AFCD Apply: evaluation and decisions (0031)
// A rubric per call (working copy + immutable versions); reviewers get assignments, declare conflicts of interest before
// they see an application, and write draft then final reviews. A final review is locked; scores are computed on the
// server with integer arithmetic from the rubric version the review used. Final outcomes (selected, waitlisted, not
// selected) are proposed and then approved by someone else; nothing is sent to applicants here.
export type RubricCriterion = { id: string; label: string; description?: string; weight: number; min: number; max: number; commentRequired?: boolean };
export type RubricSettings = { mode: 'single' | 'double' | 'committee' | 'panel' | 'consensus'; reviewersPerApplication: number; blind: boolean; disagreementPoints: number };

export const applyRubrics = pgTable('apply_rubrics', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  criteria: jsonb('criteria').$type<RubricCriterion[]>().notNull().default([]),
  settings: jsonb('settings').$type<RubricSettings>().notNull(),
  rev: integer('rev').notNull().default(1),
  publishedVersionId: uuid('published_version_id'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_rubrics_call_uq').on(t.callId)]);

export const applyRubricVersions = pgTable('apply_rubric_versions', {
  id: id(),
  rubricId: uuid('rubric_id').notNull().references(() => applyRubrics.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  criteria: jsonb('criteria').$type<RubricCriterion[]>().notNull(),
  settings: jsonb('settings').$type<RubricSettings>().notNull(),
  publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('apply_rubric_versions_num_uq').on(t.rubricId, t.number)]);

export const applyAssignments = pgTable('apply_assignments', {
  id: id(),
  submissionId: uuid('submission_id').notNull().references(() => applySubmissions.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  rubricVersionId: uuid('rubric_version_id').notNull().references(() => applyRubricVersions.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('assigned'),          // assigned | conflict | in_progress | final
  coi: jsonb('coi').$type<{ hasConflict: boolean; note: string; at: string } | null>(),
  assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_assignments_pair_uq').on(t.submissionId, t.reviewerId), index('apply_assignments_reviewer_idx').on(t.reviewerId, t.status), index('apply_assignments_call_idx').on(t.callId)]);

export const applyReviews = pgTable('apply_reviews', {
  id: id(),
  assignmentId: uuid('assignment_id').notNull().references(() => applyAssignments.id, { onDelete: 'cascade' }),
  scores: jsonb('scores').$type<Record<string, number>>().notNull().default({}),
  comments: jsonb('comments').$type<Record<string, string>>().notNull().default({}),
  overallComment: text('overall_comment').notNull().default(''),
  recommendation: text('recommendation'),                        // yes | maybe | no
  totalBp: integer('total_bp'),                                  // weighted score, 0–10000, set when final
  status: text('status').notNull().default('draft'),             // draft | final
  rev: integer('rev').notNull().default(1),
  finalAt: timestamp('final_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_reviews_assignment_uq').on(t.assignmentId)]);

export const DECISION_OUTCOMES = ['selected', 'waitlisted', 'not_selected'] as const;
export const applyDecisions = pgTable('apply_decisions', {
  id: id(),
  submissionId: uuid('submission_id').notNull().references(() => applySubmissions.id, { onDelete: 'cascade' }),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  outcome: text('outcome').$type<(typeof DECISION_OUTCOMES)[number]>().notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('proposed'),         // proposed | approved | rejected | withdrawn
  proposedBy: uuid('proposed_by').references(() => users.id, { onDelete: 'set null' }),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decisionNote: text('decision_note').notNull().default(''),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),  // set by the communications step, never here
  createdAt: createdAt(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => [index('apply_decisions_call_idx').on(t.callId, t.status), index('apply_decisions_sub_idx').on(t.submissionId)]);

// ---------------------------------------------------------------- AFCD Apply: communications (0032)
// Email to applicants goes through Studio's own SMTP (inbox/mail.ts) via a queue: one message per recipient (no shared
// recipient lists), retries with backoff, delivery status, and a unique key per (purpose, application) so the same
// email is never queued twice. Decision emails can only be queued for approved decisions, by people allowed to send.
export type MessageVariant = { subject: string; body: string };
export const applyMessageTemplates = pgTable('apply_message_templates', {
  id: id(),
  callId: uuid('call_id').references(() => applyCalls.id, { onDelete: 'cascade' }),   // null = default for every call
  key: text('key').notNull(),                                    // receipt | decision_selected | decision_waitlisted | decision_not_selected
  variants: jsonb('variants').$type<Partial<Record<'en' | 'fr' | 'ar', MessageVariant>>>().notNull(),
  rev: integer('rev').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_message_templates_uq').on(t.callId, t.key)]);

export const applyMessageBatches = pgTable('apply_message_batches', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                                  // decision | custom
  count: integer('count').notNull(),
  subject: text('subject').notNull().default(''),
  queuedBy: uuid('queued_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const applyMessages = pgTable('apply_messages', {
  id: id(),
  callId: uuid('call_id').notNull().references(() => applyCalls.id, { onDelete: 'cascade' }),
  submissionId: uuid('submission_id').notNull().references(() => applySubmissions.id, { onDelete: 'cascade' }),
  decisionId: uuid('decision_id').references(() => applyDecisions.id, { onDelete: 'set null' }),
  batchId: uuid('batch_id').references(() => applyMessageBatches.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),                                  // receipt | decision | custom
  dedupeKey: text('dedupe_key').notNull(),
  toEmail: text('to_email').notNull(),
  lang: text('lang').notNull().default('en'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),                                  // rendered text (variables already filled in)
  status: text('status').notNull().default('queued'),           // queued | sending | sent | failed | cancelled
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  providerMessageId: text('provider_message_id'),
  queuedBy: uuid('queued_by').references(() => users.id, { onDelete: 'set null' }),   // null = automatic (receipt)
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('apply_messages_dedupe_uq').on(t.dedupeKey), index('apply_messages_queue_idx').on(t.status, t.nextAttemptAt),
  index('apply_messages_call_idx').on(t.callId, t.createdAt), index('apply_messages_sub_idx').on(t.submissionId)]);

// ---------------------------------------------------------------- Team (0034): the people on team.html, one record per person
// Before 0034 the people were a list inside the About page "team" (about_pages.draft.people); 0034 copied them here once and
// left that row untouched (rollback: drizzle/recovery/0034_team_down.sql). Each member has its own review workflow.
// Groups and the order of the page are a separate, lighter "layout": staff edit the working copy (team_groups, team_members.sort)
// and someone with team.publish publishes it as a team_layout_revisions row. Hiding a live member (team_members.hidden) takes
// it off the page without touching its published revision.
export type TeamLink = { kind: 'linkedin' | 'x' | 'facebook' | 'instagram' | 'website'; url: string };
export const teamGroups = pgTable('team_groups', {
  id: id(),
  key: text('key').notNull(),                         // section id on team.html (#board); never changes
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sort: integer('sort').notNull().default(100),
  show: boolean('show').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('team_groups_key_uq').on(t.key)]);

export const teamMembers = pgTable('team_members', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),                // normalised name, to warn about duplicates (homonyms are allowed)
  role: text('role').notNull().default(''),
  bio: text('bio').notNull().default(''),
  groupId: uuid('group_id').notNull().references(() => teamGroups.id, { onDelete: 'restrict' }),
  photoMediaId: uuid('photo_media_id').references(() => media.id, { onDelete: 'set null' }),
  email: text('email').notNull().default(''),        // only the foundation's public addresses may be shown
  links: jsonb('links').$type<TeamLink[]>().notNull().default([]),
  sort: integer('sort').notNull().default(100),       // working order inside the group (published with the layout)
  hidden: boolean('hidden').notNull().default(false), // live member taken off the page
  provenance: text('provenance').notNull().default(''),
  status: workflowEnum('status').notNull().default('draft'),
  publishedRevisionId: uuid('published_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('team_members_slug_uq').on(t.slug), index('team_members_status_idx').on(t.status), index('team_members_group_idx').on(t.groupId, t.sort)]);

export const teamMemberRevisions = pgTable('team_member_revisions', {
  id: id(),
  memberId: uuid('member_id').notNull().references(() => teamMembers.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('team_member_revisions_num_uq').on(t.memberId, t.number)]);

/** Groups (key, name, description, shown) and member order as published. The live one is the newest with published_at. */
export const teamLayoutRevisions = pgTable('team_layout_revisions', {
  id: id(),
  number: integer('number').notNull(),
  snapshot: jsonb('snapshot').$type<{ groups: { key: string; name: string; description: string; show: boolean }[]; order: string[] }>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (t) => [uniqueIndex('team_layout_revisions_num_uq').on(t.number)]);
