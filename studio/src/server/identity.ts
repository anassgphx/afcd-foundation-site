// The foundation's public identity facts that several parts of Studio check against. One list, here; the website build
// (build.mjs, lib/site-settings.mjs) keeps a copy because it cannot import TypeScript, and tests/identity.test.ts fails
// when the copies differ. Pure data: the admin app imports it too.
//
// Who edits what: Settings › Contact & social is the only place for the public phone and email on the website and in
// its structured data. SEO › Structured data keeps the names, description, founding year and profiles.

/** The foundation's public email addresses. Any other address (personal, administrative) never goes on the website. */
export const PUBLIC_EMAILS = ['contact@afcdteam.com', 'akaya@afcdteam.com'];
