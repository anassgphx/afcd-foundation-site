# AFCD Foundation website

Multi-page website (English) for the AFCD Foundation, the organisation behind [afcdfoundation.org](https://afcdfoundation.org).

Built with plain HTML, Tailwind CSS 3.4.17 and vanilla JavaScript. Content is planned in English, French and Arabic (RTL).

## Pages

| Page | File |
|---|---|
| Home | `index.html` |
| About Us (overview, links to the About pages, impact) | `about.html` |
| Our Story (story + approach) | `our-story.html` |
| Mission & Vision (mission, vision, values) | `mission-vision.html` |
| Strategy & Objectives (six objectives, who we serve) | `strategy.html` |
| Our Team | `team.html` |
| Our Pillars (overview cards) | `pillars.html` |
| Pillar pages | `youth-empowerment.html`, `womens-empowerment.html`, `environment-climate.html`, `digital-inclusion.html` |
| Projects (featured + filter by pillar) | `projects.html` |
| Project pages | `project-leadership-lab.html`, `project-eco-citizen.html`, `project-youth-green-generation.html` |
| News & Stories | `news.html` |
| Partners | `partners.html` |
| Get Involved (volunteer, programmes, partner, alumni) | `get-involved.html` |
| Contact (plus privacy and accessibility notes) | `contact.html` |

## Run it

Open `index.html` in a browser. No server is required.

## Edit it

The HTML files in the project root are **generated**. Edit the sources in `src/`, then rebuild:

```bash
npm install
npm run build
```

- `src/partials/`: the shared head, header (top bar, menu, mega menus, mobile drawer) and footer. Change the menu here once and every page updates.
- `src/pages/`: one file per page. Each starts with a small block giving its `title`, `description` and which menu item is `active`.
- `src/content.py`: generator for the inner pages (About, Pillars, Projects, project pages, News, Partners, Get Involved, Contact). Running `python3 src/content.py` rewrites those page sources, so either edit the page files directly or edit the generator and rerun it, not both.
- `build.mjs`: wraps each page in the shared layout and writes it to the project root.
- `input.css`: Tailwind source, compiled to `assets/styles.css`.
- `assets/main.js`: interactions (menus, sliders, pillar explorer, project cards, project filter, contact form checks).
- `assets/brand/`: official AFCD logos and the round mark (favicon).

## Preview vs production builds

- `npm run build` makes a **preview** build (what GitHub Pages serves): every page is `noindex, nofollow` and `robots.txt` disallows crawling, so the preview never competes with the real domain.
- `npm run build:production` makes the build for **https://afcdfoundation.org/**: pages are indexable and `robots.txt` points to `sitemap.xml`. Run it only when deploying to the real domain.
- Both builds add a canonical URL on the production domain, Open Graph/Twitter tags (`assets/img/og-default.jpg`), JSON-LD (Organization + WebSite on the homepage, BreadcrumbList on inner pages) and `sitemap.xml` with last-modified dates from git. `404.html` is excluded from the sitemap.

## Notes

- English is the only live language. FR and AR appear in the language switcher and show a "coming soon" message; they don't switch the page.
- Grey boxes are photo placeholders. Each caption names the photo planned for that spot.
- The contact form only checks the fields; it isn't connected to anything and sends nothing.
- News stories link to the blog on the current afcdfoundation.org until a news feed is connected.
- A preview is live on GitHub Pages (noindex). The real domain has not been switched over.
- Page URLs keep the current `page.html` form. Moving to `/about/`-style URLs, and redirecting the old WordPress URLs, needs a hosting decision first.
- The newsletter and contact forms are not connected to a backend yet.
- The four pillars keep their accent colours (your earlier choice), although the V5 brief asks for no coloured UI accents. Confirm which one wins.

## To confirm with AFCD before launch

- Impact figures: the current homepage says 400 ambassadors, its FAQ says "over 500". The About band shows 24+ projects completed.
- Permission to reuse the testimonial quote.
- Which partners are current, and their logos.
- Full street address of the Marrakech main office (the site shows only "Marrakech, Morocco" until confirmed).
- Social accounts.
- Proposed copy to approve: the value descriptions (Purpose section), the three approach principles (About page) and the Get Involved bullet points.
- Team names, roles and portraits.
- Summaries for the 7 projects that only have a name so far, and the remaining projects from the current site (15 in total).
- Youth Green Generation: approach and results beyond the 2024 call for applications.
- Privacy policy text.

## Validation before launch (V5)

- Official texts now used: mission, vision, values, pillar names and descriptions, six strategic objectives, beneficiaries, contact (contact@afcdteam.com, +212 663 618 536).
- Not published on purpose: tax ID, CNSS number, registration records, secondary phone numbers and personal contacts.
- Still to check: every page in Google's Rich Results Test and an Open Graph preview tool, Lighthouse (performance, accessibility, SEO) on the production domain, and Search Console submission of `sitemap.xml` after launch.
