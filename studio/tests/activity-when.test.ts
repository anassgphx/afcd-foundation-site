// Activity date picker: dates typed before the calendar are read into it (src/admin/ActivityEditor.tsx).
import { describe, expect, it } from 'vitest';
import { whenIso } from '../src/admin/ActivityEditor.tsx';

describe('activity date', () => {
  it('reads typed dates into the calendar and leaves other text out', () => {
    expect(whenIso('28/06/2025')).toBe('2025-06-28');
    expect(whenIso('5-3-2026')).toBe('2026-03-05');
    expect(whenIso('2025-06-28')).toBe('2025-06-28');
    expect(whenIso('April 2026')).toBe('');
    expect(whenIso('31/13/2025')).toBe('');
    expect(whenIso('')).toBe('');
  });
});
