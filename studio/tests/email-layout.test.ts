// Branded email layout (Settings → Email templates): escaping, safe links, parts, text version, and templates with the new parts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderEmail, safeUrl, type Brand } from '../src/server/modules/settings/email-layout.ts';
import { DESIGN_DEFAULTS } from '../src/server/modules/settings/templates.ts';
import { makeApp, addUser, client } from './helpers.ts';

const B: Brand = { siteName: 'AFCD Foundation', siteUrl: 'https://afcdfoundation.com/', logoUrl: 'https://afcdfoundation.com/assets/brand/afcd-logo.png',
  email: 'contact@afcdteam.com', phone: '+212 663 618 536', social: [{ label: 'Facebook', url: 'https://www.facebook.com/afcd.foundation' }] };

describe('email layout', () => {
  it('escapes text, keeps only https/mailto links, and renders every part', () => {
    const { html, text } = renderEmail({
      subject: 'Hi <b>', heading: 'Welcome <script>', preheader: 'Short preview', body: 'Hello <img src=x onerror=1>\n\nSee https://afcdfoundation.com/events.html.\n\n> quoted line',
      button: { label: 'Open', url: 'javascript:alert(1)' }, details: { title: 'Your event', rows: [{ label: 'Date', value: '12 Dec' }] }, signature: 'Amina',
    }, B, DESIGN_DEFAULTS);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x');
    expect(html).toContain('Welcome &lt;script&gt;');
    expect(html).not.toContain('javascript:');                                   // unsafe button dropped
    expect(html).toContain('<a href="https://afcdfoundation.com/events.html"');  // links are clickable, trailing dot kept outside
    expect(html).toContain('<b style="color:#18181B">Date:</b> 12 Dec');
    expect(html).toContain('Short preview'); expect(html).toContain('Facebook'); expect(html).toContain('contact@afcdteam.com');
    expect(text).toContain('Your event\nDate: 12 Dec'); expect(text).not.toContain('Open:');
    expect(renderEmail({ subject: 's', body: 'b', button: { label: 'Go', url: 'https://afcdfoundation.com/' } }, B, DESIGN_DEFAULTS).text).toContain('Go: https://afcdfoundation.com/');
    expect(safeUrl('mailto:a@b.org')).toBe('mailto:a@b.org'); expect(safeUrl('http://x.org')).toBe('');
  });
  it('hides contact and social links when the design says so', () => {
    const { html } = renderEmail({ subject: 's', body: 'b' }, B, { ...DESIGN_DEFAULTS, showContact: false, showSocial: false });
    expect(html).not.toContain('contact@afcdteam.com'); expect(html).not.toContain('Facebook');
  });
});

describe('templates with layout parts', () => {
  let h: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => { h = await makeApp(); });
  afterEach(async () => { await h?.close(); });
  it('saves the parts and the design, refuses unsafe links and unknown variables, and previews HTML', async () => {
    await addUser(h.db, 'seo@afcd.test', 'seo_manager'); const u = await client(h.app, 'seo@afcd.test');
    const tpl = { name: 'Event', subject: 'Your place', heading: 'See you, {{contact_first_name}}', preheader: '', body: 'Hello {{contact_first_name}}',
      button: { label: 'Event page', url: 'https://afcdfoundation.com/events.html' }, details: { title: 'Details', rows: [{ label: 'Topic', value: '{{topic}}' }] } };
    expect((await u.put('/settings/templates', { templates: [{ ...tpl, button: { label: 'x', url: 'javascript:alert(1)' } }] })).status).toBe(422);
    expect((await u.put('/settings/templates', { templates: [{ ...tpl, heading: '{{contact_email}}' }] })).status).toBe(422);
    const design = { ...DESIGN_DEFAULTS, signature: '{{sender_name}}\n{{organization}}' };
    const ok = await u.put('/settings/templates', { templates: [tpl], design });
    expect(ok.status).toBe(200);
    expect(ok.body.changed).toEqual(expect.arrayContaining(['Event', 'Email design']));
    const got = await u.get('/settings/templates');
    expect(got.body.design).toEqual(design);
    expect(got.body.templates[0]).toMatchObject({ heading: 'See you, {{contact_first_name}}', button: tpl.button });
    const pv = await u.post('/settings/templates/preview', { ...tpl, design: { ...design, showSocial: false } });
    expect(pv.body.heading).toBe('See you, Amina');
    expect(pv.body.html).toContain('Event page'); expect(pv.body.html).toContain('Studio User');
    expect(pv.body.html).not.toContain('>Facebook<');
  });
});
