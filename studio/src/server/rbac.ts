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
  // AFCD Apply (calls for applications): read calls; create/edit/duplicate/pause/extend/close; approve; open (schedule);
  // export. Applicant personal data gets its own permissions when submissions arrive (docs/adr/0004-afcd-apply.md).
  'apply.read', 'apply.call.manage', 'apply.call.approve', 'apply.call.publish', 'apply.export',
  // application forms and templates: edit the working form and the templates library (publishing a form version: apply.call.publish)
  'apply.form.edit',
  // applications (personal data): read them and their files; change status, correct eligibility, add notes
  'apply.submission.read', 'apply.submission.manage',
  // evaluation: score applications assigned to me; set up rubrics and assignments and see all scores; approve decisions
  'apply.review', 'apply.evaluation.manage', 'apply.decide',
  // communications: edit applicant email templates and send (single, receipts settings, decision notices, bulk)
  'apply.message',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['super_admin', 'website_admin', 'content_editor', 'content_reviewer', 'media_manager', 'seo_manager', 'read_only', 'application_manager', 'application_reviewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  website_admin: 'Website Administrator',
  content_editor: 'Content Editor',
  content_reviewer: 'Content Reviewer',
  media_manager: 'Media Manager',
  seo_manager: 'SEO Manager',
  read_only: 'Read-Only User',
  application_manager: 'Applications Manager',
  application_reviewer: 'Application Reviewer',
};

const READ: Permission[] = ['dashboard.read', 'project.read', 'media.read', 'page.read', 'news.read', 'partner.read', 'pillar.read', 'about.read', 'event.read', 'opportunity.read', 'publication.read', 'seo.read', 'translation.read'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  website_admin: PERMISSIONS.filter((p) => p !== 'users.manage'),
  content_editor: [...READ, 'project.create', 'project.update', 'project.seo', 'media.upload', 'media.update', 'page.create', 'page.update', 'news.create', 'news.update', 'partner.create', 'partner.update', 'pillar.create', 'pillar.update', 'about.update', 'event.create', 'event.update', 'opportunity.create', 'opportunity.update', 'publication.create', 'publication.update', 'seo.update', 'translation.update'],
  content_reviewer: [...READ, 'settings.read', 'apply.read', 'apply.call.approve', 'project.review', 'project.approve', 'page.approve', 'news.approve', 'partner.approve', 'pillar.approve', 'about.approve', 'event.approve', 'opportunity.approve', 'publication.approve', 'seo.approve', 'translation.approve', 'audit.read'],
  media_manager: [...READ, 'media.upload', 'media.update', 'media.delete'],
  seo_manager: [...READ, 'project.seo', 'seo.update', 'settings.read', 'settings.update'],
  read_only: READ,
  // AFCD Apply. The manager runs calls end to end (someone else must still approve what they submit); the reviewer will
  // only see the applications assigned to them, and until then only the calls.
  application_manager: ['dashboard.read', 'media.read', 'media.upload', 'pillar.read', 'project.read', 'apply.read', 'apply.call.manage', 'apply.call.approve', 'apply.call.publish', 'apply.export', 'apply.form.edit', 'apply.submission.read', 'apply.submission.manage', 'apply.review', 'apply.evaluation.manage', 'apply.decide', 'apply.message'],
  application_reviewer: ['dashboard.read', 'apply.read', 'apply.review'],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
