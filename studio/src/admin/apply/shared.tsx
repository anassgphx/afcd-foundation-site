// AFCD Apply: labels and small pieces shared by the Applications screens.
import './apply.css';

export const CALL_TYPES: [string, string][] = [
  ['youth_program', 'Youth programme'], ['fellowship', 'Fellowship'], ['training', 'Training'], ['volunteer', 'Volunteering'], ['recruitment', 'Recruitment'],
  ['grant', 'Grant'], ['startup', 'Start-up / incubation'], ['event', 'Event participation'], ['expert', 'Call for experts'], ['organization', 'Organisations'], ['other', 'Other'],
];
export const typeLabel = (t: string) => CALL_TYPES.find((x) => x[0] === t)?.[1] ?? t;

export const CALL_STATUS: Record<string, string> = {
  draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved', scheduled: 'Scheduled', open: 'Open', paused: 'Paused',
  closed: 'Closed', under_evaluation: 'Under evaluation', completed: 'Completed', archived: 'Archived',
};
export const CallBadge = ({ s }: { s: string }) => <span className={`badge ap-b ap-b-${s}`}>{CALL_STATUS[s] ?? s}</span>;

/** A date in the call's own time zone, e.g. "15 Feb 2099, 23:59 (Africa/Casablanca)". */
export function inZone(iso: string | null, tz: string, withZone = true) {
  if (!iso) return '—';
  const s = new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return withZone ? `${s} (${tz})` : s;
}

/** "in 3 days", "2 hours ago": relative to the server's clock, which is what opens and closes calls. */
export function relative(iso: string | null, serverNow: number) {
  if (!iso) return '';
  const d = new Date(iso).getTime() - serverNow, a = Math.abs(d);
  const unit = a >= 86400_000 ? [Math.round(a / 86400_000), 'day'] : a >= 3600_000 ? [Math.round(a / 3600_000), 'hour'] : [Math.max(1, Math.round(a / 60_000)), 'minute'];
  const txt = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
  return d >= 0 ? `in ${txt}` : `${txt} ago`;
}

export const ZONES = ['Africa/Casablanca', 'UTC', 'Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Africa/Tunis', 'Africa/Algiers', 'Africa/Cairo', 'Africa/Dakar', 'Africa/Lagos', 'America/New_York'];
