// Homepage text fields (the mission statement and the like) take up to 500 characters. Uses the real page source.
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFields } from '../src/server/modules/home/fields.ts';
import { TEXT_MAX, validateValues } from '../src/server/modules/home/service.ts';

const SITE = resolve(__dirname, '../..');

describe('homepage text length', () => {
  it('accepts a 500-character mission statement and refuses a longer one', () => {
    const fields = readFields(SITE, 'index.html');
    expect(fields.some((f) => f.key === 'purpose.mission.text')).toBe(true);
    expect(TEXT_MAX).toBe(500);
    const long = 'Strengthening young people and women. '.repeat(20).slice(0, 500).trim().padEnd(500, '.');
    expect(() => validateValues(fields, { 'purpose.mission.text': long })).not.toThrow();
    expect(() => validateValues(fields, { 'purpose.mission.text': long + '.' })).toThrow();
  });
});
