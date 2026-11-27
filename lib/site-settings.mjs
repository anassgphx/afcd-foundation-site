// Studio website settings (owned by AFCD Studio → Settings): src/data/site-settings.json, or env SITE_SETTINGS_JSON.
// One source for the site name, canonical domain, build environment, contact details, social profiles and brand images.
// build.mjs applies it to the head, every page (header, footer, contact page and any other link to these details) and the
// Organization JSON-LD. Without the file nothing here runs and the site builds exactly as written.
// Only the foundation's public email addresses pass. There is no street-address field. Values are escaped here.
import { existsSync, readFileSync } from 'node:fs';

// keep in step with studio/src/server/identity.ts (studio/tests/identity.test.ts fails when they differ)
export const PUBLIC_EMAILS = ['contact@afcdteam.com', 'akaya@afcdteam.com'];
// What the partials and pages contain today (replaced in place, so an unchanged value changes nothing)
const D = {
  tel: '+212663618536', phone: '+212 663 618 536', general: 'contact@afcdteam.com', board: 'akaya@afcdteam.com',
  social: { facebook: 'https://www.facebook.com/afcd.foundation', instagram: 'https://www.instagram.com/afcd.foundation', linkedin: 'https://www.linkedin.com/company/afcd-foundation' },
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IMG = (x) => x && /^assets\/media\/[0-9a-f]{24}-\d+\.webp$/.test(x.src) && Number.isInteger(x.w) && Number.isInteger(x.h) ? x : null;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

/** Reads and checks the file. Anything that does not pass is dropped (the site keeps its own value). */
export function loadSiteSettings(file) {
  if (!file || !existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const s = j.site ?? {}, c = j.contact ?? {}, b = j.brand ?? {};
  return {
    revision: /^[\w-]{1,64}$/.test(j.revision ?? '') ? j.revision : null,
    name: typeof s.name === 'string' && s.name.trim() && !/[<>"]/.test(s.name) ? s.name.trim() : null,
    canonicalUrl: /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/$/i.test(s.canonicalUrl ?? '') ? s.canonicalUrl : null,
    environment: s.environment === 'production' || s.environment === 'preview' ? s.environment : null,
    tel: /^\+[0-9]{8,20}$/.test(c.tel ?? '') ? c.tel : null,
    phone: /^\+[0-9 ]{8,24}$/.test(c.phone ?? '') ? c.phone : null,
    general: PUBLIC_EMAILS.includes(c.generalEmail) ? c.generalEmail : null,
    board: PUBLIC_EMAILS.includes(c.boardEmail) ? c.boardEmail : null,
    social: Object.fromEntries(Object.keys(D.social).map((k) => [k, c.social && typeof c.social[k] === 'string' && (c.social[k] === '' || HTTPS.test(c.social[k])) ? c.social[k] : D.social[k]])),
    themeColor: b.themeColor === '#000000' || b.themeColor === '#FFFFFF' ? b.themeColor : null,
    logo: IMG(b.logo), logoLight: IMG(b.logoLight), favicon: IMG(b.favicon),
    socialImage: IMG(b.socialImage) ? { ...b.socialImage, alt: String(b.socialImage.alt ?? '') } : null,
  };
}

/** The shared <head>: browser colour and favicon. (apple-touch-icon stays PNG: iOS does not use WebP icons.) */
export function applyHead(head, S) {
  let h = head;
  if (S.themeColor) h = h.replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${S.themeColor}">`);
  if (S.favicon) h = h.replace(/<link rel="icon" type="image\/png" href="[^"]*">/, `<link rel="icon" type="image/webp" href="${esc(S.favicon.src)}">`);
  return h;
}

/** A built page: contact links and text, social profiles and logos. JSON-LD blocks are left alone (see applyOrg). */
export function applyPage(html, S) {
  return html.split(/(<script type="application\/ld\+json">[\s\S]*?<\/script>)/).map((part, i) => (i % 2 ? part : applyText(part, S))).join('');
}
function applyText(html, S) {
  let h = html;
  if (S.tel) h = h.split(`tel:${D.tel}`).join(`tel:${S.tel}`);
  if (S.phone) h = h.split(D.phone).join(esc(S.phone));
  const mail = { [D.general]: S.general ?? D.general, [D.board]: S.board ?? D.board };
  h = h.replace(new RegExp(`${reEsc(D.general)}|${reEsc(D.board)}`, 'g'), (m) => mail[m]);
  for (const [k, url] of Object.entries(S.social)) {
    if (url === D.social[k]) continue;
    const href = `href="${D.social[k]}"`;
    h = url === '' ? h.replace(new RegExp(`<a\\b[^>]*${reEsc(href)}[^>]*>[\\s\\S]*?</a>`, 'g'), '') : h.split(href).join(`href="${esc(url)}"`);
  }
  const logo = (file, img) => { if (img) h = h.replace(new RegExp(`<img src="assets/brand/${reEsc(file)}(?:\\?v=\\d+)?"([^>]*?)width="\\d+" height="\\d+"`, 'g'), `<img src="${esc(img.src)}"$1width="${img.w}" height="${img.h}"`); };
  logo('afcd-logo.png', S.logo); logo('afcd-logo-white.png', S.logoLight);
  return h;
}

/** The Organization JSON-LD with the published contact details, name and logo. */
export function applyOrg(org, S, site) {
  const out = { ...org };
  if (S.name) out.name = S.name;
  if (S.general) out.email = S.general;
  if (S.tel) out.telephone = S.tel;
  if (S.logo) out.logo = site + S.logo.src;
  out.sameAs = Object.values(S.social).filter(Boolean);
  return out;
}
