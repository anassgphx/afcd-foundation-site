import { describe, it, expect } from 'vitest';
import { articleBody, videoEmbed } from '../src/server/modules/news/render.ts';

describe('story text format: richer blocks', () => {
  it('renders smaller headings, numbered lists and dividers', () => {
    const html = articleBody('### What we learned\n\n1. Listen first\n2. Map the **waste** points\n\n---\n\nAfter.');
    expect(html).toContain('<h3 class="st-h3">What we learned</h3>');
    expect(html).toContain('<ol class="st-ol"><li>Listen first</li><li>Map the <strong>waste</strong> points</li></ol>');
    expect(html).toContain('<hr class="st-hr">');
  });

  it('shows a quote attribution and highlighted boxes', () => {
    const q = articleBody('> We learned that change starts with listening.\n> — A participant, Ait Ourir');
    expect(q).toContain('<cite class="st-cite">A participant, Ait Ourir</cite>');
    expect(q).not.toContain('— A participant');
    const c = articleBody('> [!TIP] Good to know\n> Applications close on **Friday**.');
    expect(c).toContain('<aside class="st-callout st-tip"><p class="st-callout-t">Good to know</p><p>Applications close on <strong>Friday</strong>.</p></aside>');
    expect(articleBody('> [!important]\n> Bring an ID.')).toContain('<aside class="st-callout st-important"><p>Bring an ID.</p></aside>');
  });

  it('turns a button line into a button with a safe link', () => {
    expect(articleBody('[Apply now](get-involved.html "button")')).toContain('<a class="st-btn" href="get-involved.html">Apply now<span aria-hidden="true">↗</span></a>');
    expect(articleBody('[Read more](https://example.org/x "button-light")')).toContain('class="st-btn st-btn-light" href="https://example.org/x" target="_blank" rel="noopener"');
    expect(articleBody('[Bad](javascript:alert(1) "button")')).not.toContain('javascript:');
  });

  it('embeds YouTube and Vimeo only, YouTube from its no-cookie domain', () => {
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ?t=10')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbed('https://vimeo.com/123456789')?.src).toBe('https://player.vimeo.com/video/123456789?dnt=1');
    expect(videoEmbed('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    const html = articleBody('Intro.\n!video(https://youtu.be/dQw4w9WgXcQ "The camp in two minutes")\nAfter.');
    expect(html).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="The camp in two minutes"');
    expect(html).toContain('<figcaption>The camp in two minutes</figcaption>');
    expect(html.indexOf('Intro')).toBeLessThan(html.indexOf('<figure'));
    expect(articleBody('!video(https://evil.example/x)')).toBe('');
  });

  it('keeps the old format working and escapes markup', () => {
    const html = articleBody('## Title <b>x</b>\n\nPlain <script>alert(1)</script>\n\n- a\n- b');
    expect(html).toContain('Title &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<ul class="list-disc');
  });
});
