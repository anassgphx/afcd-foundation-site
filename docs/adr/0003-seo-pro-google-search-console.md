# ADR 0003 — SEO Pro, phase 1: audit fixes, master dashboard, Google Search Console

Status: implemented (first round of the "SEO PRO V4" brief). Date: 2026-11-22.

## What existed and is kept
- **Build audit engine** (`studio/src/server/modules/seo/engine.ts`): reads the pages the website build produced, scores six areas, stores runs in `seo_audits` and tracked issues in `seo_issues`. History and reviewed issues are untouched.
- **Page settings** (`seo_overrides` + revisions), **Redirects** (`redirects`), **Schema studio** (`seo_settings` key `organization`), publishing through `publish/service.ts`. Unchanged.
- Translation drafts live in `seo_settings` keys `i18n:fr` / `i18n:ar` (translations module). SEO Pro uses its own key `gsc:settings` only.
- The site is the static generator (`src/content.py` + `build.mjs` + Tailwind), not Astro. Studio reads its output; it never edits public pages outside the review/publish flow.

## Plan for this round (done)
1. Audit engine false positives: short standard titles ("About Us", "Contact") and short listing/contact pages are no longer flagged; empty titles ("Home", "Untitled") and thin content pages still are. Outdated advice fixed.
2. Google Search Console as the first complete Google workflow (below).
3. Master dashboard (SEO → Overview): KPI strip with labelled sources (Studio build audit / Search Console / GA4), clicks chart + technical health trend, winners/losers, work queue (build-audit issues + Search Console low-CTR opportunities), indexing / schema / Core Web Vitals / jobs. Empty states instead of zeroes when there is no data.
4. Workspaces grouped: Overview · Diagnose (Site audit, Issues, Indexability, Internal links) · Google (Search Console) · Optimize (Structured data, Redirects, Page settings) · Settings (Integrations).

## Search Console design
- **OAuth 2.0 authorization code + PKCE (S256) + state.** State is random, single use, 10 minutes, bound to the Studio user who started it (`oauth_states`). Scopes: `webmasters.readonly`, `openid`, `email`. `access_type=offline`, `prompt=consent`.
- **Secrets**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STUDIO_ENCRYPTION_KEY` from `studio/.env` (never in code or the browser). Refresh and access tokens are AES-256-GCM encrypted in `google_connections`. Revoked grants mark the connection "needs reconnecting". Disconnect revokes at Google and deletes the tokens.
- **Property**: only properties the account can use (not `siteUnverifiedUser`) can be chosen, by an administrator.
- **Sync** (`seo_jobs`, kind `gsc_sync`): background, one at a time, with progress, cancellation, retries with backoff (1, 5, 25, 60 min), restart recovery, and an idempotent enqueue. It imports final days only (up to 3 days ago), re-reads the last 3 stored days, and pages through 25,000-row responses. Dimension sets: date (site totals incl. anonymized queries), query, page, query+page, country, device. Rows are upserted on a unique key, so there are no duplicates. Retention is configurable (default 486 days, about Google's 16 months). Auto sync runs daily.
- **Quotas**: `api_usage` counts calls per day; Studio stops itself at 2,000 Search Analytics requests and 1,800 URL inspections per day (Google: 2,000 inspections per property per day).
- **Reports** read stored rows only: overview (totals, daily series, device *or* country filter, comparison period), query and page explorers (CSV), countries/devices, per-page history with its queries, winners/losers (documented method, minimum impressions threshold). Average position is impression-weighted and labelled "Google's average, not a live rank".
- **URL Inspection**: only URLs of the chosen property; snapshots stored in `url_inspections`, labelled as Google's indexed version (not a live test, no indexing request).

## Dependency map
```
.env (client id/secret, encryption key)
  └─ google/crypto.ts ── google/client.ts (OAuth, sites, searchAnalytics, urlInspection; injectable fetch)
        └─ google/gsc.ts (connection, quota, sync job, reports, inspection)
              ├─ jobs/service.ts (seo_jobs queue) ← index.ts timer (10 s) + daily auto-sync
              └─ app.ts routes /seo/google/*, /seo/gsc/*, /seo/jobs (RBAC: seo.read / seo.update / seo.publish)
admin: Seo.tsx (workspaces, audit views) ── SeoPro.tsx (MasterOverview, SearchConsoleView, Integrations, LineChart)
DB (migration 0014): google_connections, oauth_states, gsc_metrics, url_inspections, seo_jobs, api_usage
```

## Roles
- `seo.read`: see the dashboard and stored Google data.
- `seo.update`: start a sync and inspect URLs.
- `seo.publish` (administrators): connect, choose the property, change sync settings, disconnect.

## Not built yet (next phases of the brief)
GA4 Data API, PageSpeed/CrUX, rank tracking (GSC queries mode A), keyword intelligence, link intelligence and broken-link crawler, image/video SEO, bulk editing, reports and automations, AI assistant and MCP tools. The dashboard shows them as not connected; there are no inert buttons.

## Needs from AFCD to see real data
An OAuth client (Web application) in AFCD's Google Cloud project with the Search Console API enabled, the redirect URI `http://localhost:4400/studio/api/seo/google/callback` (or the hosted Studio origin + that path), and a Google account that is a verified user of the afcdfoundation.org property.
