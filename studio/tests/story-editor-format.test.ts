import { describe, it, expect } from 'vitest';
import { parse, serialize, parseInline, serializeInline } from '../src/admin/story/format.ts';

const ID = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222';
const SAMPLE = [
  'Twenty young people met in Ait Ourir for **three days** of *workshops* on [climate action](projects.html).',
  'A second line in the same paragraph\nafter a line break.',
  '## What happened',
  '### Day one',
  '- Mapping\n- Interviews with **residents**',
  '1. Listen\n2. Map\n3. Propose',
  '> We learned that change starts with listening.\n> — A participant',
  '> [!TIP] Good to know\n> Applications close on **Friday**.',
  '---',
  `![A caption](media:${ID} "left")`,
  `![](media:${ID}) ![Second](media:${ID2})`,
  '[Apply now](get-involved.html "button")',
  '!video(https://youtu.be/dQw4w9WgXcQ "Two minutes")',
  'The end.',
].join('\n\n');

describe('story editor format', () => {
  it('turns stored text into editor blocks and back without changing it', () => {
    const doc = parse(SAMPLE);
    expect(doc.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'heading', 'heading', 'bulletList', 'orderedList', 'blockquote', 'callout', 'horizontalRule', 'photos', 'photos', 'ctaButton', 'video', 'paragraph']);
    expect(serialize(doc)).toBe(SAMPLE);
    expect(serialize(parse(serialize(doc)))).toBe(SAMPLE);
  });

  it('keeps the photos, button, video and box settings', () => {
    const doc = parse(SAMPLE).content!;
    expect(doc[9].attrs).toEqual({ items: [{ caption: 'A caption', id: ID, layout: 'left' }] });
    expect(doc[11].attrs).toEqual({ text: 'Apply now', href: 'get-involved.html', style: 'solid' });
    expect(doc[12].attrs).toEqual({ url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Two minutes' });
    expect(doc[7].attrs).toEqual({ kind: 'tip', title: 'Good to know' });
  });

  it('handles nested inline formatting', () => {
    const n = parseInline('See [the **new** page](about.html) and *this*');
    expect(n.find((x) => x.text === 'new')!.marks!.map((m) => m.type)).toEqual(['link', 'bold']);
    expect(serializeInline(n)).toBe('See [the **new** page](about.html) and *this*');
    // markers hug the words when a selection included the spaces
    expect(serializeInline([{ type: 'text', text: ' bold ', marks: [{ type: 'bold' }] }])).toBe(' **bold** ');
  });

  it('normalises loose spacing and lines placed next to text', () => {
    expect(serialize(parse(`Intro\n![x](media:${ID})\nOutro`))).toBe(`Intro\n\n![x](media:${ID})\n\nOutro`);
    expect(serialize(parse(''))).toBe('');
  });
});

describe('story editor format: safety', () => {
  it('drops links the website would refuse instead of saving them', () => {
    const t = serializeInline([{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }, { type: 'text', text: ' or ' },
      { type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href: 'http://insecure.example' } }] }, { type: 'text', text: ' and ' },
      { type: 'text', text: 'ok', marks: [{ type: 'link', attrs: { href: 'contact.html' } }] }]);
    expect(t).toBe('click or here and [ok](contact.html)');
  });
});
