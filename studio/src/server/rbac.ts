// Roles and permissions. Checked on the server for every request; the admin UI only mirrors them.
export const PERMISSIONS = [
  'dashboard.read',
  'project.read', 'project.create', 'project.update', 'project.seo', 'project.archive',
  'project.review', 'project.approve', 'project.publish',
  'page.read', 'page.create', 'page.update', 'page.approve', 'page.publish',
  'news.read', 'news.create', 'news.update', 'news.approve', 'news.publish',
  'media.read', 'media.upload', 'media.update', 'media.delete',
  'site.rebuild',
  'audit.read',
  'users.read', 'users.manage',
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

const READ: Permission[] = ['dashboard.read', 'project.read', 'media.read', 'page.read', 'news.read'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  website_admin: PERMISSIONS.filter((p) => p !== 'users.manage'),
  content_editor: [...READ, 'project.create', 'project.update', 'project.seo', 'media.upload', 'media.update', 'page.create', 'page.update', 'news.create', 'news.update'],
  content_reviewer: [...READ, 'project.review', 'project.approve', 'page.approve', 'news.approve', 'audit.read'],
  media_manager: [...READ, 'media.upload', 'media.update', 'media.delete'],
  seo_manager: [...READ, 'project.seo'],
  read_only: READ,
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
