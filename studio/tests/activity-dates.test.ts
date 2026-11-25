// An activity can run over several days: "when" is the first day, "whenEnd" the optional last day.
import { describe, it, expect } from 'vitest';
import { projectInputSchema } from '../src/server/modules/projects/service.ts';
import { whenLabel } from '../src/admin/ActivityEditor.tsx';

const items = (projectInputSchema as any).shape.activityItems;
const ok = (x: object) => items.safeParse([{ title: 'Consultation', ...x }]).success;

describe('activity dates', () => {
  it('accepts one day, a range, or no date', () => {
    expect(ok({ when: '2025-06-28' })).toBe(true);
    expect(ok({ when: '2025-06-28', whenEnd: '2025-06-30' })).toBe(true);
    expect(ok({ when: '2025-06-28', whenEnd: '2025-06-28' })).toBe(true);
    expect(ok({})).toBe(true);
  });
  it('refuses an end before the start, or an end without a start', () => {
    expect(ok({ when: '2025-06-28', whenEnd: '2025-06-27' })).toBe(false);
    expect(ok({ whenEnd: '2025-06-30' })).toBe(false);
  });
  it('labels ranges compactly', () => {
    expect(whenLabel('2025-06-28')).toBe('28 Jun 2025');
    expect(whenLabel('2025-06-28', '2025-06-30')).toBe('28–30 Jun 2025');
    expect(whenLabel('2025-06-30', '2025-07-02')).toBe('30 Jun – 2 Jul 2025');
    expect(whenLabel('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026');
    expect(whenLabel('2025-06-28', '2025-06-28')).toBe('28 Jun 2025');
  });
});
