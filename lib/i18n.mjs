// Site languages: builds French and Arabic copies of the English pages from translation files.
//
// English stays the source of truth (src/content.py -> src/pages -> build.mjs). After the English pages are built, each
// language in src/i18n/<lang>.json is applied to the built HTML and written to <lang>/<page>.html:
//   { "status": "draft" | "approved", "strings": { "<English text>": "<translation>" } }
// Keys are the visible text of a page, segment by segment (a heading, a paragraph, a button, an alt text). Inline
// formatting (<a>, <strong>, <em>, <br> ...) stays inside a segment, so translations keep the same tags.
// A segment without a translation stays in English, and `node lib/i18n.mjs report` lists what is missing.
//
// Draft languages are built for preview builds only, with noindex and a "draft translation" notice. Production builds
// (SITE_ENV=production) publish approved languages only, so an unreviewed translation never goes live by accident.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LANGS = {
  fr: { name: 'Français', locale: 'fr_FR', dir: 'ltr', draft: 'Traduction en cours de relecture. Certains passages peuvent encore évoluer.', back: 'English version' },
  ar: { name: 'العربية', locale: 'ar_MA', dir: 'rtl', draft: 'ترجمة قيد المراجعة. قد تتغير بعض الفقرات.', back: 'English version' },
};

// Tags that stay inside a text segment. Everything else (block tags, comments, svg, script, style) ends a segment.
const INLINE = new Set(['a', 'strong', 'em', 'b', 'i', 'u', 'br', 'small', 'sup', 'sub', 'abbr', 'mark', 'code', 'time', 'span', 'bdi', 'q', 'cite', 's', 'wbr']);
const ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'data-where', 'data-title'];
const META_CONTENT = /^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)$/;
const TOKEN = /<!--[\s\S]*?-->|<(script|style|svg|textarea)\b[\s\S]*?<\/\1\s*>|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const hasWords = (s) => /\p{L}/u.test(s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/gi, ''));
const tagName = (t) => (t.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/) || [])[1]?.toLowerCase();
const isTag = (t) => t[0] === '<';

function balanced(tokens) {
  const st = [];
  for (const t of tokens) {
    if (!isTag(t) || /\/>$/.test(t)) continue;
    const n = tagName(t); if (n === 'br' || n === 'wbr') continue;
    if (t[1] === '/') { if (st.pop() !== n) return false; } else st.push(n);
  }
  return st.length === 0;
}

/** Walks built HTML and calls fn(key) for each translatable piece; returns the HTML with fn's replacements applied. */
export function mapText(html, fn) {
  const toks = html.match(TOKEN) || [];
  let out = '', run = [];
  // A run of text and inline tags. It is translated whole when it has words outside its tags ("Email <a>us</a> today");
  // otherwise (a row of links, a badge plus a title) each top-level element is handled on its own.
  const seg = (run) => {
    let a = 0, b = run.length;
    const blank = (t) => !isTag(t) && !t.trim();
    for (;;) {
      while (a < b && blank(run[a])) a++;
      while (b > a && blank(run[b - 1])) b--;
      if (a < b && isTag(run[a]) && balanced(run.slice(a + 1, b))) { a++; continue; }
      if (a < b && isTag(run[b - 1]) && balanced(run.slice(a, b - 1))) { b--; continue; }
      break;
    }
    const body = run.slice(a, b), inner = body.join('');
    let mid = inner;
    if (body.length && hasWords(inner) && balanced(body)) {
      let depth = 0, top = '';
      for (const t of body) {
        if (isTag(t)) { const n = tagName(t); if (n === 'br' || n === 'wbr' || /\/>$/.test(t)) continue; depth += t[1] === '/' ? -1 : 1; }
        else if (depth === 0) top += t;
      }
      if (hasWords(top)) {
        const lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0];
        const r = fn(norm(inner), 'text');
        if (r != null) mid = lead + r + trail;
      } else {
        // Recurse into each top-level element.
        mid = ''; let depth2 = 0, child = [];
        for (const t of body) {
          const tagT = isTag(t), n = tagT ? tagName(t) : null, self = tagT && (n === 'br' || n === 'wbr' || /\/>$/.test(t));
          if (tagT && !self && t[1] !== '/') { if (depth2 === 0) { mid += attrs(t); depth2++; continue; } depth2++; }
          else if (tagT && !self && t[1] === '/') { depth2--; if (depth2 === 0) { mid += seg(child) + t; child = []; continue; } }
          if (depth2 === 0) mid += tagT ? attrs(t) : t; else child.push(t);
        }
      }
    } else {
      // Unbalanced run (it starts or ends inside an element): translate each text piece on its own.
      mid = body.map((t) => {
        if (isTag(t)) return attrs(t);
        if (!hasWords(t)) return t;
        const r = fn(norm(t), 'text'); return r == null ? t : t.match(/^\s*/)[0] + r + t.match(/\s*$/)[0];
      }).join('');
    }
    return run.slice(0, a).map(attrs).join('') + mid + run.slice(b).map(attrs).join('');
  };
  const flush = () => { if (run.length) out += seg(run); run = []; };
  const attrs = (t) => {
    if (!isTag(t) || t[1] === '/') return t;
    let r = t.replace(new RegExp(`(\\s(?:${ATTRS.join('|')})=")([^"]*)(")`, 'g'), (m, p, v, q) => {
      if (!hasWords(v)) return m; const x = fn(norm(v), 'attr'); return x == null ? m : p + x + q;
    });
    if (tagName(t) === 'meta' && META_CONTENT.test((t.match(/\s(?:name|property)="([^"]+)"/) || [])[1] || '')) {
      r = r.replace(/(\scontent=")([^"]*)(")/, (m, p, v, q) => { if (!hasWords(v)) return m; const x = fn(norm(v), 'attr'); return x == null ? m : p + x + q; });
    }
    return r;
  };
  for (const t of toks) {
    const n = isTag(t) && t[1] !== '!' ? tagName(t) : null;
    if (!isTag(t) || t === '<' || (n && INLINE.has(n))) { run.push(t); continue; }
    flush();
    out += n === 'title' || !n ? t : attrs(t);
  }
  flush();
  return out;
}

/** Translatable string literals in main.js (prose: at least two words, no code-looking characters). */
const JS_STR = /'((?:[^'\\\n]|\\.)*)'/g;
const prose = (s) => /\p{L}{2,}\s+\p{L}/u.test(s) && !/[{}<>=]|^\.|^#|\.html|^[a-z-]+$/.test(s) && !/^[\w-]+(\s[\w-]+)*\s*$/.test(s) || /^[A-Z][^'<>{}=]*[.!?:]$/.test(s);
export function mapJs(src, fn) {
  return src.replace(JS_STR, (m, s) => { if (!prose(s)) return m; const r = fn(s.replace(/\\'/g, "'"), 'js'); return r == null ? m : `'${r.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; });
}

// ---------------------------------------------------------------- per-language page build

const loadLang = (src, lang) => { const f = join(src, 'i18n', `${lang}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };

/** Which languages this build publishes: approved ones always, drafts on preview builds only. */
export function activeLangs(src, production) {
  return Object.keys(LANGS).filter((l) => { const d = loadLang(src, l); return d && (d.status === 'approved' || !production); });
}

// Turns the header's "coming soon" language buttons (top bar and mobile drawer) into links between language versions.
function switcher(html, file, lang, langs) {
  const href = (l) => (lang === 'en' ? (l === 'en' ? '' : `${l}/`) : (l === 'en' ? '../' : `../${l}/`)) + file;
  const ON = 'border-ink-pure bg-ink-pure text-white', OFF = 'border-ink-light text-ink-mid';
  return html
    .replace(/(<div class="tb-lang"[^>]*aria-label=")[^"]*(")/, `$1${lang === 'fr' ? 'Langue' : lang === 'ar' ? 'اللغة' : 'Language'}$2`)
    .replace(/(role="group" aria-label=")Language(">\s*<button class="lang-btn min-h)/, `$1${lang === 'fr' ? 'Langue' : lang === 'ar' ? 'اللغة' : 'Language'}$2`)
    .replace(/<(button|a) class="(lang-btn[^"]*)"([^>]*)>[\s\S]*?<\/\1>/g, (m, tag, cls, rest) => {
      const l = (rest.match(/\s(?:data-lang|hreflang)="(en|fr|ar)"/) || [])[1]; if (!l) return m;
      if (l !== 'en' && !langs.includes(l)) return m;   // not built: keep the "coming soon" button
      const on = l === lang;
      // Mobile pills carry their own active colours; swap them class by class (they are not adjacent in the markup).
      let c = cls;
      if (/\bmin-h-\[44px\]/.test(cls)) {
        const t = cls.split(/\s+/).filter((x) => !ON.split(' ').includes(x) && !OFF.split(' ').includes(x));
        c = [...t, ...(on ? ON : OFF).split(' ')].join(' ');
      } else if (/\bpx-1\.5 py-1\b/.test(cls)) {   // footer switcher
        c = cls.replace(/\s*text-white(\/50)?(\s+hover:text-white)?/g, '') + (on ? ' text-white' : ' text-white/50 hover:text-white');
      }
      return `<a class="${c}" href="${href(l)}" hreflang="${l}" lang="${l}"${on ? ' aria-pressed="true" aria-current="true"' : ''}>${l.toUpperCase()}</a>`;
    });
}

const SWITCH_CSS = '<style>a.lang-btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}</style>';

/** Adds hreflang alternates and the live switcher to an English page (called by build.mjs for every page). */
export function decorateEnglish(html, file, { site, langs, pageUrl }) {
  const alt = ['en', ...langs].map((l) => `<link rel="alternate" hreflang="${l}" href="${l === 'en' ? pageUrl(file) : site + l + '/' + (file === 'index.html' ? '' : file)}">`);
  alt.push(`<link rel="alternate" hreflang="x-default" href="${pageUrl(file)}">`);
  return switcher(html, file, 'en', langs).replace('</head>', (file === '404.html' ? '' : alt.join('\n') + '\n') + SWITCH_CSS + '\n</head>');
}

/** Builds <lang>/<file> from the finished English page. */
export function translatePage(html, file, lang, dict, { site, langs, draft, production, jsName }) {
  const L = LANGS[lang], used = new Set();
  let out = mapText(html, (k) => { const v = dict[k]; if (v != null && v !== '') { used.add(k); return v; } return null; });
  const url = (l) => (l === 'en' ? site : site + l + '/') + (file === 'index.html' ? '' : file);
  out = out
    .replace(/<html lang="en" dir="ltr">/, `<html lang="${lang}" dir="${L.dir}">`)
    // Relative links: assets live one level up; pages of the same language sit next to this one.
    .replace(/(\s(?:src|href|poster)=")assets\//g, '$1../assets/')
    .replace(/(\ssrcset=")([^"]*)"/g, (m, p, v) => p + v.replace(/(^|,\s*)assets\//g, '$1../assets/') + '"')
    .replace(/url\((['"]?)assets\//g, 'url($1../assets/')
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url(lang)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url(lang)}">`)
    .replace(/<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${L.locale}">`)
    .replace(/<script src="assets\/main\.js\?v=([^"]+)"><\/script>/, (m, v) => `<script src="../assets/${jsName}?v=${v}"></script>`)
    .replace(/(<script src=")\.\.\/assets\/main\.js(\?v=[^"]+"><\/script>)/, `$1../assets/${jsName}$2`);
  if (draft || !production) out = out.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow">');
  const alt = file === '404.html' ? '' : ['en', ...langs].map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l)}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${url('en')}">\n`;
  out = out.replace(/<link rel="alternate" hreflang[^\n]*\n/g, '');
  out = out.split(SWITCH_CSS + '\n').join('');
  out = switcher(out, file, lang, langs).replace('</head>', alt + (lang === 'ar' ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">\n<link rel="stylesheet" href="../assets/rtl.css">\n' : '') + SWITCH_CSS + '\n</head>');
  if (draft) out = out.replace(/(<main id="main"[^>]*>)/, `$1\n<div class="i18n-draft" role="note" lang="${lang}" style="background:#FEF3C7;color:#78350F;font-size:13px;text-align:center;padding:8px 16px">${L.draft} <a href="../${file === 'index.html' ? 'index.html' : file}" hreflang="en" lang="en" style="text-decoration:underline">${L.back}</a></div>`);
  return { html: out, used };
}

/** Called by build.mjs after the English pages: writes every active language and returns sitemap entries. */
export function buildLanguages({ src, outDir, files, site, production, lastmod, noindexFiles }) {
  const langs = activeLangs(src, production);
  const sitemap = [], report = {};
  const mainJs = readFileSync(join(outDir, 'assets', 'main.js'), 'utf8');
  for (const lang of langs) {
    const data = loadLang(src, lang), dict = data.strings || {}, draft = data.status !== 'approved';
    const jsName = `main.${lang}.js`;
    let js = mapJs(mainJs, (k) => dict[k] || null);
    const CD = "d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days'";
    const cd = { fr: "d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : 'Dans ' + d + ' jours'",
      ar: "d === 0 ? 'اليوم' : d === 1 ? 'غدًا' : d === 2 ? 'بعد يومين' : d <= 10 ? 'بعد ' + d + ' أيام' : 'بعد ' + d + ' يومًا'" }[lang];
    if (js.includes(CD)) js = js.replace(CD, cd); else console.warn(`i18n: event countdown text in main.js changed; ${lang} countdown stays English`);
    writeFileSync(join(outDir, 'assets', jsName), js);
    mkdirSync(join(outDir, lang), { recursive: true });
    let used = 0;
    for (const file of files) {
      const en = readFileSync(join(outDir, file), 'utf8');
      const r = translatePage(en, file, lang, dict, { site, langs, draft, production, jsName });
      writeFileSync(join(outDir, lang, file), r.html);
      used += r.used.size;
      if (!draft && production && !noindexFiles.has(file)) sitemap.push(`  <url><loc>${site}${lang}/${file === 'index.html' ? '' : file}</loc><lastmod>${lastmod(file)}</lastmod></url>`);
    }
    report[lang] = draft ? 'draft' : 'approved';
    console.log(`built ${lang}/ (${files.length} pages, ${draft ? 'draft: noindex' : 'approved'})`);
  }
  return { langs, sitemap, report };
}

// ---------------------------------------------------------------- CLI: node lib/i18n.mjs report [--json]
// Lists the English segments of the built site and, per language, the ones still missing a translation.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const files = readdirSync(join(root, 'src', 'pages')).filter((f) => f.endsWith('.html'));
  const keys = new Map();
  for (const f of files) mapText(readFileSync(join(root, f), 'utf8'), (k) => { if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(f); return null; });
  mapJs(readFileSync(join(root, 'assets', 'main.js'), 'utf8'), (k) => { if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add('main.js'); return null; });
  if (process.argv[2] === 'keys') { console.log(JSON.stringify([...keys.keys()], null, 1)); process.exit(0); }
  console.log(`${keys.size} English segments across ${files.length} pages + main.js`);
  for (const lang of Object.keys(LANGS)) {
    const d = loadLang(join(root, 'src'), lang); const dict = d?.strings || {};
    const missing = [...keys.keys()].filter((k) => !dict[k]);
    const stale = Object.keys(dict).filter((k) => !keys.has(k));
    console.log(`${lang}: ${d ? d.status : 'no file'} · ${keys.size - missing.length}/${keys.size} translated · ${stale.length} unused`);
    if (process.argv.includes('--missing')) for (const k of missing.slice(0, 200)) console.log(`   - ${k.slice(0, 120)}  [${[...keys.get(k)].slice(0, 3).join(', ')}]`);
  }
}
