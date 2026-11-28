// Studio page fields and section composition, shared by build.mjs (the live site) and AFCD Studio (the editor canvas),
// so the preview and the published page come from the same code. Plain JavaScript, no dependencies.
//
// Fields: elements marked data-sf="key" (optionally data-sf-type) in a page source take edited values (plain text, escaped
// here). The markers are always removed from the output, so an unedited page builds exactly as written.
// Sections: an entry may carry a layout, an ordered list of { section: "<id of a top-level <section>>" } and
// { block: "<id>", html: "<HTML rendered by Studio's block registry>" }; either may have hidden: true. Top-level
// sections that the layout does not mention stay at their source position, so new hand-written sections never disappear.

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// a page of this site may carry a short query (contact.html?topic=Volunteering#message picks the form's topic)
const SAFE_HREF = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:\+?[0-9 ]+|#[a-z0-9-]+|[a-z0-9-]+\.html(\?[a-z0-9=+&%_.-]+)?(#[a-z0-9-]+)?)$/i;
/** Where a "tail" field's own text starts: after the last closing tag inside it (a label such as <span>…</span> or
 *  <b>Who it’s for:</b> stays), keeping the space written after that tag. */
export function tailStart(inner) {
  let at = -1, m; const re = /<\/[a-z][a-z0-9]*>/gi;
  while ((m = re.exec(inner))) at = m.index + m[0].length;
  return at < 0 ? 0 : at + (inner.slice(at).match(/^\s*/) || [''])[0].length;
}
export function closeIndex(html, tag, from) {   // index of the matching </tag>, counting nested tags of the same name
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi'); re.lastIndex = from; let depth = 1, m;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (!depth) return m.index; }
  throw new Error(`unclosed <${tag}> for a Studio field`);
}
function fieldValue(type, v, inner, open) {
  const softCls = (inner.match(/<span class="([^"]+)"/) || [])[1];
  switch (type) {
    case 'split': return { inner: escHtml(v.main) + (v.soft ? ` <span class="${softCls || 'sh-soft'}">${escHtml(v.soft)}</span>` : '') };
    case 'plain': return { inner: escHtml(typeof v === 'object' ? [v.main, v.soft].filter(Boolean).join(' ') : v) };
    case 'rich': return { inner: escHtml(v).replace(/\*\*(.+?)\*\*/g, `<span class="${softCls || 'font-semibold'}">$1</span>`) };
    case 'tail': { const i = tailStart(inner); return { inner: (/<\/[a-z]/i.test(inner) ? inner.slice(0, i) : '') + escHtml(v) }; }
    // button text before its arrow (<span class="btn…">Label <span class="arr">↗</span></span>): the arrow stays
    case 'label': { const rest = inner.search(/\s*<span/); return { inner: escHtml(v) + (rest >= 0 ? inner.slice(rest) : '') }; }
    case 'link': {
      const rest = inner.search(/\s*<span/); const tailHtml = rest >= 0 ? inner.slice(rest) : '';
      return { inner: escHtml(v.label) + tailHtml, open: v.href && SAFE_HREF.test(v.href) ? open.replace(/\shref="[^"]*"/, ` href="${escHtml(v.href)}"`) : open };
    }
    case 'stories': return { inner: storiesHtml(inner, v) };
    // a link whose visible text is the address itself (<a href="mailto:x">x</a>): text and href change together
    case 'email': return { inner: escHtml(v), open: EMAIL.test(v) ? open.replace(/\shref="[^"]*"/, ` href="mailto:${escHtml(v)}"`) : open };
    // long text gets data-long="1" (over 180 characters), "2" (over 320) or "3" (over 500), so the CSS can set it smaller
    default: { const n = String(v).length, step = n > 500 ? 3 : n > 320 ? 2 : n > 180 ? 1 : 0;
      return { inner: escHtml(v), ...(step ? { open: open.replace(/^<([a-z][a-z0-9]*)/i, `<$1 data-long="${step}"`) } : {}) }; }
  }
}
// "stories": the participant-stories carousel (a <figure data-tm>). The value is a list of
// { quote, name, role, caption, image?, sample? }; image is { src, srcset?, alt, w, h, fx, fy } (a photo: <img class="tm-img">),
// otherwise the slide shows the grey placeholder with the caption as its photo note.
// one slide per item is made from the first slide written in the page, and the progress bars, the "01 / NN" counter and the
// "n of N" labels follow the list. assets/main.js runs the carousel from that markup (any number of slides).
export const initials = (name) => { const w = String(name).trim().split(/\s+/).filter(Boolean); return w.length ? (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase() : ''; };
function storiesHtml(inner, list) {
  if (!Array.isArray(list) || !list.length) return inner;
  const slides = inner.match(/<article class="tm-slide[\s\S]*?<\/article>/g) || [];
  if (!slides.length) return inner;
  const MEDIA = /<img class="tm-img"[^>]*>|<div class="ph is-dark[^"]*"[^>]*>(?:<span class="ph-cap tm-cap">[\s\S]*?<\/span>)?<\/div>/;
  const tpl = slides[0].replace(/<span class="tm-sample">[^<]*<\/span>/, '').replace(/\sdata-sf(?:-type)?="[^"]*"/g, '');
  const phOpen = (inner.match(/<div class="ph is-dark[^"]*"[^>]*>/) || ['<div class="ph is-dark absolute inset-0 rounded-none" style="--ph:#2A2A2A">'])[0];
  const media = (it) => {
    const im = it.image;
    if (im && im.src) return `<img class="tm-img" src="${escHtml(im.src)}"${im.srcset ? ` srcset="${escHtml(im.srcset)}" sizes="(min-width: 1024px) 58vw, 100vw"` : ''} alt="${escHtml(im.alt || '')}" width="${Number(im.w) || 0}" height="${Number(im.h) || 0}" loading="lazy" decoding="async" style="object-position:${Number(im.fx ?? 50)}% ${Number(im.fy ?? 50)}%">`;
    return phOpen + (it.caption ? `<span class="ph-cap tm-cap"><b>Photo</b> · ${escHtml(it.caption)}</span>` : '') + '</div>';
  };
  const n = list.length, pad = (k) => String(k).padStart(2, '0');
  const one = (it, k) => {
    let a = tpl.replace(/^<article class="tm-slide[^"]*"([^>]*)>/, (_m, rest) => `<article class="tm-slide${k ? '' : ' is-on'}"${rest.replace(/\saria-label="[^"]*"/, '').replace(/\s(aria-hidden="true"|inert)/g, '')} aria-label="${k + 1} of ${n}"${k ? ' aria-hidden="true" inert' : ''}>`);
    a = a.replace(/(<blockquote\b[^>]*>)[\s\S]*?(<\/blockquote>)/, `$1${escHtml(it.quote)}$2`)
      .replace(/(<span class="tm-av"[^>]*>)[^<]*(<\/span>)/, `$1${escHtml(initials(it.name))}$2`)
      .replace(/(<span class="block font-medium">)[^<]*(<\/span>)/, `$1${escHtml(it.name)}$2`)
      .replace(/(<span class="block text-white\/65">)[^<]*(<\/span>)/, `$1${escHtml(it.role || '')}$2`)
      .replace(MEDIA, () => media(it));
    // a story still marked as sample keeps its visible "Sample" tag (Studio refuses to send such a list for review)
    return it.sample ? a.replace('<span class="tm-mark"', '<span class="tm-sample">Sample</span><span class="tm-mark"') : a;
  };
  const start = inner.indexOf(slides[0]), last = slides[slides.length - 1], end = inner.indexOf(last) + last.length;
  let out = inner.slice(0, start) + list.map(one).join('\n          ') + inner.slice(end);
  const bars = list.map((_x, k) => `<button type="button" class="tm-bar${k ? '' : ' is-on'}" data-tm-go="${k}" aria-label="Story ${k + 1}"${k ? '' : ' aria-current="true"'}><span></span></button>`).join('');
  out = out.replace(/(<div class="tm-bars">)[\s\S]*?(<\/div>)/, `$1${bars}$2`)
    .replace(/(<b data-tm-cur>)\d+(<\/b> \/ )\d+/, `$1${pad(1)}$2${pad(n)}`);
  return out;
}
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const PHONE = /^\+?[0-9][0-9 ]{5,19}$/;
// "tel" / "mailto" mark a link around a field shown elsewhere inside it (a card with the number in a <span>): the field's
// value only rewrites this link's href, and the markers inside it are still applied.
function hrefMirror(type, open, v) {
  if (type === 'tel' && typeof v === 'string' && PHONE.test(v)) return open.replace(/\shref="[^"]*"/, ` href="tel:${v.replace(/\s+/g, '')}"`);
  if (type === 'mailto' && typeof v === 'string' && EMAIL.test(v)) return open.replace(/\shref="[^"]*"/, ` href="mailto:${escHtml(v)}"`);
  return open;
}
function imageTag(open, v, sizes) {
  let t = open.replace(/\s(src|srcset|sizes|alt|width|height)="[^"]*"/g, '');
  const style = `object-position:${Number(v.fx) || 50}% ${Number(v.fy) || 50}%`;
  t = /\sstyle="/.test(t) ? t.replace(/\sstyle="[^"]*"/, ` style="${style}"`) : t.replace(/\/?>$/, ` style="${style}">`);
  // sizes: the page's data-sf-sizes on the <img> (the hero sends phones a smaller file); otherwise full width
  return t.replace(/^<img\b/, `<img src="${escHtml(v.src)}"${v.srcset ? ` srcset="${escHtml(v.srcset)}" sizes="${escHtml(sizes || '100vw')}"` : ''} alt="${escHtml(v.alt)}" width="${Number(v.w)}" height="${Number(v.h)}"`);
}
export function applyFields(body, vals = {}, opts = {}) {   // opts.mark keeps data-sf="key" (the Studio canvas)
  const re = /<([a-z][a-z0-9]*)\b[^>]*\sdata-sf="([^"]+)"[^>]*>/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(body))) {
    const [raw, tag, key] = m;
    const type = (raw.match(/\sdata-sf-type="([^"]+)"/) || [])[1] || 'text';
    const open = raw.replace(/\sdata-sf(?:-type|-sizes)?="[^"]*"/g, '');
    const v = vals[key];
    const mk = (t) => (opts.mark ? t.replace(/^<([a-z][a-z0-9]*)/i, `<$1 data-sf="${key}"`) : t);
    out += body.slice(last, m.index);
    // "href" sets only the address of a link that holds other fields (a card): its markers inside are still applied
    if (type === 'href') { out += mk(typeof v === 'string' && SAFE_HREF.test(v) ? open.replace(/\shref="[^"]*"/, ` href="${escHtml(v)}"`) : open); last = m.index + raw.length; continue; }
    if (type === 'tel' || type === 'mailto') { out += mk(v === undefined || v === null || v === '' ? open : hrefMirror(type, open, v)); last = m.index + raw.length; continue; }
    if (tag.toLowerCase() === 'img') { out += mk(v !== undefined && type === 'image' && v.src ? imageTag(open, v, (raw.match(/\sdata-sf-sizes="([^"]*)"/) || [])[1]) : open); last = m.index + raw.length; continue; }
    const start = m.index + raw.length, end = closeIndex(body, tag, start), inner = body.slice(start, end);
    // an unedited field keeps its content as written, but markers nested inside it are still applied (and removed)
    if (v === undefined || v === null || v === '') { out += mk(open) + (inner.includes('data-sf=') ? applyFields(inner, vals, opts) : inner); }
    else { const r = fieldValue(type, v, inner, open); out += mk(r.open ?? open) + (r.inner.includes('data-sf=') ? applyFields(r.inner, vals, opts) : r.inner); }   // kept markup (a tail's label) may hold fields
    last = end; re.lastIndex = end;
  }
  return out + body.slice(last);
}


/** Splits a page body into its top-level <section> elements. Each part keeps the text before it (comments, whitespace). */
export function splitSections(body) {
  const parts = []; const re = /<(\/?)section\b[^>]*>/gi; let depth = 0, last = 0, start = 0, m;
  while ((m = re.exec(body))) {
    if (m[1]) { depth -= 1; if (depth === 0) { const end = m.index + m[0].length; const html = body.slice(last, end); const open = body.slice(start, end).match(/^<section\b[^>]*>/i)[0]; const id = (open.match(/\sid="([^"]+)"/i) || open.match(/\sdata-sf-section="([^"]+)"/i) || [])[1] ?? null; parts.push({ id, html }); last = end; } }
    else { if (depth === 0) start = m.index; depth += 1; }
  }
  return { parts, tail: body.slice(last) };
}

/** Puts sections and blocks in layout order. `wrap(id, html, kind)` lets the editor canvas mark each item. */
export function composeSections(body, layout, wrap = null) {
  const { parts, tail } = splitSections(body);
  const w = (id, html, kind) => (wrap ? wrap(id, html, kind) : html);
  if (!Array.isArray(layout)) return parts.map((p) => (p.id ? w(p.id, p.html, 'section') : p.html)).join('') + tail;
  const byId = new Map(parts.filter((p) => p.id).map((p) => [p.id, p]));
  const named = new Set(layout.filter((x) => x && x.section).map((x) => x.section));
  const out = [];
  // hand-written sections missing from the layout keep their source position (after the previous source section)
  const pending = parts.filter((p) => !p.id || !named.has(p.id));
  const flushAfter = (id) => { for (let i = 0; i < pending.length; i++) { const p = pending[i]; const idx = parts.indexOf(p); const prev = parts.slice(0, idx).reverse().find((x) => x.id && named.has(x.id)); if ((prev ? prev.id : null) === id) { out.push(p.id ? w(p.id, p.html, 'section') : p.html); pending.splice(i, 1); i -= 1; } } };
  flushAfter(null);
  for (const item of layout) {
    if (item && item.section && byId.has(item.section)) { if (!item.hidden || wrap) out.push(w(item.section, byId.get(item.section).html, item.hidden ? 'hidden-section' : 'section')); flushAfter(item.section); }
    else if (item && item.block && typeof item.html === 'string' && (!item.hidden || wrap)) out.push(w(item.block, '\n\n' + item.html, item.hidden ? 'hidden-block' : 'block'));
  }
  for (const p of pending) out.push(p.id ? w(p.id, p.html, 'section') : p.html);
  return out.join('') + tail;
}

/** Full transform for one page entry from page-fields.json: { fields, layout }. data-sf-section="name" names a top-level
 *  section written without an id (for Studio's section list only); like the field markers it is never published. */
export const stripSectionNames = (html) => html.replace(/(<section\b[^>]*?)\sdata-sf-section="[^"]*"/gi, '$1');
export function renderPage(body, entry) {
  if (!entry) return stripSectionNames(applyFields(body, {}));
  return stripSectionNames(composeSections(applyFields(body, entry.fields || {}), entry.layout));
}
