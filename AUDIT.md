# Technical audit — AFCD Foundation site and AFCD Studio

Date: 23 November 2026. Production domain: https://afcdfoundation.com. The GitHub Pages preview build stays `noindex`.

Scores below are from Lighthouse 12 on the **preview** build of the homepage, served locally (`npm run build`, then `http://127.0.0.1:8765/index.html`). Preview pages send `noindex`, so the SEO category cannot reach 100 on that build. A production build (`npm run build:hostinger`) writes `dist/robots.txt` with `Allow: /` and a sitemap, and does not add `noindex`.

| Category | After this change |
|---|---|
| Performance | 70 |
| Accessibility | 100 |
| Best practices | 100 |
| SEO (preview, intentionally noindex) | 69 |

`is-crawlable` is 0 only because the preview build is blocked from indexing. On the same run, title, meta description, canonical, hreflang, image alt text, heading order, form labels, and colour contrast all passed.

html-validate on `index.html`, `contact.html`, `privacy.html`, and `404.html` reports style preferences (inline styles, uppercase doctype before this change, non-breaking spaces in phone numbers, `type` on buttons that are not inside a form). It did not report missing alt text, duplicate ids, or broken structure. Internal links across the 26 English pages resolve. The project-card script runs without page errors, and the next/previous control moves the stack.

## What was fixed

- Twitter cards now include `twitter:site` (`@afcd_foundation`), title, description, image, and image alt. Organization `sameAs` includes Facebook `https://www.facebook.com/afcdfoundation` (the dotted URL redirects there), Instagram `https://www.instagram.com/afcd.foundation`, LinkedIn `https://www.linkedin.com/company/afcd-foundation`, and X `https://x.com/afcd_foundation`. The same profiles are linked in the header and footer.
- `privacy.html` is a plain policy for what this site actually does. It is linked from the footer, the contact form, and `sitemap.xml`. `404.html` stays `noindex`.
- Old WordPress paths from the afcdfoundation.org sitemap (23 November 2026) redirect with 301 in `deploy/.htaccess`, `deploy/Caddyfile.website`, and `deploy/caddy/afcdfoundation.caddy`. The `.org` host itself redirects to `.com`. Current `.com` pages are unchanged.
- Homepage case-study cards read project data from `#home-projects-data` (written by `src/content.py` from `src/data/projects.json`, which Studio publishes). A Studio logo (`detail.logo`, including its alt text) renders beside the title. With no logo, the card shows a monogram from the project name. No logo files were added.
- Pillar numbers and “Related projects” labels on pastel backgrounds were too light. They now meet contrast. Language links no longer use `aria-pressed` (not allowed on `<a>`). Testimonial slides are groups, not articles with a group role. Hero chapter buttons use their visible text as the accessible name.
- Deploy configs add a Content-Security-Policy for the public site, plus `Cross-Origin-Opener-Policy`. HTML is still `no-cache`. Hashed CSS and JS can be cached for a year. The main script uses `defer`.
- French and Arabic drafts already emit reciprocal `hreflang` (including `x-default`) when they are built. Production builds omit them until `status` is `approved`, and only then adds them to the sitemap. Translated homepages set `WebSite.inLanguage`.

## Ambassador count

The new site says **400** ambassadors on the homepage and on About. That is the only figure in the current pages. The old WordPress homepage FAQ says “over than 500 ambassadors”. The number was not changed. AFCD needs to confirm which one is current.

## Still needs AFCD

- Street address. The contact page still says Marrakech, with a TODO in the source. A legacy record uses Avenue Hassan 2, Quartier Elbahiya, Ait Ourir 42050. Do not publish that until it is confirmed.
- Partner websites and logos. The partners page lists 18 names. `url` and `logo` in `src/data/partners.json` are empty, so the page shows initials. Do not invent logos or links.
- Project logos and project photos. Upload each logo in AFCD Studio (project → Project logo). Alt text and usage rights are required before publish. The homepage card and the project page both use that image. Photo placeholders on the cards stay until real photos are published the same way.
- Privacy policy review. The new page describes the current site (forms not connected yet, no analytics cookies, Google Fonts). It is not a legal opinion.
- Ambassador figure, as above.
- French and Arabic are still drafts (`noindex`). A native speaker should approve them before they are indexed.
- News pages still link to `https://afcdfoundation.org/blog/` for the original posts. After `.org` points at this host, those links follow the redirect to the news listing, not to a preserved WordPress post.

## Studio

AFCD Studio is the custom CMS in `studio/` (Hono, Drizzle, Vite, TipTap). It is not Sanity or Decap.

Reviewed and already in place:

- Studio API routes sit behind a session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` when the origin is HTTPS) and a CSRF check on writes. Permissions are per role.
- Login is rate-limited. Unknown emails still run a password hash so timing does not reveal accounts. Passwords use Argon2id. Local-only short passwords are refused once Studio is not on localhost.
- Uploads are checked by decoding the bytes with Sharp (JPEG, PNG, WebP, AVIF, TIFF only), size-capped (`MAX_UPLOAD_MB`, default 15), and republished as WebP derivatives with metadata stripped. SVG, GIF, and HTML are refused. PDF uploads check the header, `%%EOF`, size, and a set of active-content names.
- Media files and previews require a signed-in user. Path checks reject names that are not the expected hash pattern.
- Public form posts are limited to 16 KB, JSON only, and an allow-listed origin.
- Story text is stored as a small markdown-like subset and escaped on the way to HTML. Links must be a site path, `https://`, `mailto:`, or `tel:`.
- No `.env` is committed. `studio/.env` is gitignored. `studio/.env.example` has empty secrets. Tests use fake tokens only.
- Google OAuth tokens are encrypted when `STUDIO_ENCRYPTION_KEY` is set. Nothing in the repo contains a live key.

Changes in this pass:

- The project logo was already a Media Library field (`logoMediaId` plus framing). It was not in the editor’s “needs alt text and rights” list, so a logo could miss alt text until publish failed. It is included now, and the logo section shows the alt text with a button to edit it. Publishing still refuses a logo without alt text and confirmed rights.
- Replacing an image accepted a 40 MB body before the 15 MB rule ran. The HTTP ceiling is now 20 MB. The configured limit is still enforced after the file is read.
- HTTPS responses from Studio send `Strict-Transport-Security`.
- The admin bundle splits React and the editor into separate chunks so the shell can cache separately from TipTap.

`npm audit` on the public site: no known vulnerabilities. On Studio: 31 moderate issues, no high or critical.

- `@tiptap/*` 2.27.3 is in the advisory range for `mergeAttributes` and `__proto__` (GHSA-cp6q-959q-f8rh). The fix is TipTap 3.30.4 or newer, a major upgrade. The public site does not render raw TipTap JSON; it renders the escaped subset above. Upgrading TipTap in the admin editor was left alone so content editing does not break. Plan that upgrade separately.
- `drizzle-kit` pulls an old esbuild (GHSA-67mh-4wv8-2f99). That is a development server only. The suggested fix downgrades drizzle-kit. It was not applied.

No committed secrets were found. Nothing needs rotating because of this audit.
