// Roles and permissions. Checked on the server for every request; the admin UI only mirrors them.
export const PERMISSIONS = [
  'dashboard.read',
  'project.read', 'project.create', 'project.update', 'project.seo', 'project.archive',
  'project.review', 'project.approve', 'project.publish',
  'page.read', 'page.create', 'page.update', 'page.approve', 'page.publish',
  'news.read', 'news.create', 'news.update', 'news.approve', 'news.publish',
  'partner.read', 'partner.create', 'partner.update', 'partner.approve', 'partner.publish',
  'pillar.read', 'pillar.create', 'pillar.update', 'pillar.approve', 'pillar.publish',
  // About pages (Our Story, Mission & Vision, Strategy, Team, Partners page texts)
  'about.read', 'about.update', 'about.approve', 'about.publish',
  'event.read', 'event.create', 'event.update', 'event.approve', 'event.publish',
  'opportunity.read', 'opportunity.create', 'opportunity.update', 'opportunity.approve', 'opportunity.publish',
  'publication.read', 'publication.create', 'publication.update', 'publication.approve', 'publication.publish',
  'forms.read', 'forms.manage',
  'seo.read', 'seo.update', 'seo.approve', 'seo.publish',
  'translation.read', 'translation.update', 'translation.approve', 'translation.publish',
  'media.read', 'media.upload', 'media.update', 'media.delete',
  'site.rebuild',
  'audit.read',
  'users.read', 'users.manage',
  // Settings Center: read; edit organization, branding and contact; admin-only fields (canonical domain, environment,
  // email server, restoring revisions); publish settings to the website (rebuild).
  'settings.read', 'settings.update', 'settings.admin', 'settings.publish',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['super_admin', 'website_admin', 'content_editor', 'content_reviewer', 'media_manager', 'seo_manager', 'read_only'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  website_admin: 'Website Administrator',
  content_editor: 'Content Editor',
  content_reviewer: 'Content Reviewer',
  media_manager: 'Media Manager',
  seo_manager: 'SEO Manager',
  read_only: 'Read-Only User',
};

const READ: Permission[] = ['dashboard.read', 'project.read', 'media.read', 'page.read', 'news.read', 'partner.read', 'pillar.read', 'about.read', 'event.read', 'opportunity.read', 'publication.read', 'seo.read', 'translation.read'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  website_admin: PERMISSIONS.filter((p) => p !== 'users.manage'),
  content_editor: [...READ, 'project.create', 'project.update', 'project.seo', 'media.upload', 'media.update', 'page.create', 'page.update', 'news.create', 'news.update', 'partner.create', 'partner.update', 'pillar.create', 'pillar.update', 'about.update', 'event.create', 'event.update', 'opportunity.create', 'opportunity.update', 'publication.create', 'publication.update', 'seo.update', 'translation.update'],
  content_reviewer: [...READ, 'settings.read', 'project.review', 'project.approve', 'page.approve', 'news.approve', 'partner.approve', 'pillar.approve', 'about.approve', 'event.approve', 'opportunity.approve', 'publication.approve', 'seo.approve', 'translation.approve', 'audit.read'],
  media_manager: [...READ, 'media.upload', 'media.update', 'media.delete'],
  seo_manager: [...READ, 'project.seo', 'seo.update', 'settings.read', 'settings.update'],
  read_only: READ,
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
