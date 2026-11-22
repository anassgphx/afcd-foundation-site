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
- Append-only activity log, publishing history, users and roles.
- The 4 pillars, 6 objectives and 10 existing projects are imported from the current website (idempotent).

Not built yet (planned phases): visual page builder, homepage editing, news, partners, opportunities, forms, SEO studio, translations, scheduling, MFA, notifications, backups automation.

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
