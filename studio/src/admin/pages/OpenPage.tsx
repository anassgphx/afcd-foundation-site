// "Edit this page" from the website: /studio/open?page=<file>.html finds the Studio editor for that page and goes there.
// Pages Studio doesn't edit yet get a short explanation with the closest useful screens, never a dead end.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Icon, Link, useCan } from '../ui.tsx';

type Found = { to: string } | { none: true; file: string; reason: string; links: { to: string; label: string }[] };
const LISTS: Record<string, string> = {   // listing pages → their Studio list
  'projects.html': '/studio/projects', 'news.html': '/studio/news', 'events.html': '/studio/events', 'partners.html': '/studio/partners',
  'pillars.html': '/studio/pillars', 'index.html': '/studio/home', 'contact.html': '/studio/contact', 'get-involved.html': '/studio/get-involved',
};

async function resolve(file: string, can: (p: string) => boolean): Promise<Found> {
  if (LISTS[file]) return { to: LISTS[file] };
  const bySlug = async (prefix: string, path: string, perm: string, base: string) => {
    if (!file.startsWith(prefix) || !can(perm)) return null;
    const slug = file.slice(prefix.length, -'.html'.length);
    const rows = await api<{ id: string; slug: string }[]>(path);
    const hit = rows.find((r) => r.slug === slug);
    return hit ? `${base}/${hit.id}` : null;
  };
  const tries: [string, string, string, string][] = [
    ['project-', '/projects', 'project.read', '/studio/projects'], ['news-', '/news', 'news.read', '/studio/news'],
    ['event-', '/events', 'event.read', '/studio/events'], ['opportunity-', '/opportunities', 'opportunity.read', '/studio/opportunities'],
    ['publication-', '/publications', 'publication.read', '/studio/publications'],
  ];
  for (const t of tries) { const to = await bySlug(...t).catch(() => null); if (to) return { to }; }
  if (can('pillar.read')) {
    const rows = await api<{ id: string; publicFile: string }[]>('/pillars/records').catch(() => []);
    const hit = rows.find((r) => r.publicFile === file); if (hit) return { to: `/studio/pillars/${hit.id}` };
  }
  if (can('page.read')) {
    const rows = await api<{ id: string; slug: string }[]>('/pages').catch(() => []);
    const hit = rows.find((r) => `${r.slug}.html` === file); if (hit) return { to: `/studio/pages/${hit.id}` };
  }
  return {
    none: true, file, reason: 'This page is written in the website source, so its text isn’t edited in Studio yet.',
    links: [can('seo.read') && { to: '/studio/seo/pages', label: 'Edit its SEO title and description' }, can('translation.read') && { to: '/studio/translations', label: 'Translate its text (French, Arabic)' }].filter(Boolean) as { to: string; label: string }[],
  };
}

export function OpenPage() {
  const can = useCan();
  const raw = new URLSearchParams(location.search).get('page') ?? '';
  // only a plain page file name, with any language folder (fr/, ar/) removed
  const file = (raw.replace(/^\/+/, '').replace(/^(fr|ar)\//, '').split(/[?#]/)[0] || 'index.html').toLowerCase();
  const valid = /^[a-z0-9-]+\.html$/.test(file);
  const [found, setFound] = useState<Found | null>(null);
  useEffect(() => {
    if (!valid) return;
    resolve(file, can).then((f) => { if ('to' in f) { history.replaceState(null, '', f.to); window.dispatchEvent(new Event('studio:nav')); } else setFound(f); }).catch(() => setFound({ none: true, file, reason: 'Studio couldn’t look this page up.', links: [] }));
  }, [file]);

  if (!valid) return <div className="notice n-bad" role="alert">That isn’t a website page address.</div>;
  if (!found) return <div className="card"><div className="card-b" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="skeleton" style={{ width: 16, height: 16, borderRadius: 8 }} />Finding the editor for <span className="mono">{file}</span>…</div></div>;
  if ('to' in found) return null;
  return <div className="card" style={{ maxWidth: 640 }}>
    <div className="card-h"><h2>Edit <span className="mono">{found.file}</span></h2></div>
    <div className="card-b stack">
      <p style={{ margin: 0 }}>{found.reason}</p>
      {found.links.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{found.links.map((l) => <Link key={l.to} to={l.to} className="btn btn-sm">{l.label}<Icon n="chev" /></Link>)}</div>}
      <Link to="/studio/" className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }}>Back to the dashboard</Link>
    </div>
  </div>;
}
