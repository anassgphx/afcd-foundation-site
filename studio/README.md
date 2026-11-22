# AFCD Studio

Custom content management for the AFCD Foundation website. Architecture: [`docs/adr/0001-afcd-studio-architecture.md`](../docs/adr/0001-afcd-studio-architecture.md).

## What works today (Phase 1–2)

- Sign-in (Argon2id passwords, server-side sessions, CSRF protection, login rate limiting), 7 roles with server-enforced permissions.
- Dashboard with real counts from the database.
- **Projects**: create and edit (overview, content, pillars and objectives, hero photo and gallery, SEO fields), with validation.
- **Media library**: upload with server-side image validation, WebP sizes (480/960/1600), metadata stripped, alt text, caption, credit, rights and consent confirmation, focal point, reuse count.
- **Workflow**: Draft → In review → Changes requested / Approved → Published → Archived. Authors cannot approve their own work. Approval freezes a revision; later edits create a new draft without changing the live page. Older revisions can be restored as a draft.
- **Preview** with the real site templates (desktop, tablet, mobile) in an isolated folder.
- **Publishing** into the existing site pipeline (`src/data/projects.json` → `src/content.py` → `build.mjs`). Success is only recorded after the built pages are checked; a failed build restores the previous site files and is shown in Publishing. Linked pillar pages, the project listing and the sitemap update automatically.
- **Visual page builder** (Pages): create pages from templates (blank, content, campaign); add, reorder (drag or buttons), duplicate, hide and delete blocks; edit them in an inspector; see a live canvas with the real site styles at desktop, tablet and mobile width; undo/redo (⌘Z / ⇧⌘Z) and ⌘S to save. 13 approved blocks: page header, section heading, text, image, image + text, key figures, link cards, projects (live, by pillar or hand-picked), quote, questions, call to action, divider, spacer. Blocks are versioned and validated; editors cannot add HTML, CSS or scripts, links are allow-listed. Pages go through the same review and verified publishing as projects, and pages listing projects refresh when a project is published. Existing template pages and addresses are protected.
- **News & Stories**: a distraction-free writing workspace (title, summary, text with subheadings, quotes, lists, bold, italic and links), types (programme news, participant story, call for applications, event recap), topics, author, date, featured flag, linked pillars and related projects, hero photo and gallery, SEO fields. Same review workflow, plus **scheduling**: an approved story can be scheduled and Studio publishes it at that time (checked every minute while Studio runs; failures return it to Approved and show on Publishing). Each story gets its own page `news-<slug>.html` and the News & Stories listing is rebuilt from Studio. The 3 existing stories were imported as links to the old blog.
- **Partners**: one canonical record per organisation (duplicates blocked by normalised name): scope (international, national, local), type, description, https website, partner-since year, current or past, logo (requires alt text and confirmed permission), linked live projects, display order and an internal source note that is never published. Same review workflow, revisions and verified publishing. Studio writes `src/data/partners.json`, which the Studio loader beside `PARTNERS` in `src/content.py` reads. Until partner records exist, the site keeps its built-in list. The 18 organisations on the current page can be imported (Partners → Import current list, or `npm run db:seed`) with names and scope only; no details are invented.
- **Events**: real AFCD events only (the site's lorem-ipsum samples are not imported): title, type, short description, details text, date (and end date for multi-day events), time, place or online, pillar, optional project, poster (alt text and rights required), agenda, who it's for, registration (contact form, external https link, or none), recap story once it has passed, SEO fields. Same review workflow, revisions, preview and verified publishing (each event page must carry `data-studio-event-rev`). Studio writes `src/data/events.json` only while at least one event is live, so the sample calendar stays until the first real event is published, and returns if the last one is removed; stale `event-*.html` pages are removed. Events become Past after their last day (Morocco time): the running Studio checks every 15 minutes and rebuilds when that happens.
- **Opportunities**: calls for applications, volunteering, internships, jobs, consultancies and calls for partners. Real ones only; nothing is imported. Title, type, summary, description, who can apply, what you get, location, commitment, opening date and deadline (empty = rolling), how to apply (https form link, email shown publicly, or the contact form), pillar, project, image, SEO fields. Same review workflow, revisions, preview and verified publishing. Studio renders `opportunities.html` (Open, Opening soon, Closed for 12 months) and `opportunity-<slug>.html` with the site's styles; with nothing live, both are removed so there is no empty page. Closed pages show no apply button and are noindex. The running Studio rebuilds when an opportunity opens or closes (checked every 15 minutes, Morocco time).
- **Forms**: receives the website's contact form and newsletter sign-ups at `POST /forms/v1/contact` and `/forms/v1/newsletter`. This public endpoint is separate from the staff API: no cookies or sessions, CORS only for `PUBLIC_SITE_URL` and `FORMS_ALLOWED_ORIGINS`, 16 KB limit, strict validation, consent required for contact, a honeypot field and a minimum fill time (spam is kept apart and deleted after 30 days), and at most 5 sends per form per address every 10 minutes. IP addresses are never stored, only a salted hash (`FORMS_IP_SALT`, or a random salt in the data folder). Staff inbox (administrators only, as it is personal data): New / In progress / Done / Spam, topic filter, search, assign, internal notes, reply by email, permanent delete, CSV export (formula-safe), newsletter list with unsubscribe and delete. Each form can be paused, and messages are deleted after a retention period (default 365 days). The audit log records actions, never message text. No email notifications or newsletter sending yet (no provider chosen). The site posts here only when built with `FORMS_ENDPOINT`; in production that needs Studio hosted.
- **SEO**: a site audit of the built pages: titles and descriptions (missing, length, duplicates), one main heading, canonical link, image alt text, broken internal links, sitemap, sample or placeholder text, thin pages and double-escaped tags. Each page gets a score and a link to where it is edited; the last 20 audits are kept. Template pages (those no Studio record owns) take reviewed SEO settings: title, description, hide from search engines, share image, with search-result and link previews. Studio writes `src/data/seo.json` only while settings are live; `build.mjs` applies it (and adds `studio-seo-rev` for verification). Pages managed elsewhere in Studio keep their SEO fields in their own editor. `build.mjs` no longer double-escapes `&amp;` in share titles. Redirects are not included: GitHub Pages cannot serve them.
- **SEO Intelligence (V3, phases 1–2)**: audit engine v2 (`modules/seo/engine.ts`) labelled as a BUILD AUDIT of the built HTML, not the public site or Google’s view. Each finding has severity (critical, high, medium, low, info), area (technical, metadata, content, structured data, internal linking, performance), standard-check or recommendation label, evidence, why it matters, what to do, and the editor that fixes it. Wording avoids rigid character rules. Separate area scores, no single ranking score. Issues are tracked across audits (`seo_issues`): first and last seen, resolved only when an audit no longer finds them, reviewable (never critical, and reviewing never changes a score). Workspace tabs: Overview, Site audit, Issues (detail drawer), Indexability, Internal links, Structured data, Page settings, Search Console (connection state only). Not built yet: Search Console OAuth (needs Studio hosted and an AFCD Google Cloud OAuth client), public-site crawler, redirects, Core Web Vitals, AI assistant, alerts.
- **Homepage**: the hand-written homepage (`src/pages/index.html`) marks its editable parts with `data-sf="key"` (types: text, split title, rich with **highlight**, link, tail, image, plain mirror): the four hero slides (kicker, title, text, buttons, photo, chapter label), section titles and introductions, the who-we-are text, buttons and figures, the impact figures, quote and benefit text, and the get-involved band (67 fields). Studio reads the current text from the page as the default, stores only edited fields, and goes through review, revisions, preview and verified publishing (`studio-fields-rev`). Studio writes `src/data/page-fields.json` only while edits are live; `build.mjs` applies it with escaping and safe links, and always strips the markers, so an unedited homepage builds exactly as written. Website team: keep `data-sf` on elements whose text you keep; remove it with a section you remove. **Studio V2 (visual editor):** the homepage is a list of sections: its own ten hand-written sections (move, hide, edit their fields) and blocks from the section library (add, duplicate, move, hide, remove, edit), shown in a live canvas of the real page at desktop, tablet and mobile widths, with undo/redo, autosave (never while approved), conflict detection (a stale save is refused) and history with restore-as-new-draft. `lib/page-fields.mjs` composes the page for both `build.mjs` and the canvas, so the preview equals the published page. See `docs/adr/0002-studio-v2-visual-homepage.md`.
- **Passwords**: `npm run user:password -- --email …` sets a password (12+ characters; prompted or from `STUDIO_NEW_PASSWORD`) and signs the user out. With `--local-only`, a short password (6+) is allowed only while Studio is configured for localhost; the account is marked and its login is refused on any real address until a strong password is set. Stop Studio before running it.
- Append-only activity log, publishing history, users and roles.
- The 4 pillars, 6 objectives and 10 existing projects are imported from the current website (idempotent).

Not built yet (planned phases): more blocks (video, timeline, team, partners, news feed, forms, hero slider, pillar explorer), editing the existing template pages in the builder, reusable saved sections, opportunities, forms, translations, scheduling, MFA, notifications, backups automation.

## Run it locally

```bash
cd studio
npm install
cp .env.example .env          # optional, defaults work locally
npm run db:seed               # creates the local database and imports current site content
npm run user:create -- --email you@example.org --name "Your Name" --role super_admin
npm run build:admin
npm start                     # http://localhost:4400/studio/
```

Stop Studio before running `db:seed`, `db:migrate` or `user:create`: the local PGlite database must only be opened by one process at a time.

```bash
```

`user:create` asks for the password (or reads `STUDIO_NEW_PASSWORD`); it is never passed on the command line.
The public site preview is the repository root served on port 4321.

## Tests

```bash
npm test                         # auth, CSRF, permissions, full workflow, publish failure, escaping, uploads
npx tsx tests/parity-check.ts    # rebuilds every page from the database and compares with src/pages
```

## Data and backups

- Local database: `studio/.data/pg` (PGlite). Uploaded originals and image sizes: `studio/.data/media`. Both are git-ignored.
- Back up locally by stopping the Studio and copying `studio/.data`. With a PostgreSQL server (`DATABASE_URL`), use `pg_dump` plus a copy of the media folder.
- **Restore has not been tested yet.** Do not treat a backup as recoverable until a restore drill has been run (Phase 7).

## Publishing and deployment

Publishing rebuilds the website files in this repository. Putting them on the hosted site (GitHub Pages today, afcdfoundation.org later) is a separate step that needs a hosting decision and authorization; see "Open decisions" in the ADR.
