# ADR 0004 — AFCD Apply (calls for applications and form builder)

Status: **accepted**, phases 1–5 built (2026-11-26, not yet committed or deployed). The user agreed to the recommended
answers to questions 2–5 below; question 1 (does the brief continue after section 27?) and question 6 are still open.
Public call pages use `apply-<slug>.html`, served as `/apply/<slug>` by the clean-address scheme (lib/urls.mjs).
Built since: migrations 0027–0031; still to do: communications (applicant emails, queue), applicant accounts, exports
(CSV/XLSX/PDF), analytics, retention/deletion of applications.
Date: 2026-11-26
Scope: the brief "AFCD APPLY — Ultimate Call for Applications & Smart Form Builder" (27 sections; the text received stops inside section 27).

## 1. Audit: what exists today (checked in the code on `feature/afcd-studio`, 870b424 + uncommitted work)

| Area | Finding | Consequence for Apply |
|---|---|---|
| Server | One Hono app (`studio/src/server/app.ts`), staff API under `/studio/api/*`, admin SPA under `/studio/*`. Modules in `modules/<name>/{service,routes,render}.ts`. | Apply is one more module, `modules/apply/`, registered like `registerInboxRoutes` / `registerPublicationRoutes`. |
| Database | Drizzle 0.45 on Postgres 17 in production (`DATABASE_URL`), PGlite locally and in tests. Migrations `drizzle/0000`–`0026` run on start. Since 0015 each has a rollback in `drizzle/recovery/NNNN_*_down.sql`, tested in `tests/inbox.test.ts`. | New tables in the same database. Additive migrations only, each with a down file and a test. No second database. |
| Staff auth | Argon2id passwords, SHA-256-hashed session tokens, cookie `studio_session` scoped to `path=/studio`, SameSite=Strict, CSRF header + Origin check on `/studio/api/*`, DB-backed login throttling. | Reused as-is for staff. Applicants never get a `users` row or a `studio_session`. |
| Roles | `rbac.ts`: 7 roles in the `role` pg enum, a static permission list, `perm()` middleware / `requirePerm()`. The admin UI only mirrors server checks (`useCan`). | Add `apply.*` permissions and two roles (see §2.8). Reviewer access is also row-level (assigned only), enforced in services, not only by `perm()`. |
| Audit | Append-only `audit_log` via `audit()`; never stores message text or addresses. | Every lifecycle change, extension, decision, download and export goes through `audit()`. |
| Opportunities | `opportunities` table (type `call_for_applications`, eligibility list, opens/deadline as `YYYY-MM-DD` text, `apply_method` = external / email / contact), editorial workflow (`workflow_status`), revisions, published to `opportunity-<slug>.html` + `opportunities.html`. | Keep it as the public "listing" of every kind of opportunity. A call can be linked from an opportunity (new apply method `studio`), so nothing is listed twice (§2.2). |
| Public forms | `POST /forms/v1/:key` outside `/studio`, CORS limited to the site origin + `FORMS_ALLOWED_ORIGINS`, 16 KB body limit, zod `.strict()` schemas, honeypot / timing / salted-IP rate limit, spam kept not dropped. The site only talks to it when the build sets `<meta name="afcd-forms">` from `FORMS_ENDPOINT`. | The applicant API follows the same pattern: `/apply/v1/*`, same CORS rule and the same meta switch. Without it the page says applications are not connected and never pretends to submit. |
| Inbox | `form_submissions`, `submission_events` (notes/status/reply history), per-user stars, retention per form. | Patterns reused (events timeline, retention). Applications get their own tables: they are versioned and far richer than a contact message. |
| Email | `inbox/mail.ts`: SMTP settings in `<dataDir>/mail-settings.json`, password AES-256-GCM encrypted, `deliver()` + `setSender()` (tests swap in a recorder), branded `compose()` that escapes every value, hourly limit on replies. | Apply calls `deliver()` + `compose()`; it adds a queue table and retries, it does not configure SMTP again. Tests use `setSender()` only: no real email is sent in testing. |
| Jobs | `seo_jobs` + `jobs/service.ts`: idempotent enqueue by key, atomic claim, backoff 1/5/25/60 min, stale-job recovery; `index.ts` ticks every 10 s (jobs) and 60 s (scheduled publishing). | Scheduled opening/closing and the email queue run on these ticks with server time. |
| Files | Media Library = public images (`<dataDir>/media`, copied to the site). Publications `documents` = PDFs in `<dataDir>/documents`, checked on the bytes (`pdfProblem`), copied to `assets/documents/` only when published. | Applicant uploads get a **separate private folder and table**: never Media, never copied to the site, no public URL (§2.6). `pdfProblem` is reused for PDF checks. |
| Publishing | `Publisher` (`publish/service.ts`): `writeSite()` writes page sources into `src/pages`, runs `content.py` + `build.mjs`, then `verify*()` reads the built file for a `data-studio-*-rev` marker before the DB status changes; preview builds go to `.preview`. | Apply pages are written by a `writeApply()` step and verified the same way (`data-studio-apply-rev`). |
| Public site | Flat files only: `src/pages/*.html` → `<file>.html` at the root (`project-*`, `event-*`, `opportunity-*`, `publication-*`). `build.mjs` adds head/header/footer, canonical, robots, OG, JSON-LD, sitemap, fr/ar copies; non-production builds are `noindex`. `assets/main.js` is the only script (vanilla). Production: `sync-site.sh` copies the Studio-built site to Caddy every minute. | Route `apply-<slug>.html` fits the pipeline with no build.mjs routing change. `/apply/<slug>` would need directory output, sitemap and i18n changes in build.mjs (§2.3). |
| Admin UI | React 19 + Vite, `Sidebar.tsx` NAV groups filtered by permission, `DataTable.tsx`, native HTML5 drag-and-drop already used in Builder/Menus/Home (no DnD library). | "Applications" sidebar group; builder uses native drag-and-drop + keyboard move buttons. No new UI framework. |
| Dependencies | hono, drizzle, pg, pglite, zod 4, argon2, sharp, nodemailer, tiptap. | Release 1 adds **no dependency**. XLSX/PDF export (later phase) may add one maintained library, decided then. |

## 2. Decisions

### 2.1 One module inside Studio
`studio/src/server/modules/apply/` with sub-files per area: `calls`, `forms` (definition, field registry), `logic` (pure engine), `public` (applicant API), `submissions`, `files`, `eligibility`, `review`, `comms`, `exports`, `dashboard`. Same database, same staff login, same audit log, same publisher, same SMTP. No form platform (Google Forms, Jotform, Typeform, WordPress…) is installed.

### 2.2 Calls are their own record; Opportunities link to them
A call has a lifecycle Opportunities do not have (Open, Closed, Under Evaluation…), versioned forms and submissions that must never be invalidated. So: table `apply_calls` with the brief's fields and its own lifecycle. An opportunity of type *Call for applications* can choose the new apply method **"AFCD Apply"** and pick a call; its page then shows an *Apply* button to `apply-<slug>.html` and the call's real status and deadline. The enum value is added with `ALTER TYPE … ADD VALUE` (non-destructive). Existing opportunities are untouched.

### 2.3 Public route: `apply-<slug>.html`
Same convention as every other generated page, so canonical, sitemap, fr/ar copies and `noindex` handling work unchanged. Only published calls in Open/Closed/Under Evaluation/Completed are written; Draft…Scheduled calls are never written to the site, and a call marked *unlisted* gets `noindex: true` and no sitemap entry. If you prefer `/apply/<slug>`, it is possible but needs a build.mjs change (directory output + i18n + sitemap) owned by the build.

### 2.4 Declarative form definition, versioned
- `apply_forms` holds the working definition (JSON) with an integer `rev` for optimistic concurrency (save sends the `rev` it loaded; a mismatch returns 409, so two editors never overwrite each other).
- Publishing a form creates an immutable `apply_form_versions` row (definition + SHA-256). Each submission and draft points at the exact version.
- After a call has submissions, a new version may add fields or change texts, but removing a field, changing its type, or narrowing its options/validation is refused for answers already received (the server diffs versions). Old submissions always render with their own version.
- The definition is data only: fields, pages, rules, calculations as JSON validated by zod. Nothing is ever `eval`'d or run as code; there is no string expression language.

**Field registry** (`forms/fields.ts`): each type declares its config schema, its answer schema and its renderer key. Release 1 types: short text, long text, email, phone, number, date, single choice (radio / dropdown), multiple choice, yes/no, consent, file upload, statement (static text), page break/section, calculated (read-only). Later: matrix/rating, repeatable group (e.g. budget lines), country/region lists, address, signature. Every label/help text has `en` (required), `fr` and `ar`; Arabic renders `dir="rtl"`.

### 2.5 Logic engine shared by the browser and the server
`logic/engine.ts` is one pure TypeScript module with no imports, compiled once into `assets/apply.js` for the website (by a Studio script, using Vite which Studio already has) and imported directly by the server. The browser uses it to show/hide and to give instant feedback; **the server re-evaluates everything on submit** and trusts nothing from the browser (hidden answers are dropped, required-ness recomputed, calculated values recomputed, eligibility routed).
- Conditions: `{all:[…]}` / `{any:[…]}` of `{field, op, value}` with ops equals, not_equals, contains, includes, gt, gte, lt, lte, empty, not_empty, date_before, date_after.
- Actions: show/hide field or section, skip to page, require/make optional, show message, set calculated value, route eligible/ineligible.
- Calculations: a small JSON tree (`sum`, `sub`, `mul`, `div`, `min`, `max`, `round`, `count_selected`, `if`) over field ids and numeric constants, with decimal-safe arithmetic.
- Static checks before a form can be published: missing or wrong-type references, calculation cycles and skip cycles (graph DFS), unreachable pages (BFS from page 1 over skips), conflicting actions on the same target under overlapping conditions (warning), rules pointing at fields on later pages (warning). Errors block publishing; warnings are shown in the builder.

### 2.6 Applicants are separate from staff
- The applicant API is mounted at `/apply/v1/*`, **outside `/studio`**, so `loadSession`, the staff cookie and every admin route are unreachable from it, and the staff cookie (`path=/studio`) is never sent to it.
- Release 1: **guest applications with resumable drafts**. Starting a draft returns a 256-bit secret; only its SHA-256 is stored. The browser keeps it locally; the applicant can ask for a resume link by email, which is time-limited (default 72 h), single-purpose, and contains no answers. Drafts carry a `rev` for optimistic concurrency (two tabs cannot silently overwrite each other) and autosave every few seconds after a change.
- Applicant accounts (email verification, password reset, history, status page, deletion request) come in a later phase, in separate tables `apply_applicants` / `apply_applicant_sessions` with their own cookie on `path=/apply/v1`. Never in `users`.
- CORS: same rule as `/forms/v1` (site origin + `FORMS_ALLOWED_ORIGINS`). Body limits, zod `.strict()`, honeypot, timing and salted-IP rate limits as in the contact form.

### 2.7 Final submission
One database transaction: lock the draft row, check the call is open **by server time** (the static page's state is never trusted), validate every answer against the form version with the server logic, recompute calculated fields, run eligibility, insert the submission (version id, answers, file links, consent text + timestamp, eligibility result), mark the draft submitted. A client idempotency key is unique per call, so a double click or a retried request returns the same submission instead of a second one. The browser shows "Submitted" only from the committed response (with the reference number); on any error it keeps the draft and says what to do.

### 2.8 Uploads: private storage
`<dataDir>/apply-files/<random>` + table `apply_files` (owner draft/submission, field id, original name kept only as metadata, random storage key, MIME detected from the bytes, size, SHA-256). Checks on the bytes: PDF via the existing `pdfProblem`, images via `sharp` metadata, DOCX/XLSX as a ZIP with the expected entries; per-field type and size limits, a per-submission total. Never in the Media Library, never copied to the site, no permanent URL: staff download through an authorized route with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, each download audited. Files of abandoned drafts and expired retention periods are deleted by the job tick.

### 2.9 Permissions and roles
New permissions: `apply.read`, `apply.call.manage`, `apply.call.approve`, `apply.call.publish`, `apply.form.edit`, `apply.submission.read`, `apply.submission.manage`, `apply.review` (assigned applications only), `apply.decide`, `apply.message`, `apply.export`, `apply.settings`. Two roles added to the enum (non-destructive): **Applications Manager** (all `apply.*` except settings) and **Application Reviewer** (`apply.review` only: sees only applications assigned to them, in blind mode without identity fields). Super/Website Administrators get all. Existing roles get nothing by default except Content Reviewer → `apply.call.approve`. Applicant personal data is never visible to Content Editors, Media or SEO roles.

### 2.10 Lifecycle and scheduling
Call status enum: draft → in_review → approved → scheduled → open → closed → under_evaluation → completed → archived (plus `paused`). Transitions are a table in code, each checked by the server and audited. Opening/closing dates are stored as `timestamptz` with the call's time zone for display; the 60 s tick opens and closes calls on server time and republishes their page. A deadline extension needs a reason and is audited with the old and new times. A closed call is reopened only by an explicit, audited "Reopen" with a reason, never by editing a date.

### 2.11 Eligibility and evaluation
- Eligibility rules are logic-engine conditions saved with a version; the result (eligible / needs_review / ineligible / not_assessed) stores the rule version and the reason. Staff can override with a reason (audited). Nothing is auto-rejected on AI inference; Release 1 has no AI.
- Rubrics are versioned (criterion, weight, scale, comment required). Assignments, draft and final reviews; a final review is locked; scores are computed on the server with integer arithmetic tied to the rubric version, so they are deterministic. Conflict-of-interest declaration before opening an application; blind mode hides identity fields; modes single / two reviewers / panel with a disagreement flag when spread exceeds a threshold. A reviewer can only write their own review.

### 2.12 Communications (later phase in this release plan)
Table `apply_messages` (one row per recipient, status, attempts, dedupe key unique per template + submission + decision) processed by the job tick through `deliver()` + `compose()` with retries and failure reasons. Template variables come from a whitelist and are escaped by `compose()`. Bulk sends need `apply.message`, a confirmation showing the count, and go one recipient per email (never CC/BCC lists). Decision emails cannot be queued before the decision is approved.

### 2.13 Admin tables and analytics
Submissions are paginated on the server (keyset on `submitted_at, id`), filtered and sorted with indexes; the browser never loads every application. Dashboard KPIs and analytics are SQL counts over authorized records only; drop-off by page comes from the draft's last page, not from tracking scripts.

## 3. Integration plan (phases)

Each phase ends with tests passing (`npm test`, `tsc`), the admin built, and a short hand-over note. Nothing is committed, pushed or deployed without your explicit go-ahead.

| Phase | Delivers | Migration (number checked at the time, other sessions add migrations too) |
|---|---|---|
| **1. Calls** | `apply_calls` + revisions, lifecycle and scheduler, extension/reopen audit, duplicate/archive/CSV export of calls; permissions + 2 roles; sidebar "Applications" group (Overview, Calls, Settings first); dashboard KPIs from real counts. | `00NN_apply_calls` + down |
| **2. Form builder + logic** | Field registry (core types), `apply_forms` / `apply_form_versions`, the logic engine with static checks, builder UI (navigator with drag + keyboard reorder, live canvas with desktop/mobile preview, inspector with Content/Validation/Logic/Appearance/Advanced tabs, undo/redo, save, publish), 10 starter templates (duplicate, version, JSON export/import). | `00NN_apply_forms` + down |
| **3. Public pages + drafts** | `writeApply()` in the publisher with verification, `apply-<slug>.html` in the site design, `assets/apply.js` renderer (multi-page, progress, per-page validation, autosave, review step, confirmation), `/apply/v1` API, drafts + resume link, private uploads. Opportunities apply method "AFCD Apply". | `00NN_apply_drafts_files` + down |
| **4. Submissions + eligibility** | Transactional idempotent submit, server re-evaluation, paginated Submissions table, applicant detail (Overview, Answers in form order, Documents, Evaluation, Communication, Activity), eligibility rules, results and overrides. | `00NN_apply_submissions` + down |
| **5. Evaluation** | Rubrics, assignments, COI, blind mode, draft/final reviews, scores, disagreement flags, reviewer workload on the dashboard; Shortlists and Decisions with confirmed, audited bulk actions (no emails yet). | `00NN_apply_review` + down |
| Later | Communications queue, applicant accounts, Reports/analytics, XLSX/PDF exports with expiring links, more field types. | |

Tests per phase: migrations up and down on PGlite; permission checks (each role, reviewer row-level access, applicant API cannot reach `/studio`); lifecycle transitions and scheduler with a fake clock; logic engine (every operator, cycles, unreachable pages, server/browser parity on the same fixtures); submit idempotency and concurrent submit; draft `rev` conflicts; upload byte checks with fake files; publisher verification with the existing `fakeRunner`.

## 4. Shared-file discipline
Other sessions edit the same checkout. Apply's own files live in `modules/apply/`, `src/admin/apply/`, `tests/apply*.test.ts`, its migrations and this ADR. Shared files get small, isolated hunks, listed in the hand-over note: `db/schema.ts` (an "Apply" section), `rbac.ts`, `app.ts` (one register call), `publish/service.ts` (one write/verify step), `index.ts` (tick hooks), `Sidebar.tsx`, `main.tsx`, `opportunities/*` (the new apply method), `assets/apply.js` (new). Migration numbers are re-checked right before generating, since other sessions add them too.

## 5. Open questions for the user
1. The brief stops inside section 27. Is there more after it?
2. Route: `apply-<slug>.html` (fits the current build) or `/apply/<slug>` (needs a build.mjs change)?
3. Calls as their own record linked from Opportunities (recommended), or should a call replace the opportunity page entirely?
4. Release 1 with guest applications + resume links, and applicant accounts in a later phase (recommended)?
5. Add the two roles *Applications Manager* and *Application Reviewer*?
6. Production: is `FORMS_ENDPOINT` set on the server build (it switches the site's forms on)? Apply relies on the same switch.
