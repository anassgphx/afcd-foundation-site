// Story editor blocks that are more than text: highlighted box, button, video and photos.
// Each one maps 1:1 to a line of the story format (see format.ts) and is edited in place.
import { createContext, useContext, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import ListItem from '@tiptap/extension-list-item';
import type { MediaItem } from '../pages/Media.tsx';
import { SAFE_LINK, VIDEO_OK, videoSrc, type Layout, type Photo } from './format.ts';

export type StoryCtx = { media: Record<string, MediaItem>; pickPhotos: (done: (m: MediaItem[]) => void) => void };
export const StoryContext = createContext<StoryCtx>({ media: {}, pickPhotos: () => {} });

/** List items hold one line of text: the story format has no nested lists. */
export const FlatListItem = ListItem.extend({ content: 'paragraph' });

const Grip = () => <span className="se-grip" data-drag-handle title="Drag to move" contentEditable={false}>⋮⋮</span>;
const Remove = ({ onClick, label = 'Remove this block' }: { onClick: () => void; label?: string }) =>
  <button type="button" className="se-x" onClick={onClick} aria-label={label} title={label}>×</button>;

// ---------------------------------------------------------------- highlighted box
const KINDS: [string, string][] = [['note', 'Note'], ['tip', 'Tip'], ['important', 'Important']];
function CalloutView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  return <NodeViewWrapper className={`se-callout se-${node.attrs.kind}`}>
    <div className="se-callout-h" contentEditable={false}>
      <select value={node.attrs.kind} disabled={!editor.isEditable} onChange={(e) => updateAttributes({ kind: e.target.value })} aria-label="Box colour">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input value={node.attrs.title} readOnly={!editor.isEditable} maxLength={120} placeholder="Title (optional)" aria-label="Box title" onChange={(e) => updateAttributes({ title: e.target.value })} />
      {editor.isEditable && <Remove onClick={deleteNode} />}
    </div>
    <NodeViewContent className="se-callout-b" />
  </NodeViewWrapper>;
}
export const Callout = Node.create({
  name: 'callout', group: 'block', content: 'paragraph', defining: true,
  addAttributes: () => ({ kind: { default: 'note' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'aside[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});

// ---------------------------------------------------------------- button
function ButtonView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const [open, setOpen] = useState(!node.attrs.text || !node.attrs.href);
  const bad = node.attrs.href && !SAFE_LINK.test(node.attrs.href.trim());
  return <NodeViewWrapper className={`se-block se-button${selected ? ' sel' : ''}`}>
    <Grip />
    <div contentEditable={false} className="se-block-b">
      <span className={`se-btn${node.attrs.style === 'light' ? ' light' : ''}`} onClick={() => editor.isEditable && setOpen(!open)}>{node.attrs.text || 'Button text'} <span aria-hidden="true">↗</span></span>
      {!open && <small className="se-meta">{node.attrs.href || 'No link yet'}</small>}
      {open && editor.isEditable && <div className="se-form">
        <input className="input" autoFocus maxLength={80} placeholder="Button text, e.g. Apply now" value={node.attrs.text} onChange={(e) => updateAttributes({ text: e.target.value })} aria-label="Button text" />
        <input className={`input mono${bad ? ' bad' : ''}`} placeholder="get-involved.html or https://…" value={node.attrs.href} onChange={(e) => updateAttributes({ href: e.target.value.trim() })} aria-label="Button link" />
        <select className="select" value={node.attrs.style} onChange={(e) => updateAttributes({ style: e.target.value })} aria-label="Button style"><option value="solid">Solid</option><option value="light">Outlined</option></select>
        <button type="button" className="btn btn-sm" disabled={!node.attrs.text || !node.attrs.href || bad} onClick={() => setOpen(false)}>Done</button>
        {bad && <small className="se-warn">Use a page of this site (e.g. contact.html) or a full https:// address.</small>}
      </div>}
    </div>
    {editor.isEditable && <Remove onClick={deleteNode} />}
  </NodeViewWrapper>;
}
export const CtaButton = Node.create({
  name: 'ctaButton', group: 'block', atom: true, draggable: true, selectable: true,
  addAttributes: () => ({ text: { default: '' }, href: { default: '' }, style: { default: 'solid' } }),
  parseHTML: () => [{ tag: 'div[data-cta]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-cta': '' })],
  addNodeView: () => ReactNodeViewRenderer(ButtonView),
});

// ---------------------------------------------------------------- video
function VideoView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const src = node.attrs.url && VIDEO_OK.test(node.attrs.url) ? videoSrc(node.attrs.url) : null;
  return <NodeViewWrapper className={`se-block se-video${selected ? ' sel' : ''}`}>
    <Grip />
    <div contentEditable={false} className="se-block-b">
      {src ? <a className="se-video-card" href={node.attrs.url} target="_blank" rel="noopener noreferrer" title="Open the video in a new tab"><span className="se-play" aria-hidden="true">▶</span>
          <span><b>{/vimeo/.test(src) ? 'Vimeo' : 'YouTube'} video</b><small>{node.attrs.caption || node.attrs.url}</small><small>Plays on the website; open it here to check it is the right one ↗</small></span></a>
        : <div className="se-video-empty">▶ Paste a YouTube or Vimeo link below</div>}
      {editor.isEditable ? <div className="se-form">
        <input className={`input mono${node.attrs.url && !src ? ' bad' : ''}`} autoFocus={!node.attrs.url} placeholder="https://www.youtube.com/watch?v=…" value={node.attrs.url} onChange={(e) => updateAttributes({ url: e.target.value.trim() })} aria-label="Video link" />
        <input className="input" maxLength={200} placeholder="Caption (optional)" value={node.attrs.caption} onChange={(e) => updateAttributes({ caption: e.target.value })} aria-label="Video caption" />
      </div> : node.attrs.caption && <small className="se-meta">{node.attrs.caption}</small>}
    </div>
    {editor.isEditable && <Remove onClick={deleteNode} />}
  </NodeViewWrapper>;
}
export const Video = Node.create({
  name: 'video', group: 'block', atom: true, draggable: true, selectable: true,
  addAttributes: () => ({ url: { default: '' }, caption: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-video]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-video': '' })],
  addNodeView: () => ReactNodeViewRenderer(VideoView),
});

// ---------------------------------------------------------------- photos (one, or a row of two or three)
const LAYOUTS: [Layout, string, string][] = [['full', 'Full', 'Full column width'], ['center', 'Centre', 'Narrower and centred'], ['left', 'Left', 'Beside the text, on the left'], ['right', 'Right', 'Beside the text, on the right']];
function PhotosView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const { media, pickPhotos } = useContext(StoryContext);
  const items = (node.attrs.items ?? []) as Photo[]; const ed = editor.isEditable;
  const set = (i: number, p: Partial<Photo>) => updateAttributes({ items: items.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const drop = (i: number) => { const next = items.filter((_, k) => k !== i); if (next.length) updateAttributes({ items: next }); else deleteNode(); };
  const layout = items.length === 1 ? items[0].layout : 'row';
  return <NodeViewWrapper className={`se-block se-photos se-l-${layout}${selected ? ' sel' : ''}`}>
    <Grip />
    <div contentEditable={false} className="se-block-b">
      {ed && items.length === 1 && <div className="se-seg" role="group" aria-label="Photo size">{LAYOUTS.map(([k, l, t]) => <button key={k} type="button" className={items[0].layout === k ? 'on' : ''} title={t} aria-pressed={items[0].layout === k} onClick={() => set(0, { layout: k })}>{l}</button>)}
        <button type="button" title="Add a photo beside this one (up to three in a row)" onClick={() => pickPhotos((m) => updateAttributes({ items: [...items, ...m.map((x) => ({ id: x.id, caption: '', layout: 'full' as Layout }))].slice(0, 3) }))}>+ Side by side</button></div>}
      <div className={`se-photo-row n${items.length}`}>
        {items.map((p, i) => { const m = media[p.id]; const issue = !m ? 'Not in the Media Library' : !m.alt ? 'Needs alt text' : !m.rightsConfirmed ? 'Needs rights confirmed' : '';
          return <figure key={`${p.id}-${i}`} className="se-photo">
            <div className="se-photo-img">{m ? <img src={m.large ?? m.url} alt={m.alt} style={{ objectPosition: `${m.focalX}% ${m.focalY}%` }} /> : <span>Missing photo</span>}
              {issue && <em className="se-issue">{issue}</em>}
              {ed && <button type="button" className="se-x on-img" onClick={() => drop(i)} aria-label="Remove this photo" title="Remove this photo (stays in the Media Library)">×</button>}</div>
            {ed ? <input className="se-cap" maxLength={300} value={p.caption} placeholder={m?.caption ? m.caption : 'Add a caption (optional)'} onChange={(e) => set(i, { caption: e.target.value })} aria-label="Caption" />
              : (p.caption || m?.caption) && <figcaption>{p.caption || m?.caption}</figcaption>}
            {m?.credit && <small className="se-meta">Photo: {m.credit}</small>}
          </figure>; })}
        {ed && items.length > 1 && items.length < 3 && <button type="button" className="se-add-photo" onClick={() => pickPhotos((m) => updateAttributes({ items: [...items, ...m.map((x) => ({ id: x.id, caption: '', layout: 'full' as Layout }))].slice(0, 3) }))}>+ Photo</button>}
      </div>
    </div>
    {ed && <Remove onClick={deleteNode} label="Remove these photos from the story" />}
  </NodeViewWrapper>;
}
export const Photos = Node.create({
  name: 'photos', group: 'block', atom: true, draggable: true, selectable: true,
  addAttributes: () => ({ items: { default: [], parseHTML: (el) => { try { return JSON.parse(el.getAttribute('data-items') ?? '[]'); } catch { return []; } }, renderHTML: (a) => ({ 'data-items': JSON.stringify(a.items ?? []) }) } }),
  parseHTML: () => [{ tag: 'div[data-photos]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-photos': '' })],
  addNodeView: () => ReactNodeViewRenderer(PhotosView),
});
