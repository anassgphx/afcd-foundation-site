// Visual story editor: write the story as it will read, with a toolbar, a "/" menu for blocks, a menu on selected
// text, live photos, videos, buttons and boxes, drag-and-drop, clean paste from Word or Google Docs, and a plain-text
// view for people who prefer the format. It saves the same story text as before (format.ts), so the website renderer,
// translations, review diffs and revisions are unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Icon, useCan, useToast } from '../ui.tsx';
import { MediaPicker, upload, type MediaItem } from '../pages/Media.tsx';
import { parse, serialize, SAFE_LINK, type Node as Doc } from './format.ts';
import { Callout, CtaButton, FlatListItem, Photos, StoryContext, Video } from './nodes.tsx';
import './story-editor.css';

type Cmd = { key: string; label: string; hint: string; icon: string; keywords: string; run: (e: Editor) => void };

export function StoryEditor({ value, onChange, editable, media, onMedia, placeholder }: {
  value: string; onChange: (text: string) => void; editable: boolean;
  media: Record<string, MediaItem>; onMedia: (items: MediaItem[]) => void; placeholder: string;
}) {
  const can = useCan(); const toast = useToast();
  const [mode, setMode] = useState<'visual' | 'text'>(() => (localStorage.getItem('studio.story.mode') === 'text' ? 'text' : 'visual'));
  const [picker, setPicker] = useState<null | ((m: MediaItem[]) => void)>(null);
  const [link, setLink] = useState<null | { href: string }>(null);
  const [slash, setSlash] = useState<null | { q: string; from: number; to: number; x: number; y: number; i: number }>(null);
  const [uploading, setUploading] = useState(0);
  const modeRef = useRef<'visual' | 'text'>('visual');
  const last = useRef(value); const slashRef = useRef(slash); slashRef.current = slash;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;   // the editor keeps its first callbacks; read the latest through refs
  const uploadRef = useRef<(f: File[], at?: number) => Promise<boolean>>(async () => false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const pickPhotos = useCallback((done: (m: MediaItem[]) => void) => setPicker(() => (m: MediaItem[]) => { onMedia(m); done(m); }), [onMedia]);
  const photosNode = (m: MediaItem[]) => { const rows: Doc[] = []; for (let i = 0; i < m.length; i += 3) rows.push({ type: 'photos', attrs: { items: m.slice(i, i + 3).map((x) => ({ id: x.id, caption: '', layout: 'full' })) } }); return rows; };

  const COMMANDS: Cmd[] = useMemo(() => [
    { key: 'p', label: 'Text', hint: 'A plain paragraph', icon: '¶', keywords: 'text paragraph', run: (e) => e.chain().focus().setParagraph().run() },
    { key: 'h2', label: 'Heading', hint: 'A section title', icon: 'H2', keywords: 'heading title h2 section', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { key: 'h3', label: 'Small heading', hint: 'A title inside a section', icon: 'H3', keywords: 'heading subheading h3 small', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { key: 'ul', label: 'Bulleted list', hint: 'A simple list', icon: '•', keywords: 'list bullet unordered', run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: 'ol', label: 'Numbered list', hint: 'Steps in order', icon: '1.', keywords: 'list numbered ordered steps', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: 'quote', label: 'Quote', hint: 'Words from a participant; end with “— Name”', icon: '“', keywords: 'quote testimony citation', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { key: 'note', label: 'Box', hint: 'A highlighted note, tip or important point', icon: '▣', keywords: 'box callout note tip important highlight', run: (e) => e.chain().focus().insertContent({ type: 'callout', attrs: { kind: 'note', title: '' }, content: [{ type: 'paragraph' }] }).run() },
    { key: 'photo', label: 'Photo', hint: 'From the Media Library; pick 2 or 3 for a row', icon: '▦', keywords: 'photo image picture gallery', run: (e) => pickPhotos((m) => e.chain().focus().insertContent(photosNode(m)).run()) },
    { key: 'video', label: 'Video', hint: 'YouTube or Vimeo', icon: '▶', keywords: 'video youtube vimeo film', run: (e) => e.chain().focus().insertContent({ type: 'video', attrs: { url: '', caption: '' } }).run() },
    { key: 'button', label: 'Button', hint: 'A call to action linking to a page', icon: '⬭', keywords: 'button cta call action link', run: (e) => e.chain().focus().insertContent({ type: 'ctaButton', attrs: { text: '', href: '', style: 'solid' } }).run() },
    { key: 'hr', label: 'Divider', hint: 'A line between sections', icon: '—', keywords: 'divider line separator hr', run: (e) => e.chain().focus().setHorizontalRule().run() },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [pickPhotos]);
  const matches = slash ? COMMANDS.filter((c) => !slash.q || `${c.label} ${c.keywords}`.toLowerCase().includes(slash.q.toLowerCase())) : [];
  const matchesRef = useRef(matches); matchesRef.current = matches;

  async function uploadFiles(files: File[], at?: number) {
    const imgs = files.filter((x) => x.type.startsWith('image/')).slice(0, 12); if (!imgs.length) return false;
    if (!can('media.upload')) { toast('Uploading photos needs the media upload permission. Choose them from the library instead.', true); return true; }
    setUploading(imgs.length); const ok: MediaItem[] = [];
    for (const f of imgs) { try { ok.push(await upload(f)); } catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); } finally { setUploading((n) => n - 1); } }
    if (ok.length && editor) {
      onMedia(ok);
      const chain = editor.chain().focus(); (at !== undefined ? chain.insertContentAt(at, photosNode(ok)) : chain.insertContent(photosNode(ok))).run();
      toast(`${ok.length} photo${ok.length > 1 ? 's' : ''} added. Give ${ok.length > 1 ? 'them' : 'it'} alt text and confirm rights before review.`);
    }
    return true;
  }

  uploadRef.current = uploadFiles;
  const runSlash = (c: Cmd) => { const s = slashRef.current; if (!editor || !s) return; editor.chain().focus().deleteRange({ from: s.from, to: s.to }).run(); setSlash(null); c.run(editor); };

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, strike: false, listItem: false }),
      FlatListItem,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, validate: (href) => SAFE_LINK.test(href), HTMLAttributes: { rel: null, target: null } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : node.type.name === 'paragraph' ? placeholder : ''), showOnlyCurrent: true }),
      Callout, CtaButton, Video, Photos,
    ],
    content: parse(value) as never,
    editorProps: {
      attributes: { class: 'se-doc', 'aria-label': 'Story text', spellcheck: 'true' },
      handleKeyDown: (_v, ev) => {
        const s = slashRef.current; if (!s) return false;
        const list = matchesRef.current;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); setSlash({ ...s, i: (s.i + (ev.key === 'ArrowDown' ? 1 : -1) + Math.max(list.length, 1)) % Math.max(list.length, 1) }); return true; }
        if (ev.key === 'Enter' && list.length) { ev.preventDefault(); runSlash(list[Math.min(s.i, list.length - 1)]); return true; }
        if (ev.key === 'Escape') { setSlash(null); return true; }
        return false;
      },
      handlePaste: (view, ev) => { const files = [...(ev.clipboardData?.files ?? [])]; if (!files.some((f) => f.type.startsWith('image/'))) return false; ev.preventDefault(); uploadRef.current(files, view.state.selection.from); return true; },
      handleDrop: (view, ev, _slice, moved) => {
        if (moved) return false; const files = [...(ev.dataTransfer?.files ?? [])]; if (!files.some((f) => f.type.startsWith('image/'))) return false;
        ev.preventDefault(); const pos = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
        let at: number | undefined; if (pos) { const $p = view.state.doc.resolve(pos.pos); at = $p.depth > 0 ? $p.after(1) : pos.pos; }   // after the paragraph that was dropped on
        uploadRef.current(files, at); return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const text = serialize(e.getJSON() as Doc); if (text !== last.current) { last.current = text; onChangeRef.current(text); }   // housekeeping transactions that change nothing are not edits
      // "/" at the start of an empty line opens the block menu
      const { $from, empty } = e.state.selection; const t = $from.parent.textContent;
      if (empty && $from.parent.type.name === 'paragraph' && /^\/[\w ]{0,20}$/.test(t) && $from.parentOffset === t.length) {
        const c = e.view.coordsAtPos($from.pos); const box = wrapRef.current!.getBoundingClientRect();
        setSlash((s) => ({ q: t.slice(1), from: $from.start(), to: $from.pos, x: c.left - box.left, y: c.bottom - box.top + 6, i: s && s.q === t.slice(1) ? s.i : 0 }));
      } else if (slashRef.current) setSlash(null);
    },
    onBlur: () => setTimeout(() => setSlash(null), 150),
  }, []);

  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);
  // the text changed outside the editor (load, discard, the plain-text view): show it
  useEffect(() => { if (editor && value !== last.current) { last.current = value; editor.commands.setContent(parse(value) as never, false); } }, [editor, value]);
  modeRef.current = mode;
  useEffect(() => { try { localStorage.setItem('studio.story.mode', mode); } catch { /* private mode */ } }, [mode]);
  useEffect(() => {
    if (!editor) return;
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && editor.isFocused) { e.preventDefault(); setLink({ href: editor.getAttributes('link').href ?? '' }); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [editor]);

  if (!editor) return null;
  const style = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const B = ({ on, label, keys, onClick, children, disabled }: { on?: boolean; label: string; keys?: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) =>
    <button type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={label} title={keys ? `${label} · ${keys}` : label} disabled={disabled || !editable} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
  const applyLink = () => {
    if (!link) return; const href = link.href.trim();
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else if (SAFE_LINK.test(href)) { if (editor.state.selection.empty && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run(); else editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); }
    else return;
    setLink(null);
  };

  return <StoryContext.Provider value={{ media, pickPhotos }}>
    <div className="se" ref={wrapRef}>
      <div className="w-tools wr-tools se-bar" role="toolbar" aria-label="Formatting">
        <select className="se-style" value={style} disabled={!editable || mode === 'text'} aria-label="Text style" onChange={(e) => { const v = e.target.value; const c = editor.chain().focus(); (v === 'p' ? c.setParagraph() : c.setHeading({ level: v === 'h2' ? 2 : 3 })).run(); }}>
          <option value="p">Text</option><option value="h2">Heading</option><option value="h3">Small heading</option></select>
        {mode === 'visual' && <>
          <span className="wr-group">
            <B label="Bold" keys="⌘B" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></B>
            <B label="Italic" keys="⌘I" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></B>
            <B label="Link" keys="⌘K" on={editor.isActive('link')} onClick={() => setLink({ href: editor.getAttributes('link').href ?? '' })}><Icon n="ext" width={14} height={14} />Link</B></span>
          <span className="wr-group">
            <B label="Bulleted list" on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</B>
            <B label="Numbered list" on={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</B>
            <B label="Quote" on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“ Quote</B></span>
          <span className="wr-group">
            {COMMANDS.filter((c) => ['note', 'photo', 'video', 'button', 'hr'].includes(c.key)).map((c) => <B key={c.key} label={c.label} onClick={() => c.run(editor)}>{c.icon} {c.label}</B>)}</span>
          <span className="wr-group">
            <B label="Undo" keys="⌘Z" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</B>
            <B label="Redo" keys="⇧⌘Z" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</B></span>
        </>}
        <span className="se-mode" role="group" aria-label="Editor view">
          <button type="button" className={mode === 'visual' ? 'on' : ''} aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}>Visual</button>
          <button type="button" className={mode === 'text' ? 'on' : ''} aria-pressed={mode === 'text'} onClick={() => setMode('text')} title="The story as plain text, in the format the website uses">Text</button></span>
      </div>

      {link && <div className="se-link" role="dialog" aria-label="Link">
        <input className={`input mono${link.href && !SAFE_LINK.test(link.href.trim()) ? ' bad' : ''}`} autoFocus value={link.href} placeholder="about.html, https://… or mailto:…" onChange={(e) => setLink({ href: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLink(null); }} aria-label="Link address" />
        <button type="button" className="btn btn-primary btn-sm" disabled={!!link.href.trim() && !SAFE_LINK.test(link.href.trim())} onClick={applyLink}>{link.href.trim() ? 'Apply' : 'Remove link'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLink(null)}>Cancel</button>
        <small className="muted">{link.href && !SAFE_LINK.test(link.href.trim()) ? 'Use a page of this site (e.g. contact.html), a full https:// address, mailto: or tel:.' : 'Pages of this site open in the same tab; https:// links open in a new one.'}</small>
      </div>}

      {/* the editor stays mounted in the text view (hidden), so its menus are never torn down mid-update */}
      <div className="se-visual" hidden={mode !== 'visual'}>
        <EditorContent editor={editor} />
        <BubbleMenu editor={editor} tippyOptions={{ duration: 120, maxWidth: 'none' }} className="se-bubble" shouldShow={({ editor: e, state }) => modeRef.current === 'visual' && !state.selection.empty && e.isEditable && !e.isActive('photos') && !e.isActive('video') && !e.isActive('ctaButton') && !link}>
          <B label="Bold" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></B>
          <B label="Italic" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></B>
          <B label="Link" on={editor.isActive('link')} onClick={() => setLink({ href: editor.getAttributes('link').href ?? '' })}>Link</B>
          <i className="se-sep" />
          <B label="Heading" on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</B>
          <B label="Small heading" on={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</B>
          <B label="Quote" on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“</B>
        </BubbleMenu>
        {slash && matches.length > 0 && <div className="se-slash" style={{ left: Math.max(0, slash.x), top: slash.y }} role="listbox" aria-label="Insert a block">
          <small>Insert</small>
          {matches.map((c, i) => <button key={c.key} type="button" role="option" aria-selected={i === slash.i} className={i === slash.i ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); runSlash(c); }}>
            <span className="se-ico">{c.icon}</span><span><b>{c.label}</b><small>{c.hint}</small></span></button>)}
        </div>}
      </div>
      {mode === 'text' && <textarea className="w-text se-source" value={value} onChange={(e) => { last.current = ''; onChange(e.target.value); }} readOnly={!editable} aria-label="Story text (plain format)" spellCheck />}

      <div className="se-foot">
        <span>{uploading ? `Uploading ${uploading} photo${uploading > 1 ? 's' : ''}…` : mode === 'visual' ? 'Type / for blocks · drop or paste photos · ⌘S saves' : '## heading · ### small heading · **bold** · *italic* · [link](page.html) · - list · 1. list · > quote · --- divider'}</span>
      </div>
    </div>
    {picker && <MediaPicker multiple onClose={() => setPicker(null)} onPick={(m) => { const done = picker; setPicker(null); if (m.length) done(m); }} />}
  </StoryContext.Provider>;
}
