// Settings Center catalog: the 15 categories in four groups, and a field index for settings search.
// `kind`: 'edit' = settings stored and changed here; 'facts' = a live summary read from the owning part of Studio (with
// a link there; nothing duplicated). `effect` says what a change needs before it is visible:
// 'publish' = Publish settings (writes src/data/site-settings.json and rebuilds the site), 'immediate' = used by Studio
// at once, 'restart' = an environment value in studio/.env (restart Studio), 'none' = read-only.
export type Effect = 'publish' | 'immediate' | 'restart' | 'none';
export type Category = {
  id: string; label: string; icon: string; group: string; kind: 'edit' | 'facts'; summary: string; admin?: boolean;
  link?: { to: string; label: string };
};

export const GROUPS = ['Organization', 'Communication', 'Website', 'System'] as const;
export const CATEGORIES: Category[] = [
  { id: 'general', group: 'Organization', label: 'General', icon: 'globe', kind: 'edit', summary: 'Site name, canonical domain and build environment.' },
  { id: 'branding', group: 'Organization', label: 'Branding', icon: 'image', kind: 'edit', summary: 'Logos, favicon, default share image and browser colour.' },
  { id: 'contact', group: 'Organization', label: 'Contact & social', icon: 'mail', kind: 'edit', summary: 'Phone, public emails and social profiles used across the site.' },
  { id: 'email', group: 'Communication', label: 'Email & SMTP', icon: 'send', kind: 'edit', summary: 'The email server Studio uses for Inbox replies, notices and tests.' },
  { id: 'templates', group: 'Communication', label: 'Email templates', icon: 'log', kind: 'edit', summary: 'Reusable Inbox replies with safe variables.' },
  { id: 'notifications', group: 'Communication', label: 'Notifications', icon: 'bell', kind: 'edit', admin: true, summary: 'Who is emailed when website messages arrive.' },
  { id: 'domain', group: 'Website', label: 'Domain & DNS', icon: 'globe', kind: 'edit', summary: 'Live DNS and HTTPS checks for the website and email domains.' },
  { id: 'seo', group: 'Website', label: 'SEO & analytics', icon: 'search', kind: 'facts', summary: 'Indexing, Search Console, sitemap and redirects.', link: { to: '/studio/seo', label: 'Open SEO' } },
  { id: 'localization', group: 'Website', label: 'Localization', icon: 'languages', kind: 'facts', summary: 'French and Arabic versions of the site.', link: { to: '/studio/translations', label: 'Open Translations' } },
  { id: 'media', group: 'Website', label: 'Media', icon: 'image', kind: 'facts', summary: 'Images, alt text and usage rights.', link: { to: '/studio/media', label: 'Open Media library' } },
  { id: 'performance', group: 'Website', label: 'Performance', icon: 'rocket', kind: 'facts', summary: 'Page and asset sizes of the built site, build times.' },
  { id: 'security', group: 'System', label: 'Security & access', icon: 'lock', kind: 'facts', admin: true, summary: 'Roles, sign-ins, sessions and transport security.', link: { to: '/studio/users', label: 'Open Users & roles' } },
  { id: 'backups', group: 'System', label: 'Backups', icon: 'archive', kind: 'edit', admin: true, summary: 'Database backups made by Studio and by hand.' },
  { id: 'maintenance', group: 'System', label: 'Maintenance', icon: 'clock', kind: 'facts', admin: true, summary: 'Publishing jobs, background jobs and the scheduler.', link: { to: '/studio/publishing', label: 'Open Publishing' } },
  { id: 'advanced', group: 'System', label: 'Advanced & diagnostics', icon: 'monitor', kind: 'facts', admin: true, summary: 'Read-only facts about this Studio installation.' },
];

/** Every setting a person might search for, with where it lives. Search runs over this list only. */
export const FIELDS: { category: string; key: string; label: string; keywords: string; effect: Effect; admin?: boolean }[] = [
  { category: 'general', key: 'siteName', label: 'Site name', keywords: 'name organization og site_name title', effect: 'publish' },
  { category: 'general', key: 'canonicalUrl', label: 'Canonical domain', keywords: 'domain url canonical https sitemap', effect: 'publish', admin: true },
  { category: 'general', key: 'environment', label: 'Build environment', keywords: 'production preview noindex robots indexing', effect: 'publish', admin: true },
  { category: 'general', key: 'identity', label: 'Legal name, description, founding year', keywords: 'legal name description founded schema organization identity', effect: 'none' },
  { category: 'branding', key: 'logoMediaId', label: 'Header logo', keywords: 'logo brand header', effect: 'publish' },
  { category: 'branding', key: 'logoLightMediaId', label: 'Footer logo (on black)', keywords: 'logo white footer dark', effect: 'publish' },
  { category: 'branding', key: 'faviconMediaId', label: 'Favicon', keywords: 'favicon icon tab browser', effect: 'publish' },
  { category: 'branding', key: 'socialImageMediaId', label: 'Default share image', keywords: 'og image social share open graph facebook', effect: 'publish' },
  { category: 'branding', key: 'themeColor', label: 'Browser colour', keywords: 'theme color colour monochrome black white', effect: 'publish' },
  { category: 'contact', key: 'phone', label: 'Phone number', keywords: 'phone telephone call tel', effect: 'publish' },
  { category: 'contact', key: 'generalEmail', label: 'General email', keywords: 'email contact mail', effect: 'publish' },
  { category: 'contact', key: 'boardEmail', label: 'Board email', keywords: 'email board governance', effect: 'publish' },
  { category: 'contact', key: 'social.facebook', label: 'Social profiles', keywords: 'facebook instagram linkedin social sameas', effect: 'publish' },
  { category: 'contact', key: 'address', label: 'Office address', keywords: 'address street city marrakech office', effect: 'none' },
  { category: 'email', key: 'host', label: 'SMTP server', keywords: 'smtp host server port tls starttls', effect: 'immediate', admin: true },
  { category: 'email', key: 'password', label: 'SMTP username and password', keywords: 'smtp login password user credentials', effect: 'immediate', admin: true },
  { category: 'email', key: 'fromEmail', label: 'Sender address', keywords: 'from sender reply-to', effect: 'immediate', admin: true },
  { category: 'email', key: 'test', label: 'Send test email', keywords: 'test email diagnostics connection', effect: 'immediate', admin: true },
  { category: 'templates', key: 'templates', label: 'Reply templates', keywords: 'template canned reply inbox variables', effect: 'immediate' },
  { category: 'notifications', key: 'notify', label: 'New message notices', keywords: 'notification alert email inbox new message', effect: 'immediate', admin: true },
  { category: 'domain', key: 'domain-check', label: 'DNS check', keywords: 'dns mx spf dmarc https domain records', effect: 'none' },
  { category: 'seo', key: 'seo', label: 'Search Console and indexing', keywords: 'google search console analytics ga4 sitemap robots redirects', effect: 'none' },
  { category: 'localization', key: 'langs', label: 'Languages', keywords: 'french arabic translation language rtl', effect: 'none' },
  { category: 'media', key: 'media', label: 'Image rights and alt text', keywords: 'images upload limit alt rights licence', effect: 'none' },
  { category: 'performance', key: 'perf', label: 'Page sizes', keywords: 'speed size weight build time css js', effect: 'none' },
  { category: 'security', key: 'sessions', label: 'Sessions and sign-ins', keywords: 'security sessions sign out login failed password roles https', effect: 'immediate', admin: true },
  { category: 'backups', key: 'backup', label: 'Database backup', keywords: 'backup restore database export', effect: 'immediate', admin: true },
  { category: 'maintenance', key: 'jobs', label: 'Publishing and background jobs', keywords: 'jobs scheduler maintenance failed build', effect: 'none', admin: true },
  { category: 'advanced', key: 'diagnostics', label: 'Installation facts', keywords: 'version node database migrations encryption key data folder', effect: 'none', admin: true },
];
