// Studio page fields and section composition, shared by build.mjs (the live site) and AFCD Studio (the editor canvas),
// so the preview and the published page come from the same code. Plain JavaScript, no dependencies.
//
// Fields: elements marked data-sf="key" (optionally data-sf-type) in a page source take edited values (plain text, escaped
// here). The markers are always removed from the output, so an unedited page builds exactly as written.
// Sections: an entry may carry a layout, an ordered list of { section: "<id of a top-level <section>>" } and
// { block: "<id>", html: "<HTML rendered by Studio's block registry>" }; either may have hidden: true. Top-level
// sections that the layout does not mention stay at their source position, so new hand-written sections never disappear.

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SAFE_HREF = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:\+?[0-9 ]+|#[a-z0-9-]+|[a-z0-9-]+\.html(#[a-z0-9-]+)?)$/i;
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
    case 'tail': { const i = inner.lastIndexOf('</span>'); return { inner: (i >= 0 ? inner.slice(0, i + 7) : '') + escHtml(v) }; }
    case 'link': {
      const rest = inner.search(/\s*<span/); const tailHtml = rest >= 0 ? inner.slice(rest) : '';
      return { inner: escHtml(v.label) + tailHtml, open: v.href && SAFE_HREF.test(v.href) ? open.replace(/\shref="[^"]*"/, ` href="${escHtml(v.href)}"`) : open };
    }
    default: return { inner: escHtml(v) };
  }
}
function imageTag(open, v) {
  let t = open.replace(/\s(src|srcset|sizes|alt|width|height)="[^"]*"/g, '');
  const style = `object-position:${Number(v.fx) || 50}% ${Number(v.fy) || 50}%`;
  t = /\sstyle="/.test(t) ? t.replace(/\sstyle="[^"]*"/, ` style="${style}"`) : t.replace(/\/?>$/, ` style="${style}">`);
  return t.replace(/^<img\b/, `<img src="${escHtml(v.src)}"${v.srcset ? ` srcset="${escHtml(v.srcset)}" sizes="100vw"` : ''} alt="${escHtml(v.alt)}" width="${Number(v.w)}" height="${Number(v.h)}"`);
}
export function applyFields(body, vals = {}, opts = {}) {   // opts.mark keeps data-sf="key" (the Studio canvas)
  const re = /<([a-z][a-z0-9]*)\b[^>]*\sdata-sf="([^"]+)"[^>]*>/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(body))) {
    const [raw, tag, key] = m;
    const type = (raw.match(/\sdata-sf-type="([^"]+)"/) || [])[1] || 'text';
    const open = raw.replace(/\sdata-sf(?:-type)?="[^"]*"/g, '');
    const v = vals[key];
    const mk = (t) => (opts.mark ? t.replace(/^<([a-z][a-z0-9]*)/i, `<$1 data-sf="${key}"`) : t);
    out += body.slice(last, m.index);
    if (tag.toLowerCase() === 'img') { out += mk(v !== undefined && type === 'image' && v.src ? imageTag(open, v) : open); last = m.index + raw.length; continue; }
    const start = m.index + raw.length, end = closeIndex(body, tag, start), inner = body.slice(start, end);
    if (v === undefined || v === null || v === '') { out += mk(open) + inner; }
    else { const r = fieldValue(type, v, inner, open); out += mk(r.open ?? open) + r.inner; }
    last = end; re.lastIndex = end;
  }
  return out + body.slice(last);
}


/** Splits a page body into its top-level <section> elements. Each part keeps the text before it (comments, whitespace). */
export function splitSections(body) {
  const parts = []; const re = /<(\/?)section\b[^>]*>/gi; let depth = 0, last = 0, start = 0, m;
  while ((m = re.exec(body))) {
    if (m[1]) { depth -= 1; if (depth === 0) { const end = m.index + m[0].length; const html = body.slice(last, end); const id = (body.slice(start, end).match(/^<section\b[^>]*\sid="([^"]+)"/i) || [])[1] ?? null; parts.push({ id, html }); last = end; } }
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

/** Full transform for one page entry from page-fields.json: { fields, layout }. */
export function renderPage(body, entry) {
  if (!entry) return applyFields(body, {});
  return composeSections(applyFields(body, entry.fields || {}), entry.layout);
}
