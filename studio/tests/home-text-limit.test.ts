// Homepage text fields (the mission statement and the like) take up to 800 characters. Uses the real page source.
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFields } from '../src/server/modules/home/fields.ts';
import { TEXT_MAX, validateValues } from '../src/server/modules/home/service.ts';
import { applyFields } from '../../lib/page-fields.mjs';

const SITE = resolve(__dirname, '../..');

describe('homepage text length', () => {
  it('accepts an 800-character mission statement and refuses a longer one', () => {
    const fields = readFields(SITE, 'index.html');
    expect(fields.some((f) => f.key === 'purpose.mission.text')).toBe(true);
    expect(TEXT_MAX).toBe(800);
    const long = 'Strengthening young people and women. '.repeat(30).slice(0, 800).trim().padEnd(800, '.');
    expect(() => validateValues(fields, { 'purpose.mission.text': long })).not.toThrow();
    expect(() => validateValues(fields, { 'purpose.mission.text': long + '.' })).toThrow();
  });

  it('marks long text so the page can show it smaller', () => {
    const p = '<p class="text-[27px]" data-sf="purpose.mission.text">Short.</p>';
    expect(applyFields(p, { 'purpose.mission.text': 'A short mission.' })).toBe('<p class="text-[27px]">A short mission.</p>');
    expect(applyFields(p, { 'purpose.mission.text': 'x'.repeat(200) })).toContain('<p data-long="1" class="text-[27px]">');
    expect(applyFields(p, { 'purpose.mission.text': 'x'.repeat(400) })).toContain('data-long="2"');
    expect(applyFields(p, { 'purpose.mission.text': 'x'.repeat(600) })).toContain('data-long="3"');
    expect(applyFields(p, {})).toBe('<p class="text-[27px]">Short.</p>');   // unedited text is unchanged
  });
});
