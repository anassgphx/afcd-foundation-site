// Alt text quality. An image's alt text lives in the Media Library and is what screen readers and search engines read,
// so text typed only to get past "Add alt text" ("zzzzz", "77yy", "photo", the file name) must not reach the website.
// No minimum length: "AFCD logo" or an organisation name is good alt text. Only text that describes nothing is refused.

const GENERIC = new Set(['photo', 'image', 'picture', 'pic', 'img', 'logo', 'icon', 'banner', 'cover', 'untitled', 'test', 'testing',
  'placeholder', 'alt', 'alt text', 'text', 'asdf', 'qwerty', 'todo', 'tbd', 'xxx', 'none', 'n/a', 'na', 'image description', 'description',
  'photo 1', 'image 1', 'screenshot']);

const fileStem = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '').trim().toLowerCase();

/** Why this alt text describes nothing, or null when it is fine (or empty: emptiness is reported as "missing" separately). */
export function placeholderAlt(alt: string | null | undefined, originalName?: string | null): string | null {
  const a = (alt ?? '').trim();
  if (!a) return null;
  const low = a.toLowerCase().replace(/\s+/g, ' ');
  const letters = [...low].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 'it has no words';
  if (new Set(letters).size < 2) return 'it repeats one letter';
  if (/^(.)\1{3,}$/u.test(low.replace(/\s/g, ''))) return 'it repeats one letter';
  if (GENERIC.has(low.replace(/[.!_-]+$/g, ''))) return `“${a}” is a generic word, not a description`;
  if (originalName && (low === fileStem(originalName) || low === originalName.trim().toLowerCase())) return 'it is the file name';
  if (/^(img|dsc|dscn|pxl|wa|image|photo)[\s_-]?\d+/i.test(low)) return 'it is a camera file name';
  return null;
}

/** Kept for the modules' readiness checks; alt text no longer blocks anything (AFCD decision, 2026-11-25). `missing` is the module's own
 *  "Add alt text to …" message; placeholder text gets one message everywhere. */
export function altProblem(_m: { alt: string | null; originalName: string }, _missing: string): string | null {
  return null;   // alt text is recommended, not required: an image without it is published with alt="" and never blocks review
}
