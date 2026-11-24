// Project editor: duration from calendar dates and back, categories as tags (src/admin/projectFields.tsx).
import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, splitTags } from '../src/admin/projectFields.tsx';

describe('duration from dates', () => {
  it('shows whole years as years and other spans as months', () => {
    expect(formatDuration({ start: '2025-01-01', end: '2026-12-31', ongoing: false })).toBe('2025 – 2026');
    expect(formatDuration({ start: '2026-01-01', end: '2026-12-15', ongoing: false })).toBe('2026');
    expect(formatDuration({ start: '2026-01-10', end: '2026-11-30', ongoing: false })).toBe('January – November 2026');
    expect(formatDuration({ start: '2024-03-05', end: '2025-06-01', ongoing: false })).toBe('March 2024 – June 2025');
    expect(formatDuration({ start: '2024-03-05', end: '', ongoing: true })).toBe('March 2024 – present');
    expect(formatDuration({ start: '2024-01-05', end: '', ongoing: true })).toBe('2024 – present');
    expect(formatDuration({ start: '2024-03-05', end: '', ongoing: false })).toBe('March 2024');
    expect(formatDuration({ start: '', end: '2025-01-01', ongoing: false })).toBe('');
  });
  it('reads saved text back into dates, and round-trips', () => {
    for (const v of ['2025 – 2026', '2025-2026', '2025–2026', '2026', 'January – November 2026', 'March 2024 – June 2025', 'Mar 2024 – present', 'March 2024'])
      expect(formatDuration(parseDuration(v)!)).toBe(formatDuration(parseDuration(formatDuration(parseDuration(v)!))!));
    expect(parseDuration('2025-2026')).toEqual({ start: '2025-01-01', end: '2026-12-01', ongoing: false });
    expect(formatDuration(parseDuration('2025-2026')!)).toBe('2025 – 2026');
    expect(parseDuration('Mar 2024 – present')).toEqual({ start: '2024-03-01', end: '', ongoing: true });
    expect(parseDuration('since the beginning')).toBeNull();
    expect(parseDuration('')).toEqual({ start: '', end: '', ongoing: false });
  });
  it('splits categories into distinct tags', () => {
    expect(splitTags(' Climate Action, Advocacy ,, Climate Action')).toEqual(['Climate Action', 'Advocacy']);
  });
});
