// Publication files: validated PDF uploads, stored like media (random name, outside the site) and copied to
// assets/documents/ only when a publication that uses them is published.
//
// Checks are on the bytes, never the file name or the browser's MIME type: a PDF header at the start, an end-of-file
// marker near the end, a size limit, and no active content (JavaScript, launch actions, embedded files, rich media).
// The active-content check reads the file's uncompressed structure; names hidden inside compressed object streams are
// not seen, so it is a guard against the common cases, not a full PDF sanitizer.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { documents } from '../../db/schema.ts';
import { AppError } from '../../http.ts';

export type DocumentRow = typeof documents.$inferSelect;
export const DOC_FILE = /^[0-9a-f]{24}\.pdf$/;
/** Upload limit for one PDF (env MAX_DOCUMENT_MB, default 30 MB). */
export const maxDocumentBytes = () => Number(process.env.MAX_DOCUMENT_MB || 30) * 1024 * 1024;
/** Where uploaded PDFs live: next to the media folder, inside Studio's data directory (never served publicly). */
export const documentsDir = (cfg: Config) => resolve(cfg.dataDir, 'documents');
export const documentFile = (d: Pick<DocumentRow, 'storageKey'>) => `${d.storageKey}.pdf`;
export const documentPath = (cfg: Config, d: Pick<DocumentRow, 'storageKey'>) => resolve(documentsDir(cfg), documentFile(d));

const ACTIVE = /\/(?:JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA)\b/;

/** Returns a reason the bytes are not an acceptable PDF, or null. */
export function pdfProblem(bytes: Uint8Array, limit = maxDocumentBytes()): string | null {
  if (!bytes.byteLength) return 'The file is empty.';
  if (bytes.byteLength > limit) return `The file is larger than ${Math.round(limit / 1048576)} MB.`;
  const head = Buffer.from(bytes.subarray(0, 16)).toString('latin1');
  if (!/^%PDF-[12]\.\d/.test(head)) return 'This file is not a PDF. Upload the document as a PDF.';
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 2048))).toString('latin1');
  if (!tail.includes('%%EOF')) return 'This PDF looks incomplete or damaged. Export it again and re-upload it.';
  // stream bodies (page content, images, fonts) are binary data that can contain any byte sequence: skip them
  const structure = Buffer.from(bytes).toString('latin1').replace(/stream\r?\n[\s\S]*?endstream/g, '');
  if (ACTIVE.test(structure)) return 'This PDF contains scripts, embedded files or other active content. Export it again as a plain PDF (e.g. “Save as PDF” or PDF/A).';
  return null;
}

/** A readable file name for Studio lists; the stored file always uses the random key. */
const cleanName = (n: string) => (n.replace(/[^\w.\- ()]/g, '_').replace(/\.pdf$/i, '').slice(0, 180) || 'document') + '.pdf';

export async function ingestDocument(db: DB, cfg: Config, file: { name: string; bytes: Uint8Array }, userId: string) {
  const problem = pdfProblem(file.bytes);
  if (problem) throw new AppError(422, problem);
  const key = randomBytes(12).toString('hex');
  mkdirSync(documentsDir(cfg), { recursive: true });
  writeFileSync(resolve(documentsDir(cfg), `${key}.pdf`), file.bytes);
  const [row] = await db.insert(documents).values({
    originalName: cleanName(file.name), storageKey: key, bytes: file.bytes.byteLength,
    sha256: createHash('sha256').update(file.bytes).digest('hex'), uploadedBy: userId,
  }).returning();
  return row;
}

export const documentOnDisk = (cfg: Config, d: Pick<DocumentRow, 'storageKey'>) => existsSync(documentPath(cfg, d));

/** "2.4 MB", "640 KB". */
export function sizeLabel(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
