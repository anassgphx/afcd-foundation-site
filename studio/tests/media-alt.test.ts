import { describe, expect, it } from 'vitest';
import { altProblem, placeholderAlt } from '../src/server/modules/media/alt.ts';

describe('placeholder alt text', () => {
  it('refuses text that describes nothing (the live homepage had “zzzzz” and “77yy”)', () => {
    for (const a of ['zzzzz', 'zzzzzzzzz', '77yy', '1234', '---', 'PHOTO', 'image', 'Logo', 'IMG_2041', 'DSC 0042']) expect(placeholderAlt(a), a).not.toBeNull();
    expect(placeholderAlt('24 (1)', '24 (1).jpg')).not.toBeNull();
    expect(placeholderAlt('youth.png', 'youth.png')).not.toBeNull();
  });
  it('accepts real descriptions of any length, in any script', () => {
    for (const a of ['AFCD logo', 'UNDP', 'Young people at a Leadership Lab workshop', 'شباب في ورشة عمل', 'Atelier à Marrakech', 'Group work'])
      expect(placeholderAlt(a, 'photo.jpg'), a).toBeNull();
  });
  it('leaves empty alt to the "missing" message, unchanged', () => {
    expect(placeholderAlt('')).toBeNull();
    // alt text is optional: neither an empty nor a weak alt text blocks review
    expect(altProblem({ alt: '', originalName: 'a.jpg' }, 'Add alt text to “a.jpg”.')).toBeNull();
    expect(altProblem({ alt: 'zzzzz', originalName: '1.jpg' }, 'x')).toBeNull();
    expect(altProblem({ alt: 'Students planting trees', originalName: '1.jpg' }, 'x')).toBeNull();
  });
});
