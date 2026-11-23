// Story text <-> editor document.
//
// Stories are stored as the small text format that news/render.ts turns into website HTML (and that the
// translations, review diffs and revisions already understand). The visual editor only changes how people write it:
// parse() turns the stored text into an editor document, serialize() turns the document back into the same text.
// Anything the format cannot express (pasted fonts, colours, tables…) never enters the document in the first place.

export type Mark = { type: 'bold' | 'italic' | 'link'; attrs?: { href: string } };
export type Node = { type: string; attrs?: Record<string, any>; content?: Node[]; text?: string; marks?: Mark[] };
export type Layout = 'full' | 'center' | 'left' | 'right';
export type Photo = { id: string; caption: string; layout: Layout };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMG = new RegExp(`!\\[([^\\]\\n]{0,300})\\]\\(media:(${UUID})(?:\\s+"(full|center|left|right)")?\\)`, 'g');
const imgLine = (l: string) => l.trim() !== '' && l.replace(IMG, '').trim() === '';
const BUTTON = /^\[([^\]\n]{1,80})\]\(([^)\s]{1,500})\s+"(button|button-light)"\)$/;
const VIDEO = /^!video\((\S{1,300}?)(?:\s+"([^"\n]{0,200})")?\)$/;
const CALLOUT = /^>\s?\[!(NOTE|TIP|IMPORTANT)\]\s*(.*)$/i;
export const SAFE_LINK = /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:\+?[0-9 ]+|[a-z0-9-]+\.html(#[a-z0-9-]+)?|#[a-z0-9-]+)$/i;   // same rule as the website
export const VIDEO_OK = /^https:\/\/((www\.|m\.)?(youtube\.com\/(watch\?(\S*&)?v=|embed\/|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}|(www\.|player\.)?vimeo\.com\/(video\/)?\d{6,12})/;
export function videoSrc(url: string) {
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:\S*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/); if (m) return `https://player.vimeo.com/video/${m[1]}?dnt=1`;
  return null;
}

// ---------------------------------------------------------------- inline: **bold**, *italic*, [text](url)
const INLINE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|\*\*([^*\n]{1,300})\*\*|\*([^*\n]{1,300})\*/g;
export function parseInline(s: string, marks: Mark[] = []): Node[] {
  const out: Node[] = []; let last = 0;
  const push = (text: string, m: Mark[]) => { if (text) out.push(m.length ? { type: 'text', text, marks: m } : { type: 'text', text }); };
  for (const m of s.matchAll(INLINE)) {
    push(s.slice(last, m.index), marks);
    if (m[1] !== undefined) out.push(...parseInline(m[1], [...marks, { type: 'link', attrs: { href: m[2] } }]));
    else if (m[3] !== undefined) out.push(...parseInline(m[3], [...marks, { type: 'bold' }]));
    else out.push(...parseInline(m[4], [...marks, { type: 'italic' }]));
    last = m.index! + m[0].length;
  }
  push(s.slice(last), marks);
  return out;
}
/** A line of text with hard line breaks between lines. */
const lines = (ls: string[]): Node[] => ls.flatMap((l, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...parseInline(l)]);
const para = (ls: string[]): Node => { const c = lines(ls); return c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' }; };

export function serializeInline(input: Node[] = []): string {
  let nodes = input;
  let out = '';
  for (let i = 0; i < nodes.length;) {
    const n = nodes[i];
    if (n.type === 'hardBreak') { out += '\n'; i++; continue; }
    const link = n.marks?.find((m) => m.type === 'link');
    if (link && !SAFE_LINK.test(String(link.attrs?.href ?? '').trim())) {   // a link the website would refuse (e.g. http://, javascript:) is kept as plain text
      nodes = nodes.map((x, k) => (k >= i && x.marks?.some((m) => m.type === 'link' && m.attrs?.href === link.attrs?.href) ? { ...x, marks: x.marks!.filter((m) => m.type !== 'link') } : x)); continue;
    }
    if (link) {   // consecutive text with the same link becomes one [text](url)
      const run: Node[] = [];
      while (i < nodes.length && nodes[i].marks?.some((m) => m.type === 'link' && m.attrs?.href === link.attrs?.href)) { run.push({ ...nodes[i], marks: nodes[i].marks!.filter((m) => m.type !== 'link') }); i++; }
      out += `[${serializeInline(run).replace(/[[\]\n]/g, ' ')}](${link.attrs!.href})`; continue;
    }
    // merge neighbours that share the same marks, then wrap once
    let text = n.text ?? ''; const key = (x: Node) => (x.marks ?? []).map((m) => m.type).sort().join();
    i++;
    while (i < nodes.length && nodes[i].type === 'text' && !nodes[i].marks?.some((m) => m.type === 'link') && key(nodes[i]) === key(n)) { text += nodes[i].text; i++; }
    const b = n.marks?.some((m) => m.type === 'bold'), it = n.marks?.some((m) => m.type === 'italic');
    const lead = text.match(/^\s*/)![0], trail = text.match(/\s*$/)![0]; const core = text.trim();   // markers hug the words, not the spaces
    out += core ? lead + (b ? '**' : '') + (it ? '*' : '') + core + (it ? '*' : '') + (b ? '**' : '') + trail : text;
  }
  return out;
}
const plain = (nodes: Node[] = []) => nodes.map((n) => (n.type === 'hardBreak' ? ' ' : n.text ?? '')).join('');

// ---------------------------------------------------------------- blocks
export function parse(raw: string): Node {
  const alone = (l: string) => imgLine(l) || BUTTON.test(l.trim()) || VIDEO.test(l.trim()) || /^-{3,}$/.test(l.trim());
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => (alone(l) ? `\n\n${l.trim()}\n\n` : l)).join('\n');
  const content: Node[] = [];
  for (const block of text.trim().split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) {
    const ls = block.split('\n'); let m: RegExpMatchArray | null;
    if (ls.length === 1 && imgLine(block)) {
      const items = [...block.matchAll(IMG)].map((x) => ({ caption: x[1], id: x[2], layout: (x[3] ?? 'full') as Layout }));
      content.push({ type: 'photos', attrs: { items } }); continue;
    }
    if (/^-{3,}$/.test(block)) { content.push({ type: 'horizontalRule' }); continue; }
    if ((m = block.match(BUTTON))) { content.push({ type: 'ctaButton', attrs: { text: m[1], href: m[2], style: m[3] === 'button-light' ? 'light' : 'solid' } }); continue; }
    if ((m = block.match(VIDEO))) { content.push({ type: 'video', attrs: { url: m[1], caption: m[2] ?? '' } }); continue; }
    if (/^###\s+/.test(block)) { content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: block.replace(/^###\s+/, '').replace(/\n/g, ' ') }] }); continue; }
    if (/^##\s+/.test(block)) { content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: block.replace(/^##\s+/, '').replace(/\n/g, ' ') }] }); continue; }
    if (ls.every((l) => /^\d{1,3}[.)]\s+/.test(l))) { content.push({ type: 'orderedList', content: ls.map((l) => ({ type: 'listItem', content: [para([l.replace(/^\d{1,3}[.)]\s+/, '')])] })) }); continue; }
    if (ls.every((l) => /^\s*-\s+/.test(l))) { content.push({ type: 'bulletList', content: ls.map((l) => ({ type: 'listItem', content: [para([l.replace(/^\s*-\s+/, '')])] })) }); continue; }
    if (ls.every((l) => /^>\s?/.test(l))) {
      const c = ls[0].match(CALLOUT); const inner = ls.map((l) => l.replace(/^>\s?/, ''));
      if (c) { content.push({ type: 'callout', attrs: { kind: c[1].toLowerCase(), title: c[2].trim() }, content: [para(inner.slice(1).length ? inner.slice(1) : [''])] }); continue; }
      content.push({ type: 'blockquote', content: inner.map((l) => para([l])) }); continue;
    }
    content.push(para(ls));
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

export function serialize(doc: Node): string {
  const out: string[] = [];
  for (const n of doc.content ?? []) {
    switch (n.type) {
      case 'paragraph': { const s = serializeInline(n.content).replace(/\n+$/, ''); if (s.trim()) out.push(s); break; }
      case 'heading': { const s = plain(n.content).trim(); if (s) out.push(`${n.attrs?.level === 3 ? '###' : '##'} ${s}`); break; }
      case 'bulletList': case 'orderedList': {
        const items = (n.content ?? []).map((li) => (li.content ?? []).map((p) => serializeInline(p.content).replace(/\n/g, ' ')).join(' ').trim()).filter(Boolean);
        if (items.length) out.push(items.map((t, i) => `${n.type === 'orderedList' ? `${i + 1}.` : '-'} ${t}`).join('\n')); break;
      }
      case 'blockquote': {
        const ls = (n.content ?? []).flatMap((p) => serializeInline(p.content).split('\n')).filter((l) => l.trim());
        if (ls.length) out.push(ls.map((l) => `> ${l}`).join('\n')); break;
      }
      case 'callout': {
        const ls = (n.content ?? []).flatMap((p) => serializeInline(p.content).split('\n')).filter((l) => l.trim());
        out.push([`> [!${String(n.attrs?.kind ?? 'note').toUpperCase()}]${n.attrs?.title ? ` ${String(n.attrs.title).replace(/\n/g, ' ').trim()}` : ''}`, ...ls.map((l) => `> ${l}`)].join('\n')); break;
      }
      case 'horizontalRule': out.push('---'); break;
      case 'ctaButton': if (n.attrs?.text && n.attrs?.href) out.push(`[${String(n.attrs.text).replace(/[[\]\n]/g, ' ').trim()}](${n.attrs.href} "${n.attrs.style === 'light' ? 'button-light' : 'button'}")`); break;
      case 'video': if (n.attrs?.url) out.push(`!video(${n.attrs.url}${n.attrs.caption ? ` "${String(n.attrs.caption).replace(/["\n]/g, ' ').trim()}"` : ''})`); break;
      case 'photos': {
        const items = (n.attrs?.items ?? []) as Photo[];
        if (items.length) out.push(items.map((p) => `![${(p.caption ?? '').replace(/[\]\n]/g, ' ')}](media:${p.id}${items.length === 1 && p.layout && p.layout !== 'full' ? ` "${p.layout}"` : ''})`).join(' ')); break;
      }
    }
  }
  return out.join('\n\n');
}
