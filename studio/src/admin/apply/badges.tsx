// AFCD Apply status badges: one component, three independent meanings that are never merged:
// the application's stage, its eligibility, and its final decision; plus the delivery state of an email.
// Colour is a hint only: every badge carries its label (and a shape), and the colours live in tokens (badges.css).
import './badges.css';

type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red' | 'slate';
type Def = { label: string; tone: Tone; icon: 'dot' | 'check' | 'x' | 'clock' | 'pause' | 'send' | 'alert' };

export const STAGE: Record<string, Def> = {
  submitted: { label: 'New', tone: 'neutral', icon: 'dot' },
  eligibility_review: { label: 'Eligibility screening', tone: 'blue', icon: 'clock' },
  under_evaluation: { label: 'In review', tone: 'violet', icon: 'clock' },
  shortlisted: { label: 'Shortlisted', tone: 'amber', icon: 'dot' },
  interview: { label: 'Interview', tone: 'amber', icon: 'dot' },
  selected: { label: 'Selected', tone: 'green', icon: 'check' },
  waitlisted: { label: 'Waitlisted', tone: 'amber', icon: 'pause' },
  not_selected: { label: 'Not selected', tone: 'red', icon: 'x' },
  withdrawn: { label: 'Withdrawn', tone: 'slate', icon: 'x' },
};
export const ELIGIBILITY: Record<string, Def> = {
  not_assessed: { label: 'Not assessed', tone: 'neutral', icon: 'dot' },
  needs_review: { label: 'Needs review', tone: 'amber', icon: 'alert' },
  eligible: { label: 'Eligible', tone: 'green', icon: 'check' },
  ineligible: { label: 'Ineligible', tone: 'red', icon: 'x' },
};
export const DECISION: Record<string, Def> = {
  pending: { label: 'No decision yet', tone: 'neutral', icon: 'dot' },
  proposed: { label: 'Waiting for approval', tone: 'amber', icon: 'clock' },
  selected: { label: 'Selected', tone: 'green', icon: 'check' },
  waitlisted: { label: 'Waitlisted', tone: 'amber', icon: 'pause' },
  not_selected: { label: 'Not selected', tone: 'red', icon: 'x' },
};
// "sent" means the email server accepted it: we have no delivery receipts, so nothing is ever shown as "Delivered"
export const EMAIL: Record<string, Def> = {
  queued: { label: 'Queued', tone: 'blue', icon: 'clock' },
  sending: { label: 'Sending', tone: 'violet', icon: 'send' },
  sent: { label: 'Accepted by the email server', tone: 'blue', icon: 'send' },
  failed: { label: 'Failed', tone: 'red', icon: 'alert' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'x' },
};
const SETS = { stage: STAGE, eligibility: ELIGIBILITY, decision: DECISION, email: EMAIL };
const ICON: Record<Def['icon'], string> = {
  dot: '', check: 'm5 12 4 4 10-10', x: 'M7 7l10 10M17 7 7 17', clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  pause: 'M9 7v10M15 7v10', send: 'M4 12 20 4l-8 16-2-6-6-2z', alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

export function StatusBadge({ category, status, size = 'md', showIcon = true, title }: { category: keyof typeof SETS; status: string; size?: 'sm' | 'md'; showIcon?: boolean; title?: string }) {
  const d = SETS[category][status] ?? { label: status, tone: 'neutral' as Tone, icon: 'dot' as const };
  const kind = { stage: 'Stage', eligibility: 'Eligibility', decision: 'Decision', email: 'Email' }[category];
  return <span className={`stb stb-${d.tone} stb-${size}`} title={title ?? `${kind}: ${d.label}`}>
    {showIcon && (d.icon === 'dot' ? <i className="stb-dot" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[d.icon]} /></svg>)}
    <span>{d.label}</span></span>;
}
export const stageLabel = (s: string) => STAGE[s]?.label ?? s;
