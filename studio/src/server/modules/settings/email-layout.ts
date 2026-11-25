// Branded email layout for everything Studio sends (Inbox replies, test emails, notifications).
// One table-based, inline-styled design that renders the same in Gmail, Outlook, Apple Mail and on phones: logo header,
// optional heading, the text, an optional button and details card, a sign-off, and a footer with contact details, social
// links and a short legal note. Every message also gets a plain-text version. All values are escaped; links must be
// https:// or mailto:. Monochrome, like the website.
import type { DB } from '../../db/client.ts';
import { loadRows } from './service.ts';
import { design as loadDesign, fillVars, type Design } from './templates.ts';

export type Brand = {
  siteName: string; siteUrl: string; logoUrl: string;
  email: string; phone: string; social: { label: string; url: string }[];
};
export type EmailContent = {
  subject: string;
  body: string;                                            // plain text; blank lines separate paragraphs, "> " lines are quoted
  heading?: string; preheader?: string;
  button?: { label: string; url: string } | null;
  details?: { title?: string; rows: { label: string; value: string }[] } | null;
  signature?: string;                                      // already filled in; plain text
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const safeUrl = (u: string) => (/^(https:\/\/|mailto:)[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : '');
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = '#18181B', TEXT = '#3F3F46', MUTED = '#71717A', LINE = '#E4E4E7', CANVAS = '#F4F4F5';

/** Escaped text with https links made clickable. */
function inline(s: string) {
  return esc(s).replace(/https:\/\/[^\s<>&"']+(?:&amp;[^\s<>&"']+)*/g, (u) => {
    const trail = u.match(/[.,;:!?)]+$/)?.[0] ?? '';
    const href = u.slice(0, u.length - trail.length);
    return `<a href="${href}" style="color:${INK};text-decoration:underline">${href}</a>${trail}`;
  });
}

/** Plain text → paragraphs, line breaks, "> " quote blocks and "---" rules. */
function bodyHtml(text: string) {
  const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^>/.test(l))) {
      const q = lines.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>');
      return `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid ${LINE};color:${MUTED};font-size:14px;line-height:1.6">${q}</div>`;
    }
    if (lines.length === 1 && /^-{3,}$/.test(lines[0].trim())) return `<div style="height:1px;margin:24px 0;background:${LINE};line-height:1px;font-size:1px">&nbsp;</div>`;
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:${TEXT}">${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

export function renderEmail(c: EmailContent, b: Brand, d: Design): { html: string; text: string } {
  const url = (p = '') => b.siteUrl + p;
  const btnUrl = c.button ? safeUrl(c.button.url) : '';
  const rows = (c.details?.rows ?? []).filter((r) => r.label.trim() || r.value.trim());
  const year = new Date().getFullYear();
  const contact = [d.showContact && b.email ? `<a href="mailto:${esc(b.email)}" style="color:${MUTED};text-decoration:underline">${esc(b.email)}</a>` : '',
    d.showContact && b.phone ? esc(b.phone) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const social = d.showSocial ? b.social.filter((s) => safeUrl(s.url)) : [];

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>${esc(c.subject)}</title>
<style>@media (max-width:620px){.card{border-radius:0!important}.pad{padding-left:24px!important;padding-right:24px!important}.btn a{display:block!important;text-align:center!important}}</style></head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;font-family:${FONT}">
<tr><td class="pad" style="padding:32px 40px 8px"><a href="${esc(url())}" style="text-decoration:none"><img src="${esc(b.logoUrl)}" width="154" height="32" alt="${esc(b.siteName)}" style="display:block;border:0;height:32px;width:auto;max-width:200px"></a></td></tr>
<tr><td class="pad" style="padding:24px 40px 8px">
${c.heading ? `<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;font-weight:700;color:${INK};letter-spacing:-0.01em">${esc(c.heading)}</h1>` : ''}
${bodyHtml(c.body)}
${btnUrl ? `<table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:12px;background:${INK}"><a href="${esc(btnUrl)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;line-height:1.2;color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(c.button!.label)}</a></td></tr></table>` : ''}
${rows.length || c.details?.title ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${CANVAS};border-radius:12px"><tr><td style="padding:22px 24px">
${c.details?.title ? `<div style="margin:0 0 12px;font-size:18px;font-weight:700;color:${INK}">${esc(c.details.title)}</div>` : ''}
${rows.map((r) => `<div style="margin:0 0 8px;font-size:15px;line-height:1.5;color:${TEXT}">${r.label.trim() ? `<b style="color:${INK}">${esc(r.label.trim())}:</b> ` : ''}${inline(r.value)}</div>`).join('\n')}
</td></tr></table>` : ''}
${c.signature?.trim() ? `<p style="margin:8px 0 16px;font-size:16px;line-height:1.65;color:${TEXT}">${c.signature.trim().split('\n').map(inline).join('<br>')}</p>` : ''}
</td></tr>
<tr><td class="pad" style="padding:8px 40px 36px"><div style="height:1px;margin:8px 0 24px;background:${LINE};line-height:1px;font-size:1px">&nbsp;</div>
<div style="font-size:14px;font-weight:700;color:${INK};margin:0 0 6px">${esc(b.siteName)}</div>
${contact ? `<div style="font-size:13px;line-height:1.6;color:${MUTED};margin:0 0 12px">${contact}</div>` : ''}
${social.length ? `<div style="margin:0 0 16px">${social.map((s) => `<a href="${esc(safeUrl(s.url))}" style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border:1px solid ${LINE};border-radius:999px;font-size:12px;font-weight:600;color:${INK};text-decoration:none">${esc(s.label)}</a>`).join('')}</div>` : ''}
${d.footerNote.trim() ? `<div style="font-size:12px;line-height:1.6;color:${MUTED};margin:0 0 12px">${inline(d.footerNote.trim())}</div>` : ''}
<div style="font-size:12px;line-height:1.6;color:${MUTED}"><a href="${esc(url())}" style="color:${MUTED};text-decoration:underline">${esc(b.siteUrl.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a> &nbsp;·&nbsp; © ${year} ${esc(b.siteName)}</div>
</td></tr></table>
</td></tr></table></body></html>`;

  const text = [
    c.heading ?? '', c.body.trim(),
    btnUrl ? `${c.button!.label}: ${btnUrl}` : '',
    rows.length || c.details?.title ? [c.details?.title ?? '', ...rows.map((r) => (r.label.trim() ? `${r.label.trim()}: ${r.value}` : r.value))].filter(Boolean).join('\n') : '',
    c.signature?.trim() ?? '',
    ['--', b.siteName, d.showContact ? [b.email, b.phone].filter(Boolean).join(' · ') : '', social.map((s) => `${s.label}: ${s.url}`).join('\n'), d.footerNote.trim(), b.siteUrl].filter(Boolean).join('\n'),
  ].filter((x) => x.trim()).join('\n\n');
  return { html, text };
}

/** The organisation's details from Settings (General, Contact & social), as saved in Studio. */
export async function brand(db: DB): Promise<Brand> {
  const s = await loadRows(db);
  const g = s.general.draft, c = s.contact.draft;
  const siteUrl = /\/$/.test(g.canonicalUrl) ? g.canonicalUrl : `${g.canonicalUrl}/`;
  return {
    siteName: g.siteName, siteUrl, logoUrl: `${siteUrl}assets/brand/afcd-logo.png`,
    email: c.generalEmail, phone: c.phone,
    social: [['Facebook', c.social.facebook], ['Instagram', c.social.instagram], ['LinkedIn', c.social.linkedin]].filter(([, u]) => u).map(([label, url]) => ({ label, url })),
  };
}

/** A message ready for deliver(): the branded HTML and its text version, or text only when branding is off.
 *  `vars` fill the design's signature and footer note (sender_name, organization, today…); a given `signature` wins. */
export async function compose(db: DB, c: EmailContent, vars: Record<string, string> = {}): Promise<{ text: string; html?: string }> {
  const d0 = await loadDesign(db);
  const d: Design = { ...d0, footerNote: fillVars(d0.footerNote, vars) };
  const msg: EmailContent = { ...c, signature: c.signature ?? fillVars(d0.signature, vars) };
  if (!d.branded) {
    const text = [msg.heading ?? '', msg.body.trim(), msg.button && safeUrl(msg.button.url) ? `${msg.button.label}: ${safeUrl(msg.button.url)}` : '',
      msg.details ? [msg.details.title ?? '', ...msg.details.rows.map((r) => (r.label ? `${r.label}: ${r.value}` : r.value))].filter(Boolean).join('\n') : '', msg.signature ?? ''].filter((x) => x.trim()).join('\n\n');
    return { text };
  }
  return renderEmail(msg, await brand(db), d);
}
