// Copies the built public website into dist/ for upload to Hostinger (public_html).
// Run after `npm run build:production`. Only public files go in: no Studio, sources, docs or data files.
import { cpSync, rmSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // decoded path (works with spaces)
const OUT = join(ROOT, 'dist');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of readdirSync(ROOT)) {
  if (/\.html$/.test(f) || ['robots.txt', 'sitemap.xml'].includes(f)) copyFileSync(join(ROOT, f), join(OUT, f));
}
// French and Arabic go live only once their translations are approved (a production build skips drafts).
const approved = (l) => { try { return JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', l + '.json'), 'utf8')).status === 'approved'; } catch { return false; } };
for (const d of ['assets', ...['fr', 'ar'].filter(approved)]) {
  if (existsSync(join(ROOT, d)) && statSync(join(ROOT, d)).isDirectory()) cpSync(join(ROOT, d), join(OUT, d), { recursive: true });
}
copyFileSync(join(ROOT, 'deploy', '.htaccess'), join(OUT, '.htaccess'));
console.log('dist/ ready for public_html');
