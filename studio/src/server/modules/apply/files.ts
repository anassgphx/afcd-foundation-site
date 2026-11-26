// Files applicants upload. Checked on the bytes (never the name or the browser's type), stored privately under a
// random key in <dataDir>/apply-files (mode 600), never in the media library, never copied to the website, and never
// given a public address: staff download them through a signed-in, audited route (phase 4).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { Config } from '../../config.ts';
import { pdfProblem } from '../publications/documents.ts';
import { FILE_TYPES } from './engine.ts';

export const MAX_FILE_MB = 25;
export const MAX_DRAFT_BYTES = 60 * 1024 * 1024;
export const MAX_DRAFT_FILES = 30;
export const filesDir = (cfg: Config) => resolve(cfg.dataDir, 'apply-files');
export const filePath = (cfg: Config, key: string) => resolve(filesDir(cfg), key);
const KEY = /^[0-9a-f]{32}$/;

export type Detected = { kind: 'pdf' | 'image' | 'doc' | 'sheet'; mime: string; ext: string };
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const has = (b: Uint8Array, s: string) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes(Buffer.from(s, 'latin1'));

/** What the bytes really are, or a reason to refuse them. */
export async function detect(bytes: Uint8Array): Promise<Detected | { problem: string }> {
  if (!bytes.byteLength) return { problem: 'The file is empty.' };
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {   // %PDF-
    const p = pdfProblem(bytes, MAX_FILE_MB * 1048576);
    return p ? { problem: p } : { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  }
  const img = starts(bytes, [0xff, 0xd8, 0xff]) ? 'jpeg' : starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? 'png'
    : starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8) ? 'webp' : null;
  if (img) {
    try {
      const m = await sharp(bytes, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata();
      if (m.format !== img || !m.width || !m.height) return { problem: 'This image is damaged or not what its type says.' };
    } catch { return { problem: 'This image could not be read. Save it again as JPEG or PNG.' }; }
    return { kind: 'image', mime: `image/${img}`, ext: img === 'jpeg' ? 'jpg' : img };
  }
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {          // ZIP: only Word and Excel documents, never with macros
    if (has(bytes, 'vbaProject.bin')) return { problem: 'Documents with macros are not accepted. Save it as a normal .docx/.xlsx or as PDF.' };
    if (!has(bytes, '[Content_Types].xml')) return { problem: 'This file type is not accepted.' };
    if (has(bytes, 'word/document.xml')) return { kind: 'doc', mime: FILE_TYPES.doc.mimes[0], ext: 'docx' };
    if (has(bytes, 'xl/workbook.xml')) return { kind: 'sheet', mime: FILE_TYPES.sheet.mimes[0], ext: 'xlsx' };
    return { problem: 'This file type is not accepted.' };
  }
  return { problem: 'This file type is not accepted. Use PDF, JPEG, PNG, WebP, DOCX or XLSX as the question allows.' };
}

/** A display name only (the stored file uses the random key): no folders, no control or path characters, the real extension. */
export function safeName(name: string, ext: string) {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC').replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[\u0000-\u001F\u007F<>:"|?*\\/]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'file';
  return `${base}.${ext}`;
}

export function store(cfg: Config, bytes: Uint8Array) {
  mkdirSync(filesDir(cfg), { recursive: true, mode: 0o700 });
  const key = randomBytes(16).toString('hex');
  writeFileSync(filePath(cfg, key), bytes, { mode: 0o600, flag: 'wx' });
  return { key, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function removeStored(cfg: Config, key: string) {
  if (!KEY.test(key)) return;
  const p = filePath(cfg, key);
  if (existsSync(p)) rmSync(p);
}
