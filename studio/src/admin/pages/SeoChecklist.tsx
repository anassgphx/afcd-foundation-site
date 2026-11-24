// Per-page SEO checklist: every check the build audit runs on one page, grouped, with what passed and what needs work.
// Statuses come from the audit engine (seo/engine.ts pageChecklist), so they always match the Issues list.
import { Icon, Link, Modal } from '../ui.tsx';
import { editorFor, tone, type AuditPage } from './Seo.tsx';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';
export type Check = { id: string; group: 'basic' | 'advanced' | 'content' | 'performance'; label: string; status: CheckStatus; detail: string; codes: string[] };
const GROUPS: [Check['group'], string][] = [['basic', 'Basic SEO'], ['advanced', 'Advanced SEO'], ['content', 'Content and links'], ['performance', 'Performance']];
const MARK: Record<CheckStatus, { sym: string; label: string }> = {
  pass: { sym: '✓', label: 'Passed' }, warn: { sym: '!', label: 'Warning' }, fail: { sym: '×', label: 'Failed' }, info: { sym: 'i', label: 'Note' },
};
const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;

function Bar({ label, value, total, kind }: { label: string; value: number; total: number; kind: CheckStatus }) {
  return <div className="ck-bar"><div className="between"><span>{label}</span><b>{value}/{total}</b></div>
    <span className={`ck-track is-${kind}`}><i style={{ width: `${total ? Math.round((value / total) * 100) : 0}%` }} /></span></div>;
}

export function PageChecklist({ page, onClose }: { page: AuditPage & { checks?: Check[] }; onClose: () => void }) {
  const checks = page.checks ?? [];
  const count = (s: CheckStatus, list = checks) => list.filter((c) => c.status === s).length;
  const scored = checks.filter((c) => c.status !== 'info').length;
  const edit = editorFor(page.owner, page.file);
  return <Modal title="Page checklist" onClose={onClose} footer={<>
    <Link to={`/studio/seo/issues?file=${page.file}`} className="btn">Issues for this page</Link>
    {edit && <Link to={edit} className="btn btn-primary">{page.owner.kind === 'template' ? 'SEO settings' : `Open the ${page.owner.kind} editor`}</Link>}</>}>
    <div className="modal-b ck">
      <div className="ck-head">
        <span className="ck-score" style={{ ['--c' as string]: tone(page.score) }}><b>{page.score}</b><small>/100</small></span>
        <div className="min-w-0"><b className="ck-title">{page.title || page.file}</b><div className="sub mono">{page.file}</div>
          <small className="muted">Studio’s checks of the built page, not Google’s view.</small></div>
      </div>
      {!checks.length ? <p className="muted">This audit was made before the checklist existed. Run the build audit again to see it.</p> : <>
        <div className="ck-bars">
          <Bar label="Passed" value={count('pass')} total={scored} kind="pass" />
          <Bar label="Warnings" value={count('warn')} total={scored} kind="warn" />
          <Bar label="Failed" value={count('fail')} total={scored} kind="fail" />
        </div>
        {count('info') > 0 && <p className="muted ck-note">{n(count('info'), 'note')} for information only; notes do not count against the page.</p>}
        <div className="ck-groups">{GROUPS.map(([g, title]) => {
          const list = checks.filter((c) => c.group === g); if (!list.length) return null;
          const f = count('fail', list), w = count('warn', list);
          return <details key={g} className="ck-group" open={f + w > 0 || undefined}>
            <summary><span>{title}</span>{f + w === 0 ? <span className="ck-badge is-pass">✓ All good</span>
              : <span className={`ck-badge is-${f ? 'fail' : 'warn'}`}>{[f && n(f, 'error'), w && n(w, 'warning')].filter(Boolean).join(' · ')}</span>}<Icon n="chev" width={14} height={14} /></summary>
            <ul>{list.map((c) => <li key={c.id} className={`ck-item is-${c.status}`}>
              <span className="ck-mark" aria-label={MARK[c.status].label} role="img">{MARK[c.status].sym}</span>
              <span className="min-w-0"><b>{c.label}</b><small>{c.detail}</small>
                {c.status !== 'pass' && c.status !== 'info' && <Link to={`/studio/seo/issues?code=${c.codes[0]}&file=${page.file}`} className="ck-link">What to do</Link>}</span>
            </li>)}</ul>
          </details>;
        })}</div>
      </>}
    </div>
  </Modal>;
}
