// Studio's shared delete dialog (opportunities, projects, news, events, partners…) is a plain confirmation: it says what is
// deleted and that it can't be undone, and Delete works straight away. No "type the name to confirm" box.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeleteDialog } from '../src/admin/DataTable.tsx';

const html = (names: string[]) => renderToStaticMarkup(createElement(DeleteDialog, { names, noun: ['opportunity', 'opportunities'], onClose: () => {}, run: async () => {} }));

describe('delete dialog', () => {
  it('asks once, with no typing, and Delete is enabled', () => {
    const one = html(['Untitled opportunity']);
    expect(one).toContain('Delete this opportunity?');
    expect(one).toContain('Untitled opportunity');
    expect(one).toMatch(/can’t be undone/);
    expect(one).not.toMatch(/to confirm/i);
    expect(one).not.toContain('<input');
    const buttons = [...one.matchAll(/<button[^>]*>([^<]*)<\/button>/g)];
    const del = buttons.find((b) => b[1] === 'Delete');
    expect(del).toBeTruthy();
    expect(del![0]).not.toMatch(/disabled/);
    expect(buttons.some((b) => b[1] === 'Cancel')).toBe(true);
  });

  it('lists several items without asking to type DELETE', () => {
    const many = html(['A', 'B', 'C']);
    expect(many).toContain('Delete 3 opportunities?');
    expect(many).not.toMatch(/DELETE|<input/);
  });
});
