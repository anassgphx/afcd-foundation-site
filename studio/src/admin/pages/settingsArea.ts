// Settings is shown as two areas in the sidebar: "Website settings" (what visitors see: organization, branding, contact,
// domain, SEO facts, languages, media, performance) and "System" (what runs Studio: email, templates, notifications,
// security, backups, maintenance). The categories and their groups stay in the server catalog; this only says which
// group belongs to which area. History lists every change and is part of Website settings.
import { CATEGORIES } from '../../server/modules/settings/catalog.ts';

export type SettingsArea = 'website' | 'system';
export const AREA_GROUPS: Record<SettingsArea, string[]> = { website: ['Organization', 'Website'], system: ['Communication', 'System'] };
export const AREA_TITLE: Record<SettingsArea, { title: string; intro: string; first: string }> = {
  website: { title: 'Website settings', intro: 'What visitors see: the organization, branding, contact details and the website’s own checks. Changes are saved as drafts until you publish them.', first: 'general' },
  system: { title: 'System', intro: 'What runs Studio: the email server and templates, notifications, security, backups and maintenance.', first: 'email' },
};

/** The area of a Settings address: /studio/settings/<category>. Unknown or no category: Website settings. */
export function settingsArea(path: string): SettingsArea {
  const id = path.replace(/^\/studio\/settings\/?/, '').split(/[/?#]/)[0];
  const group = CATEGORIES.find((c) => c.id === id)?.group;
  return group && AREA_GROUPS.system.includes(group) ? 'system' : 'website';
}
